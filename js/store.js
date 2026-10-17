// Almacenamiento de la "familia": PIN del modo padre y lista de videos.
// Con Firebase configurado se sincroniza en tiempo real entre dispositivos;
// sin él, se guarda solo en este dispositivo (localStorage).
//
// Forma de los datos:
//   { pinHash: string, videos: [{ id, title, channel, addedAt }], updatedAt }

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

class LocalStore {
  constructor() {
    this.listeners = new Set();
    window.addEventListener('storage', (e) => {
      if (e.key === LOCAL_KEY) this.emit();
    });
  }

  read() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY));
    } catch {
      return null;
    }
  }

  emit() {
    const data = this.read();
    this.listeners.forEach((cb) => cb(data));
  }

  subscribe(cb) {
    this.listeners.add(cb);
    cb(this.read());
    return () => this.listeners.delete(cb);
  }

  async exists() {
    return this.read() !== null;
  }

  async create(data) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...data, updatedAt: Date.now() }));
    this.emit();
  }

  async update(fn) {
    const next = fn(this.read());
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...next, updatedAt: Date.now() }));
    this.emit();
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
    return { fs, ref: fs.doc(db, 'families', this.familyId) };
  }

  subscribe(cb, onError) {
    let unsubscribe = () => {};
    let cancelled = false;
    this.ref()
      .then(({ fs, ref }) => {
        if (cancelled) return;
        unsubscribe = fs.onSnapshot(
          ref,
          (snap) => {
            // La caché offline puede no tener aún el documento: esperamos al servidor.
            if (!snap.exists() && snap.metadata.fromCache) return;
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
    const { fs, ref } = await this.ref();
    const { db } = await loadFirebase();
    await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const next = fn(snap.exists() ? snap.data() : null);
      tx.set(ref, { ...next, updatedAt: Date.now() });
    });
  }
}

export function openStore(familyId) {
  return syncEnabled ? new FirebaseStore(familyId) : new LocalStore();
}
