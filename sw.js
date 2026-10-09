// Cache public application files only. Personal records live in IndexedDB.
const VERSION = 'stockshub-shell-v2';
const FILES = [
  './',
  './index.html',
  './site-config.json',
  './assets/styles.css',
  './assets/favicon.svg',
  './assets/app.js',
  './assets/api.js',
  './assets/storage.js',
  './assets/market.js',
  './assets/domain.js',
  './assets/ui.js',
  './assets/chart.js',
  './data/market.json',
];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('stockshub-shell-') && key !== VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !FILES.some((file) => new URL(file, self.registration.scope).pathname === url.pathname)
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(VERSION).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((response) => response || Response.error())),
  );
});
