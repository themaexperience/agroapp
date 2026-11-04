// Tests de la lógica del libro. Correr con: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../app/ledger.js';

let n = 0;
const mov = (tipo, fecha, cantidad, origen, destino, extra = {}) => ({ id: 'm' + (++n), tipo, fecha, cantidad, origen, destino, anulado: null, motivo: tipo === 'ajuste' ? 'x' : '', creado: '', ...extra });
const lado = (r, c) => ({ rodeoId: r, categoriaId: c });

function libro() {
  return [
    mov('saldo_inicial', '2026-11-01', 100, null, lado('A', 'vacas')),
    mov('saldo_inicial', '2026-11-01', 50, null, lado('A', 'terneros')),
    mov('nacimiento', '2026-11-03', 5, null, lado('A', 'terneros')),
    mov('mortandad', '2026-11-04', 2, lado('A', 'vacas'), null),
    mov('traslado', '2026-11-05', 30, lado('A', 'vacas'), lado('B', 'vacas')),
    mov('cambio_categoria', '2026-11-06', 10, lado('A', 'terneros'), lado('A', 'mamones')),
    mov('venta', '2026-11-07', 3, lado('B', 'vacas'), null),
    mov('ingreso', '2026-11-08', 4, null, lado('B', 'toros')),
  ];
}

test('stock = suma de movimientos', () => {
  const st = L.calcularStock(libro());
  assert.equal(st.get('A|vacas'), 68);
  assert.equal(st.get('B|vacas'), 27);
  assert.equal(st.get('A|terneros'), 45);
  assert.equal(st.get('A|mamones'), 10);
  assert.equal(st.get('B|toros'), 4);
  assert.equal(L.totales(st).total, 154);
});

test('el orden de carga no altera el stock', () => {
  const base = L.huellaStock(libro());
  for (let i = 0; i < 50; i++) {
    const l = libro().sort(() => Math.random() - 0.5);
    assert.equal(L.huellaStock(l), base);
  }
});

test('anular revierte exacto', () => {
  const l = libro();
  const antes = L.huellaStock(l.filter((m) => m.tipo !== 'traslado'));
  l.find((m) => m.tipo === 'traslado').anulado = { fecha: 'x', motivo: 'error' };
  assert.equal(L.huellaStock(l), antes);
});

test('stock a una fecha', () => {
  const st = L.calcularStock(libro(), '2026-11-04');
  assert.equal(st.get('A|vacas'), 98);
  assert.equal(st.get('B|vacas'), undefined);
});

test('advierte negativo a la fecha y en fechas posteriores', () => {
  const l = libro();
  const nuevo = mov('mortandad', '2026-11-02', 99, lado('A', 'vacas'), null); // deja 1 el 2/11, pero el 5/11 traslado 30 → negativo
  const negs = L.negativosPorCambio(l, [...l, nuevo], L.clavesDe([nuevo]));
  assert.equal(negs.length, 1);
  assert.equal(negs[0].fecha, '2026-11-04'); // 100−99=1 el 2/11; mortandad de 2 el 4/11 → −1
  const ok = mov('mortandad', '2026-11-02', 5, lado('A', 'vacas'), null);
  assert.equal(L.negativosPorCambio(l, [...l, ok], L.clavesDe([ok])).length, 0);
});

test('anular un nacimiento que deja negativo también advierte', () => {
  const l = [mov('nacimiento', '2026-11-01', 3, null, lado('A', 't')), mov('mortandad', '2026-11-02', 2, lado('A', 't'), null)];
  const desp = l.map((m, i) => (i === 0 ? { ...m, anulado: { fecha: 'x', motivo: 'y' } } : m));
  assert.equal(L.negativosPorCambio(l, desp, L.clavesDe([l[0]])).length, 1);
});

// Conteo como lo guarda la app: con la diferencia del momento de contar.
function conteo(id, fecha, r, c, cantidad, libroAlContar) {
  const k = { id, fecha, rodeoId: r, categoriaId: c, cantidad, anulado: null, creado: '2026-11-08T13:00:00.000Z' };
  k.diferenciaOriginal = L.diferenciaAlContar(k, L.construirIndice(libroAlContar));
  return k;
}

test('índice: stock de una celda a una fecha = suma hasta esa fecha', () => {
  const l = libro();
  const idx = L.construirIndice(l);
  for (const f of ['2026-10-31', '2026-11-01', '2026-11-04', '2026-11-05', '2026-11-30']) {
    const st = L.calcularStock(l, f);
    for (const k of ['A|vacas', 'B|vacas', 'A|terneros', 'A|mamones', 'B|toros']) assert.equal(idx.stockA(k, f), st.get(k) || 0, `${k} al ${f}`);
  }
  assert.equal(idx.stockA('A|vacas'), 68);
});

test('D1: diferencia en rojo hasta ajuste vinculado exacto con motivo', () => {
  const l = libro();
  const c = conteo('c1', '2026-11-08', 'A', 'vacas', 65, l);
  assert.equal(c.diferenciaOriginal, -3);
  let d = L.diferenciasConteo([c], l)[0];
  assert.equal(d.calculado, 68); assert.equal(d.diferencia, -3); assert.equal(d.estado, 'sin_explicar');
  const aj1 = mov('ajuste', '2026-11-08', 2, lado('A', 'vacas'), null, { conteoId: 'c1', motivo: 'muerte no anotada' });
  d = L.diferenciasConteo([c], [...l, aj1])[0];
  // Un ajuste parcial no cierra nada: sigue "sin explicar" (no "reabierta", porque nunca estuvo cerrada).
  assert.equal(d.estado, 'sin_explicar'); assert.equal(d.pendiente, -1); assert.equal(d.calculado, 68);
  const aj2 = mov('ajuste', '2026-11-08', 1, lado('A', 'vacas'), null, { conteoId: 'c1', motivo: 'error de conteo' });
  d = L.diferenciasConteo([c], [...l, aj1, aj2])[0];
  assert.equal(d.estado, 'explicada');
});

