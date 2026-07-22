import * as db from './db.js';
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';

// --- VERSION CONTROL & CACHE BUSTING ---
const APP_VERSION = '5.5'; // Dynamic viewport height, lyrics WebKit scroll fix, neumorphic blue palette release

// --- DYNAMIC VIEWPORT HEIGHT FOR IOS SAFE AREA ---
function updateViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}
window.addEventListener('resize', updateViewportHeight);
window.addEventListener('orientationchange', () => {
  setTimeout(updateViewportHeight, 150);
});
updateViewportHeight();

(async function checkAppVersion() {
  const savedVersion = localStorage.getItem('mp-app-version');
  if (savedVersion !== APP_VERSION) {
    console.log(`New version detected (${APP_VERSION}). Clearing cache...`);
    
    // 1. Unregister all service workers
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      } catch (e) {
        console.error('Service Worker unregistration failed:', e);
      }
    }
    
    // 2. Clear all cache storage
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
        }
      } catch (e) {
        console.error('Cache clearing failed:', e);
      }
    }
    
    // 3. Save new version and force reload
    localStorage.setItem('mp-app-version', APP_VERSION);
    window.location.reload(true);
  }
})();

// --- STATE MANAGEMENT ---
let state = {
  currentTrackList: [],
  currentIndex: -1,
  isPlaying: false,
  isShuffle: false,
  isRepeat: 'none', // 'none' | 'one' | 'all'
  volume: 0.8,
  activeView: 'view-player',
  currentPlaylistId: null,
  activeTrackIdForModal: null,
  audioObjectUrl: null,
  hasLoadedTrack: false
};

// Create Native HTML5 Audio Object
const audio = new Audio();
audio.volume = state.volume;

// --- DOM ELEMENTS ---
const viewElements = document.querySelectorAll('.content-view');
const navItems = document.querySelectorAll('.nav-item');
const folderInput = document.getElementById('folder-import');
const btnThemeToggle = document.getElementById('theme-toggle');
const themeMenu = document.getElementById('theme-menu');
const themeMenuItems = document.querySelectorAll('.theme-menu-item');

// Player UI Elements
const playerArt = document.getElementById('player-art');
const playerTitle = document.getElementById('player-title');
const playerArtist = document.getElementById('player-artist');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const seekSlider = document.getElementById('seek-slider');
const seekProgress = document.getElementById('seek-progress');

// Controls Elements
const btnPlay = document.getElementById('ctrl-play');
const btnPrev = document.getElementById('ctrl-prev');
const btnNext = document.getElementById('ctrl-next');
const btnShuffle = document.getElementById('ctrl-shuffle');
const btnRepeat = document.getElementById('ctrl-repeat');
const btnFavorite = document.getElementById('ctrl-favorite');

// Views Lists Containers
const libraryList = document.getElementById('library-list');
const libraryEmpty = document.getElementById('library-empty');
const playlistsGrid = document.getElementById('playlists-grid');
const playlistsEmpty = document.getElementById('playlists-empty');
const favoritesList = document.getElementById('favorites-list');
const favoritesEmpty = document.getElementById('favorites-empty');
const librarySearch = document.getElementById('library-search');

// Playlist Detail Elements
const playlistDetailSubview = document.getElementById('playlist-detail-subview');
const playlistDetailTitle = document.getElementById('playlist-detail-title');
const playlistDetailList = document.getElementById('playlist-detail-list');
const btnPlaylistBack = document.getElementById('btn-playlist-back');
const btnDeletePlaylistAction = document.getElementById('btn-delete-playlist-action');
const btnCreatePlaylist = document.getElementById('btn-create-playlist');

// Modal Elements
const addToPlaylistModal = document.getElementById('add-to-playlist-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalPlaylistsList = document.getElementById('modal-playlists-list');
const importLoadingModal = document.getElementById('import-loading-modal');
const importLoadingText = document.getElementById('import-loading-text');
const importProgressText = document.getElementById('import-progress-text');

// Settings DOM Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsGeminiKey = document.getElementById('settings-gemini-key');
const settingsShortcutName = document.getElementById('settings-shortcut-name');
const settingsSaveBtn = document.getElementById('settings-save-btn');

const btnGetSimilar = document.getElementById('btn-get-similar');
const similarStatus = document.getElementById('similar-status');
const similarResultsList = document.getElementById('similar-results-list');

// Mini Player Elements
const miniPlayer = document.getElementById('mini-player');
const miniTitle = document.getElementById('mini-title');
const miniArtist = document.getElementById('mini-artist');
const btnMiniPlay = document.getElementById('mini-play');
const btnMiniPrev = document.getElementById('mini-prev');
const btnMiniNext = document.getElementById('mini-next');

// --- PWA SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered:', reg.scope))
      .catch(err => console.log('Service Worker registration failed:', err));
  });
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await db.initDB();
    setupEventListeners();
    setupAudioListeners();
    setupMediaSession();
    
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('mp-theme') || 'neon';
    applyTheme(savedTheme);
    
    // Load initial data
    await renderAllViews();
    
    // Load last playing track state from DB if available
    const tracks = await db.getAllTracks();
    if (tracks.length > 0) {
      loadTrackMetadata(tracks[0]);
      state.currentTrackList = tracks;
      state.currentIndex = 0;
    }
  } catch (error) {
    console.error('Initialization error:', error);
  }
});

// --- AUDIO METADATA & COVER HELPERS ---
function getTrackCoverHTML(track) {
  if (track && track.coverUrl) {
    return `<img src="${track.coverUrl}" alt="Cover" class="track-item-cover">`;
  }
  return `<div class="track-item-icon-placeholder"><i class="fa-solid fa-music"></i></div>`;
}

function readAudioMetadata(file) {
  return new Promise((resolve) => {
    try {
      jsmediatags.read(file, {
        onSuccess: (tag) => {
          const tags = tag.tags || {};
          let coverUrl = null;
          let lyrics = '';
          let title = tags.title ? tags.title.trim() : null;
          let artist = tags.artist ? tags.artist.trim() : null;

          if (tags.picture) {
            try {
              const { data, format } = tags.picture;
              let base64String = '';
              const chunkSize = 8192;
              for (let i = 0; i < data.length; i += chunkSize) {
                const subArray = data.subarray ? data.subarray(i, i + chunkSize) : data.slice(i, i + chunkSize);
                base64String += String.fromCharCode.apply(null, subArray);
              }
              coverUrl = `data:${format || 'image/jpeg'};base64,${window.btoa(base64String)}`;
            } catch (err) {
              console.warn('Cover extraction error:', err);
            }
          }

          if (tags.USLT) {
            if (typeof tags.USLT === 'string') {
              lyrics = tags.USLT;
            } else if (tags.USLT.data) {
              lyrics = typeof tags.USLT.data === 'string' ? tags.USLT.data : (tags.USLT.data.lyrics || '');
            }
          } else if (tags.lyrics) {
            lyrics = typeof tags.lyrics === 'string' ? tags.lyrics : (tags.lyrics.data || '');
          } else if (tags.ULT) {
            lyrics = typeof tags.ULT === 'string' ? tags.ULT : (tags.ULT.data || '');
          }

          resolve({ title, artist, coverUrl, lyrics });
        },
        onError: (error) => {
          console.warn('jsmediatags read error:', error);
          resolve({ title: null, artist: null, coverUrl: null, lyrics: '' });
        }
      });
    } catch (err) {
      console.warn('Metadata parsing failed:', err);
      resolve({ title: null, artist: null, coverUrl: null, lyrics: '' });
    }
  });
}

