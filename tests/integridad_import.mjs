// Prueba de integridad al importar (vuelta 5). Mira lo GUARDADO en IndexedDB después de recargar la
// página, no lo que la app tiene en memoria.
// Correr: node tests/integridad_import.mjs   (levanta su propio servidor en el puerto 8091)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as L from '../app/ledger.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PUERTO = 8091;
const URL_APP = `http://127.0.0.1:${PUERTO}/`;
let fallas = 0;
const ok = (nombre, cond, det = '') => { console.log(`${cond ? 'OK   ' : 'FALLA'} ${nombre}${det ? ' — ' + det : ''}`); if (!cond) fallas++; };

// ---- Datos de prueba (genéricos, sin datos del campo) ----
const rodeos = [{ id: 'r1', nombre: 'Rodeo uno', orden: 1, activo: true }, { id: 'r2', nombre: 'Rodeo dos', orden: 2, activo: true }];
const categorias = [{ id: 'c1', nombre: 'Vacas', orden: 1, activa: true }, { id: 'c2', nombre: 'Terneros', orden: 2, activa: true }];
function libro(n, prefijo) {
  const m = [];
  for (let i = 0; i < n; i++) {
    m.push({ id: `${prefijo}${i}`, fecha: '2026-11-01', tipo: i % 2 ? 'nacimiento' : 'ingreso', origen: null,
      destino: { rodeoId: i % 3 ? 'r1' : 'r2', categoriaId: i % 2 ? 'c2' : 'c1' }, cantidad: 1 + (i % 5),
      nota: '', caravana: '', motivo: '', conteoId: null, lote: null, creado: '2026-11-01T10:00:00.000Z', anulado: null, corrigeA: null, extra: {} });
  }
  return m;
}
const conteo = (id) => ({ id, fecha: '2026-11-02', rodeoId: 'r1', categoriaId: 'c1', cantidad: 3, nota: '', creado: '2026-11-02T10:00:00.000Z', anulado: null });
const backup = (movs, conteos, membrete) => JSON.parse(JSON.stringify(L.armarBackup({ rodeos, categorias, movimientos: movs, conteos, parametros: { membrete } }, '2026-11-02T10:00:00.000Z')));

const BASE = backup(libro(35, 'base'), [conteo('kb1')], 'Campo de prueba BASE');
const OTRO = backup(libro(1200, 'otro'), [conteo('ko1'), conteo('ko2')], 'Campo de prueba OTRO');

// ---- Lo que hay guardado, leído directo de IndexedDB ----
async function guardado(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('stock-campo-san-jose');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const stores = ['rodeos', 'categorias', 'movimientos', 'conteos', 'kv'];
      const tx = db.transaction(stores, 'readonly');
      const res = {};
      let faltan = stores.length;
      for (const s of stores) {
        const r = tx.objectStore(s).getAll();
        r.onsuccess = () => {
          res[s] = r.result;
          if (--faltan === 0) {
            const kv = Object.fromEntries(res.kv.map((x) => [x.clave, x.valor]));
            const ids = (l) => l.map((x) => x.id).sort().join(',');
            resolve({
              huella: `R${res.rodeos.length} C${res.categorias.length} M${res.movimientos.length} K${res.conteos.length} | ${ids(res.movimientos).length}:${ids(res.conteos)} | ${kv.parametros?.membrete || ''}`,
              movimientos: res.movimientos.length, conteos: res.conteos.length, membrete: kv.parametros?.membrete || '',
            });
            db.close();
          }
        };
      }
    };
  }));
}

async function recargar(page) { await page.reload(); await page.waitForSelector('nav, #vista'); await page.waitForTimeout(300); }
async function irBackup(page) { await page.click('nav [data-ir="mas"]'); await page.click('[data-sub="backup"]'); await page.waitForSelector('#imp-archivo', { state: 'attached' }); }
async function importarArchivo(page, obj, nombre = 'backup.json') {
  await irBackup(page);
  await page.setInputFiles('#imp-archivo', { name: nombre, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });
  await page.waitForSelector('#modal:not([hidden]) .caja', { timeout: 15000 });
  return page.textContent('#modal .caja');
}
async function botonModal(page, texto) { await page.click(`#modal button:has-text("${texto}")`); await page.waitForSelector('#modal', { state: 'hidden', timeout: 30000 }); }
// Después de "Reemplazar todo" / "Deshacer": esperar a que termine (sin "Procesando…") y que no haya aviso de error.
async function esperarFin(page) {
  await page.waitForFunction(() => { const p = document.querySelector('#procesando'); return !p || p.hidden; }, null, { timeout: 60000 });
  await page.waitForTimeout(200);
  const m = await page.$('#modal:not([hidden]) .caja');
  return m ? m.textContent() : '';
}

