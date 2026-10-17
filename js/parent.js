// Modo padre: añadir y organizar videos, carpetas, perfiles, límites y actividad.

import { parseInput, thumbnailUrl, fetchVideoInfo, fetchPlaylistIds, mapLimit } from './youtube.js';
import * as store from './store.js';
import * as model from './model.js';
import { state, updateData, updateVideos, usageError } from './state.js';
import { $, h, show, toast, dialog, field, select, emojiPicker, checkboxes, toggle, iconButton, ICONS, copyText } from './ui.js';

const CHECK_KEY = 'mytube:lastCheck';
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const IMPORT_MAX = 200;

let videoFilter = 'all';
let activityProfile = null;

// ---------- Utilidades ----------

function profiles() {
  return model.getProfiles(state.data);
}

function folders() {
  return model.getFolders(state.data);
}

// Los datos antiguos no guardan perfiles: antes de modificarlos se materializa el de por defecto.
function withProfiles(d) {
  return d.profiles?.length ? d.profiles : [model.DEFAULT_PROFILE];
}

function folderOptions(includeNone = true) {
  return [...(includeNone ? [{ value: '', label: 'Sin carpeta' }] : []), ...folders().map((f) => ({ value: f.id, label: `${f.emoji} ${f.name}` }))];
}

function profileOptions() {
  return profiles().map((p) => ({ value: p.id, label: `${p.emoji} ${p.name}` }));
}

