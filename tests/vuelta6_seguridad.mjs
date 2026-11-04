// Pruebas propias del Constructor, vuelta 6: XSS, CSP, parámetros dañados, fechas inválidas y migración con otra ventana.
// Correr con el servidor de app/ en el puerto 8080:  node tests/vuelta6_seguridad.mjs
// Mira lo que pasa en el navegador de verdad (DOM, consola, base guardada), no solo la lógica.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from '../app/ledger.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const MOVIL = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', acceptDownloads: true };

let fallas = 0;
const ok = (id, cond, det = '') => { console.log(`${cond ? 'OK   ' : 'FALLA'} [${id}] ${det}`); if (!cond) fallas++; };
const listo = (p) => p.waitForFunction(() => window.__stock && document.querySelector('#vista')?.innerHTML.length > 0, null, { timeout: 30000 });
const ir = async (p, vista, sub) => {
  await p.evaluate(([v, s]) => { const b = document.querySelector(`#barra [data-ir="${v}"]`); b.click(); if (s) document.querySelector(`#vista [data-sub="${s}"]`)?.click(); }, [vista, sub]);
  await p.waitForTimeout(80);
};
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-'));

// ---------- 1. XSS ----------
const PAYLOADS = [
  '<img src=x onerror="window.__xss=1">',
  '</style><img src=x onerror=window.__xss=2>',
  '"><svg onload=window.__xss=3>',
  "'><script>window.__xss=4</script>",
  '\\";}</style><script>window.__xss=5</script>',
  '</textarea><img src=x onerror=window.__xss=6>',
  '${window.__xss=7}',
];
const pl = (i) => PAYLOADS[i % PAYLOADS.length] + ' #' + i;
function backupMalicioso() {
  const rodeos = [0, 1, 2].map((i) => ({ id: 'r' + i, nombre: pl(i), ubicacion: pl(i + 3), orden: i, activo: true }));
  const categorias = [0, 1, 2].map((i) => ({ id: 'c' + i, nombre: pl(i + 1), senasa: pl(i + 4), orden: i, activa: true, cuentaComoVaca: i === 0 }));
  let n = 0;
  const m = (tipo, fecha, cantidad, origen, destino, extra = {}) => ({ id: 'm' + (++n), tipo, fecha, cantidad, origen, destino, nota: pl(n), caravana: pl(n + 2), motivo: tipo === 'ajuste' ? pl(n + 5) : '', creado: '2026-11-01T12:00:00.000Z', anulado: null, corrigeA: null, lote: null, extra: {}, ...extra });
  const l = (r, c) => ({ rodeoId: r, categoriaId: c });
  const movimientos = [
    m('saldo_inicial', '2026-10-01', 100, null, l('r0', 'c0')),
    m('saldo_inicial', '2026-10-01', 50, null, l('r1', 'c1')),
    m('nacimiento', '2026-10-05', 5, null, l('r0', 'c1')),
    m('mortandad', '2026-10-06', 2, l('r0', 'c0'), null),
    m('traslado', '2026-10-07', 10, l('r0', 'c0'), l('r2', 'c0')),
    m('venta', '2026-10-08', 1, l('r1', 'c1'), null, { anulado: { fecha: '2026-10-09T10:00:00.000Z', motivo: pl(30) } }),
  ];
  const conteos = [
    { id: 'k1', fecha: '2026-10-10', rodeoId: 'r0', categoriaId: 'c0', cantidad: 80, nota: pl(40), origen: pl(41), creado: '2026-10-10T12:00:00.000Z', anulado: null, diferenciaOriginal: -8 },
    { id: 'k2', fecha: '2026-10-10', rodeoId: 'r1', categoriaId: 'c1', cantidad: 49, nota: pl(42), creado: '2026-10-10T12:00:00.000Z', anulado: null, diferenciaOriginal: 0 },
  ];
  movimientos.push(m('ajuste', '2026-10-10', 0, null, l('r1', 'c1'), { conteoId: 'k2', motivo: pl(50), extra: { confirma: [] } }));
  const parametros = { empresa: pl(60), campo: pl(61), localidad: pl(62), renspa: pl(63), cuit: pl(64), mostrarCuitEnInforme: true, potreros: pl(65), queEsEnfrente: pl(66), motivosAjuste: [pl(67), pl(68)] };
  return L.armarBackup({ rodeos, categorias, movimientos, conteos, parametros }, '2026-11-01T12:00:00.000Z');
}

