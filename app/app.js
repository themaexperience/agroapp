// app.js — Interfaz. Toda la lógica de stock vive en ledger.js; acá solo se muestra y se carga.
import * as L from './ledger.js';
import * as DB from './db.js';
import { RODEOS_INICIALES, CATEGORIAS_INICIALES, PARAMETROS_INICIALES, ATAJOS, DESTINO_PROBABLE, NACEN, MAPEO_V03, ESPERADAS_V03 } from './seeds.js';

const VERSION_APP = '0.4.0';

// ---------- Estado ----------
const S = {
  rodeos: [], categorias: [], movimientos: [], conteos: [], parametros: {}, meta: {},
  vista: 'cargar', sub: 'menu',
  persistido: null,
  respaldo: null,   // { fecha, movimientos } si hay copia de antes de la última importación
};
let C = nuevaCarga();          // estado del asistente de carga
let CT = { modo: 'lista' };    // estado de conteos
let stockFecha = null, stockModo = 'rodeo', informeFecha = null, histVer = 24, movsVer = 50, conteosVer = 20, anuladosVer = 20, abiertasVer = 30;

function nuevaCarga() {
  return { paso: 'tipo', tipo: null, atajo: null, rodeoO: null, rodeoD: null, catO: null, cant: {}, nota: '', caravana: '', motivo: '', signo: null, vinc: {} };
}

