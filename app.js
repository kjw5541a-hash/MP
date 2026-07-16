import * as db from './db.js';

// --- VERSION CONTROL & CACHE BUSTING ---
const APP_VERSION = '3.8'; // iOS Lock Screen Sync Patch

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

const youtubeSearchInput = document.getElementById('youtube-search-input');
const youtubeSearchBtn = document.getElementById('youtube-search-btn');
const youtubeSearchStatus = document.getElementById('youtube-search-status');
const youtubeResultsList = document.getElementById('youtube-results-list');

const btnGetSimilar = document.getElementById('btn-get-similar');
const similarStatus = document.getElementById('similar-status');
const similarResultsList = document.getElementById('similar-results-list');

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
    if (savedTheme === 'glass') {
      document.body.classList.add('theme-glass');
      updateThemeToggleIcon(true);
    } else {
      updateThemeToggleIcon(false);
    }
    
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
  const tracks = await db.getAllTracks();
  libraryList.innerHTML = '';
  
  const filtered = tracks.filter(t => 
    t.title.toLowerCase().includes(searchFilter.toLowerCase()) || 
    t.artist.toLowerCase().includes(searchFilter.toLowerCase())
  );

  if (filtered.length === 0) {
    libraryEmpty.style.display = 'flex';
    return;
  }
  
  libraryEmpty.style.display = 'none';

  filtered.forEach((track, index) => {
    const li = document.createElement('li');
    li.className = `track-item ${state.currentIndex >= 0 && state.currentTrackList[state.currentIndex]?.id === track.id ? 'playing' : ''}`;
    
    li.innerHTML = `
      <div class="track-item-index">${index + 1}</div>
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
      <div class="track-item-index">${index + 1}</div>
      <div class="track-item-info">
        <div class="track-item-title">${escapeHtml(track.title)}</div>
        <div class="track-item-artist">${escapeHtml(track.artist)}</div>
      </div>
      <div class="track-item-duration">${formatTime(track.duration)}</div>
      <div class="track-item-actions">
        <button class="btn-icon action-unfav" data-id="${track.id}">
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
      <div class="track-item-index">${index + 1}</div>
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

  const similarCurrentTitle = document.getElementById('similar-current-title');
  const similarCurrentArtist = document.getElementById('similar-current-artist');
  if (similarCurrentTitle && similarCurrentArtist) {
    similarCurrentTitle.textContent = track.title;
    similarCurrentArtist.textContent = track.artist;
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
    if (!audio.src || audio.error || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE || (state.isPlaying && audio.paused)) {
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
  
  db.getAllTracks().then(tracks => {
    const updated = tracks.find(t => t.id === currentTrack.id);
    if (updated && updated.isFavorite) {
      btnFavorite.classList.add('active');
      btnFavorite.innerHTML = '<i class="fa-solid fa-heart"></i>';
    } else {
      btnFavorite.classList.remove('active');
      btnFavorite.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
  });
}

function updatePlayButtonUI() {
  if (state.isPlaying) {
    btnPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';
  } else {
    btnPlay.innerHTML = '<i class="fa-solid fa-play"></i>';
  }
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
      const filenameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
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

      await db.addTrack({
        title,
        artist,
        duration,
        audioBlob: file
      });
      
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
function toggleTheme() {
  const isGlass = document.body.classList.toggle('theme-glass');
  localStorage.setItem('mp-theme', isGlass ? 'glass' : 'neon');
  updateThemeToggleIcon(isGlass);
}

function updateThemeToggleIcon(isGlass) {
  if (isGlass) {
    btnThemeToggle.innerHTML = '<i class="fa-solid fa-bolt"></i>';
  } else {
    btnThemeToggle.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
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
  }
}

function updateMediaSessionMetadata(track) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: 'MP Local Library',
      artwork: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    });
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
  });
}

function setupEventListeners() {
  folderInput.addEventListener('change', handleFolderImport);
  btnThemeToggle.addEventListener('click', toggleTheme);

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
    });
  });

  librarySearch.addEventListener('input', (e) => {
    renderLibrary(e.target.value);
  });

  btnPlay.addEventListener('click', togglePlay);
  btnNext.addEventListener('click', nextTrack);
  btnPrev.addEventListener('click', prevTrack);

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

  btnFavorite.addEventListener('click', async () => {
    if (state.currentIndex < 0) return;
    const currentTrack = state.currentTrackList[state.currentIndex];
    if (!currentTrack) return;
    
    const isFav = btnFavorite.classList.contains('active');
    await db.toggleFavorite(currentTrack.id, !isFav);
    
    currentTrack.isFavorite = !isFav;
    
    await renderAllViews();
    updatePlayerFavoriteButton();
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
  window.addEventListener('click', (e) => {
    if (e.target === addToPlaylistModal) {
      closeAddToPlaylistModal();
    }
    if (e.target === settingsModal) {
      settingsModal.classList.remove('active');
    }
  });

  settingsBtn.addEventListener('click', () => {
    settingsGeminiKey.value = localStorage.getItem('mp-gemini-key') || '';
    settingsShortcutName.value = localStorage.getItem('mp-shortcut-name') || '유튜브 음원 다운로드';
    settingsModal.classList.add('active');
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

  youtubeSearchBtn.addEventListener('click', () => {
    searchYouTubeVideos(youtubeSearchInput.value);
  });

  youtubeSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      searchYouTubeVideos(youtubeSearchInput.value);
    }
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

// --- YOUTUBE SEARCH & DOWNLOAD INTEGRATION ---
const PIPED_INSTANCES = [
  'https://api.piped.yt',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.colby.land',
  'https://pipedapi.tokhmi.xyz',
  'https://piped-api.lunar.icu'
];

async function searchYouTubeVideos(query) {
  if (!query.trim()) return;
  youtubeSearchStatus.style.display = 'block';
  youtubeSearchStatus.textContent = '유튜브에서 검색 중...';
  youtubeResultsList.innerHTML = '';
  
  let success = false;
  let items = [];
  
  for (const instance of PIPED_INSTANCES) {
    try {
      console.log(`Trying search on: ${instance}`);
      const response = await fetch(`${instance}/search?q=${encodeURIComponent(query)}&filter=videos`);
      if (response.ok) {
        const data = await response.json();
        items = data.items || [];
        success = true;
        break;
      }
    } catch (e) {
      console.warn(`Failed to fetch from ${instance}:`, e);
    }
  }
  
  youtubeSearchStatus.style.display = 'none';
  
  if (!success) {
    youtubeResultsList.innerHTML = `
      <li style="text-align:center; padding:30px 20px; opacity:0.8; list-style:none;">
        <div style="font-size: 0.9rem; color: var(--danger-color); margin-bottom: 12px; font-weight:700;">유튜브 검색 서버 연결 실패</div>
        <div style="font-size: 0.8rem; opacity: 0.7; line-height: 1.5; margin-bottom: 16px;">
          일시적으로 모든 검색 대역폭 제한에 도달했습니다.<br>사파리에서 직접 검색 후 유튜브 주소를 복사하거나 아래 버튼을 이용해 주세요.
        </div>
        <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(query)}" target="_blank" class="btn btn-secondary" style="border-radius: 8px; font-size: 0.75rem; text-decoration:none; display:inline-flex; align-items:center; gap:6px; background: rgba(255, 255, 255, 0.08); padding: 8px 16px; border: 1px solid rgba(255, 255, 255, 0.12);">
          <i class="fa-brands fa-youtube" style="color:#ff0000; font-size: 14px;"></i> 유튜브 앱/웹에서 직접 검색하기
        </a>
      </li>
    `;
    return;
  }
  
  if (items.length === 0) {
    youtubeResultsList.innerHTML = '<li style="text-align:center; padding:20px; opacity:0.6; list-style:none;">검색 결과가 없습니다.</li>';
    return;
  }
  
  renderYouTubeSearchResults(items);
}

function renderYouTubeSearchResults(items) {
  youtubeResultsList.innerHTML = '';
  
  items.forEach(item => {
    const videoId = item.videoId || (item.url ? item.url.split('v=')[1] : '');
    if (!videoId) return;
    
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    const li = document.createElement('li');
    li.className = 'track-item glass-card';
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.justifyContent = 'space-between';
    li.style.padding = '10px 15px';
    li.style.marginBottom = '10px';
    li.style.borderRadius = '12px';
    
    li.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
        <img src="${item.thumbnail || 'https://via.placeholder.com/120x90?text=Video'}" alt="Thumbnail" style="width: 60px; height: 45px; border-radius: 6px; object-fit: cover;">
        <div style="min-width:0; flex:1;">
          <div class="track-title" style="font-weight: 600; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.title)}</div>
          <div class="track-artist" style="font-size: 0.75rem; opacity: 0.6; margin-top: 3px;">${escapeHtml(item.uploaderName || 'Unknown Artist')}</div>
        </div>
      </div>
      <button class="btn btn-primary btn-download-track" data-url="${videoUrl}" style="border-radius: 8px; padding: 6px 12px; font-size: 0.75rem; display:flex; align-items:center; gap:4px; margin-left: 10px;">
        <i class="fa-solid fa-cloud-arrow-down"></i> 다운로드
      </button>
    `;
    
    li.querySelector('.btn-download-track').addEventListener('click', (e) => {
      e.stopPropagation();
      const url = e.currentTarget.dataset.url;
      handleDownloadVideo(url);
    });
    
    youtubeResultsList.appendChild(li);
  });
}

