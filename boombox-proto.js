// boombox-proto.js - 1980s Classic Boombox Logic

// --- STATE MANAGEMENT ---
const state = {
  tracks: [],
  currentIndex: -1,
  isPlaying: false,
  isFF: false,
  isREW: false,
  isEjected: false,
  
  // Audio context objects
  audioCtx: null,
  sourceNode: null,
  analyserNode: null,
  gainNode: null,
  animationFrameId: null,

  // Knob rotations
  volumeVal: 80, // 0-100
  balanceVal: 50, // 0-100 (balanced)
  micVal: 20
};

// --- DOM ELEMENTS ---
const audio = document.getElementById('bb-audio');
const lcdCounter = document.getElementById('counter-lcd-display');
const btnResetCounter = document.getElementById('btn-counter-reset');
const hudTrackInfo = document.getElementById('hud-track-info');
const cassetteTape = document.getElementById('cassette-tape-object');
const labelText = document.getElementById('cassette-label-text');
const spindleLeft = document.getElementById('gear-left').querySelector('.spindle-gear-svg');
const spindleRight = document.getElementById('gear-right').querySelector('.spindle-gear-svg');
const woundLeft = document.getElementById('wound-left');
const woundRight = document.getElementById('wound-right');

// Knobs & Sliders
const knobVolume = document.getElementById('knob-volume');
const knobBalance = document.getElementById('knob-balance');
const knobMic = document.getElementById('knob-mic');
const sliderBass = document.getElementById('slider-bass');
const handleBass = document.getElementById('handle-bass');
const sliderTreble = document.getElementById('slider-treble');
const handleTreble = document.getElementById('handle-treble');
const switchFunction = document.getElementById('switch-function');
const functionHandle = document.getElementById('function-handle');

// Level meter dots lists
const dotsLeft = Array.from(document.getElementById('meter-left').querySelectorAll('.led-dot'));
const dotsRight = Array.from(document.getElementById('meter-right').querySelectorAll('.led-dot'));

// File import
const filePortTrigger = document.getElementById('port-upload-trigger');
const fileInput = document.getElementById('boombox-file-input');
const trackListContainer = document.getElementById('bb-track-list');

// Mech Keys
const keyRecord = document.getElementById('key-record');
const keyPlay = document.getElementById('key-play');
const keyRew = document.getElementById('key-rew');
const keyFf = document.getElementById('key-ff');
const keyStopEject = document.getElementById('key-stop-eject');

let rewindInterval = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initKnobRotations();
  updateBassTrebleSliders();
});

