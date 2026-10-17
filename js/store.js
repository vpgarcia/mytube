// Almacenamiento de la "familia" y del uso diario.
// Con Firebase configurado se sincroniza en tiempo real entre dispositivos;
// sin él, se guarda solo en este dispositivo (localStorage).
//
// Documento de la familia (families/{código}):
//   { pinHash, videos: [...], folders: [...], profiles: [...], updatedAt }
// Uso diario (families/{código}/usage/{perfil}_{AAAA-MM-DD}):
//   { profileId, date, seconds, bonusSeconds, overrideUntil, unlimited,
//     history: [{ videoId, title, at, seconds }] }

import { firebaseConfig } from './config.js';

const FIREBASE_VERSION = '10.12.2';
const DEVICE_KEY = 'mytube:device';
const LOCAL_KEY = 'mytube:local';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 16;

export const syncEnabled = Boolean(firebaseConfig);

export function getDevice() {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY)) || {};
  } catch {
    return {};
  }
}

export function setDevice(device) {
  localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
}

export function updateDevice(changes) {
  setDevice({ ...getDevice(), ...changes });
}

export function newFamilyCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizeFamilyCode(input) {
  const code = (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === CODE_LENGTH ? code : null;
}

export function formatFamilyCode(code) {
  return code.match(/.{1,4}/g).join('-');
}

export async function hashPin(familyId, pin) {
  const data = new TextEncoder().encode(`mytube:${familyId}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

class LocalStore {
  constructor() {
    this.listeners = new Set();
    this.usageListeners = new Map();
    window.addEventListener('storage', (e) => {
      if (e.key === LOCAL_KEY) this.emit();
      else if (e.key && this.usageListeners.has(e.key)) this.emitUsage(e.key);
    });
  }

  emit() {
    const data = readJson(LOCAL_KEY);
    this.listeners.forEach((cb) => cb(data));
  }

  subscribe(cb) {
    this.listeners.add(cb);
    cb(readJson(LOCAL_KEY));
    return () => this.listeners.delete(cb);
  }

  async exists() {
    return readJson(LOCAL_KEY) !== null;
  }

  async create(data) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...data, updatedAt: Date.now() }));
    this.emit();
  }

  async update(fn) {
    const next = fn(readJson(LOCAL_KEY));
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...next, updatedAt: Date.now() }));
    this.emit();
  }

  // ---- Uso diario ----

  usageKey(profileId, date) {
    return `mytube:usage:${profileId}:${date}`;
  }

  emitUsage(key) {
    const data = readJson(key) || {};
    (this.usageListeners.get(key) || new Set()).forEach((cb) => cb(data));
  }

  changeUsage(profileId, date, fn) {
    const key = this.usageKey(profileId, date);
    const current = readJson(key) || { profileId, date };
    localStorage.setItem(key, JSON.stringify(fn(current)));
    this.emitUsage(key);
  }

  subscribeUsage(profileId, date, cb) {
    const key = this.usageKey(profileId, date);
    if (!this.usageListeners.has(key)) this.usageListeners.set(key, new Set());
    this.usageListeners.get(key).add(cb);
    cb(readJson(key) || {});
    return () => this.usageListeners.get(key).delete(cb);
  }

  async getUsage(profileId, date) {
    return readJson(this.usageKey(profileId, date)) || {};
  }

  async addUsage(profileId, date, seconds) {
    this.changeUsage(profileId, date, (u) => ({ ...u, seconds: (u.seconds || 0) + seconds }));
  }

  async addHistory(profileId, date, entry) {
    this.changeUsage(profileId, date, (u) => ({ ...u, history: [...(u.history || []), entry].slice(-300) }));
  }

  async grantUsage(profileId, date, { bonusSeconds = 0, overrideUntil, unlimited }) {
    this.changeUsage(profileId, date, (u) => ({
      ...u,
      bonusSeconds: (u.bonusSeconds || 0) + bonusSeconds,
      ...(overrideUntil !== undefined ? { overrideUntil } : {}),
      ...(unlimited !== undefined ? { unlimited } : {}),
    }));
  }
}

let firebasePromise = null;

function loadFirebase() {
  if (!firebasePromise) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    firebasePromise = Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-firestore.js`),
    ]).then(([app, firestore]) => {
      const fbApp = app.initializeApp(firebaseConfig);
      let db;
      try {
        db = firestore.initializeFirestore(fbApp, { localCache: firestore.persistentLocalCache() });
      } catch {
        db = firestore.getFirestore(fbApp);
      }
      return { db, fs: firestore };
    });
  }
  return firebasePromise;
}

class FirebaseStore {
  constructor(familyId) {
    this.familyId = familyId;
  }

  async ref() {
    const { db, fs } = await loadFirebase();
    return { db, fs, ref: fs.doc(db, 'families', this.familyId) };
  }

  async usageRef(profileId, date) {
    const { db, fs } = await loadFirebase();
    return { fs, ref: fs.doc(db, 'families', this.familyId, 'usage', `${profileId}_${date}`) };
  }

  listen(refPromise, cb, onError, skipMissingFromCache) {
    let unsubscribe = () => {};
    let cancelled = false;
    refPromise
      .then(({ fs, ref }) => {
        if (cancelled) return;
        unsubscribe = fs.onSnapshot(
          ref,
          (snap) => {
            // La caché offline puede no tener aún el documento: esperamos al servidor.
            if (skipMissingFromCache && !snap.exists() && snap.metadata.fromCache) return;
            cb(snap.exists() ? snap.data() : null);
          },
          (err) => onError && onError(err),
        );
      })
      .catch((err) => onError && onError(err));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }

  subscribe(cb, onError) {
    return this.listen(this.ref(), cb, onError, true);
  }

  async exists() {
    const { fs, ref } = await this.ref();
    const snap = await fs.getDoc(ref);
    return snap.exists();
  }

  async create(data) {
    const { fs, ref } = await this.ref();
    await fs.setDoc(ref, { ...data, updatedAt: Date.now() });
  }

  async update(fn) {
    const { db, fs, ref } = await this.ref();
    await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const next = fn(snap.exists() ? snap.data() : null);
      tx.set(ref, { ...next, updatedAt: Date.now() });
    });
  }

  // ---- Uso diario ----

  subscribeUsage(profileId, date, cb, onError) {
    return this.listen(this.usageRef(profileId, date), (data) => cb(data || {}), onError, false);
  }

  async getUsage(profileId, date) {
    const { fs, ref } = await this.usageRef(profileId, date);
    const snap = await fs.getDoc(ref);
    return snap.exists() ? snap.data() : {};
  }

  async mergeUsage(profileId, date, fields) {
    const { fs, ref } = await this.usageRef(profileId, date);
    await fs.setDoc(ref, { profileId, date, ...fields(fs) }, { merge: true });
  }

  addUsage(profileId, date, seconds) {
    return this.mergeUsage(profileId, date, (fs) => ({ seconds: fs.increment(seconds) }));
  }

  addHistory(profileId, date, entry) {
    return this.mergeUsage(profileId, date, (fs) => ({ history: fs.arrayUnion(entry) }));
  }

  grantUsage(profileId, date, { bonusSeconds = 0, overrideUntil, unlimited }) {
    return this.mergeUsage(profileId, date, (fs) => ({
      bonusSeconds: fs.increment(bonusSeconds),
      ...(overrideUntil !== undefined ? { overrideUntil } : {}),
      ...(unlimited !== undefined ? { unlimited } : {}),
    }));
  }
}

export function openStore(familyId) {
  return syncEnabled ? new FirebaseStore(familyId) : new LocalStore();
}