// --- RENDER VIEWS ---
async function renderAllViews() {
  await Promise.all([
    renderLibrary(),
    renderPlaylists(),
    renderFavorites()
  ]);
}



// 1. Library (All Songs)
async function renderLibrary(searchFilter = '') {
  let tracks = await db.getAllTracks();
  
  // Sort tracks according to localStorage custom order
  const orderStr = localStorage.getItem('mp-track-order');
  if (orderStr) {
    try {
      const orderIds = JSON.parse(orderStr);
      const idToIndex = {};
      orderIds.forEach((id, idx) => {
        idToIndex[id] = idx;
      });
      tracks.sort((a, b) => {
        const idxA = idToIndex[a.id] !== undefined ? idToIndex[a.id] : 999999;
        const idxB = idToIndex[b.id] !== undefined ? idToIndex[b.id] : 999999;
        return idxA - idxB;
      });
    } catch (e) {
      console.error('[Sorting] Error sorting tracks:', e);
    }
  }
  
  libraryList.innerHTML = '';
  
  const searchNormalized = (searchFilter || '').normalize('NFC').toLowerCase();
  const filtered = tracks.filter(t => {
    const title = (t.title || '').normalize('NFC').toLowerCase();
    const artist = (t.artist || '').normalize('NFC').toLowerCase();
    return title.includes(searchNormalized) || artist.includes(searchNormalized);
  });

  if (filtered.length === 0) {
    libraryEmpty.style.display = 'flex';
    return;
  }
  
  libraryEmpty.style.display = 'none';

  filtered.forEach((track, index) => {
    const li = document.createElement('li');
    li.className = `track-item ${state.currentIndex >= 0 && state.currentTrackList[state.currentIndex]?.id === track.id ? 'playing' : ''}`;
    
    li.innerHTML = `
      ${getTrackCoverHTML(track)}
      <div class="track-item-info">
        <div class="track-item-title">${escapeHtml(track.title)}</div>
        <div class="track-item-artist">${escapeHtml(track.artist)}</div>
      </div>
      <div class="track-item-duration">${formatTime(track.duration)}</div>
      <div class="track-item-actions">
        <button class="btn-icon action-fav ${track.isFavorite ? 'active' : ''}" data-id="${track.id}">
          <i class="${track.isFavorite ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
        </button>
        <button class="btn-icon action-add-playlist" data-id="${track.id}">
          <i class="fa-solid fa-list-ul"></i>
        </button>
        <button class="btn-icon action-delete" data-id="${track.id}">
          <i class="fa-regular fa-trash-can"></i>
        </button>
      </div>
    `;

    li.addEventListener('click', (e) => {
      if (e.target.closest('.track-item-actions')) return;
      playTrack(track, filtered, filtered.indexOf(track));
    });

    libraryList.appendChild(li);
  });

  // Attach actions events
  libraryList.querySelectorAll('.action-fav').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const trackId = parseInt(btn.dataset.id);
      const isFav = btn.classList.contains('active');
      await db.toggleFavorite(trackId, !isFav);
      await renderAllViews();
      updatePlayerFavoriteButton();
    });
  });

  libraryList.querySelectorAll('.action-add-playlist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.activeTrackIdForModal = parseInt(btn.dataset.id);
      openAddToPlaylistModal();
    });
  });

  libraryList.querySelectorAll('.action-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('이 곡을 보관함에서 완전히 삭제하시겠습니까?')) {
        const trackId = parseInt(btn.dataset.id);
        await db.deleteTrack(trackId);
        
        // Remove from localStorage track order array
        const orderStr = localStorage.getItem('mp-track-order');
        if (orderStr) {
          try {
            let order = JSON.parse(orderStr);
            order = order.filter(id => id !== trackId);
            localStorage.setItem('mp-track-order', JSON.stringify(order));
          } catch (e) {
            console.error('[Sorting] Error updating track order on delete:', e);
          }
        }
        
        await renderAllViews();
        if (state.currentTrackList[state.currentIndex]?.id === trackId) {
          audio.pause();
          state.isPlaying = false;
          updatePlayButtonUI();
        }
      }
    });
  });
}

// 2. Playlists Grid
async function renderPlaylists() {
  const playlists = await db.getAllPlaylists();
  playlistsGrid.innerHTML = '';

  if (playlists.length === 0) {
    playlistsEmpty.style.display = 'flex';
    return;
  }

  playlistsEmpty.style.display = 'none';

  playlists.forEach(playlist => {
    const card = document.createElement('div');
    card.className = 'playlist-card';
    card.innerHTML = `
      <div class="playlist-card-icon"><i class="fa-solid fa-music"></i></div>
      <div class="playlist-card-info">
        <span class="playlist-card-name">${escapeHtml(playlist.name)}</span>
        <span class="playlist-card-count">${playlist.trackIds.length}곡</span>
      </div>
    `;

    card.addEventListener('click', () => openPlaylistDetail(playlist));
    playlistsGrid.appendChild(card);
  });
}

// 3. Favorites View
async function renderFavorites() {
  const tracks = await db.getAllTracks();
  const favorites = tracks.filter(t => t.isFavorite);
  favoritesList.innerHTML = '';

  if (favorites.length === 0) {
    favoritesEmpty.style.display = 'flex';
    return;
  }

  favoritesEmpty.style.display = 'none';

  favorites.forEach((track, index) => {
    const li = document.createElement('li');
    li.className = `track-item ${state.currentIndex >= 0 && state.currentTrackList[state.currentIndex]?.id === track.id ? 'playing' : ''}`;
    
    li.innerHTML = `
      ${getTrackCoverHTML(track)}
      <div class="track-item-info">
        <div class="track-item-title">${escapeHtml(track.title)}</div>
        <div class="track-item-artist">${escapeHtml(track.artist)}</div>
      </div>
      <div class="track-item-duration">${formatTime(track.duration)}</div>
      <div class="track-item-actions">
        <button class="btn-icon action-add-playlist" data-id="${track.id}" title="재생목록에 추가">
          <i class="fa-solid fa-list-ul"></i>
        </button>
        <button class="btn-icon action-unfav" data-id="${track.id}" title="즐겨찾기 해제">
          <i class="fa-solid fa-heart-crack"></i>
        </button>
      </div>
    `;

    li.addEventListener('click', (e) => {
      if (e.target.closest('.track-item-actions')) return;
      playTrack(track, favorites, favorites.indexOf(track));
    });

    favoritesList.appendChild(li);
  });

  favoritesList.querySelectorAll('.action-add-playlist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.activeTrackIdForModal = parseInt(btn.dataset.id);
      openAddToPlaylistModal();
    });
  });

  favoritesList.querySelectorAll('.action-unfav').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const trackId = parseInt(btn.dataset.id);
      await db.toggleFavorite(trackId, false);
      await renderAllViews();
      updatePlayerFavoriteButton();
    });
  });
}

