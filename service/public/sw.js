const CACHE_NAME = 'darkhawk-v2';
const PRECACHE_URLS = [
  '/admin/pull',
  '/admin/restock',
  '/admin/gate',
  '/admin/vin',
  '/admin/darkhawk-logo.png',
  '/admin/darkhawk-splash.jpg',
  '/admin/attack-list.html',
  '/admin/restock.html',
  '/admin/gate.html',
  '/admin/vin-scanner.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // API routes: network-first
  if (url.pathname.startsWith('/attack-list') || url.pathname.startsWith('/restock/') ||
      url.pathname.startsWith('/vin/') || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static pages + assets: stale-while-revalidate (show cached instantly, update in background)
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      });
      return cached || fetchPromise;
    })
  );
});
