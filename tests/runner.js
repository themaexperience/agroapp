// tests/runner.js
// Runner de Playwright E2E autónomo con Chrome CDP e intercepción total en RAM
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createOmbuMockData } from './mockData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.jsx': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// 1. Iniciar servidor HTTP local para servir la app
function startStaticServer(port = 5173) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let reqPath = decodeURIComponent(req.url.split('?')[0]);
      if (reqPath === '/') reqPath = '/index.html';

      let filePath = path.join(rootDir, reqPath);
      if (!fs.existsSync(filePath)) {
        // Fallback a index.html para SPA routing
        filePath = path.join(rootDir, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(content);
      });
    });

    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}

// 2. Iniciar Chrome en modo headless con CDP
async function startChrome(port = 9222) {
  const tmpDir = path.join(os.tmpdir(), 'chrome-ombu-' + Date.now());
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-networking',
    `--user-data-dir=${tmpDir}`,
    '--window-size=1440,900'
  ]);

  let connected = false;
  let attempts = 0;
  let versionJson = null;

  while (!connected && attempts < 25) {
    attempts++;
    await new Promise(r => setTimeout(r, 200));
    try {
      versionJson = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/json/version`, res => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
          });
        }).on('error', reject);
      });
      connected = true;
    } catch {
      // reintentar
    }
  }

  if (!connected || !versionJson) {
    chromeProcess.kill();
    throw new Error('No se pudo conectar a Chrome CDP en el puerto ' + port);
  }

  return { chromeProcess, wsUrl: versionJson.webSocketDebuggerUrl, tmpDir };
}

// 3. Cliente CDP con soporte de Page, Runtime, Fetch (Mock) e Input
class CdpPage {
  constructor(ws, sessionId) {
    this.ws = ws;
    this.sessionId = sessionId;
    this.msgId = 1;
    this.pending = new Map();
    this.customRoutes = [];

    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.sessionId !== this.sessionId) return;

      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }

      // Eventos push de CDP
      if (msg.method === 'Fetch.requestPaused') {
        this.handleRequestPaused(msg.params);
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({
        id,
        sessionId: this.sessionId,
        method,
        params
      }));
    });
  }

  async route(urlPattern, handler) {
    this.customRoutes.push({ pattern: urlPattern, handler });
  }

  async handleRequestPaused(params) {
    const { requestId, request } = params;
    const url = request.url;

    for (const r of this.customRoutes) {
      const match = r.pattern === '**/*supabase.co/**'
        ? url.includes('supabase.co')
        : (url.includes(r.pattern) || r.pattern === '*');

      if (match) {
        const routeObj = {
          request: () => request,
          fulfill: async ({ status = 200, contentType = 'application/json', body = '' }) => {
            const bodyStr = typeof body === 'object' ? JSON.stringify(body) : String(body);
            const bodyBase64 = Buffer.from(bodyStr, 'utf8').toString('base64');
            await this.send('Fetch.fulfillRequest', {
              requestId,
              responseCode: status,
              responseHeaders: [
                { name: 'Access-Control-Allow-Origin', value: '*' },
                { name: 'Access-Control-Allow-Headers', value: '*' },
                { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
                { name: 'Content-Type', value: contentType }
              ],
              body: bodyBase64
            });
          },
          continue: async () => {
            await this.send('Fetch.continueRequest', { requestId });
          }
        };

        try {
          await r.handler(routeObj, request);
        } catch (err) {
          console.error('Error en route handler:', err);
          await routeObj.fulfill({ status: 500, body: { error: err.message } });
        }
        return;
      }
    }

    // Si no coincide con rutas personalizadas, continuar
    await this.send('Fetch.continueRequest', { requestId });
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitForLoad();
  }

  async waitForLoad(timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const state = await this.evaluate(() => document.readyState);
        if (state === 'complete' || state === 'interactive') {
          // Esperar un tick para render de React
          await new Promise(r => setTimeout(r, 400));
          return;
        }
      } catch {
        // reintentar
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async evaluate(fnOrCode, ...args) {
    const expr = typeof fnOrCode === 'function'
      ? `(${fnOrCode.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`
      : fnOrCode;

    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });

    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }

  async click(selector) {
    const ok = await this.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.click();
      return true;
    }, selector);

    if (!ok) throw new Error(`Elemento no encontrado para click: ${selector}`);
    await new Promise(r => setTimeout(r, 200));
  }

  async fill(selector, value) {
    const ok = await this.evaluate((sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }, selector, value);

    if (!ok) throw new Error(`Elemento no encontrado para fill: ${selector}`);
    await new Promise(r => setTimeout(r, 150));
  }

  async textContent(selector) {
    return await this.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent : null;
    }, selector);
  }

  async waitForSelector(selector, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = await this.evaluate((sel) => !!document.querySelector(sel), selector);
      if (found) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Timeout esperando selector: ${selector}`);
  }
}

// 4. Assertions básicas estilo Playwright (expect)
export function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`AssertionError: esperado ${JSON.stringify(expected)}, recibido ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`AssertionError: esperado ${JSON.stringify(expected)}, recibido ${JSON.stringify(actual)}`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new Error(`AssertionError: esperado valor truthy, recibido ${actual}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`AssertionError: esperado valor falsy, recibido ${actual}`);
    },
    toContain(substr) {
      if (!String(actual).includes(substr)) {
        throw new Error(`AssertionError: esperado que "${actual}" contenga "${substr}"`);
      }
    },
    not: {
      toContain(substr) {
        if (String(actual).includes(substr)) {
          throw new Error(`AssertionError: esperado que "${actual}" NO contenga "${substr}"`);
        }
      },
      toBe(expected) {
        if (actual === expected) {
          throw new Error(`AssertionError: esperado que NO sea ${JSON.stringify(expected)}`);
        }
      }
    }
  };
}