function toLocalInput(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// ---------- Abrir y pintar ----------

export function openParent() {
  show('parent');
  renderParent();
  activityProfile = activityProfile || state.profileId;
  renderActivity();
  maybeAutoCheck();
  if (state.pendingShare) {
    const shared = state.pendingShare;
    state.pendingShare = null;
    $('add-input').value = shared;
    addFromInput(shared);
  }
}

export function renderParent() {
  renderAddOptions();
  renderVideos();
  renderFolders();
  renderProfiles();
  renderDevice();
  if (store.syncEnabled) {
    $('family-code').textContent = store.formatFamilyCode(state.familyId);
    $('shortcut-url').textContent = shortcutBase();
  }
  const broken = (state.data?.videos || []).filter((v) => v.broken).length;
  $('broken-banner').hidden = broken === 0;
  $('broken-banner').textContent = `⚠️ ${broken === 1 ? 'Hay 1 video que ya no' : `Hay ${broken} videos que ya no`} se puede${broken === 1 ? '' : 'n'} ver (borrado, privado o sin permiso para verse fuera de YouTube). El niño no los ve; puedes quitarlos de la lista.`;
  $('rules-banner').hidden = !state.usageDenied;
}

function renderAddOptions() {
  const wrap = $('add-options');
  const keep = { folder: wrap.querySelector('select')?.value, profiles: wrap.querySelector('.checks')?.value };
  const parts = [];
  if (folders().length) parts.push(field('Carpeta', select(folderOptions(), keep.folder || '')));
  if (profiles().length > 1) parts.push(field('Para', checkboxes(profileOptions(), keep.profiles || profiles().map((p) => p.id))));
  wrap.replaceChildren(...parts);
}

function addTarget() {
  const wrap = $('add-options');
  const folderId = wrap.querySelector('select')?.value || null;
  const chosen = wrap.querySelector('.checks')?.value;
  // Todos los perfiles marcados equivale a "para todos".
  const profileIds = chosen && chosen.length < profiles().length ? chosen : null;
  return { folderId, profiles: profileIds };
}

function videoMeta(video) {
  const bits = [];
  if (video.broken) bits.push('⚠️ No disponible');
  if (model.isScheduledLater(video)) bits.push(`📅 ${model.formatDateTime(video.availableFrom)}`);
  const folder = folders().find((f) => f.id === video.folderId);
  if (folder) bits.push(`${folder.emoji} ${folder.name}`);
  if (video.profiles?.length && profiles().length > 1) {
    bits.push(profiles().filter((p) => video.profiles.includes(p.id)).map((p) => p.emoji).join(' '));
  }
  if (video.channel) bits.push(video.channel);
  return bits.join(' · ');
}

function renderVideos() {
  const all = state.data?.videos || [];
  const chips = [{ id: 'all', label: 'Todos' }];
  folders().forEach((f) => chips.push({ id: f.id, label: `${f.emoji} ${f.name}` }));
  if (folders().length) chips.push({ id: 'none', label: 'Sin carpeta' });
  if (all.some((v) => model.isScheduledLater(v))) chips.push({ id: 'scheduled', label: '📅 Programados' });
  if (all.some((v) => v.broken)) chips.push({ id: 'broken', label: '⚠️ No disponibles' });
  if (!chips.some((c) => c.id === videoFilter)) videoFilter = 'all';
  $('video-filter').replaceChildren(
    ...(chips.length > 1
      ? chips.map((c) =>
          h('button', { type: 'button', class: `chip ${c.id === videoFilter ? 'active' : ''}`, onclick: () => { videoFilter = c.id; renderVideos(); } }, c.label),
        )
      : []),
  );

  const matches = (v) =>
    videoFilter === 'all' ||
    (videoFilter === 'none' && !folders().some((f) => f.id === v.folderId)) ||
    (videoFilter === 'scheduled' && model.isScheduledLater(v)) ||
    (videoFilter === 'broken' && v.broken) ||
    v.folderId === videoFilter;
  const shown = all.filter(matches);

  $('video-count').textContent = all.length ? `(${all.length})` : '';
  $('video-list-empty').hidden = all.length > 0;
  $('video-list').replaceChildren(
    ...shown.map((video, i) =>
      h(
        'li',
        { class: `video-item ${video.broken || model.isScheduledLater(video) ? 'dim' : ''}` },
        h('img', { src: thumbnailUrl(video.id), alt: '', loading: 'lazy' }),
        h('div', { class: 'video-info' }, h('span', { class: 'video-title' }, video.title), h('span', { class: 'muted small' }, videoMeta(video))),
        h(
          'div',
          { class: 'video-actions' },
          iconButton('Subir', ICONS.up, () => moveVideo(video.id, shown[i - 1]?.id), { disabled: i === 0 }),
          iconButton('Bajar', ICONS.down, () => moveVideo(video.id, shown[i + 1]?.id), { disabled: i === shown.length - 1 }),
          iconButton('Editar', ICONS.edit, () => editVideo(video)),
          iconButton('Quitar', ICONS.trash, () => removeVideo(video), { extra: 'danger' }),
        ),
      ),
    ),
  );
}

function renderFolders() {
  const list = folders();
  $('folder-list-empty').hidden = list.length > 0;
  const count = (id) => (state.data?.videos || []).filter((v) => v.folderId === id).length;
  $('folder-list').replaceChildren(
    ...list.map((f, i) =>
      h(
        'li',
        { class: 'simple-item' },
        h('span', { class: 'simple-emoji' }, f.emoji),
        h('div', { class: 'video-info' }, h('span', { class: 'video-title' }, f.name), h('span', { class: 'muted small' }, `${count(f.id)} videos`)),
        h(
          'div',
          { class: 'video-actions' },
          iconButton('Subir', ICONS.up, () => moveFolder(f.id, -1), { disabled: i === 0 }),
          iconButton('Bajar', ICONS.down, () => moveFolder(f.id, 1), { disabled: i === list.length - 1 }),
          iconButton('Editar', ICONS.edit, () => editFolder(f)),
          iconButton('Borrar', ICONS.trash, () => deleteFolder(f), { extra: 'danger' }),
        ),
      ),
    ),
  );
}

function renderProfiles() {
  const list = profiles();
  $('profile-list').replaceChildren(
    ...list.map((p) =>
      h(
        'li',
        { class: 'simple-item' },
        h('span', { class: 'simple-emoji' }, p.emoji),
        h('div', { class: 'video-info' }, h('span', { class: 'video-title' }, p.name), h('span', { class: 'muted small' }, model.limitLabel(p))),
        h(
          'div',
          { class: 'video-actions' },
          iconButton('Editar', ICONS.edit, () => editProfile(p)),
          list.length > 1 ? iconButton('Borrar', ICONS.trash, () => deleteProfile(p), { extra: 'danger' }) : null,
        ),
      ),
    ),
  );
}

function renderDevice() {
  const sel = $('device-profile');
  const device = store.getDevice();
  const list = profiles();
  const options = [];
  if (list.length > 1) options.push({ value: '', label: 'Preguntar cada vez' });
  list.forEach((p) => options.push({ value: p.id, label: `${p.emoji} ${p.name}` }));
  const value = device.profileLocked ? device.profileId : list.length > 1 ? '' : list[0].id;
  sel.replaceChildren(...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  sel.onchange = () => {
    const id = sel.value;
    store.updateDevice(id ? { profileId: id, profileLocked: true } : { profileLocked: false });
    if (id) state.profileId = id;
    toast(id ? 'Perfil fijado en este dispositivo' : 'Se preguntará quién va a ver videos');
  };
}

// ---------- Añadir videos ----------

async function addFromInput(input) {
  const msg = $('add-msg');
  const parsed = parseInput(input);
  if (!parsed) {
    msg.textContent = 'Ese enlace no parece de YouTube.';
    return;
  }
  if (parsed.type === 'handle') {
    msg.textContent =
      'Los enlaces de canal con @nombre no se pueden leer sin la API de YouTube. Abre una lista de reproducción del canal y pega su enlace, o usa el enlace youtube.com/channel/UC… del canal.';
    return;
  }
  if (parsed.type === 'playlist') {
    if (parsed.videoId) {
      const choice = await dialog({
        title: 'Este video está en una lista',
        content: [h('p', { class: 'muted' }, '¿Quieres añadir solo este video o todos los de la lista?')],
        actions: [
          { label: 'Cancelar', value: null },
          { label: 'Solo este', value: 'one' },
          { label: 'Toda la lista', value: 'all', class: 'primary' },
        ],
      });
      if (!choice) return;
      if (choice === 'one') return addVideos([parsed.videoId]);
    }
    msg.textContent = 'Leyendo la lista…';
    $('add-btn').disabled = true;
    let ids;
    try {
      ids = await fetchPlaylistIds(parsed.list);
    } catch {
      $('add-btn').disabled = false;
      msg.textContent = 'No se pudo leer la lista. ¿Es pública?';
      return;
    }
    $('add-btn').disabled = false;
    if (!ids?.length) {
      msg.textContent = 'La lista está vacía.';
      return;
    }
    return addVideos(ids.slice(0, IMPORT_MAX));
  }
  return addVideos([parsed.id]);
}

async function addVideos(ids) {
  const msg = $('add-msg');
  const btn = $('add-btn');
  const existing = new Set((state.data?.videos || []).map((v) => v.id));
  const fresh = [...new Set(ids)].filter((id) => !existing.has(id));
  if (!fresh.length) {
    msg.textContent = ids.length === 1 ? 'Ese video ya está en la lista.' : 'Todos esos videos ya están en la lista.';
    return;
  }

  btn.disabled = true;
  let done = 0;
  msg.textContent = fresh.length === 1 ? 'Comprobando el video…' : `Comprobando 0 de ${fresh.length}…`;
  const infos = await mapLimit(fresh, 4, async (id) => {
    const info = await fetchVideoInfo(id);
    done += 1;
    if (fresh.length > 1) msg.textContent = `Comprobando ${done} de ${fresh.length}…`;
    return { id, info };
  });
  btn.disabled = false;

  const ok = infos.filter(({ info }) => info.exists !== false && info.embeddable !== false);
  const skipped = infos.length - ok.length;
  if (!ok.length) {
    const only = infos[0].info;
    msg.textContent =
      fresh.length > 1
        ? 'Ninguno de esos videos se puede ver fuera de YouTube.'
        : only.exists === false
          ? 'No encontramos ese video. ¿Es privado o se ha borrado?'
          : 'El autor de ese video no permite verlo fuera de YouTube, así que aquí no funcionará.';
    return;
  }

  const target = addTarget();
  const now = Date.now();
  const videos = ok.map(({ id, info }, i) => ({
    id,
    title: info.title || 'Video',
    channel: info.channel || '',
    addedAt: now - i,
    ...(target.folderId ? { folderId: target.folderId } : {}),
    ...(target.profiles ? { profiles: target.profiles } : {}),
  }));
  try {
    await updateVideos((list) => {
      const ids = new Set(videos.map((v) => v.id));
      return [...videos, ...list.filter((v) => !ids.has(v.id))];
    });
  } catch {
    return;
  }
  $('add-input').value = '';
  msg.textContent = skipped ? `${skipped} no se pueden ver fuera de YouTube y no se han añadido.` : '';
  toast(videos.length === 1 ? `Añadido: ${videos[0].title}` : `Añadidos ${videos.length} videos`);
}

// ---------- Editar videos ----------

function moveVideo(id, otherId) {
  if (!otherId) return;
  updateVideos((videos) => {
    const list = [...videos];
    const i = list.findIndex((v) => v.id === id);
    const j = list.findIndex((v) => v.id === otherId);
    if (i < 0 || j < 0) return list;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  }).catch(() => {});
}

async function editVideo(video) {
  const title = h('input', { class: 'input', value: video.title });
  const folder = folders().length ? select(folderOptions(), video.folderId || '') : null;
  const who = profiles().length > 1 ? checkboxes(profileOptions(), video.profiles?.length ? video.profiles : profiles().map((p) => p.id)) : null;
  const from = h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(video.availableFrom) });

  const result = await dialog({
    title: 'Editar video',
    content: [
      h('img', { class: 'dialog-thumb', src: thumbnailUrl(video.id), alt: '' }),
      field('Título', title),
      folder && field('Carpeta', folder),
      who && field('Lo pueden ver', who),
      field('Disponible a partir de', from, 'Déjalo vacío para que esté disponible ya. Útil para preparar sorpresas.'),
      video.broken ? h('p', { class: 'note' }, '⚠️ La última comprobación dijo que este video ya no se puede ver.') : null,
    ],
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Guardar', value: 'save', submit: true, class: 'primary' },
    ],
  });
  if (result !== 'save') return;

  const chosen = who?.value;
  if (who && !chosen.length) {
    toast('Elige al menos un perfil');
    return;
  }
  const changes = {
    title: title.value.trim() || video.title,
    folderId: folder ? folder.value || null : video.folderId || null,
    profiles: chosen && chosen.length < profiles().length ? chosen : null,
    availableFrom: from.value ? new Date(from.value).getTime() : null,
  };
  updateVideos((videos) =>
    videos.map((v) => {
      if (v.id !== video.id) return v;
      const next = { ...v, ...changes };
      Object.keys(next).forEach((k) => next[k] === null && delete next[k]);
      return next;
    }),
  ).catch(() => {});
}

