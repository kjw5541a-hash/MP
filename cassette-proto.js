// cassette-proto.js - 1980s Cyber-Sync Walkman Logic

// --- STATE MANAGEMENT ---
const state = {
  tracks: [],
  currentIndex: -1,
  isPlaying: false,
  isFF: false,
  isREW: false,
  isEjected: false,
  playbackSpeed: 1.0,
  
  // Audio Context elements
  audioCtx: null,
  sourceNode: null,
  analyserNode: null,
  gainNode: null,
  animationFrameId: null
};

// --- DOM ELEMENTS ---
const audio = document.getElementById('audio-player');
const lcdTitle = document.getElementById('lcd-track-title');
const lcdTimeCurrent = document.getElementById('lcd-time-current');
const lcdTimeTotal = document.getElementById('lcd-time-total');
const cassetteTape = document.getElementById('cassette-tape-object');
const labelText = document.getElementById('cassette-label-text');
const reelLeft = document.getElementById('reel-left').querySelector('.reel-gear');
const reelRight = document.getElementById('reel-right').querySelector('.reel-gear');
const woundLeft = document.getElementById('wound-left');
const woundRight = document.getElementById('wound-right');
const peakCanvas = document.getElementById('peak-canvas');
const fileInput = document.getElementById('file-input');
const fileDropzone = document.getElementById('file-dropzone');
const trackListContainer = document.getElementById('proto-track-list');

// LEDs
const ledRec = document.getElementById('led-rec');
const ledPlay = document.getElementById('led-play');
const ledDir = document.getElementById('led-dir');

// Knobs
const switchDolby = document.getElementById('switch-dolby');
const switchTapeType = document.getElementById('switch-tapetype');

// Volume Elements
const volSlider = document.getElementById('vol-slider');
const volThumb = document.getElementById('vol-thumb');

// Controls
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnFF = document.getElementById('btn-ff');
const btnRew = document.getElementById('btn-rew');
const btnEject = document.getElementById('btn-eject');

let rewindInterval = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initPeakCanvas();
  updateVolume(volSlider.value);
});

// --- AUDIO CONTEXT SETUP (LAZY) ---
function initAudioCtx() {
  if (state.audioCtx) return;
  
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  state.audioCtx = new AudioContext();
  
  state.sourceNode = state.audioCtx.createMediaElementSource(audio);
  state.analyserNode = state.audioCtx.createAnalyser();
  state.gainNode = state.audioCtx.createGain();
  
  // Connect graph
  state.sourceNode.connect(state.analyserNode);
  state.analyserNode.connect(state.gainNode);
  state.gainNode.connect(state.audioCtx.destination);
  
  // Set FFT Size for simple retro LED bars (32 bins)
  state.analyserNode.fftSize = 64;
  
  // Start peak analyzer draw loop
  drawPeakMeter();
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // Dropzone events
  fileDropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);
  
  fileDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDropzone.classList.add('hover');
  });
  fileDropzone.addEventListener('dragleave', () => {
    fileDropzone.classList.remove('hover');
  });
  fileDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropzone.classList.remove('hover');
    if (e.dataTransfer.files.length > 0) {
      addFilesToList(e.dataTransfer.files);
    }
  });

  // Media controls
  btnPlay.addEventListener('click', togglePlay);
  btnStop.addEventListener('click', stopPlayback);
  btnFF.addEventListener('click', toggleFF);
  btnRew.addEventListener('click', toggleREW);
  btnEject.addEventListener('click', toggleEject);

  // Volume
  volSlider.addEventListener('input', (e) => {
    updateVolume(e.target.value);
  });

  // Dolby & Tape Switches
  switchDolby.addEventListener('click', () => {
    switchDolby.classList.toggle('active');
  });
  switchTapeType.addEventListener('click', () => {
    switchTapeType.classList.toggle('active');
  });

  // Audio element events
  audio.addEventListener('timeupdate', updatePlaybackProgress);
  audio.addEventListener('loadedmetadata', onAudioLoaded);
  audio.addEventListener('ended', onAudioEnded);
}

// --- AUDIO FILE HANDLERS ---
function handleFileSelect(e) {
  addFilesToList(e.target.files);
}

