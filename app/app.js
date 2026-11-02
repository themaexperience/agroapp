// app.js — Interfaz. Toda la lógica de stock vive en ledger.js; acá solo se muestra y se carga.
import * as L from './ledger.js';
import * as DB from './db.js';
import { RODEOS_INICIALES, CATEGORIAS_INICIALES, PARAMETROS_INICIALES, ATAJOS, DESTINO_PROBABLE } from './seeds.js';

const VERSION_APP = '0.2.0';

// ---------- Estado ----------
const S = {
  rodeos: [], categorias: [], movimientos: [], conteos: [], parametros: {}, meta: {},
  vista: 'cargar', sub: 'menu',
  persistido: null,
};
let C = nuevaCarga();          // estado del asistente de carga
let CT = { modo: 'lista' };    // estado de conteos
let stockFecha = null, stockModo = 'rodeo', informeFecha = null, movsVer = 50, conteosVer = 20, anuladosVer = 20, abiertasVer = 30;

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
const fFechaDe = (ts) => (ts ? fFecha(hoyLocal(new Date(ts))) : '');
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
  const claves = L.clavesDe([...nuevos, ...anuladosNuevos]);
  const negs = L.negativosPorCambio(S.movimientos, despues, claves);
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
    await aviso('No se pudo guardar', `<p class="error">${esc(e?.message || e)}</p><p>No se guardó nada. Probá de nuevo.</p>`);
    return false;
  }
  S.movimientos = despues;
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
  if (vista === 'conteos') { CT = { modo: 'lista' }; conteosVer = 20; anuladosVer = 20; abiertasVer = 30; }
  render(); window.scrollTo(0, 0);
}