function removeVideo(video) {
  if (!confirm(`¿Quitar «${video.title}» de la lista?`)) return;
  updateVideos((videos) => videos.filter((v) => v.id !== video.id)).catch(() => {});
}

// Comprueba si los videos siguen disponibles en YouTube.
async function checkVideos({ quiet = false } = {}) {
  const videos = state.data?.videos || [];
  if (!videos.length) return;
  const btn = $('check-btn');
  btn.disabled = true;
  if (!quiet) btn.textContent = 'Comprobando…';
  const results = await mapLimit(videos, 4, async (v) => ({ id: v.id, info: await fetchVideoInfo(v.id) }));
  btn.disabled = false;
  btn.textContent = 'Comprobar';
  localStorage.setItem(CHECK_KEY, String(Date.now()));

  const status = new Map();
  results.forEach(({ id, info }) => {
    if (info.exists === false || info.embeddable === false) status.set(id, true);
    // La comprobación automática no desmarca: un video puede existir y aun así
    // fallar en el reproductor (edad, país…). Desmarcar es cosa del botón.
    else if (info.embeddable && !quiet) status.set(id, false);
    // Sin respuesta (sin red): no se cambia nada.
  });
  const changed = videos.some((v) => status.has(v.id) && Boolean(v.broken) !== status.get(v.id));
  if (changed) {
    await updateVideos((list) =>
      list.map((v) => {
        if (!status.has(v.id)) return v;
        const next = { ...v };
        if (status.get(v.id)) next.broken = true;
        else delete next.broken;
        return next;
      }),
    ).catch(() => {});
  }
  if (!quiet) {
    const broken = [...status.values()].filter(Boolean).length;
    toast(broken ? `${broken} videos ya no están disponibles` : 'Todos los videos funcionan');
  }
}

