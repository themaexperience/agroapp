// ledger.js — Lógica pura del libro de movimientos.
// Sin DOM ni IndexedDB: corre igual en el navegador y en Node (tests).
// Principio: el stock NUNCA se guarda; siempre es la suma de movimientos no anulados.

// 1 = v0.1–v0.3 (categorías del papel). 2 = v0.4 (categorías SENASA; listo para caravanas de la fase 2).
export const FORMATO_VERSION = 2;

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

// Fecha aaaa-mm-dd que existe en el calendario (rechaza 2026-02-30 o 2026-13-01).
const esFecha = (f) => {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const [a, m, d] = f.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

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
  if (!listaCaravanasOk(m.caravanas)) e.push('La lista de caravanas está dañada');
  return e;
}

// Fase 2 (caravanas): lista opcional de números de caravana (texto). Todavía no tiene pantallas.
export const MAX_CARAVANAS = 5000, MAX_LARGO_CARAVANA = 40;
export const listaCaravanasOk = (x) => x === undefined || x === null
  || (Array.isArray(x) && x.length <= MAX_CARAVANAS && x.every((c) => typeof c === 'string' && c.trim() !== '' && c.length <= MAX_LARGO_CARAVANA));
// Cómo se contó (fase 2). El texto libre de siempre sigue en conteo.origen.
export const METODOS_CONTEO = ['a ojo', 'manga', 'bastón'];

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
  const deltas = new Map(); // clave -> Map fecha -> delta del día
  for (const m of movimientos) if (!m.anulado) sumarMov(deltas, m, 1);
  const porClave = new Map();
  for (const [k, mf] of deltas) porClave.set(k, entradaDesde(mf));
  return indiceDesde(porClave);
}

// Suma (signo +1) o resta (−1) un movimiento en un Map clave -> Map fecha -> delta.
function sumarMov(deltas, m, signo) {
  const add = (k, d) => { let mf = deltas.get(k); if (!mf) { mf = new Map(); deltas.set(k, mf); } mf.set(m.fecha, (mf.get(m.fecha) || 0) + d); };
  if (m.origen) add(clave(m.origen.rodeoId, m.origen.categoriaId), -signo * m.cantidad);
  if (m.destino) add(clave(m.destino.rodeoId, m.destino.categoriaId), signo * m.cantidad);
}

// Entrada de una celda: fechas ordenadas, saldo acumulado a cada fecha, y el mínimo (para avisar negativos).
function entradaDesde(mf) {
  const fechas = [...mf.keys()].sort();
  const acum = new Array(fechas.length);
  let s = 0, min = 0, primeraNegativa = null, saldoEnNegativa = null;
  for (let i = 0; i < fechas.length; i++) {
    s += mf.get(fechas[i]); acum[i] = s;
    if (s < min) min = s;
    if (s < 0 && primeraNegativa === null) { primeraNegativa = fechas[i]; saldoEnNegativa = s; }
  }
  return { deltas: mf, fechas, acum, min, primeraNegativa, saldoEnNegativa };
}

function indiceDesde(porClave) {
  return {
    porClave,
    stockA(k, f = null) {
      const e = porClave.get(k);
      if (!e) return 0;
      const r = posHasta(e, f);
      return r < 0 ? 0 : e.acum[r];
    },
    // Stock de todas las celdas a una fecha (mismo resultado que calcularStock, sin recorrer los movimientos).
    stockMapa(f = null) {
      const mapa = new Map();
      for (const [k, e] of porClave) { const r = posHasta(e, f); if (r >= 0) mapa.set(k, e.acum[r]); }
      return mapa;
    },
  };
}
function posHasta(e, f) {
  if (f === null || f === undefined) return e.fechas.length - 1;
  let lo = 0, hi = e.fechas.length - 1, r = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (e.fechas[mid] <= f) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}

// Celdas afectadas por un cambio (quitar: movimientos que dejan de contar; agregar: los nuevos), recalculadas
// a partir del índice actual sin recorrer todo el libro. Devuelve Map clave -> entrada nueva.
function entradasCambiadas(idx, quitar, agregar) {
  const tocadas = new Map();
  const copia = (k) => { let mf = tocadas.get(k); if (!mf) { mf = new Map(idx.porClave.get(k)?.deltas || []); tocadas.set(k, mf); } return mf; };
  const aplicarA = (m, signo) => {
    for (const [lado, sg] of [[m.origen, -1], [m.destino, 1]]) {
      if (!lado) continue;
      const mf = copia(clave(lado.rodeoId, lado.categoriaId));
      mf.set(m.fecha, (mf.get(m.fecha) || 0) + sg * signo * m.cantidad);
    }
  };
  for (const m of quitar) if (!m.anulado) aplicarA(m, -1);
  for (const m of agregar) if (!m.anulado) aplicarA(m, 1);
  const res = new Map();
  for (const [k, mf] of tocadas) { for (const [f, d] of mf) if (d === 0) mf.delete(f); res.set(k, entradaDesde(mf)); }
  return res;
}

// Índice nuevo después de un cambio (comparte las celdas que no cambiaron). El índice viejo no se toca.
export function indiceConCambios(idx, quitar, agregar) {
  const porClave = new Map(idx.porClave);
  for (const [k, e] of entradasCambiadas(idx, quitar, agregar)) { if (e.fechas.length) porClave.set(k, e); else porClave.delete(k); }
  return indiceDesde(porClave);
}