// --- AUDIO CONTEXT SETUP (LAZY) ---
function initAudioCtx() {
  if (state.audioCtx) return;
  
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  state.audioCtx = new AudioContext();
  
  state.sourceNode = state.audioCtx.createMediaElementSource(audio);
  state.analyserNode = state.audioCtx.createAnalyser();
  state.gainNode = state.audioCtx.createGain();
  
  // Audio Graph
  state.sourceNode.connect(state.analyserNode);
  state.analyserNode.connect(state.gainNode);
  state.gainNode.connect(state.audioCtx.destination);
  
  state.analyserNode.fftSize = 64;
  
  // Start horizontal LED loop
  drawLedMeters();
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // File Import Trigger
  filePortTrigger.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFiles);

  // Mech keys
  keyPlay.addEventListener('click', togglePlay);
  keyStopEject.addEventListener('click', handleStopEject);
  keyFf.addEventListener('click', toggleFF);
  keyRew.addEventListener('click', toggleREW);
  
  keyRecord.addEventListener('click', () => {
    keyRecord.classList.toggle('pressed');
    setTimeout(() => keyRecord.classList.remove('pressed'), 600);
  });

  // Slider visual mappings
  sliderBass.addEventListener('input', (e) => {
    mapFaderHandle(handleBass, e.target.value);
  });
  sliderTreble.addEventListener('input', (e) => {
    mapFaderHandle(handleTreble, e.target.value);
  });

  // Knobs: drag vertically to rotate
  setupKnobDrag(knobVolume, (deltaY) => {
    state.volumeVal = Math.max(0, Math.min(100, state.volumeVal - deltaY * 0.5));
    rotateKnob(knobVolume, state.volumeVal);
    applyVolume();
  });
  setupKnobDrag(knobBalance, (deltaY) => {
    state.balanceVal = Math.max(0, Math.min(100, state.balanceVal - deltaY * 0.5));
    rotateKnob(knobBalance, state.balanceVal);
  });
  setupKnobDrag(knobMic, (deltaY) => {
    state.micVal = Math.max(0, Math.min(100, state.micVal - deltaY * 0.5));
    rotateKnob(knobMic, state.micVal);
  });

  // Function switch clicking
  switchFunction.addEventListener('click', (e) => {
    // Determine which click zone was touched
    const rect = switchFunction.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / rect.width;
    
    functionHandle.className = 'bb-switch-handle';
    if (ratio < 0.33) {
      functionHandle.classList.add('position-radio');
    } else if (ratio < 0.66) {
      functionHandle.classList.add('position-tape');
    } else {
      functionHandle.classList.add('position-line');
    }
  });

  // Reset counter
  btnResetCounter.addEventListener('click', () => {
    if (!state.isPlaying) {
      lcdCounter.textContent = "00:00";
    }
  });

  // Audio elements
  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('loadedmetadata', onAudioLoaded);
  audio.addEventListener('ended', onAudioEnded);
}

// --- DRAG TO ROTATE KNOB HELPERS ---
function initKnobRotations() {
  rotateKnob(knobVolume, state.volumeVal);
  rotateKnob(knobBalance, state.balanceVal);
  rotateKnob(knobMic, state.micVal);
}

function rotateKnob(el, val) {
  // Value 0-100 maps to -135deg to +135deg rotation
  const deg = -135 + (val / 100) * 270;
  el.style.transform = `rotate(${deg}deg)`;
}

function setupKnobDrag(el, callback) {
  let startY = 0;
  
  const onMouseMove = (e) => {
    const deltaY = e.clientY - startY;
    startY = e.clientY;
    callback(deltaY);
  };
  
  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
  
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // Touch support for iPhone
  const onTouchMove = (e) => {
    const touch = e.touches[0];
    const deltaY = touch.clientY - startY;
    startY = touch.clientY;
    callback(deltaY);
  };

  const onTouchEnd = () => {
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
  };

  el.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    el.addEventListener('touchmove', onTouchMove);
    el.addEventListener('touchend', onTouchEnd);
  });
}

function updateBassTrebleSliders() {
  mapFaderHandle(handleBass, sliderBass.value);
  mapFaderHandle(handleTreble, sliderTreble.value);
}

function mapFaderHandle(handle, val) {
  // value -10 to +10 maps to bottom offset 0% to 80%
  const pct = ((parseFloat(val) + 10) / 20) * 80;
  handle.style.bottom = `${pct}%`;
}

function applyVolume() {
  audio.volume = state.volumeVal / 100;
  if (state.gainNode) {
    state.gainNode.gain.value = state.volumeVal / 100;
  }
}

// --- FILE INPUT HANDLING ---
function handleFiles(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    let title = file.name.replace(/\.[^/.]+$/, "");
    let artist = "Unknown Artist";
    
    if (title.includes("-")) {
      const parts = title.split("-");
      artist = parts[0].trim();
      title = parts[1].trim();
    }

    state.tracks.push({
      title: title,
      artist: artist,
      url: URL.createObjectURL(file)
    });
  });

  renderTracks();

  if (state.currentIndex === -1 && state.tracks.length > 0) {
    loadTrack(0);
  }
}