// Playlist Detail Subview Loader
async function openPlaylistDetail(playlist) {
  state.currentPlaylistId = playlist.id;
  playlistDetailTitle.textContent = playlist.name;
  playlistDetailList.innerHTML = '';
  playlistDetailSubview.classList.add('active');

  const allTracks = await db.getAllTracks();
  const playlistTracks = playlist.trackIds
    .map(id => allTracks.find(t => t.id === id))
    .filter(Boolean);

  if (playlistTracks.length === 0) {
    playlistDetailList.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-compact-disc"></i>
        <p>리스트가 비어 있습니다.<br>보관함 탭에서 곡의 추가 버튼(+)을 눌러 리스트에 추가해 보세요.</p>
      </div>
    `;
    return;
  }

  playlistTracks.forEach((track, index) => {
    const li = document.createElement('li');
    li.className = `track-item ${state.currentIndex >= 0 && state.currentTrackList[state.currentIndex]?.id === track.id ? 'playing' : ''}`;
    
    li.innerHTML = `
      ${getTrackCoverHTML(track)}
      <div class="track-item-info">
        <div class="track-item-title">${escapeHtml(track.title)}</div>
        <div class="track-item-artist">${escapeHtml(track.artist)}</div>
      </div>
      <div class="track-item-duration">${formatTime(track.duration)}</div>
      <div class="track-item-actions">
        <button class="btn-icon action-remove-from-playlist" data-id="${track.id}">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    li.addEventListener('click', (e) => {
      if (e.target.closest('.track-item-actions')) return;
      playTrack(track, playlistTracks, playlistTracks.indexOf(track));
    });

    playlistDetailList.appendChild(li);
  });

  playlistDetailList.querySelectorAll('.action-remove-from-playlist').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const trackId = parseInt(btn.dataset.id);
      await db.removeTrackFromPlaylist(playlist.id, trackId);
      
      const playlists = await db.getAllPlaylists();
      const updatedPlaylist = playlists.find(p => p.id === playlist.id);
      if (updatedPlaylist) {
        openPlaylistDetail(updatedPlaylist);
      }
      renderPlaylists();
    });
  });
}

// --- AUDIO LOGIC & ENGINE ---
function loadTrackMetadata(track) {
  playerTitle.textContent = track.title;
  playerArtist.textContent = track.artist;
  timeTotal.textContent = formatTime(track.duration);
  timeCurrent.textContent = '0:00';
  seekSlider.value = 0;
  seekProgress.style.width = '0%';
  updatePlayerFavoriteButton();

  // Set Album Cover Art or Fallback Theme Icon
  const themeName = localStorage.getItem('mp-theme') || 'neon';
  if (playerArt) {
    if (track.coverUrl) {
      playerArt.src = track.coverUrl;
    } else {
      playerArt.src = `/icon-${themeName}.png`;
    }
  }

  // Set Embedded Lyrics
  const playerLyricsText = document.getElementById('player-lyrics-text');
  if (playerLyricsText) {
    playerLyricsText.textContent = track.lyrics && track.lyrics.trim() ? track.lyrics : '등록된 가사가 없습니다.';
  }

  // Reset 3D flip card to front cover view
  const playerArtFlip = document.getElementById('player-art-flip');
  if (playerArtFlip) {
    playerArtFlip.classList.remove('flipped');
  }

  const similarCurrentTitle = document.getElementById('similar-current-title');
  const similarCurrentArtist = document.getElementById('similar-current-artist');
  if (similarCurrentTitle && similarCurrentArtist) {
    similarCurrentTitle.textContent = track.title;
    similarCurrentArtist.textContent = track.artist;
  }

  // Update Mini Player details
  if (miniTitle && miniArtist) {
    miniTitle.textContent = track.title;
    miniArtist.textContent = track.artist;
  }
  updateMiniPlayerVisibility();
  sendPlaybackStateToNativeWidget(track);
}

function updateMiniPlayerVisibility() {
  if (miniPlayer) {
    const alwaysVisibleViews = ['view-library', 'view-playlists', 'view-favorites'];
    if (alwaysVisibleViews.includes(state.activeView) || (state.hasLoadedTrack && state.activeView !== 'view-player')) {
      miniPlayer.classList.add('active');
    } else {
      miniPlayer.classList.remove('active');
    }
  }
}

function playTrack(track, trackList, index) {
  state.currentTrackList = [...trackList];
  state.currentIndex = index;
  
  loadTrackMetadata(track);
  
  if (state.audioObjectUrl) {
    URL.revokeObjectURL(state.audioObjectUrl);
    state.audioObjectUrl = null;
  }

  state.audioObjectUrl = URL.createObjectURL(track.audioBlob);
  audio.src = state.audioObjectUrl;
  state.hasLoadedTrack = true;
  
  // Update lock screen metadata synchronously to prevent background promise throttling on iOS
  updateMediaSessionMetadata(track);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'playing';
  }
  
  audio.play()
    .then(() => {
      state.isPlaying = true;
      updatePlayButtonUI();
      updateMediaSessionPositionState();
      highlightPlayingItem();
      // Re-apply metadata AFTER successful play to ensure iOS lock screen picks it up
      updateMediaSessionMetadata(track);
    })
    .catch(err => {
      console.error('Audio playback failed:', err);
      state.isPlaying = false;
      updatePlayButtonUI();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
      }
    });
}

