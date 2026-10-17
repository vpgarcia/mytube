import { parseVideoId, thumbnailUrl, fetchVideoInfo, loadPlayerApi } from './youtube.js';
import { openPlayer } from './player.js';
import * as store from './store.js';

const LONG_PRESS_MS = 1500;

const state = {
  screen: 'loading',
  familyId: null,
  store: null,
  data: null,
  unsubscribe: null,
  pendingShare: null,
};

const $ = (id) => document.getElementById(id);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value);
  }
  el.append(...children.filter((c) => c !== null && c !== undefined));
  return el;
}

function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

const ICONS = {
  up: 'M12 5 5 12h4v7h6v-7h4z',
  down: 'M12 19 5 12h4V5h6v7h4z',
  edit: 'M4 17.3V20h2.7l8-8L12 9.3l-8 8ZM19.7 7a1 1 0 0 0 0-1.4l-1.3-1.3a1 1 0 0 0-1.4 0l-1.6 1.6L18 8.6 19.7 7Z',
  trash: 'M7 6V4h10v2h4v2h-1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8H3V6h4Zm2 4v8h2v-8H9Zm4 0v8h2v-8h-2Z',
};

function show(screenId) {
  document.querySelectorAll('.screen').forEach((s) => {
    s.hidden = s.id !== screenId;
  });
  state.screen = screenId;
  window.scrollTo(0, 0);
}

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

// ---------- Modales: teclado de PIN y pregunta para adultos ----------

function modal(content) {
  const backdrop = h('div', { class: 'modal-backdrop' }, h('div', { class: 'modal' }, content));
  $('modal-root').append(backdrop);
  return () => backdrop.remove();
}

// Pide un PIN de 4 cifras. Si se pasa `validate`, el teclado no se cierra
// hasta que el PIN sea válido (o se cancele).
function pinPad({ title, subtitle = '', validate = null, onForgot = null }) {
  return new Promise((resolve) => {
    let pin = '';
    const dots = h('div', { class: 'pin-dots' }, ...Array.from({ length: 4 }, () => h('span')));
    const box = h('div', { class: 'pin-box' });
    let close = () => {};

    const finish = (value) => {
      close();
      resolve(value);
    };

    const renderDots = () => {
      [...dots.children].forEach((d, i) => d.classList.toggle('filled', i < pin.length));
    };

    const press = async (digit) => {
      if (pin.length >= 4) return;
      pin += digit;
      renderDots();
      if (pin.length < 4) return;
      if (!validate || (await validate(pin))) {
        finish(pin);
      } else {
        box.classList.remove('shake');
        void box.offsetWidth;
        box.classList.add('shake');
        setTimeout(() => {
          pin = '';
          renderDots();
        }, 350);
      }
    };

    const keys = h(
      'div',
      { class: 'pin-keys' },
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) =>
        h('button', { class: 'pin-key', type: 'button', onclick: () => press(d) }, d),
      ),
      h('button', { class: 'pin-key text', type: 'button', onclick: () => finish(null) }, 'Cancelar'),
      h('button', { class: 'pin-key', type: 'button', onclick: () => press('0') }, '0'),
      h(
        'button',
        {
          class: 'pin-key text',
          type: 'button',
          onclick: () => {
            pin = pin.slice(0, -1);
            renderDots();
          },
        },
        'Borrar',
      ),
    );

    box.append(h('h2', {}, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null, dots, keys);
    if (onForgot) {
      box.append(
        h(
          'button',
          {
            class: 'btn link',
            type: 'button',
            onclick: () => {
              finish(null);
              onForgot();
            },
          },
          '¿Olvidaste el PIN?',
        ),
      );
    }
    close = modal(box);
  });
}

// Pregunta que un niño pequeño no sabe contestar, para restablecer el PIN.
function adultCheck() {
  return new Promise((resolve) => {
    const a = 6 + Math.floor(Math.random() * 4);
    const b = 12 + Math.floor(Math.random() * 8);
    const input = h('input', { class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off' });
    const msg = h('p', { class: 'form-msg', role: 'alert' });
    let close = () => {};
    const form = h(
      'form',
      {
        class: 'pin-box',
        onsubmit: (e) => {
          e.preventDefault();
          if (Number(input.value) === a * b) {
            close();
            resolve(true);
          } else {
            msg.textContent = 'Respuesta incorrecta.';
            input.value = '';
          }
        },
      },
      h('h2', {}, 'Comprobación para adultos'),
      h('p', { class: 'muted' }, `¿Cuánto es ${a} × ${b}?`),
      input,
      msg,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => { close(); resolve(false); } }, 'Cancelar'),
        h('button', { class: 'btn primary', type: 'submit' }, 'Continuar'),
      ),
    );
    close = modal(form);
    input.focus();
  });
}