test('D1: un ajuste suelto o el movimiento que faltaba NO limpian solos: queda ámbar hasta confirmar', () => {
  const l = libro();
  const c = conteo('c1', '2026-11-08', 'A', 'vacas', 65, l);
  const suelto = mov('ajuste', '2026-11-08', 3, lado('A', 'vacas'), null, { motivo: 'x', creado: '2026-11-09T10:00:00.000Z' });
  let d = L.diferenciasConteo([c], [...l, suelto])[0];
  assert.equal(d.diferencia, 0); assert.equal(d.estado, 'cuadra_sin_confirmar');
  const c2 = conteo('c2', '2026-11-08', 'B', 'vacas', 25, l);
  const m = mov('mortandad', '2026-11-06', 2, lado('B', 'vacas'), null, { creado: '2026-11-09T10:00:00.000Z' });
  d = L.diferenciasConteo([c2], [...l, m])[0];
  assert.equal(d.estado, 'cuadra_sin_confirmar'); assert.equal(d.original, -2);
  const ex = L.movimientosQueExplican([d], [...l, m]).get('c2');
  assert.deepEqual(ex.map((x) => x.id), [m.id]);
  // Confirmar = ajuste de 0 vinculado, con motivo: no cambia el stock
  const conf = mov('ajuste', '2026-11-08', 0, null, lado('B', 'vacas'), { conteoId: 'c2', motivo: 'Explicada por la mortandad del 06/11' });
  assert.equal(L.validarMovimiento(conf).length, 0);
  const l2 = [...l, m, conf];
  assert.equal(L.huellaStock(l2), L.huellaStock([...l, m]));
  d = L.diferenciasConteo([c2], l2)[0];
  assert.equal(d.estado, 'explicada');
  // Un ajuste de 0 sin conteo no vale
  assert.ok(L.validarMovimiento(mov('ajuste', '2026-11-08', 0, null, lado('B', 'vacas'), { motivo: 'x' })).length);
});

test('D1: ajuste y después la muerte real = reabierta con pista de doble descuento', () => {
  const l = libro();
  const c = conteo('c1', '2026-11-08', 'A', 'vacas', 64, l); // −4
  const aj = mov('ajuste', '2026-11-08', 4, lado('A', 'vacas'), null, { conteoId: 'c1', motivo: 'Muerte no anotada' });
  assert.equal(L.diferenciasConteo([c], [...l, aj])[0].estado, 'explicada');
  const muerte = mov('mortandad', '2026-11-07', 4, lado('A', 'vacas'), null);
  const d = L.diferenciasConteo([c], [...l, aj, muerte])[0];
  assert.equal(d.estado, 'reabierta'); assert.equal(d.calculado, 64); assert.equal(d.pendiente, 4); assert.ok(d.dobleDescuento);
});

test('anular un conteo lo deja visible como anulado', () => {
  const l = libro();
  const c = { ...conteo('c1', '2026-11-08', 'A', 'vacas', 60, l), anulado: { fecha: 'x', motivo: 'mal contado' } };
  assert.equal(L.estadoConteos([c], l)[0].estado, 'anulado');
  assert.equal(L.diferenciasConteo([c], l).length, 0);
});

test('validaciones', () => {
  assert.ok(L.validarMovimiento(mov('traslado', '2026-11-01', 1, lado('A', 'v'), lado('A', 'v'))).length);
  assert.ok(L.validarMovimiento(mov('ajuste', '2026-11-01', 1, null, lado('A', 'v'), { motivo: '' })).length);
  assert.ok(L.validarMovimiento(mov('venta', '2026-11-01', 0, lado('A', 'v'), null)).length);
  assert.equal(L.validarMovimiento(mov('venta', '2026-11-01', 2, lado('A', 'v'), null)).length, 0);
});

test('historial mensual', () => {
  const l = [...libro(), mov('nacimiento', '2026-12-10', 7, null, lado('A', 'terneros'))];
  const h = L.historialMensual(l, '2027-01-15');
  assert.deepEqual(h.map((x) => x.mes), ['2026-11', '2026-12', '2027-01']);
  assert.equal(h[0].total, 154); assert.equal(h[1].total, 161); assert.equal(h[1].variacion, 7); assert.equal(h[2].variacion, 0);
});

test('backup ida y vuelta reproduce el stock', () => {
  const l = libro();
  const rodeos = ['A', 'B'].map((id) => ({ id, nombre: id })), categorias = ['vacas', 'terneros', 'mamones', 'toros'].map((id) => ({ id, nombre: id }));
  const b = JSON.parse(JSON.stringify(L.armarBackup({ rodeos, categorias, movimientos: l, conteos: [], parametros: {} }, 'x')));
  const v = L.validarBackup(b);
  assert.ok(v.ok, v.errores.join());
  assert.equal(L.huellaStock(v.estado.movimientos), L.huellaStock(l));
  const b2 = JSON.parse(JSON.stringify(b)); b2.movimientos.pop();
  assert.equal(L.validarBackup(b2).ok, false);
  // conteo vacío, cantidad inválida o rodeo inexistente: se rechaza con mensaje
  for (const malo of [null, { id: 'k', fecha: '2026-11-01', rodeoId: 'A', categoriaId: 'vacas', cantidad: 'muchas' }, { id: 'k', fecha: '2026-11-01', rodeoId: 'Z', categoriaId: 'vacas', cantidad: 3 }]) {
    const b3 = JSON.parse(JSON.stringify(b)); b3.conteos = [malo]; b3.cuentas.conteos = 1;
    const v3 = L.validarBackup(b3);
    assert.equal(v3.ok, false); assert.ok(v3.errores[0].startsWith('Conteo 1'), v3.errores.join());
  }
  const b4 = JSON.parse(JSON.stringify(b)); b4.movimientos[0].destino.rodeoId = 'Z';
  assert.equal(L.validarBackup(b4).ok, false);
});