// [★핵심 iOS PWA 복원 처리 로직]
async function restoreAudioPlayback() {
  if (state.currentIndex >= 0 && state.currentTrackList[state.currentIndex]) {
    // iOS WebKit 환경에서 락스크린 탈출 및 다이내믹 아일랜드 복귀 시 Blob URL 유실 여부 검증
    if (!audio.src || audio.error || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
      console.log('iOS WebKit Eviction 감지: 끊어진 재생 세션을 복구합니다.');
      
      const currentTrack = state.currentTrackList[state.currentIndex];
      const savedTime = audio.currentTime; // 백그라운드 전환 직전 재생 위치 캐치
      
      if (state.audioObjectUrl) {
        URL.revokeObjectURL(state.audioObjectUrl);
      }
      
      // Blob URL 재생성 후 오디오 엔진 재매핑
      state.audioObjectUrl = URL.createObjectURL(currentTrack.audioBlob);
      audio.src = state.audioObjectUrl;
      audio.currentTime = savedTime;
      
      if (state.isPlaying) {
        try {
          await audio.play();
          highlightPlayingItem();
        } catch (err) {
          console.error('오디오 복구 후 자동 재생 실패:', err);
        }
      }
    }
  }
}

function togglePlay() {
  if (state.currentTrackList.length === 0) return;
  
  if (state.isPlaying) {
    audio.pause();
    state.isPlaying = false;
    updatePlayButtonUI();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  } else {
    if (!state.hasLoadedTrack && state.currentTrackList.length > 0) {
      playTrack(state.currentTrackList[0], state.currentTrackList, 0);
      return;
    }
    audio.play().then(() => {
      state.isPlaying = true;
      updatePlayButtonUI();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    }).catch(err => {
      console.error('togglePlay error:', err);
      state.isPlaying = false;
      updatePlayButtonUI();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
      }
    });
  }
}

function nextTrack() {
  if (state.currentTrackList.length === 0) return;

  let nextIndex = state.currentIndex + 1;

  if (state.isShuffle) {
    nextIndex = Math.floor(Math.random() * state.currentTrackList.length);
  } else if (nextIndex >= state.currentTrackList.length) {
    nextIndex = state.isRepeat === 'all' ? 0 : state.currentTrackList.length - 1;
    if (state.isRepeat !== 'all' && nextIndex === state.currentTrackList.length - 1 && state.currentIndex === nextIndex) {
      audio.pause();
      state.isPlaying = false;
      updatePlayButtonUI();
      return;
    }
  }

  playTrack(state.currentTrackList[nextIndex], state.currentTrackList, nextIndex);
}

function prevTrack() {
  if (state.currentTrackList.length === 0) return;

  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  let prevIndex = state.currentIndex - 1;
  if (state.isShuffle) {
    prevIndex = Math.floor(Math.random() * state.currentTrackList.length);
  } else if (prevIndex < 0) {
    prevIndex = state.isRepeat === 'all' ? state.currentTrackList.length - 1 : 0;
  }

  playTrack(state.currentTrackList[prevIndex], state.currentTrackList, prevIndex);
}

function highlightPlayingItem() {
  const allItems = document.querySelectorAll('.track-item');
  allItems.forEach(item => item.classList.remove('playing'));
  
  if (state.currentIndex < 0) return;
  renderAllViews();
}

function updatePlayerFavoriteButton() {
  if (state.currentIndex < 0) return;
  const currentTrack = state.currentTrackList[state.currentIndex];
  if (!currentTrack) return;
  
  if (currentTrack.isFavorite) {
    btnFavorite.classList.add('active');
    btnFavorite.innerHTML = '<i class="fa-solid fa-heart"></i>';
  } else {
    btnFavorite.classList.remove('active');
    btnFavorite.innerHTML = '<i class="fa-regular fa-heart"></i>';
  }
}

function updatePlayButtonUI() {
  if (state.isPlaying) {
    btnPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';
    if (btnMiniPlay) btnMiniPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';
  } else {
    btnPlay.innerHTML = '<i class="fa-solid fa-play"></i>';
    if (btnMiniPlay) btnMiniPlay.innerHTML = '<i class="fa-solid fa-play"></i>';
  }
  sendPlaybackStateToNativeWidget();
}

// --- FILE IMPORTING MECHANISM ---
async function importFiles(files) {
  const audioExtensions = ['.m4a', '.mp4', '.flac', '.mp3', '.wav', '.ogg', '.mpeg'];
  const audioFiles = files.filter(file => {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    return audioExtensions.includes(ext);
  });

  if (audioFiles.length === 0) {
    alert('가져올 수 있는 지원 대상 음원 파일(M4A, FLAC, MP3, WAV 등)이 없습니다.');
    return;
  }

  const existingTracks = await db.getAllTracks();

  importLoadingModal.classList.add('active');
  importLoadingText.textContent = '음원 가져오는 중...';
  importProgressText.textContent = `0 / ${audioFiles.length} 파일 완료`;

  let processedCount = 0;

  for (const file of audioFiles) {
    try {
      const filenameWithoutExt = (file.name.substring(0, file.name.lastIndexOf('.')) || file.name).normalize('NFC');
      let title = filenameWithoutExt;
      let artist = 'Unknown Artist';

      const delimiterIndex = filenameWithoutExt.indexOf(' - ');
      if (delimiterIndex > -1) {
        title = filenameWithoutExt.substring(0, delimiterIndex).trim();
        artist = filenameWithoutExt.substring(delimiterIndex + 3).trim();
      } else {
        const hyphenIndex = filenameWithoutExt.indexOf('-');
        if (hyphenIndex > -1) {
          title = filenameWithoutExt.substring(0, hyphenIndex).trim();
          artist = filenameWithoutExt.substring(hyphenIndex + 1).trim();
        }
      }

      // Read embedded ID3/MP4 metadata (Title, Artist, Cover Art, Lyrics)
      const meta = await readAudioMetadata(file);
      if (meta.title) title = meta.title;
      if (meta.artist) artist = meta.artist;

      const isDuplicate = existingTracks.some(t => 
        t.title.toLowerCase() === title.toLowerCase() && 
        t.artist.toLowerCase() === artist.toLowerCase()
      );

      if (isDuplicate) {
        processedCount++;
        importProgressText.textContent = `${processedCount} / ${audioFiles.length} 파일 완료`;
        continue;
      }

      const duration = await getAudioDuration(file);

      const newId = await db.addTrack({
        title,
        artist,
        duration,
        audioBlob: file,
        coverUrl: meta.coverUrl,
        lyrics: meta.lyrics
      });
      
      const orderStr = localStorage.getItem('mp-track-order');
      let order = [];
      if (orderStr) {
        try {
          order = JSON.parse(orderStr);
        } catch (e) {
          console.error(e);
        }
      }
      order.push(newId);
      localStorage.setItem('mp-track-order', JSON.stringify(order));
      
    } catch (err) {
      console.error('Error importing file:', file.name, err);
    }
    
    processedCount++;
    importProgressText.textContent = `${processedCount} / ${audioFiles.length} 파일 완료`;
  }

  setTimeout(async () => {
    importLoadingModal.classList.remove('active');
    await renderAllViews();
    
    const tracks = await db.getAllTracks();
    if (tracks.length > 0 && state.currentIndex === -1) {
      loadTrackMetadata(tracks[0]);
      state.currentTrackList = tracks;
    }
  }, 500);
}

