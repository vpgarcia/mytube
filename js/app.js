import { parseVideoId, thumbnailUrl, loadPlayerApi } from './youtube.js';
import { openPlayer, stopPlayer } from './player.js';
import * as store from './store.js';
import * as model from './model.js';
import { state, updateVideos, usageError } from './state.js';
import { openParent, renderParent, grantTime, parentActions } from './parent.js';
import { $, h, show, screen, toast, hideToast, pinPad, adultCheck, chooseNewPin } from './ui.js';

const LONG_PRESS_MS = 1500;
const FLUSH_EVERY_SECONDS = 15;
const RESUME_KEY = 'mytube:resume';
const RESUME_MIN_SECONDS = 10;
const WARN_AT_SECONDS = [300, 60];

// ---------- Perfil activo ----------

function profiles() {
  return model.getProfiles(state.data);
}

function activeProfile() {
  return model.getProfile(state.data, state.profileId);
}

function profileLocked() {
  const device = store.getDevice();
  return Boolean(device.profileLocked && profiles().some((p) => p.id === device.profileId));
}

// Decide el perfil al abrir la app: fijado en el dispositivo, único, o hay que preguntar.
function resolveProfile() {
  const list = profiles();
  const device = store.getDevice();
  if (profileLocked()) return device.profileId;
  if (list.length === 1) return list[0].id;
  if (state.profileId && list.some((p) => p.id === state.profileId)) return state.profileId;
  return null;
}

function setProfile(profileId) {
  state.profileId = profileId;
  state.folderId = null;
  store.updateDevice({ profileId });
  subscribeUsage();
}

// ---------- Uso diario ----------

function subscribeUsage() {
  if (state.usageUnsubscribe) state.usageUnsubscribe();
  state.usageUnsubscribe = null;
  state.usage = {};
  if (!state.profileId) return;
  const profileId = state.profileId;
  state.usageDate = model.todayKey();
  state.usageUnsubscribe = state.store.subscribeUsage(
    profileId,
    state.usageDate,
    (usage) => {
      if (profileId !== state.profileId) return;
      state.usage = usage;
      refreshAccess();
    },
    usageError,
  );
}

function access() {
  return model.accessStatus(activeProfile(), state.usage, state.pendingSeconds);
}

function flushUsage() {
  const seconds = state.pendingSeconds;
  if (!seconds || !state.profileId) return;
  state.pendingSeconds = 0;
  // El listener de Firestore actualizará state.usage; mientras, lo sumamos aquí
  // para que el límite no "devuelva" segundos.
  state.usage = { ...state.usage, seconds: (state.usage.seconds || 0) + seconds };
  state.store.addUsage(state.profileId, state.usageDate, seconds).catch(usageError);
}

let warned = new Set();

function onWatch(seconds) {
  if (model.todayKey() !== state.usageDate) {
    flushUsage();
    warned = new Set();
    subscribeUsage();
  }
  state.pendingSeconds += seconds;
  if (state.pendingSeconds >= FLUSH_EVERY_SECONDS) flushUsage();

  const status = access();
  if (status.blocked) {
    flushUsage();
    stopPlayer();
    showRest(status.blocked);
    return;
  }
  for (const at of WARN_AT_SECONDS) {
    if (status.remaining !== null && status.remaining <= at && !warned.has(at)) {
      warned.add(at);
      toast(at >= 120 ? `Te quedan ${Math.round(at / 60)} minutos de videos` : 'Te queda 1 minuto de videos');
    }
  }
}

// Vuelve a mirar si se puede ver videos (cambia el horario, llega tiempo extra…).
function refreshAccess() {
  const current = screen();
  if (current !== 'home' && current !== 'rest') return;
  const status = access();
  if (status.blocked) showRest(status.blocked);
  else if (current === 'rest') goHome();
  else renderHome();
}

// ---------- Posición de cada video (solo en este dispositivo) ----------

function readResume() {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY)) || {};
  } catch {
    return {};
  }
}

function resumeAt(video) {
  const seconds = readResume()[`${state.profileId}:${video.id}`] || 0;
  return seconds > RESUME_MIN_SECONDS ? seconds - 3 : 0;
}