function addFilesToList(fileList) {
  const files = Array.from(fileList);
  files.forEach(file => {
    // Parse title & artist
    let title = file.name.replace(/\.[^/.]+$/, ""); // strip extension
    let artist = "Unknown Artist";
    
    if (title.includes("-")) {
      const parts = title.split("-");
      artist = parts[0].trim();
      title = parts[1].trim();
    }

    state.tracks.push({
      title: title,
      artist: artist,
      url: URL.createObjectURL(file),
      file: file
    });
  });

  renderTrackList();
  
  // Autoload first track if none loaded
  if (state.currentIndex === -1 && state.tracks.length > 0) {
    loadTrack(0);
  }
}

function renderTrackList() {
  if (state.tracks.length === 0) {
    trackListContainer.innerHTML = '<li class="empty-list-msg">추가된 곡이 없습니다.</li>';
    return;
  }

  trackListContainer.innerHTML = '';
  state.tracks.forEach((track, idx) => {
    const li = document.createElement('li');
    li.className = `proto-track-item ${idx === state.currentIndex ? 'active' : ''}`;
    li.innerHTML = `
      <i class="fa-solid fa-music proto-track-icon"></i>
      <div class="proto-track-info">
        <div class="proto-track-title">${track.title}</div>
        <div class="proto-track-artist">${track.artist}</div>
      </div>
      <span class="proto-track-duration">--:--</span>
    `;
    
    // Attempt to get file duration temporarily
    const tempAudio = new Audio(track.url);
    tempAudio.addEventListener('loadedmetadata', () => {
      const min = Math.floor(tempAudio.duration / 60);
      const sec = Math.floor(tempAudio.duration % 60).toString().padStart(2, '0');
      li.querySelector('.proto-track-duration').textContent = `${min}:${sec}`;
    });

    li.addEventListener('click', () => loadTrack(idx));
    trackListContainer.appendChild(li);
  });
}

// --- TRACK CONTROLLERS ---
function loadTrack(index) {
  if (index < 0 || index >= state.tracks.length) return;
  
  // Stop existing
  stopPlayback();
  
  state.currentIndex = index;
  const track = state.tracks[index];
  
  // Load to audio
  audio.src = track.url;
  audio.load();
  
  // Update HTML elements
  labelText.textContent = track.title;
  lcdTitle.textContent = `${track.title} - ${track.artist}`;
  
  // Highlight active
  document.querySelectorAll('.proto-track-item').forEach((li, idx) => {
    li.classList.toggle('active', idx === index);
  });

  // Tape Eject reset if ejected
  if (state.isEjected) {
    cassetteTape.classList.remove('ejected');
    state.isEjected = false;
    btnEject.classList.remove('pressed');
  }

  // Play automatically
  play();
}

function onAudioLoaded() {
  const min = Math.floor(audio.duration / 60);
  const sec = Math.floor(audio.duration % 60).toString().padStart(2, '0');
  lcdTimeTotal.textContent = `${min}:${sec}`;
  updatePlaybackProgress();
}

function onAudioEnded() {
  // Play next or stop
  if (state.currentIndex + 1 < state.tracks.length) {
    loadTrack(state.currentIndex + 1);
  } else {
    stopPlayback();
  }
}

// --- PLAYBACK INTERACTIONS ---
function play() {
  initAudioCtx();
  if (state.audioCtx && state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }

  audio.play();
  state.isPlaying = true;
  
  // Update buttons
  btnPlay.classList.add('pressed');
  btnPlay.querySelector('i').className = 'fa-solid fa-pause';
  btnStop.classList.remove('pressed');
  
  // Update LEDs
  ledPlay.classList.add('active');
  ledDir.classList.add('active');
  
  // Update Reels rotation
  reelLeft.classList.add('rotating');
  reelRight.classList.add('rotating');
}

function pause() {
  audio.pause();
  state.isPlaying = false;
  
  btnPlay.classList.remove('pressed');
  btnPlay.querySelector('i').className = 'fa-solid fa-play';
  
  ledPlay.classList.remove('active');
  
  reelLeft.classList.remove('rotating');
  reelRight.classList.remove('rotating');
}

function togglePlay() {
  if (state.currentIndex === -1) return;
  
  // If FF or REW are active, stop them first
  if (state.isFF || state.isREW) {
    stopFFREW();
  }

  if (state.isPlaying) {
    pause();
  } else {
    play();
  }
}

function stopPlayback() {
  audio.pause();
  audio.currentTime = 0;
  state.isPlaying = false;
  stopFFREW();

  btnPlay.classList.remove('pressed');
  btnPlay.querySelector('i').className = 'fa-solid fa-play';
  btnStop.classList.add('pressed');
  setTimeout(() => btnStop.classList.remove('pressed'), 200);

  ledPlay.classList.remove('active');
  ledDir.classList.remove('active');
  ledRec.classList.remove('active');

  reelLeft.className = 'reel-gear';
  reelRight.className = 'reel-gear';
  
  updatePlaybackProgress();
}

