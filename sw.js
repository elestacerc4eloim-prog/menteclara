// MenteClara — Service Worker
// v3: corrige el problema de que la app se quedaba con una versión vieja en caché.
//
// Antes usaba "cache-first" para TODO (caches.match(...) || fetch(...)), así que una vez
// guardado index.html en el dispositivo, nunca se volvía a descargar y las actualizaciones
// subidas a GitHub no llegaban nunca al usuario.
//
// Ahora: "network-first" para el HTML (siempre busca la versión nueva, y usa la caché solo
// si no hay internet) y "cache-first" para los assets estáticos que sí conviene cachear.

const CACHE_NAME = 'menteclara-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // Solo manejamos GET; lo demás va directo a la red.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca cachear llamadas a servicios externos (Firebase, Cloudflare Worker, APIs).
  // Si se cachearan, el usuario vería datos viejos de la comunidad o del chat.
  if (url.origin !== self.location.origin) return;

  const esNavegacion = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (esNavegacion) {
    // NETWORK-FIRST: siempre intenta traer la versión más reciente.
    // Si no hay conexión, cae a la copia guardada para que la app siga abriendo offline.
    e.respondWith(
      fetch(req)
        .then(res => {
          const copia = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copia));
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // CACHE-FIRST para el resto de assets propios (íconos, manifest),
  // pero actualizando la copia en segundo plano.
  e.respondWith(
    caches.match(req).then(cached => {
      const desdeRed = fetch(req)
        .then(res => {
          const copia = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copia));
          return res;
        })
        .catch(() => cached);
      return cached || desdeRed;
    })
  );
});