// Índice del libro: se rearma solo cuando cambia la lista de movimientos (S.movimientos nunca se modifica en el lugar).
let idxRef = null, idxVal = null;
function IDX() { if (idxRef !== S.movimientos) { idxVal = L.construirIndice(S.movimientos); idxRef = S.movimientos; } return idxVal; }

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
// Punto de miles siempre (algunos teléfonos no agrupan los números de 4 cifras con Intl en castellano).
function num(n) {
  const v = Math.trunc(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (v < 0 ? '-' : '') + s;
}
const numS = (n) => (n > 0 ? '+' : '') + num(n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function hoyLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const hoyIso = () => hoyLocal(new Date());
const fFecha = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
// Fecha local de un instante guardado en ISO (UTC): nunca cortar el texto ISO.
const fFechaDe = (ts) => { if (!ts) return ''; const d = new Date(ts); return Number.isNaN(d.getTime()) ? 'fecha desconocida' : fFecha(hoyLocal(d)); };
function fFechaHora(d = new Date()) { return `${fFecha(hoyLocal(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const rodeo = (id) => S.rodeos.find((r) => r.id === id);
const cat = (id) => S.categorias.find((c) => c.id === id);
const nomR = (id) => rodeo(id)?.nombre ?? '(rodeo borrado)';
const nomC = (id) => cat(id)?.nombre ?? '(categoría borrada)';
const rodeosActivos = () => S.rodeos.filter((r) => r.activo).sort((a, b) => a.orden - b.orden);
const catsActivas = () => S.categorias.filter((c) => c.activa).sort((a, b) => a.orden - b.orden);
const fechaSesion = () => S.meta.fechaSesion || hoyIso();
const activos = () => S.movimientos.filter(L.activo);

// Errores que se le muestran al usuario tal cual (ya están en castellano).
class ErrorUsuario extends Error {}
// Traduce errores técnicos del navegador a castellano. El detalle técnico queda plegado, solo por si hace falta.
function mensajeError(e, contexto = '') {
  if (e instanceof ErrorUsuario) return esc(e.message);
  const nombre = e?.name || '';
  let txt;
  if (nombre === 'QuotaExceededError') txt = 'El teléfono no tiene espacio libre para guardar los datos.';
  else if (contexto === 'json') txt = 'El archivo no es un backup válido: puede estar cortado (una descarga incompleta) o ser otro tipo de archivo.';
  else if (contexto === 'xlsx') txt = 'No se pudo abrir el Excel: el archivo está dañado o no es un Excel exportado por esta app.';
  else if (contexto === 'db') txt = 'No se pudo escribir en la memoria del teléfono.';
  else txt = 'Pasó algo inesperado.';
  const det = String(e?.message || e || '');
  return `${txt}${det ? `<details class="detalle-tec"><summary>Detalle técnico</summary><span>${esc(det)}</span></details>` : ''}`;
}

// Aviso "Procesando…" para operaciones largas (importar o exportar miles de renglones). Tapa la pantalla para
// que no se toque dos veces, y espera a que se dibuje antes de seguir.
function procesando(txt) {
  let el = $('#procesando');
  if (!el) { el = document.createElement('div'); el.id = 'procesando'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.innerHTML = `<div class="caja-proc"><div class="ruedita" aria-hidden="true"></div><b>${esc(txt)}</b><div class="chico">Puede tardar unos segundos. No cierres la app.</div></div>`;
  el.hidden = false;
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
}
function finProcesando() { const el = $('#procesando'); if (el) el.hidden = true; }
const ceder = () => new Promise((r) => setTimeout(r, 0));

// Evita guardar dos veces con un doble toque rápido.
let ocupado = false;
async function unaVez(fn) {
  if (ocupado) return;
  ocupado = true;
  try { await fn(); } finally { ocupado = false; }
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('ver');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('ver'), 2600);
}

// Modal genérico. botones: [{texto, valor, clase}]. Devuelve promesa con el valor.
function modal(html, botones, alAbrir) {
  return new Promise((resolve) => {
    const m = $('#modal');
    m.innerHTML = `<div class="caja" role="dialog" aria-modal="true">${html}<div class="fila-btns">${botones.map((b, i) => `<button class="btn ${b.clase || ''}" data-i="${i}">${esc(b.texto)}</button>`).join('')}</div></div>`;
    m.hidden = false;
    const cerrar = (v) => { m.hidden = true; m.innerHTML = ''; resolve(v); };
    m.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      const bt = botones[Number(b.dataset.i)];
      if (bt.validar) { const r = bt.validar(m); if (r !== true) { const e = m.querySelector('.error-modal'); if (e) e.textContent = r; return; } }
      cerrar(bt.leer ? bt.leer(m) : bt.valor);
    }));
    if (alAbrir) alAbrir(m);
  });
}
const confirmar = (titulo, texto, si = 'Sí', no = 'Cancelar') =>
  modal(`<h2>${esc(titulo)}</h2><div>${texto}</div>`, [{ texto: no, valor: false }, { texto: si, valor: true, clase: 'prim' }]);
const aviso = (titulo, texto) => modal(`<h2>${esc(titulo)}</h2><div>${texto}</div>`, [{ texto: 'Volver', valor: 0, clase: 'prim' }]);

// Motivo obligatorio (para anular, ajustes, confirmaciones). 'inicial' precarga el texto.
function pedirMotivo(titulo, explicacion, conRapidos = false, inicial = '') {
  const rap = conRapidos ? `<div class="fila-btns">${(S.parametros.motivosAjuste || []).map((m) => `<button class="btn" data-mot="${esc(m)}">${esc(m)}</button>`).join('')}</div>` : '';
  return modal(
    `<h2>${esc(titulo)}</h2><div>${explicacion}</div>${rap}
     <label class="campo"><span>Motivo (obligatorio)</span><textarea id="m-motivo" rows="2" autocomplete="off">${esc(inicial)}</textarea></label>
     <div class="error error-modal"></div>`,
    [{ texto: 'Cancelar', valor: null },
     { texto: 'Guardar', clase: 'prim', validar: (m) => (m.querySelector('#m-motivo').value.trim() ? true : 'Escribí o elegí un motivo'), leer: (m) => m.querySelector('#m-motivo').value.trim() }],
    (m) => m.querySelectorAll('[data-mot]').forEach((b) => b.addEventListener('click', () => {
      m.querySelector('#m-motivo').value = b.dataset.mot;
      m.querySelectorAll('[data-mot]').forEach((x) => x.classList.toggle('sel', x === b));
    })),
  );
}

// ---------- Persistencia ----------
async function guardarMeta() { await DB.guardar({ kv: { meta: S.meta } }); }

// Agrega movimientos (y opcionalmente anula otros) verificando stock negativo antes.
async function registrar(nuevos, { anular = [], conteos = [] } = {}) {
  for (const m of nuevos) {
    const e = L.validarMovimiento(m);
    if (e.length) { await aviso('No se puede guardar', `<p class="error">${esc(e.join('. '))}</p>`); return false; }
  }
  const ahora = new Date().toISOString();
  const anuladosNuevos = anular.map((a) => ({ ...a.mov, anulado: { fecha: ahora, motivo: a.motivo } }));
  const porId = new Map(anuladosNuevos.map((m) => [m.id, m]));
  const despues = S.movimientos.map((m) => porId.get(m.id) || m).concat(nuevos);
  // Con el índice: solo se recalculan las celdas que toca el cambio (no se recorre todo el libro).
  const idx0 = IDX(), antesRef = S.movimientos;
  const quitar = anular.map((a) => a.mov);
  const negs = L.negativosPorCambioIdx(idx0, quitar, nuevos);
  if (negs.length) {
    const lista = negs.map((n) => `<li><b>${esc(nomR(n.rodeoId))} · ${esc(nomC(n.categoriaId))}</b>: quedaría en <span class="error">${num(n.saldo)}</span> el ${fFecha(n.fecha)}</li>`).join('');
    // La acción segura (Revisar) es la destacada.
    const ok = await modal(`<h2>Ojo: stock negativo</h2><p>Con este cambio el stock quedaría negativo:</p><ul>${lista}</ul><p>Puede ser un error de carga, o que falte cargar algo anterior (un nacimiento, un traslado de entrada).</p>`,
      [{ texto: 'Guardar igual', valor: true }, { texto: 'Revisar', valor: false, clase: 'prim' }]);
    if (!ok) return false;
  }
  try {
    await DB.guardar({ movimientos: [...nuevos, ...anuladosNuevos], conteos });
  } catch (e) {
    await aviso('No se pudo guardar', `<p class="error">${mensajeError(e, 'db')}</p><p>No se guardó nada. Probá de nuevo.</p>`);
    return false;
  }
  S.movimientos = despues;
  // El índice se actualiza solo en las celdas tocadas (rearmarlo entero con 20.000 movimientos es lo que más tarda).
  if (idxRef === antesRef) { idxVal = L.indiceConCambios(idx0, quitar, nuevos); idxRef = despues; }
  if (conteos.length) {
    const ids = new Set(conteos.map((c) => c.id));
    S.conteos = S.conteos.filter((c) => !ids.has(c.id)).concat(conteos);
  }
  return true;
}

function nuevoMov(campos) {
  return { id: L.nuevoId(), fecha: fechaSesion(), tipo: null, origen: null, destino: null, cantidad: 0, nota: '', caravana: '', motivo: '',
    conteoId: null, lote: null, creado: new Date().toISOString(), anulado: null, corrigeA: null, antes: null, extra: {}, ...campos };
}

function describir(m) {
  const t = m.tipo === 'ajuste' && m.cantidad === 0 ? 'Confirmación de conteo' : (L.TIPOS[m.tipo]?.nombre ?? m.tipo);
  let lugar = '';
  if (m.tipo === 'traslado') lugar = `${nomR(m.origen.rodeoId)} → ${nomR(m.destino.rodeoId)} · ${num(m.cantidad)} ${nomC(m.origen.categoriaId)}`;
  else if (m.tipo === 'cambio_categoria') {
    const mismo = m.origen.rodeoId === m.destino.rodeoId;
    lugar = `${nomR(m.origen.rodeoId)}${mismo ? '' : ' → ' + nomR(m.destino.rodeoId)} · ${num(m.cantidad)} ${nomC(m.origen.categoriaId)} → ${nomC(m.destino.categoriaId)}`;
  } else if (m.tipo === 'ajuste') {
    const l = L.ladoAjuste(m);
    lugar = m.cantidad === 0 ? `${nomR(l.rodeoId)} · ${nomC(l.categoriaId)}` : `${nomR(l.rodeoId)} · ${numS(L.signoAjuste(m))} ${nomC(l.categoriaId)}`;
  } else { const l = m.destino || m.origen; lugar = `${nomR(l.rodeoId)} · ${num(m.cantidad)} ${nomC(l.categoriaId)}`; }
  return { tipo: t, lugar };
}

// ---------- Aviso de backup ----------
function diasSinBackup() {
  if (!S.meta.ultimoBackup) return null;
  return Math.floor((Date.now() - new Date(S.meta.ultimoBackup).getTime()) / 86400000);
}
function renderAviso() {
  const d = diasSinBackup();
  const el = $('#aviso-backup');
  if (d === null) el.innerHTML = `<button class="aviso rojo" data-ir="mas" data-sub="backup">Nunca exportaste un backup. Tocá acá para hacerlo.</button>`;
  else if (d > 7) el.innerHTML = `<button class="aviso rojo" data-ir="mas" data-sub="backup">Hace ${num(d)} días que no exportás un backup. Tocá acá.</button>`;
  else el.innerHTML = '';
}

// ---------- Navegación ----------
function ir(vista, sub) {
  S.vista = vista; if (sub) S.sub = sub; else if (vista === 'mas') S.sub = 'menu';
  if (vista === 'cargar' && !sub) C = nuevaCarga();
  if (vista === 'historial') histVer = 24;
  if (vista === 'conteos') { CT = { modo: 'lista' }; conteosVer = 20; anuladosVer = 20; abiertasVer = 30; }
  render(); window.scrollTo(0, 0);
}

// D2: la fecha de carga fijada otro día vuelve a hoy (con un botón para seguir con la planilla anterior).
// Se revisa al arrancar, en cada pantalla, al volver a la app y antes de guardar: una app instalada puede
// quedar abierta de un día para otro sin recargarse. Devuelve true si cambió.
function revisarFechaSesion() {
  const hoy = hoyIso();
  if (S.meta.fechaSesion && S.meta.fechaSesionDia !== hoy && S.meta.fechaSesion !== hoy) {
    S.meta.fechaSesionAnterior = S.meta.fechaSesion;
    delete S.meta.fechaSesion;
    S.meta.fechaSesionDia = hoy;
    return true;
  }
  return false;
}

// D2 también para el formulario de conteo: la fecha se toma al abrirlo (o al elegirla). Si cambió el día con
// el formulario abierto, vuelve a hoy conservando lo escrito, y ofrece seguir con la fecha anterior.
function revisarFechaConteo() {
  const hoy = hoyIso();
  if (CT.modo === 'nuevo' && CT.fechaDia && CT.fechaDia !== hoy && CT.fecha !== hoy) {
    CT.fechaAnterior = CT.fecha; CT.fecha = hoy; CT.fechaDia = hoy;
    return true;
  }
  return false;
}

function leerConteoVisibles() {
  if (CT.modo !== 'nuevo') return;
  const ins = document.querySelectorAll('[data-ccant]');
  if (ins.length) { CT.vals = {}; for (const i of ins) CT.vals[i.dataset.ccant] = i.value; }
  const o = $('#ct-origen'), n = $('#ct-nota');
  if (o) CT.origenTxt = o.value;
  if (n) CT.notaTxt = n.value;
}

function render() {
  if (revisarFechaSesion()) guardarMeta();
  if (revisarFechaConteo()) leerConteoVisibles();
  document.querySelectorAll('#barra button').forEach((b) => b.classList.toggle('activo', b.dataset.ir === S.vista));
  renderAviso();
  const campo = (S.parametros.campo || '').trim();
  $('#titulo').textContent = campo && campo !== 'Mi campo' ? `Stock · ${campo}` : 'Stock de hacienda';
  const v = $('#vista');
  const vistas = { cargar: vCargar, stock: vStock, conteos: vConteos, historial: vHistorial, mas: vMas };
  v.innerHTML = vistas[S.vista]();
  if (S.vista === 'cargar') postCargar();
  if (S.vista === 'conteos') postConteos();
}

// =============== CARGAR ===============
// Botones de "¿Qué pasó?". Los ajustes vienen ya con el signo (un toque menos) y los atajos de cría al final.
const BOTONES_TIPO = [
  ['nacimiento', 'Nacimiento'], ['mortandad', 'Mortandad'], ['venta', 'Venta'], ['traslado', 'Traslado'],
  ['cambio_categoria', 'Cambio de categoría'], ['ingreso', 'Ingreso / compra'],
  ['ajuste+', 'Ajuste: sumar'], ['ajuste-', 'Ajuste: restar'],
];

function atajo(id) { return ATAJOS.find((a) => a.id === id); }
const rodeoUsable = (id) => !!rodeo(id)?.activo;
// Rodeos destino que ofrece un atajo para las filas sin rodeo fijo ('mismo' = el de origen). Si ninguno de los
// sugeridos existe, se ofrecen todos los rodeos activos (menos el de origen) y hay que elegir uno.
function opcionesDestino(a, rodeoO) {
  const ops = [];
  for (const id of a.rodeosDestino || []) {
    const r = id === 'mismo' ? rodeoO : id;
    if (r && rodeoUsable(r) && !ops.includes(r)) ops.push(r);
  }
  return ops.length ? { ops, sugerido: ops[0] } : { ops: rodeosActivos().map((r) => r.id).filter((id) => id !== rodeoO), sugerido: null };
}
// Filas de un atajo usables desde un rodeo de origen. Cada fila: de qué categoría sale (catO) y a cuál pasa (cat).
// Si el rodeo fijo de la fila no existe o está desactivado, la fila va al rodeo elegido en los botones.
// Se ocultan las filas con categorías desactivadas y los "traslados" al mismo rodeo de origen (no mueven nada).
function filasAtajo(a, rodeoO, rodeoD = null) {
  return a.filas.map((f, i) => {
    const fijo = f.rodeo && rodeoUsable(f.rodeo) ? f.rodeo : null;
    const texto = f.texto && fijo ? f.texto : f.catO === f.cat ? nomC(f.cat) : `${nomC(f.catO)} → ${nomC(f.cat)}`;
    return { ...f, rodeo: fijo, texto, key: 'f' + i };
  }).filter((f) => cat(f.cat)?.activa && cat(f.catO)?.activa
    && !(rodeoO && f.catO === f.cat && (f.rodeo || rodeoD || null) === rodeoO)
    && !(rodeoO && f.catO === f.cat && !f.rodeo && !rodeoD && opcionesDestino(a, rodeoO).ops.every((id) => id === rodeoO)));
}
const atajosDisponibles = () => ATAJOS.filter((a) => filasAtajo(a, null).length);
// Destino de las filas sin rodeo fijo: lo elegido, o el sugerido del atajo.
function destinoAtajo(a) {
  if (C.rodeoD) return C.rodeoD;
  return opcionesDestino(a, C.rodeoO).sugerido;
}
const CUANDO = { yerra: 'yerra', destete: 'destete', tacto: 'tacto', paricion: null, paseTerneros: 'paseTerneros', paseToro: 'paseToro' };
function epocaAtajo(a) {
  if (a.cuando === 'paricion') { const P = S.parametros; return P.paricionDesde || P.paricionHasta ? `${P.paricionDesde || '?'} al ${P.paricionHasta || '?'}` : ''; }
  const k = CUANDO[a.cuando]; return k ? String(S.parametros[k] || '') : '';
}

// Categorías para mostrar en un rodeo: primero las esperadas, las que tienen animales y las ya escritas;
// el resto queda plegado en "Otras categorías" (un toque más, nunca bloqueado).
function catsDelRodeo(rodeoId, fecha, { solo = null, escritas = {} } = {}) {
  const r = rodeo(rodeoId);
  const esp = solo ? new Set(solo) : new Set(r?.esperadas?.length ? r.esperadas : catsActivas().map((c) => c.id));
  const st = rodeoId ? stockEn(rodeoId, fecha) : {};
  const principales = [], otras = [];
  for (const c of catsActivas()) {
    // Con "solo" (nacimiento): solo esas categorías a la vista, aunque en el rodeo haya otras con animales.
    if (esp.has(c.id) || (!solo && (st[c.id] || 0) !== 0) || (escritas[c.id] ?? '') !== '') principales.push(c); else otras.push(c);
  }
  return { principales, otras, st };
}
const plegadas = (otras, html) => (otras.length ? `<details class="otras"><summary>Otras categorías (${otras.length})</summary>${html}</details>` : '');
// Aviso suave: categorías cargadas que no son las esperadas del rodeo.
function fueraDeLoEsperado(rodeoId, catIds) {
  const r = rodeo(rodeoId);
  if (!r?.esperadas?.length) return [];
  return catIds.filter((id) => !r.esperadas.includes(id));
}

function stockEn(rodeoId, fecha) {
  const idx = IDX();
  const out = {};
  for (const c of S.categorias) out[c.id] = idx.stockA(L.clave(rodeoId, c.id), fecha);
  return out;
}

function vCargar() {
  const ant = S.meta.fechaSesionAnterior && S.meta.fechaSesionAnterior !== fechaSesion()
    ? `<button class="btn" data-acc="seguir-fecha">Seguir con la planilla del ${fFecha(S.meta.fechaSesionAnterior)}</button>` : '';
  const fecha = `<div class="fecha-sesion"><label for="f-sesion">Fecha de lo que cargás:</label><input type="date" id="f-sesion" value="${fechaSesion()}">${ant}<span class="chico">Queda fija para todos los renglones de hoy.</span></div>`;
  const nombreTipo = C.atajo ? atajo(C.atajo).nombre : C.tipo === 'ajuste' ? (C.signo === 1 ? 'Ajuste: sumar' : 'Ajuste: restar') : C.tipo ? L.TIPOS[C.tipo].nombre : '';
  const atras = C.paso !== 'tipo' ? `<button class="btn" data-acc="atras">← Atrás</button>` : '';
  const sel = [];
  if (nombreTipo) sel.push(`<b>${esc(nombreTipo)}</b>`);
  if (C.rodeoO) sel.push(esc(nomR(C.rodeoO)));
  if (C.rodeoD && C.tipo === 'traslado') sel.push('→ ' + esc(nomR(C.rodeoD)));
  if (C.catO && !C.atajo) sel.push('de ' + esc(nomC(C.catO)));
  const resumen = sel.length ? `<div class="resumen-sel">${sel.join(' · ')}</div>` : '';
  let cuerpo = '';
  if (C.paso === 'tipo') {
    const ats = atajosDisponibles();
    cuerpo = `<h1>¿Qué pasó?</h1><div class="grilla">${BOTONES_TIPO.map(([k, n]) => `<button class="btn" data-tipo="${k}">${esc(n)}</button>`).join('')}</div>
      ${ats.length ? `<h2>Atajos de cría</h2><div class="grilla">${ats.map((a) => `<button class="btn atajo" data-atajo="${a.id}">${esc(a.nombre)}<small>${esc(a.ayuda)}</small></button>`).join('')}</div>` : ''}
      ${ultimosCargados()}`;
  } else if (C.paso === 'rodeo') {
    const preg = { nacimiento: '¿En qué rodeo nacieron?', ingreso: '¿A qué rodeo entran?', mortandad: '¿De qué rodeo?', venta: '¿De qué rodeo salen?', traslado: '¿De qué rodeo salen?', cambio_categoria: '¿En qué rodeo?', ajuste: '¿Qué rodeo?' }[C.tipo];
    cuerpo = `<h1>${preg}</h1>${gridRodeos('rodeoO')}`;
  } else if (C.paso === 'destino') {
    cuerpo = `<h1>¿A qué rodeo van?</h1>${gridRodeos('rodeoD', C.rodeoO)}`;
  } else if (C.paso === 'catO') {
    const st = stockEn(C.rodeoO, fechaSesion());
    const { principales, otras } = catsDelRodeo(C.rodeoO, fechaSesion());
    const bot = (c) => `<button class="btn" data-cato="${c.id}">${esc(c.nombre)}<small>hay ${num(st[c.id])}</small></button>`;
    cuerpo = `<h1>¿Qué categoría cambia?</h1><div class="grilla">${principales.map(bot).join('')}</div>${plegadas(otras, `<div class="grilla">${otras.map(bot).join('')}</div>`)}`;
  } else if (C.paso === 'cant') {
    cuerpo = pasoCantidades();
  }
  return `${fecha}<div class="fila-btns" style="justify-content:flex-start">${atras}</div>${resumen}${cuerpo}`;
}

function gridRodeos(campo, excluir) {
  return `<div class="grilla">${rodeosActivos().filter((r) => r.id !== excluir).map((r) =>
    `<button class="btn" data-rodeo="${r.id}" data-campo="${campo}">${esc(r.nombre)}${r.ubicacion ? `<small>${esc(r.ubicacion)}</small>` : ''}</button>`).join('')}</div>`;
}

// Elección del rodeo destino en un cambio de categoría: botones a la vista (sin paso extra).
function chipsDestino(opciones, actual) {
  return `<div class="chips-titulo">¿${actual ? 'Quedan' : 'Van'} en qué rodeo?${actual ? '' : ' <b class="error">Elegí uno</b>'}</div><div class="chips">${opciones.map((id) =>
    `<button class="btn chip ${id === actual ? 'sel' : ''}" data-rodeo="${id}" data-campo="rodeoD" aria-pressed="${id === actual}">${id === C.rodeoO ? 'Mismo rodeo (' + esc(nomR(id)) + ')' : esc(nomR(id))}</button>`).join('')}</div>`;
}

// Diferencias en rojo de un rodeo (para ofrecer vincular un ajuste).
function rojasDelRodeo(rodeoId) {
  const propias = S.conteos.filter((c) => !c.anulado && c.rodeoId === rodeoId);
  if (!propias.length) return new Map();
  const difs = L.estadoConteos(propias, S.movimientos, IDX()).filter((d) => L.ROJOS.has(d.estado));
  const out = new Map();
  for (const d of difs.sort((a, b) => (a.conteo.fecha < b.conteo.fecha ? 1 : -1))) if (!out.has(d.conteo.categoriaId)) out.set(d.conteo.categoriaId, d);
  return out;
}

function filaCant(key, nombre, hay, extra = '') {
  return `<div class="cant-fila"><div><div class="nom">${esc(nombre)}</div><div class="hay">${hay}</div>${extra}</div>
    <input class="num" type="text" inputmode="numeric" pattern="[0-9]*" data-cant="${key}" value="${esc(C.cant[key] ?? '')}" aria-label="${esc(nombre)}" autocomplete="off"></div>`;
}

function pasoCantidades() {
  const tipo = C.tipo;
  const st = stockEn(C.rodeoO, fechaSesion());
  let titulo = '¿Cuántos?', extra = '', filas = '', origenTxt = '';
  if (tipo === 'cambio_categoria') {
    if (C.atajo) {
      const a = atajo(C.atajo);
      const dest = destinoAtajo(a);
      const fs = filasAtajo(a, C.rodeoO, dest);
      const libres = fs.some((f) => !f.rodeo);
      const { ops } = opcionesDestino(a, C.rodeoO);
      const ep = epocaAtajo(a);
      titulo = a.nombre;
      origenTxt = `<p class="chico">${esc(a.ayuda)}${ep ? ` · Época: ${esc(ep)}` : ''}</p>`;
      extra = libres && (ops.length > 1 || !dest) ? chipsDestino(ops, dest) : '';
      filas = fs.map((f) => {
        const r = f.rodeo || dest;
        const stD = r ? stockEn(r, fechaSesion()) : {};
        const hay = `hay ${num(st[f.catO])} ${esc(nomC(f.catO))}${r ? ` · van a ${esc(nomR(r))}${r !== C.rodeoO ? ` (hay ${num(stD[f.cat])})` : ''}` : ''}`;
        return filaCant(f.key, f.texto, hay);
      }).join('') || '<p class="error">En este rodeo no hay nada para este atajo. Revisá las categorías y rodeos activos.</p>';
    } else {
      origenTxt = `<p>Salen de <b>${esc(nomC(C.catO))}</b> (hay ${num(st[C.catO])}).</p>`;
      titulo = '¿A qué categoría pasan y cuántos?';
      extra = chipsDestino(rodeosActivos().map((r) => r.id), C.rodeoD || C.rodeoO);
      const dest = C.rodeoD || C.rodeoO;
      const stD = stockEn(dest, fechaSesion());
      filas = catsActivas().filter((c) => c.id !== C.catO).map((c) => filaCant(c.id, c.nombre, `en ${esc(nomR(dest))} hay ${num(stD[c.id])}`)).join('');
    }
  } else {
    let rojas = new Map();
    if (tipo === 'ajuste') {
      rojas = rojasDelRodeo(C.rodeoO);
      extra = `<p class="chico">Si sabés qué pasó (una muerte, un traslado), cargá ese movimiento en vez de un ajuste.</p>
        <div class="fila-btns">${(S.parametros.motivosAjuste || []).map((m) => `<button class="btn ${C.motivo === m ? 'sel' : ''}" data-motivo="${esc(m)}">${esc(m)}</button>`).join('')}</div>
        <label class="campo"><span>Motivo (obligatorio)</span><input type="text" id="c-motivo" value="${esc(C.motivo)}" autocomplete="off"></label>`;
    }
    const solo = tipo === 'nacimiento' ? NACEN : null;
    const { principales, otras } = catsDelRodeo(C.rodeoO, fechaSesion(), { solo, escritas: C.cant });
    const fila = (c) => {
      let ext = '';
      const d = rojas.get(c.id);
      // Solo se ofrece vincular si el signo del ajuste coincide con lo que falta explicar.
      if (d && Math.sign(d.pendiente) === C.signo) {
        if (C.vinc[c.id] === undefined) { C.vinc[c.id] = d.conteo.id; if (C.cant[c.id] === undefined) C.cant[c.id] = String(Math.abs(d.pendiente)); }
        const on = !!C.vinc[c.id];
        ext = `<button class="btn vinc ${on ? 'sel' : ''}" data-vinc="${c.id}" data-conteo="${d.conteo.id}" aria-pressed="${on}">${on ? '✔ ' : ''}Explica la diferencia del conteo del ${fFecha(d.conteo.fecha)} (${numS(d.pendiente)})</button>`;
      }
      return filaCant(c.id, c.nombre, `hay ${num(st[c.id])}`, ext);
    };
    filas = principales.map(fila).join('') + plegadas(otras, otras.map(fila).join(''));
  }
  const conCaravana = ['mortandad', 'venta'].includes(tipo);
  const caravana = conCaravana ? `<label class="campo"><span>Caravana N° (opcional)</span><input type="text" id="c-caravana" inputmode="numeric" value="${esc(C.caravana)}" autocomplete="off"></label>` : '';
  return `<h1>${titulo}</h1>${origenTxt}${extra}${filas}${caravana}
    <details><summary>Agregar nota${conCaravana ? '' : ' o caravana'}</summary>
      ${conCaravana ? '' : `<label class="campo"><span>Caravana N° (opcional)</span><input type="text" id="c-caravana" inputmode="numeric" value="${esc(C.caravana)}" autocomplete="off"></label>`}
      <label class="campo"><span>Nota (opcional)</span><textarea id="c-nota" rows="2" autocomplete="off">${esc(C.nota)}</textarea></label>
    </details>
    <div class="error" id="c-error"></div>
    <button class="btn prim grande" data-acc="guardar">Guardar</button>`;
}

function ultimosCargados() {
  const ult = [...S.movimientos].sort((a, b) => (a.creado < b.creado ? 1 : -1)).slice(0, 5);
  if (!ult.length) return '';
  return `<h2>Últimos cargados</h2>${ult.map((m) => itemMov(m, false)).join('')}`;
}

// Pone el cursor en la casilla más probable (ahorra un toque).
function postCargar() {
  if (C.paso !== 'cant') return;
  const inputs = [...document.querySelectorAll('[data-cant]')];
  if (!inputs.length) return;
  if (inputs.some((i) => i.value !== '') && C.tipo !== 'ajuste') return;
  let foco = inputs[0];
  if (C.tipo === 'nacimiento') foco = inputs.find((i) => i.dataset.cant === NACEN.find((id) => cat(id)?.activa)) || foco;
  else if (C.atajo) {
    const st = stockEn(C.rodeoO, fechaSesion());
    const fs = filasAtajo(atajo(C.atajo), C.rodeoO, destinoAtajo(atajo(C.atajo)));
    const k = fs.find((f) => st[f.catO] > 0)?.key;
    foco = inputs.find((i) => i.dataset.cant === k) || foco;
  }
  else if (['mortandad', 'venta', 'traslado'].includes(C.tipo)) {
    const st = stockEn(C.rodeoO, fechaSesion());
    foco = inputs.find((i) => st[i.dataset.cant] > 0) || foco;
  } else if (C.tipo === 'cambio_categoria' && !C.atajo) {
    const prob = (S.meta.ultimoDestino || {})[C.catO] || DESTINO_PROBABLE[C.catO];
    foco = inputs.find((i) => i.dataset.cant === prob) || foco;
  } else if (C.tipo === 'ajuste') {
    if (inputs.some((i) => i.value !== '')) return; // ya precargado desde una diferencia: no tapar
    const st = stockEn(C.rodeoO, fechaSesion());
    foco = inputs.find((i) => st[i.dataset.cant] > 0) || foco;
  }
  foco.focus({ preventScroll: true });
}

async function guardarCarga() {
  leerCantVisibles();
  if (revisarFechaSesion()) {
    await guardarMeta(); render();
    toast('Cambió el día: la fecha de carga volvió a hoy. Revisala y tocá Guardar de nuevo.');
    return;
  }
  const err = $('#c-error');
  const pares = [];
  for (const [key, v] of Object.entries(C.cant)) {
    if (v === '' || v == null) continue;
    if (!/^\d+$/.test(v) || Number(v) === 0) { err.textContent = `La cantidad de ${etiquetaCant(key)} tiene que ser un número entero mayor que cero.`; return; }
    pares.push([key, Number(v)]);
  }
  if (!pares.length) { err.textContent = 'Escribí al menos una cantidad.'; return; }
  if (C.tipo === 'ajuste' && !C.motivo) { err.textContent = 'El ajuste necesita un motivo: tocá uno o escribilo.'; return; }
  const lote = pares.length > 1 ? L.nuevoId() : null;
  const base = { nota: C.nota, caravana: C.caravana, motivo: C.motivo, lote };
  const r = C.rodeoO;
  const nuevos = [];
  for (const [key, n] of pares) {
    switch (C.tipo) {
      case 'nacimiento': case 'ingreso': nuevos.push(nuevoMov({ ...base, tipo: C.tipo, cantidad: n, destino: { rodeoId: r, categoriaId: key } })); break;
      case 'mortandad': case 'venta': nuevos.push(nuevoMov({ ...base, tipo: C.tipo, cantidad: n, origen: { rodeoId: r, categoriaId: key } })); break;
      case 'traslado': nuevos.push(nuevoMov({ ...base, tipo: 'traslado', cantidad: n, origen: { rodeoId: r, categoriaId: key }, destino: { rodeoId: C.rodeoD, categoriaId: key } })); break;
      case 'ajuste': nuevos.push(nuevoMov({ ...base, tipo: 'ajuste', cantidad: n, conteoId: C.vinc[key] || null, [C.signo === 1 ? 'destino' : 'origen']: { rodeoId: r, categoriaId: key } })); break;
      case 'cambio_categoria': {
        let origCat = C.catO, destCat = key, destRodeo = C.rodeoD || r;
        if (C.atajo) {
          const a = atajo(C.atajo), dest = destinoAtajo(a);
          const f = filasAtajo(a, r, dest).find((x) => x.key === key);
          if (!f) continue;
          destRodeo = f.rodeo || dest;
          if (!destRodeo) { err.textContent = 'Elegí a qué rodeo van.'; return; }
          origCat = f.catO; destCat = f.cat;
        }
        const tipo = destCat === origCat ? 'traslado' : 'cambio_categoria';
        nuevos.push(nuevoMov({ ...base, tipo, cantidad: n, origen: { rodeoId: r, categoriaId: origCat }, destino: { rodeoId: destRodeo, categoriaId: destCat } }));
        break;
      }
    }
  }
  if (!nuevos.length) { err.textContent = 'Escribí al menos una cantidad.'; return; }
  if (!(await registrar(nuevos))) return;
  // Aviso suave: categorías que no son las habituales del rodeo (no bloquea: ya se guardó).
  const fuera = [...new Set(nuevos.flatMap((m) => [m.destino && fueraDeLoEsperado(m.destino.rodeoId, [m.destino.categoriaId]).length ? `${nomC(m.destino.categoriaId)} en ${nomR(m.destino.rodeoId)}` : null]).filter(Boolean))];
  if (C.tipo === 'cambio_categoria' && !C.atajo && pares.length === 1) {
    S.meta.ultimoDestino = { ...(S.meta.ultimoDestino || {}), [C.catO]: pares[0][0] };
    guardarMeta();
  }
  const d = describir(nuevos[0]);
  toast(`Guardado: ${d.tipo} · ${nuevos.length > 1 ? nuevos.length + ' renglones' : d.lugar}${fuera.length ? ` · Ojo: ${fuera.join(', ')} no es lo habitual` : ''}`);
  C = nuevaCarga(); render();
}

function etiquetaCant(key) {
  if (C.atajo) { const f = filasAtajo(atajo(C.atajo), C.rodeoO, destinoAtajo(atajo(C.atajo))).find((x) => x.key === key); return f ? f.texto : key; }
  return nomC(key);
}

// =============== STOCK ===============
// Tabla rodeo × categoría como la planilla en papel. sinCeros: oculta las columnas sin ningún animal.
function tablaStock(mapa, { conUbic = true, sinCeros = true, soloConAnimales = false } = {}) {
  const t = L.totales(mapa);
  const catsConDato = new Set(), rodeosConDato = new Set();
  for (const [k, v] of mapa) if (v) { const { rodeoId, categoriaId } = L.desarmarClave(k); catsConDato.add(categoriaId); rodeosConDato.add(rodeoId); }
  const rs = S.rodeos.filter((r) => (soloConAnimales ? rodeosConDato.has(r.id) : (r.activo || rodeosConDato.has(r.id)))).sort((a, b) => a.orden - b.orden);
  const cs = S.categorias.filter((c) => (sinCeros ? catsConDato.has(c.id) : (c.activa || catsConDato.has(c.id)))).sort((a, b) => a.orden - b.orden);
  const celda = (v) => `<td class="${v < 0 ? 'neg' : ''}">${v ? num(v) : ''}</td>`;
  const filas = rs.map((r) => `<tr><td class="txt">${esc(r.nombre)}${conUbic && r.ubicacion ? `<span class="ubic">${esc(r.ubicacion)}</span>` : ''}</td>${cs.map((c) => celda(mapa.get(L.clave(r.id, c.id)) || 0)).join('')}<td class="${(t.porRodeo.get(r.id) || 0) < 0 ? 'neg' : ''}"><b>${num(t.porRodeo.get(r.id) || 0)}</b></td></tr>`).join('');
  const tot = `<tr class="tot"><td class="txt">Totales</td>${cs.map((c) => `<td>${num(t.porCategoria.get(c.id) || 0)}</td>`).join('')}<td>${num(t.total)}</td></tr>`;
  return { html: `<table class="planilla"><thead><tr><th class="txt">Rodeo</th>${cs.map((c) => `<th>${esc(c.nombre)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${filas}${tot}</tbody></table>`, rs, cs, t };
}

function vacasDe(t) { return S.categorias.filter((c) => c.cuentaComoVaca).reduce((s, c) => s + (t.porCategoria.get(c.id) || 0), 0); }

function tarjetasRodeo(mapa, t) {
  const cs = [...S.categorias].sort((a, b) => a.orden - b.orden);
  const rs = [...S.rodeos].sort((a, b) => a.orden - b.orden);
  const con = [], sin = [];
  for (const r of rs) {
    const items = cs.map((c) => [c, mapa.get(L.clave(r.id, c.id)) || 0]).filter(([, v]) => v !== 0);
    if (items.length) con.push(`<div class="tarjeta rodeo-card"><div class="rc-cab"><div><b>${esc(r.nombre)}</b>${r.ubicacion ? `<div class="chico">${esc(r.ubicacion)}</div>` : ''}</div><div class="rc-total ${(t.porRodeo.get(r.id) || 0) < 0 ? 'neg' : ''}">${num(t.porRodeo.get(r.id) || 0)}</div></div>
      ${items.map(([c, v]) => `<div class="rc-fila"><span>${esc(c.nombre)}</span><span class="${v < 0 ? 'neg' : ''}">${num(v)}</span></div>`).join('')}</div>`);
    else if (r.activo) sin.push(esc(r.nombre));
  }
  return con.join('') + (sin.length ? `<p class="chico">Rodeos sin animales: ${sin.join(', ')}.</p>` : '');
}

function vStock() {
  const f = stockFecha || hoyIso();
  const mapa = IDX().stockMapa(f);
  const t = L.totales(mapa);
  if (!S.movimientos.length) {
    return `<h1>Stock</h1><div class="tarjeta"><p><b>Todavía no hay movimientos cargados.</b></p>
      <p>Para empezar, cargá el saldo inicial (lo que dice la última planilla) o importá tu archivo de arranque.</p>
      <div class="fila-btns"><button class="btn prim" data-ir="mas" data-sub="saldo">Cargar saldo inicial</button><button class="btn" data-ir="mas" data-sub="backup">Importar archivo</button></div></div>`;
  }
  const est = L.diferenciasConteo(S.conteos, S.movimientos, IDX());
  const rojas = est.filter((d) => L.ROJOS.has(d.estado)).length;
  const ambar = est.filter((d) => d.estado === 'cuadra_sin_confirmar').length;
  const negLista = [...mapa.entries()].filter(([, v]) => v < 0).map(([k, v]) => ({ ...L.desarmarClave(k), v }))
    .sort((a, b) => (rodeo(a.rodeoId)?.orden ?? 999) - (rodeo(b.rodeoId)?.orden ?? 999) || (cat(a.categoriaId)?.orden ?? 999) - (cat(b.categoriaId)?.orden ?? 999));
  const negs = negLista.length;
  const MAXNEG = 10;
  const avisoNeg = negs ? `<div class="aviso rojo" role="alert">${num(negs)} casilla${negs > 1 ? 's' : ''} en negativo al ${fFecha(f)}:
      <ul class="lista-neg">${negLista.slice(0, MAXNEG).map((n) => `<li>${esc(nomR(n.rodeoId))} · ${esc(nomC(n.categoriaId))}: ${num(n.v)}</li>`).join('')}</ul>
      ${negs > MAXNEG ? `<div>y ${num(negs - MAXNEG)} más.</div>` : ''}<div class="chico-aviso">Revisá los movimientos de esas casillas en Más → Movimientos.</div></div>` : '';
  const nombresVaca = S.categorias.filter((c) => c.cuentaComoVaca).map((c) => c.nombre).join(' + ') || 'ninguna categoría marcada';
  let cuerpo;
  if (stockModo === 'categoria') {
    cuerpo = `<div class="tarjeta">${S.categorias.filter((c) => c.activa || t.porCategoria.get(c.id)).sort((a, b) => a.orden - b.orden).map((c) => {
      const v = t.porCategoria.get(c.id) || 0;
      return `<div class="rc-fila grande-fila"><span>${esc(c.nombre)}</span><span class="${v < 0 ? 'neg' : ''}">${num(v)}</span></div>`;
    }).join('')}<div class="rc-fila grande-fila tot-fila"><span>Total</span><span>${num(t.total)}</span></div></div>`;
  } else if (stockModo === 'planilla') {
    cuerpo = `<p class="chico">Como la planilla en papel. Deslizá la tabla de costado para ver todas las columnas → (solo se muestran las categorías con animales).</p><div class="tabla-wrap">${tablaStock(mapa).html}</div>`;
  } else cuerpo = tarjetasRodeo(mapa, t);
  return `<h1>Stock</h1>
    <div class="fecha-sesion"><label for="f-stock">Stock al:</label><input type="date" id="f-stock" value="${f}"></div>
    <div class="tarjeta"><div class="chico">Total de cabezas al ${fFecha(f)}</div><div class="total-grande">${num(t.total)}</div>
      <div>Vacas: <b>${num(vacasDe(t))}</b> <span class="chico">(${esc(nombresVaca)})</span></div>
      <div class="chico">Calculado con ${num(activos().length)} movimientos.</div></div>
    ${avisoNeg}
    ${rojas ? `<button class="aviso rojo" data-ir="conteos">${num(rojas)} diferencia${rojas > 1 ? 's' : ''} de conteo sin explicar. Tocá para verlas.</button>` : ''}
    ${ambar ? `<button class="aviso" data-ir="conteos">${num(ambar)} diferencia${ambar > 1 ? 's' : ''} que ahora cuadra${ambar > 1 ? 'n' : ''}: falta confirmar la explicación.</button>` : ''}
    <div class="fila-btns"><button class="btn ${stockModo === 'rodeo' ? 'sel' : ''}" data-stockmodo="rodeo">Por rodeo</button><button class="btn ${stockModo === 'categoria' ? 'sel' : ''}" data-stockmodo="categoria">Por categoría</button><button class="btn ${stockModo === 'planilla' ? 'sel' : ''}" data-stockmodo="planilla">Ver como planilla</button></div>
    ${cuerpo}`;
}

// =============== CONTEOS ===============
const NOMBRE_ESTADO = {
  sin_explicar: 'Diferencia sin explicar', reabierta: 'Diferencia reabierta', cuadra_sin_confirmar: 'Cuadra ahora: falta confirmar la explicación',
  explicada: 'Explicada', cuadra: 'Cuadra', anulado: 'Conteo anulado',
  a_revisar: 'Conteo viejo a revisar',
};
const CLASE_ESTADO = {
  sin_explicar: 'rojo sin_explicar', reabierta: 'rojo sin_explicar reabierta', cuadra_sin_confirmar: 'ambar cuadra_sin_confirmar',
  explicada: 'explicada', cuadra: 'cuadra', anulado: 'anulado',
  a_revisar: 'rojo sin_explicar a_revisar',
};

function vConteos() {
  if (CT.modo === 'nuevo') return vConteoNuevo();
  const est = L.estadoConteos(S.conteos, S.movimientos, IDX());
  const porFecha = (a, b) => (a.conteo.fecha < b.conteo.fecha ? 1 : a.conteo.fecha > b.conteo.fecha ? -1 : (a.conteo.creado < b.conteo.creado ? 1 : -1));
  const abiertas = est.filter((d) => L.ABIERTOS.has(d.estado)).sort((a, b) => (L.ROJOS.has(b.estado) - L.ROJOS.has(a.estado)) || porFecha(a, b));
  const cerradas = est.filter((d) => d.estado === 'explicada' || d.estado === 'cuadra').sort(porFecha);
  const anuladas = est.filter((d) => d.estado === 'anulado').sort(porFecha);
  const rojas = abiertas.filter((d) => L.ROJOS.has(d.estado)).length, ambar = abiertas.length - rojas;
  const pis = L.pistas(abiertas);
  // Se dibujan de a tandas (con miles de conteos, dibujar todo de una traba el teléfono). Los números de arriba cuentan todo.
  const verAbiertas = abiertas.slice(0, abiertasVer);
  const expl = L.movimientosQueExplican(verAbiertas.filter((d) => d.estado === 'cuadra_sin_confirmar'), S.movimientos);
  const verCerradas = cerradas.slice(0, conteosVer), verAnul = anuladas.slice(0, anuladosVer);
  return `<h1>Conteos</h1>
    <button class="btn prim grande" data-acc="nuevo-conteo">Cargar un conteo</button>
    <div class="tarjeta">${rojas ? `<b class="error">${num(rojas)} diferencia${rojas > 1 ? 's' : ''} sin explicar</b>` : '<b>No hay diferencias sin explicar.</b>'}
      ${ambar ? `<div><b>${num(ambar)} que ahora cuadra${ambar > 1 ? 'n' : ''}, falta confirmar.</b></div>` : ''}
      <div class="chico">La diferencia es lo contado menos lo que da el libro a esa fecha. Queda marcada hasta que la expliques con un motivo: con un ajuste, o confirmando que la explican los movimientos que cargaste después.</div></div>
    ${verAbiertas.map((d) => itemConteo(d, pis, expl)).join('')}
    ${abiertas.length > abiertasVer ? `<button class="btn grande" data-acc="ver-mas-abiertas">Ver más diferencias (${num(abiertas.length - abiertasVer)} más)</button>` : ''}
    ${cerradas.length ? `<h2>Cuadran o están explicados (${num(cerradas.length)})</h2>${verCerradas.map((d) => itemConteo(d)).join('')}
      ${cerradas.length > conteosVer ? `<button class="btn grande" data-acc="ver-mas-conteos">Ver más</button>` : ''}` : ''}
    ${anuladas.length ? `<h2>Conteos anulados (${num(anuladas.length)})</h2>${verAnul.map((d) => itemConteo(d)).join('')}
      ${anuladas.length > anuladosVer ? `<button class="btn grande" data-acc="ver-mas-anulados">Ver más</button>` : ''}` : ''}
    ${!S.conteos.length ? '<p>Todavía no cargaste conteos.</p>' : ''}`;
}

const RAZON_VIEJA = {
  anulado: 'se anuló un movimiento que confirmaba',
  corregido: 'se corrigió un movimiento que confirmaba',
  reemplazada: 'la reemplaza una confirmación posterior',
};

function itemConteo(d, pis = new Map(), expl = new Map()) {
  const c = d.conteo;
  const lineas = [];
  lineas.push(`<div>Contado <b>${num(c.cantidad)}</b> · Según el libro <b>${num(d.calculado)}</b></div>`);
  // La diferencia del momento de contar se muestra siempre. Si ya se explicó una parte, se ve cuánto y cuánto falta.
  if (d.original !== null && d.original !== 0 && d.estado !== 'anulado') {
    const explicado = d.original - d.pendiente;
    const parcial = L.ROJOS.has(d.estado) && !d.dobleDescuento && d.pendiente !== 0 && explicado !== 0
      && Math.sign(d.pendiente) === Math.sign(d.original) && Math.abs(d.pendiente) < Math.abs(d.original);
    lineas.push(parcial
      ? `<div class="linea-orig">Al contar, la diferencia era <b>${numS(d.original)}</b> · explicado: <b>${numS(explicado)}</b> · falta: <b>${numS(d.pendiente)}</b></div>`
      : `<div class="chico">Al contar, la diferencia era <b>${numS(d.original)}</b>.</div>`);
  }
  for (const m of d.ajustes) {
    const val = m.cantidad === 0 && d.validezConfirmaciones ? d.validezConfirmaciones.get(m.id) : null;
    if (val && !val.vale) {
      lineas.push(`<div class="chico conf-vieja"><s>Explicación confirmada (${fFecha(m.fecha)}): ${esc(m.motivo)}</s> <b>(ya no vale: ${RAZON_VIEJA[val.razon]})</b></div>`);
      continue;
    }
    lineas.push(`<div class="chico">${m.cantidad === 0 ? 'Explicación confirmada' : `Ajuste ${numS(L.signoAjuste(m))}`} (${fFecha(m.fecha)}): ${esc(m.motivo)}</div>`);
  }
  let botones = '';
  if (d.estado === 'a_revisar') {
    lineas.push(`<div>Este conteo viene de una versión anterior de la app y no se sabe qué diferencia había al contar. Hoy cuadra con el libro, pero no se da por bueno sin que lo confirmes.</div>`);
    botones += `<button class="btn prim" data-confirmar="${c.id}">Confirmar explicación</button>`;
  } else if (L.ROJOS.has(d.estado)) {
    lineas.push(`<div class="num-dif">${numS(d.pendiente)}</div>`);
    if (d.dobleDescuento) {
      lineas.push(`<div class="pista"><b>Posible doble descuento:</b> los movimientos cargados ya explican la diferencia y además hay un ajuste. Si el ajuste era por lo mismo, anulá el ajuste.</div>`);
      botones += d.ajustes.filter((m) => m.cantidad !== 0).map((m) => `<button class="btn prim" data-anular="${m.id}">Anular el ajuste ${numS(L.signoAjuste(m))}</button>`).join('');
    } else botones += `<button class="btn prim" data-explicar="${c.id}">Explicar con ajuste</button>`;
    for (const p of pis.get(c.id) || []) {
      lineas.push(`<div class="pista">Pista: ${p.tipo === 'categoria'
        ? `en este mismo rodeo, ${esc(nomC(p.con.conteo.categoriaId))} tiene la diferencia contraria (${numS(p.con.pendiente)}). ¿Falta cargar un cambio de categoría?`
        : `en ${esc(nomR(p.con.conteo.rodeoId))} la misma categoría tiene la diferencia contraria (${numS(p.con.pendiente)}). ¿Falta cargar un traslado?`}</div>`);
    }
  } else if (d.estado === 'cuadra_sin_confirmar') {
    const ms = expl.get(c.id) || [];
    lineas.push(`<div>Cuadra por movimientos cargados después del conteo:</div>${ms.length ? `<ul class="lista-expl">${ms.map((m) => { const x = describir(m); return `<li>${esc(x.tipo)} ${fFecha(m.fecha)} · ${esc(x.lugar)}${m.motivo ? ` · Motivo: ${esc(m.motivo)}` : ''}${m.nota ? ` · ${esc(m.nota)}` : ''}</li>`; }).join('')}</ul>` : ''}`);
    botones += `<button class="btn prim" data-confirmar="${c.id}">Confirmar explicación</button>`;
  }
  if (d.estado === 'anulado') lineas.push(`<div class="anul">Anulado el ${fFechaDe(c.anulado.fecha)}: ${esc(c.anulado.motivo)}${d.original ? ` · al contar la diferencia era ${numS(d.original)}` : ''}</div>`);
  else botones += `<button class="btn" data-anularconteo="${c.id}">Anular conteo</button>`;
  return `<div class="dif ${CLASE_ESTADO[d.estado]}">
    <div class="estado">${NOMBRE_ESTADO[d.estado]}</div>
    <div class="desc"><b>${esc(nomR(c.rodeoId))} · ${esc(nomC(c.categoriaId))}</b> · ${fFecha(c.fecha)}${c.origen ? ` · ${esc(c.origen)}` : ''}</div>
    ${lineas.join('')}
    ${botones ? `<div class="fila-btns">${botones}</div>` : ''}
  </div>`;
}

function vConteoNuevo() {
  const f = CT.fecha || fechaSesion();
  const ant = CT.fechaAnterior && CT.fechaAnterior !== f
    ? `<button class="btn" data-acc="seguir-fecha-conteo">Seguir con el conteo del ${fFecha(CT.fechaAnterior)}</button>` : '';
  const vals = CT.vals || {};
  if (!CT.rodeo) {
    return `<div class="fila-btns"><button class="btn" data-acc="conteo-cancelar">← Volver</button></div>
      <div class="fecha-sesion"><label for="f-conteo">Fecha del conteo:</label><input type="date" id="f-conteo" value="${f}">${ant}</div>
      <h1>¿Qué rodeo se contó?</h1>${gridRodeos('conteo')}`;
  }
  return `<div class="fila-btns"><button class="btn" data-acc="conteo-atras">← Atrás</button></div>
    <div class="fecha-sesion"><label for="f-conteo">Fecha del conteo:</label><input type="date" id="f-conteo" value="${f}">${ant}</div>
    <div class="resumen-sel"><b>Conteo</b> · ${esc(nomR(CT.rodeo))}</div>
    <h1>¿Cuántos se contaron?</h1><p class="chico">Dejá vacío lo que no se contó. Escribí 0 si se contó y no había ninguno.</p>
    ${(() => {
      const { principales, otras } = catsDelRodeo(CT.rodeo, f, { escritas: vals });
      const fila = (c) => `<div class="cant-fila"><div class="nom">${esc(c.nombre)}</div><input class="num" type="text" inputmode="numeric" pattern="[0-9]*" data-ccant="${c.id}" aria-label="${esc(c.nombre)}" autocomplete="off" value="${esc(vals[c.id] || '')}"></div>`;
      return principales.map(fila).join('') + plegadas(otras, otras.map(fila).join(''));
    })()}
    <details${CT.origenTxt || CT.notaTxt ? ' open' : ''}><summary>Quién o cómo se contó (opcional)</summary>
      <label class="campo"><span>Origen del conteo (ej.: tranquera, conteo 2, acta de vacunación)</span><input type="text" id="ct-origen" autocomplete="off" value="${esc(CT.origenTxt || '')}"></label>
      <label class="campo"><span>Nota (opcional)</span><textarea id="ct-nota" rows="2" autocomplete="off">${esc(CT.notaTxt || '')}</textarea></label></details>
    <div class="error" id="ct-error"></div>
    <button class="btn prim grande" data-acc="guardar-conteo">Guardar conteo</button>`;
}

function postConteos() {
  if (CT.modo === 'nuevo' && CT.rodeo) document.querySelector('[data-ccant]')?.focus({ preventScroll: true });
}

async function guardarConteo() {
  leerConteoVisibles();
  if (revisarFechaConteo()) {
    render();
    toast('Cambió el día: la fecha del conteo volvió a hoy. Revisala y tocá Guardar de nuevo.');
    return;
  }
  const err = $('#ct-error');
  const fecha = $('#f-conteo').value;
  if (!fecha) { err.textContent = 'Falta la fecha del conteo.'; return; }
  const origen = $('#ct-origen').value.trim(), nota = $('#ct-nota').value.trim();
  const nuevos = [];
  const idx = IDX();
  for (const i of document.querySelectorAll('[data-ccant]')) {
    const v = i.value.trim(); if (v === '') continue;
    if (!/^\d+$/.test(v)) { err.textContent = `${nomC(i.dataset.ccant)}: escribí un número entero.`; return; }
    const c = { id: L.nuevoId(), fecha, rodeoId: CT.rodeo, categoriaId: i.dataset.ccant, cantidad: Number(v), origen, nota, creado: new Date().toISOString(), anulado: null };
    // La diferencia del momento queda guardada en el conteo: aunque después cuadre, se sabe que la hubo.
    c.calculadoAlContar = idx.stockA(L.clave(c.rodeoId, c.categoriaId), fecha);
    c.diferenciaOriginal = L.diferenciaAlContar(c, idx);
    nuevos.push(c);
  }
  if (!nuevos.length) { err.textContent = 'Escribí al menos una cantidad contada.'; return; }
  try { await DB.guardar({ conteos: nuevos }); } catch (e) { err.innerHTML = 'No se pudo guardar. ' + mensajeError(e, 'db'); return; }
  S.conteos = S.conteos.concat(nuevos);
  const malas = nuevos.filter((c) => c.diferenciaOriginal !== 0).length;
  toast(malas ? `Conteo guardado: ${malas} diferencia${malas > 1 ? 's' : ''}` : 'Conteo guardado: todo cuadra');
  CT = { modo: 'lista' }; render();
}

function difDe(conteoId) {
  const c = S.conteos.find((x) => x.id === conteoId);
  return c ? L.estadoConteos([c], S.movimientos, IDX())[0] : null;
}

async function explicar(conteoId) {
  const d = difDe(conteoId);
  if (!d || !L.ROJOS.has(d.estado)) return;
  const c = d.conteo, p = d.pendiente;
  const motivo = await pedirMotivo('Explicar diferencia',
    `<p><b>${esc(nomR(c.rodeoId))} · ${esc(nomC(c.categoriaId))}</b> al ${fFecha(c.fecha)}: contado ${num(c.cantidad)}, según el libro ${num(d.calculado)}.</p>
     <p>Se carga un ajuste de <b>${numS(p)}</b> con fecha ${fFecha(c.fecha)}.</p>
     <p class="chico">Si sabés qué pasó (una muerte o un traslado que no se cargó), mejor cargá ese movimiento y después confirmá la explicación.</p>`, true);
  if (!motivo) return;
  const lado = { rodeoId: c.rodeoId, categoriaId: c.categoriaId };
  const m = nuevoMov({ tipo: 'ajuste', fecha: c.fecha, cantidad: Math.abs(p), motivo, conteoId: c.id, [p > 0 ? 'destino' : 'origen']: lado });
  if (await registrar([m])) { toast('Ajuste guardado'); render(); }
}

// Ámbar → explicada: se deja escrito con motivo qué explicó la diferencia (ajuste de 0, no cambia el stock).
async function confirmarExplicacion(conteoId) {
  const d = difDe(conteoId);
  if (!d || (d.estado !== 'cuadra_sin_confirmar' && d.estado !== 'a_revisar')) return;
  const c = d.conteo;
  const ms = d.estado === 'a_revisar' ? [] : (L.movimientosQueExplican([d], S.movimientos).get(c.id) || []);
  const sugerido = ms.length ? 'Explicada por: ' + ms.map((m) => { const x = describir(m); return `${x.tipo} ${fFecha(m.fecha)} (${x.lugar})${m.motivo ? ' — ' + m.motivo : ''}`; }).join('; ') : '';
  const que = d.estado === 'a_revisar'
    ? 'es un conteo de una versión anterior: no se sabe qué diferencia había al contar. Hoy cuadra con el libro.'
    : `al contar la diferencia era ${numS(d.original)} y ahora cuadra.`;
  const motivo = await pedirMotivo('Confirmar explicación',
    `<p><b>${esc(nomR(c.rodeoId))} · ${esc(nomC(c.categoriaId))}</b> al ${fFecha(c.fecha)}: ${que}</p>
     <p class="chico">Confirmar no cambia el stock: deja escrito por qué cuadra. Revisá o cambiá el motivo.</p>`, false, sugerido);
  if (!motivo) return;
  // Se guarda qué movimientos se confirmaron: si después se anula alguno, la confirmación deja de valer.
  const m = nuevoMov({ tipo: 'ajuste', fecha: c.fecha, cantidad: 0, motivo, conteoId: c.id, destino: { rodeoId: c.rodeoId, categoriaId: c.categoriaId }, extra: { confirma: ms.map((x) => x.id) } });
  if (await registrar([m])) { toast('Explicación confirmada'); render(); }
}

async function anularConteo(id) {
  const c = S.conteos.find((x) => x.id === id);
  const motivo = await pedirMotivo('Anular conteo', `<p>${esc(nomR(c.rodeoId))} · ${esc(nomC(c.categoriaId))} · ${fFecha(c.fecha)} · contado ${num(c.cantidad)}.</p><p class="chico">No se borra: queda en la lista de conteos anulados, tachado, con el motivo.</p>`);
  if (!motivo) return;
  const n = { ...c, anulado: { fecha: new Date().toISOString(), motivo } };
  try { await DB.guardar({ conteos: [n] }); } catch (e) { await aviso('No se pudo anular', `<p class="error">${mensajeError(e, 'db')}</p>`); return; }
  S.conteos = S.conteos.map((x) => (x.id === id ? n : x));
  toast('Conteo anulado'); render();
}

// =============== HISTORIAL ===============
const RESUMEN_TIPOS = [['nacimiento', 'Nacimientos'], ['mortandad', 'Mortandad'], ['venta', 'Ventas'], ['ingreso', 'Ingresos / compras'], ['ajuste', 'Ajustes']];
// El historial se recalcula solo si cambió el libro o el día.
let histRef = null, histDia = null, histVal = null;
function historial() {
  const hoy = hoyIso();
  if (histRef !== S.movimientos || histDia !== hoy) { histVal = L.historialMensual(S.movimientos, hoy).reverse(); histRef = S.movimientos; histDia = hoy; }
  return histVal;
}
function vHistorial() {
  const h = historial();
  if (!h.length) return '<h1>Historial mensual</h1><p>Todavía no hay movimientos.</p>';
  const cs = [...S.categorias].sort((a, b) => a.orden - b.orden);
  // Se dibujan los últimos 24 meses; los anteriores, a pedido (con años de datos, dibujar todo traba el teléfono).
  const tarjetas = h.slice(0, histVer).map((f) => {
    const mov = RESUMEN_TIPOS.filter(([k]) => f.resumen[k]).map(([k, n]) => `<div class="rc-fila"><span>${n}</span><span>${k === 'ajuste' ? numS(f.resumen[k]) : num(f.resumen[k])}</span></div>`).join('');
    const porCat = cs.map((c) => [c, f.porCategoria.get(c.id) || 0]).filter(([, v]) => v).map(([c, v]) => `<div class="rc-fila"><span>${esc(c.nombre)}</span><span class="${v < 0 ? 'neg' : ''}">${num(v)}</span></div>`).join('');
    return `<div class="tarjeta"><div class="rc-cab"><div><b>${fMes(f.mes)}</b><div class="chico">al ${fFecha(f.fecha)}</div></div><div class="rc-total">${num(f.total)}</div></div>
      ${f.variacion !== null ? `<div class="rc-fila"><span>Variación contra el mes anterior</span><span class="${f.variacion < 0 ? 'neg' : ''}"><b>${numS(f.variacion)}</b></span></div>` : ''}
      ${mov ? `<div class="hist-sub">Movimientos del mes</div>${mov}` : ''}
      ${porCat ? `<div class="hist-sub">Stock por categoría al cierre</div>${porCat}` : ''}</div>`;
  }).join('');
  const mas = h.length > histVer ? `<button class="btn grande" data-acc="ver-mas-meses">Ver meses anteriores (${num(h.length - histVer)} más)</button>` : '';
  return `<h1>Historial mensual</h1><p class="chico">Stock al último día de cada mes (el mes en curso, con lo cargado hasta ahora). El saldo inicial no se cuenta como ingreso.</p>${tarjetas}${mas}`;
}

// =============== MÁS ===============
function vMas() {
  const sub = { menu: vMenu, informe: vInforme, movimientos: vMovimientos, rodeos: vRodeosCats, parametros: vParametros, backup: vBackup, saldo: vSaldo }[S.sub] || vMenu;
  const volver = S.sub !== 'menu' ? `<div class="fila-btns" style="justify-content:flex-start"><button class="btn" data-ir="mas">← Más</button></div>` : '';
  return volver + sub();
}

function vMenu() {
  const b = (sub, txt, det) => `<button class="btn grande" data-ir="mas" data-sub="${sub}" style="flex-direction:column">${txt}${det ? `<small style="font-weight:normal">${det}</small>` : ''}</button>`;
  return `<h1>Más</h1><div style="display:grid;gap:10px">
    ${b('informe', 'Informe para imprimir (PDF)')}
    ${b('movimientos', 'Movimientos cargados', 'Ver, anular o corregir')}
    ${b('backup', 'Backup', 'Exportar e importar (JSON y Excel)')}
    ${b('saldo', 'Saldo inicial', 'Transcribir la planilla de partida')}
    ${b('rodeos', 'Rodeos y categorías')}
    ${b('parametros', 'Datos a confirmar y membrete')}
  </div><p class="chico">Versión ${VERSION_APP}</p>`;
}

// ----- Informe -----
// Texto de usuario dentro de una cadena CSS: todo lo que no sea letra, número o puntuación segura se escribe
// como escape hexadecimal (\3C para "<", \22 para comillas…). Así un nombre nunca puede cerrar el <style>.
const cssStr = (s) => '"' + String(s ?? '').replace(/[^\p{L}\p{N} .,·:()\/-]/gu, (c) => '\\' + c.codePointAt(0).toString(16) + ' ') + '"';

// pantalla=true: vista previa en el teléfono. La planilla va en su propio recuadro deslizable y las
// diferencias como lista (en una tabla de 6 columnas no entran a 360 px). Impreso y descargado: tablas.
function htmlInforme({ limiteDifs = Infinity, pantalla = false } = {}) {
  const f = informeFecha || hoyIso();
  const P = S.parametros;
  const mapa = IDX().stockMapa(f);
  const { html: tabla, cs, t } = tablaStock(mapa, { conUbic: true, sinCeros: true, soloConAnimales: true });
  const sinAnimales = S.categorias.filter((c) => c.activa && !cs.includes(c)).map((c) => c.nombre);
  const est = L.diferenciasConteo(S.conteos, S.movimientos, IDX());
  const difs = est.filter((d) => L.ROJOS.has(d.estado)).sort((a, b) => (a.conteo.fecha < b.conteo.fecha ? 1 : a.conteo.fecha > b.conteo.fecha ? -1 : 0));
  const ambar = est.filter((d) => d.estado === 'cuadra_sin_confirmar').length;
  const emitido = fFechaHora();
  const titulo = [P.empresa, P.campo].filter(Boolean).join(' — ');
  const lineaId = [P.renspa ? `RENSPA ${esc(P.renspa)}` : '', P.mostrarCuitEnInforme && P.cuit ? `CUIT ${esc(P.cuit)}` : ''].filter(Boolean).join(' · ');
  // Encabezado y pie de cada hoja impresa (cajas de margen de @page): fecha y "Hoja X de Y" en todas las hojas.
  const cabHoja = `${titulo || 'Stock de hacienda'} · Stock al ${fFecha(f)} · Emitido ${emitido}`;
  const estiloHoja = `<style>@page { @top-left { content: ${cssStr(cabHoja)}; font: 9pt Arial, sans-serif; color: #333; } @bottom-right { content: "Hoja " counter(page) " de " counter(pages); font: 9pt Arial, sans-serif; color: #333; } }</style>`;
  return `${estiloHoja}<div class="hoja">
    <div class="membrete"><div class="emp">${esc(P.empresa || P.campo || 'Stock de hacienda')}</div><div>${[P.empresa ? `<b>${esc(P.campo)}</b>` : '', esc(P.localidad)].filter(Boolean).join(' · ')}</div>${lineaId ? `<div>${lineaId}</div>` : ''}</div>
    <div class="inf-titulo">Stock de hacienda al ${fFecha(f)}</div>
    <div>Emitido: ${emitido} · Total: <b>${num(t.total)}</b> cabezas · Vacas: <b>${num(vacasDe(t))}</b></div>
    <div class="pie">Calculado como suma de ${num(activos().filter((m) => m.fecha <= f).length)} movimientos registrados hasta el ${fFecha(f)}: nada se escribe a mano.${sinAnimales.length ? ` Sin animales: ${esc(sinAnimales.join(', '))}.` : ''}</div>
    ${pantalla ? `<p class="chico">La hoja impresa es apaisada: deslizá la planilla de costado para ver todas las columnas →</p><div class="inf-tabla tabla-wrap">${tabla}</div>` : `<div class="inf-tabla">${tabla}</div>`}
    <h3>Diferencias de conteo sin explicar: ${num(difs.length)}${ambar ? ` · que cuadran sin confirmar: ${num(ambar)}` : ''}</h3>
    ${difs.length && pantalla ? `<div class="inf-difs-lista">${difs.slice(0, limiteDifs).map((d) => `<div class="inf-dif"><b>${esc(nomR(d.conteo.rodeoId))} · ${esc(nomC(d.conteo.categoriaId))}</b> · ${fFecha(d.conteo.fecha)}<br>Contado ${num(d.conteo.cantidad)} · Según el libro ${num(d.calculado)} · Diferencia <b>${numS(d.pendiente)}</b></div>`).join('')}</div>${difs.length > limiteDifs ? `<p>Y ${num(difs.length - limiteDifs)} más: salen todas en el informe impreso o descargado.</p>` : ''}`
    : difs.length ? `<table class="inf-difs"><thead><tr><th>Fecha</th><th class="txt">Rodeo</th><th class="txt">Categoría</th><th>Contado</th><th>Según el libro</th><th>Diferencia</th></tr></thead><tbody>${difs.slice(0, limiteDifs).map((d) => `<tr><td>${fFecha(d.conteo.fecha)}</td><td class="txt">${esc(nomR(d.conteo.rodeoId))}</td><td class="txt">${esc(nomC(d.conteo.categoriaId))}</td><td>${num(d.conteo.cantidad)}</td><td>${num(d.calculado)}</td><td><b>${numS(d.pendiente)}</b></td></tr>`).join('')}</tbody></table>${difs.length > limiteDifs ? `<p>Y ${num(difs.length - limiteDifs)} más: salen todas en el informe impreso o descargado.</p>` : ''}` : '<p>Ninguna.</p>'}
  </div>`;
}

function vInforme() {
  return `<h1>Informe para imprimir</h1>
    <div class="fecha-sesion"><label for="f-informe">Stock al:</label><input type="date" id="f-informe" value="${informeFecha || hoyIso()}"></div>
    <div class="fila-btns"><button class="btn prim" data-acc="imprimir">Imprimir / Guardar PDF</button><button class="btn" data-acc="descargar-informe">Descargar informe (HTML para imprimir)</button></div>
    <p class="chico">En el celular: "Imprimir" y después "Guardar como PDF". Si no aparece, usá "Descargar informe" y abrilo para imprimir.</p>
    <div class="vista-previa">${htmlInforme({ limiteDifs: 30, pantalla: true })}</div>`;
}

async function cssTexto() {
  try { return await (await fetch('styles.css')).text(); } catch { return ''; }
}

async function descargarInforme() {
  const css = await cssTexto();
  const f = informeFecha || hoyIso();
  const html = `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'sha256-IcLpzmlTwKLTG1cpXxCHxGyx20mhnG5N6xlSbMZT3Gg='; base-uri 'none'; form-action 'none'"><title>Stock al ${esc(fFecha(f))}</title><style>${css}
body{padding:16px;background:#fff}</style></head><body class="solo-informe"><div id="impresion" style="display:block">${htmlInforme()}</div><p style="font-family:Arial"><button id="imprimir" type="button" style="min-height:52px;font-size:18px">Imprimir</button><script>document.getElementById('imprimir').addEventListener('click',function(){window.print()});</script></p><style>@media print{button{display:none}}</style></body></html>`;
  descargar(new Blob([html], { type: 'text/html' }), `stock-${f}.html`);
}

function prepararImpresion() { $('#impresion').innerHTML = htmlInforme(); }

// ----- Movimientos -----
function itemMov(m, conBotones = true) {
  const d = describir(m);
  let corr = '';
  if (m.corrigeA) {
    const a = m.antes;
    corr = a ? `Corrige el renglón anterior: ${[a.fecha !== m.fecha ? `fecha ${fFecha(a.fecha)} → ${fFecha(m.fecha)}` : '', a.cantidad !== m.cantidad ? `cantidad ${num(a.cantidad)} → ${num(m.cantidad)}` : '', (a.caravana || '') !== (m.caravana || '') ? `caravana "${esc(a.caravana || '')}" → "${esc(m.caravana || '')}"` : '', (a.nota || '') !== (m.nota || '') ? 'nota' : ''].filter(Boolean).join(', ') || 'sin cambios de datos'}` : 'Corrige un movimiento anterior';
  }
  const extra = [m.caravana ? `Caravana ${esc(m.caravana)}` : '', m.motivo ? `Motivo: ${esc(m.motivo)}` : '', m.nota ? esc(m.nota) : '', corr, m.lote ? 'Guardado junto con otros renglones' : ''].filter(Boolean).join(' · ');
  return `<div class="mov ${m.anulado ? 'anulado' : ''}">
    <div class="desc"><span class="tipo">${esc(d.tipo)}</span> · ${fFecha(m.fecha)}<br>${esc(d.lugar)}</div>
    ${extra ? `<div class="chico">${extra}</div>` : ''}
    ${m.anulado ? `<div class="anul">Anulado el ${fFechaDe(m.anulado.fecha)}: ${esc(m.anulado.motivo)}</div>` : conBotones ? `<div class="fila-btns"><button class="btn" data-corregir="${m.id}">Corregir</button><button class="btn peligro" data-anular="${m.id}">Anular</button></div>` : ''}
  </div>`;
}

function vMovimientos() {
  const lista = [...S.movimientos].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.creado < b.creado ? 1 : -1));
  return `<h1>Movimientos cargados</h1><p class="chico">${num(lista.length)} renglones (${num(lista.filter((m) => m.anulado).length)} anulados). Los anulados quedan tachados: nada se borra.</p>
    ${lista.slice(0, movsVer).map((m) => itemMov(m)).join('')}
    ${lista.length > movsVer ? `<button class="btn grande" data-acc="ver-mas">Ver más</button>` : ''}`;
}

// Un guardado de varias categorías (lote) es un solo hecho: se anula entero.
async function anularMov(id) {
  const m = S.movimientos.find((x) => x.id === id);
  const grupo = m.lote ? S.movimientos.filter((x) => x.lote === m.lote && !x.anulado) : [m];
  const desc = grupo.map((x) => { const d = describir(x); return `<li><b>${esc(d.tipo)}</b> · ${fFecha(x.fecha)} · ${esc(d.lugar)}</li>`; }).join('');
  const motivo = await pedirMotivo(grupo.length > 1 ? `Anular ${grupo.length} renglones` : 'Anular movimiento',
    `<ul>${desc}</ul>${grupo.length > 1 ? '<p>Se guardaron juntos, así que se anulan juntos. Si solo uno está mal, usá Corregir.</p>' : ''}<p class="chico">No se borra: queda tachado con el motivo, y el stock vuelve a como estaba sin él.</p>`);
  if (!motivo) return;
  if (await registrar([], { anular: grupo.map((x) => ({ mov: x, motivo })) })) { toast(grupo.length > 1 ? `${grupo.length} renglones anulados` : 'Movimiento anulado'); render(); }
}

async function corregirMov(id) {
  const m = S.movimientos.find((x) => x.id === id);
  const d = describir(m);
  const r = await modal(`<h2>Corregir movimiento</h2><p><b>${esc(d.tipo)}</b><br>${esc(d.lugar)}</p>
    <label class="campo"><span>Fecha</span><input type="date" id="k-fecha" value="${m.fecha}"></label>
    <label class="campo"><span>Cantidad</span><input class="num" type="text" inputmode="numeric" id="k-cant" value="${m.cantidad}"></label>
    <label class="campo"><span>Caravana N°</span><input type="text" id="k-car" value="${esc(m.caravana)}"></label>
    <label class="campo"><span>Nota</span><textarea id="k-nota" rows="3">${esc(m.nota)}</textarea></label>
    <label class="campo"><span>¿Por qué se corrige? (obligatorio)</span><textarea id="k-motivo" rows="2"></textarea></label>
    <p class="chico">El original queda anulado (tachado) y se guarda uno nuevo corregido. Para cambiar rodeo o categoría, anulalo y cargalo de nuevo.</p>
    <div class="error error-modal"></div>`,
    [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar corrección', clase: 'prim',
      validar: (el) => {
        if (!el.querySelector('#k-fecha').value) return 'Falta la fecha';
        const v = el.querySelector('#k-cant').value.trim();
        if (!/^\d+$/.test(v) || (Number(v) <= 0 && !(m.tipo === 'ajuste' && m.cantidad === 0))) return 'La cantidad tiene que ser un número mayor que cero';
        if (!el.querySelector('#k-motivo').value.trim()) return 'Escribí por qué se corrige';
        return true;
      },
      leer: (el) => ({ fecha: el.querySelector('#k-fecha').value, cantidad: Number(el.querySelector('#k-cant').value.trim()), caravana: el.querySelector('#k-car').value.trim(), nota: el.querySelector('#k-nota').value.trim(), motivo: el.querySelector('#k-motivo').value.trim() }) }]);
  if (!r) return;
  const nuevo = { ...m, id: L.nuevoId(), fecha: r.fecha, cantidad: r.cantidad, caravana: r.caravana, nota: r.nota, creado: new Date().toISOString(), anulado: null, corrigeA: m.id, lote: null,
    antes: { fecha: m.fecha, cantidad: m.cantidad, caravana: m.caravana || '', nota: m.nota || '' } };
  if (await registrar([nuevo], { anular: [{ mov: m, motivo: 'Corregido: ' + r.motivo }] })) { toast('Corrección guardada'); render(); }
}