async function handleFolderImport(e) {
  const files = Array.from(e.target.files);
  await importFiles(files);
  folderInput.value = '';
}

// --- THEME MANAGEMENT ENGINE ---
function toggleTheme(e) {
  if (e) e.stopPropagation();
  if (themeMenu) themeMenu.classList.toggle('active');
}

function applyTheme(themeName) {
  document.body.classList.remove('theme-glass', 'theme-neumorphic');
  
  if (themeName === 'glass') {
    document.body.classList.add('theme-glass');
  } else if (themeName === 'neumorphic') {
    document.body.classList.add('theme-neumorphic');
  }
  
  const allThemeMenuItems = document.querySelectorAll('.theme-menu-item');
  allThemeMenuItems.forEach(item => {
    item.classList.toggle('active', item.dataset.theme === themeName);
  });
  
  // Update central artwork placeholder
  const playerArt = document.getElementById('player-art');
  if (playerArt) {
    playerArt.src = `/icon-${themeName}.png`;
  }

  // Update dynamic head links for PWA install custom icons
  const touchIcon = document.getElementById('apple-touch-icon');
  const manifestLink = document.getElementById('pwa-manifest');
  if (touchIcon) touchIcon.href = `/icon-${themeName}.png`;
  if (manifestLink) manifestLink.href = `/manifest-${themeName}.json`;
  
  if (btnThemeToggle) {
    updateThemeToggleIcon(themeName);
  }
  localStorage.setItem('mp-theme', themeName);
  if (themeMenu) themeMenu.classList.remove('active');
  
  // Sync the Lock Screen/Dynamic Island background artwork to matching theme icon
  if (state.currentIndex >= 0 && state.currentTrackList.length > 0) {
    const currentTrack = state.currentTrackList[state.currentIndex];
    if (currentTrack) {
      updateMediaSessionMetadata(currentTrack);
    }
  }
}

function updateThemeToggleIcon(themeName) {
  if (!btnThemeToggle) return;
  if (themeName === 'glass') {
    btnThemeToggle.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
  } else if (themeName === 'neumorphic') {
    btnThemeToggle.innerHTML = '<i class="fa-solid fa-circle-half-stroke"></i>';
  } else {
    btnThemeToggle.innerHTML = '<i class="fa-solid fa-bolt"></i>';
  }
}

function getAudioDuration(file) {
  return new Promise((resolve) => {
    const tempAudio = new Audio();
    const objectUrl = URL.createObjectURL(file);
    
    tempAudio.src = objectUrl;
    
    tempAudio.addEventListener('loadedmetadata', () => {
      resolve(tempAudio.duration);
      URL.revokeObjectURL(objectUrl);
    });

    tempAudio.addEventListener('error', () => {
      resolve(0);
      URL.revokeObjectURL(objectUrl);
    });
  });
}

// --- MEDIA SESSION API ---
function setupMediaSession() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => {
      audio.play().then(() => {
        state.isPlaying = true;
        updatePlayButtonUI();
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
        // Ensure lock screen title stays correct after resume
        if (state.currentIndex >= 0 && state.currentTrackList.length > 0) {
          const currentTrack = state.currentTrackList[state.currentIndex];
          if (currentTrack) {
            updateMediaSessionMetadata(currentTrack);
            updateMediaSessionPositionState();
          }
        }
      }).catch(err => {
        console.error('MediaSession play handler error:', err);
        state.isPlaying = false;
        updatePlayButtonUI();
      });
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      audio.pause();
      state.isPlaying = false;
      updatePlayButtonUI();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      prevTrack();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      nextTrack();
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.fastSeek && 'fastSeek' in audio) {
        audio.fastSeek(details.seekTime);
        return;
      }
      audio.currentTime = details.seekTime;
      updateMediaSessionPositionState();
    });

    // Explicitly disable skip buttons to prioritize next/prev track buttons
    navigator.mediaSession.setActionHandler('seekforward', null);
    navigator.mediaSession.setActionHandler('seekbackward', null);
  }
}

function updateMediaSessionMetadata(track) {
  if ('mediaSession' in navigator) {
    const themeName = localStorage.getItem('mp-theme') || 'neon';
    const artworkSrc = `/icon-${themeName}.png`;
    
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: 'MP Local Library',
      artwork: [
        { src: artworkSrc, sizes: '512x512', type: 'image/png' }
      ]
    });

    // Enforce next/prev track buttons and disable skip buttons during live playback transitions
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      prevTrack();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      nextTrack();
    });
    navigator.mediaSession.setActionHandler('seekforward', null);
    navigator.mediaSession.setActionHandler('seekbackward', null);
  }
}

function updateMediaSessionPositionState() {
  if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
    navigator.mediaSession.setPositionState({
      duration: audio.duration || 0,
      playbackRate: audio.playbackRate,
      position: audio.currentTime
    });
  }
}

// --- NATIVE IOS WIDGET BRIDGE ---
function sendPlaybackStateToNativeWidget(track) {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.widgetHandler) {
    const currentTrack = track || state.currentTrackList[state.currentIndex];
    const widgetData = {
      title: currentTrack ? currentTrack.title : '재생 중인 곡 없음',
      artist: currentTrack ? currentTrack.artist : '음악을 선택해 주세요',
      isPlaying: state.isPlaying,
      duration: audio.duration || (currentTrack ? currentTrack.duration : 0),
      currentTime: audio.currentTime || 0
    };
    try {
      window.webkit.messageHandlers.widgetHandler.postMessage(widgetData);
    } catch (e) {
      console.error('Failed to post message to iOS widgetHandler:', e);
    }
  }
}

// Expose widget action trigger globally to be invoked from Swift native side
window.handleWidgetAction = function(action) {
  if (action === 'playpause') {
    if (state.isPlaying) {
      audio.pause();
      state.isPlaying = false;
      updatePlayButtonUI();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    } else {
      if (!state.hasLoadedTrack && state.currentTrackList.length > 0) {
        playTrack(state.currentTrackList[0], state.currentTrackList, 0);
      } else {
        audio.play().then(() => {
          state.isPlaying = true;
          updatePlayButtonUI();
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        }).catch(err => console.error('Widget play action failed:', err));
      }
    }
  } else if (action === 'next') {
    nextTrack();
  } else if (action === 'prev') {
    prevTrack();
  }
};


