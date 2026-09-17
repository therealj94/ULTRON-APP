/* ULTRON FP — SW disabled: stale cache broke Android WebView (#ultron-app-root never mounted). */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => {
      return self.registration.unregister();
    })
  );
});

self.addEventListener('fetch', () => {
  /* passthrough — no caching */
});