function saveResume(video, seconds) {
  const all = readResume();
  const key = `${state.profileId}:${video.id}`;
  if (seconds && seconds > RESUME_MIN_SECONDS) all[key] = Math.floor(seconds);
  else delete all[key];
  localStorage.setItem(RESUME_KEY, JSON.stringify(all));
}

// ---------- Pantallas del niño ----------

function goHome() {
  const profileId = resolveProfile();
  if (!profileId) {
    renderProfilePicker();
    show('profiles');
    return;
  }
  if (profileId !== state.profileId) setProfile(profileId);
  const status = access();
  if (status.blocked) {
    showRest(status.blocked);
    return;
  }
  show('home');
  renderHome();
}

function renderProfilePicker() {
  $('profile-grid').replaceChildren(
    ...profiles().map((p) =>
      h(
        'button',
        { class: 'profile-tile', onclick: () => { setProfile(p.id); goHome(); } },
        h('span', { class: 'profile-emoji' }, p.emoji),
        h('span', { class: 'profile-name' }, p.name),
      ),
    ),
  );
}

function showRest(reason) {
  const profile = activeProfile();
  const schedule = reason === 'schedule';
  $('rest-emoji').textContent = schedule ? '⏰' : '🌙';
  $('rest-title').textContent = schedule ? 'Ahora no es hora de videos' : '¡Hasta mañana!';
  $('rest-text').textContent = schedule
    ? `Los videos se pueden ver de ${profile.schedule.from} a ${profile.schedule.to}.`
    : 'Por hoy ya has visto todo tu tiempo de videos. ¡Mañana más!';
  $('rest-switch').hidden = profiles().length < 2 || profileLocked();
  if (screen() !== 'rest') hideToast();
  show('rest');
}

// Vista actual: carpetas y videos sueltos en la raíz, o el contenido de una carpeta.
function currentView() {
  const videos = model.visibleVideos(state.data, state.profileId);
  const folders = model.getFolders(state.data);
  const folderIds = new Set(folders.map((f) => f.id));
  if (state.folderId && folderIds.has(state.folderId)) {
    return { folder: folders.find((f) => f.id === state.folderId), folders: [], videos: videos.filter((v) => v.folderId === state.folderId) };
  }
  state.folderId = null;
  const used = folders.filter((f) => videos.some((v) => v.folderId === f.id));
  return { folder: null, folders: used, videos: videos.filter((v) => !folderIds.has(v.folderId)) };
}

function renderHome() {
  const profile = activeProfile();
  const view = currentView();
  const multi = profiles().length > 1;

  $('home-back').hidden = !view.folder;
  const avatar = $('avatar-btn');
  avatar.hidden = view.folder || !multi;
  avatar.textContent = profile.emoji;
  avatar.disabled = profileLocked();
  $('home-title').textContent = view.folder ? `${view.folder.emoji} ${view.folder.name}` : multi ? profile.name : profile.name === model.DEFAULT_PROFILE.name ? 'Mis videos' : profile.name;

  const status = access();
  const timeLeft = $('time-left');
  timeLeft.hidden = status.remaining === null;
  if (status.remaining !== null) timeLeft.textContent = `⏳ ${model.formatMinutes(status.remaining)}`;

  $('empty').hidden = view.folders.length + view.videos.length > 0;
  $('grid').replaceChildren(
    ...view.folders.map((folder) =>
      h(
        'button',
        { class: 'tile folder-tile', onclick: () => { state.folderId = folder.id; renderHome(); window.scrollTo(0, 0); } },
        h('span', { class: 'thumb folder-thumb' }, h('span', { class: 'folder-emoji' }, folder.emoji)),
        h('span', { class: 'tile-title' }, folder.name),
      ),
    ),
    ...view.videos.map((video) =>
      h(
        'button',
        { class: 'tile', onclick: () => play(video) },
        h('span', { class: 'thumb' }, h('img', { src: thumbnailUrl(video.id), alt: '', loading: 'lazy' })),
        h('span', { class: 'tile-title' }, video.title),
      ),
    ),
  );
}

