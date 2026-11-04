// sw.js — Hace que la app funcione 100% sin internet.
// Estrategia: cache-first. Al cambiar la versión se baja todo de nuevo y se borra el cache viejo.
const CACHE = 'stock-sanjose-v0.4.0';
const ARCHIVOS = [
  './', 'index.html', 'styles.css', 'app.js', 'ledger.js', 'db.js', 'seeds.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'vendor/write-excel-file.min.js', 'vendor/read-excel-file.min.js', 'excel-worker.js', 'excel-backup.js',
];
self.addEventListener('install', (e) => {
  // cache: 'reload' = pedirlos al servidor sí o sí. Sin esto, el navegador puede llenar el cache nuevo con los
  // archivos viejos que tiene en su propio cache HTTP (GitHub Pages los guarda 10 minutos) y la app queda en la versión anterior.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).catch(() => caches.match('index.html')))
  );
});
