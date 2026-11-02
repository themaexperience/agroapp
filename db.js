// db.js — Persistencia en IndexedDB. Todo se guarda en el dispositivo; no hay servidor.
// Cada escritura espera a que la transacción termine (oncomplete) antes de devolver,
// así cuando la pantalla dice "Guardado" el dato ya está en disco.

const NOMBRE = 'stock-campo-san-jose';
const VERSION = 1;
const STORES = ['rodeos', 'categorias', 'movimientos', 'conteos', 'kv'];

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function terminar(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
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
  const tx = db.transaction(STORES, 'readwrite');
  const fin = terminar(tx);
  for (const s of ['rodeos', 'categorias', 'movimientos', 'conteos']) {
    for (const x of cambios[s] || []) tx.objectStore(s).put(x);
  }
  for (const [clave, valor] of Object.entries(cambios.kv || {})) tx.objectStore('kv').put({ clave, valor });
  await fin;
}

// Reemplazo total (importar backup). Una sola transacción.
export async function reemplazarTodo(estado, kv) {
  const db = await abrir();
  const tx = db.transaction(STORES, 'readwrite');
  const fin = terminar(tx);
  for (const s of STORES) tx.objectStore(s).clear();
  for (const s of ['rodeos', 'categorias', 'movimientos', 'conteos']) {
    for (const x of estado[s] || []) tx.objectStore(s).put(x);
  }
  for (const [clave, valor] of Object.entries(kv || {})) tx.objectStore('kv').put({ clave, valor });
  await fin;
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
