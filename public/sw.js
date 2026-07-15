const CACHE_NAME = 'mp-player-cache-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching App Shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Clearing Old Cache');
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Helper to retrieve track blob from IndexedDB
function getTrackBlobFromDB(trackId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mp-player-db', 1);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('tracks')) {
        reject(new Error('Tracks store not found'));
        return;
      }
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const getReq = store.get(Number(trackId));
      getReq.onsuccess = () => {
        if (getReq.result) {
          resolve(getReq.result.audioBlob);
        } else {
          reject(new Error('Track not found'));
        }
      };
      getReq.onerror = () => reject(getReq.error);
    };
    request.onerror = () => reject(request.error);
  });
}

// Fetch Event (Cache First with Range Request/IndexedDB Streaming for audio)
self.addEventListener('fetch', (event) => {
  // 1. Intercept media stream requests to solve iOS PWA blob scope matching redirect bugs
  if (event.request.url.includes('/api/play?id=')) {
    const url = new URL(event.request.url);
    const trackId = url.searchParams.get('id');

    event.respondWith(
      getTrackBlobFromDB(trackId)
        .then((blob) => {
          const rangeHeader = event.request.headers.get('Range');
          
          if (rangeHeader) {
            // Parse Range header (e.g., "bytes=0-1000000" or "bytes=0-")
            const parts = rangeHeader.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : blob.size - 1;
            
            // Slice the blob to return only the requested chunk
            const chunk = blob.slice(start, end + 1);
            
            return new Response(chunk, {
              status: 206,
              statusText: 'Partial Content',
              headers: {
                'Content-Type': blob.type || 'audio/m4a',
                'Content-Range': `bytes ${start}-${end}/${blob.size}`,
                'Content-Length': chunk.size.toString(),
                'Accept-Ranges': 'bytes'
              }
            });
          } else {
            // Full media file request
            return new Response(blob, {
              headers: {
                'Content-Type': blob.type || 'audio/m4a',
                'Content-Length': blob.size.toString(),
                'Accept-Ranges': 'bytes'
              }
            });
          }
        })
        .catch((err) => {
          console.error('Service Worker: API media stream failed:', err);
          return new Response('Media not found: ' + err.message, { status: 404 });
        })
    );
    return;
  }

  // 2. Default Cache-first logic for static assets
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        console.log('Service Worker: Fetch failed, offline.');
      });
    })
  );
});
