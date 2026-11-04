// Trabajo pesado de Excel fuera del hilo de la pantalla: armar y comprimir el .xlsx al exportar, y
// descomprimir, leer y convertir el .xlsx al importar. Así la app no se congela con miles de renglones.
// Usa las mismas librerías copiadas dentro de la app (las guarda el service worker: anda sin internet).
self.window = self;
importScripts('vendor/write-excel-file.min.js', 'vendor/read-excel-file.min.js', 'excel-backup.js');

// Celdas: número, sí/no o texto, según el valor.
const celda = (v) => (typeof v === 'number' ? { value: v, type: Number } : typeof v === 'boolean' ? { value: v, type: Boolean } : { value: String(v ?? ''), type: String });

let filas = []; // filas recibidas de a tandas, por número de hoja

self.onmessage = async (e) => {
  const { id, op } = e.data;
  if (op === 'filas') { (filas[e.data.n] ||= []).push(...e.data.filas); return; }
  try {
    if (op === 'nuevo') { filas = []; self.postMessage({ id, ok: true }); return; }
    if (op === 'escribir') {
      const hojas = e.data.hojas.map((h, n) => ({
        sheet: h.sheet,
        data: [h.cols.map((c) => ({ value: c, fontWeight: 'bold' })), ...(filas[n] || []).map((f) => f.map(celda))],
      }));
      filas = [];
      const blob = await self.writeXlsxFile(hojas).toBlob();
      self.postMessage({ id, ok: true, blob });
      return;
    }
    if (op === 'leerBackup') {
      let hojas;
      try { hojas = await self.readXlsxFile(e.data.file); } catch (err) { self.postMessage({ id, ok: false, tipo: 'abrir', error: String(err?.message || err) }); return; }
      let b;
      try { b = self.excelHojasABackup(hojas); } catch (err) { self.postMessage({ id, ok: false, tipo: err.usuario ? 'usuario' : 'formato', error: String(err?.message || err) }); return; }
      self.postMessage({ id, ok: true, json: JSON.stringify(b) });
      return;
    }
    throw new Error('Operación desconocida: ' + op);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