function renderTracks() {
  if (state.tracks.length === 0) {
    trackListContainer.innerHTML = '<li class="empty-msg">추가된 곡이 없습니다.</li>';
    return;
  }

  trackListContainer.innerHTML = '';
  state.tracks.forEach((t, idx) => {
    const li = document.createElement('li');
    li.className = `bb-track-item ${idx === state.currentIndex ? 'active' : ''}`;
    li.innerHTML = `
      <span class="bb-track-idx">${(idx + 1).toString().padStart(2, '0')}</span>
      <div class="bb-track-details">
        <div class="bb-track-title">${t.title}</div>
        <div class="bb-track-artist">${t.artist}</div>
      </div>
      <span class="bb-track-duration">--:--</span>
    `;

    const tempAudio = new Audio(t.url);
    tempAudio.addEventListener('loadedmetadata', () => {
      const min = Math.floor(tempAudio.duration / 60);
      const sec = Math.floor(tempAudio.duration % 60).toString().padStart(2, '0');
      li.querySelector('.bb-track-duration').textContent = `${min}:${sec}`;
    });

    li.addEventListener('click', () => loadTrack(idx));
    trackListContainer.appendChild(li);
  });
}

// --- LOAD AND PLAYBACK ---
function loadTrack(idx) {
  if (idx < 0 || idx >= state.tracks.length) return;
  
  stopPlayback();
  state.currentIndex = idx;
  const track = state.tracks[idx];
  
  audio.src = track.url;
  audio.load();

  // HTML update
  labelText.textContent = track.title;
  hudTrackInfo.textContent = `${track.title} - ${track.artist}`;

  // Highlight list item
  document.querySelectorAll('.bb-track-item').forEach((li, index) => {
    li.classList.toggle('active', index === idx);
  });

  // Eject reset
  if (state.isEjected) {
    cassetteTape.classList.remove('ejected');
    state.isEjected = false;
  }

  play();
}

function onAudioLoaded() {
  onTimeUpdate();
}

function onAudioEnded() {
  if (state.currentIndex + 1 < state.tracks.length) {
    loadTrack(state.currentIndex + 1);
  } else {
    stopPlayback();
  }
}

function play() {
  initAudioCtx();
  if (state.audioCtx && state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }
  
  audio.play();
  state.isPlaying = true;

  // Buttons update
  keyPlay.classList.add('pressed');
  keyPlay.querySelector('i').className = 'fa-solid fa-pause';
  keyStopEject.classList.remove('pressed');

  // Spindles rotate
  spindleLeft.classList.add('rotating');
  spindleRight.classList.add('rotating');
}

function pause() {
  audio.pause();
  state.isPlaying = false;

  keyPlay.classList.remove('pressed');
  keyPlay.querySelector('i').className = 'fa-solid fa-play';

  spindleLeft.classList.remove('rotating');
  spindleRight.classList.remove('rotating');
}

function togglePlay() {
  if (state.currentIndex === -1) return;

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

  keyPlay.classList.remove('pressed');
  keyPlay.querySelector('i').className = 'fa-solid fa-play';

  spindleLeft.className = 'spindle-gear-svg';
  spindleRight.className = 'spindle-gear-svg';

  onTimeUpdate();
}

function handleStopEject() {
  if (state.isPlaying || state.isFF || state.isREW) {
    // First click stops
    stopPlayback();
    keyStopEject.classList.add('pressed');
    setTimeout(() => keyStopEject.classList.remove('pressed'), 200);
  } else {
    // Eject cassette
    if (state.isEjected) {
      // Load cassette back in
      cassetteTape.classList.remove('ejected');
      state.isEjected = false;
      labelText.textContent = state.currentIndex !== -1 ? state.tracks[state.currentIndex].title : "Summer Hits 89";
      keyStopEject.classList.remove('pressed');
    } else {
      // Eject
      cassetteTape.classList.add('ejected');
      state.isEjected = true;
      labelText.textContent = "";
      hudTrackInfo.textContent = "EJECTED - LOAD MUSIC FILE";
      keyStopEject.classList.add('pressed');
    }
  }
}