const servidor = spawn('python3', ['-m', 'http.server', String(PUERTO), '--bind', '127.0.0.1'], { cwd: new URL('../app/', import.meta.url).pathname, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  const erroresConsola = [];
  page.on('pageerror', (e) => erroresConsola.push(e.message));
  await page.goto(URL_APP); await page.waitForSelector('nav');

  // 1) Base: importar un backup bueno y comprobarlo después de recargar.
  let t = await importarArchivo(page, BASE);
  ok('base: pide confirmar el reemplazo', /Reemplazar todo/.test(t));
  await botonModal(page, 'Reemplazar todo');
  ok('base: termina sin aviso de error', (await esperarFin(page)) === '');
  await recargar(page);
  const base = await guardado(page);
  ok('base guardada tras recargar', base.movimientos === 35 && base.conteos === 1 && base.membrete === 'Campo de prueba BASE', base.huella.slice(0, 40));

  // 2) Archivos rotos por la pantalla: se rechazan ANTES de tocar la base y lo guardado queda igual.
  const casos = [
    ['id faltante en la primera tanda', (b) => { delete b.movimientos[0].id; }, /Movimiento 1: falta el identificador/],
    ['id faltante en el medio', (b) => { delete b.movimientos[600].id; }, /Movimiento 601: falta el identificador/],
    ['id faltante al final', (b) => { delete b.movimientos.at(-1).id; }, /Movimiento 1200: falta el identificador/],
    ['id que es un objeto', (b) => { b.movimientos[3].id = { x: 1 }; }, /Movimiento 4: falta el identificador/],
    ['id repetido', (b) => { b.movimientos[7].id = b.movimientos[2].id; }, /Movimiento 8: .*repetido/],
    ['rodeo inexistente', (b) => { b.movimientos[10].destino.rodeoId = 'r99'; }, /Movimiento 11: usa un rodeo/],
    ['conteo sin id', (b) => { delete b.conteos[1].id; }, /Conteo 2: falta el identificador/],
  ];
  for (const [nombre, romper, esperado] of casos) {
    const b = structuredClone(OTRO); romper(b);
    t = await importarArchivo(page, b);
    ok(`UI ${nombre}: lo rechaza y dice qué renglón`, /El archivo tiene problemas/.test(t) && esperado.test(t) && /siguen como estaban/.test(t), t.slice(0, 120));
    await botonModal(page, 'Volver');
    await recargar(page);
    const g = await guardado(page);
    ok(`UI ${nombre}: lo guardado no cambió tras recargar`, g.huella === base.huella);
  }

  // 3) Atomicidad de la base, sin la validación previa: reemplazarTodo con un renglón que IndexedDB no acepta.
  for (const [nombre, pos] of [['primera tanda', 0], ['medio', 600], ['final', 1199]]) {
    for (const [tipo, valor] of [['sin id', undefined], ['id objeto', { x: 1 }]]) {
      const b = structuredClone(OTRO);
      if (valor === undefined) delete b.movimientos[pos].id; else b.movimientos[pos].id = valor;
      const r = await page.evaluate(async (est) => {
        const DB = await import('./db.js');
        try { await DB.reemplazarTodo(est, { parametros: { membrete: 'NO DEBE QUEDAR' } }); return { ok: true }; }
        catch (e) { return { ok: false, abortado: e.abortado === true, msg: String(e.message || e) }; }
      }, b);
      ok(`base ${tipo} en ${nombre}: rechaza con aborto confirmado`, r.ok === false && r.abortado === true, r.msg);
      await recargar(page);
      const g = await guardado(page);
      ok(`base ${tipo} en ${nombre}: lo guardado no cambió tras recargar`, g.huella === base.huella, g.huella.slice(0, 40));
    }
  }

  // 4) Importar bien y deshacer.
  t = await importarArchivo(page, OTRO);
  await botonModal(page, 'Reemplazar todo');
  t = await esperarFin(page);
  ok('importar OTRO: termina sin aviso de error', t === '', t.slice(0, 200));
  await recargar(page);
  let g = await guardado(page);
  ok('importar OTRO: queda guardado tras recargar', g.movimientos === 1200 && g.conteos === 2 && g.membrete === 'Campo de prueba OTRO');
  await irBackup(page);
  ok('pantalla Backup ofrece deshacer (también tras recargar)', await page.isVisible('[data-acc="deshacer-imp"]'));
  await page.click('[data-acc="deshacer-imp"]');
  await page.waitForSelector('#modal:not([hidden]) .caja');
  t = await page.textContent('#modal .caja');
  ok('deshacer pide confirmación y muestra a qué vuelve', /35 movimientos/.test(t), t.slice(0, 120));
  await botonModal(page, 'Deshacer importación');
  t = await esperarFin(page);
  ok('deshacer: termina sin aviso de error', t === '', t.slice(0, 200));
  await recargar(page);
  g = await guardado(page);
  ok('deshacer: vuelve exacto a lo de antes tras recargar', g.huella === base.huella, g.huella.slice(0, 40));
  await irBackup(page);
  ok('después de deshacer ya no ofrece deshacer', !(await page.isVisible('[data-acc="deshacer-imp"]')));

  ok('sin errores de JavaScript', erroresConsola.length === 0, erroresConsola.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  servidor.kill();
}
console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
