const CACHE_NAME = 'mp-player-cache-v3';

// Install Event - Skip pre-caching to avoid build asset mismatch issues
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing v3...');
  self.skipWaiting();
});

// Activate Event - Claim clients immediately & clear old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Clearing Old Cache:', cache);
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
    const request = indexedDB.open('MPPlayerDB', 1);
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
        if (getReq.result && getReq.result.audioBlob) {
          resolve(getReq.result.audioBlob);
        } else {
          reject(new Error('Track not found: ' + trackId));
        }
      };
      getReq.onerror = () => reject(getReq.error);
    };
    request.onerror = () => reject(request.error);
  });
}

// Fetch Event
self.addEventListener('fetch', (event) => {
  // 1. Intercept audio streaming API requests
  if (event.request.url.includes('/api/play')) {
    const url = new URL(event.request.url);
    const trackId = url.searchParams.get('id');

    if (!trackId) {
      event.respondWith(new Response('Missing track id', { status: 400 }));
      return;
    }

    event.respondWith(
      getTrackBlobFromDB(trackId)
        .then((blob) => {
          const rangeHeader = event.request.headers.get('Range');
          const contentType = blob.type || 'audio/mp4';

          if (rangeHeader) {
            const parts = rangeHeader.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : blob.size - 1;
            const clampedEnd = Math.min(end, blob.size - 1);
            const chunk = blob.slice(start, clampedEnd + 1);

            return new Response(chunk, {
              status: 206,
              statusText: 'Partial Content',
              headers: {
                'Content-Type': contentType,
                'Content-Range': `bytes ${start}-${clampedEnd}/${blob.size}`,
                'Content-Length': String(clampedEnd - start + 1),
                'Accept-Ranges': 'bytes'
              }
            });
          } else {
            return new Response(blob, {
              status: 200,
              headers: {
                'Content-Type': contentType,
                'Content-Length': String(blob.size),
                'Accept-Ranges': 'bytes'
              }
            });
          }
        })
        .catch((err) => {
          console.error('SW audio stream error:', err);
          return new Response('Track not found: ' + err.message, { status: 404 });
        })
    );
    return;
  }

  // 2. All other requests - network first (no pre-caching needed since Vite handles hashed assets)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
