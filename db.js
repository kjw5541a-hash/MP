// db.js - IndexedDB Manager for MP (Music Player)

const DB_NAME = 'MPPlayerDB';
const DB_VERSION = 1;

let dbInstance = null;

export function initDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Database error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Store for audio tracks
      if (!db.objectStoreNames.contains('tracks')) {
        const trackStore = db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
        trackStore.createIndex('title', 'title', { unique: false });
        trackStore.createIndex('addedAt', 'addedAt', { unique: false });
        trackStore.createIndex('isFavorite', 'isFavorite', { unique: false });
      }

      // Store for custom playlists
      if (!db.objectStoreNames.contains('playlists')) {
        db.createObjectStore('playlists', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

// Track Database Operations
export async function addTrack(track) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');
    
    // Default metadata values
    const newTrack = {
      title: track.title || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
      duration: track.duration || 0,
      audioBlob: track.audioBlob, // Binary audio file (m4a, flac, etc.)
      addedAt: Date.now(),
      isFavorite: false
    };

    const request = store.add(newTrack);
    request.onsuccess = () => resolve(request.result); // Returns the auto-incremented ID
    request.onerror = () => reject(request.error);
  });
}

export async function getAllTracks() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['tracks'], 'readonly');
    const store = transaction.objectStore('tracks');
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteTrack(trackId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['tracks', 'playlists'], 'readwrite');
    
    // 1. Delete the track itself
    const trackStore = transaction.objectStore('tracks');
    trackStore.delete(trackId);
    
    // 2. Remove the track ID from all playlists
    const playlistStore = transaction.objectStore('playlists');
    const getRequest = playlistStore.getAll();
    
    getRequest.onsuccess = () => {
      const playlists = getRequest.result;
      playlists.forEach(playlist => {
        const index = playlist.trackIds.indexOf(trackId);
        if (index > -1) {
          playlist.trackIds.splice(index, 1);
          playlistStore.put(playlist);
        }
      });
      resolve();
    };
    
    getRequest.onerror = () => reject(getRequest.error);
  });
}

export async function toggleFavorite(trackId, isFavorite) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');
    
    const getRequest = store.get(trackId);
    getRequest.onsuccess = () => {
      const track = getRequest.result;
      if (track) {
        track.isFavorite = isFavorite;
        const putRequest = store.put(track);
        putRequest.onsuccess = () => resolve(track);
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        reject(new Error('Track not found'));
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

// Playlist Database Operations
export async function createPlaylist(name) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['playlists'], 'readwrite');
    const store = transaction.objectStore('playlists');
    
    const newPlaylist = {
      name: name,
      trackIds: [],
      createdAt: Date.now()
    };
    
    const request = store.add(newPlaylist);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllPlaylists() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['playlists'], 'readonly');
    const store = transaction.objectStore('playlists');
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addTrackToPlaylist(playlistId, trackId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['playlists'], 'readwrite');
    const store = transaction.objectStore('playlists');
    
    const getRequest = store.get(playlistId);
    getRequest.onsuccess = () => {
      const playlist = getRequest.result;
      if (playlist) {
        if (!playlist.trackIds.includes(trackId)) {
          playlist.trackIds.push(trackId);
          const putRequest = store.put(playlist);
          putRequest.onsuccess = () => resolve(playlist);
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve(playlist); // Already in playlist
        }
      } else {
        reject(new Error('Playlist not found'));
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

export async function removeTrackFromPlaylist(playlistId, trackId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['playlists'], 'readwrite');
    const store = transaction.objectStore('playlists');
    
    const getRequest = store.get(playlistId);
    getRequest.onsuccess = () => {
      const playlist = getRequest.result;
      if (playlist) {
        const index = playlist.trackIds.indexOf(trackId);
        if (index > -1) {
          playlist.trackIds.splice(index, 1);
          const putRequest = store.put(playlist);
          putRequest.onsuccess = () => resolve(playlist);
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve(playlist); // Not in playlist anyway
        }
      } else {
        reject(new Error('Playlist not found'));
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

export async function deletePlaylist(playlistId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['playlists'], 'readwrite');
    const store = transaction.objectStore('playlists');
    const request = store.delete(playlistId);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