async function chequearXss(p, donde) {
  const r = await p.evaluate(() => ({
    xss: window.__xss,
    handlers: document.querySelectorAll('[onerror],[onload],[onclick],[onmouseover]').length,
    scripts: document.querySelectorAll('#vista script, #modal script, #impresion script, #cabecera script').length,
    nan: /NaN/.test(document.body.innerText),
  }));
  ok('xss:' + donde, r.xss === undefined && r.handlers === 0 && r.scripts === 0, JSON.stringify(r));
  ok('sin-NaN:' + donde, !r.nan);
}

{
  const browser = await chromium.launch();
  const ctx = await browser.newContext(MOVIL);
  const p = await ctx.newPage();
  const errores = [], csp = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') (/Content Security Policy/.test(m.text()) ? csp : errores).push(m.text()); });
  await p.goto(BASE); await listo(p);
  const f = path.join(TMP, 'malicioso.json');
  fs.writeFileSync(f, JSON.stringify(backupMalicioso()));
  ok('xss:backup-malicioso-es-valido', L.validarBackup(JSON.parse(fs.readFileSync(f, 'utf8'))).ok, 'los textos raros son datos válidos: el problema sería mostrarlos mal');
  await ir(p, 'mas', 'backup');
  await p.setInputFiles('#imp-archivo', f);
  await p.waitForSelector('#modal:not([hidden])');
  await p.locator('#modal button', { hasText: 'Reemplazar todo' }).click();
  await p.waitForFunction(() => document.querySelector('#toast.ver'), null, { timeout: 30000 });
  await chequearXss(p, 'tras-importar');
  for (const v of ['cargar', 'stock', 'conteos', 'historial']) { await ir(p, v); await chequearXss(p, v); }
  await ir(p, 'stock');
  for (const modo of ['rodeo', 'categoria', 'planilla']) { const b = p.locator(`[data-stockmodo="${modo}"]`); if (await b.count()) { await b.click(); await chequearXss(p, 'stock-' + modo); } }
  for (const sub of ['informe', 'movimientos', 'backup', 'rodeos', 'parametros', 'saldo']) { await ir(p, 'mas', sub); await chequearXss(p, 'mas-' + sub); }
  // Carga: ajuste (muestra motivos rápidos) y Explicar (modal con motivos)
  await ir(p, 'cargar'); await p.locator('[data-tipo="ajuste-"]').click(); await p.locator('[data-rodeo="r0"]').click(); await chequearXss(p, 'carga-ajuste');
  await ir(p, 'conteos'); if (await p.locator('[data-explicar]').count()) { await p.locator('[data-explicar]').first().click(); await chequearXss(p, 'modal-explicar'); await p.locator('#modal button', { hasText: 'Cancelar' }).click(); }
  // Imprimir desde el menú del navegador (beforeprint) y el informe descargable
  await p.evaluate(() => window.dispatchEvent(new Event('beforeprint'))); await chequearXss(p, 'beforeprint');
  await ir(p, 'mas', 'informe');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-acc="descargar-informe"]').click()]);
  const fInf = path.join(TMP, 'informe.html'); await dl.saveAs(fInf);
  const htmlInf = fs.readFileSync(fInf, 'utf8');
  ok('informe-descargado:tiene-CSP', /Content-Security-Policy/.test(htmlInf) && /script-src 'sha256-/.test(htmlInf));
  const q = await ctx.newPage(); const errQ = [];
  q.on('console', (m) => { if (m.type() === 'error') errQ.push(m.text()); }); q.on('pageerror', (e) => errQ.push(e.message));
  await q.goto('file://' + fInf);
  const rq = await q.evaluate(() => ({ xss: window.__xss, imp: !!document.getElementById('imprimir') }));
  ok('informe-descargado:sin-xss', rq.xss === undefined, JSON.stringify(rq));
  // El botón Imprimir del archivo descargado sigue andando con la CSP (su script está permitido por hash)
  await q.evaluate(() => { window.__imprimio = 0; window.print = () => { window.__imprimio++; }; });
  await q.screenshot({ path: path.join(TMP, 'informe-descargado.png'), fullPage: true });
  const tapa = await q.evaluate(() => { const b = document.getElementById('imprimir').getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el && el.id !== 'imprimir' ? el.outerHTML.slice(0, 80) : ''; });
  await q.locator('#imprimir').scrollIntoViewIfNeeded();
  const tapa2 = await q.evaluate(() => { const b = document.getElementById('imprimir').getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el && el.id !== 'imprimir' ? el.outerHTML.slice(0, 80) : ''; });
  ok('informe-descargado:boton-imprimir-no-tapado', !tapa2, tapa2 || tapa);
  await q.evaluate(() => document.getElementById('imprimir').click());
  ok('informe-descargado:boton-imprimir-anda', (await q.evaluate(() => window.__imprimio)) === 1, errQ.filter((e) => !/x|Failed to load/.test(e)).join(' | ').slice(0, 200));
  const membrete = await q.locator('.membrete').innerText();
  ok('informe-descargado:membrete-se-ve-como-texto', membrete.includes('<img src=x onerror'), membrete.slice(0, 80));
  ok('sin-errores-de-pagina', errores.length === 0, errores.join(' | ').slice(0, 300));
  ok('csp-sin-violaciones-de-la-app', csp.filter((t) => !/onerror|onload|script/.test(t)).length === 0, csp.join(' | ').slice(0, 300));
  await browser.close();
}

