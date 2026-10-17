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
//
// El contexto que recibe openPlayer() decide la lista y recibe los eventos:
//   list()                  videos de la vista actual, en orden
//   onClose()               el niño ha vuelto atrás
//   autoplay()              si al terminar se pasa solo al siguiente
//   resumeAt(video)         segundo en el que retomar el video
//   saveResume(video, s)    guarda la posición (null = visto entero)
//   onWatch(seconds)        cada segundo de reproducción
//   onSessionEnd(entry)     resumen al dejar un video (para el historial)
//   onBroken(video)         el video ya no se puede ver

import { loadPlayerApi, thumbnailUrl } from './youtube.js';

const ERRORS = {
  2: 'El enlace de este video no es válido.',
  5: 'Este video no se puede reproducir en este dispositivo.',
  100: 'Este video ya no existe o es privado.',
  101: 'El autor de este video no permite verlo fuera de YouTube.',
  150: 'El autor de este video no permite verlo fuera de YouTube.',
  153: 'YouTube no ha podido cargar el reproductor.',
};
const BROKEN_ERRORS = new Set([2, 100, 101, 150]);
const LOAD_TIMEOUT_MS = 15000;
const CONTROLS_HIDE_MS = 3000;
const AUTOPLAY_COUNTDOWN = 5;
const MIN_SESSION_SECONDS = 5;

const screen = document.getElementById('player');
const frame = document.getElementById('player-frame');
const shield = document.getElementById('shield');
const seek = document.getElementById('seek');
const endScreen = document.getElementById('end-screen');
const endMore = document.getElementById('end-more');
const endCountdown = document.getElementById('end-countdown');
const errorScreen = document.getElementById('error-screen');
const errorText = document.getElementById('error-text');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');

let player = null;
let ready = false;
let current = null;
let context = null;
let progressTimer = null;
let watchTimer = null;
let hideTimer = null;
let loadTimer = null;
let countdownTimer = null;
let seeking = false;
let session = null;

function setMode(mode) {
  screen.dataset.mode = mode;
  endScreen.hidden = mode !== 'ended';
  errorScreen.hidden = mode !== 'error';
  if (mode !== 'ended') stopCountdown();
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

function endSession() {
  if (session && session.seconds >= MIN_SESSION_SECONDS && context) {
    context.onSessionEnd({ videoId: session.video.id, title: session.video.title, at: session.at, seconds: session.seconds });
  }
  session = null;
}

function showError(message) {
  endSession();
  errorText.textContent = message;
  setMode('error');
  destroy();
}

function destroy() {
  clearInterval(progressTimer);
  clearInterval(watchTimer);
  clearTimeout(loadTimer);
  if (player) {
    try {
      player.destroy();
    } catch {
      // El iframe ya no existe.
    }
  }
  player = null;
  ready = false;
  frame.replaceChildren();
}

function currentTime() {
  try {
    return player?.getCurrentTime?.() || 0;
  } catch {
    return 0;
  }
}

function updateProgress() {
  if (!player || seeking || typeof player.getDuration !== 'function') return;
  const duration = player.getDuration() || 0;
  if (duration > 0) {
    seek.max = String(duration);
    seek.value = String(currentTime());
    seek.style.setProperty('--progress', `${(seek.value / duration) * 100}%`);
  }
}

// Cuenta el tiempo de reproducción real (no el tiempo en pausa).
function watchTick() {
  if (screen.dataset.mode !== 'playing' || !current) return;
  if (!session || session.video.id !== current.id) session = { video: current, at: Date.now(), seconds: 0 };
  session.seconds += 1;
  if (session.seconds % 5 === 0) context.saveResume(current, currentTime());
  context.onWatch(1);
}

function neighbour(delta) {
  const list = context.list();
  const i = list.findIndex((v) => v.id === current?.id);
  return i < 0 ? null : list[i + delta] || null;
}

function updateNav() {
  const single = context.list().length < 2;
  prevBtn.hidden = single;
  nextBtn.hidden = single;
  prevBtn.disabled = !neighbour(-1);
  nextBtn.disabled = !neighbour(1);
}

function goTo(delta) {
  const video = neighbour(delta);
  if (video) openPlayer(video, context);
}

function renderMore() {
  const others = context
    .list()
    .filter((v) => v.id !== current?.id)
    .sort(() => Math.random() - 0.5)
    .slice(0, 4);
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

function stopCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  endCountdown.hidden = true;
}

function startCountdown(next) {
  let left = AUTOPLAY_COUNTDOWN;
  const render = () => {
    endCountdown.textContent = `Siguiente video en ${left}…`;
  };
  render();
  endCountdown.hidden = false;
  countdownTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      stopCountdown();
      openPlayer(next, context);
    } else {
      render();
    }
  }, 1000);
}

function onEnded() {
  endSession();
  context.saveResume(current, null);
  renderMore();
  setMode('ended');
  const next = neighbour(1);
  if (next && context.autoplay()) startCountdown(next);
}

export async function openPlayer(video, ctx) {
  endSession();
  context = ctx;
  current = video;
  seek.value = '0';
  seek.style.setProperty('--progress', '0%');
  updateNav();
  const start = Math.floor(context.resumeAt(video) || 0);

  // Con un reproductor ya en marcha cambiamos solo el video: así iOS deja que
  // empiece sin otro toque, porque el niño ya pulsó play en este reproductor.
  if (player && ready && screen.dataset.mode !== 'error') {
    setMode('loading');
    player.loadVideoById({ videoId: video.id, startSeconds: start });
    setTimeout(() => {
      if (current === video && screen.dataset.mode === 'loading') setMode('waiting');
    }, 1500);
    return;
  }

  destroy();
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
      start,
      origin: location.origin,
    },
    events: {
      onReady: () => {
        clearTimeout(loadTimer);
        ready = true;
        player.playVideo();
        // Si el navegador bloqueó el autoplay, el video sigue sin empezar.
        setTimeout(() => {
          if (screen.dataset.mode === 'loading') setMode('waiting');
        }, 800);
        progressTimer = setInterval(updateProgress, 250);
        watchTimer = setInterval(watchTick, 1000);
      },
      onStateChange: (e) => {
        const S = YT.PlayerState;
        if (e.data === S.PLAYING) setMode('playing');
        else if (e.data === S.PAUSED && screen.dataset.mode !== 'waiting') setMode('paused');
        else if (e.data === S.ENDED) onEnded();
        else if (e.data === S.CUED && screen.dataset.mode === 'loading') setMode('waiting');
      },
      onError: (e) => {
        if (BROKEN_ERRORS.has(e.data) && current) context.onBroken(current);
        showError(ERRORS[e.data] || 'Este video no se puede ver ahora.');
      },
    },
  });
}

// Detiene el video sin volver a la lista (p. ej. al acabarse el tiempo).
export function stopPlayer() {
  if (current && screen.dataset.mode !== 'ended') context.saveResume(current, currentTime());
  endSession();
  stopCountdown();
  destroy();
  current = null;
}

export function closePlayer() {
  stopPlayer();
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
  else if (action === 'prev') goTo(-1);
  else if (action === 'next') goTo(1);
  else if (action === 'replay' && player) {
    stopCountdown();
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
  if (document.hidden && player && typeof player.pauseVideo === 'function') {
    player.pauseVideo();
    if (current) context.saveResume(current, currentTime());
    endSession();
  }
});
