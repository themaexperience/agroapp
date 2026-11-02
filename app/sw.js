// sw.js — Hace que la app funcione 100% sin internet.
// Estrategia: cache-first. Al cambiar la versión se baja todo de nuevo y se borra el cache viejo.
const CACHE = 'stock-sanjose-v0.3.2';
const ARCHIVOS = [
  './', 'index.html', 'styles.css', 'app.js', 'ledger.js', 'db.js', 'seeds.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'vendor/write-excel-file.min.js', 'vendor/read-excel-file.min.js', 'excel-worker.js', 'excel-backup.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
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