// ----- Rodeos y categorías -----
function vRodeosCats() {
  const rs = [...S.rodeos].sort((a, b) => a.orden - b.orden);
  const cs = [...S.categorias].sort((a, b) => a.orden - b.orden);
  return `<h1>Rodeos y categorías</h1>
    <p class="chico">Cambiar un nombre no cambia los movimientos ya cargados. No se borran: se desactivan, así el historial queda entero.</p>
    <h2>Rodeos</h2>
    ${rs.map((r, i) => `<div class="cfg-fila">
      <label class="campo"><span>Nombre</span><input type="text" data-cfg="rodeo" data-id="${r.id}" data-campo="nombre" value="${esc(r.nombre)}"></label>
      <label class="campo"><span>Dónde está (texto libre, ej.: Enfrente, potrero)</span><input type="text" data-cfg="rodeo" data-id="${r.id}" data-campo="ubicacion" value="${esc(r.ubicacion)}"></label>
      <div class="chips-titulo">Categorías que suelen estar (ordena las casillas; no bloquea nada):</div>
      <div class="chips">${catsActivas().map((c) => { const on = (r.esperadas || []).includes(c.id); return `<button class="btn chip ${on ? 'sel' : ''}" data-esp="${r.id}" data-cat="${c.id}" aria-pressed="${on}">${on ? '✔ ' : ''}${esc(c.nombre)}</button>`; }).join('')}</div>
      <div class="fila-btns"><label class="check"><input type="checkbox" data-cfg="rodeo" data-id="${r.id}" data-campo="activo" ${r.activo ? 'checked' : ''}> Activo</label>
      <button class="btn" data-orden="rodeo" data-id="${r.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button><button class="btn" data-orden="rodeo" data-id="${r.id}" data-dir="1" ${i === rs.length - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button></div></div>`).join('')}
    <button class="btn grande" data-acc="agregar-rodeo">Agregar rodeo</button>
    <h2>Categorías</h2>
    ${cs.map((c, i) => `<div class="cfg-fila">
      <label class="campo"><span>Nombre</span><input type="text" data-cfg="cat" data-id="${c.id}" data-campo="nombre" value="${esc(c.nombre)}"></label>
      <label class="campo"><span>Equivale a (SENASA), opcional</span><input type="text" data-cfg="cat" data-id="${c.id}" data-campo="senasa" value="${esc(c.senasa || '')}"></label>
      <div class="chico">Sexo: ${c.sexo === 'H' ? 'hembra' : c.sexo === 'M' ? 'macho' : c.sexo === '?' ? 'sin sexar' : 'no aplica'}${c.bovino === false ? ' · no es bovino (no suma en SENASA)' : ''}${c.reemplazadaPor ? ` · categoría de la versión anterior, reemplazada por ${esc(nomC(c.reemplazadaPor))}` : ''}</div>
      <div class="fila-btns"><label class="check"><input type="checkbox" data-cfg="cat" data-id="${c.id}" data-campo="activa" ${c.activa ? 'checked' : ''}> Activa</label>
      <label class="check"><input type="checkbox" data-cfg="cat" data-id="${c.id}" data-campo="cuentaComoVaca" ${c.cuentaComoVaca ? 'checked' : ''}> Cuenta como vaca</label>
      <button class="btn" data-orden="cat" data-id="${c.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button><button class="btn" data-orden="cat" data-id="${c.id}" data-dir="1" ${i === cs.length - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button></div></div>`).join('')}
    <button class="btn grande" data-acc="agregar-cat">Agregar categoría</button>`;
}

async function cambiarCfg(el) {
  const lista = el.dataset.cfg === 'rodeo' ? S.rodeos : S.categorias;
  const x = lista.find((o) => o.id === el.dataset.id);
  const campo = el.dataset.campo;
  const v = el.type === 'checkbox' ? el.checked : el.value.trim();
  if (campo === 'nombre' && !v) { toast('El nombre no puede quedar vacío'); el.value = x.nombre; return; }
  x[campo] = v;
  await DB.guardar({ [el.dataset.cfg === 'rodeo' ? 'rodeos' : 'categorias']: [x] });
  toast('Guardado');
}

async function cambiarEsperada(rodeoId, catId) {
  const r = rodeo(rodeoId); if (!r) return;
  const esp = new Set(r.esperadas || []);
  if (esp.has(catId)) esp.delete(catId); else esp.add(catId);
  r.esperadas = S.categorias.filter((c) => esp.has(c.id)).map((c) => c.id);
  await DB.guardar({ rodeos: [r] });
  const y = window.scrollY; render(); window.scrollTo(0, y);
}

async function mover(tipo, id, dir) {
  const lista = (tipo === 'rodeo' ? S.rodeos : S.categorias).sort((a, b) => a.orden - b.orden);
  const i = lista.findIndex((o) => o.id === id), j = i + dir;
  if (j < 0 || j >= lista.length) return;
  [lista[i].orden, lista[j].orden] = [lista[j].orden, lista[i].orden];
  await DB.guardar({ [tipo === 'rodeo' ? 'rodeos' : 'categorias']: [lista[i], lista[j]] });
  render();
}

async function agregar(tipo) {
  const r = await modal(`<h2>Agregar ${tipo === 'rodeo' ? 'rodeo' : 'categoría'}</h2><label class="campo"><span>Nombre</span><input type="text" id="n-nombre"></label><div class="error error-modal"></div>`,
    [{ texto: 'Cancelar', valor: null }, { texto: 'Agregar', clase: 'prim', validar: (m) => (m.querySelector('#n-nombre').value.trim() ? true : 'Escribí un nombre'), leer: (m) => m.querySelector('#n-nombre').value.trim() }],
    (m) => m.querySelector('#n-nombre').focus());
  if (!r) return;
  if (tipo === 'rodeo') {
    const x = { id: 'r-' + L.nuevoId(), nombre: r, ubicacion: '', orden: Math.max(0, ...S.rodeos.map((o) => o.orden)) + 1, activo: true, esperadas: [] };
    await DB.guardar({ rodeos: [x] }); S.rodeos.push(x);
  } else {
    const x = { id: 'c-' + L.nuevoId(), nombre: r, orden: Math.max(0, ...S.categorias.map((o) => o.orden)) + 1, activa: true, cuentaComoVaca: false, senasa: '', sexo: '', bovino: true };
    await DB.guardar({ categorias: [x] }); S.categorias.push(x);
  }
  render();
}

// ----- Parámetros -----
const PARAMS_UI = [
  ['empresa', 'Empresa (membrete)'], ['campo', 'Campo (membrete)'], ['localidad', 'Localidad (membrete)'], ['renspa', 'RENSPA'], ['cuit', 'CUIT'],
  ['vacasDeclaradas', 'Cantidad de vacas declarada. Solo de referencia; el stock se calcula.'],
  ['porcentajeToros', '% de toros'], ['queEsEnfrente', 'Qué es "Enfrente"'],
];
// Calendario de cría (valores estándar para parición jul–sep, editables). No genera tareas: da contexto en los atajos.
const CALENDARIO_UI = [
  ['paricionDesde', 'Parición desde (dd/mm)'], ['paricionHasta', 'Parición hasta (dd/mm)'], ['servicio', 'Servicio'], ['inseminacion', 'Inseminación'],
  ['tacto', 'Tacto'], ['destete', 'Destete'], ['yerra', 'Yerra (marcación, castración, sexado)'], ['paseTerneros', 'Pase de terneros (ternera → vaquillona, ternero → torito)'],
  ['paseToro', 'Pase de torito a toro'], ['entoreVaquillonas', 'Entore de vaquillonas (15 o 27 meses: sin elegir)'],
];
function vParametros() {
  const P = S.parametros;
  return `<h1>Datos a confirmar y membrete</h1><p class="chico">Ninguno de estos datos está fijo en la app. Se guardan al salir de cada casilla.</p>
    ${PARAMS_UI.map(([k, t]) => { const val = String(P[k] ?? ''); return `<label class="campo"><span>${esc(t)}</span><input type="text" data-param="${k}" maxlength="${L.MAX_TEXTO}" value="${esc(val)}">${contadorHtml(k, val.length, L.MAX_TEXTO)}</label>`; }).join('')}
    <label class="check"><input type="checkbox" data-param="mostrarCuitEnInforme" ${P.mostrarCuitEnInforme ? 'checked' : ''}> Mostrar CUIT en el informe</label>
    <h2>Calendario de cría</h2><p class="chico">Valores estándar para una parición de julio a septiembre. Cambialos por los de tu campo.</p>
    ${CALENDARIO_UI.map(([k, t]) => { const val = String(P[k] ?? ''); return `<label class="campo"><span>${esc(t)}</span><input type="text" data-param="${k}" maxlength="${L.MAX_TEXTO}" value="${esc(val)}">${contadorHtml(k, val.length, L.MAX_TEXTO)}</label>`; }).join('')}
    <p class="chico">Qué cuenta como "vaca": se marca en Rodeos y categorías.</p>
    <label class="campo"><span>Potreros (uno por renglón, texto libre)</span><textarea data-param="potreros" maxlength="${L.MAX_TEXTO_LARGO}">${esc(P.potreros || '')}</textarea>${contadorHtml('potreros', (P.potreros || '').length, L.MAX_TEXTO_LARGO)}</label>
    <label class="campo"><span>Motivos rápidos de ajuste (uno por renglón; hasta ${L.MAX_LISTA} renglones de ${L.MAX_TEXTO} caracteres)</span><textarea data-param="motivosAjuste">${esc((P.motivosAjuste || []).join('\n'))}</textarea></label>`;
}
// Contador "caracteres usados / tope" debajo de cada casilla de Datos (el tope lo impone maxlength).
function contadorHtml(k, n, max) {
  return `<span class="contador" data-cont="${esc(k)}">${num(n)} de ${num(max)} caracteres</span>`;
}
async function cambiarParam(el) {
  const k = el.dataset.param;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  let recorte = null;
  if (k === 'motivosAjuste' || typeof v === 'string') {
    // Mismo ajuste que al importar: lo largo se recorta (sin partir emojis) y se avisa; nunca se vacía.
    const crudo = k === 'motivosAjuste' ? v.split('\n').map((x) => x.trim()) : v.trim();
    const a = L.ajustarParametro(L.ESQUEMA_PARAMETROS[k] || 'texto', crudo);
    if (!a.ok) { toast('No se pudo guardar ese dato'); return; }
    v = a.valor; recorte = a.recorte;
  }
  S.parametros[k] = v;
  await DB.guardar({ kv: { parametros: S.parametros } });
  if (recorte) { toast('Guardado recortado'); await avisarRecortes([{ clave: k, ...recorte, texto: L.textoRecorte(k, recorte) }], 'Se guardó recortado'); render(); }
  else toast('Guardado');
}

// ----- Saldo inicial (transcribir la planilla de partida) -----
const saldoActivo = () => S.movimientos.filter((m) => m.tipo === 'saldo_inicial' && !m.anulado);
function vSaldo() {
  const ya = saldoActivo();
  if (ya.length) {
    const fechas = [...new Set(ya.map((m) => m.fecha))].map(fFecha).join(', ');
    const tot = ya.reduce((s, m) => s + m.cantidad, 0);
    return `<h1>Saldo inicial</h1><div class="tarjeta"><p>Ya hay un saldo inicial cargado: <b>${num(ya.length)} renglones, ${num(tot)} cabezas</b>, con fecha ${fechas}.</p>
      <p>Solo puede haber uno. Si estaba mal, anulalo en Movimientos (se anula entero) y volvé a cargarlo acá.</p>
      <button class="btn prim" data-ir="mas" data-sub="movimientos">Ir a Movimientos</button></div>`;
  }
  return `<h1>Saldo inicial</h1>
    <p>Es el punto de partida del libro: lo que hay hoy en cada rodeo, según tu stock ya revisado. Se carga una sola vez.</p>
    <div class="tarjeta"><b>Con la compu (recomendado si son muchos rodeos)</b>
      <p class="chico">Bajá la planilla Excel con tus rodeos y categorías, completá las celdas amarillas y volvé a subirla. Antes de guardar vas a ver el total.</p>
      <div class="fila-btns"><button class="btn" data-acc="plantilla-saldo">Descargar plantilla Excel</button>
      <label class="btn prim" for="imp-plantilla">Importar plantilla completa</label></div>
      <input type="file" id="imp-plantilla" accept=".xlsx" hidden></div>
    <h2>O escribilo acá</h2>
    <div class="fecha-sesion"><label for="f-saldo">Fecha del saldo:</label><input type="date" id="f-saldo" value="${fechaSesion()}"></div>
    <div class="total-vivo">Total: <b id="s-total">0</b> cabezas</div>
    ${rodeosActivos().map((r) => {
      const { principales, otras } = catsDelRodeo(r.id, fechaSesion());
      const fila = (c) => `<div class="cant-fila"><div class="nom">${esc(c.nombre)}</div><input class="num" type="text" inputmode="numeric" pattern="[0-9]*" data-saldo="${r.id}|${c.id}" aria-label="${esc(r.nombre + ' ' + c.nombre)}" autocomplete="off"></div>`;
      return `<div class="tarjeta"><div class="fila-total"><b>${esc(r.nombre)}</b><span>Total: <b data-stot="${r.id}">0</b></span></div>${principales.map(fila).join('')}${plegadas(otras, otras.map(fila).join(''))}</div>`;
    }).join('')}
    <div class="error" id="s-error"></div>
    <button class="btn prim grande" data-acc="cargar-saldo" style="margin-top:12px">Guardar saldo inicial</button>`;
}
// Totales en vivo mientras se escribe el saldo (por rodeo y general), para comparar con el papel.
function totalesSaldo() {
  const porR = {}; let tot = 0;
  for (const i of document.querySelectorAll('[data-saldo]')) {
    const v = i.value.trim(); if (!/^\d+$/.test(v)) continue;
    const r = i.dataset.saldo.split('|')[0]; porR[r] = (porR[r] || 0) + Number(v); tot += Number(v);
  }
  document.querySelectorAll('[data-stot]').forEach((el) => { el.textContent = num(porR[el.dataset.stot] || 0); });
  const t = $('#s-total'); if (t) t.textContent = num(tot);
}

// Plantilla Excel del saldo inicial: rodeos activos en filas, categorías activas en columnas, celdas amarillas.
// Las columnas e identificadores técnicos (fila "id" y columna "rodeo_id") permiten leerla sin depender de los nombres.
async function descargarPlantillaSaldo() {
  if (typeof writeXlsxFile === 'undefined') { toast('No se pudo cargar el módulo de Excel'); return; }
  const cs = catsActivas(), rs = rodeosActivos();
  const AMA = '#FFF3A3', VER = '#D8F3DC';
  const t = (v, o = {}) => ({ value: String(v), type: String, ...o });
  const vacio = () => ({ value: null });
  const ancho = 2 + cs.length;
  const relleno = (fila) => { while (fila.length < ancho) fila.push(vacio()); return fila; };
  const datos = [
    relleno([t('Saldo inicial — completá las celdas amarillas', { fontWeight: 'bold' })]),
    relleno([t('Fecha'), t(fFecha(fechaSesion()), { backgroundColor: AMA }), t('← escribila como dd/mm/aaaa')]),
    relleno([t('Cantidad de cabezas en cada rodeo y categoría. Dejá vacío lo que no hay. No agregues ni borres filas o columnas: si te falta un rodeo, crealo en la app y bajá la plantilla de nuevo.', { wrap: true })]),
    relleno([]),
    [t('Rodeo', { fontWeight: 'bold', backgroundColor: VER }), ...cs.map((c) => t(c.nombre, { fontWeight: 'bold', backgroundColor: VER, wrap: true })), t('rodeo_id (no tocar)', { color: '#777777' })],
    [t('id', { color: '#777777' }), ...cs.map((c) => t(c.id, { color: '#777777' })), t('rodeo_id', { color: '#777777' })],
    ...rs.map((r) => [t(r.nombre, { fontWeight: 'bold' }), ...cs.map(() => ({ value: null, backgroundColor: AMA })), t(r.id, { color: '#777777' })]),
  ];
  const columns = [{ width: 26 }, ...cs.map(() => ({ width: 12 })), { width: 18 }];
  const blob = await writeXlsxFile(datos, { columns, sheet: 'Saldo inicial' }).toBlob();
  descargar(blob, `plantilla-saldo-inicial-${sello()}.xlsx`);
  toast('Plantilla descargada');
}

async function importarPlantillaSaldo(file) {
  if (saldoActivo().length) { await aviso('Ya hay un saldo inicial', '<p>Solo puede haber uno. Si estaba mal, anulalo en Movimientos (se anula entero) y volvé a importar.</p>'); return; }
  if (typeof readXlsxFile === 'undefined') { toast('No se pudo cargar el módulo de Excel'); return; }
  let filas;
  await procesando('Leyendo la plantilla…');
  try {
    let hojas = null;
    try { hojas = await readXlsxFile(file); } catch { hojas = null; }
    // Esta versión de la librería devuelve todas las hojas: [{ sheet, data }].
    if (Array.isArray(hojas)) { const h = hojas.find((x) => x && x.sheet === 'Saldo inicial'); filas = h ? h.data : null; }
  } finally { finProcesando(); }
  if (!filas) { await aviso('No se pudo leer la plantilla', `<p class="error">No se pudo abrir el Excel: el archivo está dañado, no es un Excel (.xlsx) o le falta la hoja "Saldo inicial".</p><p>No se guardó nada.</p>`); return; }
  let r;
  try { r = L.leerPlantillaSaldo(filas, S.rodeos, S.categorias); } catch { r = { ok: false, errores: ['La plantilla tiene un formato inesperado. Descargala de nuevo desde la app.'], total: 1 }; }
  if (!r.ok) {
    await aviso('La plantilla tiene problemas', `<p>Encontré ${num(r.total || r.errores.length)} problema${(r.total || r.errores.length) === 1 ? '' : 's'}${(r.total || 0) > L.MAX_ERRORES ? `; estos son los primeros ${L.MAX_ERRORES}` : ''}:</p><ul>${r.errores.map((e) => `<li>${esc(e)}</li>`).join('')}</ul><p>No se guardó nada.</p>`);
    return;
  }
  const porR = new Map();
  for (const x of r.renglones) porR.set(x.rodeoId, (porR.get(x.rodeoId) || 0) + x.cantidad);
  const inactivos = [...porR.keys()].filter((id) => !rodeo(id)?.activo).map(nomR);
  const ok = await confirmar('Saldo inicial de la plantilla', `<p>Fecha: <b>${fFecha(r.fecha)}</b> · ${num(r.renglones.length)} casillas con animales.</p>
    <table class="tabla-mini"><tbody>${[...porR.entries()].map(([id, n]) => `<tr><td>${esc(nomR(id))}</td><td class="n">${num(n)}</td></tr>`).join('')}
    <tr><td><b>Total</b></td><td class="n"><b>${num(r.cabezas)}</b></td></tr></tbody></table>
    ${inactivos.length ? `<p class="error">Ojo: ${inactivos.map(esc).join(', ')} está desactivado.</p>` : ''}
    <p>¿Coincide con tu stock? Si no, cancelá, corregí la planilla y volvé a importarla.</p>`, 'Guardar saldo inicial');
  if (!ok) return;
  const lote = L.nuevoId();
  const nuevos = r.renglones.map((x) => nuevoMov({ tipo: 'saldo_inicial', fecha: r.fecha, cantidad: x.cantidad, destino: { rodeoId: x.rodeoId, categoriaId: x.categoriaId }, nota: 'Saldo inicial (plantilla Excel)', lote }));
  if (await registrar(nuevos)) { toast(`Saldo inicial cargado: ${num(r.cabezas)} cabezas`); ir('stock'); }
}
async function cargarSaldo() {
  const err = $('#s-error');
  const fecha = $('#f-saldo').value;
  if (!fecha) { err.textContent = 'Falta la fecha de la planilla.'; return; }
  if (saldoActivo().length) { err.textContent = 'Ya hay un saldo inicial: anulalo primero en Movimientos.'; return; }
  const lote = L.nuevoId();
  const nuevos = [];
  for (const i of document.querySelectorAll('[data-saldo]')) {
    const v = i.value.trim(); if (v === '') continue;
    if (!/^\d+$/.test(v)) { err.textContent = 'Las cantidades tienen que ser números enteros.'; return; }
    if (Number(v) === 0) continue;
    const { rodeoId, categoriaId } = L.desarmarClave(i.dataset.saldo);
    nuevos.push(nuevoMov({ tipo: 'saldo_inicial', fecha, cantidad: Number(v), destino: { rodeoId, categoriaId }, nota: 'Saldo inicial', lote }));
  }
  if (!nuevos.length) { err.textContent = 'Escribí al menos una cantidad.'; return; }
  if (await registrar(nuevos)) { toast(`Saldo inicial cargado: ${num(nuevos.reduce((s, m) => s + m.cantidad, 0))} cabezas`); ir('stock'); }
}

// ----- Backup -----
function vBackup() {
  const d = diasSinBackup();
  const inst = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const pers = S.persistido === true ? 'sí' : S.persistido === false ? 'no' : 'no se sabe';
  return `<h1>Backup</h1>
    <div class="tarjeta">
      <div>Último backup: <b>${S.meta.ultimoBackup ? `${fFechaDe(S.meta.ultimoBackup)} (hace ${num(d)} día${d === 1 ? '' : 's'})` : 'nunca'}</b></div>
      <div>Almacenamiento protegido: <b>${pers}</b></div>
      <div>App instalada en la pantalla de inicio: <b>${inst ? 'sí' : 'no'}</b></div>
      ${!inst ? '<p class="error">Instalala en la pantalla de inicio: si la usás desde el navegador, el teléfono puede borrar los datos.</p>' : ''}
      <div class="chico">Hay ${num(S.movimientos.length)} movimientos y ${num(S.conteos.length)} conteos en este teléfono.</div>
    </div>
    <h2>Exportar</h2>
    <div class="fila-btns"><button class="btn prim" data-acc="exp-json">Exportar backup (JSON)</button><button class="btn" data-acc="exp-xlsx">Exportar Excel</button></div>
    <p class="chico">El JSON es la copia exacta. El Excel es para mirar en la compu, y también se puede volver a importar.</p>
    <h2>Importar</h2>
    <p>Importar <b>reemplaza todo</b> lo que hay en este teléfono por lo del archivo. También sirve para el archivo de arranque.</p>
    <label class="btn grande" for="imp-archivo">Elegir archivo para importar</label>
    <input type="file" id="imp-archivo" accept=".json,.xlsx,application/json" hidden>
    ${S.respaldo ? `<h2>Deshacer la última importación</h2>
    <p>Antes de importar, la app guardó lo que había en este teléfono${S.respaldo.fecha ? ` (el ${fFechaDe(S.respaldo.fecha)})` : ''}. Si la importación no era lo que querías, podés volver a eso.</p>
    <button class="btn" data-acc="deshacer-imp">Deshacer última importación</button>` : ''}`;
}

function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function sello() { const d = new Date(); return `${hoyLocal(d)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`; }

async function marcarBackup() { S.meta.ultimoBackup = new Date().toISOString(); await guardarMeta(); }

function estadoDatos() { return { rodeos: S.rodeos, categorias: S.categorias, movimientos: S.movimientos, conteos: S.conteos, parametros: S.parametros }; }

// Un segundo toque que llega justo cuando termina una exportación no debe bajar otro archivo.
const finExport = { json: 0, xlsx: 0 };
const exportReciente = (k) => Date.now() - finExport[k] < 1500;

async function exportarJson() {
  if (exportReciente('json')) return;
  await procesando('Armando el backup…');
  try {
    const b = L.armarBackup(estadoDatos(), new Date().toISOString());
    descargar(new Blob(await jsonPorTandas(b), { type: 'application/json' }), `backup-stock-${sello()}.json`);
    await marcarBackup();
  } catch (e) { finProcesando(); await aviso('No se pudo exportar', `<p class="error">${mensajeError(e)}</p>`); return; }
  finExport.json = Date.now(); finProcesando(); toast('Backup exportado'); render();
}

// JSON del backup armado de a tandas (miles de movimientos no congelan la pantalla). Da el mismo contenido
// que JSON.stringify(b), partido en pedazos para el Blob.
async function jsonPorTandas(b, tanda = 2000) {
  const { movimientos, conteos, ...resto } = b;
  const partes = [JSON.stringify(resto).slice(0, -1)];
  for (const [k, lista] of [['movimientos', movimientos], ['conteos', conteos]]) {
    partes.push(`,"${k}":[`);
    for (let i = 0; i < lista.length; i += tanda) {
      partes.push((i ? ',' : '') + lista.slice(i, i + tanda).map((x) => JSON.stringify(x)).join(','));
      await ceder();
    }
    partes.push(']');
  }
  partes.push('}');
  return partes;
}

// Arma filas de a tandas, devolviendo el control a la pantalla entre tanda y tanda (no se congela).
async function filasPorTandas(lista, fn, tanda = 2000) {
  const out = [];
  for (let i = 0; i < lista.length; i += tanda) {
    for (const x of lista.slice(i, i + tanda)) out.push(fn(x));
    if (i + tanda < lista.length) await ceder();
  }
  return out;
}

// Excel: primero las columnas para leer (nombres), después las técnicas (ids) que sirven para reimportar exacto.
const COL_MOV_LEER = ['Fecha', 'Tipo', 'Rodeo origen', 'Categoría origen', 'Rodeo destino', 'Categoría destino', 'Cantidad', 'Caravana', 'Nota', 'Motivo', 'Anulado el', 'Motivo de anulación'];
const COL_MOV = ['id', 'fecha', 'tipo', 'cantidad', 'origen_rodeo_id', 'origen_categoria_id', 'destino_rodeo_id', 'destino_categoria_id', 'nota', 'caravana', 'motivo', 'conteo_id', 'lote', 'creado', 'anulado_fecha', 'anulado_motivo', 'corrige_a', 'antes_json', 'extra_json', 'caravanas_json'];
const COL_CON_LEER = ['Fecha', 'Rodeo', 'Categoría', 'Contado', 'Origen del conteo', 'Anulado el'];
const COL_CON = ['id', 'fecha', 'rodeo_id', 'categoria_id', 'cantidad', 'origen', 'nota', 'creado', 'anulado_fecha', 'anulado_motivo', 'diferencia_original', 'calculado_al_contar', 'metodo', 'lecturas_json'];
const COL_ROD = ['id', 'nombre', 'ubicacion', 'orden', 'activo', 'esperadas_json'];
const COL_CAT = ['id', 'nombre', 'orden', 'activa', 'cuenta_como_vaca', 'senasa', 'sexo', 'bovino', 'reemplazada_por'];

function filaMov(m) {
  const leer = [fFecha(m.fecha), describir(m).tipo, m.origen ? nomR(m.origen.rodeoId) : '', m.origen ? nomC(m.origen.categoriaId) : '', m.destino ? nomR(m.destino.rodeoId) : '', m.destino ? nomC(m.destino.categoriaId) : '',
    m.tipo === 'ajuste' ? L.signoAjuste(m) : m.cantidad, m.caravana ?? '', m.nota ?? '', m.motivo ?? '', m.anulado ? fFechaDe(m.anulado.fecha) : '', m.anulado?.motivo ?? ''];
  const tec = [m.id, m.fecha, m.tipo, m.cantidad, m.origen?.rodeoId ?? '', m.origen?.categoriaId ?? '', m.destino?.rodeoId ?? '', m.destino?.categoriaId ?? '', m.nota ?? '', m.caravana ?? '', m.motivo ?? '', m.conteoId ?? '', m.lote ?? '', m.creado ?? '', m.anulado?.fecha ?? '', m.anulado?.motivo ?? '', m.corrigeA ?? '', m.antes ? JSON.stringify(m.antes) : '', JSON.stringify(m.extra || {}), m.caravanas ? JSON.stringify(m.caravanas) : ''];
  return [...leer, ...tec];
}
// Excel en un Web Worker (excel-worker.js): comprimir o descomprimir miles de renglones no congela la pantalla.
// Si el teléfono no puede abrir el worker, se hace acá mismo, como antes.
let excelWorker = null, excelSeq = 0;
const excelPend = new Map();
function enWorkerExcel(op, datos) {
  try {
    if (!excelWorker) {
      excelWorker = new Worker('excel-worker.js');
      excelWorker.onmessage = (e) => { const p = excelPend.get(e.data.id); if (!p) return; excelPend.delete(e.data.id); if (e.data.ok) p.ok(e.data); else { const er = new Error(e.data.error); er.tipo = e.data.tipo; p.mal(er); } };
      excelWorker.onerror = (e) => { e.preventDefault?.(); for (const p of excelPend.values()) p.mal(new Error('worker')); excelPend.clear(); excelWorker = null; };
    }
  } catch { excelWorker = null; return Promise.reject(new Error('worker')); }
  const id = ++excelSeq;
  return new Promise((ok, mal) => { excelPend.set(id, { ok, mal }); excelWorker.postMessage({ id, op, ...datos }); });
}
// Celdas: número, sí/no o texto, según el valor (lo arma el worker, o acá si no hay worker).
const celdaExcel = (v) => (typeof v === 'number' ? { value: v, type: Number } : typeof v === 'boolean' ? { value: v, type: Boolean } : { value: String(v ?? ''), type: String });
const hojaExcel = (h) => ({ sheet: h.sheet, data: [h.cols.map((c) => ({ value: c, fontWeight: 'bold' })), ...h.filas.map((f) => f.map(celdaExcel))] });
// Las filas viajan al worker de a tandas (valores sueltos, no objetos): copiar miles de renglones de una vez
// también congela la pantalla.
async function escribirExcel(hojas, tanda = 2000) {
  try {
    await enWorkerExcel('nuevo', {});
    for (let n = 0; n < hojas.length; n++) {
      const filas = hojas[n].filas;
      for (let i = 0; i < filas.length; i += tanda) {
        if (!excelWorker) throw new Error('worker');
        excelWorker.postMessage({ op: 'filas', n, filas: filas.slice(i, i + tanda) });
        await ceder();
      }
    }
    return (await enWorkerExcel('escribir', { hojas: hojas.map((h) => ({ sheet: h.sheet, cols: h.cols })) })).blob;
  } catch (e) {
    if (e.message !== 'worker') throw e;
    return writeXlsxFile(hojas.map(hojaExcel)).toBlob();
  }
}
const hoja = (nombre, cols, filas) => ({ sheet: nombre, cols, filas });

async function exportarExcel() {
  if (exportReciente('xlsx')) return;
  if (typeof writeXlsxFile === 'undefined') { toast('No se pudo cargar el módulo de Excel'); return; }
  await procesando('Armando el Excel…');
  try { await armarExcel(); } catch (e) { finProcesando(); await aviso('No se pudo exportar el Excel', `<p class="error">${mensajeError(e)}</p>`); return; }
  finExport.xlsx = Date.now(); finProcesando(); toast('Excel exportado'); render();
}

async function armarExcel() {
  const b = L.armarBackup(estadoDatos(), new Date().toISOString());
  const hoy = hoyIso();
  const mapa = IDX().stockMapa(hoy);
  const t = L.totales(mapa);
  const cs = [...S.categorias].sort((a, b2) => a.orden - b2.orden), rs = [...S.rodeos].sort((a, b2) => a.orden - b2.orden);
  const stockFilas = [[`Stock al ${fFecha(hoy)}`, ...cs.map(() => ''), ''],
    ...rs.map((r) => [r.nombre, ...cs.map((c) => mapa.get(L.clave(r.id, c.id)) || 0), t.porRodeo.get(r.id) || 0]),
    ['Totales', ...cs.map((c) => t.porCategoria.get(c.id) || 0), t.total]];
  const hojas = [
    hoja('Control', ['clave', 'valor'], [['app', b.app], ['formato', b.formato], ['exportado', b.exportado], ['movimientos', b.cuentas.movimientos], ['conteos', b.cuentas.conteos], ['rodeos', b.cuentas.rodeos], ['categorias', b.cuentas.categorias]]),
    hoja('Stock actual', ['Rodeo', ...cs.map((c) => c.nombre), 'Total'], stockFilas),
    hoja('Movimientos', [...COL_MOV_LEER, ...COL_MOV], await filasPorTandas(S.movimientos, filaMov)),
    hoja('Conteos', [...COL_CON_LEER, ...COL_CON], S.conteos.map((c) => [fFecha(c.fecha), nomR(c.rodeoId), nomC(c.categoriaId), c.cantidad, c.origen ?? '', c.anulado ? fFechaDe(c.anulado.fecha) : '',
      c.id, c.fecha, c.rodeoId, c.categoriaId, c.cantidad, c.origen ?? '', c.nota ?? '', c.creado ?? '', c.anulado?.fecha ?? '', c.anulado?.motivo ?? '', c.diferenciaOriginal ?? '', c.calculadoAlContar ?? '', c.metodo ?? '', c.lecturas ? JSON.stringify(c.lecturas) : ''])),
    hoja('Rodeos', COL_ROD, S.rodeos.map((r) => [r.id, r.nombre, r.ubicacion ?? '', r.orden, !!r.activo, r.esperadas ? JSON.stringify(r.esperadas) : ''])),
    hoja('Categorias', COL_CAT, S.categorias.map((c) => [c.id, c.nombre, c.orden, !!c.activa, !!c.cuentaComoVaca, c.senasa ?? '', c.sexo ?? '', c.bovino !== false, c.reemplazadaPor ?? ''])),
    hoja('Parametros', ['clave', 'valor_json'], Object.entries(S.parametros).map(([k, v]) => [k, JSON.stringify(v)])),
  ];
  await ceder();
  const blob = await escribirExcel(hojas);
  descargar(blob, `stock-${sello()}.xlsx`);
  await marcarBackup();
}

// Lee un .xlsx exportado por esta app y lo convierte en backup (usa las columnas técnicas).
// Todo el trabajo (descomprimir, leer y convertir) se hace en el worker; vuelve como texto JSON.
const ERR_EXCEL_ABRIR = 'No se pudo abrir el Excel: el archivo está dañado o no es un Excel (.xlsx).';
const ERR_EXCEL_FORMATO = 'El Excel no tiene el formato de esta app: alguna columna técnica (las de la derecha) está vacía, dañada o fue editada.';
async function excelABackup(file) {
  let r;
  try { r = await enWorkerExcel('leerBackup', { file }); } catch (e) {
    if (e.message !== 'worker') {
      if (e.tipo === 'abrir') throw new ErrorUsuario(ERR_EXCEL_ABRIR);
      if (e.tipo === 'usuario') throw new ErrorUsuario(e.message);
      throw new ErrorUsuario(ERR_EXCEL_FORMATO);
    }
    let hojas;
    try { hojas = await readXlsxFile(file); } catch { throw new ErrorUsuario(ERR_EXCEL_ABRIR); }
    try { return self.excelHojasABackup(hojas); } catch (e2) { throw new ErrorUsuario(e2.usuario ? e2.message : ERR_EXCEL_FORMATO); }
  }
  await ceder();
  return JSON.parse(r.json);
}

async function importar(file) {
  const esExcel = /\.xlsx$/i.test(file.name);
  let b, v, tot;
  await procesando('Leyendo el archivo…');
  try {
    try {
      if (esExcel) b = await excelABackup(file);
      else { const txt = await file.text(); await ceder(); b = JSON.parse(txt); }
    } catch (e) {
      finProcesando();
      await aviso('No se pudo leer el archivo', `<p class="error">${mensajeError(e, esExcel ? 'xlsx' : 'json')}</p><p>No se importó nada; tus datos siguen como estaban.</p>`); return;
    }
    await ceder();
    try { v = await L.validarBackupEnTandas(b, ceder); } catch (e) { v = { ok: false, errores: ['El archivo tiene un formato inesperado: no es un backup de esta app o está dañado.'] }; }
    if (v.ok) {
      // Conteos de backups viejos: se reconstruye la diferencia al contar (o quedan "a revisar").
      await ceder();
      v.estado.conteos = L.migrarConteos(v.estado.conteos, v.estado.movimientos).conteos;
      await ceder();
      // Backup de la v0.3: se pasa a las categorías SENASA antes de mostrarlo (renglones nuevos, historia intacta).
      if (L.esModeloViejo(v.estado, MAPEO_V03, CATEGORIAS_INICIALES.map((c) => c.id))) {
        const mg = migrarModelo(v.estado);
        v.estado = { ...v.estado, ...mg.estado };
        v.migracion = mg;
        await ceder();
      }
      tot = L.totales(L.calcularStock(v.estado.movimientos)).total;
    }
  } finally { finProcesando(); }
  if (!v.ok) {
    await aviso('El archivo tiene problemas', `<p>Encontré ${num(v.total || v.errores.length)} problema${(v.total || v.errores.length) === 1 ? '' : 's'}${(v.total || 0) > L.MAX_ERRORES ? `; estos son los primeros ${L.MAX_ERRORES}` : ''}:</p><ul>${v.errores.map((e) => `<li>${esc(e)}</li>`).join('')}</ul><p>No se importó nada; tus datos siguen como estaban.</p>`); return;
  }
  // Textos de Datos más largos que el tope: se avisa ANTES de confirmar, así se decide sabiendo qué se recorta.
  const npImp = L.normalizarParametros(v.estado.parametros, PARAMETROS_INICIALES);
  const avisoRec = npImp.recortados.length
    ? `<p><b>Ojo:</b> algunos datos son más largos de lo permitido y se van a guardar recortados (no se pierden enteros):</p><ul>${npImp.recortados.map((r) => `<li>${esc(r.texto)}.</li>`).join('')}</ul>`
    : '';
  const avisoMig = v.migracion ? `<div class="tarjeta"><b>Backup de una versión anterior</b>${v.migracion.limpio ? '<p>No trae movimientos: se usan los rodeos y categorías estándar nuevos.</p>' : textoMigracion(v.migracion)}</div>` : '';
  const ok = await confirmar('Importar backup', `${avisoMig}${avisoRec}<p>El archivo es del ${b.exportado ? fFechaDe(b.exportado) : '?'} y trae ${num(v.estado.movimientos.length)} movimientos y ${num(v.estado.conteos.length)} conteos. Stock total: <b>${num(tot)}</b>.</p>
    <p class="error">Esto reemplaza lo que hay en este teléfono (${num(S.movimientos.length)} movimientos, stock ${num(L.totales(IDX().stockMapa()).total)}).</p>`, 'Reemplazar todo');
  if (!ok) return;
  // Recién importado, lo que hay en el teléfono es igual al archivo: ese archivo ya es el backup al día.
  // El aviso de 7 días cuenta desde hoy, no desde la fecha en que se exportó el archivo (p. ej., el de arranque).
  const meta = { ...S.meta, ultimoBackup: new Date().toISOString() };
  await procesando('Importando…');
  const parametros = npImp.parametros;
  try {
    await DB.reemplazarTodo(v.estado, { parametros, meta }, { respaldar: true });
  } catch (e) {
    await falloReemplazo(e, 'No se pudo importar', 'No se importó nada');
    return;
  }
  try {
    await cargarEstado({ ...v.estado, parametros, meta });
    // Rearmar el índice en su propia tarea y recién después dibujar: dos tareas cortas en vez de una larga.
    await ceder(); IDX(); await ceder();
  } finally { finProcesando(); }
  await actualizarRespaldo();
  toast(npImp.recortados.length ? 'Backup importado (con datos recortados: ver Más → Datos)' : 'Backup importado'); ir('stock');
}
// Textos de Datos más largos que el tope: se guardaron recortados (nunca vacíos). Se dice cuál y cuánto.
function avisarRecortes(recortados, titulo) {
  return aviso(titulo, `<ul>${recortados.map((r) => `<li>${esc(r.texto)}.</li>`).join('')}</ul><p>Revisalos en <b>Más → Datos a confirmar y membrete</b>. El stock no cambió.</p>`);
}

// Un reemplazo total que falló. Solo se dice "tus datos siguen como estaban" si la base confirmó que
// deshizo todo (evento abort). Si no hay esa confirmación, se vuelve a leer lo que de verdad quedó guardado.
async function falloReemplazo(e, titulo, nadaTxt) {
  if (e && e.abortado) {
    finProcesando();
    await aviso(titulo, `<p class="error">${mensajeError(e, 'db')}</p><p>${nadaTxt}; tus datos siguen como estaban.</p>`);
    return;
  }
  try { await cargarEstado(); } catch { /* se informa abajo */ }
  finProcesando();
  await actualizarRespaldo();
  await aviso(titulo, `<p class="error">${mensajeError(e, 'db')}</p><p>No se pudo confirmar si se escribió algo. La pantalla ahora muestra lo que quedó guardado en el teléfono${S.respaldo ? '; si algo falta, usá <b>Deshacer última importación</b> en Backup' : ''}.</p>`);
  render();
}

async function actualizarRespaldo() {
  try {
    if (!(await DB.hayRespaldo())) { S.respaldo = null; return; }
    const info = await DB.infoRespaldo();
    if (info) { S.respaldo = { fecha: info.fecha, movimientos: info.movimientos || 0 }; return; }
    const r = await DB.leerRespaldo(); // respaldo hecho por la v0.3.2 (sin info aparte)
    S.respaldo = r ? { fecha: r.fecha, movimientos: r.datos?.movimientos?.length || 0 } : null;
  } catch { S.respaldo = null; }
}

async function deshacerImportacion() {
  let r;
  try { r = await DB.leerRespaldo(); } catch (e) { await aviso('No se pudo leer la copia', `<p class="error">${mensajeError(e, 'db')}</p>`); return; }
  if (!r || !r.datos) { S.respaldo = null; await aviso('No hay nada para deshacer', '<p>No hay una copia de antes de importar.</p>'); render(); return; }
  const d = r.datos;
  const tot = L.totales(L.calcularStock(d.movimientos || [])).total;
  const ok = await confirmar('Deshacer última importación', `<p>Vuelve a lo que había en este teléfono antes de importar${r.fecha ? ` (el ${fFechaDe(r.fecha)})` : ''}: ${num((d.movimientos || []).length)} movimientos y ${num((d.conteos || []).length)} conteos. Stock total: <b>${num(tot)}</b>.</p>
    <p class="error">Lo que hay ahora (${num(S.movimientos.length)} movimientos, stock ${num(L.totales(IDX().stockMapa()).total)}) se reemplaza. Si lo querés conservar, exportalo antes.</p>`, 'Deshacer importación');
  if (!ok) return;
  await procesando('Volviendo a los datos anteriores…');
  try {
    await DB.reemplazarTodo(d, d.kv || {}, { respaldar: false, borrarRespaldo: true });
  } catch (e) {
    await falloReemplazo(e, 'No se pudo deshacer', 'No se cambió nada');
    return;
  }
  try { await cargarEstado(); } finally { finProcesando(); }
  S.respaldo = null;
  toast('Importación deshecha'); ir('stock');
}

// ---------- Eventos ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, [data-ir]');
  if (!b) return;
  const ds = b.dataset;
  if (ds.ir) { ir(ds.ir, ds.sub); return; }
  if (ds.tipo) {
    C = nuevaCarga();
    if (ds.tipo === 'ajuste+' || ds.tipo === 'ajuste-') { C.tipo = 'ajuste'; C.signo = ds.tipo === 'ajuste+' ? 1 : -1; } else C.tipo = ds.tipo;
    C.paso = 'rodeo'; render(); return;
  }
  if (ds.atajo) { const a = atajo(ds.atajo); C = nuevaCarga(); C.tipo = 'cambio_categoria'; C.atajo = a.id; C.paso = 'rodeo'; render(); return; }
  if (ds.rodeo) {
    if (ds.campo === 'conteo') { CT.rodeo = ds.rodeo; CT.vals = {}; CT.fecha = $('#f-conteo')?.value || CT.fecha; render(); return; }
    if (ds.campo === 'rodeoO') {
      C.rodeoO = ds.rodeo;
      C.paso = C.tipo === 'traslado' ? 'destino' : (C.tipo === 'cambio_categoria' && !C.atajo) ? 'catO' : 'cant';
      render(); return;
    }
    // rodeo destino (traslado: paso propio; cambio de categoría: botones dentro del paso de cantidades)
    leerCantVisibles();
    const enfocado = document.activeElement?.dataset?.cant;
    C.rodeoD = ds.rodeo === C.rodeoO && C.tipo === 'cambio_categoria' && !C.atajo ? null : ds.rodeo;
    if (C.paso === 'destino') C.paso = 'cant';
    render();
    if (enfocado) document.querySelector(`[data-cant="${enfocado}"]`)?.focus({ preventScroll: true });
    return;
  }
  if (ds.cato) { C.catO = ds.cato; C.paso = 'cant'; render(); return; }
  if (ds.vinc) { leerCantVisibles(); C.vinc[ds.vinc] = C.vinc[ds.vinc] ? null : ds.conteo; render(); return; }
  if (ds.motivo !== undefined && S.vista === 'cargar') {
    leerCantVisibles(); C.motivo = ds.motivo;
    const enfocado = document.activeElement?.dataset?.cant;
    render();
    document.querySelector(`[data-cant="${enfocado}"]`)?.focus({ preventScroll: true });
    return;
  }
  if (ds.stockmodo) { stockModo = ds.stockmodo; render(); return; }
  if (ds.explicar) { explicar(ds.explicar); return; }
  if (ds.confirmar) { confirmarExplicacion(ds.confirmar); return; }
  if (ds.anularconteo) { anularConteo(ds.anularconteo); return; }
  if (ds.anular) { anularMov(ds.anular); return; }
  if (ds.corregir) { corregirMov(ds.corregir); return; }
  if (ds.orden) { mover(ds.orden, ds.id, Number(ds.dir)); return; }
  if (ds.esp) { cambiarEsperada(ds.esp, ds.cat); return; }
  switch (ds.acc) {
    case 'atras': atras(); break;
    case 'guardar': unaVez(guardarCarga); break;
    case 'seguir-fecha': S.meta.fechaSesion = S.meta.fechaSesionAnterior; S.meta.fechaSesionDia = hoyIso(); delete S.meta.fechaSesionAnterior; await guardarMeta(); toast('Fecha de carga: ' + fFecha(S.meta.fechaSesion)); render(); break;
    case 'nuevo-conteo': CT = { modo: 'nuevo', fecha: fechaSesion(), fechaDia: hoyIso() }; render(); break;
    case 'seguir-fecha-conteo': leerConteoVisibles(); CT.fecha = CT.fechaAnterior; CT.fechaDia = hoyIso(); delete CT.fechaAnterior; toast('Fecha del conteo: ' + fFecha(CT.fecha)); render(); break;
    case 'conteo-cancelar': CT = { modo: 'lista' }; render(); break;
    case 'conteo-atras': CT.rodeo = null; render(); break;
    case 'guardar-conteo': unaVez(guardarConteo); break;
    case 'imprimir': prepararImpresion(); window.print(); break;
    case 'descargar-informe': descargarInforme(); break;
    case 'ver-mas': movsVer += 50; render(); break;
    case 'ver-mas-conteos': conteosVer += 50; render(); break;
    case 'ver-mas-anulados': anuladosVer += 50; render(); break;
    case 'ver-mas-abiertas': abiertasVer += 50; render(); break;
    case 'ver-mas-meses': histVer += 24; render(); break;
    case 'agregar-rodeo': agregar('rodeo'); break;
    case 'agregar-cat': agregar('cat'); break;
    case 'cargar-saldo': unaVez(cargarSaldo); break;
    case 'plantilla-saldo': unaVez(descargarPlantillaSaldo); break;
    case 'exp-json': unaVez(exportarJson); break;
    case 'deshacer-imp': unaVez(deshacerImportacion); break;
    case 'exp-xlsx': unaVez(exportarExcel); break;
  }
});

function leerCantVisibles() {
  document.querySelectorAll('[data-cant]').forEach((i) => { C.cant[i.dataset.cant] = i.value.trim(); });
  const n = $('#c-nota'), k = $('#c-caravana'), mo = $('#c-motivo');
  if (n) C.nota = n.value.trim(); if (k) C.caravana = k.value.trim(); if (mo) C.motivo = mo.value.trim();
}

function atras() {
  leerCantVisibles();
  const t = C.tipo;
  if (C.paso === 'rodeo') C = nuevaCarga();
  else if (C.paso === 'destino' || C.paso === 'catO') { C.paso = 'rodeo'; C.rodeoO = null; }
  else if (C.paso === 'cant') {
    if (t === 'traslado') { C.paso = 'destino'; C.rodeoD = null; }
    else if (t === 'cambio_categoria' && !C.atajo) { C.paso = 'catO'; C.catO = null; C.rodeoD = null; }
    else { C.paso = 'rodeo'; C.rodeoO = null; C.rodeoD = null; }
    C.cant = {}; C.vinc = {};
  }
  render();
}

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'f-sesion') {
    if (el.value) { S.meta.fechaSesion = el.value; S.meta.fechaSesionDia = hoyIso(); delete S.meta.fechaSesionAnterior; await guardarMeta(); toast('Fecha de carga: ' + fFecha(el.value)); render(); }
    else el.value = fechaSesion();
    return;
  }
  if (el.id === 'f-stock') { stockFecha = el.value || hoyIso(); render(); return; }
  if (el.id === 'f-informe') { informeFecha = el.value || hoyIso(); render(); return; }
  if (el.id === 'f-conteo') { CT.fecha = el.value; CT.fechaDia = hoyIso(); delete CT.fechaAnterior; return; }
  if (el.dataset.cfg) { cambiarCfg(el); return; }
  if (el.dataset.param) { cambiarParam(el); return; }
  if (el.id === 'imp-archivo' && el.files[0]) { const f = el.files[0]; el.value = ''; importar(f); }
  if (el.id === 'imp-plantilla' && el.files[0]) { const f = el.files[0]; el.value = ''; unaVez(() => importarPlantillaSaldo(f)); }
});

// Contador de caracteres en Datos, al tipear.
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.saldo) { totalesSaldo(); return; }
  if (!el.dataset || !el.dataset.param || el.type === 'checkbox') return;
  const c = document.querySelector(`[data-cont="${CSS.escape(el.dataset.param)}"]`);
  if (c) c.textContent = `${num(el.value.length)} de ${num(Number(el.maxLength) > 0 ? el.maxLength : L.MAX_TEXTO)} caracteres`;
});

// Enter en una casilla de cantidad = guardar (ahorra un toque con teclado numérico que tiene "Ir").
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.matches('[data-cant], #c-caravana')) { e.preventDefault(); unaVez(guardarCarga); }
  else if (e.target.matches('[data-ccant]')) { e.preventDefault(); unaVez(guardarConteo); }
});

// Imprimir desde el menú del navegador (Ctrl+P, Compartir → Imprimir): siempre con los datos de este momento.
window.addEventListener('beforeprint', prepararImpresion);

// ---------- Arranque ----------
async function cargarEstado(datos = null) {
  // Después de importar se usa lo que ya está en memoria (recién escrito en una sola transacción): no hace falta volver a leerlo.
  const d = datos || await DB.leerTodo();
  const semilla = {};
  if (!d.rodeos.length && !d.categorias.length) { semilla.rodeos = RODEOS_INICIALES; semilla.categorias = CATEGORIAS_INICIALES; }
  if (!d.parametros) semilla.kv = { parametros: PARAMETROS_INICIALES };
  if (Object.keys(semilla).length) await DB.guardar(semilla);
  S.rodeos = d.rodeos.length ? d.rodeos : structuredClone(RODEOS_INICIALES);
  S.categorias = d.categorias.length ? d.categorias : structuredClone(CATEGORIAS_INICIALES);
  S.movimientos = d.movimientos; S.conteos = d.conteos;
  const np = L.normalizarParametros(d.parametros || {}, PARAMETROS_INICIALES);
  S.parametros = np.parametros;
  if (np.recortados.length) {
    // Un texto guardado más largo que el tope (p. ej. de una versión sin tope): se recorta, no se vacía.
    await DB.guardar({ kv: { parametros: S.parametros } });
    S.avisoRecortes = np.recortados;
  }
  if (np.arreglados.length) {
    // Un dato guardado con un tipo que no corresponde (archivo viejo o dañado): vuelve al valor por defecto y se avisa.
    await DB.guardar({ kv: { parametros: S.parametros } });
    S.avisoParametros = np.arreglados;
  }
  S.meta = d.meta || {};
  // Datos de la v0.3 (categorías copiadas del papel): se pasan a las categorías SENASA sin reescribir la historia.
  if (L.esModeloViejo(S, MAPEO_V03, CATEGORIAS_INICIALES.map((c) => c.id))) {
    const mg = migrarModelo({ rodeos: S.rodeos, categorias: S.categorias, movimientos: S.movimientos, conteos: S.conteos, parametros: S.parametros });
    if (mg.limpio) await DB.reemplazarTodo(mg.estado, { parametros: mg.estado.parametros, meta: S.meta }, { respaldar: false });
    else await DB.guardar({ rodeos: mg.estado.rodeos, categorias: mg.estado.categorias, movimientos: mg.nuevos, kv: { parametros: mg.estado.parametros } });
    S.rodeos = mg.estado.rodeos; S.categorias = mg.estado.categorias; S.movimientos = mg.estado.movimientos; S.parametros = mg.estado.parametros;
    if (!mg.limpio) S.avisoMigracion = mg;
  }
  // Conteos de backups viejos (v0.1): se reconstruye la diferencia del momento de contar (D1).
  const mig = L.migrarConteos(S.conteos, S.movimientos);
  if (mig.cambiados.length) { S.conteos = mig.conteos; await DB.guardar({ conteos: mig.cambiados }); }
  if (revisarFechaSesion()) await guardarMeta();
}

// Migración v0.3 → v0.4 con los datos de esta app (catálogo nuevo, mapeo y esperadas de seeds.js).
function migrarModelo(estado) {
  const cal = ['paricionDesde', 'paricionHasta', 'servicio', 'inseminacion', 'tacto', 'destete', 'yerra', 'paseTerneros', 'paseToro', 'porcentajeToros'];
  return L.migrarModeloV03(estado, {
    mapeo: MAPEO_V03, categoriasNuevas: CATEGORIAS_INICIALES, rodeosNuevos: RODEOS_INICIALES, esperadasViejas: ESPERADAS_V03,
    parametrosNuevos: Object.fromEntries(cal.map((k) => [k, PARAMETROS_INICIALES[k]])), hoy: hoyIso(), ahoraIso: new Date().toISOString(),
  });
}
function textoMigracion(mg) {
  const cab = mg.nuevos.reduce((s2, m) => s2 + m.cantidad, 0);
  return `<p>Las categorías ahora son las de SENASA (vaca, vaquillona, ternero, ternera, torito, toro). CUT, Vacías y Mamones son rodeos.</p>
    <p>Se agregaron <b>${num(mg.nuevos.length)} renglones de cambio de categoría</b> (${num(cab)} cabezas) con fecha ${fFecha(mg.fecha)} y motivo "Cambio de modelo v0.4". La historia anterior no se tocó: las categorías viejas quedaron desactivadas. El total de cabezas no cambia.</p>
    ${mg.avisos.length ? `<p class="error">Para revisar:</p><ul>${mg.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}`;
}

// Al volver a la app (estaba en segundo plano, o abierta desde ayer): revisar la fecha de carga.
function alVolver() {
  if (!S.meta) return;
  const enConteo = S.vista === 'conteos' && CT.modo === 'nuevo';
  if (enConteo) leerConteoVisibles();
  const a = revisarFechaSesion();
  const b = revisarFechaConteo();
  if (!a && !b) return;
  if (S.vista === 'cargar' && C.paso === 'cant') leerCantVisibles();
  guardarMeta(); render();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') alVolver(); });
window.addEventListener('pageshow', alVolver);
window.addEventListener('focus', alVolver);

DB.alBloquear(() => {
  $('#vista').innerHTML = `<h1>Cerrá la otra ventana de la app</h1><p>Hay otra ventana o pestaña de esta app abierta con una versión anterior, y la base de datos se está actualizando.</p><p>Cerrala (o cerrá la pestaña de Chrome con la app) y esta pantalla sigue sola. No se pierde nada.</p>`;
});
DB.alVersionNueva(() => {
  try { toast('La app se actualizó en otra ventana. Recargando…'); } catch { /* sin pantalla */ }
  setTimeout(() => location.reload(), 800);
});

async function iniciar() {
  try {
    await cargarEstado();
  } catch (e) {
    $('#vista').innerHTML = `<h1>No se pudieron abrir los datos</h1><p class="error">${esc(e.message)}</p><p>Puede pasar en modo privado/incógnito. Abrí la app normal.</p>`;
    return;
  }
  render();
  if (S.avisoMigracion) {
    const mg = S.avisoMigracion; S.avisoMigracion = null;
    await aviso('La app pasó a las categorías SENASA', textoMigracion(mg));
  }
  if (S.avisoParametros) {
    const ks = S.avisoParametros; S.avisoParametros = null;
    await aviso('Se arreglaron datos guardados', `<p>Algunos datos de <b>Más → Datos a confirmar y membrete</b> estaban guardados con un formato que no corresponde y volvieron a su valor por defecto: ${ks.map((k) => `<b>${esc(L.NOMBRE_PARAMETRO[k] || k)}</b>`).join(', ')}.</p><p>Revisalos y volvé a escribirlos si hace falta. El stock no cambió.</p>`);
  }
  if (S.avisoRecortes) {
    const rs = S.avisoRecortes; S.avisoRecortes = null;
    await avisarRecortes(rs, 'Se recortaron datos guardados');
  }
  S.persistido = await DB.pedirPersistencia();
  await actualizarRespaldo();
  if (S.vista === 'mas' && S.sub === 'backup') render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
iniciar();

// Para pruebas automáticas (Verificador): acceso de solo lectura al estado.
window.__stock = { S, L, IDX, version: VERSION_APP };
