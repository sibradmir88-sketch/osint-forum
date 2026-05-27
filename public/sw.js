/* OSINT Forum — Service Worker */
const CACHE = 'osint-forum-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => {
      // Don't fail if some assets don't match
      return Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch(() => { /* skip */ })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Only handle GET requests
  if (e.request.method !== 'GET') return;

  // API requests: network first, fallback to cache (for offline)
  if (e.request.url.includes('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r || new Response(JSON.stringify({ ok: false, error: 'Нет соединения' }), { headers: { 'Content-Type': 'application/json' } }))
        )
    );
    return;
  }

  // Static assets: cache first, network fallback
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
