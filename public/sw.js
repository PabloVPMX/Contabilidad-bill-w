/* Service worker de la PWA de Grupo Bill W.
   Estrategia network-first: siempre intenta la red (datos/recursos frescos)
   y solo usa la caché como respaldo cuando no hay conexión. Así nunca quedan
   archivos viejos pegados. */
const CACHE = 'billw-v6';
const SHELL = [
  '/',
  '/styles.css?v=6',
  '/app.js?v=6',
  '/logo.webp',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;            // POST/PUT/DELETE van directo a la red
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;  // solo recursos propios
  if (url.pathname.startsWith('/api/')) return; // la API siempre desde la red

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/')))
  );
});