async function handleDownloadVideo(videoUrl) {
  try {
    await navigator.clipboard.writeText(videoUrl);
    
    const shortcutName = localStorage.getItem('mp-shortcut-name') || '유튜브 음원 다운로드';
    const shortcutUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}&input=${encodeURIComponent(videoUrl)}`;
    
    alert(`유튜브 주소가 클립보드에 복사되었습니다!\n\n단축어 [${shortcutName}]를 실행하기 위해 단축어 앱으로 이동합니다. 다운로드가 완료되면 보관함의 '파일' 또는 '폴더' 가져오기를 진행해 주세요.`);
    
    window.location.href = shortcutUrl;
  } catch (err) {
    console.error('Download bridge error:', err);
    alert('클립보드 복사 또는 단축어 실행에 실패했습니다.');
  }
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
    
    li.innerHTML = `
      <div style="min-width:0; flex:1;">
        <div class="track-title" style="font-weight: 700; font-size: 0.95rem;">${escapeHtml(song.title)}</div>
        <div class="track-artist" style="font-size: 0.8rem; opacity: 0.7; margin-top: 2px;">${escapeHtml(song.artist)}</div>
        <div style="font-size: 0.75rem; opacity: 0.5; margin-top: 4px; line-height:1.3; font-style:italic;">"${escapeHtml(song.reason)}"</div>
      </div>
      <button class="btn btn-secondary btn-search-recommend" data-query="${song.title} ${song.artist}" style="border-radius: 8px; padding: 6px 12px; font-size: 0.75rem; display:flex; align-items:center; gap:4px; margin-left: 15px;">
        <i class="fa-solid fa-magnifying-glass"></i> 검색
      </button>
    `;
    
    li.querySelector('.btn-search-recommend').addEventListener('click', (e) => {
      const searchQuery = e.currentTarget.dataset.query;
      
      const searchTabButton = document.querySelector('.nav-item[data-view="view-search"]');
      if (searchTabButton) {
        searchTabButton.click();
      }
      
      youtubeSearchInput.value = searchQuery;
      searchYouTubeVideos(searchQuery);
    });
    
    similarResultsList.appendChild(li);
  });
}