function maybeAutoCheck() {
  const last = Number(localStorage.getItem(CHECK_KEY) || 0);
  if (Date.now() - last > CHECK_EVERY_MS) checkVideos({ quiet: true });
}

// ---------- Carpetas ----------

async function folderDialog(folder) {
  const name = h('input', { class: 'input', value: folder?.name || '', placeholder: 'Dinosaurios', required: true });
  const emoji = emojiPicker(model.FOLDER_EMOJIS, folder?.emoji);
  const ok = await dialog({
    title: folder ? 'Editar carpeta' : 'Nueva carpeta',
    content: [field('Nombre', name), field('Dibujo', emoji)],
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Guardar', value: true, submit: true, class: 'primary' },
    ],
  });
  return ok && name.value.trim() ? { name: name.value.trim(), emoji: emoji.value } : null;
}

async function newFolder() {
  const values = await folderDialog(null);
  if (!values) return;
  const folder = { id: model.newId('f'), ...values };
  updateData((d) => ({ ...d, folders: [...(d.folders || []), folder] })).catch(() => {});
}

async function editFolder(folder) {
  const values = await folderDialog(folder);
  if (!values) return;
  updateData((d) => ({ ...d, folders: (d.folders || []).map((f) => (f.id === folder.id ? { ...f, ...values } : f)) })).catch(() => {});
}

