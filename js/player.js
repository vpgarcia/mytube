// Reproductor a pantalla completa.
//
// El iframe de YouTube queda siempre debajo de un "escudo" que bloquea los
// toques, para que el niño no pueda abrir el logo, el título, los videos
// relacionados ni salir hacia youtube.com. Los controles son nuestros y
// manejan el video con la IFrame Player API.
//
// Excepción: iOS no deja empezar un video con sonido sin un toque real
// dentro del iframe. Mientras el video no ha empezado ("waiting"), el escudo
// deja libre solo el centro, donde está el botón grande de play de YouTube.

import { loadPlayerApi, thumbnailUrl } from './youtube.js';

const ERRORS = {
  2: 'El enlace de este video no es válido.',
  5: 'Este video no se puede reproducir en este dispositivo.',
  100: 'Este video ya no existe o es privado.',
  101: 'El autor de este video no permite verlo fuera de YouTube.',
  150: 'El autor de este video no permite verlo fuera de YouTube.',
  153: 'YouTube no ha podido cargar el reproductor.',
};
const LOAD_TIMEOUT_MS = 15000;
const CONTROLS_HIDE_MS = 3000;

const screen = document.getElementById('player');
const frame = document.getElementById('player-frame');
const shield = document.getElementById('shield');
const seek = document.getElementById('seek');
const endScreen = document.getElementById('end-screen');
const endMore = document.getElementById('end-more');
const errorScreen = document.getElementById('error-screen');
const errorText = document.getElementById('error-text');

let player = null;
let current = null;
let context = null;
let progressTimer = null;
let hideTimer = null;
let loadTimer = null;
let seeking = false;

function setMode(mode) {
  screen.dataset.mode = mode;
  endScreen.hidden = mode !== 'ended';
  errorScreen.hidden = mode !== 'error';
  if (mode === 'playing') scheduleHideControls();
  else showControls(false);
}

function showControls(autoHide = true) {
  screen.classList.remove('controls-hidden');
  clearTimeout(hideTimer);
  if (autoHide) scheduleHideControls();
}

function scheduleHideControls() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (screen.dataset.mode === 'playing' && !seeking) screen.classList.add('controls-hidden');
  }, CONTROLS_HIDE_MS);
}

function showError(message) {
  errorText.textContent = message;
  setMode('error');
  destroy();
}

function destroy() {
  clearInterval(progressTimer);
  clearTimeout(loadTimer);
  if (player) {
    try {
      player.destroy();
    } catch {
      // El iframe ya no existe.
    }
  }
  player = null;
  frame.replaceChildren();
}

function updateProgress() {
  if (!player || seeking || typeof player.getDuration !== 'function') return;
  const duration = player.getDuration() || 0;
  if (duration > 0) {
    seek.max = String(duration);
    seek.value = String(player.getCurrentTime() || 0);
    seek.style.setProperty('--progress', `${(seek.value / duration) * 100}%`);
  }
}

function renderMore() {
  const others = context.others(current).sort(() => Math.random() - 0.5).slice(0, 4);
  endMore.replaceChildren(
    ...others.map((video) => {
      const btn = document.createElement('button');
      btn.className = 'more-tile';
      const img = document.createElement('img');
      img.src = thumbnailUrl(video.id);
      img.alt = '';
      const title = document.createElement('span');
      title.textContent = video.title;
      btn.append(img, title);
      btn.addEventListener('click', () => openPlayer(video, context));
      return btn;
    }),
  );
}

export async function openPlayer(video, ctx) {
  context = ctx;
  current = video;
  destroy();
  seek.value = '0';
  seek.style.setProperty('--progress', '0%');
  setMode('loading');

  let YT;
  try {
    YT = await loadPlayerApi();
  } catch {
    showError('No hay conexión con YouTube. Revisa el wifi.');
    return;
  }
  if (current !== video) return;

  const target = document.createElement('div');
  frame.replaceChildren(target);
  loadTimer = setTimeout(() => {
    if (screen.dataset.mode === 'loading') showError('No se pudo cargar el video. Revisa la conexión.');
  }, LOAD_TIMEOUT_MS);

  player = new YT.Player(target, {
    width: '100%',
    height: '100%',
    host: 'https://www.youtube-nocookie.com',
    videoId: video.id,
    playerVars: {
      autoplay: 1,
      playsinline: 1,
      controls: 0,
      rel: 0,
      fs: 0,
      disablekb: 1,
      iv_load_policy: 3,
      cc_load_policy: 0,
      origin: location.origin,
    },
    events: {
      onReady: () => {
        clearTimeout(loadTimer);
        player.playVideo();
        // Si el navegador bloqueó el autoplay, el video sigue sin empezar.
        setTimeout(() => {
          if (screen.dataset.mode === 'loading') setMode('waiting');
        }, 800);
        progressTimer = setInterval(updateProgress, 250);
      },
      onStateChange: (e) => {
        const S = YT.PlayerState;
        if (e.data === S.PLAYING) setMode('playing');
        else if (e.data === S.PAUSED && screen.dataset.mode !== 'waiting') setMode('paused');
        else if (e.data === S.ENDED) {
          renderMore();
          setMode('ended');
        } else if (e.data === S.CUED && screen.dataset.mode === 'loading') setMode('waiting');
      },
      onError: (e) => showError(ERRORS[e.data] || 'Este video no se puede ver ahora.'),
    },
  });
}

export function closePlayer() {
  destroy();
  current = null;
  if (context) context.onClose();
}

function togglePlay() {
  if (!player) return;
  if (screen.dataset.mode === 'playing') player.pauseVideo();
  else player.playVideo();
  showControls();
}

screen.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'close-player') closePlayer();
  else if (action === 'toggle-play') togglePlay();
  else if (action === 'replay' && player) {
    player.seekTo(0, true);
    player.playVideo();
    setMode('playing');
  }
});

shield.addEventListener('click', () => {
  if (screen.classList.contains('controls-hidden')) showControls();
  else if (screen.dataset.mode === 'playing') screen.classList.add('controls-hidden');
});

seek.addEventListener('input', () => {
  seeking = true;
  seek.style.setProperty('--progress', `${(seek.value / seek.max) * 100}%`);
  showControls();
});
seek.addEventListener('change', () => {
  if (player) player.seekTo(Number(seek.value), true);
  seeking = false;
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && player && typeof player.pauseVideo === 'function') player.pauseVideo();
});
