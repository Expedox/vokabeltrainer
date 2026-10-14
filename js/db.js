// IndexedDB wrapper. All data stays on the device.
//
// Stores
//   topics   { id, lang, grade, title, icon, builtin }
//   vocab    { id, topicId, term, translation, note, builtin }
//   profiles { id, name, avatar, grade, theme, dailyGoal, tasks: [topicId], created }
//   progress { key: "<profileId>|<vocabId>", profileId, vocabId, box, due, right, wrong, seen }
//   sessions { id, profileId, topicId, mode, start, end, answers, right, wrong, words: [vocabId] }
//   meta     { key, value }

const DB_NAME = 'vokabeltrainer';
const DB_VERSION = 2;

export const STORES = ['topics', 'vocab', 'profiles', 'progress', 'sessions', 'meta'];

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        const topics = db.createObjectStore('topics', { keyPath: 'id' });
        topics.createIndex('langGrade', ['lang', 'grade']);
        const vocab = db.createObjectStore('vocab', { keyPath: 'id' });
        vocab.createIndex('topicId', 'topicId');
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (e.oldVersion < 2) {
        // v1 progress had no profiles; nobody used it yet, so start fresh.
        if (db.objectStoreNames.contains('progress')) db.deleteObjectStore('progress');
        const progress = db.createObjectStore('progress', { keyPath: 'key' });
        progress.createIndex('profileId', 'profileId');
        db.createObjectStore('profiles', { keyPath: 'id' });
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('profileId', 'profileId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function get(name, key) {
  return done((await store(name)).get(key));
}

export async function all(name, index, query) {
  const s = await store(name);
  return done(index ? s.index(index).getAll(query) : s.getAll());
}

export async function put(name, value) {
  return done((await store(name, 'readwrite')).put(value));
}

export async function del(name, key) {
  return done((await store(name, 'readwrite')).delete(key));
}

export async function clear(name) {
  return done((await store(name, 'readwrite')).clear());
}

export async function putMany(name, values) {
  const tx = (await open()).transaction(name, 'readwrite');
  const s = tx.objectStore(name);
  for (const v of values) s.put(v);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeta(key, fallback) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  return put('meta', { key, value });
}

export function topicsFor(lang, grade) {
  return all('topics', 'langGrade', [lang, grade]);
}

export function vocabFor(topicId) {
  return all('vocab', 'topicId', topicId);
}

// Ask the browser not to evict our data under storage pressure.
export async function persist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
