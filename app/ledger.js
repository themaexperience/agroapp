// ledger.js — Lógica pura del libro de movimientos.
// Sin DOM ni IndexedDB: corre igual en el navegador y en Node (tests).
// Principio: el stock NUNCA se guarda; siempre es la suma de movimientos no anulados.

export const FORMATO_VERSION = 1;

// Cada tipo dice qué lados usa. "origen" resta, "destino" suma.
export const TIPOS = {
  saldo_inicial:    { nombre: 'Saldo inicial',        origen: false, destino: true  },
  nacimiento:       { nombre: 'Nacimiento',           origen: false, destino: true  },
  ingreso:          { nombre: 'Ingreso / compra',     origen: false, destino: true  },
  mortandad:        { nombre: 'Mortandad',            origen: true,  destino: false },
  venta:            { nombre: 'Venta',                origen: true,  destino: false },
  traslado:         { nombre: 'Traslado',             origen: true,  destino: true  },
  cambio_categoria: { nombre: 'Cambio de categoría',  origen: true,  destino: true  },
  ajuste:           { nombre: 'Ajuste',               origen: 'uno', destino: 'uno' }, // exactamente un lado
};

export const clave = (rodeoId, categoriaId) => rodeoId + '|' + categoriaId;
export const desarmarClave = (k) => { const i = k.indexOf('|'); return { rodeoId: k.slice(0, i), categoriaId: k.slice(i + 1) }; };

export function nuevoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const esFecha = (f) => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f);

// Devuelve lista de errores (vacía = válido).
export function validarMovimiento(m) {
  const e = [];
  if (!m || typeof m !== 'object') return ['Renglón vacío'];
  const t = TIPOS[m.tipo];
  if (!t) return ['Tipo de movimiento desconocido'];
  if (!esFecha(m.fecha)) e.push('Falta la fecha');
  // Única excepción a "cantidad > 0": la confirmación de un conteo (ajuste de 0 vinculado a un conteo, con motivo).
  const confirmacion = m.tipo === 'ajuste' && m.cantidad === 0 && !!m.conteoId;
  if (!Number.isInteger(m.cantidad) || (m.cantidad <= 0 && !confirmacion)) e.push('La cantidad tiene que ser un número entero mayor que cero');
  const okLado = (l) => l && l.rodeoId && l.categoriaId;
  if (m.tipo === 'ajuste') {
    if (!!m.origen === !!m.destino) e.push('El ajuste suma o resta, no las dos cosas');
    if (m.origen && !okLado(m.origen)) e.push('Falta rodeo o categoría');
    if (m.destino && !okLado(m.destino)) e.push('Falta rodeo o categoría');
    if (!m.motivo || !String(m.motivo).trim()) e.push('El ajuste necesita un motivo');
  } else {
    if (t.origen && !okLado(m.origen)) e.push('Falta rodeo o categoría de origen');
    if (t.destino && !okLado(m.destino)) e.push('Falta rodeo o categoría de destino');
    if (!t.origen && m.origen) e.push('Este tipo no lleva origen');
    if (!t.destino && m.destino) e.push('Este tipo no lleva destino');
  }
  if (m.tipo === 'traslado' && m.origen && m.destino) {
    if (m.origen.rodeoId === m.destino.rodeoId) e.push('El traslado tiene que ser a otro rodeo');
    if (m.origen.categoriaId !== m.destino.categoriaId) e.push('En un traslado la categoría no cambia (usá cambio de categoría)');
  }
  if (m.tipo === 'cambio_categoria' && m.origen && m.destino && m.origen.categoriaId === m.destino.categoriaId) {
    e.push('En un cambio de categoría la categoría tiene que ser distinta');
  }
  return e;
}

export const activo = (m) => !m.anulado;

// Aplica un movimiento a un Map de stock (signo +1 aplica, -1 revierte).
function aplicar(mapa, m, signo = 1) {
  if (m.origen) { const k = clave(m.origen.rodeoId, m.origen.categoriaId); mapa.set(k, (mapa.get(k) || 0) - signo * m.cantidad); }
  if (m.destino) { const k = clave(m.destino.rodeoId, m.destino.categoriaId); mapa.set(k, (mapa.get(k) || 0) + signo * m.cantidad); }
}

