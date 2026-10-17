// Estado compartido entre la pantalla del niño (app.js) y el modo padre (parent.js).

import { toast } from './ui.js';

export const state = {
  familyId: null,
  store: null,
  data: null,
  unsubscribe: null,
  profileId: null, // perfil activo en este dispositivo
  folderId: null, // carpeta abierta en la pantalla del niño
  usage: {}, // uso de hoy del perfil activo, tal como está guardado
  usageDate: null,
  usageUnsubscribe: null,
  pendingSeconds: 0, // segundos vistos aún sin guardar
  usageDenied: false, // las reglas de Firebase no permiten guardar el uso
  pendingShare: null, // enlace compartido desde otra app, pendiente de añadir
  pasteRequest: false, // el atajo de iPhone copió un enlace para pegarlo
  shareProblem: null, // texto compartido que no es un enlace de YouTube
};

export function updateData(fn) {
  return state.store.update((d) => fn(d)).catch((err) => {
    console.error(err);
    toast('No se pudo guardar el cambio. Revisa la conexión.');
    throw err;
  });
}

export function updateVideos(fn) {
  return updateData((d) => ({ ...d, videos: fn(d.videos || []) }));
}

export function usageError(err) {
  console.error(err);
  if (err?.code === 'permission-denied') state.usageDenied = true;
}