function render() {
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
// Filas de un atajo que se pueden usar desde un rodeo de origen.
function filasAtajo(a, rodeoO) {
  return a.filas.map((f, i) => ({ ...f, key: 'f' + i }))
    .filter((f) => cat(f.cat)?.activa && (!f.rodeo || rodeo(f.rodeo)?.activo) && !(f.cat === a.catO && (f.rodeo || rodeoO) === rodeoO));
}
const atajosDisponibles = () => ATAJOS.filter((a) => cat(a.catO)?.activa && filasAtajo(a, null).length);

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
  if (C.catO) sel.push('de ' + esc(nomC(C.catO)));
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
    cuerpo = `<h1>¿Qué categoría cambia?</h1><div class="grilla">${catsActivas().map((c) => `<button class="btn" data-cato="${c.id}">${esc(c.nombre)}<small>hay ${num(st[c.id])}</small></button>`).join('')}</div>`;
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
function chipsDestino(opciones) {
  const actual = C.rodeoD || C.rodeoO;
  return `<div class="chips-titulo">¿Quedan en qué rodeo?</div><div class="chips">${opciones.map((id) =>
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
    origenTxt = `<p>Salen de <b>${esc(nomC(C.catO))}</b> (hay ${num(st[C.catO])}).</p>`;
    if (C.atajo) {
      const a = atajo(C.atajo);
      const fs = filasAtajo(a, C.rodeoO);
      const libres = fs.some((f) => !f.rodeo);
      const opciones = [C.rodeoO, ...a.rodeosDestino.filter((id) => id !== C.rodeoO && rodeo(id)?.activo)];
      titulo = '¿Cuántos pasan a cada una?';
      extra = libres && opciones.length > 1 ? chipsDestino(opciones) : '';
      const dest = C.rodeoD || C.rodeoO;
      filas = fs.map((f) => {
        const r = f.rodeo || dest;
        const stD = stockEn(r, fechaSesion());
        return filaCant(f.key, f.texto || nomC(f.cat), `en ${esc(nomR(r))} hay ${num(stD[f.cat])}`);
      }).join('');
    } else {
      titulo = '¿A qué categoría pasan y cuántos?';
      extra = chipsDestino(rodeosActivos().map((r) => r.id));
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
    filas = catsActivas().map((c) => {
      let ext = '';
      const d = rojas.get(c.id);
      // Solo se ofrece vincular si el signo del ajuste coincide con lo que falta explicar.
      if (d && Math.sign(d.pendiente) === C.signo) {
        if (C.vinc[c.id] === undefined) { C.vinc[c.id] = d.conteo.id; if (C.cant[c.id] === undefined) C.cant[c.id] = String(Math.abs(d.pendiente)); }
        const on = !!C.vinc[c.id];
        ext = `<button class="btn vinc ${on ? 'sel' : ''}" data-vinc="${c.id}" data-conteo="${d.conteo.id}" aria-pressed="${on}">${on ? '✔ ' : ''}Explica la diferencia del conteo del ${fFecha(d.conteo.fecha)} (${numS(d.pendiente)})</button>`;
      }
      return filaCant(c.id, c.nombre, `hay ${num(st[c.id])}`, ext);
    }).join('');
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
  if (C.tipo === 'nacimiento') foco = inputs.find((i) => i.dataset.cant === 'c-terneros') || foco;
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
  const err = $('#c-error');
  leerCantVisibles();
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
        let destCat = key, destRodeo = C.rodeoD || r;
        if (C.atajo) { const f = filasAtajo(atajo(C.atajo), r).find((x) => x.key === key); destCat = f.cat; destRodeo = f.rodeo || C.rodeoD || r; }
        const tipo = destCat === C.catO ? 'traslado' : 'cambio_categoria';
        nuevos.push(nuevoMov({ ...base, tipo, cantidad: n, origen: { rodeoId: r, categoriaId: C.catO }, destino: { rodeoId: destRodeo, categoriaId: destCat } }));
        break;
      }
    }
  }
  if (!(await registrar(nuevos))) return;
  if (C.tipo === 'cambio_categoria' && !C.atajo && pares.length === 1) {
    S.meta.ultimoDestino = { ...(S.meta.ultimoDestino || {}), [C.catO]: pares[0][0] };
    guardarMeta();
  }
  const d = describir(nuevos[0]);
  toast(`Guardado: ${d.tipo} · ${nuevos.length > 1 ? nuevos.length + ' renglones' : d.lugar}`);
  C = nuevaCarga(); render();
}

function etiquetaCant(key) {
  if (C.atajo) { const f = filasAtajo(atajo(C.atajo), C.rodeoO).find((x) => x.key === key); return f ? (f.texto || nomC(f.cat)) : key; }
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
  const filas = rs.map((r) => `<tr><td class="txt">${esc(r.nombre)}${conUbic && r.ubicacion ? `<span class="ubic">${esc(r.ubicacion)}</span>` : ''}</td>${cs.map((c) => celda(mapa.get(L.clave(r.id, c.id)) || 0)).join('')}<td><b>${num(t.porRodeo.get(r.id) || 0)}</b></td></tr>`).join('');
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
    if (items.length) con.push(`<div class="tarjeta rodeo-card"><div class="rc-cab"><div><b>${esc(r.nombre)}</b>${r.ubicacion ? `<div class="chico">${esc(r.ubicacion)}</div>` : ''}</div><div class="rc-total">${num(t.porRodeo.get(r.id) || 0)}</div></div>
      ${items.map(([c, v]) => `<div class="rc-fila"><span>${esc(c.nombre)}</span><span class="${v < 0 ? 'neg' : ''}">${num(v)}</span></div>`).join('')}</div>`);
    else if (r.activo) sin.push(esc(r.nombre));
  }
  return con.join('') + (sin.length ? `<p class="chico">Rodeos sin animales: ${sin.join(', ')}.</p>` : '');
}

function vStock() {
  const f = stockFecha || hoyIso();
  const mapa = L.calcularStock(S.movimientos, f);
  const t = L.totales(mapa);
  if (!S.movimientos.length) {
    return `<h1>Stock</h1><div class="tarjeta"><p><b>Todavía no hay movimientos cargados.</b></p>
      <p>Para empezar, cargá el saldo inicial (lo que dice la última planilla) o importá tu archivo de arranque.</p>
      <div class="fila-btns"><button class="btn prim" data-ir="mas" data-sub="saldo">Cargar saldo inicial</button><button class="btn" data-ir="mas" data-sub="backup">Importar archivo</button></div></div>`;
  }
  const est = L.diferenciasConteo(S.conteos, S.movimientos, IDX());
  const rojas = est.filter((d) => L.ROJOS.has(d.estado)).length;
  const ambar = est.filter((d) => d.estado === 'cuadra_sin_confirmar').length;
  const negs = [...mapa.values()].filter((v) => v < 0).length;
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
    ${negs ? `<div class="aviso rojo" role="alert">${num(negs)} casilla${negs > 1 ? 's' : ''} en negativo al ${fFecha(f)}. Revisá los movimientos de esos rodeos.</div>` : ''}
    ${rojas ? `<button class="aviso rojo" data-ir="conteos">${num(rojas)} diferencia${rojas > 1 ? 's' : ''} de conteo sin explicar. Tocá para verlas.</button>` : ''}
    ${ambar ? `<button class="aviso" data-ir="conteos">${num(ambar)} diferencia${ambar > 1 ? 's' : ''} que ahora cuadra${ambar > 1 ? 'n' : ''}: falta confirmar la explicación.</button>` : ''}
    <div class="fila-btns"><button class="btn ${stockModo === 'rodeo' ? 'sel' : ''}" data-stockmodo="rodeo">Por rodeo</button><button class="btn ${stockModo === 'categoria' ? 'sel' : ''}" data-stockmodo="categoria">Por categoría</button><button class="btn ${stockModo === 'planilla' ? 'sel' : ''}" data-stockmodo="planilla">Ver como planilla</button></div>
    ${cuerpo}`;
}

// =============== CONTEOS ===============
const NOMBRE_ESTADO = {
  sin_explicar: 'Diferencia sin explicar', reabierta: 'Diferencia reabierta', cuadra_sin_confirmar: 'Cuadra ahora: falta confirmar la explicación',
  explicada: 'Explicada', cuadra: 'Cuadra', anulado: 'Conteo anulado',
};
const CLASE_ESTADO = {
  sin_explicar: 'rojo sin_explicar', reabierta: 'rojo sin_explicar reabierta', cuadra_sin_confirmar: 'ambar cuadra_sin_confirmar',
  explicada: 'explicada', cuadra: 'cuadra', anulado: 'anulado',
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

function itemConteo(d, pis = new Map(), expl = new Map()) {
  const c = d.conteo;
  const lineas = [];
  lineas.push(`<div>Contado <b>${num(c.cantidad)}</b> · Según el libro <b>${num(d.calculado)}</b></div>`);
  if (d.original !== null && d.original !== 0 && d.estado !== 'sin_explicar' && d.estado !== 'anulado') lineas.push(`<div class="chico">Al contar, la diferencia era <b>${numS(d.original)}</b>.</div>`);
  for (const m of d.ajustes) lineas.push(`<div class="chico">${m.cantidad === 0 ? 'Explicación confirmada' : `Ajuste ${numS(L.signoAjuste(m))}`} (${fFecha(m.fecha)}): ${esc(m.motivo)}</div>`);
  let botones = '';
  if (L.ROJOS.has(d.estado)) {
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
    lineas.push(`<div>Cuadra por movimientos cargados después del conteo:</div>${ms.length ? `<ul class="lista-expl">${ms.map((m) => { const x = describir(m); return `<li>${esc(x.tipo)} ${fFecha(m.fecha)} · ${esc(x.lugar)}${m.nota ? ` · ${esc(m.nota)}` : ''}</li>`; }).join('')}</ul>` : ''}`);
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
  if (!CT.rodeo) {
    return `<div class="fila-btns"><button class="btn" data-acc="conteo-cancelar">← Volver</button></div>
      <div class="fecha-sesion"><label for="f-conteo">Fecha del conteo:</label><input type="date" id="f-conteo" value="${f}"></div>
      <h1>¿Qué rodeo se contó?</h1>${gridRodeos('conteo')}`;
  }
  return `<div class="fila-btns"><button class="btn" data-acc="conteo-atras">← Atrás</button></div>
    <div class="fecha-sesion"><label for="f-conteo">Fecha del conteo:</label><input type="date" id="f-conteo" value="${f}"></div>
    <div class="resumen-sel"><b>Conteo</b> · ${esc(nomR(CT.rodeo))}</div>
    <h1>¿Cuántos se contaron?</h1><p class="chico">Dejá vacío lo que no se contó. Escribí 0 si se contó y no había ninguno.</p>
    ${catsActivas().map((c) => `<div class="cant-fila"><div class="nom">${esc(c.nombre)}</div><input class="num" type="text" inputmode="numeric" pattern="[0-9]*" data-ccant="${c.id}" aria-label="${esc(c.nombre)}" autocomplete="off"></div>`).join('')}
    <details><summary>Quién o cómo se contó (opcional)</summary>
      <label class="campo"><span>Origen del conteo (ej.: tranquera, conteo 2, acta de vacunación)</span><input type="text" id="ct-origen" autocomplete="off"></label>
      <label class="campo"><span>Nota (opcional)</span><textarea id="ct-nota" rows="2" autocomplete="off"></textarea></label></details>
    <div class="error" id="ct-error"></div>
    <button class="btn prim grande" data-acc="guardar-conteo">Guardar conteo</button>`;
}

function postConteos() {
  if (CT.modo === 'nuevo' && CT.rodeo) document.querySelector('[data-ccant]')?.focus({ preventScroll: true });
}

async function guardarConteo() {
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
  try { await DB.guardar({ conteos: nuevos }); } catch (e) { err.textContent = 'No se pudo guardar: ' + (e?.message || e); return; }
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
  if (!d || d.estado !== 'cuadra_sin_confirmar') return;
  const c = d.conteo;
  const ms = L.movimientosQueExplican([d], S.movimientos).get(c.id) || [];
  const sugerido = ms.length ? 'Explicada por: ' + ms.map((m) => { const x = describir(m); return `${x.tipo} ${fFecha(m.fecha)} (${x.lugar})`; }).join('; ') : '';
  const motivo = await pedirMotivo('Confirmar explicación',
    `<p><b>${esc(nomR(c.rodeoId))} · ${esc(nomC(c.categoriaId))}</b> al ${fFecha(c.fecha)}: al contar la diferencia era ${numS(d.original)} y ahora cuadra.</p>
     <p class="chico">Confirmar no cambia el stock: deja escrito por qué cuadra. Revisá o cambiá el motivo.</p>`, false, sugerido);
  if (!motivo) return;
  const m = nuevoMov({ tipo: 'ajuste', fecha: c.fecha, cantidad: 0, motivo, conteoId: c.id, destino: { rodeoId: c.rodeoId, categoriaId: c.categoriaId } });
  if (await registrar([m])) { toast('Explicación confirmada'); render(); }
}

async function anularConteo(id) {
  const c = S.conteos.find((x) => x.id === id);
  const motivo = await pedirMotivo('Anular conteo', `<p>${esc(nomR(c.rodeoId))} · ${esc(nomC(c.categoriaId))} · ${fFecha(c.fecha)} · contado ${num(c.cantidad)}.</p><p class="chico">No se borra: queda en la lista de conteos anulados, tachado, con el motivo.</p>`);
  if (!motivo) return;
  const n = { ...c, anulado: { fecha: new Date().toISOString(), motivo } };
  try { await DB.guardar({ conteos: [n] }); } catch (e) { await aviso('No se pudo anular', `<p class="error">${esc(e?.message || e)}</p>`); return; }
  S.conteos = S.conteos.map((x) => (x.id === id ? n : x));
  toast('Conteo anulado'); render();
}

// =============== HISTORIAL ===============
const RESUMEN_TIPOS = [['nacimiento', 'Nacimientos'], ['mortandad', 'Mortandad'], ['venta', 'Ventas'], ['ingreso', 'Ingresos / compras'], ['ajuste', 'Ajustes']];
function vHistorial() {
  const h = L.historialMensual(S.movimientos, hoyIso()).reverse();
  if (!h.length) return '<h1>Historial mensual</h1><p>Todavía no hay movimientos.</p>';
  const cs = [...S.categorias].sort((a, b) => a.orden - b.orden);
  const tarjetas = h.map((f) => {
    const mov = RESUMEN_TIPOS.filter(([k]) => f.resumen[k]).map(([k, n]) => `<div class="rc-fila"><span>${n}</span><span>${k === 'ajuste' ? numS(f.resumen[k]) : num(f.resumen[k])}</span></div>`).join('');
    const porCat = cs.map((c) => [c, f.porCategoria.get(c.id) || 0]).filter(([, v]) => v).map(([c, v]) => `<div class="rc-fila"><span>${esc(c.nombre)}</span><span class="${v < 0 ? 'neg' : ''}">${num(v)}</span></div>`).join('');
    return `<div class="tarjeta"><div class="rc-cab"><div><b>${fMes(f.mes)}</b><div class="chico">al ${fFecha(f.fecha)}</div></div><div class="rc-total">${num(f.total)}</div></div>
      ${f.variacion !== null ? `<div class="rc-fila"><span>Variación contra el mes anterior</span><span class="${f.variacion < 0 ? 'neg' : ''}"><b>${numS(f.variacion)}</b></span></div>` : ''}
      ${mov ? `<div class="hist-sub">Movimientos del mes</div>${mov}` : ''}
      ${porCat ? `<div class="hist-sub">Stock por categoría al cierre</div>${porCat}` : ''}</div>`;
  }).join('');
  return `<h1>Historial mensual</h1><p class="chico">Stock al último día de cada mes (el mes en curso, con lo cargado hasta ahora). El saldo inicial no se cuenta como ingreso.</p>${tarjetas}`;
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
const cssStr = (s) => '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';

function htmlInforme({ limiteDifs = Infinity } = {}) {
  const f = informeFecha || hoyIso();
  const P = S.parametros;
  const mapa = L.calcularStock(S.movimientos, f);
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
    <div class="inf-tabla">${tabla}</div>
    <h3>Diferencias de conteo sin explicar: ${num(difs.length)}${ambar ? ` · que cuadran sin confirmar: ${num(ambar)}` : ''}</h3>
    ${difs.length ? `<table class="inf-difs"><thead><tr><th>Fecha</th><th>Rodeo</th><th>Categoría</th><th>Contado</th><th>Según el libro</th><th>Diferencia</th></tr></thead><tbody>${difs.slice(0, limiteDifs).map((d) => `<tr><td>${fFecha(d.conteo.fecha)}</td><td class="txt">${esc(nomR(d.conteo.rodeoId))}</td><td class="txt">${esc(nomC(d.conteo.categoriaId))}</td><td>${num(d.conteo.cantidad)}</td><td>${num(d.calculado)}</td><td><b>${numS(d.pendiente)}</b></td></tr>`).join('')}</tbody></table>${difs.length > limiteDifs ? `<p>Y ${num(difs.length - limiteDifs)} más: salen todas en el informe impreso o descargado.</p>` : ''}` : '<p>Ninguna.</p>'}
  </div>`;
}

function vInforme() {
  return `<h1>Informe para imprimir</h1>
    <div class="fecha-sesion"><label for="f-informe">Stock al:</label><input type="date" id="f-informe" value="${informeFecha || hoyIso()}"></div>
    <div class="fila-btns"><button class="btn prim" data-acc="imprimir">Imprimir / Guardar PDF</button><button class="btn" data-acc="descargar-informe">Descargar informe (HTML para imprimir)</button></div>
    <p class="chico">En el celular: "Imprimir" y después "Guardar como PDF". Si no aparece, usá "Descargar informe" y abrilo para imprimir.</p>
    <div class="tabla-wrap vista-previa">${htmlInforme({ limiteDifs: 30 })}</div>`;
}

async function cssTexto() {
  try { return await (await fetch('styles.css')).text(); } catch { return ''; }
}

async function descargarInforme() {
  const css = await cssTexto();
  const f = informeFecha || hoyIso();
  const html = `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stock al ${fFecha(f)}</title><style>${css}
body{padding:16px;background:#fff}</style></head><body class="solo-informe"><div id="impresion" style="display:block">${htmlInforme()}</div><p style="font-family:Arial"><button onclick="window.print()" style="min-height:52px;font-size:18px">Imprimir</button></p><style>@media print{button{display:none}}</style></body></html>`;
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
      <div class="fila-btns"><label class="check"><input type="checkbox" data-cfg="rodeo" data-id="${r.id}" data-campo="activo" ${r.activo ? 'checked' : ''}> Activo</label>
      <button class="btn" data-orden="rodeo" data-id="${r.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button><button class="btn" data-orden="rodeo" data-id="${r.id}" data-dir="1" ${i === rs.length - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button></div></div>`).join('')}
    <button class="btn grande" data-acc="agregar-rodeo">Agregar rodeo</button>
    <h2>Categorías</h2>
    ${cs.map((c, i) => `<div class="cfg-fila">
      <label class="campo"><span>Nombre</span><input type="text" data-cfg="cat" data-id="${c.id}" data-campo="nombre" value="${esc(c.nombre)}"></label>
      <label class="campo"><span>Equivale a (SENASA), opcional</span><input type="text" data-cfg="cat" data-id="${c.id}" data-campo="senasa" value="${esc(c.senasa || '')}"></label>
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
    const x = { id: 'r-' + L.nuevoId(), nombre: r, ubicacion: '', orden: Math.max(0, ...S.rodeos.map((o) => o.orden)) + 1, activo: true };
    await DB.guardar({ rodeos: [x] }); S.rodeos.push(x);
  } else {
    const x = { id: 'c-' + L.nuevoId(), nombre: r, orden: Math.max(0, ...S.categorias.map((o) => o.orden)) + 1, activa: true, cuentaComoVaca: false, senasa: '' };
    await DB.guardar({ categorias: [x] }); S.categorias.push(x);
  }
  render();
}

// ----- Parámetros -----
const PARAMS_UI = [
  ['empresa', 'Empresa (membrete)'], ['campo', 'Campo (membrete)'], ['localidad', 'Localidad (membrete)'], ['renspa', 'RENSPA'], ['cuit', 'CUIT'],
  ['vacasDeclaradas', 'Cantidad de vacas declarada (a confirmar). Solo de referencia; el stock se calcula.'],
  ['paricionDesde', 'Parición desde (a confirmar)'], ['paricionHasta', 'Parición hasta (a confirmar)'],
  ['porcentajeToros', '% de toros (a confirmar)'], ['queEsEnfrente', 'Qué es "Enfrente"'],
];
function vParametros() {
  const P = S.parametros;
  return `<h1>Datos a confirmar y membrete</h1><p class="chico">Ninguno de estos datos está fijo en la app. Se guardan al salir de cada casilla.</p>
    ${PARAMS_UI.map(([k, t]) => `<label class="campo"><span>${esc(t)}</span><input type="text" data-param="${k}" value="${esc(P[k] ?? '')}"></label>`).join('')}
    <label class="check"><input type="checkbox" data-param="mostrarCuitEnInforme" ${P.mostrarCuitEnInforme ? 'checked' : ''}> Mostrar CUIT en el informe</label>
    <p class="chico">Qué cuenta como "vaca": se marca en Rodeos y categorías.</p>
    <label class="campo"><span>Potreros (uno por renglón, texto libre)</span><textarea data-param="potreros">${esc(P.potreros || '')}</textarea></label>
    <label class="campo"><span>Motivos rápidos de ajuste (uno por renglón)</span><textarea data-param="motivosAjuste">${esc((P.motivosAjuste || []).join('\n'))}</textarea></label>`;
}
async function cambiarParam(el) {
  const k = el.dataset.param;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (k === 'motivosAjuste') v = v.split('\n').map((s) => s.trim()).filter(Boolean);
  else if (typeof v === 'string') v = v.trim();
  S.parametros[k] = v;
  await DB.guardar({ kv: { parametros: S.parametros } });
  toast('Guardado');
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
  const cs = catsActivas();
  return `<h1>Saldo inicial</h1>
    <p>Transcribí la planilla de partida: lo que había en cada rodeo ese día. Dejá vacío lo que no hay.</p>
    <div class="fecha-sesion"><label for="f-saldo">Fecha de la planilla:</label><input type="date" id="f-saldo" value="${fechaSesion()}"></div>
    ${rodeosActivos().map((r) => `<div class="tarjeta"><b>${esc(r.nombre)}</b>${cs.map((c) => `<div class="cant-fila"><div class="nom">${esc(c.nombre)}</div><input class="num" type="text" inputmode="numeric" pattern="[0-9]*" data-saldo="${r.id}|${c.id}" aria-label="${esc(r.nombre + ' ' + c.nombre)}" autocomplete="off"></div>`).join('')}</div>`).join('')}
    <div class="error" id="s-error"></div>
    <button class="btn prim grande" data-acc="cargar-saldo" style="margin-top:12px">Guardar saldo inicial</button>`;
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
    <input type="file" id="imp-archivo" accept=".json,.xlsx,application/json" hidden>`;
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

async function exportarJson() {
  const b = L.armarBackup(estadoDatos(), new Date().toISOString());
  descargar(new Blob([JSON.stringify(b)], { type: 'application/json' }), `backup-stock-${sello()}.json`);
  await marcarBackup(); toast('Backup exportado'); render();
}

// Excel: primero las columnas para leer (nombres), después las técnicas (ids) que sirven para reimportar exacto.
const COL_MOV_LEER = ['Fecha', 'Tipo', 'Rodeo origen', 'Categoría origen', 'Rodeo destino', 'Categoría destino', 'Cantidad', 'Caravana', 'Nota', 'Motivo', 'Anulado el', 'Motivo de anulación'];
const COL_MOV = ['id', 'fecha', 'tipo', 'cantidad', 'origen_rodeo_id', 'origen_categoria_id', 'destino_rodeo_id', 'destino_categoria_id', 'nota', 'caravana', 'motivo', 'conteo_id', 'lote', 'creado', 'anulado_fecha', 'anulado_motivo', 'corrige_a', 'antes_json', 'extra_json'];
const COL_CON_LEER = ['Fecha', 'Rodeo', 'Categoría', 'Contado', 'Origen del conteo', 'Anulado el'];
const COL_CON = ['id', 'fecha', 'rodeo_id', 'categoria_id', 'cantidad', 'origen', 'nota', 'creado', 'anulado_fecha', 'anulado_motivo', 'diferencia_original', 'calculado_al_contar'];
const COL_ROD = ['id', 'nombre', 'ubicacion', 'orden', 'activo'];
const COL_CAT = ['id', 'nombre', 'orden', 'activa', 'cuenta_como_vaca', 'senasa'];

function filaMov(m) {
  const leer = [fFecha(m.fecha), describir(m).tipo, m.origen ? nomR(m.origen.rodeoId) : '', m.origen ? nomC(m.origen.categoriaId) : '', m.destino ? nomR(m.destino.rodeoId) : '', m.destino ? nomC(m.destino.categoriaId) : '',
    m.tipo === 'ajuste' ? L.signoAjuste(m) : m.cantidad, m.caravana ?? '', m.nota ?? '', m.motivo ?? '', m.anulado ? fFechaDe(m.anulado.fecha) : '', m.anulado?.motivo ?? ''];
  const tec = [m.id, m.fecha, m.tipo, m.cantidad, m.origen?.rodeoId ?? '', m.origen?.categoriaId ?? '', m.destino?.rodeoId ?? '', m.destino?.categoriaId ?? '', m.nota ?? '', m.caravana ?? '', m.motivo ?? '', m.conteoId ?? '', m.lote ?? '', m.creado ?? '', m.anulado?.fecha ?? '', m.anulado?.motivo ?? '', m.corrigeA ?? '', m.antes ? JSON.stringify(m.antes) : '', JSON.stringify(m.extra || {})];
  return [...leer, ...tec];
}
const celda = (v) => (typeof v === 'number' ? { value: v, type: Number } : typeof v === 'boolean' ? { value: v, type: Boolean } : { value: String(v ?? ''), type: String });
const hoja = (nombre, cols, filas) => ({ sheet: nombre, data: [cols.map((c) => ({ value: c, fontWeight: 'bold' })), ...filas.map((f) => f.map(celda))] });

async function exportarExcel() {
  if (typeof writeXlsxFile === 'undefined') { toast('No se pudo cargar el módulo de Excel'); return; }
  const b = L.armarBackup(estadoDatos(), new Date().toISOString());
  const hoy = hoyIso();
  const mapa = L.calcularStock(S.movimientos, hoy);
  const t = L.totales(mapa);
  const cs = [...S.categorias].sort((a, b2) => a.orden - b2.orden), rs = [...S.rodeos].sort((a, b2) => a.orden - b2.orden);
  const stockFilas = [[`Stock al ${fFecha(hoy)}`, ...cs.map(() => ''), ''],
    ...rs.map((r) => [r.nombre, ...cs.map((c) => mapa.get(L.clave(r.id, c.id)) || 0), t.porRodeo.get(r.id) || 0]),
    ['Totales', ...cs.map((c) => t.porCategoria.get(c.id) || 0), t.total]];
  const hojas = [
    hoja('Control', ['clave', 'valor'], [['app', b.app], ['formato', b.formato], ['exportado', b.exportado], ['movimientos', b.cuentas.movimientos], ['conteos', b.cuentas.conteos], ['rodeos', b.cuentas.rodeos], ['categorias', b.cuentas.categorias]]),
    hoja('Stock actual', ['Rodeo', ...cs.map((c) => c.nombre), 'Total'], stockFilas),
    hoja('Movimientos', [...COL_MOV_LEER, ...COL_MOV], S.movimientos.map(filaMov)),
    hoja('Conteos', [...COL_CON_LEER, ...COL_CON], S.conteos.map((c) => [fFecha(c.fecha), nomR(c.rodeoId), nomC(c.categoriaId), c.cantidad, c.origen ?? '', c.anulado ? fFechaDe(c.anulado.fecha) : '',
      c.id, c.fecha, c.rodeoId, c.categoriaId, c.cantidad, c.origen ?? '', c.nota ?? '', c.creado ?? '', c.anulado?.fecha ?? '', c.anulado?.motivo ?? '', c.diferenciaOriginal ?? '', c.calculadoAlContar ?? ''])),
    hoja('Rodeos', COL_ROD, S.rodeos.map((r) => [r.id, r.nombre, r.ubicacion ?? '', r.orden, !!r.activo])),
    hoja('Categorias', COL_CAT, S.categorias.map((c) => [c.id, c.nombre, c.orden, !!c.activa, !!c.cuentaComoVaca, c.senasa ?? ''])),
    hoja('Parametros', ['clave', 'valor_json'], Object.entries(S.parametros).map(([k, v]) => [k, JSON.stringify(v)])),
  ];
  const blob = await writeXlsxFile(hojas).toBlob();
  descargar(blob, `stock-${sello()}.xlsx`);
  await marcarBackup(); toast('Excel exportado'); render();
}

// Lee un .xlsx exportado por esta app y lo convierte en backup (usa las columnas técnicas).
async function excelABackup(file) {
  const hojas = await readXlsxFile(file);
  const porNombre = Object.fromEntries(hojas.map((h) => [h.sheet, h.data]));
  const objs = (nombre) => {
    const d = porNombre[nombre]; if (!d) throw new Error(`Falta la hoja "${nombre}": no parece un Excel exportado por esta app`);
    const [cab, ...filas] = d;
    // Si una columna aparece dos veces (legible y técnica con el mismo nombre), gana la técnica (la última).
    return filas.map((f) => { const o = {}; cab.forEach((c, i) => { o[c] = f[i] ?? ''; }); return o; });
  };
  const s = (v) => (v === null || v === undefined ? '' : String(v));
  const n = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const ctrl = Object.fromEntries(objs('Control').map((o) => [o.clave, o.valor]));
  const movimientos = objs('Movimientos').map((o) => ({
    id: s(o.id), fecha: s(o.fecha), tipo: s(o.tipo), cantidad: n(o.cantidad),
    origen: o.origen_rodeo_id ? { rodeoId: s(o.origen_rodeo_id), categoriaId: s(o.origen_categoria_id) } : null,
    destino: o.destino_rodeo_id ? { rodeoId: s(o.destino_rodeo_id), categoriaId: s(o.destino_categoria_id) } : null,
    nota: s(o.nota), caravana: s(o.caravana), motivo: s(o.motivo), conteoId: s(o.conteo_id) || null, lote: s(o.lote) || null, creado: s(o.creado),
    anulado: o.anulado_fecha ? { fecha: s(o.anulado_fecha), motivo: s(o.anulado_motivo) } : null, corrigeA: s(o.corrige_a) || null,
    antes: o.antes_json ? JSON.parse(s(o.antes_json)) : null,
    extra: o.extra_json ? JSON.parse(s(o.extra_json)) : {},
  }));
  const conteos = objs('Conteos').map((o) => {
    const c = { id: s(o.id), fecha: s(o.fecha), rodeoId: s(o.rodeo_id), categoriaId: s(o.categoria_id), cantidad: n(o.cantidad), origen: s(o.origen), nota: s(o.nota), creado: s(o.creado), anulado: o.anulado_fecha ? { fecha: s(o.anulado_fecha), motivo: s(o.anulado_motivo) } : null };
    if (s(o.diferencia_original) !== '') c.diferenciaOriginal = n(o.diferencia_original);
    if (s(o.calculado_al_contar) !== '') c.calculadoAlContar = n(o.calculado_al_contar);
    return c;
  });
  const bool = (v) => v === true || v === 'true' || v === 1 || v === 'TRUE';
  const rodeos = objs('Rodeos').map((o) => ({ id: s(o.id), nombre: s(o.nombre), ubicacion: s(o.ubicacion), orden: Number(o.orden), activo: bool(o.activo) }));
  const categorias = objs('Categorias').map((o) => ({ id: s(o.id), nombre: s(o.nombre), orden: Number(o.orden), activa: bool(o.activa), cuentaComoVaca: bool(o.cuenta_como_vaca), senasa: s(o.senasa) }));
  const parametros = Object.fromEntries(objs('Parametros').map((o) => [s(o.clave), JSON.parse(s(o.valor_json))]));
  return { app: s(ctrl.app), formato: Number(ctrl.formato), exportado: s(ctrl.exportado),
    cuentas: { movimientos: Number(ctrl.movimientos), conteos: Number(ctrl.conteos), rodeos: Number(ctrl.rodeos), categorias: Number(ctrl.categorias) },
    rodeos, categorias, movimientos, conteos, parametros };
}

async function importar(file) {
  let b;
  try {
    if (/\.xlsx$/i.test(file.name)) b = await excelABackup(file);
    else b = JSON.parse(await file.text());
  } catch (e) {
    await aviso('No se pudo leer el archivo', `<p class="error">${esc(e?.message || e)}</p><p>No se importó nada; tus datos siguen como estaban.</p>`); return;
  }
  let v;
  try { v = L.validarBackup(b); } catch (e) { v = { ok: false, errores: ['El archivo tiene un formato inesperado: ' + (e?.message || e)] }; }
  if (!v.ok) { await aviso('El archivo tiene problemas', `<ul>${v.errores.map((e) => `<li>${esc(e)}</li>`).join('')}</ul><p>No se importó nada; tus datos siguen como estaban.</p>`); return; }
  const tot = L.totales(L.calcularStock(v.estado.movimientos)).total;
  const ok = await confirmar('Importar backup', `<p>El archivo es del ${b.exportado ? fFechaDe(b.exportado) : '?'} y trae ${num(v.estado.movimientos.length)} movimientos y ${num(v.estado.conteos.length)} conteos. Stock total: <b>${num(tot)}</b>.</p>
    <p class="error">Esto reemplaza lo que hay en este teléfono (${num(S.movimientos.length)} movimientos, stock ${num(L.totales(L.calcularStock(S.movimientos)).total)}).</p>`, 'Reemplazar todo');
  if (!ok) return;
  const meta = { ...S.meta, ultimoBackup: b.exportado || S.meta.ultimoBackup || null };
  try {
    await DB.reemplazarTodo(v.estado, { parametros: { ...PARAMETROS_INICIALES, ...v.estado.parametros }, meta });
  } catch (e) {
    await aviso('No se pudo importar', `<p class="error">${esc(e?.message || e)}</p><p>No se importó nada; tus datos siguen como estaban.</p>`); return;
  }
  await cargarEstado();
  toast('Backup importado'); ir('stock');
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
  if (ds.atajo) { const a = atajo(ds.atajo); C = nuevaCarga(); C.tipo = 'cambio_categoria'; C.atajo = a.id; C.catO = a.catO; C.paso = 'rodeo'; render(); return; }
  if (ds.rodeo) {
    if (ds.campo === 'conteo') { CT.rodeo = ds.rodeo; CT.fecha = $('#f-conteo')?.value || CT.fecha; render(); return; }
    if (ds.campo === 'rodeoO') {
      C.rodeoO = ds.rodeo;
      C.paso = C.tipo === 'traslado' ? 'destino' : (C.tipo === 'cambio_categoria' && !C.atajo) ? 'catO' : 'cant';
      render(); return;
    }
    // rodeo destino (traslado: paso propio; cambio de categoría: botones dentro del paso de cantidades)
    leerCantVisibles();
    const enfocado = document.activeElement?.dataset?.cant;
    C.rodeoD = ds.rodeo === C.rodeoO && C.tipo === 'cambio_categoria' ? null : ds.rodeo;
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
  switch (ds.acc) {
    case 'atras': atras(); break;
    case 'guardar': guardarCarga(); break;
    case 'seguir-fecha': S.meta.fechaSesion = S.meta.fechaSesionAnterior; S.meta.fechaSesionDia = hoyIso(); delete S.meta.fechaSesionAnterior; await guardarMeta(); toast('Fecha de carga: ' + fFecha(S.meta.fechaSesion)); render(); break;
    case 'nuevo-conteo': CT = { modo: 'nuevo', fecha: fechaSesion() }; render(); break;
    case 'conteo-cancelar': CT = { modo: 'lista' }; render(); break;
    case 'conteo-atras': CT.rodeo = null; render(); break;
    case 'guardar-conteo': guardarConteo(); break;
    case 'imprimir': prepararImpresion(); window.print(); break;
    case 'descargar-informe': descargarInforme(); break;
    case 'ver-mas': movsVer += 50; render(); break;
    case 'ver-mas-conteos': conteosVer += 50; render(); break;
    case 'ver-mas-anulados': anuladosVer += 50; render(); break;
    case 'ver-mas-abiertas': abiertasVer += 50; render(); break;
    case 'agregar-rodeo': agregar('rodeo'); break;
    case 'agregar-cat': agregar('cat'); break;
    case 'cargar-saldo': cargarSaldo(); break;
    case 'exp-json': exportarJson(); break;
    case 'exp-xlsx': exportarExcel(); break;
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
  if (el.id === 'f-conteo') { CT.fecha = el.value; return; }
  if (el.dataset.cfg) { cambiarCfg(el); return; }
  if (el.dataset.param) { cambiarParam(el); return; }
  if (el.id === 'imp-archivo' && el.files[0]) { const f = el.files[0]; el.value = ''; importar(f); }
});

// Enter en una casilla de cantidad = guardar (ahorra un toque con teclado numérico que tiene "Ir").
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.matches('[data-cant], #c-caravana')) { e.preventDefault(); guardarCarga(); }
  else if (e.target.matches('[data-ccant]')) { e.preventDefault(); guardarConteo(); }
});

// Imprimir desde el menú del navegador (Ctrl+P, Compartir → Imprimir): siempre con los datos de este momento.
window.addEventListener('beforeprint', prepararImpresion);

// ---------- Arranque ----------
async function cargarEstado() {
  const d = await DB.leerTodo();
  const semilla = {};
  if (!d.rodeos.length && !d.categorias.length) { semilla.rodeos = RODEOS_INICIALES; semilla.categorias = CATEGORIAS_INICIALES; }
  if (!d.parametros) semilla.kv = { parametros: PARAMETROS_INICIALES };
  if (Object.keys(semilla).length) await DB.guardar(semilla);
  S.rodeos = d.rodeos.length ? d.rodeos : structuredClone(RODEOS_INICIALES);
  S.categorias = d.categorias.length ? d.categorias : structuredClone(CATEGORIAS_INICIALES);
  S.movimientos = d.movimientos; S.conteos = d.conteos;
  S.parametros = { ...PARAMETROS_INICIALES, ...(d.parametros || {}) };
  S.meta = d.meta || {};
  // D2: si la fecha de carga se fijó otro día, vuelve a hoy (con un botón para seguir con la planilla anterior).
  const hoy = hoyIso();
  if (S.meta.fechaSesion && S.meta.fechaSesionDia !== hoy && S.meta.fechaSesion !== hoy) {
    S.meta.fechaSesionAnterior = S.meta.fechaSesion;
    delete S.meta.fechaSesion;
    S.meta.fechaSesionDia = hoy;
    await guardarMeta();
  }
}

async function iniciar() {
  try {
    await cargarEstado();
  } catch (e) {
    $('#vista').innerHTML = `<h1>No se pudieron abrir los datos</h1><p class="error">${esc(e.message)}</p><p>Puede pasar en modo privado/incógnito. Abrí la app normal.</p>`;
    return;
  }
  render();
  S.persistido = await DB.pedirPersistencia();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
iniciar();

// Para pruebas automáticas (Verificador): acceso de solo lectura al estado.
window.__stock = { S, L, IDX, version: VERSION_APP };