// 5. Registro y ejecución de tests
const testSuite = [];
export function test(title, fn) {
  testSuite.push({ title, fn });
}

async function run() {
  console.log('\n======================================================');
  console.log('   AUDITORÍA PLAYWRIGHT E2E — SANDBOX EN MEMORIA RAM');
  console.log('   Establecimiento Ficticio El Ombú (850 ha) · Sin Red');
  console.log('======================================================\n');

  // Iniciar servidor local
  const server = await startStaticServer(5173);
  console.log('✓ Servidor local montado en http://127.0.0.1:5173');

  // Iniciar Chrome CDP
  const { chromeProcess, wsUrl, tmpDir } = await startChrome(9222);
  console.log('✓ Chrome Headless conectado vía DevTools Protocol');

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.onopen = r);

  // Helper para enviar a browser target
  let browserMsgId = 1;
  const browserSend = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = browserMsgId++;
      const handler = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const { targetId } = await browserSend('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browserSend('Target.attachToTarget', { targetId, flatten: true });

  const page = new CdpPage(ws, sessionId);

  // Habilitar dominios requeridos en CDP
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Fetch.enable', {
    patterns: [
      { urlPattern: '*supabase.co*', requestStage: 'Request' },
      { urlPattern: '*dolarapi.com*', requestStage: 'Request' }
    ]
  });

  // Cargar archivo de spec si no se cargó
  await import('./sandbox-humano.spec.js');

  console.log(`\nRunning ${testSuite.length} tests using 1 worker\n`);

  let passed = 0;
  let failed = 0;
  const startTime = Date.now();

  for (const t of testSuite) {
    const tStart = Date.now();
    try {
      await t.fn({ page });
      const duration = Date.now() - tStart;
      console.log(`  ✓ ${t.title} (${duration}ms)`);
      passed++;
    } catch (err) {
      const duration = Date.now() - tStart;
      console.error(`  ✗ ${t.title} (${duration}ms)`);
      console.error('    ' + (err.stack || err.message));
      failed++;
    }
  }

  // Cleanup
  try {
    chromeProcess.kill();
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignorar
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n------------------------------------------------------');
  if (failed === 0) {
    console.log(`✓ ${passed} passed (${totalTime}s) — SIMULACIÓN 100% EN VERDE`);
    console.log('------------------------------------------------------\n');
    process.exit(0);
  } else {
    console.error(`✗ ${failed} failed, ${passed} passed (${totalTime}s)`);
    console.log('------------------------------------------------------\n');
    process.exit(1);
  }
}

// Si se ejecuta directamente
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(err => {
    console.error('Error fatal en runner:', err);
    process.exit(1);
  });
}