async function chooseNewPin() {
  for (;;) {
    const first = await pinPad({ title: 'Elige un PIN', subtitle: '4 cifras para entrar al modo padre' });
    if (!first) return null;
    const second = await pinPad({ title: 'Repite el PIN' });
    if (!second) return null;
    if (first === second) return first;
    toast('Los PIN no coinciden. Prueba otra vez.');
  }
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
      state.data = data;
      if (state.screen === 'loading') {
        show('home');
        loadPlayerApi().catch(() => {});
      }
      renderHome();
      if (state.screen === 'parent') renderParent();
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

// ---------- Pantalla del niño ----------

function renderHome() {
  const videos = state.data?.videos || [];
  $('empty').hidden = videos.length > 0;
  $('grid').replaceChildren(
    ...videos.map((video) =>
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
  $('toast').hidden = true;
  show('player');
  openPlayer(video, {
    onClose: () => show('home'),
    list: () => state.data?.videos || [],
    others: (v) => (state.data?.videos || []).filter((o) => o.id !== v.id),
  });
}

// Mantener pulsado el candado para entrar al modo padre.
function setupLock() {
  const lock = $('lock');
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
}

async function unlockParent() {
  const pin = await pinPad({
    title: 'Modo padre',
    subtitle: 'Introduce tu PIN',
    validate: async (p) => (await store.hashPin(state.familyId, p)) === state.data?.pinHash,
    onForgot: resetPin,
  });
  if (pin) openParent();
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

// ---------- Modo padre ----------

function openParent() {
  show('parent');
  renderParent();
  if (state.pendingShare) {
    $('add-input').value = state.pendingShare;
    state.pendingShare = null;
    addVideo($('add-input').value);
  }
}

function renderParent() {
  const videos = state.data?.videos || [];
  $('video-count').textContent = videos.length ? `(${videos.length})` : '';
  $('video-list-empty').hidden = videos.length > 0;
  if (store.syncEnabled) $('family-code').textContent = store.formatFamilyCode(state.familyId);

  $('video-list').replaceChildren(
    ...videos.map((video, i) =>
      h(
        'li',
        { class: 'video-item' },
        h('img', { src: thumbnailUrl(video.id), alt: '', loading: 'lazy' }),
        h('div', { class: 'video-info' },
          h('span', { class: 'video-title' }, video.title),
          video.channel ? h('span', { class: 'muted small' }, video.channel) : null,
        ),
        h('div', { class: 'video-actions' },
          iconButton('Subir', ICONS.up, () => moveVideo(video.id, -1), i === 0),
          iconButton('Bajar', ICONS.down, () => moveVideo(video.id, 1), i === videos.length - 1),
          iconButton('Cambiar título', ICONS.edit, () => renameVideo(video)),
          iconButton('Quitar', ICONS.trash, () => removeVideo(video), false, 'danger'),
        ),
      ),
    ),
  );
}

function iconButton(label, path, onclick, disabled = false, extra = '') {
  const btn = h('button', { class: `icon-btn ${extra}`, type: 'button', 'aria-label': label, title: label, onclick }, icon(path));
  btn.disabled = disabled;
  return btn;
}

function updateVideos(fn) {
  return state.store.update((d) => ({ ...d, videos: fn(d.videos || []) })).catch((err) => {
    console.error(err);
    toast('No se pudo guardar el cambio. Revisa la conexión.');
  });
}

async function addVideo(input) {
  const msg = $('add-msg');
  const btn = $('add-btn');
  const id = parseVideoId(input);
  if (!id) {
    msg.textContent = 'Ese enlace no parece de un video de YouTube.';
    return;
  }
  if ((state.data?.videos || []).some((v) => v.id === id)) {
    msg.textContent = 'Ese video ya está en la lista.';
    return;
  }
  msg.textContent = 'Comprobando el video…';
  btn.disabled = true;
  const info = await fetchVideoInfo(id);
  btn.disabled = false;
  if (info.exists === false) {
    msg.textContent = 'No encontramos ese video. ¿Es privado o se ha borrado?';
    return;
  }
  if (info.embeddable === false) {
    msg.textContent = 'El autor de ese video no permite verlo fuera de YouTube, así que aquí no funcionará.';
    return;
  }
  const video = { id, title: info.title || 'Video', channel: info.channel || '', addedAt: Date.now() };
  await updateVideos((videos) => [video, ...videos.filter((v) => v.id !== id)]);
  msg.textContent = '';
  $('add-input').value = '';
  toast(info.title ? `Añadido: ${info.title}` : 'Video añadido');
}

function moveVideo(id, delta) {
  updateVideos((videos) => {
    const list = [...videos];
    const i = list.findIndex((v) => v.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return list;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  });
}

function renameVideo(video) {
  const title = prompt('Título del video', video.title);
  if (title === null || !title.trim()) return;
  updateVideos((videos) => videos.map((v) => (v.id === video.id ? { ...v, title: title.trim() } : v)));
}

function removeVideo(video) {
  if (!confirm(`¿Quitar «${video.title}» de la lista?`)) return;
  updateVideos((videos) => videos.filter((v) => v.id !== video.id));
}

function familyLink() {
  return `${location.origin}${location.pathname}?familia=${state.familyId}`;
}

async function shareLink() {
  const url = familyLink();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'MyTube', text: 'Abre este enlace para usar la misma lista de videos:', url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  await copyText(url, 'Enlace copiado');
}

async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    prompt('Copia esto:', text);
  }
}

function unlink() {
  if (!confirm('Este dispositivo dejará de mostrar la lista. La lista no se borra y podrás volver a unirte con el código. ¿Continuar?')) return;
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  store.setDevice({});
  show('setup');
}

// ---------- Arranque ----------

const actions = {
  create: createFamily,
  'show-join': () => showJoin(),
  'back-setup': () => show('setup'),
  'exit-parent': () => show('home'),
  'share-link': shareLink,
  'copy-code': () => copyText(store.formatFamilyCode(state.familyId), 'Código copiado'),
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

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  addVideo($('add-input').value);
});

// Evita menús contextuales y zoom accidentales en la parte del niño.
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('input')) e.preventDefault();
});
document.addEventListener('gesturestart', (e) => e.preventDefault());

function init() {
  document.body.classList.toggle('sync', store.syncEnabled);
  setupLock();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const params = new URLSearchParams(location.search);
  const joinCode = store.normalizeFamilyCode(params.get('familia'));
  // Android: compartir un video desde la app de YouTube abre MyTube con el enlace.
  const shared = params.get('url') || params.get('text') || params.get('title');
  if (shared && parseVideoId(shared)) state.pendingShare = shared;
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
    if (state.pendingShare) toast('Entra al modo padre para añadir el video compartido');
  } else {
    show('setup');
  }
}

init();