// ---------- 2. Parámetros dañados guardados y anulado con fecha inválida guardado ----------
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext(MOVIL);
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', (e) => errores.push(e.message));
  await p.goto(BASE); await listo(p);
  // Se escribe directo en la base (como haría una versión vieja o un dato corrupto)
  await p.evaluate(() => new Promise((res, rej) => {
    const q = indexedDB.open('stock-campo-san-jose');
    q.onsuccess = () => {
      const db = q.result; const tx = db.transaction(['kv', 'movimientos', 'rodeos', 'categorias'], 'readwrite');
      tx.objectStore('kv').put({ clave: 'parametros', valor: { campo: 'Campo prueba', motivosAjuste: 'roto', mostrarCuitEnInforme: 'si' } });
      const rodeo = window.__stock.S.rodeos[0].id, cat = window.__stock.S.categorias[0].id;
      tx.objectStore('movimientos').put({ id: 'mx1', tipo: 'nacimiento', fecha: '2026-10-01', cantidad: 3, origen: null, destino: { rodeoId: rodeo, categoriaId: cat }, nota: '', caravana: '', motivo: '', creado: 'basura', anulado: { fecha: 'ayer', motivo: 'prueba' }, extra: {} });
      tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
    };
  }));
  await p.reload(); await listo(p);
  const aviso = await p.locator('#modal:not([hidden])').innerText().catch(() => '');
  ok('parametros-danados:aviso', /Se arreglaron datos guardados/.test(aviso) && /Motivos rápidos de ajuste/.test(aviso), aviso.slice(0, 120));
  if (aviso) await p.locator('#modal button').first().click();
  const P = await p.evaluate(() => window.__stock.S.parametros);
  ok('parametros-danados:vuelven-al-defecto', Array.isArray(P.motivosAjuste) && P.motivosAjuste.length > 0 && P.mostrarCuitEnInforme === false && P.campo === 'Campo prueba', JSON.stringify(P).slice(0, 160));
  await ir(p, 'cargar'); await p.locator('[data-tipo="ajuste-"]').click();
  const rid = await p.evaluate(() => window.__stock.S.rodeos.find((r) => r.activo).id);
  await p.locator(`[data-rodeo="${rid}"]`).click();
  ok('parametros-danados:ajuste-avanza', (await p.locator('#c-motivo').count()) === 1 && (await p.locator('[data-motivo]').count()) > 0);
  await ir(p, 'mas', 'parametros');
  ok('parametros-danados:datos-abre', (await p.locator('[data-param="motivosAjuste"]').count()) === 1);
  await ir(p, 'mas', 'movimientos');
  const txt = await p.locator('#vista').innerText();
  ok('fecha-anulado-invalida:sin-NaN', !/NaN/.test(txt) && /fecha desconocida/.test(txt), txt.match(/Anulado el[^\n]*/)?.[0] || '');
  // Persistió el arreglo: al recargar no vuelve a avisar
  await p.reload(); await listo(p);
  ok('parametros-danados:arreglo-guardado', (await p.locator('#modal:not([hidden])').count()) === 0);
  ok('parametros-danados:sin-errores', errores.length === 0, errores.join(' | ').slice(0, 200));
  await browser.close();
}