test('20.000 movimientos: cálculo rápido', () => {
  const big = [];
  for (let i = 0; i < 20000; i++) {
    const d = `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
    big.push(mov(i % 3 ? 'nacimiento' : 'traslado', d, 1, i % 3 ? null : lado('R' + (i % 15), 'c' + (i % 8)), lado('R' + ((i + 1) % 15), 'c' + (i % 8))));
  }
  const t0 = performance.now();
  L.calcularStock(big); L.historialMensual(big, '2026-12-31');
  const idx = L.construirIndice(big);
  const cs = Array.from({ length: 1050 }, (_, k) => ({ id: 'k' + k, fecha: `2026-${String(1 + (k % 12)).padStart(2, '0')}-15`, rodeoId: 'R' + (k % 15), categoriaId: 'c' + (k % 8), cantidad: 3 }));
  L.pistas(L.diferenciasConteo(cs, big, idx));
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `tardó ${ms} ms`);
});

test('D1: una confirmación vieja no se reutiliza si se anuló lo que confirmaba', () => {
  const l = libro();
  const c2 = conteo('c2', '2026-11-08', 'B', 'vacas', 25, l); // −2
  const m = mov('mortandad', '2026-11-06', 2, lado('B', 'vacas'), null, { creado: '2026-11-09T10:00:00.000Z' });
  const conf = mov('ajuste', '2026-11-08', 0, null, lado('B', 'vacas'), { conteoId: 'c2', motivo: 'por la mortandad', extra: { confirma: [m.id] } });
  assert.equal(L.diferenciasConteo([c2], [...l, m, conf])[0].estado, 'explicada');
  const mAnul = { ...m, anulado: { fecha: '2026-11-10T10:00:00.000Z', motivo: 'no era' } };
  assert.equal(L.diferenciasConteo([c2], [...l, mAnul, conf])[0].estado, 'reabierta');
  const otro = mov('venta', '2026-11-07', 2, lado('B', 'vacas'), null, { creado: '2026-11-11T10:00:00.000Z' });
  const d = L.diferenciasConteo([c2], [...l, mAnul, conf, otro])[0];
  assert.equal(d.estado, 'cuadra_sin_confirmar'); assert.ok(d.confirmacionVieja);
});

test('D1: corregir solo la nota no invalida la confirmación; corregir la cantidad sí ("se corrigió")', () => {
  const l = libro();
  const c2 = conteo('c2', '2026-11-08', 'B', 'vacas', 25, l); // −2
  const m = mov('mortandad', '2026-11-06', 2, lado('B', 'vacas'), null, { creado: '2026-11-09T10:00:00.000Z' });
  const conf = mov('ajuste', '2026-11-08', 0, null, lado('B', 'vacas'), { conteoId: 'c2', motivo: 'por la mortandad', creado: '2026-11-09T11:00:00.000Z', extra: { confirma: [m.id] } });
  const mAnul = { ...m, anulado: { fecha: '2026-11-10T10:00:00.000Z', motivo: 'Corregido: nota' } };
  const soloNota = { ...m, id: 'corr1', nota: 'en el bajo', corrigeA: m.id, creado: '2026-11-10T10:00:00.000Z' };
  let d = L.diferenciasConteo([c2], [...l, mAnul, soloNota, conf])[0];
  assert.equal(d.estado, 'explicada'); assert.ok(!d.confirmacionVieja);
  // Corrección que cambia la cantidad (3 en vez de 2) y otra mortandad de −1 compensa: cuadra, pero hay que reconfirmar.
  const otraCant = { ...m, id: 'corr2', cantidad: 3, corrigeA: m.id, creado: '2026-11-10T10:00:00.000Z' };
  const ingreso = mov('ingreso', '2026-11-07', 1, null, lado('B', 'vacas'), { creado: '2026-11-11T10:00:00.000Z' });
  d = L.diferenciasConteo([c2], [...l, mAnul, otraCant, ingreso, conf])[0];
  assert.equal(d.estado, 'cuadra_sin_confirmar'); assert.equal(d.razonVieja, 'corregido');
  // Reconfirmar: la vieja queda "reemplazada" (ya no vale) y la nueva vale.
  const conf2 = mov('ajuste', '2026-11-08', 0, null, lado('B', 'vacas'), { conteoId: 'c2', motivo: 'corregida', creado: '2026-11-12T10:00:00.000Z', extra: { confirma: ['corr2', ingreso.id] } });
  d = L.diferenciasConteo([c2], [...l, mAnul, otraCant, ingreso, conf, conf2])[0];
  assert.equal(d.estado, 'explicada');
  assert.equal(d.validezConfirmaciones.get(conf.id).vale, false);
  assert.equal(d.validezConfirmaciones.get(conf2.id).vale, true);
});

test('migración de conteos v0.1: reconstruye la diferencia al contar o los deja a revisar (nunca verdes)', () => {
  const l = libro().map((m) => ({ ...m, creado: '2026-11-01T10:00:00.000Z' }));
  const viejo = { id: 'v1', fecha: '2026-11-08', rodeoId: 'B', categoriaId: 'vacas', cantidad: 25, creado: '2026-11-08T12:00:00.000Z', anulado: null };
  const tarde = mov('mortandad', '2026-11-06', 2, lado('B', 'vacas'), null, { creado: '2026-11-09T10:00:00.000Z' });
  const libroTotal = [...l, tarde];
  // Sin migrar, hoy cuadra y se vería "Cuadra" (el problema de la v0.2).
  const { conteos, cambiados } = L.migrarConteos([viejo], libroTotal);
  assert.equal(cambiados.length, 1);
  assert.equal(conteos[0].diferenciaOriginal, -2);
  assert.equal(L.diferenciasConteo(conteos, libroTotal)[0].estado, 'cuadra_sin_confirmar');
  // Sin fecha de carga no se puede reconstruir: a revisar (rojo).
  const sinCreado = { ...viejo, id: 'v2', creado: undefined };
  const r2 = L.migrarConteos([sinCreado], libroTotal);
  assert.ok(r2.conteos[0].aRevisar);
  const d2 = L.diferenciasConteo(r2.conteos, libroTotal)[0];
  assert.equal(d2.estado, 'a_revisar'); assert.ok(L.ROJOS.has(d2.estado));
  // Idempotente: lo ya migrado no se toca.
  assert.equal(L.migrarConteos(conteos, libroTotal).cambiados.length, 0);
});

test('historial mensual en un recorrido = stock a fin de cada mes', () => {
  const l = libro();
  const h = L.historialMensual(l, '2026-12-15');
  for (const f of h) assert.equal(L.huellaStock(l.filter((m) => m.fecha <= f.fecha)), [...f.stock.entries()].filter(([, v]) => v !== 0).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(';'));
  assert.equal(h[h.length - 1].mes, '2026-12');
});

// ---- Vuelta 5: validación completa del backup antes de tocar la base ----
function backupBueno() {
  const rodeos = [{ id: 'A', nombre: 'Cola' }, { id: 'B', nombre: 'Cuerpo' }];
  const categorias = ['vacas', 'terneros', 'mamones', 'toros'].map((id) => ({ id, nombre: id }));
  const movimientos = libro();
  const conteos = [{ id: 'k1', fecha: '2026-11-09', rodeoId: 'A', categoriaId: 'vacas', cantidad: 66, anulado: null }];
  movimientos.push({ ...mov('ajuste', '2026-11-09', 2, lado('A', 'vacas'), null), conteoId: 'k1', motivo: 'faltan 2' });
  movimientos.push({ ...mov('ajuste', '2026-11-10', 0, null, lado('A', 'vacas')), conteoId: 'k1', motivo: 'confirmado', extra: { confirma: [movimientos[3].id] } });
  movimientos.push({ ...mov('nacimiento', '2026-11-11', 1, null, lado('A', 'terneros')), corrigeA: movimientos[2].id });
  return JSON.parse(JSON.stringify(L.armarBackup({ rodeos, categorias, movimientos, conteos, parametros: {} }, 'x')));
}
const errDe = (b) => { const v = L.validarBackup(b); assert.equal(v.ok, false); return v.errores.join(' | '); };

test('backup bueno con vínculos pasa la validación', () => {
  const v = L.validarBackup(backupBueno());
  assert.equal(v.ok, true, v.errores.join(' | '));
});

test('movimiento sin id, con id objeto, vacío o repetido: se rechaza y dice qué renglón', () => {
  for (const [pos, valor, texto] of [[0, undefined, 'falta el identificador'], [4, { x: 1 }, 'falta el identificador'], [9, '  ', 'falta el identificador'], [5, 'm1', 'repetido']]) {
    const b = backupBueno();
    const id0 = b.movimientos[0].id;
    if (valor === undefined) delete b.movimientos[pos].id; else b.movimientos[pos].id = valor === 'm1' ? id0 : valor;
    const e = errDe(b);
    assert.match(e, new RegExp(`Movimiento ${pos + 1}: .*${texto}`));
  }
});

test('ids de rodeo, categoría y conteo también se validan', () => {
  let b = backupBueno(); b.rodeos[1].id = 7; assert.match(errDe(b), /Rodeo 2: falta el identificador/);
  b = backupBueno(); b.categorias[1].id = b.categorias[0].id; assert.match(errDe(b), /Categoría 2: .*repetido/);
  b = backupBueno(); delete b.conteos[0].id; assert.match(errDe(b), /Conteo 1: falta el identificador/);
});

test('referencias rotas: rodeo inexistente, conteo, corrección y confirmación', () => {
  let b = backupBueno(); b.movimientos[1].destino.rodeoId = 'NO'; assert.match(errDe(b), /Movimiento 2: usa un rodeo/);
  b = backupBueno(); b.movimientos[8].conteoId = 'NO'; assert.match(errDe(b), /Movimiento 9: está vinculado a un conteo/);
  b = backupBueno(); b.movimientos[10].corrigeA = 'NO'; assert.match(errDe(b), /Movimiento 11: corrige un movimiento/);
  b = backupBueno(); b.movimientos[9].extra.confirma = ['NO']; assert.match(errDe(b), /Movimiento 10: confirma un movimiento/);
  b = backupBueno(); b.conteos[0].rodeoId = 'NO'; assert.match(errDe(b), /Conteo 1: usa un rodeo/);
});

test('fechas imposibles, cantidades no enteras y anulados dañados', () => {
  let b = backupBueno(); b.movimientos[0].fecha = '2026-02-30'; assert.match(errDe(b), /Movimiento 1: falta la fecha/);
  b = backupBueno(); b.movimientos[0].cantidad = 2.5; assert.match(errDe(b), /Movimiento 1: la cantidad/);
  b = backupBueno(); b.conteos[0].fecha = '2026-13-01'; assert.match(errDe(b), /Conteo 1: la fecha/);
  b = backupBueno(); b.movimientos[0].anulado = 'sí'; assert.match(errDe(b), /Movimiento 1: la marca de anulado/);
  b = backupBueno(); b.parametros = [1]; assert.match(errDe(b), /parámetros/);
});

test('se informan los primeros 5 problemas y cuántos más hay', () => {
  const b = backupBueno();
  for (const m of b.movimientos) delete m.id;
  const v = L.validarBackup(b);
  assert.equal(v.ok, false);
  // 11 renglones sin id, más los 2 vínculos (corrección y confirmación) que quedan apuntando a nada.
  assert.equal(v.total, b.movimientos.length + 2);
  assert.equal(v.errores.length, L.MAX_ERRORES + 1);
  assert.match(v.errores.at(-1), new RegExp(`y ${v.total - L.MAX_ERRORES} problemas más`));
});

// ---- Vuelta 6: parámetros con esquema, ids seguros, fechas de anulación, índice incremental ----
test('parámetros con tipo incorrecto: el backup se rechaza con mensaje claro', () => {
  for (const [k, v, txt] of [['motivosAjuste', 'Error de carga', /Motivos rápidos de ajuste.*lista/], ['motivosAjuste', 3, /lista/], ['motivosAjuste', ['ok', { x: 1 }], /lista/],
    ['empresa', { a: 1 }, /Empresa.*texto/], ['mostrarCuitEnInforme', 'sí', /Mostrar CUIT.*sí o no/], ['campo', ['x'], /Campo.*tiene que ser un texto/], ['raro', [1], /raro/]]) {
    const b = backupBueno(); b.parametros = { [k]: v };
    assert.match(errDe(b), txt, `${k}=${JSON.stringify(v).slice(0, 30)}`);
  }
  const b = backupBueno(); b.parametros = { empresa: 'Mi SA', motivosAjuste: ['a', 'b'], mostrarCuitEnInforme: true, porcentajeToros: 3.5, futuro: 'texto' };
  assert.equal(L.validarBackup(b).ok, true);
});

test('parámetros guardados dañados vuelven al valor por defecto y se informa cuáles', () => {
  const def = { campo: 'Mi campo', motivosAjuste: ['A'], mostrarCuitEnInforme: false };
  const r = L.normalizarParametros({ campo: 'San X', motivosAjuste: 'roto', mostrarCuitEnInforme: 'si', porcentajeToros: 4 }, def);
  assert.deepEqual(r.arreglados.sort(), ['mostrarCuitEnInforme', 'motivosAjuste']);
  assert.equal(r.parametros.campo, 'San X');
  assert.deepEqual(r.parametros.motivosAjuste, ['A']);
  assert.equal(r.parametros.mostrarCuitEnInforme, false);
  assert.equal(r.parametros.porcentajeToros, '4');
  assert.deepEqual(L.normalizarParametros(null, def).parametros, def);
});

test('ids con caracteres que podrían romper el HTML se rechazan', () => {
  for (const id of ['a"b', "x' onmouseover='y", '<img>', 'r|c', 'a b', 'x'.repeat(101)]) {
    let b = backupBueno(); b.movimientos[0].id = id; assert.match(errDe(b), /Movimiento 1: falta el identificador o está dañado/, id);
    b = backupBueno(); b.rodeos[0].id = id; assert.match(errDe(b), /Rodeo 1: falta el identificador/, id);
  }
  const b = backupBueno(); b.movimientos[0].id = 'r-1a2b_c.d:e'; assert.equal(L.validarBackup(b).ok, true);
});

test('anulado con fecha inválida o sin motivo se rechaza', () => {
  let b = backupBueno(); b.movimientos[0].anulado = { fecha: 'ayer', motivo: 'x' }; assert.match(errDe(b), /Movimiento 1: la marca de anulado/);
  b = backupBueno(); b.movimientos[0].anulado = { fecha: '2026-11-02T10:00:00.000Z' }; assert.match(errDe(b), /Movimiento 1: la marca de anulado/);
  b = backupBueno(); b.conteos[0].anulado = { fecha: 12, motivo: 'x' }; assert.match(errDe(b), /Conteo 1: la marca de anulado/);
  b = backupBueno(); b.movimientos[0].anulado = { fecha: '2026-11-02T10:00:00.000Z', motivo: 'error' }; assert.equal(L.validarBackup(b).ok, true);
});

test('índice incremental = índice rearmado, y negativos con índice = negativos recorriendo todo', () => {
  let seed = 7; const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  const R = ['A', 'B', 'C'], C = ['vacas', 'terneros', 'toros'];
  const f = () => `2026-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`;
  const nuevo = () => {
    const t = rnd(4); const a = lado(R[rnd(3)], C[rnd(3)]), b = lado(R[rnd(3)], C[rnd(3)]);
    return t === 0 ? mov('nacimiento', f(), 1 + rnd(9), null, a) : t === 1 ? mov('mortandad', f(), 1 + rnd(9), a, null) : mov('traslado', f(), 1 + rnd(9), a, b);
  };
  let movs = Array.from({ length: 300 }, nuevo);
  let idx = L.construirIndice(movs);
  for (let paso = 0; paso < 200; paso++) {
    const agregar = Array.from({ length: 1 + rnd(3) }, nuevo);
    const vivos = movs.filter((m) => !m.anulado);
    const quitar = rnd(3) === 0 && vivos.length ? [vivos[rnd(vivos.length)]] : [];
    const anulados = quitar.map((m) => ({ ...m, anulado: { fecha: '2026-12-01T00:00:00Z', motivo: 'x' } }));
    const porId = new Map(anulados.map((m) => [m.id, m]));
    const despues = movs.map((m) => porId.get(m.id) || m).concat(agregar);
    const negIdx = L.negativosPorCambioIdx(idx, quitar, agregar);
    const negTodo = L.negativosPorCambio(movs, despues, L.clavesDe([...agregar, ...anulados]));
    const orden = (a) => JSON.stringify([...a].sort((x, y) => (x.rodeoId + x.categoriaId < y.rodeoId + y.categoriaId ? -1 : 1)));
    assert.equal(orden(negIdx), orden(negTodo), `paso ${paso}`);
    idx = L.indiceConCambios(idx, quitar, agregar);
    movs = despues;
    const ref = L.construirIndice(movs);
    for (const fecha of [null, '2026-03-15', '2026-07-01', '2026-12-31']) {
      const a = [...idx.stockMapa(fecha)].filter(([, v]) => v !== 0).sort().join(';');
      const b = [...L.calcularStock(movs, fecha)].filter(([, v]) => v !== 0).sort().join(';');
      assert.equal(a, b, `paso ${paso} fecha ${fecha}`);
      for (const k of ref.porClave.keys()) assert.equal(idx.stockA(k, fecha), ref.stockA(k, fecha));
    }
  }
});

test('textos de Datos más largos que el tope: se recortan con aviso, nunca se vacían ni se rechazan', () => {
  const largo = 'Agroganadera '.repeat(40); // 520 caracteres
  // Al importar: un texto largo NO es error; uno que no es texto sí.
  const b = backupBueno(); b.parametros = { empresa: largo, potreros: 'p'.repeat(6000), motivosAjuste: ['m'.repeat(400), ...Array.from({ length: 60 }, (_, i) => 'mot ' + i)] };
  assert.equal(L.validarBackup(b).ok, true, L.validarBackup(b).errores.join(' | '));
  const b2 = backupBueno(); b2.parametros = { empresa: { no: 'texto' } };
  assert.match(L.validarBackup(b2).errores.join(' | '), /Empresa.*tiene que ser un texto/);
  // Normalizar (al importar o al abrir lo guardado): recorta al tope y dice cuánto tenía.
  const def = { empresa: 'Mi campo', potreros: '', motivosAjuste: ['A'] };
  const r = L.normalizarParametros(b.parametros, def);
  assert.equal(r.parametros.empresa, largo.slice(0, 300));
  assert.equal(r.parametros.empresa.length, 300);
  assert.equal(r.parametros.potreros.length, 5000);
  assert.equal(r.parametros.motivosAjuste.length, 50);
  assert.equal(r.parametros.motivosAjuste[0].length, 300);
  assert.deepEqual(r.arreglados, []);
  const txt = r.recortados.map((x) => x.texto).join(' | ');
  assert.match(txt, /"Empresa" tenía 520 caracteres; se guardaron los primeros 300/);
  assert.match(txt, /"Potreros" tenía 6000 caracteres; se guardaron los primeros 5000/);
  assert.match(txt, /"Motivos rápidos de ajuste" tenía 61 renglones; se guardaron los primeros 50/);
  // Lo que entra en el tope no se toca ni se avisa.
  const ok = L.normalizarParametros({ empresa: 'x'.repeat(300) }, def);
  assert.equal(ok.parametros.empresa.length, 300);
  assert.deepEqual(ok.recortados, []);
});

// ---------------- v0.4: modelo SENASA ----------------
import * as SEED from '../app/seeds.js';

const viejoEstado = () => ({
  rodeos: [{ id: 'r-cola', nombre: 'Cola', orden: 1, activo: true }, { id: 'r-cut', nombre: 'CUT', orden: 2, activo: true }, { id: 'r-destetados', nombre: 'Destetados', orden: 3, activo: true }],
  categorias: Object.keys(SEED.MAPEO_V03).map((id, i) => ({ id, nombre: id, orden: i + 1, activa: true, cuentaComoVaca: id === 'c-vacas' })).concat([{ id: 'c-propia', nombre: 'Propia', orden: 20, activa: true }]),
  movimientos: [
    { id: 'm1', fecha: '2026-11-01', tipo: 'saldo_inicial', cantidad: 134, origen: null, destino: { rodeoId: 'r-cola', categoriaId: 'c-vacas' } },
    { id: 'm2', fecha: '2026-11-01', tipo: 'saldo_inicial', cantidad: 99, origen: null, destino: { rodeoId: 'r-cola', categoriaId: 'c-terneros' } },
    { id: 'm3', fecha: '2026-11-01', tipo: 'saldo_inicial', cantidad: 5, origen: null, destino: { rodeoId: 'r-destetados', categoriaId: 'c-mamonesm' } },
    { id: 'm4', fecha: '2026-11-01', tipo: 'saldo_inicial', cantidad: 12, origen: null, destino: { rodeoId: 'r-destetados', categoriaId: 'c-mamonesh' } },
    { id: 'm5', fecha: '2026-11-01', tipo: 'saldo_inicial', cantidad: 3, origen: null, destino: { rodeoId: 'r-cut', categoriaId: 'c-cut' } },
    { id: 'm6', fecha: '2026-11-02', tipo: 'mortandad', cantidad: 2, origen: { rodeoId: 'r-cola', categoriaId: 'c-padres' }, destino: null },
    { id: 'm7', fecha: '2026-11-01', tipo: 'saldo_inicial', cantidad: 4, origen: null, destino: { rodeoId: 'r-cola', categoriaId: 'c-propia' } },
  ],
  conteos: [{ id: 'k1', fecha: '2026-11-01', rodeoId: 'r-cola', categoriaId: 'c-vacas', cantidad: 130 }],
  parametros: { paricionDesde: '', campo: 'X' },
});
const opcionesMig = (extra = {}) => ({
  mapeo: SEED.MAPEO_V03, categoriasNuevas: SEED.CATEGORIAS_INICIALES, rodeosNuevos: SEED.RODEOS_INICIALES, esperadasViejas: SEED.ESPERADAS_V03,
  parametrosNuevos: { paricionDesde: '01/07', servicio: '20/09 al 20/12' }, hoy: '2026-11-03', ahoraIso: '2026-11-03T12:00:00.000Z', ...extra,
});

test('v0.4: detecta el modelo viejo y migra sin reescribir la historia (total igual, categorías nuevas)', () => {
  const e = viejoEstado();
  const nuevas = SEED.CATEGORIAS_INICIALES.map((c) => c.id);
  assert.equal(L.esModeloViejo(e, SEED.MAPEO_V03, nuevas), true);
  const antes = JSON.stringify(e);
  const mg = L.migrarModeloV03(e, opcionesMig());
  assert.equal(JSON.stringify(e), antes, 'no toca el estado recibido');
  assert.equal(mg.limpio, false);
  // la historia vieja queda igual: los primeros 7 movimientos son los mismos
  assert.deepEqual(mg.estado.movimientos.slice(0, 7), e.movimientos);
  const st0 = L.totales(L.calcularStock(e.movimientos)).total, st1 = L.totales(L.calcularStock(mg.estado.movimientos)).total;
  assert.equal(st1, st0, 'el total de cabezas no cambia');
  const s = L.calcularStock(mg.estado.movimientos);
  assert.equal(s.get('r-cola|c-vaca'), 134); assert.equal(s.get('r-cola|c-vacas') || 0, 0);
  assert.equal(s.get('r-cola|c-ternero-ss'), 99);
  assert.equal(s.get('r-destetados|c-ternero'), 5); assert.equal(s.get('r-destetados|c-ternera'), 12);
  assert.equal(s.get('r-cut|c-vaca'), 3, 'CUT (categoría) pasa a Vaca en el rodeo CUT');
  assert.equal(s.get('r-cola|c-propia'), 4, 'una categoría propia del usuario no se toca');
  // negativo: no se pasa y se avisa
  assert.equal(s.get('r-cola|c-padres'), -2);
  assert.equal(mg.avisos.length, 1);
  assert.ok(mg.nuevos.every((m) => m.tipo === 'cambio_categoria' && m.motivo && m.fecha === '2026-11-03' && m.lote === mg.nuevos[0].lote));
  // categorías viejas desactivadas con rastro; nuevas activas según el modelo
  const cv = mg.estado.categorias.find((c) => c.id === 'c-vacas');
  assert.equal(cv.activa, false); assert.equal(cv.reemplazadaPor, 'c-vaca');
  assert.equal(mg.estado.categorias.find((c) => c.id === 'c-propia').activa, true);
  assert.equal(mg.estado.categorias.find((c) => c.id === 'c-vaca').cuentaComoVaca, true);
  // esperadas de los rodeos viejos y parámetros vacíos completados
  assert.deepEqual(mg.estado.rodeos.find((r) => r.id === 'r-destetados').esperadas, ['c-ternero', 'c-ternera']);
  assert.equal(mg.estado.parametros.paricionDesde, '01/07'); assert.equal(mg.estado.parametros.campo, 'X');
  // el resultado es un backup válido y ya no es "modelo viejo"
  const v = L.validarBackup(L.armarBackup(mg.estado, '2026-11-03T12:00:00.000Z'));
  assert.ok(v.ok, v.errores.join('; '));
  assert.equal(L.esModeloViejo(mg.estado, SEED.MAPEO_V03, nuevas), false);
});

test('v0.4: migración con fecha posterior a hoy usa la del último movimiento; sin datos arranca limpio', () => {
  const e = viejoEstado();
  e.movimientos.push({ id: 'm9', fecha: '2026-12-10', tipo: 'nacimiento', cantidad: 1, origen: null, destino: { rodeoId: 'r-cola', categoriaId: 'c-terneros' } });
  const mg = L.migrarModeloV03(e, opcionesMig());
  assert.ok(mg.nuevos.every((m) => m.fecha === '2026-12-10'));
  const vac = { ...viejoEstado(), movimientos: [], conteos: [] };
  const mg2 = L.migrarModeloV03(vac, opcionesMig());
  assert.equal(mg2.limpio, true);
  assert.deepEqual(mg2.estado.categorias.map((c) => c.id), SEED.CATEGORIAS_INICIALES.map((c) => c.id));
  assert.deepEqual(mg2.estado.rodeos.map((r) => r.id), SEED.RODEOS_INICIALES.map((r) => r.id));
});

test('v0.4: caravanas (fase 2) en movimientos y método/lecturas en conteos se validan', () => {
  const base = { id: 'a', fecha: '2026-11-01', tipo: 'mortandad', cantidad: 1, origen: { rodeoId: 'r', categoriaId: 'c' }, destino: null };
  assert.deepEqual(L.validarMovimiento({ ...base, caravanas: ['032010011002541'] }), []);
  assert.ok(L.validarMovimiento({ ...base, caravanas: 'x' }).length);
  assert.ok(L.validarMovimiento({ ...base, caravanas: [{}] }).length);
  const b = L.armarBackup({ rodeos: [{ id: 'r', nombre: 'R', esperadas: ['c'] }], categorias: [{ id: 'c', nombre: 'C', sexo: 'H', bovino: true }], movimientos: [],
    conteos: [{ id: 'k', fecha: '2026-11-01', rodeoId: 'r', categoriaId: 'c', cantidad: 3, metodo: 'bastón', lecturas: ['1', '2', '3'] }], parametros: {} }, '2026-11-01T00:00:00Z');
  assert.ok(L.validarBackup(b).ok);
  assert.deepEqual(b.caravanas, []);
  const mal = structuredClone(b); mal.conteos[0].metodo = 'telepatía';
  assert.match(L.validarBackup(mal).errores.join(' '), /método/);
  const mal2 = structuredClone(b); mal2.categorias[0].sexo = 'X';
  assert.match(L.validarBackup(mal2).errores.join(' '), /sexo/);
  const mal3 = structuredClone(b); mal3.rodeos[0].esperadas = 'c';
  assert.match(L.validarBackup(mal3).errores.join(' '), /esperadas/);
  const mal4 = structuredClone(b); mal4.caravanas = {};
  assert.match(L.validarBackup(mal4).errores.join(' '), /caravanas/);
});

test('v0.4: plantilla Excel de saldo inicial: lee fechas en varios formatos y rechaza celdas malas por fila y columna', () => {
  const rodeos = [{ id: 'r-a', nombre: 'A', activo: true }, { id: 'r-b', nombre: 'B', activo: true }];
  const cats = [{ id: 'c-vaca', nombre: 'Vaca' }, { id: 'c-toro', nombre: 'Toro' }];
  const hoja = (fecha, filasR) => [['Saldo inicial'], ['Fecha', fecha], ['instrucciones'], [], ['Rodeo', 'Vaca', 'Toro', 'rodeo_id (no tocar)'], ['id', 'c-vaca', 'c-toro', 'rodeo_id'], ...filasR];
  let r = L.leerPlantillaSaldo(hoja('03/11/2026', [['A', 10, null, 'r-a'], ['B', '5', 2, 'r-b']]), rodeos, cats);
  assert.ok(r.ok, r.errores?.join(';'));
  assert.equal(r.fecha, '2026-11-03'); assert.equal(r.cabezas, 17); assert.equal(r.renglones.length, 3);
  r = L.leerPlantillaSaldo(hoja(new Date(Date.UTC(2026, 10, 3)), [['A', 1, null, 'r-a']]), rodeos, cats);
  assert.equal(r.fecha, '2026-11-03');
  r = L.leerPlantillaSaldo(hoja(46329, [['A', 1, null, 'r-a']]), rodeos, cats); // serie de Excel
  assert.equal(r.fecha, '2026-11-03');
  r = L.leerPlantillaSaldo(hoja('31/02/2026', [['A', 'diez', -1, 'r-a'], ['X', 1, 1, 'r-x'], ['A', 1, 1, 'r-a']]), rodeos, cats);
  assert.equal(r.ok, false);
  const t = r.errores.join(' | ');
  assert.match(t, /fecha/); assert.match(t, /Fila 7 \(A\), columna Vaca: «diez»/); assert.match(t, /columna Toro/);
  assert.match(t, /rodeo no existe/); assert.match(t, /repetido/);
  r = L.leerPlantillaSaldo(hoja('03/11/2026', [['A', null, null, 'r-a']]), rodeos, cats);
  assert.equal(r.ok, false); assert.match(r.errores[0], /ninguna cantidad/);
  r = L.leerPlantillaSaldo([['cualquier cosa']], rodeos, cats);
  assert.equal(r.ok, false);
});

test('v0.4: atajos del modelo estándar apuntan a categorías y rodeos que existen en la precarga', () => {
  const cIds = new Set(SEED.CATEGORIAS_INICIALES.map((c) => c.id)), rIds = new Set(SEED.RODEOS_INICIALES.map((r) => r.id));
  for (const a of SEED.ATAJOS) for (const f of a.filas) {
    assert.ok(cIds.has(f.catO) && cIds.has(f.cat), `${a.id}: categorías`);
    if (f.rodeo) assert.ok(rIds.has(f.rodeo), `${a.id}: rodeo ${f.rodeo}`);
  }
  // Destete y Tacto son traslados (no cambian la categoría)
  for (const id of ['destete', 'tacto']) assert.ok(SEED.ATAJOS.find((a) => a.id === id).filas.every((f) => f.catO === f.cat));
  // CUT, Vacías y Mamones son rodeos, no categorías
  const nombresCat = SEED.CATEGORIAS_INICIALES.map((c) => c.nombre.toLowerCase());
  for (const n of ['cut', 'vacías', 'mamones']) assert.ok(!nombresCat.includes(n));
  assert.ok(SEED.RODEOS_INICIALES.some((r) => r.id === 'r-cut') && SEED.RODEOS_INICIALES.some((r) => r.id === 'r-mamones'));
});
