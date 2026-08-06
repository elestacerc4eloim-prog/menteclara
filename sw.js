// MenteClara — Service Worker
// v4: permite que la app abra SIN INTERNET.
//
// Problema que resuelve: el SDK de Firebase se carga desde gstatic.com. La v3
// excluia todos los dominios externos del cache, asi que sin conexion ese
// <script type="module"> fallaba al importar y NINGUNA linea de ese bloque
// llegaba a ejecutarse — ni siquiera la que restaura la sesion. Resultado:
// la app abria pero se quedaba muerta en la pantalla de login.
//
// Ahora el SDK de Firebase si se cachea (son archivos versionados, no cambian),
// mientras que las LLAMADAS a Firebase y al Worker siguen sin cachearse para
// no servir datos viejos de la comunidad o del chat.

const CACHE_NAME = 'menteclara-v4';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Dominios cuyos archivos SI conviene cachear: son librerias versionadas
// que no cambian nunca para una version dada.
const CDN_CACHEABLE = [
  'www.gstatic.com/firebasejs/'
];

function esCDNCacheable(url) {
  return CDN_CACHEABLE.some(p => url.includes(p));
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // addAll falla entero si un solo archivo falla; los agregamos uno por uno
      // para que un icono faltante no rompa toda la instalacion.
      Promise.all(ASSETS.map(a => cache.add(a).catch(() => {})))
    )
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
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const esPropio = url.origin === self.location.origin;

  // --- SDK de Firebase: cache-first ---
  // Es lo que permite que la app arranque sin internet. Estos archivos llevan
  // el numero de version en la URL, asi que nunca sirven contenido viejo.
  if (!esPropio && esCDNCacheable(req.url)) {
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res && res.ok) {
            const copia = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copia));
          }
          return res;
        });
      })
    );
    return;
  }

  // --- Resto de dominios externos: nunca cachear ---
  // Firestore, el Worker de Cloudflare, APIs. Cachearlos mostraria posts
  // viejos de la comunidad o respuestas de chat repetidas.
  if (!esPropio) return;

  const esNavegacion = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (esNavegacion) {
    // NETWORK-FIRST: siempre busca la version mas reciente; si no hay
    // conexion, sirve la copia guardada para que la app igual abra.
    e.respondWith(
      fetch(req)
        .then(res => {
          const copia = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copia));
          return res;
        })
        .catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // CACHE-FIRST para assets propios (iconos, manifest), actualizando por detras.
  e.respondWith(
    caches.match(req).then(cached => {
      const desdeRed = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copia = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copia));
          }
          return res;
        })
        .catch(() => cached);
      return cached || desdeRed;
    })
  );
});