// --- FAST FORWARD & REWIND ---
function toggleFF() {
  if (state.currentIndex === -1 || state.isEjected) return;

  if (state.isFF) {
    stopFFREW();
    if (state.isPlaying) play();
  } else {
    stopFFREW();
    state.isFF = true;
    keyFf.classList.add('pressed');
    
    // Spindle fast rotate
    spindleLeft.className = 'spindle-gear-svg rotating fast';
    spindleRight.className = 'spindle-gear-svg rotating fast';
    
    // Play audio at high speed (retro tape chip)
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
    keyRew.classList.add('pressed');
    
    // Spindle fast rotate reverse
    spindleLeft.className = 'spindle-gear-svg rotating fast reverse';
    spindleRight.className = 'spindle-gear-svg rotating fast reverse';
    
    // Seek backward using interval
    audio.pause();
    rewindInterval = setInterval(() => {
      audio.currentTime = Math.max(0, audio.currentTime - 1.5);
      onTimeUpdate();
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
  
  keyFf.classList.remove('pressed');
  keyRew.classList.remove('pressed');

  if (!state.isPlaying) {
    audio.pause();
    spindleLeft.className = 'spindle-gear-svg';
    spindleRight.className = 'spindle-gear-svg';
  } else {
    spindleLeft.className = 'spindle-gear-svg rotating';
    spindleRight.className = 'spindle-gear-svg rotating';
  }
}

// --- TIMEUPDATE & WOUND FEED ANIMATION ---
function onTimeUpdate() {
  if (isNaN(audio.duration) || audio.duration === 0) {
    lcdCounter.textContent = "00:00";
    return;
  }

  // Update LCD digital counter
  const min = Math.floor(audio.currentTime / 60);
  const sec = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
  lcdCounter.textContent = `${min}:${sec}`;

  // Tape roll wound size reduction/addition
  // Left: 76px (max) down to 38px (min)
  // Right: 38px (min) up to 76px (max)
  const progress = audio.currentTime / audio.duration;
  
  const minWound = 38;
  const maxWound = 76;
  const diff = maxWound - minWound;

  const currentLeft = maxWound - (progress * diff);
  const currentRight = minWound + (progress * diff);

  woundLeft.style.width = `${currentLeft}px`;
  woundLeft.style.height = `${currentLeft}px`;

  woundRight.style.width = `${currentRight}px`;
  woundRight.style.height = `${currentRight}px`;
}

// --- DUAL HORIZONTAL LED METERS LINKING ---
function drawLedMeters() {
  state.animationFrameId = requestAnimationFrame(drawLedMeters);
  
  if (!state.isPlaying && !state.isFF && !state.isREW) {
    // Clear all LED classes
    dotsLeft.forEach(dot => dot.classList.remove('active'));
    dotsRight.forEach(dot => dot.classList.remove('active'));
    return;
  }

  const dataArray = new Uint8Array(state.analyserNode.frequencyBinCount);
  state.analyserNode.getByteFrequencyData(dataArray);

  // Compute L & R channel power levels (approximate splitting)
  let sumL = 0;
  let sumR = 0;
  const len = dataArray.length;
  
  for (let i = 0; i < len / 2; i++) {
    sumL += dataArray[i];
  }
  for (let i = len / 2; i < len; i++) {
    sumR += dataArray[i];
  }

  const normL = (sumL / (len / 2)) / 255;
  const normR = (sumR / (len / 2)) / 255;

  // Map to 12 dots
  const litCountL = Math.round(normL * 12);
  const litCountR = Math.round(normR * 12);

  // Set Left channel LEDs active
  dotsLeft.forEach((dot, index) => {
    dot.classList.toggle('active', index < litCountL);
  });
  
  // Set Right channel LEDs active
  dotsRight.forEach((dot, index) => {
    dot.classList.toggle('active', index < litCountR);
  });
}
