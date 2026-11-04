// Pruebas propias del Constructor, v0.4: modelo SENASA, atajos, saldo inicial (pantalla y plantilla Excel),
// migración desde la v0.3 (instalación y backup) y 360 px. Mira lo GUARDADO (recargando), no solo la memoria.
// Correr con la app en 8080 y, para la migración, la v0.3.4 en 8091 (git archive 5c7a459 app):
//   node tests/v04_modelo.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const VIEJA = process.env.VIEJA || 'http://localhost:8091/';
const ARR_V03 = process.env.ARR_V03 || '';
const MOVIL = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', acceptDownloads: true };

let fallas = 0;
const ok = (id, cond, det = '') => { console.log(`${cond ? 'OK   ' : 'FALLA'} [${id}] ${det}`); if (!cond) fallas++; };
const listo = (p) => p.waitForFunction(() => window.__stock && document.querySelector('#vista')?.innerHTML.length > 0, null, { timeout: 30000 });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v04-'));
const cerrarModal = async (p, texto) => { const b = p.locator('#modal button', { hasText: texto }); if (await b.count()) await b.first().click(); };
const errores = [];

async function nuevo(browser) {
  const ctx = await browser.newContext(MOVIL);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  p.on('pageerror', (e) => errores.push(String(e)));
  await p.goto(BASE); await listo(p);
  return { ctx, p };
}
// Contador de toques: cada click/tap o casilla escrita = 1.
function toques(p) {
  let n = 0;
  return {
    get n() { return n; },
    tap: async (sel) => { n++; await p.locator(sel).first().click(); },
    escribir: async (sel, v) => { n++; await p.locator(sel).first().fill(String(v)); },
  };
}
const stock = (p) => p.evaluate(() => { const { IDX } = window.__stock; return Object.fromEntries([...IDX().stockMapa().entries()].filter(([, v]) => v !== 0).sort(([a], [b]) => (a < b ? -1 : 1))); });
const total = (p) => p.evaluate(() => { const { L, IDX } = window.__stock; return L.totales(IDX().stockMapa()).total; });
const irMas = async (p, sub) => { await p.locator('#barra [data-ir="mas"]').click(); await p.locator(`#vista [data-sub="${sub}"]`).first().click(); };
const sinDesborde = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const browser = await chromium.launch();
try {
  // ---------- 1. Instalación nueva: modelo SENASA ----------
  {
    const { ctx, p } = await nuevo(browser);
    const m = await p.evaluate(() => ({ cats: window.__stock.S.categorias.map((c) => [c.id, c.activa, c.sexo]), rods: window.__stock.S.rodeos.map((r) => r.nombre), movs: window.__stock.S.movimientos.length }));
    ok('nuevo-sin-stock', m.movs === 0, `${m.movs} movimientos`);
    ok('nuevo-categorias-senasa', ['c-vaca', 'c-vaquillona', 'c-ternero-ss', 'c-ternero', 'c-ternera', 'c-torito', 'c-toro'].every((id) => m.cats.find((c) => c[0] === id)?.[1]), m.cats.filter((c) => c[1]).map((c) => c[0]).join(','));
    ok('nuevo-inactivas', ['c-novillito', 'c-novillo', 'c-caballo'].every((id) => m.cats.find((c) => c[0] === id)?.[1] === false));
    ok('nuevo-cut-vacias-mamones-son-rodeos', ['CUT', 'Vacías', 'Mamones'].every((n) => m.rods.includes(n)));
    const atajos = await p.locator('[data-atajo]').allInnerTexts();
    ok('nuevo-atajos', ['Sexado', 'Destete', 'Tacto', 'Primer parto', 'Pase de terneros', 'Pase a toro'].every((n) => atajos.some((t) => t.includes(n))), atajos.map((t) => t.split('\n')[0]).join(' · '));
    ok('nuevo-360-cargar', await sinDesborde(p));

    // ---------- 2. Saldo inicial por pantalla, con total en vivo ----------
    await irMas(p, 'saldo');
    ok('saldo-360', await sinDesborde(p));
    // Cabeza: esperadas visibles (Vaca), Torito plegado en "Otras"
    const visibles = await p.locator('[data-saldo^="r-cabeza|"]:visible').evaluateAll((els) => els.map((e) => e.dataset.saldo.split('|')[1]));
    ok('saldo-esperadas-primero', visibles.includes('c-vaca') && !visibles.includes('c-torito'), visibles.join(','));
    await p.locator('#f-saldo').fill('2026-11-03');
    const carga = { 'r-cabeza|c-vaca': 100, 'r-cabeza|c-ternero-ss': 60, 'r-cabeza|c-ternero': 10, 'r-cabeza|c-ternera': 12, 'r-cabeza|c-vaquillona': 30, 'r-cabeza|c-toro': 4,
      'r-mamones|c-ternero': 20, 'r-mamones|c-ternera': 25, 'r-toritos|c-torito': 6, 'r-vaqrepo|c-ternera': 15 };
    for (const [k, v] of Object.entries(carga)) await p.locator(`[data-saldo="${k}"]`).fill(String(v));
    const tv = await p.locator('#s-total').innerText();
    ok('saldo-total-vivo', tv === '282', `total en vivo ${tv}`);
    const tr = await p.locator('[data-stot="r-cabeza"]').innerText();
    ok('saldo-total-rodeo', tr === '216', `Cabeza ${tr}`);
    await p.locator('[data-acc="cargar-saldo"]').click();
    await p.waitForFunction(() => window.__stock.S.movimientos.length > 0);
    ok('saldo-guardado', (await total(p)) === 282, `stock ${await total(p)}`);
    await irMas(p, 'saldo');
    ok('saldo-unico', (await p.locator('#vista').innerText()).includes('Ya hay un saldo inicial'));

    // ---------- 3. Atajos: toques y movimientos ----------
    const atajoCaso = async (id, rodeoId, cant, destino = null) => {
      await p.locator('#barra [data-ir="cargar"]').click();
      const t = toques(p);
      await t.tap(`[data-atajo="${id}"]`);
      await t.tap(`[data-rodeo="${rodeoId}"][data-campo="rodeoO"]`);
      if (destino) await t.tap(`[data-rodeo="${destino}"][data-campo="rodeoD"]`);
      for (const [key, v] of Object.entries(cant)) await t.escribir(`[data-cant="${key}"]`, v);
      const n0 = await p.evaluate(() => window.__stock.S.movimientos.length);
      await t.tap('[data-acc="guardar"]');
      await p.waitForFunction((n) => window.__stock.S.movimientos.length > n || !document.querySelector('#modal').hidden, n0);
      const modalAbierto = await p.evaluate(() => !document.querySelector('#modal').hidden);
      if (modalAbierto) { const txt = await p.locator('#modal').innerText(); await cerrarModal(p, 'Revisar'); return { n: t.n, err: txt }; }
      const nuevos = await p.evaluate((n) => window.__stock.S.movimientos.slice(n).map((m) => ({ tipo: m.tipo, o: m.origen, d: m.destino, c: m.cantidad })), n0);
      return { n: t.n, nuevos };
    };
    let r = await atajoCaso('sexado', 'r-cabeza', { f0: 30, f1: 28 });
    ok('atajo-sexado', r.nuevos?.length === 2 && r.nuevos.every((m) => m.tipo === 'cambio_categoria' && m.o.categoriaId === 'c-ternero-ss' && m.d.rodeoId === 'r-cabeza') && r.n <= 5, `${r.n} toques ${JSON.stringify(r.nuevos || r.err)}`);
    r = await atajoCaso('destete', 'r-cabeza', { f0: 10, f1: 12 });
    ok('atajo-destete-traslado', r.nuevos?.length === 2 && r.nuevos.every((m) => m.tipo === 'traslado' && m.d.rodeoId === 'r-mamones' && m.o.categoriaId === m.d.categoriaId) && r.n <= 5, `${r.n} toques`);
    r = await atajoCaso('tacto', 'r-cabeza', { f0: 7, f1: 5 });
    ok('atajo-tacto-traslado', r.nuevos?.length === 2 && r.nuevos.some((m) => m.d.rodeoId === 'r-vacias') && r.nuevos.some((m) => m.d.rodeoId === 'r-cut') && r.nuevos.every((m) => m.tipo === 'traslado' && m.d.categoriaId === 'c-vaca') && r.n <= 5, `${r.n} toques`);
    r = await atajoCaso('primer-parto', 'r-cabeza', { f0: 3 });
    ok('atajo-primer-parto', r.nuevos?.length === 1 && r.nuevos[0].tipo === 'cambio_categoria' && r.nuevos[0].d.categoriaId === 'c-vaca' && r.nuevos[0].d.rodeoId === 'r-cabeza' && r.n <= 5, `${r.n} toques`);
    r = await atajoCaso('pase-terneros', 'r-mamones', { f0: 10, f1: 4 });
    ok('atajo-pase-terneros', r.nuevos?.length === 2 && r.nuevos.some((m) => m.d.categoriaId === 'c-vaquillona' && m.d.rodeoId === 'r-vaqrepo') && r.nuevos.some((m) => m.d.categoriaId === 'c-torito' && m.d.rodeoId === 'r-toritos') && r.n <= 5, `${r.n} toques`);
    r = await atajoCaso('pase-toro', 'r-toritos', { f0: 2 }, 'r-toros');
    ok('atajo-pase-toro-a-toros', r.nuevos?.length === 1 && r.nuevos[0].d.categoriaId === 'c-toro' && r.nuevos[0].d.rodeoId === 'r-toros' && r.n <= 5, `${r.n} toques`);
    ok('atajos-total-igual', (await total(p)) === 282, `stock ${await total(p)}`);
    // Nacimiento: cursor en "sin sexar"
    await p.locator('#barra [data-ir="cargar"]').click();
    await p.locator('[data-tipo="nacimiento"]').click();
    await p.locator('[data-rodeo="r-cabeza"][data-campo="rodeoO"]').click();
    const foco = await p.evaluate(() => document.activeElement?.dataset?.cant);
    ok('nacimiento-foco-sin-sexar', foco === 'c-ternero-ss', foco);
    const visN = await p.locator('[data-cant]:visible').evaluateAll((els) => els.map((e) => e.dataset.cant));
    ok('nacimiento-solo-terneros-a-la-vista', visN.every((id) => ['c-ternero-ss', 'c-ternero', 'c-ternera'].includes(id)), visN.join(','));
    ok('cargar-360', await sinDesborde(p));
    // Persistencia: recargar y comparar lo guardado
    const antes = await stock(p);
    await p.reload(); await listo(p);
    const despues = await stock(p);
    ok('guardado-tras-recargar', JSON.stringify(antes) === JSON.stringify(despues));

    // ---------- 4. Plantilla Excel: descargar, completar, importar ----------
    // Instalación nueva aparte (en esta ya hay saldo).
    const n2 = await nuevo(browser);
    await irMas(n2.p, 'saldo');
    const [dl] = await Promise.all([n2.p.waitForEvent('download'), n2.p.locator('[data-acc="plantilla-saldo"]').click()]);
    const ruta = path.join(TMP, 'plantilla.xlsx'); await dl.saveAs(ruta);
    ok('plantilla-descarga', fs.statSync(ruta).size > 1000, dl.suggestedFilename());
    // Completar la plantilla en el navegador (misma librería) y subirla.
    const b64 = fs.readFileSync(ruta).toString('base64');
    const lleno = await n2.p.evaluate(async ({ b64, malo }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const hojas = await readXlsxFile(new Blob([bin]));
      const h = hojas.find((x) => x.sheet === 'Saldo inicial');
      const vacia = window.__stock.L.leerPlantillaSaldo(h.data, window.__stock.S.rodeos, window.__stock.S.categorias);
      const d = h.data.map((f) => f.slice());
      const iId = d.findIndex((f) => f[0] === 'id');
      const col = (id) => d[iId].indexOf(id);
      const fila = (rid) => d.findIndex((f) => f[d[iId].indexOf('rodeo_id')] === rid);
      d[fila('r-cola')][col('c-vaca')] = 134; d[fila('r-cola')][col('c-ternero-ss')] = 99;
      d[fila('r-toros')][col('c-toro')] = malo ? 'muchos' : 38;
      const out = d.map((f) => f.map((v) => (v === null || v === undefined ? { value: null } : typeof v === 'number' ? { value: v, type: Number } : { value: String(v), type: String })));
      const blob = await writeXlsxFile(out, { sheet: 'Saldo inicial' }).toBlob();
      return { vacia: vacia.errores?.[0] || '', b64: btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()))) };
    }, { b64, malo: true });
    ok('plantilla-vacia-se-rechaza', /ninguna cantidad/.test(lleno.vacia), lleno.vacia);
    fs.writeFileSync(path.join(TMP, 'mala.xlsx'), Buffer.from(lleno.b64, 'base64'));
    await n2.p.setInputFiles('#imp-plantilla', path.join(TMP, 'mala.xlsx'));
    await n2.p.waitForSelector('#modal:not([hidden])');
    const tMala = await n2.p.locator('#modal').innerText();
    ok('plantilla-mala-mensaje-por-celda', /columna Toro: «muchos»/.test(tMala) && /No se guardó nada/.test(tMala), tMala.replace(/\s+/g, ' ').slice(0, 160));
    await cerrarModal(n2.p, 'Volver');
    ok('plantilla-mala-no-guarda', (await n2.p.evaluate(() => window.__stock.S.movimientos.length)) === 0);
    const bueno = await n2.p.evaluate(async ({ b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const h = (await readXlsxFile(new Blob([bin]))).find((x) => x.sheet === 'Saldo inicial');
      const d = h.data.map((f) => f.slice());
      const iId = d.findIndex((f) => f[0] === 'id');
      const fila = d.findIndex((f) => f[d[iId].indexOf('rodeo_id')] === 'r-toros');
      d[fila][d[iId].indexOf('c-toro')] = 38;
      const out = d.map((f) => f.map((v) => (v === null || v === undefined ? { value: null } : typeof v === 'number' ? { value: v, type: Number } : { value: String(v), type: String })));
      const blob = await writeXlsxFile(out, { sheet: 'Saldo inicial' }).toBlob();
      return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    }, { b64: lleno.b64 });
    fs.writeFileSync(path.join(TMP, 'buena.xlsx'), Buffer.from(bueno, 'base64'));
    await n2.p.setInputFiles('#imp-plantilla', path.join(TMP, 'buena.xlsx'));
    await n2.p.waitForSelector('#modal:not([hidden])');
    const tPrev = await n2.p.locator('#modal').innerText();
    ok('plantilla-vista-previa-total', /Total\s*271/.test(tPrev.replace(/\s+/g, ' ')), tPrev.replace(/\s+/g, ' ').slice(0, 200));
    ok('plantilla-360', await sinDesborde(n2.p));
    await n2.p.locator('#modal button', { hasText: 'Guardar saldo inicial' }).click();
    await n2.p.waitForFunction(() => window.__stock.S.movimientos.length === 3);
    await n2.p.reload(); await listo(n2.p);
    const g = await n2.p.evaluate(() => window.__stock.S.movimientos.map((m) => [m.tipo, m.destino.rodeoId, m.destino.categoriaId, m.cantidad, m.fecha]));
    ok('plantilla-guardada-tras-recargar', g.length === 3 && g.every((x) => x[0] === 'saldo_inicial') && g.reduce((s, x) => s + x[3], 0) === 271, JSON.stringify(g));
    await n2.ctx.close();
    await ctx.close();
  }

  // ---------- 5. Migración de una instalación v0.3.4 con datos (misma base, recargando) ----------
  if (ARR_V03) {
    const dir = path.join(TMP, 'perfil');
    // Mismo origen para que compartan la base: la v0.3.4 y después la v0.4 en el MISMO puerto (8092).
    const { spawn } = await import('node:child_process');
    const srv = spawn('python3', ['-m', 'http.server', '8092', '--directory', process.env.DIR_V034], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 800));
    let ctx = await chromium.launchPersistentContext(dir, MOVIL);
    let p = ctx.pages()[0] || await ctx.newPage();
    await p.goto('http://localhost:8092/'); await listo(p);
    await p.locator('#barra [data-ir="mas"]').click(); await p.locator('#vista [data-sub="backup"]').click();
    await p.setInputFiles('#imp-archivo', ARR_V03);
    await p.locator('#modal button', { hasText: 'Reemplazar todo' }).click();
    await p.waitForFunction(() => window.__stock.S.movimientos.length > 0);
    // un conteo y una mortandad en la v0.3.4
    const v03 = await p.evaluate(() => ({ n: window.__stock.S.movimientos.length, tot: window.__stock.L.totales(window.__stock.IDX().stockMapa()).total, v: window.__stock.version }));
    await ctx.close(); srv.kill();
    // Ahora la v0.4 en el mismo puerto/origen
    const srv2 = spawn('python3', ['-m', 'http.server', '8092', '--directory', '/home/user/app'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 800));
    ctx = await chromium.launchPersistentContext(dir, MOVIL);
    p = ctx.pages()[0] || await ctx.newPage();
    // El service worker de la v0.3.4 puede servir la versión vieja: forzar actualización.
    await p.goto('http://localhost:8092/'); await listo(p);
    let ver = await p.evaluate(() => window.__stock.version);
    for (let i = 0; i < 5 && ver !== '0.4.0'; i++) { await p.waitForTimeout(800); await p.reload(); await listo(p); ver = await p.evaluate(() => window.__stock.version); }
    ok('migr-version', ver === '0.4.0', ver);
    await p.waitForSelector('#modal:not([hidden])', { timeout: 5000 }).catch(() => {});
    const tModal = (await p.locator('#modal').innerText().catch(() => '')).replace(/\s+/g, ' ');
    ok('migr-aviso', /categorías SENASA/.test(tModal) && /historia anterior no se tocó/.test(tModal), tModal.slice(0, 160));
    await cerrarModal(p, 'Volver');
    const v04 = await p.evaluate(() => {
      const { S, L, IDX } = window.__stock;
      const st = IDX().stockMapa();
      return { n: S.movimientos.length, tot: L.totales(st).total, vacasEnCola: st.get('r-cola|c-vaca') || 0, viejasEnCola: st.get('r-cola|c-vacas') || 0,
        mamonesM: st.get('r-vaqotono|c-ternero') || 0, viejaActiva: S.categorias.find((c) => c.id === 'c-vacas')?.activa,
        reclas: S.movimientos.filter((m) => m.extra?.migracion === 'v0.4').length, saldoIntacto: S.movimientos.filter((m) => m.tipo === 'saldo_inicial').length };
    });
    ok('migr-total-igual', v04.tot === v03.tot, `v0.3: ${v03.tot} · v0.4: ${v04.tot}`);
    ok('migr-historia-intacta', v04.saldoIntacto === v03.n && v04.n === v03.n + v04.reclas, JSON.stringify(v04));
    ok('migr-categorias', v04.vacasEnCola === 134 && v04.viejasEnCola === 0 && v04.mamonesM === 80 && v04.viejaActiva === false, JSON.stringify(v04));
    await p.reload(); await listo(p);
    const otra = await p.evaluate(() => ({ n: window.__stock.S.movimientos.length, modal: !document.querySelector('#modal').hidden }));
    ok('migr-una-sola-vez', otra.n === v04.n, `${otra.n} movimientos tras recargar`);
    await ctx.close(); srv2.kill();

    // ---------- 6. Importar un backup de la v0.3 en una v0.4 vacía ----------
    const n3 = await nuevo(browser);
    await irMas(n3.p, 'backup');
    await n3.p.setInputFiles('#imp-archivo', ARR_V03);
    await n3.p.waitForSelector('#modal:not([hidden])');
    const tImp = (await n3.p.locator('#modal').innerText()).replace(/\s+/g, ' ');
    ok('import-v03-avisa', /versión anterior/.test(tImp) && /renglones de cambio de categoría/.test(tImp), tImp.slice(0, 160));
    await n3.p.locator('#modal button', { hasText: 'Reemplazar todo' }).click();
    await n3.p.waitForFunction(() => window.__stock.S.movimientos.length > 0);
    await n3.p.reload(); await listo(n3.p);
    const imp = await n3.p.evaluate(() => { const { S, L, IDX } = window.__stock; const st = IDX().stockMapa(); return { tot: L.totales(st).total, cola: st.get('r-cola|c-vaca') || 0, viejas: S.categorias.filter((c) => c.reemplazadaPor).length }; });
    ok('import-v03-guardado', imp.tot === v03.tot && imp.cola === 134 && imp.viejas === 9, JSON.stringify(imp));
    // ---------- 7. Arranque privado v0.4: limpio ----------
    await irMas(n3.p, 'backup');
    await n3.p.setInputFiles('#imp-archivo', '/home/user/datos/arranque_privado.json');
    await n3.p.locator('#modal button', { hasText: 'Reemplazar todo' }).click();
    await n3.p.waitForFunction(() => window.__stock.S.movimientos.length === 0);
    await n3.p.reload(); await listo(n3.p);
    const arr = await n3.p.evaluate(() => ({ n: window.__stock.S.movimientos.length, emp: window.__stock.S.parametros.empresa, cats: window.__stock.S.categorias.length, titulo: document.querySelector('#titulo').innerText }));
    ok('arranque-v04-limpio', arr.n === 0 && /Rincón del Sur/.test(arr.emp) && arr.cats === 10, JSON.stringify({ n: arr.n, cats: arr.cats }));
    await n3.ctx.close();
  } else console.log('(migración: definí ARR_V03 y DIR_V034 para probarla)');

  ok('consola-sin-errores', errores.length === 0, errores.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