// --- LISTENERS SETUP ---
function setupAudioListeners() {
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const progressPercent = (audio.currentTime / audio.duration) * 100;
    
    seekSlider.value = progressPercent;
    seekProgress.style.width = `${progressPercent}%`;
    timeCurrent.textContent = formatTime(audio.currentTime);
  });

  audio.addEventListener('ended', () => {
    if (state.isRepeat === 'one') {
      audio.currentTime = 0;
      audio.play().catch(err => console.error(err));
    } else {
      nextTrack();
    }
  });

  audio.addEventListener('loadedmetadata', () => {
    timeTotal.textContent = formatTime(audio.duration);
    updateMediaSessionPositionState();
    
    // Sync metadata again after Safari loads the new Blob URL source
    if (state.currentIndex >= 0 && state.currentTrackList.length > 0) {
      const currentTrack = state.currentTrackList[state.currentIndex];
      if (currentTrack) {
        updateMediaSessionMetadata(currentTrack);
      }
    }
  });

  // Sync play/pause state from external controls (e.g. AirPods, lock screen)
  audio.addEventListener('pause', () => {
    // Only sync if we think we're still playing (external pause)
    if (state.isPlaying) {
      state.isPlaying = false;
      updatePlayButtonUI();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    }
  });
}

function setupEventListeners() {
  if (folderInput) folderInput.addEventListener('change', handleFolderImport);
  if (btnThemeToggle) btnThemeToggle.addEventListener('click', toggleTheme);

  // Theme dropdown item click handlers
  const allThemeMenuItems = document.querySelectorAll('.theme-menu-item');
  allThemeMenuItems.forEach(item => {
    item.addEventListener('click', () => {
      applyTheme(item.dataset.theme);
    });
  });

  // Close theme menu when clicking outside of toggle button and dropdown
  window.addEventListener('click', (e) => {
    if (themeMenu && !e.target.closest('#theme-toggle') && !e.target.closest('#theme-menu')) {
      themeMenu.classList.remove('active');
    }
  });

  // 라이프사이클 복원 핸들러 바인딩 (iOS 백그라운드 생명주기 대응)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      restoreAudioPlayback();
    }
  });

  window.addEventListener('pageshow', () => {
    restoreAudioPlayback();
  });

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetView = item.dataset.view;
      
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      viewElements.forEach(view => {
        if (view.id === targetView) {
          view.classList.add('active');
        } else {
          view.classList.remove('active');
        }
      });

      state.activeView = targetView;
      
      if (targetView !== 'view-playlists') {
        playlistDetailSubview.classList.remove('active');
      }

      updateMiniPlayerVisibility();
    });
  });

  librarySearch.addEventListener('input', (e) => {
    renderLibrary(e.target.value);
  });

  btnPlay.addEventListener('click', togglePlay);
  btnNext.addEventListener('click', nextTrack);
  btnPrev.addEventListener('click', prevTrack);

  // Mini Player Controls
  if (btnMiniPlay) btnMiniPlay.addEventListener('click', togglePlay);
  if (btnMiniPrev) btnMiniPrev.addEventListener('click', prevTrack);
  if (btnMiniNext) btnMiniNext.addEventListener('click', nextTrack);

  seekSlider.addEventListener('input', (e) => {
    if (!audio.duration) return;
    const seekTime = (e.target.value / 100) * audio.duration;
    timeCurrent.textContent = formatTime(seekTime);
    seekProgress.style.width = `${e.target.value}%`;
  });

  seekSlider.addEventListener('change', (e) => {
    if (!audio.duration) return;
    audio.currentTime = (e.target.value / 100) * audio.duration;
    updateMediaSessionPositionState();
  });

  btnShuffle.addEventListener('click', () => {
    state.isShuffle = !state.isShuffle;
    btnShuffle.classList.toggle('active', state.isShuffle);
  });

  btnRepeat.addEventListener('click', () => {
    if (state.isRepeat === 'none') {
      state.isRepeat = 'all';
      btnRepeat.classList.add('active');
      btnRepeat.innerHTML = '<i class="fa-solid fa-repeat"></i>';
    } else if (state.isRepeat === 'all') {
      state.isRepeat = 'one';
      btnRepeat.classList.add('active');
      btnRepeat.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
    } else {
      state.isRepeat = 'none';
      btnRepeat.classList.remove('active');
      btnRepeat.innerHTML = '<i class="fa-solid fa-repeat"></i>';
    }
  });

  // Album Art 3D Flip Card Toggle (Check lyrics existence before flip)
  const playerArtContainer = document.getElementById('player-art-container');
  const playerArtFlip = document.getElementById('player-art-flip');
  const playerLyricsText = document.getElementById('player-lyrics-text');

  if (playerArtContainer && playerArtFlip) {
    playerArtContainer.addEventListener('click', (e) => {
      // If clicking inside lyrics text box while flipped, allow touch scrolling without flipping back
      if (playerArtFlip.classList.contains('flipped') && e.target.closest('#player-lyrics-text')) {
        return;
      }

      // If already flipped to back, clicking anywhere outside lyrics body flips back to cover
      if (playerArtFlip.classList.contains('flipped')) {
        playerArtFlip.classList.remove('flipped');
        return;
      }

      // Front side: Check if current track has lyrics before flipping
      if (state.currentIndex >= 0 && state.currentTrackList[state.currentIndex]) {
        const currentTrack = state.currentTrackList[state.currentIndex];
        if (currentTrack.lyrics && currentTrack.lyrics.trim().length > 0) {
          playerArtFlip.classList.add('flipped');
        } else {
          alert('현재 재생 중인 곡에 등록된 가사가 없습니다.');
        }
      } else {
        alert('재생 중인 곡이 없습니다. 보관함에서 노래를 먼저 재생해 주세요.');
      }
    });
  }

  // Prevent touchmove inside lyrics text box from bubbling up
  if (playerLyricsText) {
    playerLyricsText.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    }, { passive: true });
    playerLyricsText.addEventListener('touchmove', (e) => {
      e.stopPropagation();
    }, { passive: true });
  }

  btnFavorite.addEventListener('click', async () => {
    if (state.currentIndex < 0) return;
    const currentTrack = state.currentTrackList[state.currentIndex];
    if (!currentTrack) return;
    
    const newFavState = !currentTrack.isFavorite;
    currentTrack.isFavorite = newFavState;
    updatePlayerFavoriteButton();
    
    await db.toggleFavorite(currentTrack.id, newFavState);
    await renderAllViews();
  });

  btnPlaylistBack.addEventListener('click', () => {
    playlistDetailSubview.classList.remove('active');
    state.currentPlaylistId = null;
  });

  btnCreatePlaylist.addEventListener('click', async () => {
    const name = prompt('새 플레이리스트의 이름을 입력하세요:');
    if (name && name.trim()) {
      await db.createPlaylist(name.trim());
      await renderPlaylists();
    }
  });

  btnDeletePlaylistAction.addEventListener('click', async () => {
    if (!state.currentPlaylistId) return;
    if (confirm('이 플레이리스트를 삭제하시겠습니까? 플레이리스트 안의 곡들은 보관함에 안전하게 유지됩니다.')) {
      await db.deletePlaylist(state.currentPlaylistId);
      playlistDetailSubview.classList.remove('active');
      state.currentPlaylistId = null;
      await renderPlaylists();
    }
  });

  modalCloseBtn.addEventListener('click', closeAddToPlaylistModal);

  // Floating Settings Menu Controls
  const settingsFloatingMenu = document.getElementById('settings-floating-menu');
  const menuThemeToggle = document.getElementById('menu-theme-toggle');
  const floatingThemeSubmenu = document.getElementById('floating-theme-submenu');
  const menuApiBtn = document.getElementById('menu-api-btn');

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (settingsFloatingMenu) {
      settingsFloatingMenu.classList.toggle('active');
    }
  });

  if (menuThemeToggle && floatingThemeSubmenu) {
    menuThemeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = floatingThemeSubmenu.style.display === 'none';
      floatingThemeSubmenu.style.display = isHidden ? 'flex' : 'none';
    });
  }

  if (menuApiBtn) {
    menuApiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (settingsFloatingMenu) settingsFloatingMenu.classList.remove('active');
      settingsGeminiKey.value = localStorage.getItem('mp-gemini-key') || '';
      settingsShortcutName.value = localStorage.getItem('mp-shortcut-name') || '유튜브 음원 다운로드';
      settingsModal.classList.add('active');
    });
  }

  window.addEventListener('click', (e) => {
    if (e.target === addToPlaylistModal) {
      closeAddToPlaylistModal();
    }
    if (e.target === settingsModal) {
      settingsModal.classList.remove('active');
    }
    if (settingsFloatingMenu && !e.target.closest('#settings-floating-menu') && !e.target.closest('#settings-btn')) {
      settingsFloatingMenu.classList.remove('active');
      if (floatingThemeSubmenu) floatingThemeSubmenu.style.display = 'none';
    }
  });

  settingsCloseBtn.addEventListener('click', () => {
    settingsModal.classList.remove('active');
  });

  settingsSaveBtn.addEventListener('click', () => {
    localStorage.setItem('mp-gemini-key', settingsGeminiKey.value.trim());
    localStorage.setItem('mp-shortcut-name', settingsShortcutName.value.trim() || '유튜브 음원 다운로드');
    settingsModal.classList.remove('active');
    alert('설정이 저장되었습니다.');
  });



  btnGetSimilar.addEventListener('click', () => {
    const title = document.getElementById('similar-current-title').textContent;
    const artist = document.getElementById('similar-current-artist').textContent;
    if (title === '재생 중인 곡 없음' || !title) {
      alert('현재 재생 또는 선택된 노래가 없습니다. 보관함에서 노래를 재생하거나 선택해 주세요.');
      return;
    }
    getSimilarSongs(title, artist);
  });

  // Drag and Drop touch-based library reordering init
  setupLibraryReordering();
}