function toggleEject() {
  stopPlayback();
  
  if (state.isEjected) {
    // Insert back
    cassetteTape.classList.remove('ejected');
    state.isEjected = false;
    btnEject.classList.remove('pressed');
    labelText.textContent = state.currentIndex !== -1 ? state.tracks[state.currentIndex].title : "My Playlist Vol.1";
  } else {
    // Eject
    cassetteTape.classList.add('ejected');
    state.isEjected = true;
    btnEject.classList.add('pressed');
    labelText.textContent = "";
    lcdTitle.textContent = "EJECTED - INSERT TAPE";
  }
}

// --- FAST FORWARD & REWIND IMPLEMENTATION ---
function toggleFF() {
  if (state.currentIndex === -1 || state.isEjected) return;

  if (state.isFF) {
    stopFFREW();
    if (state.isPlaying) play();
  } else {
    stopFFREW();
    state.isFF = true;
    btnFF.classList.add('pressed');
    ledDir.classList.add('active');
    
    // Visuals: fast rotation
    reelLeft.className = 'reel-gear rotating fast';
    reelRight.className = 'reel-gear rotating fast';
    
    // Play audio faster (audio speed-up)
    audio.muted = false; // keep volume but higher pitch for retro tape chirps!
    audio.playbackRate = 4.0;
    if (!state.isPlaying) {
      audio.play();
    }
  }
}

function toggleREW() {
  if (state.currentIndex === -1 || state.isEjected) return;

  if (state.isREW) {
    stopFFREW();
    if (state.isPlaying) play();
  } else {
    stopFFREW();
    state.isREW = true;
    btnRew.classList.add('pressed');
    ledDir.classList.add('active');
    
    // Visuals: fast reverse rotation
    reelLeft.className = 'reel-gear rotating fast reverse';
    reelRight.className = 'reel-gear rotating fast reverse';
    
    // HTML5 doesn't support negative playbackRate, so we must seek backwards in intervals
    audio.pause();
    rewindInterval = setInterval(() => {
      audio.currentTime = Math.max(0, audio.currentTime - 1.2); // skip backward
      updatePlaybackProgress();
      if (audio.currentTime <= 0) {
        stopFFREW();
      }
    }, 100);
  }
}

function stopFFREW() {
  if (rewindInterval) {
    clearInterval(rewindInterval);
    rewindInterval = null;
  }
  
  state.isFF = false;
  state.isREW = false;
  audio.playbackRate = 1.0;
  
  btnFF.classList.remove('pressed');
  btnRew.classList.remove('pressed');
  
  if (!state.isPlaying) {
    audio.pause();
    ledDir.classList.remove('active');
    reelLeft.className = 'reel-gear';
    reelRight.className = 'reel-gear';
  } else {
    reelLeft.className = 'reel-gear rotating';
    reelRight.className = 'reel-gear rotating';
  }
}

// --- VISUAL FEEDBACK: VOLUME & PROGRESS ---
function updateVolume(val) {
  // Move custom thumb visually
  // val is 0 to 100, we map to rail height (bottom offset: 0% to 80%)
  const bottomOffset = (val / 100) * 85;
  volThumb.style.bottom = `${bottomOffset}%`;
  
  // Set audio volume
  audio.volume = val / 100;
  if (state.gainNode) {
    state.gainNode.gain.value = val / 100;
  }
}

function updatePlaybackProgress() {
  if (isNaN(audio.duration) || audio.duration === 0) {
    lcdTimeCurrent.textContent = "00:00";
    return;
  }

  // Update LCD Time
  const curMin = Math.floor(audio.currentTime / 60);
  const curSec = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
  lcdTimeCurrent.textContent = `${curMin}:${curSec}`;

  // SKEUOMORPHIC TAPE PROGRESS (WOUND SIZE CHANGING)
  // Left spindle tape feed to right spindle tape
  // Total radius range: 35px (empty) to 80px (full)
  const progress = audio.currentTime / audio.duration;
  
  const maxRadius = 80;
  const minRadius = 35;
  const radiusDiff = maxRadius - minRadius;

  const currentLeftWound = maxRadius - (progress * radiusDiff);
  const currentRightWound = minRadius + (progress * radiusDiff);

  woundLeft.style.width = `${currentLeftWound}px`;
  woundLeft.style.height = `${currentLeftWound}px`;
  
  woundRight.style.width = `${currentRightWound}px`;
  woundRight.style.height = `${currentRightWound}px`;
}