function moveFolder(id, delta) {
  updateData((d) => {
    const list = [...(d.folders || [])];
    const i = list.findIndex((f) => f.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return d;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...d, folders: list };
  }).catch(() => {});
}

function deleteFolder(folder) {
  if (!confirm(`¿Borrar la carpeta «${folder.name}»? Sus videos no se borran: pasan a estar sin carpeta.`)) return;
  updateData((d) => ({
    ...d,
    folders: (d.folders || []).filter((f) => f.id !== folder.id),
    videos: (d.videos || []).map((v) => {
      if (v.folderId !== folder.id) return v;
      const { folderId, ...rest } = v;
      return rest;
    }),
  })).catch(() => {});
}

// ---------- Perfiles ----------

async function profileDialog(profile) {
  const name = h('input', { class: 'input', value: profile?.name || '', placeholder: 'Nombre', required: true });
  const used = new Set(profiles().map((p) => p.emoji));
  const emoji = emojiPicker(model.PROFILE_EMOJIS, profile?.emoji || model.PROFILE_EMOJIS.find((e) => !used.has(e)));
  const limit = select(model.LIMIT_OPTIONS.map((m) => ({ value: m, label: m ? model.formatMinutes(m * 60) : 'Sin límite' })), profile?.limitMin || 0);
  const schedule = profile?.schedule || model.DEFAULT_PROFILE.schedule;
  const useSchedule = toggle('Solo en este horario', schedule.enabled);
  const from = h('input', { class: 'input', type: 'time', value: schedule.from });
  const to = h('input', { class: 'input', type: 'time', value: schedule.to });
  const autoplay = toggle('Al terminar un video, empezar el siguiente', profile?.autoplay);

  const ok = await dialog({
    title: profile ? 'Editar perfil' : 'Nuevo perfil',
    content: [
      field('Nombre', name),
      field('Dibujo', emoji),
      field('Tiempo máximo al día', limit),
      h('div', { class: 'field' }, useSchedule, h('div', { class: 'time-row' }, field('Desde', from), field('Hasta', to))),
      h('div', { class: 'field' }, autoplay),
    ],
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Guardar', value: true, submit: true, class: 'primary' },
    ],
  });
  if (!ok || !name.value.trim()) return null;
  return {
    name: name.value.trim(),
    emoji: emoji.value,
    limitMin: Number(limit.value),
    schedule: { enabled: useSchedule.value, from: from.value || '17:00', to: to.value || '20:00' },
    autoplay: autoplay.value,
  };
}