// ---------- 3. Migración con otra ventana abierta que no suelta la base ----------
{
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-mig-'));
  const ctx = await chromium.launchPersistentContext(perfil, { ...MOVIL, serviceWorkers: 'block' });
  // "Ventana vieja": una base en versión 1 abierta sin manejar versionchange (como la v0.3.1)
  const vieja = ctx.pages()[0] || await ctx.newPage();
  await vieja.goto(BASE + 'manifest.webmanifest');
  await vieja.evaluate(() => new Promise((res) => {
    const q = indexedDB.open('stock-campo-san-jose', 1);
    q.onupgradeneeded = () => { const db = q.result; for (const s of ['rodeos', 'categorias', 'movimientos', 'conteos']) db.createObjectStore(s, { keyPath: 'id' }); db.createObjectStore('kv', { keyPath: 'clave' }); };
    q.onsuccess = () => {
      const db = q.result; window.__dbVieja = db;
      const tx = db.transaction(['movimientos', 'rodeos', 'categorias'], 'readwrite');
      tx.objectStore('rodeos').put({ id: 'r-cola', nombre: 'Cola', ubicacion: '', orden: 0, activo: true });
      tx.objectStore('categorias').put({ id: 'c-vacas', nombre: 'Vacas', orden: 0, activa: true, cuentaComoVaca: true });
      tx.objectStore('movimientos').put({ id: 'mv1', tipo: 'saldo_inicial', fecha: '2026-11-01', cantidad: 7, origen: null, destino: { rodeoId: 'r-cola', categoriaId: 'c-vacas' }, nota: '', caravana: '', motivo: '', creado: '2026-11-01T12:00:00.000Z', anulado: null, extra: {} });
      tx.oncomplete = () => res();
    };
  }));
  const nueva = await ctx.newPage();
  const errores = []; nueva.on('pageerror', (e) => errores.push(e.message));
  await nueva.goto(BASE);
  const msj = await nueva.waitForFunction(() => /Cerrá la otra ventana de la app/.test(document.querySelector('#vista')?.innerText || ''), null, { timeout: 10000 }).then(() => true).catch(() => false);
  ok('migracion-bloqueada:avisa-cerrar-la-otra', msj, (await nueva.locator('#vista').innerText().catch(() => '')).slice(0, 100));
  await vieja.close();
  // v0.4: la base vieja usa las categorías del papel; al abrir se agrega un renglón de reclasificación (Vacas → Vaca), sin tocar mv1.
  const abrio = await nueva.waitForFunction(() => window.__stock && window.__stock.S.movimientos.some((m) => m.id === 'mv1') && window.__stock.L.totales(window.__stock.IDX().stockMapa()).total === 7 && !/Cerrá la otra/.test(document.querySelector('#vista').innerText), null, { timeout: 10000 }).then(() => true).catch(() => false);
  ok('migracion-bloqueada:al-cerrar-sigue-sola-sin-perder', abrio);
  // La app abierta suelta la base si otra ventana necesita una versión más nueva (y se recarga)
  const otra = await ctx.newPage(); await otra.goto(BASE + 'manifest.webmanifest');
  const recarga = nueva.waitForEvent('framenavigated', { timeout: 10000 }).then(() => true).catch(() => false);
  const abrioV3 = await otra.evaluate(() => new Promise((res) => {
    const q = indexedDB.open('stock-campo-san-jose', 3);
    q.onblocked = () => res('bloqueada');
    q.onsuccess = () => { q.result.close(); res('abrió'); };
    q.onerror = () => res('error');
  }));
  ok('version-nueva:la-abierta-suelta-la-base', abrioV3 === 'abrió', abrioV3);
  ok('version-nueva:la-abierta-se-recarga', await recarga);
  ok('migracion:sin-errores', errores.filter((e) => !/version/i.test(e)).length === 0, errores.join(' | ').slice(0, 200));
  await ctx.close();
}

console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