// --- PEAK LEVEL METER CANVAS DRAWING ---
let peakCtx = null;
let lastPeakTime = 0;
let peakDataL = 0;
let peakDataR = 0;
let decayPeakL = 0;
let decayPeakR = 0;

function initPeakCanvas() {
  peakCtx = peakCanvas.getContext('2d');
  // Handle high-dpi display scaling
  const dpr = window.devicePixelRatio || 1;
  const rect = peakCanvas.getBoundingClientRect();
  peakCanvas.width = rect.width * dpr;
  peakCanvas.height = rect.height * dpr;
  peakCtx.scale(dpr, dpr);
}

function drawPeakMeter() {
  if (!peakCtx) return;
  state.animationFrameId = requestAnimationFrame(drawPeakMeter);
  
  // Fetch raw frequency data
  const dataArray = new Uint8Array(state.analyserNode.frequencyBinCount);
  state.analyserNode.getByteFrequencyData(dataArray);
  
  // Compute left & right simulated signal levels
  // Use lower frequencies for left, mid/high for right
  let sumL = 0;
  let sumR = 0;
  const len = dataArray.length;
  
  for (let i = 0; i < len / 2; i++) {
    sumL += dataArray[i];
  }
  for (let i = len / 2; i < len; i++) {
    sumR += dataArray[i];
  }
  
  const targetL = (sumL / (len / 2)) / 255;
  const targetR = (sumR / (len / 2)) / 255;

  // Smoothing and decay
  const ease = 0.25;
  peakDataL += (targetL - peakDataL) * ease;
  peakDataR += (targetR - peakDataR) * ease;

  // Peak hold decay
  const decayRate = 0.008;
  if (peakDataL > decayPeakL) decayPeakL = peakDataL;
  else decayPeakL = Math.max(0, decayPeakL - decayRate);
  
  if (peakDataR > decayPeakR) decayPeakR = peakDataR;
  else decayPeakR = Math.max(0, decayPeakR - decayRate);

  // Clear Canvas
  const w = peakCanvas.clientWidth;
  const h = peakCanvas.clientHeight;
  peakCtx.clearRect(0, 0, w, h);
  
  // Draw Background slots (simulated dark LED slots)
  const segments = 15;
  const gap = 3;
  const segW = (w - (segments - 1) * gap) / segments;
  const segH = (h - 6) / 2; // 2 rows (Left / Right)

  drawLedBar(0, segW, segH, segments, gap, peakDataL, decayPeakL); // Left row
  drawLedBar(segH + 4, segW, segH, segments, gap, peakDataR, decayPeakR); // Right row
}

function drawLedBar(yOffset, segW, segH, segments, gap, level, peakVal) {
  // If player is not playing, override level to drop to zero
  if (!state.isPlaying && !state.isFF && !state.isREW) {
    level = 0;
    peakVal = 0;
  }

  const greenThreshold = Math.floor(segments * 0.5); // green up to 50%
  const yellowThreshold = Math.floor(segments * 0.8); // yellow up to 80%
  
  const litCount = Math.ceil(level * segments);
  const peakIndex = Math.floor(peakVal * (segments - 1));

  for (let i = 0; i < segments; i++) {
    let color = '#202235'; // dark slot color (default off)
    let isPeak = (i === peakIndex && peakVal > 0.05);
    
    if (i < litCount || isPeak) {
      // Determine colors based on thresholds
      if (i < greenThreshold) {
        color = i < litCount ? '#00fff0' : 'rgba(0, 255, 240, 0.4)'; // Cyber cyan
      } else if (i < yellowThreshold) {
        color = i < litCount ? '#f8e71c' : 'rgba(248, 231, 28, 0.4)'; // Cyber yellow
      } else {
        color = i < litCount ? '#ff007f' : 'rgba(255, 0, 127, 0.4)'; // Cyber pink
      }
    }

    peakCtx.fillStyle = color;
    // Glow effect for active LEDs
    if (i < litCount || isPeak) {
      peakCtx.shadowBlur = 8;
      peakCtx.shadowColor = color;
    } else {
      peakCtx.shadowBlur = 0;
    }

    // Draw rounded rect segment
    drawRoundedRect(peakCtx, i * (segW + gap), yOffset, segW, segH, 2);
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}
