import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

function getEnvVars() {
  const envPath = path.join(__dirname, '.env');
  const envVars = {};
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx > 0) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          envVars[key] = val;
        }
      }
    } catch (e) {
      console.warn('Error reading .env:', e);
    }
  }
  return envVars;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.kml': 'application/vnd.google-earth.kml+xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/env.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify(getEnvVars()));
    return;
  }

  if (urlPath === '/api/gemini') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      res.end();
      return;
    }

    const bodyChunks = [];
    req.on('data', (chunk) => bodyChunks.push(chunk));
    req.on('end', async () => {
      try {
        const bodyBuffer = Buffer.concat(bodyChunks);
        const apiKey =
          req.headers['x-goog-api-key'] ||
          req.headers['X-goog-api-key'] ||
          getEnvVars().VITE_GEMINI_API_KEY ||
          '';

        const cleanKey = String(apiKey).trim();

        // Modelos a probar en orden: gemini-flash-latest primero, y si da 429/503 o cuelga, fallback rápido a flash-lite
        const modelsToTry = [
          'gemini-flash-latest',
          'gemini-3.5-flash-lite',
          'gemini-3.1-flash-lite',
          'gemini-3-flash-preview',
        ];

        let finalResText = '';
        let finalStatus = 500;

        for (const m of modelsToTry) {
          try {
            const googleRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-goog-api-key': cleanKey,
                },
                body: bodyBuffer,
                signal: AbortSignal.timeout(3500),
              }
            );

            finalStatus = googleRes.status;
            finalResText = await googleRes.text();

            if (googleRes.ok) {
              break;
            }
          } catch (err) {
            console.warn(`[Proxy /api/gemini] Modelo ${m} dio error/timeout:`, err.message);
          }
        }

        res.writeHead(finalStatus, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        });
        res.end(finalResText);
      } catch (err) {
        console.error('Error en proxy local /api/gemini:', err);
        res.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ error: { message: `Proxy error: ${err.message}` } }));
      }
    });
    return;
  }

  const publicCandidate = path.join(__dirname, 'public', urlPath);
  let filePath =
    urlPath !== '/' &&
    publicCandidate.startsWith(path.join(__dirname, 'public')) &&
    fs.existsSync(publicCandidate) &&
    !fs.statSync(publicCandidate).isDirectory()
      ? publicCandidate
      : path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'index.html');
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    let content = fs.readFileSync(filePath);

    if (ext === '.css') {
      const str = content
        .toString('utf8')
        .replace(/@tailwind\s+\w+;/g, '');
      content = Buffer.from(str, 'utf8');
    } else if (filePath.endsWith('index.html')) {
      const envVars = getEnvVars();
      const injectScript = `<script>window.__ENV__ = ${JSON.stringify(envVars)};</script>\n</head>`;
      const htmlStr = content.toString('utf8').replace('</head>', injectScript);
      content = Buffer.from(htmlStr, 'utf8');
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${err.message}`);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Establecimiento San Jose server running at http://localhost:${PORT}`);
});