async function newProfile() {
  const values = await profileDialog(null);
  if (!values) return;
  const profile = { ...model.DEFAULT_PROFILE, id: model.newId('p'), ...values };
  updateData((d) => ({ ...d, profiles: [...withProfiles(d), profile] })).catch(() => {});
  toast(`Perfil «${profile.name}» creado. Elige qué videos ve al editar cada video.`);
}

async function editProfile(profile) {
  const values = await profileDialog(profile);
  if (!values) return;
  updateData((d) => ({ ...d, profiles: withProfiles(d).map((p) => (p.id === profile.id ? { ...p, ...values } : p)) })).catch(() => {});
}

function deleteProfile(profile) {
  if (!confirm(`¿Borrar el perfil «${profile.name}»?`)) return;
  updateData((d) => ({
    ...d,
    profiles: withProfiles(d).filter((p) => p.id !== profile.id),
    videos: (d.videos || []).map((v) => {
      if (!v.profiles?.includes(profile.id)) return v;
      const rest = v.profiles.filter((id) => id !== profile.id);
      if (rest.length) return { ...v, profiles: rest };
      const { profiles: _, ...video } = v;
      return video;
    }),
  })).catch(() => {});
  if (state.profileId === profile.id) state.profileId = null;
}

// ---------- Tiempo extra y actividad ----------

export async function grantTime(profileId) {
  const profile = model.getProfile(state.data, profileId);
  const choice = await dialog({
    title: `Más tiempo para ${profile.name}`,
    content: [h('p', { class: 'muted' }, 'Solo para hoy. Mañana vuelven los límites normales.')],
    actions: [
      { label: '+15 min', value: 15 },
      { label: '+30 min', value: 30 },
      { label: '+1 hora', value: 60 },
      { label: 'Sin límites hoy', value: 'all', class: 'primary' },
      { label: 'Cancelar', value: null, class: 'link' },
    ],
  });
  if (!choice) return false;
  const date = model.todayKey();
  const now = Date.now();
  try {
    if (choice === 'all') {
      await state.store.grantUsage(profileId, date, { unlimited: true, overrideUntil: model.endOfDay(now) });
    } else {
      const usage = await state.store.getUsage(profileId, date);
      const seconds = choice * 60;
      // Si ya se había pasado del límite, el extra cuenta desde ahora.
      const over = profile.limitMin ? Math.max(0, (usage.seconds || 0) - profile.limitMin * 60 - (usage.bonusSeconds || 0)) : 0;
      await state.store.grantUsage(profileId, date, {
        bonusSeconds: seconds + over,
        overrideUntil: Math.max(now, usage.overrideUntil || 0) + seconds,
      });
    }
  } catch (err) {
    usageError(err);
    toast('No se pudo guardar. Revisa la conexión.');
    return false;
  }
  toast(choice === 'all' ? 'Hoy sin límites' : `+${choice} min para ${profile.name}`);
  if ($('activity').isConnected && !$('parent').hidden) renderActivity();
  return true;
}

