const CACHE_NAME = 'parthawk-puller-v1';
const PRECACHE_URLS = [
  '/puller',
  '/admin/attack-list.html',
  '/admin/manifest.json',
];

// API routes to cache with network-first strategy
const API_CACHE_PATTERNS = [
  '/attack-list',
  '/part-location/',
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
  const url = new URL(event.request.url);

  // Skip non-GET requests — queue them for background sync
  if (event.request.method !== 'GET') {
    if (event.request.method === 'POST' && url.pathname.startsWith('/part-location/')) {
      event.respondWith(
        fetch(event.request.clone()).catch(() => {
          // Queue for background sync when back online
          return saveForSync(event.request.clone()).then(() =>
            new Response(JSON.stringify({ success: true, queued: true }), {
              headers: { 'Content-Type': 'application/json' }
            })
          );
        })
      );
      return;
    }
    return;
  }

  // API routes: network-first, fall back to cache
  const isApiRoute = API_CACHE_PATTERNS.some(p => url.pathname.startsWith(p));
  if (isApiRoute) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // HTML/static: cache-first, fall back to network
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});

// Background sync support
async function saveForSync(request) {
  // Store in IndexedDB for later sync
  // Simplified: uses a global array since service worker lifecycle is short
  const db = await openSyncDB();
  const tx = db.transaction('pending', 'readwrite');
  tx.objectStore('pending').add({
    url: request.url,
    method: request.method,
    body: await request.text(),
    timestamp: Date.now(),
  });
}

function openSyncDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('parthawk-sync', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('pending', { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// When back online, replay queued requests
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending') {
    event.waitUntil(replayPending());
  }
});

async function replayPending() {
  try {
    const db = await openSyncDB();
    const tx = db.transaction('pending', 'readwrite');
    const store = tx.objectStore('pending');
    const all = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    for (const item of all) {
      try {
        await fetch(item.url, {
          method: item.method,
          headers: { 'Content-Type': 'application/json' },
          body: item.body,
        });
      } catch (e) {
        // Will retry on next sync
        return;
      }
    }

    // Clear all replayed items
    const clearTx = db.transaction('pending', 'readwrite');
    clearTx.objectStore('pending').clear();
  } catch (e) {
    // IndexedDB not available — skip
  }
}
