/* Offline-first cache. Bump CACHE when you ship a change. */
const CACHE = 'burning-sun-v5';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './assets/favicon.svg',
  './styles/tokens.css', './styles/base.css', './styles/layout.css', './styles/components.css',
  './js/config.js', './js/seed.js', './js/ui.js', './js/merge.js', './js/store.js',
  './js/sync.js', './js/engine.js', './js/timer.js', './js/views.js',
  './js/modals.js', './js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Same-origin: cache first, refresh in the background.
   Cross-origin (fonts): network first, fall back to whatever we cached. */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  /* The shared board is live data. Never serve it from cache — a stale
     board is worse than no board. */
  if (url.pathname.startsWith('/.netlify/')) return;

  const sameOrigin = url.origin === location.origin;

  if (sameOrigin) {
    e.respondWith(
      caches.match(e.request).then(hit => {
        const net = fetch(e.request).then(res => {
          if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  } else {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