// --- MODAL UTILS ---
async function openAddToPlaylistModal() {
  const playlists = await db.getAllPlaylists();
  modalPlaylistsList.innerHTML = '';

  if (playlists.length === 0) {
    modalPlaylistsList.innerHTML = `
      <p style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 10px;">
        생성된 플레이리스트가 없습니다.<br>재생목록 탭에서 새 리스트를 만들어 주세요.
      </p>
    `;
  } else {
    playlists.forEach(playlist => {
      const li = document.createElement('li');
      li.className = 'modal-list-item';
      li.textContent = playlist.name;
      
      li.addEventListener('click', async () => {
        await db.addTrackToPlaylist(playlist.id, state.activeTrackIdForModal);
        closeAddToPlaylistModal();
        renderPlaylists();
      });
      
      modalPlaylistsList.appendChild(li);
    });
  }

  addToPlaylistModal.classList.add('active');
}

function closeAddToPlaylistModal() {
  addToPlaylistModal.classList.remove('active');
  state.activeTrackIdForModal = null;
}

// --- TIME FORMATTING & SECURITY UTILS ---
function formatTime(secs) {
  if (isNaN(secs)) return '0:00';
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function escapeHtml(string) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(string).replace(/[&<>"']/g, (m) => map[m]);
}



// --- GEMINI AI RECOMMENDATIONS ---
async function getSimilarSongs(title, artist) {
  const apiKey = (localStorage.getItem('mp-gemini-key') || '').trim();
  if (!apiKey) {
    alert('Gemini API Key가 설정되지 않았습니다.\n\n상단 로고 옆의 [설정(톱니바퀴)] 아이콘을 눌러 구글 AI 스튜디오에서 발급받은 무료 API Key를 먼저 저장해 주세요.');
    return;
  }
  
  similarStatus.style.display = 'block';
  similarStatus.textContent = 'Gemini AI가 유사한 음악을 분석 중...';
  similarResultsList.innerHTML = '';
  
  const prompt = `현재 재생중인 곡: "${title}" by "${artist}". 이 곡과 분위기, 장르, 템포가 비슷한 노래 5곡을 추천해줘. 반드시 아래 JSON 형식으로만 응답해. 다른 텍스트 없이 JSON만 출력해.
{"recommendations": [{"title": "노래 제목", "artist": "아티스트", "reason": "추천 이유 한 줄"}]}`;

  const GEMINI_MODELS = [
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-1.5-flash'
  ];
  
  let success = false;
  let resData = null;
  let lastErrorDetail = '';
  let lastStatus = 0;
  
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      console.log(`[Gemini] Trying model: ${model}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });
      
      if (response.ok) {
        resData = await response.json();
        success = true;
        console.log(`[Gemini] Success with model: ${model}`, resData);
        break;
      } else {
        lastStatus = response.status;
        try {
          const errBody = await response.json();
          lastErrorDetail = errBody.error?.message || JSON.stringify(errBody);
        } catch {
          lastErrorDetail = await response.text();
        }
        console.warn(`[Gemini] Model ${model} failed: [HTTP ${lastStatus}] ${lastErrorDetail}`);
      }
    } catch (e) {
      console.warn(`[Gemini] Fetch error for model ${model}:`, e);
      lastErrorDetail = e.message;
    }
  }
  
  if (!success) {
    similarStatus.innerHTML = `
      <span style="color:var(--danger-color);font-weight:600;">API 호출 실패</span><br>
      <small style="opacity:0.7;word-break:break-all;">[HTTP ${lastStatus}] ${escapeHtml(lastErrorDetail.substring(0, 200))}</small>
    `;
    return;
  }
  
  try {
    if (!resData.candidates || !resData.candidates[0]?.content?.parts?.[0]?.text) {
      console.error('[Gemini] Unexpected response structure:', resData);
      similarStatus.innerHTML = `<span style="color:var(--danger-color);">응답 구조 오류</span><br><small style="opacity:0.7;">${escapeHtml(JSON.stringify(resData).substring(0, 200))}</small>`;
      return;
    }
    
    const responseText = resData.candidates[0].content.parts[0].text;
    const jsonStr = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsedData = JSON.parse(jsonStr);
    const recommendations = parsedData.recommendations || [];
    
    similarStatus.style.display = 'none';
    
    if (recommendations.length === 0) {
      similarResultsList.innerHTML = '<li style="text-align:center; padding:20px; opacity:0.6;">추천 결과가 없습니다.</li>';
      return;
    }
    
    renderSimilarSongs(recommendations);
  } catch (error) {
    console.error('[Gemini] Exception during parsing:', error);
    similarStatus.innerHTML = `<span style="color:var(--danger-color);font-weight:600;">데이터 처리 오류</span><br><small style="opacity:0.7;word-break:break-all;">${escapeHtml(error.message)}</small>`;
  }
}

function renderSimilarSongs(songs) {
  similarResultsList.innerHTML = '';
  
  songs.forEach(song => {
    const li = document.createElement('li');
    li.className = 'track-item glass-card recommend-card';
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.justifyContent = 'space-between';
    li.style.padding = '12px 15px';
    li.style.marginBottom = '10px';
    li.style.borderRadius = '12px';
    
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(song.title + ' ' + song.artist)}`;
    li.innerHTML = `
      <div style="min-width:0; flex:1;">
        <div class="track-title" style="font-weight: 700; font-size: 0.95rem;">${escapeHtml(song.title)}</div>
        <div class="track-artist" style="font-size: 0.8rem; opacity: 0.7; margin-top: 2px;">${escapeHtml(song.artist)}</div>
        <div style="font-size: 0.75rem; opacity: 0.5; margin-top: 4px; line-height:1.3; font-style:italic;">"${escapeHtml(song.reason)}"</div>
      </div>
      <a href="${searchUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-search-recommend" style="border-radius: 8px; padding: 6px 12px; font-size: 0.75rem; display:flex; align-items:center; gap:4px; margin-left: 15px; text-decoration: none;">
        <i class="fa-solid fa-magnifying-glass"></i> 검색
      </a>
    `;
    
    similarResultsList.appendChild(li);
  });
}

// --- LIBRARY TRACK REORDERING (TOUCH DRAG & DROP) ---
function setupLibraryReordering() {
  let isSorting = false;
  let draggedLi = null;
  let longPressTimer = null;
  let startY = 0;
  let currentY = 0;
  
  libraryList.addEventListener('touchstart', (e) => {
    if (state.activeView !== 'view-library') return;
    
    // Find closest track item
    const li = e.target.closest('#library-list > .track-item');
    if (!li) return;
    
    // Skip if clicking action buttons or target is input/button
    if (e.target.closest('.track-item-actions') || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    
    const touch = e.touches[0];
    startY = touch.pageY;
    
    longPressTimer = setTimeout(() => {
      isSorting = true;
      draggedLi = li;
      draggedLi.classList.add('sorting');
      
      // Tactile double click vibration tick (드득)
      if ('vibrate' in navigator) {
        navigator.vibrate([15, 35, 15]);
      }
    }, 450); // 450ms long-press
  }, { passive: false });
  
  libraryList.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    
    if (!isSorting) {
      // Cancel long press if finger moved significantly
      if (longPressTimer && Math.abs(touch.pageY - startY) > 8) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      return;
    }
    
    e.preventDefault(); // Prevent standard browser scroll
    currentY = touch.pageY;
    const deltaY = currentY - startY;
    
    // Move dragging item visually
    draggedLi.style.transform = `translateY(${deltaY}px) scale(1.02)`;
    draggedLi.style.zIndex = '1000';
    
    const items = Array.from(libraryList.querySelectorAll('.track-item'));
    const draggedIndex = items.indexOf(draggedLi);
    
    const prevLi = items[draggedIndex - 1];
    const nextLi = items[draggedIndex + 1];
    
    const clientY = touch.clientY;
    
    // Swap up with immediate neighbor
    if (prevLi) {
      const rect = prevLi.getBoundingClientRect();
      const prevMidY = rect.top + rect.height / 2;
      if (clientY < prevMidY) {
        libraryList.insertBefore(draggedLi, prevLi);
        startY = touch.pageY; // Re-align Y anchor
        draggedLi.style.transform = 'translateY(0) scale(1.02)';
        return;
      }
    }
    
    // Swap down with immediate neighbor
    if (nextLi) {
      const rect = nextLi.getBoundingClientRect();
      const nextMidY = rect.top + rect.height / 2;
      if (clientY > nextMidY) {
        libraryList.insertBefore(draggedLi, nextLi.nextSibling);
        startY = touch.pageY; // Re-align Y anchor
        draggedLi.style.transform = 'translateY(0) scale(1.02)';
        return;
      }
    }
  }, { passive: false });
  
  const endDrag = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    
    if (isSorting) {
      isSorting = false;
      if (draggedLi) {
        draggedLi.classList.remove('sorting');
        draggedLi.style.transform = '';
        draggedLi.style.zIndex = '';
        draggedLi = null;
      }
      saveTrackOrderFromDOM();
    }
  };
  
  libraryList.addEventListener('touchend', endDrag);
  libraryList.addEventListener('touchcancel', endDrag);
}