async function renderActivity() {
  const list = profiles();
  if (!list.some((p) => p.id === activityProfile)) activityProfile = list[0].id;
  $('activity-tabs').replaceChildren(
    ...(list.length > 1
      ? list.map((p) =>
          h('button', { type: 'button', class: `chip ${p.id === activityProfile ? 'active' : ''}`, onclick: () => { activityProfile = p.id; renderActivity(); } }, `${p.emoji} ${p.name}`),
        )
      : []),
  );
  const box = $('activity');
  box.replaceChildren(h('p', { class: 'muted' }, 'Cargando…'));

  const profile = model.getProfile(state.data, activityProfile);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return { key: model.todayKey(d), label: i === 0 ? 'Hoy' : d.toLocaleDateString('es-ES', { weekday: 'short' }) };
  });
  let usages;
  try {
    usages = await Promise.all(days.map((d) => state.store.getUsage(profile.id, d.key)));
  } catch (err) {
    usageError(err);
    $('rules-banner').hidden = !state.usageDenied;
    box.replaceChildren(h('p', { class: 'muted' }, 'No se pudo cargar la actividad.'));
    return;
  }
  if (profile.id !== activityProfile) return;

  const today = usages[0];
  const status = model.accessStatus(profile, today);
  const summary = [`Hoy lleva ${model.formatMinutes(today.seconds)}`];
  if (today.unlimited) summary.push('sin límites hoy');
  else if (status.remaining !== null) summary.push(`le quedan ${model.formatMinutes(status.remaining)}`);
  if (status.blocked === 'schedule') summary.push('ahora está fuera de horario');

  const max = Math.max(60, ...usages.map((u) => u.seconds || 0));
  const bars = h(
    'div',
    { class: 'bars' },
    [...days].reverse().map((d, i) => {
      const u = usages[days.length - 1 - i];
      return h(
        'div',
        { class: 'bar-col' },
        h('span', { class: 'bar-value' }, u.seconds ? model.formatMinutes(u.seconds) : ''),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar', style: `height:${((u.seconds || 0) / max) * 100}%` })),
        h('span', { class: 'bar-label' }, d.label),
      );
    }),
  );

  const titles = new Map((state.data?.videos || []).map((v) => [v.id, v.title]));
  const history = [...(today.history || [])].sort((a, b) => b.at - a.at);
  const historyList = history.length
    ? h(
        'ul',
        { class: 'history' },
        history.map((e) =>
          h(
            'li',
            {},
            h('span', { class: 'history-time' }, new Date(e.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })),
            h('span', { class: 'history-title' }, titles.get(e.videoId) || e.title || 'Video'),
            h('span', { class: 'muted small' }, model.formatMinutes(e.seconds)),
          ),
        ),
      )
    : h('p', { class: 'muted' }, 'Hoy todavía no ha visto ningún video.');

  box.replaceChildren(
    h('p', { class: 'activity-summary' }, summary.join(', ') + '.'),
    h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => grantTime(profile.id) }, 'Dar más tiempo hoy')),
    h('h3', {}, 'Últimos 7 días'),
    bars,
    h('h3', {}, 'Visto hoy'),
    historyList,
  );
}

// ---------- Compartir y dispositivos ----------

function familyLink() {
  return `${location.origin}${location.pathname}?familia=${state.familyId}`;
}

function shortcutBase() {
  return `${familyLink()}&url=`;
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

export const parentActions = {
  'share-link': shareLink,
  'copy-code': () => copyText(store.formatFamilyCode(state.familyId), 'Código copiado'),
  'copy-shortcut': () => copyText(shortcutBase(), 'Copiado'),
  'check-videos': () => checkVideos(),
  'new-folder': newFolder,
  'new-profile': newProfile,
};

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  addFromInput($('add-input').value);
});