function play(video) {
  const status = access();
  if (status.blocked) {
    showRest(status.blocked);
    return;
  }
  hideToast();
  show('player');
  openPlayer(video, {
    list: () => currentView().videos,
    onClose: () => {
      flushUsage();
      goHome();
    },
    autoplay: () => activeProfile().autoplay,
    resumeAt,
    saveResume,
    onWatch,
    onSessionEnd: (entry) => {
      flushUsage();
      state.store.addHistory(state.profileId, state.usageDate, entry).catch(usageError);
    },
    onBroken: (broken) => {
      updateVideos((videos) => videos.map((v) => (v.id === broken.id ? { ...v, broken: true } : v))).catch(() => {});
    },
  });
}

// ---------- Modo padre ----------

function setupLocks() {
  document.querySelectorAll('.lock').forEach((lock) => {
    let timer = null;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      lock.classList.remove('pressing');
    };
    lock.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      lock.classList.add('pressing');
      timer = setTimeout(() => {
        cancel();
        unlockParent();
      }, LONG_PRESS_MS);
    });
    lock.addEventListener('pointerup', () => {
      if (timer) toast('Mantén pulsado el candado para entrar al modo padre');
      cancel();
    });
    lock.addEventListener('pointerleave', cancel);
    lock.addEventListener('pointercancel', cancel);
    lock.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

async function unlockParent() {
  const fromRest = screen() === 'rest' && !state.pendingShare;
  const pin = await pinPad({
    title: 'Modo padre',
    subtitle: 'Introduce tu PIN',
    validate: async (p) => (await store.hashPin(state.familyId, p)) === state.data?.pinHash,
    onForgot: resetPin,
  });
  if (!pin) return;
  // Desde la pantalla de descanso lo normal es querer dar más tiempo.
  if (fromRest && state.profileId && (await grantTime(state.profileId))) return;
  openParent();
}

async function resetPin() {
  if (!(await adultCheck())) return;
  const pin = await chooseNewPin();
  if (!pin) return;
  await saveNewPin(pin);
  openParent();
}

async function saveNewPin(pin) {
  const pinHash = await store.hashPin(state.familyId, pin);
  await state.store.update((d) => ({ ...d, pinHash }));
  toast('PIN cambiado');
}

// ---------- Conexión con la lista ----------

function connect(familyId) {
  if (state.unsubscribe) state.unsubscribe();
  state.familyId = familyId;
  state.store = store.openStore(familyId);
  state.data = null;
  show('loading');
  state.unsubscribe = state.store.subscribe(
    (data) => {
      if (!data) {
        store.setDevice({});
        state.unsubscribe();
        state.unsubscribe = null;
        show('setup');
        toast('La lista ya no existe. Crea una nueva.');
        return;
      }
      const first = state.data === null;
      state.data = data;
      if (first) {
        loadPlayerApi().catch(() => {});
        // Al crear una lista se abre el modo padre antes de que lleguen los datos.
        if (screen() === 'parent') renderParent();
        else goHome();
        if (state.pendingShare) unlockParent();
        return;
      }
      if (state.profileId && !profiles().some((p) => p.id === state.profileId)) state.profileId = null;
      const current = screen();
      if (current === 'parent') renderParent();
      else if (current === 'profiles') renderProfilePicker();
      else if (current === 'home' || current === 'rest') goHome();
    },
    (err) => {
      console.error(err);
      toast('No se pudo conectar con la lista. Revisa la conexión.');
    },
  );
}

async function createFamily() {
  const pin = await chooseNewPin();
  if (!pin) return;
  const familyId = store.syncEnabled ? store.newFamilyCode() : 'local';
  try {
    await store.openStore(familyId).create({ pinHash: await store.hashPin(familyId, pin), videos: [] });
  } catch (err) {
    console.error(err);
    toast('No se pudo crear la lista. Revisa la conexión.');
    return;
  }
  store.setDevice({ familyId });
  connect(familyId);
  openParent();
}