function saveTrackOrderFromDOM() {
  const items = Array.from(libraryList.querySelectorAll('.track-item'));
  const newOrder = items.map(li => {
    // Read track ID from favorite button dataset
    const favBtn = li.querySelector('.action-fav');
    return favBtn ? parseInt(favBtn.dataset.id) : null;
  }).filter(Boolean);
  
  localStorage.setItem('mp-track-order', JSON.stringify(newOrder));
  console.log('[Sorting] New track order stored:', newOrder);
  
  // Re-index displayed track numbers
  items.forEach((li, idx) => {
    const idxEl = li.querySelector('.track-item-index');
    if (idxEl) {
      idxEl.textContent = idx + 1;
    }
  });
  
  updateCurrentTrackListToNewOrder();
}

async function updateCurrentTrackListToNewOrder() {
  if (state.currentIndex >= 0 && state.currentTrackList.length > 0) {
    const currentTrack = state.currentTrackList[state.currentIndex];
    
    // Only update if current list represents all library tracks
    if (state.activeView === 'view-library') {
      const items = Array.from(libraryList.querySelectorAll('.track-item'));
      const orderedTracks = [];
      
      items.forEach(li => {
        const id = parseInt(li.querySelector('.action-fav').dataset.id);
        const match = state.currentTrackList.find(t => t.id === id);
        if (match) orderedTracks.push(match);
      });
      
      if (orderedTracks.length > 0) {
        state.currentTrackList = orderedTracks;
        state.currentIndex = orderedTracks.findIndex(t => t.id === currentTrack.id);
      }
    }
  }
}
