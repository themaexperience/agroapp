// db.js — Persistencia en IndexedDB. Todo se guarda en el dispositivo; no hay servidor.
// Cada escritura espera a que la transacción termine (oncomplete) antes de devolver,
// así cuando la pantalla dice "Guardado" el dato ya está en disco.

const NOMBRE = 'stock-campo-san-jose';
const VERSION = 2;
const STORES = ['rodeos', 'categorias', 'movimientos', 'conteos', 'kv'];
// Copia de lo que había justo antes de la última importación (un solo registro, clave fija).
const RESPALDO = 'respaldo';
const CLAVE_RESPALDO = 'antes_de_importar';

let dbp = null;

function abrir() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'kv' ? 'clave' : 'id' });
      }
      if (!db.objectStoreNames.contains(RESPALDO)) db.createObjectStore(RESPALDO, { keyPath: 'clave' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Si otra pestaña con una versión más nueva necesita actualizar la base, se cierra esta conexión.
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

// Escritura atómica. `trabajo(tx, fallar)` encola las operaciones; puede seguir encolando desde los avisos
// (onsuccess) de IndexedDB, nunca después de un await ajeno a la base (eso cierra la transacción).
// Cualquier error —un put que tira una excepción, un pedido que falla, una excepción en un aviso— aborta
// TODA la transacción y la promesa se rechaza recién cuando el aborto terminó: ahí sí es cierto que no se
// escribió nada. Ese error lleva `abortado = true`. Si la promesa se rechaza sin esa marca, no hay garantía.
function transaccion(db, stores, trabajo) {
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(stores, 'readwrite'); } catch (e) { e.abortado = true; reject(e); return; } // no se abrió: nada cambió
    let error = null;
    const fallar = (e) => {
      if (!error) error = e instanceof Error ? e : new Error(String(e || 'Error al guardar'));
      try { tx.abort(); } catch { /* ya terminó o ya se abortó */ }
    };
    tx.oncomplete = () => {
      if (error) { error.abortado = false; reject(error); } else resolve();
    };
    tx.onabort = () => {
      const e = error || tx.error || new Error('La escritura se canceló');
      e.abortado = true;
      reject(e);
    };
    tx.onerror = (ev) => { if (!error) error = ev?.target?.error || tx.error || new Error('Error al guardar'); };
    try { trabajo(tx, fallar); } catch (e) { fallar(e); }
  });
}

export async function leerTodo() {
  const db = await abrir();
  const tx = db.transaction(STORES, 'readonly');
  const res = {};
  await Promise.all(STORES.map((s) => new Promise((resolve, reject) => {
    const r = tx.objectStore(s).getAll();
    r.onsuccess = () => { res[s] = r.result; resolve(); };
    r.onerror = () => reject(r.error);
  })));
  const kv = Object.fromEntries((res.kv || []).map((x) => [x.clave, x.valor]));
  return {
    rodeos: res.rodeos, categorias: res.categorias, movimientos: res.movimientos, conteos: res.conteos,
    parametros: kv.parametros || null, meta: kv.meta || {},
  };
}

// cambios: { rodeos:[...], categorias:[...], movimientos:[...], conteos:[...], kv:{clave:valor} }
// Se escribe todo en UNA transacción: o entra todo o no entra nada.
export async function guardar(cambios) {
  const db = await abrir();
  await transaccion(db, STORES, (tx) => {
    for (const s of ['rodeos', 'categorias', 'movimientos', 'conteos']) {
      for (const x of cambios[s] || []) tx.objectStore(s).put(x);
    }
    for (const [clave, valor] of Object.entries(cambios.kv || {})) tx.objectStore('kv').put({ clave, valor });
  });
}

// Reemplazo total (importar backup, o deshacer la última importación). Una sola transacción:
// 1) lee lo que hay hoy, 2) lo guarda como respaldo "antes de importar" (si se pide),
// 3) borra y 4) escribe lo nuevo de a tandas, cada tanda desde el aviso de la anterior (la transacción
// sigue activa y la pantalla no se congela con miles de renglones). Si algo falla en cualquier paso,
// se aborta todo: ni el respaldo ni el borrado ni lo nuevo quedan escritos.
// opciones: { respaldar: true, borrarRespaldo: false, tanda: 400 }
export async function reemplazarTodo(estado, kv, opciones = {}) {
  const { respaldar = true, borrarRespaldo = false, tanda = 400 } = opciones;
  const db = await abrir();
  await transaccion(db, [...STORES, RESPALDO], (tx, fallar) => {
    const seguro = (fn) => (...a) => { try { fn(...a); } catch (e) { fallar(e); } };
    const escribir = seguro(() => {
      for (const s of STORES) tx.objectStore(s).clear();
      if (borrarRespaldo) tx.objectStore(RESPALDO).delete(CLAVE_RESPALDO);
      for (const [clave, valor] of Object.entries(kv || {})) tx.objectStore('kv').put({ clave, valor });
      const cola = [];
      for (const s of ['rodeos', 'categorias', 'movimientos', 'conteos']) for (const x of estado[s] || []) cola.push([s, x]);
      let i = 0;
      const seguir = seguro(() => {
        const hasta = Math.min(i + tanda, cola.length);
        let ult = null;
        for (; i < hasta; i++) ult = tx.objectStore(cola[i][0]).put(cola[i][1]);
        if (ult && i < cola.length) ult.onsuccess = seguir;
      });
      seguir();
    });
    if (!respaldar) { escribir(); return; }
    const actual = {};
    let faltan = STORES.length;
    for (const s of STORES) {
      const r = tx.objectStore(s).getAll();
      r.onsuccess = seguro(() => {
        actual[s] = r.result;
        if (--faltan) return;
        const kvAct = Object.fromEntries((actual.kv || []).map((x) => [x.clave, x.valor]));
        const datos = { rodeos: actual.rodeos, categorias: actual.categorias, movimientos: actual.movimientos, conteos: actual.conteos, kv: kvAct };
        const p = tx.objectStore(RESPALDO).put({ clave: CLAVE_RESPALDO, fecha: new Date().toISOString(), datos });
        p.onsuccess = escribir;
      });
    }
  });
}

// Respaldo de antes de la última importación: { fecha, datos:{rodeos,categorias,movimientos,conteos,kv} } o null.
export async function leerRespaldo() {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([RESPALDO], 'readonly');
    const r = tx.objectStore(RESPALDO).get(CLAVE_RESPALDO);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

// Si hay respaldo, sin traerlo entero (puede tener miles de renglones).
export async function hayRespaldo() {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([RESPALDO], 'readonly');
    const r = tx.objectStore(RESPALDO).getKey(CLAVE_RESPALDO);
    r.onsuccess = () => resolve(r.result !== undefined);
    r.onerror = () => reject(r.error);
  });
}

export async function pedirPersistencia() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

export async function estaPersistido() {
  try {
    if (!navigator.storage || !navigator.storage.persisted) return null;
    return await navigator.storage.persisted();
  } catch { return null; }
}