// Stock por rodeo×categoría a una fecha (inclusive). hasta=null → todo.
// Recorrido único O(n). El orden de los movimientos no importa (suma conmutativa).
export function calcularStock(movimientos, hasta = null) {
  const mapa = new Map();
  for (const m of movimientos) {
    if (m.anulado) continue;
    if (hasta && m.fecha > hasta) continue;
    aplicar(mapa, m);
  }
  return mapa;
}

// Stock a varias fechas en un solo barrido. Devuelve Map fecha → Map stock (copias).
export function stockAFechas(movimientos, fechas) {
  const orden = [...new Set(fechas)].sort();
  const movs = movimientos.filter(activo).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  const res = new Map();
  const mapa = new Map();
  let i = 0;
  for (const f of orden) {
    while (i < movs.length && movs[i].fecha <= f) aplicar(mapa, movs[i++]);
    res.set(f, new Map(mapa));
  }
  return res;
}

// Totales a partir de un Map de stock.
export function totales(mapa) {
  const porRodeo = new Map(), porCategoria = new Map();
  let total = 0;
  for (const [k, v] of mapa) {
    if (!v) continue;
    const { rodeoId, categoriaId } = desarmarClave(k);
    porRodeo.set(rodeoId, (porRodeo.get(rodeoId) || 0) + v);
    porCategoria.set(categoriaId, (porCategoria.get(categoriaId) || 0) + v);
    total += v;
  }
  return { porRodeo, porCategoria, total };
}

// Para cada clave: el mínimo saldo a lo largo del tiempo y la primera fecha en que fue negativo.
// Solo mira las claves pedidas (si se pasan) para no recorrer todo de más.
export function minimosPorClave(movimientos, claves = null) {
  const deltas = new Map(); // clave -> Map fecha -> delta
  const sumar = (k, f, d) => {
    if (claves && !claves.has(k)) return;
    let porFecha = deltas.get(k);
    if (!porFecha) { porFecha = new Map(); deltas.set(k, porFecha); }
    porFecha.set(f, (porFecha.get(f) || 0) + d);
  };
  for (const m of movimientos) {
    if (m.anulado) continue;
    if (m.origen) sumar(clave(m.origen.rodeoId, m.origen.categoriaId), m.fecha, -m.cantidad);
    if (m.destino) sumar(clave(m.destino.rodeoId, m.destino.categoriaId), m.fecha, m.cantidad);
  }
  const res = new Map();
  for (const [k, porFecha] of deltas) {
    const fechas = [...porFecha.keys()].sort();
    let s = 0, min = 0, primeraNegativa = null, saldoEnNegativa = null;
    for (const f of fechas) {
      s += porFecha.get(f);
      if (s < min) min = s;
      if (s < 0 && primeraNegativa === null) { primeraNegativa = f; saldoEnNegativa = s; }
    }
    res.set(k, { min, primeraNegativa, saldoEnNegativa });
  }
  return res;
}

// Claves que toca un conjunto de movimientos.
export function clavesDe(movs) {
  const s = new Set();
  for (const m of movs) {
    if (m.origen) s.add(clave(m.origen.rodeoId, m.origen.categoriaId));
    if (m.destino) s.add(clave(m.destino.rodeoId, m.destino.categoriaId));
  }
  return s;
}

// Compara el libro antes y después de un cambio (alta, anulación o corrección).
// Devuelve las celdas que quedarían negativas (o más negativas) por culpa del cambio,
// mirando la fecha del hecho y todas las posteriores.
export function negativosPorCambio(movsAntes, movsDespues, clavesAfectadas) {
  const antes = minimosPorClave(movsAntes, clavesAfectadas);
  const despues = minimosPorClave(movsDespues, clavesAfectadas);
  const out = [];
  for (const k of clavesAfectadas) {
    const d = despues.get(k);
    if (!d || d.min >= 0) continue;
    const a = antes.get(k);
    if (a && a.min <= d.min) continue; // ya estaba igual o peor: no lo empeora este cambio
    out.push({ ...desarmarClave(k), fecha: d.primeraNegativa, saldo: d.saldoEnNegativa, minimo: d.min });
  }
  return out;
}

// Signo con que un ajuste afecta a su celda.
export const signoAjuste = (m) => (m.destino ? m.cantidad : -m.cantidad);
export const ladoAjuste = (m) => m.destino || m.origen;