function showJoin(code = '') {
  $('join-code').value = code ? store.formatFamilyCode(code) : '';
  $('join-msg').textContent = '';
  show('join');
}

async function joinFamily(input) {
  const code = store.normalizeFamilyCode(input);
  const msg = $('join-msg');
  if (!code) {
    msg.textContent = 'El código tiene 16 letras y números.';
    return;
  }
  msg.textContent = 'Buscando…';
  try {
    if (!(await store.openStore(code).exists())) {
      msg.textContent = 'No encontramos ninguna lista con ese código.';
      return;
    }
  } catch (err) {
    console.error(err);
    msg.textContent = 'No se pudo comprobar el código. Revisa la conexión.';
    return;
  }
  msg.textContent = '';
  store.setDevice({ familyId: code });
  connect(code);
  toast('¡Listo! Este dispositivo ya usa la lista.');
}

function unlink() {
  if (!confirm('Este dispositivo dejará de mostrar la lista. La lista no se borra y podrás volver a unirte con el código. ¿Continuar?')) return;
  if (state.unsubscribe) state.unsubscribe();
  if (state.usageUnsubscribe) state.usageUnsubscribe();
  state.unsubscribe = null;
  state.usageUnsubscribe = null;
  state.profileId = null;
  store.setDevice({});
  show('setup');
}

// ---------- Arranque ----------

const actions = {
  ...parentActions,
  create: createFamily,
  'show-join': () => showJoin(),
  'back-setup': () => show('setup'),
  // Al salir del modo padre se vuelve a preguntar el perfil (salvo si está fijado).
  'exit-parent': () => {
    if (!profileLocked() && profiles().length > 1) state.profileId = null;
    goHome();
  },
  'folder-back': () => {
    state.folderId = null;
    renderHome();
  },
  'switch-profile': () => {
    if (profileLocked()) return;
    flushUsage();
    state.profileId = null;
    renderProfilePicker();
    show('profiles');
  },
  'change-pin': async () => {
    const pin = await chooseNewPin();
    if (pin) await saveNewPin(pin);
  },
  unlink,
};

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action && actions[action]) actions[action]();
});

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  joinFamily($('join-code').value);
});

// Evita menús contextuales y zoom accidentales en la parte del niño.
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});
document.addEventListener('gesturestart', (e) => e.preventDefault());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushUsage();
  else if (state.data) refreshAccess();
});

// Revisa cada 30 s el horario, los videos programados y el cambio de día.
setInterval(() => {
  if (!state.data || !state.profileId) return;
  if (model.todayKey() !== state.usageDate) {
    flushUsage();
    warned = new Set();
    subscribeUsage();
  }
  refreshAccess();
}, 30000);

function init() {
  document.body.classList.toggle('sync', store.syncEnabled);
  setupLocks();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const params = new URLSearchParams(location.search);
  const joinCode = store.normalizeFamilyCode(params.get('familia'));
  // Compartir un video desde YouTube (Android o el atajo de iPhone) abre MyTube con el enlace.
  // El atajo de iPhone puede mandar el enlace sin codificar: tomamos todo lo que
  // va detrás de "url=", aunque contenga "&" o "?".
  const rawUrl = location.search.match(/[?&]url=(.*)$/)?.[1];
  let sharedUrl = rawUrl;
  try {
    sharedUrl = rawUrl && decodeURIComponent(rawUrl);
  } catch {
    // Ya venía sin codificar.
  }
  const shared = sharedUrl || params.get('text') || params.get('title');
  if (shared && (parseVideoId(shared) || /youtu/i.test(shared))) state.pendingShare = shared;
  if (params.toString()) history.replaceState(null, '', location.pathname);

  const device = store.getDevice();
  if (joinCode && store.syncEnabled && device.familyId !== joinCode) {
    if (!device.familyId || confirm('¿Cambiar este dispositivo a la lista de ese enlace?')) {
      showJoin(joinCode);
      joinFamily(joinCode);
      return;
    }
  }

  if (device.familyId && (store.syncEnabled || device.familyId === 'local')) {
    connect(device.familyId);
  } else {
    show('setup');
  }
}

init();
