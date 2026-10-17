// Reglas de la app sin interfaz: perfiles, carpetas, qué videos ve cada
// perfil y si ahora mismo puede ver videos (límite diario y horario).

export const DEFAULT_PROFILE = {
  id: 'p1',
  name: 'Mis videos',
  emoji: '🙂',
  limitMin: 0,
  schedule: { enabled: false, from: '17:00', to: '20:00' },
  autoplay: false,
};

export const PROFILE_EMOJIS = ['🙂', '🦁', '🐻', '🐼', '🐸', '🦄', '🐱', '🐶', '🦊', '🐵', '🚀', '⭐'];
export const FOLDER_EMOJIS = ['📁', '🦖', '🎵', '🔤', '🔢', '🚗', '🐾', '🎨', '🌍', '🧸', '⚽', '🌙'];
export const LIMIT_OPTIONS = [0, 15, 30, 45, 60, 90, 120, 180];

export function newId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

// Los datos antiguos no tienen perfiles: se usa uno por defecto.
export function getProfiles(data) {
  const list = data?.profiles?.length ? data.profiles : [DEFAULT_PROFILE];
  return list.map((p) => ({ ...DEFAULT_PROFILE, ...p, schedule: { ...DEFAULT_PROFILE.schedule, ...p.schedule } }));
}

export function getProfile(data, profileId) {
  const profiles = getProfiles(data);
  return profiles.find((p) => p.id === profileId) || profiles[0];
}

export function getFolders(data) {
  return data?.folders || [];
}

export function todayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function endOfDay(now = Date.now()) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isScheduledLater(video, now = Date.now()) {
  return Boolean(video.availableFrom && video.availableFrom > now);
}

export function isVisible(video, profileId, now = Date.now()) {
  if (video.broken || isScheduledLater(video, now)) return false;
  return !video.profiles?.length || video.profiles.includes(profileId);
}

export function visibleVideos(data, profileId, now = Date.now()) {
  return (data?.videos || []).filter((v) => isVisible(v, profileId, now));
}

function minutesOf(hhmm) {
  const [h, m] = (hhmm || '0:0').split(':').map(Number);
  return h * 60 + m;
}

export function inSchedule(schedule, date = new Date()) {
  if (!schedule?.enabled) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  const from = minutesOf(schedule.from);
  const to = minutesOf(schedule.to);
  // Un horario como 20:00–08:00 cruza la medianoche.
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

// ¿Puede el perfil ver videos ahora? `pending` son segundos aún no guardados.
export function accessStatus(profile, usage = {}, pending = 0, now = Date.now()) {
  if (usage.unlimited) return { blocked: null, remaining: null };
  const overridden = usage.overrideUntil && usage.overrideUntil > now;
  if (!overridden && !inSchedule(profile.schedule, new Date(now))) return { blocked: 'schedule', remaining: null };
  if (profile.limitMin > 0) {
    const allowance = profile.limitMin * 60 + (usage.bonusSeconds || 0);
    const remaining = allowance - (usage.seconds || 0) - pending;
    return remaining <= 0 ? { blocked: 'limit', remaining: 0 } : { blocked: null, remaining };
  }
  return { blocked: null, remaining: null };
}

export function formatMinutes(seconds) {
  const min = Math.round((seconds || 0) / 60);
  if (min === 0 && seconds > 0) return '<1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function formatDateTime(ms) {
  return new Date(ms).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function limitLabel(profile) {
  const parts = [];
  parts.push(profile.limitMin ? `${profile.limitMin} min al día` : 'Sin límite diario');
  if (profile.schedule.enabled) parts.push(`de ${profile.schedule.from} a ${profile.schedule.to}`);
  if (profile.autoplay) parts.push('reproducción continua');
  return parts.join(' · ');
}