// ---- Índice para consultas rápidas ----
// Por cada celda rodeo×categoría: fechas ordenadas y saldo acumulado. "Stock de una celda a una fecha"
// sale por búsqueda binaria: O(log n) en vez de recorrer todo el libro. Se arma una vez por cambio del libro.
export function construirIndice(movimientos) {
  const tmp = new Map();
  const add = (k, f, d) => { let mf = tmp.get(k); if (!mf) { mf = new Map(); tmp.set(k, mf); } mf.set(f, (mf.get(f) || 0) + d); };
  for (const m of movimientos) {
    if (m.anulado) continue;
    if (m.origen) add(clave(m.origen.rodeoId, m.origen.categoriaId), m.fecha, -m.cantidad);
    if (m.destino) add(clave(m.destino.rodeoId, m.destino.categoriaId), m.fecha, m.cantidad);
  }
  const porClave = new Map();
  for (const [k, mf] of tmp) {
    const fechas = [...mf.keys()].sort();
    const acum = new Array(fechas.length);
    let s = 0;
    for (let i = 0; i < fechas.length; i++) { s += mf.get(fechas[i]); acum[i] = s; }
    porClave.set(k, { fechas, acum });
  }
  return {
    porClave,
    stockA(k, f = null) {
      const e = porClave.get(k);
      if (!e) return 0;
      if (f === null) return e.acum[e.acum.length - 1];
      let lo = 0, hi = e.fechas.length - 1, r = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (e.fechas[mid] <= f) { r = mid; lo = mid + 1; } else hi = mid - 1; }
      return r < 0 ? 0 : e.acum[r];
    },
  };
}

// ---- Conteos y diferencias ----
// Regla (decisión D1 del Director): una diferencia nunca desaparece sola.
//   calculado  = stock de la celda a la fecha del conteo, SIN los ajustes vinculados a ese conteo.
//   diferencia = contado − calculado.
//   explicado  = suma de los ajustes vinculados al conteo (una confirmación es un ajuste de 0).
//   pendiente  = diferencia − explicado.
// Estados:
//   sin_explicar          pendiente ≠ 0 y nadie la explicó todavía (rojo)
//   reabierta             pendiente ≠ 0 aunque tiene ajustes vinculados (rojo; p. ej. ajuste + muerte real = doble descuento)
//   cuadra_sin_confirmar  hoy cuadra, pero al contar había diferencia y nadie confirmó la explicación (ámbar)
//   explicada             cuadra y hay una explicación con motivo vinculada
//   cuadra                cuadró desde que se contó
//   anulado               conteo anulado (queda visible, tachado)
export const ROJOS = new Set(['sin_explicar', 'reabierta']);
export const ABIERTOS = new Set(['sin_explicar', 'reabierta', 'cuadra_sin_confirmar']);

export function estadoConteos(conteos, movimientos, idx = null) {
  idx = idx || construirIndice(movimientos);
  const fechaDe = new Map(conteos.map((c) => [c.id, c.fecha]));
  const vinc = new Map();
  for (const m of movimientos) {
    if (m.anulado || m.tipo !== 'ajuste' || !m.conteoId || !fechaDe.has(m.conteoId)) continue;
    let v = vinc.get(m.conteoId);
    if (!v) { v = { ajustes: [], hasta: 0, total: 0 }; vinc.set(m.conteoId, v); }
    const s = signoAjuste(m);
    v.ajustes.push(m); v.total += s;
    if (m.fecha <= fechaDe.get(m.conteoId)) v.hasta += s;
  }
  const vacio = { ajustes: [], hasta: 0, total: 0 };
  return conteos.map((c) => {
    const v = vinc.get(c.id) || vacio;
    const calculado = idx.stockA(clave(c.rodeoId, c.categoriaId), c.fecha) - v.hasta;
    const diferencia = c.cantidad - calculado;
    const explicado = v.total;
    const pendiente = diferencia - explicado;
    const original = typeof c.diferenciaOriginal === 'number' ? c.diferenciaOriginal : null;
    let estado;
    if (c.anulado) estado = 'anulado';
    else if (pendiente !== 0) estado = v.ajustes.length ? 'reabierta' : 'sin_explicar';
    else if (v.ajustes.length) estado = 'explicada';
    else if (original !== null && original !== 0) estado = 'cuadra_sin_confirmar';
    else estado = 'cuadra';
    // Doble descuento: los movimientos reales ya explican todo (diferencia 0) y además hay un ajuste con cantidad.
    const dobleDescuento = estado === 'reabierta' && diferencia === 0 && explicado !== 0;
    return { conteo: c, calculado, diferencia, explicado, pendiente, original, ajustes: v.ajustes, estado, dobleDescuento };
  });
}

