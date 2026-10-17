// Service worker: guarda la app en caché para que abra rápido y funcione
// como app instalada. Los videos y miniaturas siempre vienen de la red.
const CACHE = 'mytube-v8';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/player.js',
  'js/store.js',
  'js/youtube.js',
  'js/model.js',
  'js/ui.js',
  'js/state.js',
  'js/parent.js',
  'js/config.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Red primero para la app (así los cambios llegan enseguida); caché si no hay red.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
