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
  assert.equal(d.estado, 'reabierta'); assert.equal(d.pendiente, -1); assert.equal(d.calculado, 68);
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