// Compatibilidad: solo conteos vivos (no anulados).
export function diferenciasConteo(conteos, movimientos, idx = null) {
  return estadoConteos(conteos.filter((c) => !c.anulado), movimientos, idx);
}

// Diferencia al momento de contar (se guarda en el conteo para que nunca se pierda).
export function diferenciaAlContar(conteo, idx) {
  return conteo.cantidad - idx.stockA(clave(conteo.rodeoId, conteo.categoriaId), conteo.fecha);
}

// Pistas (solo texto) para diferencias en rojo del mismo día: agrupado, O(n).
export function pistas(difs) {
  const abiertas = difs.filter((d) => ROJOS.has(d.estado) && d.pendiente !== 0);
  const porRodeo = new Map(), porCat = new Map();
  const push = (m, k, d) => { let l = m.get(k); if (!l) { l = []; m.set(k, l); } l.push(d); };
  for (const d of abiertas) {
    push(porRodeo, d.conteo.fecha + '|' + d.conteo.rodeoId, d);
    push(porCat, d.conteo.fecha + '|' + d.conteo.categoriaId, d);
  }
  const out = new Map();
  for (const d of abiertas) {
    const lista = [];
    for (const o of porRodeo.get(d.conteo.fecha + '|' + d.conteo.rodeoId)) if (o !== d && o.pendiente === -d.pendiente) lista.push({ tipo: 'categoria', con: o });
    for (const o of porCat.get(d.conteo.fecha + '|' + d.conteo.categoriaId)) if (o !== d && o.pendiente === -d.pendiente) lista.push({ tipo: 'rodeo', con: o });
    out.set(d.conteo.id, lista);
  }
  return out;
}

// Movimientos cargados DESPUÉS del conteo que tocan su celda con fecha ≤ la del conteo:
// son los que hicieron cuadrar una diferencia "sola". Solo para las celdas pedidas.
export function movimientosQueExplican(difs, movimientos) {
  const porClave = new Map();
  for (const d of difs) { const k = clave(d.conteo.rodeoId, d.conteo.categoriaId); let l = porClave.get(k); if (!l) { l = []; porClave.set(k, l); } l.push(d); }
  const out = new Map(difs.map((d) => [d.conteo.id, []]));
  if (!porClave.size) return out;
  for (const m of movimientos) {
    if (m.anulado || (m.tipo === 'ajuste' && m.cantidad === 0)) continue;
    for (const lado of [m.origen, m.destino]) {
      if (!lado) continue;
      const l = porClave.get(clave(lado.rodeoId, lado.categoriaId));
      if (!l) continue;
      for (const d of l) if (m.fecha <= d.conteo.fecha && (m.creado || '') > (d.conteo.creado || '')) out.get(d.conteo.id).push(m);
    }
  }
  return out;
}