// Igual que negativosPorCambio, pero usando el índice: solo mira las celdas que el cambio toca.
export function negativosPorCambioIdx(idx, quitar, agregar) {
  const out = [];
  for (const [k, d] of entradasCambiadas(idx, quitar, agregar)) {
    if (d.min >= 0) continue;
    const a = idx.porClave.get(k);
    if (a && a.min <= d.min) continue; // ya estaba igual o peor: no lo empeora este cambio
    out.push({ ...desarmarClave(k), fecha: d.primeraNegativa, saldo: d.saldoEnNegativa, minimo: d.min });
  }
  return out;
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
export const ROJOS = new Set(['sin_explicar', 'reabierta', 'a_revisar']);
export const ABIERTOS = new Set(['sin_explicar', 'reabierta', 'a_revisar', 'cuadra_sin_confirmar']);
//   a_revisar             conteo viejo (backup v0.1) sin diferencia original conocida y que hoy cuadra: no se sabe
//                         si al contar había diferencia, así que nunca se muestra verde hasta confirmarlo (rojo)
// "Reabierta" solo si alguna vez estuvo cerrada: hubo una confirmación, o los ajustes vinculados llegaron a cubrir
// toda la diferencia original. Un ajuste parcial (−1 sobre −4) no cierra nada: sigue "sin explicar".
// Una confirmación guarda qué movimientos confirmó (extra.confirma). Si alguno se anula, o se corrige cambiando el
// hecho (fecha, tipo, lugar o cantidad), esa confirmación ya no vale: hay que volver a confirmar. Corregir solo la
// nota o la caravana no la invalida. Las confirmaciones anteriores a la última quedan como "reemplazadas".

export function estadoConteos(conteos, movimientos, idx = null) {
  idx = idx || construirIndice(movimientos);
  const fechaDe = new Map(conteos.map((c) => [c.id, c.fecha]));
  const vinc = new Map();
  const anulados = new Set();
  for (const m of movimientos) {
    if (m.anulado) { anulados.add(m.id); continue; }
    if (m.tipo !== 'ajuste' || !m.conteoId || !fechaDe.has(m.conteoId)) continue;
    let v = vinc.get(m.conteoId);
    if (!v) { v = { ajustes: [], hasta: 0, total: 0, conCantidad: 0, confirmaciones: [] }; vinc.set(m.conteoId, v); }
    const s = signoAjuste(m);
    v.ajustes.push(m); v.total += s;
    if (m.cantidad !== 0) v.conCantidad += s; else v.confirmaciones.push(m);
    if (m.fecha <= fechaDe.get(m.conteoId)) v.hasta += s;
  }
  const vacio = { ajustes: [], hasta: 0, total: 0, conCantidad: 0, confirmaciones: [] };
  // Qué pasó con cada movimiento que una confirmación dio por bueno. Corregir anula el renglón y crea otro
  // (corrigeA): si el nuevo dice el mismo hecho (fecha, tipo, lugar y cantidad; cambió solo nota o caravana),
  // la confirmación sigue valiendo. Si cambió el hecho, "se corrigió"; si se anuló sin reemplazo, "se anuló".
  const porId = new Map();
  const correccionDe = new Map();
  for (const m of movimientos) { porId.set(m.id, m); if (m.corrigeA) correccionDe.set(m.corrigeA, m); }
  const lugarIgual = (a, b) => (a?.rodeoId ?? null) === (b?.rodeoId ?? null) && (a?.categoriaId ?? null) === (b?.categoriaId ?? null);
  const mismoHecho = (a, b) => a.fecha === b.fecha && a.tipo === b.tipo && a.cantidad === b.cantidad
    && lugarIgual(a.origen, b.origen) && lugarIgual(a.destino, b.destino);
  const suerte = (id) => {
    for (let n = 0; n < 100; n++) {
      const m = porId.get(id);
      if (!m) return 'anulado';
      if (!m.anulado) return 'ok';
      const nuevo = correccionDe.get(id);
      if (!nuevo) return 'anulado';
      if (!mismoHecho(m, nuevo)) return 'corregido';
      id = nuevo.id;
    }
    return 'anulado';
  };
  // Validez de cada confirmación: { vale, razon } con razon 'anulado' | 'corregido' | 'reemplazada' | null.
  const validarConfirmaciones = (v) => {
    const orden = [...v.confirmaciones].sort((a, b) => ((a.creado || '') < (b.creado || '') ? -1 : (a.creado || '') > (b.creado || '') ? 1 : 0));
    const res = new Map();
    orden.forEach((cf, i) => {
      const ids = cf.extra && Array.isArray(cf.extra.confirma) ? cf.extra.confirma : [];
      let razon = null;
      for (const id of ids) { const r = suerte(id); if (r !== 'ok') { razon = r; if (r === 'anulado') break; } }
      if (!razon && i < orden.length - 1) razon = 'reemplazada';
      res.set(cf.id, { vale: !razon, razon });
    });
    return { res, ultima: orden.length ? orden[orden.length - 1] : null };
  };
  return conteos.map((c) => {
    const v = vinc.get(c.id) || vacio;
    const calculado = idx.stockA(clave(c.rodeoId, c.categoriaId), c.fecha) - v.hasta;
    const diferencia = c.cantidad - calculado;
    const explicado = v.total;
    const pendiente = diferencia - explicado;
    const original = typeof c.diferenciaOriginal === 'number' ? c.diferenciaOriginal : null;
    const base = original !== null ? original : diferencia;
    const cubierta = base !== 0 && Math.sign(v.conCantidad) === Math.sign(base) && Math.abs(v.conCantidad) >= Math.abs(base);
    const estuvoCerrada = v.confirmaciones.length > 0 || cubierta;
    const val = validarConfirmaciones(v);
    const vigente = !!val.ultima && val.res.get(val.ultima.id).vale;
    let estado;
    if (c.anulado) estado = 'anulado';
    else if (pendiente !== 0) estado = estuvoCerrada ? 'reabierta' : 'sin_explicar';
    else if (v.conCantidad !== 0) estado = 'explicada';
    else if (v.confirmaciones.length && vigente) estado = 'explicada';
    else if (v.confirmaciones.length) estado = 'cuadra_sin_confirmar'; // la confirmación anterior quedó vieja
    else if (original !== null && original !== 0) estado = 'cuadra_sin_confirmar';
    else if (original === null && c.aRevisar) estado = 'a_revisar';
    else estado = 'cuadra';
    // Doble descuento: los movimientos reales ya explican todo (diferencia 0) y además hay un ajuste con cantidad.
    const dobleDescuento = estado === 'reabierta' && diferencia === 0 && v.conCantidad !== 0;
    const confirmacionVieja = v.confirmaciones.length > 0 && !vigente;
    const razonVieja = confirmacionVieja ? val.res.get(val.ultima.id).razon : null;
    return { conteo: c, calculado, diferencia, explicado, pendiente, original, ajustes: v.ajustes, estado, dobleDescuento,
      confirmacionVieja, razonVieja, validezConfirmaciones: val.res };
  });
}

// Conteos de backups viejos (v0.1) no guardaban la diferencia del momento de contar. Se reconstruye con los
// movimientos que ya estaban cargados cuando se contó (campo "creado"): fecha ≤ la del conteo, creados antes
// que el conteo y no anulados todavía en ese momento. Si falta el dato para reconstruirla, el conteo queda
// "a revisar" (rojo): nunca se da por bueno sin saber. Devuelve { conteos, cambiados }.
export function migrarConteos(conteos, movimientos) {
  const pend = conteos.filter((c) => c && typeof c.diferenciaOriginal !== 'number' && !c.aRevisar);
  if (!pend.length) return { conteos, cambiados: [] };
  const porClave = new Map();
  for (const c of pend) { const k = clave(c.rodeoId, c.categoriaId); let l = porClave.get(k); if (!l) { l = []; porClave.set(k, l); } l.push(c); }
  const calc = new Map(pend.map((c) => [c.id, 0]));
  const sinDato = new Set();
  for (const m of movimientos) {
    if (m.tipo === 'ajuste' && m.cantidad === 0) continue;
    for (const [lado, signo] of [[m.origen, -1], [m.destino, 1]]) {
      if (!lado) continue;
      const l = porClave.get(clave(lado.rodeoId, lado.categoriaId));
      if (!l) continue;
      for (const c of l) {
        if (m.fecha > c.fecha) continue;
        if (m.conteoId === c.id) continue;
        if (!m.creado || !c.creado) { sinDato.add(c.id); continue; }
        if (m.creado > c.creado) continue;                                   // se cargó después de contar
        if (m.anulado && (!m.anulado.fecha || m.anulado.fecha <= c.creado)) continue; // ya estaba anulado al contar
        calc.set(c.id, calc.get(c.id) + signo * m.cantidad);
      }
    }
  }
  const cambiados = [];
  const porId = new Map();
  for (const c of pend) {
    const n = { ...c };
    if (!c.creado || sinDato.has(c.id)) n.aRevisar = true;
    else { n.calculadoAlContar = calc.get(c.id); n.diferenciaOriginal = c.cantidad - n.calculadoAlContar; }
    cambiados.push(n); porId.set(c.id, n);
  }
  return { conteos: conteos.map((c) => porId.get(c?.id) || c), cambiados };
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
// Un solo recorrido del libro: se agrupan los cambios por mes y después se acumulan mes a mes (sin ordenar los movimientos).
export function historialMensual(movimientos, hoy) {
  let min = null;
  const deltas = new Map(); // 'YYYY-MM' -> Map clave -> delta
  const resumen = new Map();
  const tope = hoy.slice(0, 7);
  for (const m of movimientos) {
    if (m.anulado) continue;
    const ym = m.fecha.slice(0, 7);
    if (min === null || m.fecha < min) min = m.fecha;
    if (ym > tope) continue;
    let d = deltas.get(ym);
    if (!d) { d = new Map(); deltas.set(ym, d); resumen.set(ym, {}); }
    if (m.origen) { const k = clave(m.origen.rodeoId, m.origen.categoriaId); d.set(k, (d.get(k) || 0) - m.cantidad); }
    if (m.destino) { const k = clave(m.destino.rodeoId, m.destino.categoriaId); d.set(k, (d.get(k) || 0) + m.cantidad); }
    const r = resumen.get(ym);
    const s = m.tipo === 'ajuste' ? signoAjuste(m) : m.cantidad;
    r[m.tipo] = (r[m.tipo] || 0) + s;
  }
  if (min === null) return [];
  const meses = mesesEntre(min.slice(0, 7), tope);
  const mapa = new Map();
  let anterior = null;
  return meses.map((ym) => {
    const d = deltas.get(ym);
    if (d) for (const [k, v] of d) mapa.set(k, (mapa.get(k) || 0) + v);
    const st = new Map(mapa);
    const t = totales(st);
    const fila = { mes: ym, fecha: finDeMes(ym), stock: st, ...t, resumen: resumen.get(ym) || {}, variacion: anterior === null ? null : t.total - anterior };
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
    caravanas: [], // fase 2: registro de caravanas por rodeo (todavía vacío)
  };
}

// Valida un backup leído ANTES de tocar la base. Devuelve { ok, errores, total, estado }.
// Revisa todo lo que la base necesita para guardar sin fallar a mitad de camino (identificadores de texto,
// no vacíos y únicos) y todo lo que la lógica necesita para que el stock tenga sentido (tipos, cantidades,
// fechas, referencias a rodeos y categorías, vínculos entre renglones). Si hay problemas, no se escribe nada.
// Se informan los primeros MAX_ERRORES, en castellano, diciendo qué renglón y por qué.
export const MAX_ERRORES = 5;
// Identificador: solo letras, números y _ . : - (así nunca puede romper el HTML ni la clave rodeo|categoría).
const RE_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const esId = (x) => typeof x === 'string' && RE_ID.test(x);
// Fecha y hora ISO (marcas de anulado, creado, etc.).
export const esFechaHora = (x) => typeof x === 'string' && x.length <= 40 && !Number.isNaN(Date.parse(x));

// Esquema de parámetros: tipo de cada uno. Lo desconocido se acepta solo si es texto, número o sí/no.
export const ESQUEMA_PARAMETROS = {
  empresa: 'texto', campo: 'texto', localidad: 'texto', renspa: 'texto', cuit: 'texto',
  mostrarCuitEnInforme: 'si_no',
  vacasDeclaradas: 'texto', paricionDesde: 'texto', paricionHasta: 'texto', porcentajeToros: 'texto',
  queEsEnfrente: 'texto', potreros: 'texto_largo', motivosAjuste: 'lista',
  servicio: 'texto', inseminacion: 'texto', tacto: 'texto', destete: 'texto', yerra: 'texto',
  paseTerneros: 'texto', paseToro: 'texto', entoreVaquillonas: 'texto',
};
export const MAX_TEXTO = 300, MAX_TEXTO_LARGO = 5000, MAX_LISTA = 50;
// Ajusta un parámetro a su tipo. Lo que es del tipo correcto pero demasiado largo se RECORTA (nunca se vacía):
// devuelve { ok, valor, recorte } con recorte = { de, a } (caracteres o renglones) si hubo que cortar.
// Recorta un texto a "max" unidades sin partir un carácter doble (emoji): si el corte cae en el medio, corta uno antes.
export function recortarTexto(txt, max) {
  if (txt.length <= max) return txt;
  const c = txt.charCodeAt(max - 1);
  return txt.slice(0, c >= 0xD800 && c <= 0xDBFF ? max - 1 : max);
}
export function ajustarParametro(tipo, v) {
  const corta = (txt, max) => (txt.length > max ? { valor: recortarTexto(txt, max), recorte: { de: txt.length, a: max } } : { valor: txt, recorte: null });
  if (tipo === 'texto') {
    if (typeof v === 'number' && Number.isFinite(v)) return { ok: true, ...corta(String(v), MAX_TEXTO) };
    if (typeof v === 'string') return { ok: true, ...corta(v, MAX_TEXTO) };
    return { ok: false };
  }
  if (tipo === 'texto_largo') return typeof v === 'string' ? { ok: true, ...corta(v, MAX_TEXTO_LARGO) } : { ok: false };
  if (tipo === 'si_no') return typeof v === 'boolean' ? { ok: true, valor: v, recorte: null } : { ok: false };
  if (tipo === 'lista') {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return { ok: false };
    const limpios = v.filter((x) => x.trim() !== '');
    let recorte = null;
    const items = limpios.slice(0, MAX_LISTA).map((x) => {
      if (x.length > MAX_TEXTO) { recorte = { de: x.length, a: MAX_TEXTO }; return recortarTexto(x, MAX_TEXTO); }
      return x;
    });
    if (limpios.length > MAX_LISTA) recorte = { de: limpios.length, a: MAX_LISTA, renglones: true };
    return { ok: true, valor: items, recorte };
  }
  // Parámetro desconocido: texto, número o sí/no.
  if (typeof v === 'string') return { ok: true, ...corta(v, MAX_TEXTO_LARGO) };
  if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return { ok: true, valor: v, recorte: null };
  return { ok: false };
}
const NOMBRE_TIPO = { texto: 'un texto', texto_largo: 'un texto', si_no: 'sí o no', lista: 'una lista de textos' };
// Nombre legible de cada parámetro, para los avisos.
export const NOMBRE_PARAMETRO = {
  empresa: 'Empresa', campo: 'Campo', localidad: 'Localidad', renspa: 'RENSPA', cuit: 'CUIT',
  mostrarCuitEnInforme: 'Mostrar CUIT en el informe', vacasDeclaradas: 'Vacas declaradas',
  paricionDesde: 'Parición desde', paricionHasta: 'Parición hasta', porcentajeToros: '% de toros',
  queEsEnfrente: 'Qué es "Enfrente"', potreros: 'Potreros', motivosAjuste: 'Motivos rápidos de ajuste',
  servicio: 'Servicio', inseminacion: 'Inseminación', tacto: 'Tacto', destete: 'Destete', yerra: 'Yerra',
  paseTerneros: 'Pase de terneros', paseToro: 'Pase a toro', entoreVaquillonas: 'Entore de vaquillonas',
};
const nombreParam = (k) => NOMBRE_PARAMETRO[k] || String(k).slice(0, 40);
// Texto del aviso de un recorte: "El membrete tenía N caracteres; se guardaron los primeros 300".
export function textoRecorte(k, r) {
  return r.renglones
    ? `"${nombreParam(k)}" tenía ${r.de} renglones; se guardaron los primeros ${r.a}`
    : `"${nombreParam(k)}" tenía ${r.de} caracteres; se guardaron los primeros ${r.a}`;
}
// Errores de TIPO en los parámetros de un backup (vacío = válidos). Lo largo no es error: se recorta.
export function erroresParametros(P) {
  const errs = [];
  for (const [k, v] of Object.entries(P)) {
    if (v === null || v === undefined) continue;
    const tipo = ESQUEMA_PARAMETROS[k];
    if (!ajustarParametro(tipo, v).ok) errs.push(`Parámetro "${nombreParam(k)}": tiene que ser ${NOMBRE_TIPO[tipo] || 'un texto, un número o sí/no'}`);
  }
  return errs;
}
// Parámetros guardados o importados: lo de tipo incorrecto vuelve al valor por defecto (la app nunca queda inutilizable)
// y lo demasiado largo se recorta al tope (nunca se pierde lo escrito). Ambos se informan.
export function normalizarParametros(P, defectos) {
  const out = { ...defectos }, arreglados = [], recortados = [];
  for (const [k, v] of Object.entries(esObj(P) ? P : {})) {
    if (v === null || v === undefined) continue;
    const a = ajustarParametro(ESQUEMA_PARAMETROS[k], v);
    if (!a.ok) { arreglados.push(k); continue; }
    out[k] = a.valor;
    if (a.recorte) recortados.push({ clave: k, ...a.recorte, texto: textoRecorte(k, a.recorte) });
  }
  return { parametros: out, arreglados, recortados };
}
const esObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const TANDA_VALIDAR = 2000;
function* validarGen(b) {
  const errores = [];
  const err = (t) => errores.push(t);
  const salida = () => {
    const total = errores.length;
    const lista = errores.slice(0, MAX_ERRORES);
    if (total > MAX_ERRORES) lista.push(`y ${total - MAX_ERRORES} problema${total - MAX_ERRORES === 1 ? '' : 's'} más`);
    return { ok: total === 0, errores: lista, total, estado: null };
  };
  if (!esObj(b)) return { ok: false, errores: ['El archivo no es un backup de esta app'], total: 1, estado: null };
  if (b.app !== 'stock-campo-san-jose') err('El archivo no es un backup de esta app');
  if (typeof b.formato !== 'number' || b.formato > FORMATO_VERSION) err('Versión de backup desconocida');
  for (const k of ['rodeos', 'categorias', 'movimientos', 'conteos']) {
    if (!Array.isArray(b[k])) err(`Falta la lista de ${k}`);
    else if (b.cuentas && b.cuentas[k] !== undefined && b.cuentas[k] !== b[k].length) err(`El archivo dice ${b.cuentas[k]} ${k} pero trae ${b[k].length}: puede estar incompleto`);
  }
  if (b.caravanas !== undefined && b.caravanas !== null && !Array.isArray(b.caravanas)) err('La lista de caravanas del archivo está dañada');
  if (b.parametros !== undefined && b.parametros !== null && !esObj(b.parametros)) err('Los parámetros del archivo están dañados');
  else if (esObj(b.parametros)) for (const e of erroresParametros(b.parametros)) err(e);
  if (errores.length) return salida();

  // Identificador: texto no vacío y sin repetir dentro de su lista.
  const chequearId = (x, nombre, vistos) => {
    if (!esId(x.id)) { err(`${nombre}: falta el identificador o está dañado`); return false; }
    if (vistos.has(x.id)) { err(`${nombre}: el identificador ${x.id} está repetido`); return false; }
    vistos.add(x.id); return true;
  };
  const anuladoOk = (a) => a === undefined || a === null || (esObj(a) && esFechaHora(a.fecha) && typeof a.motivo === 'string');

  const rIds = new Set(), cIds = new Set();
  for (let i = 0; i < b.rodeos.length; i++) {
    if (i % TANDA_VALIDAR === TANDA_VALIDAR - 1) yield;
    const r = b.rodeos[i];
    const n = `Rodeo ${i + 1}`;
    if (!esObj(r)) { err(`${n}: renglón vacío o dañado`); continue; }
    chequearId(r, n, rIds);
    if (typeof r.nombre !== 'string' || !r.nombre.trim()) err(`${n}: le falta el nombre`);
    if (r.esperadas !== undefined && r.esperadas !== null && !(Array.isArray(r.esperadas) && r.esperadas.length <= 200 && r.esperadas.every(esId))) err(`${n}: la lista de categorías esperadas está dañada`);
  }
  for (let i = 0; i < b.categorias.length; i++) {
    if (i % TANDA_VALIDAR === TANDA_VALIDAR - 1) yield;
    const c = b.categorias[i];
    const n = `Categoría ${i + 1}`;
    if (!esObj(c)) { err(`${n}: renglón vacío o dañado`); continue; }
    chequearId(c, n, cIds);
    if (typeof c.nombre !== 'string' || !c.nombre.trim()) err(`${n}: le falta el nombre`);
    if (c.sexo !== undefined && c.sexo !== null && !['H', 'M', '?', ''].includes(c.sexo)) err(`${n}: el sexo tiene que ser H, M o ? (sin sexar)`);
    if (c.bovino !== undefined && c.bovino !== null && typeof c.bovino !== 'boolean') err(`${n}: "bovino" tiene que ser sí o no`);
    if (c.senasa !== undefined && c.senasa !== null && (typeof c.senasa !== 'string' || c.senasa.length > MAX_TEXTO)) err(`${n}: la equivalencia SENASA tiene que ser un texto`);
    if (c.reemplazadaPor !== undefined && c.reemplazadaPor !== null && !esId(c.reemplazadaPor)) err(`${n}: la categoría que la reemplaza está dañada`);
  }
  const lugarOk = (l) => esObj(l) && rIds.has(l.rodeoId) && cIds.has(l.categoriaId);

  // Conteos primero: los movimientos pueden apuntar a ellos (conteoId).
  const idsC = new Set();
  for (let i = 0; i < b.conteos.length; i++) {
    if (i % TANDA_VALIDAR === TANDA_VALIDAR - 1) yield;
    const c = b.conteos[i];
    const n = `Conteo ${i + 1}`;
    if (!esObj(c)) { err(`${n}: renglón vacío o dañado`); continue; }
    chequearId(c, n, idsC);
    if (!esFecha(c.fecha)) err(`${n}: la fecha falta o no es válida`);
    if (!Number.isInteger(c.cantidad) || c.cantidad < 0) err(`${n}: la cantidad contada tiene que ser un número entero (0 o más)`);
    if (!lugarOk(c)) err(`${n}: usa un rodeo o una categoría que no está en el archivo`);
    if (!anuladoOk(c.anulado)) err(`${n}: la marca de anulado está dañada`);
    if (c.metodo !== undefined && c.metodo !== null && c.metodo !== '' && !METODOS_CONTEO.includes(c.metodo)) err(`${n}: el método de conteo tiene que ser ${METODOS_CONTEO.join(', ')}`);
    if (!listaCaravanasOk(c.lecturas)) err(`${n}: la lista de lecturas de caravanas está dañada`);
  }

  const idsM = new Set();
  for (let i = 0; i < b.movimientos.length; i++) {
    if (i % TANDA_VALIDAR === TANDA_VALIDAR - 1) yield;
    const m = b.movimientos[i];
    const n = `Movimiento ${i + 1}`;
    if (!esObj(m)) { err(`${n}: renglón vacío o dañado`); continue; }
    chequearId(m, n, idsM);
    const e = validarMovimiento(m);
    if (e.length) err(`${n}: ${e.join(', ').toLowerCase()}`);
    else for (const l of [m.origen, m.destino]) if (l && !lugarOk(l)) { err(`${n}: usa un rodeo o una categoría que no está en el archivo`); break; }
    if (!anuladoOk(m.anulado)) err(`${n}: la marca de anulado está dañada`);
    if (m.extra !== undefined && m.extra !== null && !esObj(m.extra)) err(`${n}: los datos extra están dañados`);
  }
  // Vínculos entre renglones: tienen que apuntar a algo que existe en el archivo (en la app nada se borra).
  for (let i = 0; i < b.movimientos.length; i++) {
    if (i % TANDA_VALIDAR === TANDA_VALIDAR - 1) yield;
    const m = b.movimientos[i];
    if (!esObj(m)) continue;
    const n = `Movimiento ${i + 1}`;
    if (m.conteoId !== undefined && m.conteoId !== null && !idsC.has(m.conteoId)) err(`${n}: está vinculado a un conteo que no está en el archivo`);
    if (m.corrigeA !== undefined && m.corrigeA !== null && !idsM.has(m.corrigeA)) err(`${n}: corrige un movimiento que no está en el archivo`);
    const conf = esObj(m.extra) ? m.extra.confirma : undefined;
    if (conf !== undefined) {
      if (!Array.isArray(conf)) err(`${n}: la lista de movimientos confirmados está dañada`);
      else if (conf.some((id) => !idsM.has(id))) err(`${n}: confirma un movimiento que no está en el archivo`);
    }
  }
  if (errores.length) return salida();
  return {
    ok: true, errores: [], total: 0,
    estado: { rodeos: b.rodeos, categorias: b.categorias, movimientos: b.movimientos, conteos: b.conteos, parametros: b.parametros || {} },
  };
}

// Versión de un tirón (pruebas, Node).
export function validarBackup(b) {
  const g = validarGen(b);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

// Versión que cede el hilo cada TANDA_VALIDAR renglones, para no congelar la pantalla con 20.000 movimientos.
export async function validarBackupEnTandas(b, ceder) {
  const g = validarGen(b);
  let r = g.next();
  while (!r.done) { await ceder(); r = g.next(); }
  return r.value;
}

// Huella del stock para comparar instalaciones (criterio 7).
export function huellaStock(movimientos) {
  const st = calcularStock(movimientos);
  return [...st.entries()].filter(([, v]) => v !== 0).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(';');
}

// ---- Migración del modelo v0.3 (categorías del papel) al v0.4 (categorías SENASA) ----
// ¿El estado usa todavía las categorías de la v0.3? (tiene alguna de las viejas y ninguna de las nuevas)
export function esModeloViejo(estado, mapeo, nuevasIds) {
  const ids = new Set(estado.categorias.map((c) => c.id));
  return Object.keys(mapeo).some((id) => ids.has(id)) && !nuevasIds.some((id) => ids.has(id));
}

// Devuelve un estado nuevo (no toca el recibido). Nunca reescribe la historia:
// - Sin movimientos ni conteos: arranca limpio con la plantilla nueva.
// - Con datos: agrega las categorías nuevas, desactiva las viejas que tienen equivalente, y pasa el stock de cada
//   casilla vieja a la nueva con un renglón de "cambio de categoría" (fecha: hoy o la del último movimiento, si es
//   posterior), con motivo y lote. Las casillas en negativo no se pasan: se avisan.
export function migrarModeloV03(estado, { mapeo, categoriasNuevas, rodeosNuevos, esperadasViejas, parametrosNuevos, hoy, ahoraIso, nuevoId: idf = nuevoId }) {
  const avisos = [];
  const clon = (x) => JSON.parse(JSON.stringify(x));
  const params = { ...(estado.parametros || {}) };
  for (const [k, v] of Object.entries(parametrosNuevos)) if ((params[k] === undefined || params[k] === '') && v !== '') params[k] = v;
  if (!estado.movimientos.length && !estado.conteos.length) {
    return { estado: { rodeos: clon(rodeosNuevos), categorias: clon(categoriasNuevas), movimientos: [], conteos: [], parametros: params }, nuevos: [], avisos, limpio: true };
  }
  const nuevasIds = new Set(categoriasNuevas.map((c) => c.id));
  const viejas = estado.categorias.map((c) => {
    const x = { ...c };
    if (mapeo[c.id] && nuevasIds.has(mapeo[c.id])) { x.activa = false; x.cuentaComoVaca = false; x.orden = 100 + (c.orden || 0); x.reemplazadaPor = mapeo[c.id]; }
    else x.orden = 50 + (c.orden || 0); // categoría propia del usuario: se conserva tal cual, después de las SENASA
    return x;
  });
  const categorias = [...clon(categoriasNuevas), ...viejas];
  const rodeos = estado.rodeos.map((r) => (r.esperadas ? { ...r } : { ...r, esperadas: esperadasViejas[r.id] ? [...esperadasViejas[r.id]] : [] }));
  const rIds = new Set(rodeos.map((r) => r.id));
  let fecha = hoy;
  for (const m of estado.movimientos) if (!m.anulado && m.fecha > fecha) fecha = m.fecha;
  const stock = calcularStock(estado.movimientos);
  const lote = idf();
  const nuevos = [];
  const nomR = (id) => rodeos.find((r) => r.id === id)?.nombre || id;
  const nomC = (id) => categorias.find((c) => c.id === id)?.nombre || id;
  for (const [k, n] of [...stock.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const { rodeoId, categoriaId } = desarmarClave(k);
    const dest = mapeo[categoriaId];
    if (!dest || !nuevasIds.has(dest) || !rIds.has(rodeoId) || n === 0) continue;
    if (n < 0) { avisos.push(`${nomR(rodeoId)} · ${nomC(categoriaId)} estaba en negativo (${n}): no se pasó a ${nomC(dest)}. Revisalo.`); continue; }
    nuevos.push({
      id: idf(), fecha, tipo: 'cambio_categoria', cantidad: n,
      origen: { rodeoId, categoriaId }, destino: { rodeoId, categoriaId: dest },
      nota: 'Cambio de modelo (v0.4): las categorías pasan a ser las de SENASA', caravana: '', motivo: 'Cambio de modelo v0.4',
      lote, creado: ahoraIso, anulado: null, extra: { migracion: 'v0.4' },
    });
  }
  return {
    estado: { rodeos, categorias, movimientos: [...estado.movimientos, ...nuevos], conteos: estado.conteos, parametros: params },
    nuevos, avisos, limpio: false, fecha,
  };
}

// ---- Plantilla Excel de saldo inicial ----
// filas: lo que devuelve read-excel-file para la hoja "Saldo inicial" (matriz de celdas).
// Formato: una fila "Fecha" (A=Fecha, B=la fecha); una fila de encabezado (A="Rodeo", luego nombres de categorías);
// la fila siguiente con los identificadores técnicos de las categorías (A="id"); las filas de rodeos con la cantidad
// en cada categoría y el identificador del rodeo en la última columna. Devuelve { ok, errores, fecha, renglones, total }.
export function leerPlantillaSaldo(filas, rodeos, categorias) {
  const errores = [];
  const err = (t) => errores.push(t);
  const fin = () => {
    const total = errores.length;
    const lista = errores.slice(0, MAX_ERRORES);
    if (total > MAX_ERRORES) lista.push(`y ${total - MAX_ERRORES} problema${total - MAX_ERRORES === 1 ? '' : 's'} más`);
    return { ok: false, errores: lista, total };
  };
  if (!Array.isArray(filas)) return { ok: false, errores: ['No se encontró la hoja "Saldo inicial": no parece la plantilla de esta app.'], total: 1 };
  const txt = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v : String(v).trim());
  const iFecha = filas.findIndex((f) => Array.isArray(f) && /^fecha/i.test(String(txt(f[0]))));
  const iCab = filas.findIndex((f) => Array.isArray(f) && String(txt(f[0])).toLowerCase() === 'rodeo');
  if (iCab < 0 || !Array.isArray(filas[iCab + 1])) return { ok: false, errores: ['No se encontró la fila de encabezado ("Rodeo"): no parece la plantilla de esta app o se movieron filas.'], total: 1 };
  // Fecha
  let fecha = null;
  const fv = iFecha >= 0 ? filas[iFecha][1] : null;
  const pad = (n) => String(n).padStart(2, '0');
  if (fv instanceof Date && !Number.isNaN(fv.getTime())) fecha = `${fv.getUTCFullYear()}-${pad(fv.getUTCMonth() + 1)}-${pad(fv.getUTCDate())}`;
  else if (typeof fv === 'number' && Number.isFinite(fv) && fv > 20000 && fv < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(fv) * 86400000); fecha = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  else if (typeof fv === 'string') {
    const m = fv.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/) || null;
    const m2 = fv.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) fecha = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    else if (m2) fecha = fv.trim();
  }
  if (!fecha || !esFecha(fecha)) err('Falta la fecha del saldo o no es válida: escribila como dd/mm/aaaa en la celda amarilla de "Fecha".');
  const cab = filas[iCab], ids = filas[iCab + 1].map((v) => String(txt(v)));
  if (ids[0] !== 'id') return { ok: false, errores: ['Falta la fila de identificadores debajo del encabezado: no se puede saber qué columna es cada categoría. Descargá la plantilla de nuevo.'], total: 1 };
  const cIds = new Set(categorias.map((c) => c.id)), rPorId = new Map(rodeos.map((r) => [r.id, r]));
  const columnas = [];
  for (let j = 1; j < ids.length; j++) {
    if (!ids[j]) continue;
    if (ids[j] === 'rodeo_id') continue;
    if (!cIds.has(ids[j])) { err(`La columna "${String(txt(cab[j]))}" es de una categoría que no existe en la app (${ids[j].slice(0, 40)}).`); continue; }
    columnas.push(j);
  }
  const jRodeo = ids.indexOf('rodeo_id');
  if (jRodeo < 0) return { ok: false, errores: ['Falta la columna técnica "rodeo_id": descargá la plantilla de nuevo.'], total: 1 };
  const renglones = [];
  const nomC = (id) => categorias.find((c) => c.id === id)?.nombre || id;
  const vistos = new Set();
  for (let i = iCab + 2; i < filas.length; i++) {
    const f = filas[i];
    if (!Array.isArray(f)) continue;
    const rid = String(txt(f[jRodeo]));
    const nombre = String(txt(f[0]));
    const algo = columnas.some((j) => txt(f[j]) !== '');
    if (!rid && !algo) continue; // fila vacía o de totales
    const fila = `Fila ${i + 1}${nombre ? ` (${nombre.slice(0, 40)})` : ''}`;
    if (!rPorId.has(rid)) { err(`${fila}: el rodeo no existe en la app. No agregues filas a mano: creá el rodeo en la app y descargá la plantilla de nuevo.`); continue; }
    if (vistos.has(rid)) { err(`${fila}: el rodeo está repetido.`); continue; }
    vistos.add(rid);
    for (const j of columnas) {
      const v = f[j];
      if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) continue;
      const n = typeof v === 'number' ? v : /^\s*\d+\s*$/.test(String(v)) ? Number(String(v).trim()) : NaN;
      if (!Number.isInteger(n) || n < 0) { err(`${fila}, columna ${nomC(ids[j])}: «${String(v).slice(0, 20)}» no es un número entero (0 o más).`); continue; }
      if (n > 1000000) { err(`${fila}, columna ${nomC(ids[j])}: ${n} es demasiado.`); continue; }
      if (n > 0) renglones.push({ rodeoId: rid, categoriaId: ids[j], cantidad: n });
    }
  }
  if (!errores.length && !renglones.length) err('La plantilla no tiene ninguna cantidad: completá las celdas amarillas.');
  if (errores.length) return fin();
  return { ok: true, errores: [], total: 0, fecha, renglones, cabezas: renglones.reduce((s, r) => s + r.cantidad, 0) };
}