// Último día de un mes 'YYYY-MM'.
export function finDeMes(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function mesesEntre(desde, hasta) {
  const out = [];
  let [y, m] = desde.split('-').map(Number);
  const [yh, mh] = hasta.split('-').map(Number);
  while (y < yh || (y === yh && m <= mh)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Historial mensual: stock al último día de cada mes + resumen de movimientos del mes.
export function historialMensual(movimientos, hoy) {
  const vivos = movimientos.filter(activo);
  if (!vivos.length) return [];
  let min = vivos[0].fecha;
  for (const m of vivos) if (m.fecha < min) min = m.fecha;
  const meses = mesesEntre(min.slice(0, 7), hoy.slice(0, 7));
  const fechas = meses.map(finDeMes);
  const stocks = stockAFechas(vivos, fechas);
  const resumen = new Map(meses.map((ym) => [ym, {}]));
  for (const m of vivos) {
    const r = resumen.get(m.fecha.slice(0, 7));
    if (!r) continue;
    const s = m.tipo === 'ajuste' ? signoAjuste(m) : m.cantidad;
    r[m.tipo] = (r[m.tipo] || 0) + s;
  }
  let anterior = null;
  return meses.map((ym, i) => {
    const st = stocks.get(fechas[i]);
    const t = totales(st);
    const fila = { mes: ym, fecha: fechas[i], stock: st, ...t, resumen: resumen.get(ym), variacion: anterior === null ? null : t.total - anterior };
    anterior = t.total;
    return fila;
  });
}

// ---- Backup ----

export function armarBackup(estado, ahoraIso) {
  return {
    app: 'stock-campo-san-jose',
    formato: FORMATO_VERSION,
    exportado: ahoraIso,
    cuentas: {
      rodeos: estado.rodeos.length,
      categorias: estado.categorias.length,
      movimientos: estado.movimientos.length,
      conteos: estado.conteos.length,
    },
    rodeos: estado.rodeos,
    categorias: estado.categorias,
    movimientos: estado.movimientos,
    conteos: estado.conteos,
    parametros: estado.parametros,
  };
}

// Valida un backup leído. Devuelve { ok, errores, estado }.
export function validarBackup(b) {
  const errores = [];
  if (!b || typeof b !== 'object') return { ok: false, errores: ['El archivo no es un backup de esta app'] };
  if (b.app !== 'stock-campo-san-jose') errores.push('El archivo no es un backup de esta app');
  if (typeof b.formato !== 'number' || b.formato > FORMATO_VERSION) errores.push('Versión de backup desconocida');
  for (const k of ['rodeos', 'categorias', 'movimientos', 'conteos']) {
    if (!Array.isArray(b[k])) errores.push(`Falta la lista de ${k}`);
    else if (b.cuentas && b.cuentas[k] !== undefined && b.cuentas[k] !== b[k].length) errores.push(`El archivo dice ${b.cuentas[k]} ${k} pero trae ${b[k].length}: puede estar incompleto`);
  }
  if (errores.length) return { ok: false, errores };
  const rIds = new Set(), cIds = new Set();
  b.rodeos.forEach((r, i) => {
    if (!r || typeof r !== 'object' || !r.id || !String(r.nombre ?? '').trim()) errores.push(`Rodeo ${i + 1}: le falta el nombre o el identificador`);
    else rIds.add(r.id);
  });
  b.categorias.forEach((c, i) => {
    if (!c || typeof c !== 'object' || !c.id || !String(c.nombre ?? '').trim()) errores.push(`Categoría ${i + 1}: le falta el nombre o el identificador`);
    else cIds.add(c.id);
  });
  const existe = (l) => rIds.has(l.rodeoId) && cIds.has(l.categoriaId);
  const ids = new Set();
  b.movimientos.forEach((m, i) => {
    if (!m || typeof m !== 'object') { errores.push(`Movimiento ${i + 1}: renglón vacío`); return; }
    if (ids.has(m.id)) errores.push(`Movimiento repetido (${m.id})`);
    ids.add(m.id);
    const e = validarMovimiento(m);
    if (e.length) errores.push(`Movimiento ${i + 1}: ${e.join(', ')}`);
    else for (const l of [m.origen, m.destino]) if (l && !existe(l)) { errores.push(`Movimiento ${i + 1}: usa un rodeo o categoría que no está en el archivo`); break; }
  });
  const idsC = new Set();
  b.conteos.forEach((c, i) => {
    if (!c || typeof c !== 'object') { errores.push(`Conteo ${i + 1}: renglón vacío`); return; }
    if (!c.id || idsC.has(c.id)) errores.push(`Conteo ${i + 1}: identificador vacío o repetido`);
    idsC.add(c.id);
    if (!esFecha(c.fecha)) errores.push(`Conteo ${i + 1}: falta la fecha`);
    if (!Number.isInteger(c.cantidad) || c.cantidad < 0) errores.push(`Conteo ${i + 1}: la cantidad contada tiene que ser un número entero`);
    if (!existe(c)) errores.push(`Conteo ${i + 1}: usa un rodeo o categoría que no está en el archivo`);
  });
  if (errores.length > 20) errores.splice(20, errores.length, 'y hay más errores');
  return {
    ok: errores.length === 0,
    errores,
    estado: { rodeos: b.rodeos, categorias: b.categorias, movimientos: b.movimientos, conteos: b.conteos, parametros: b.parametros || {} },
  };
}

// Huella del stock para comparar instalaciones (criterio 7).
export function huellaStock(movimientos) {
  const st = calcularStock(movimientos);
  return [...st.entries()].filter(([, v]) => v !== 0).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(';');
}
