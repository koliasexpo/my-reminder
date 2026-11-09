// Η βάση SQLite τρέχει μέσα στο κινητό (sql.js) και σώζεται στον browser (IndexedDB).
// Μιμείται το DatabaseSync του Node, ώστε οι ενότητες του server να δουλεύουν όπως είναι.

const IDB_NAME = 'my-reminder';
const IDB_STORE = 'db';
const IDB_KEY = 'app.db';

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet() {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const r = d.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(bytes) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(IDB_STORE, 'readwrite');
    t.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

const SQL = await window.initSqlJs({ locateFile: (f) => new URL('../../vendor/sqljs/' + f, import.meta.url).href });

let raw;
let dirty = false;

function open(bytes) {
  raw?.close();
  raw = bytes ? new SQL.Database(bytes) : new SQL.Database();
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(`CREATE TABLE IF NOT EXISTS files (stored TEXT PRIMARY KEY, data BLOB NOT NULL);`);
}

const arg = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

function stmt(sql) {
  const run = (fn) => (...args) => {
    const s = raw.prepare(sql);
    try { s.bind(args.map(arg)); return fn(s); } finally { s.free(); }
  };
  return {
    get: run((s) => (s.step() ? s.getAsObject() : undefined)),
    all: run((s) => { const out = []; while (s.step()) out.push(s.getAsObject()); return out; }),
    run: run((s) => {
      while (s.step()) { /* INSERT ... RETURNING κ.λπ. */ }
      dirty = true;
      const changes = raw.getRowsModified();
      const lastInsertRowid = raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
      return { changes, lastInsertRowid };
    }),
  };
}

export const db = {
  prepare: stmt,
  exec(sql) { raw.exec(sql); dirty = true; },
};

export function tx(fn) {
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Αρχεία σχολίων: μένουν μέσα στην ίδια βάση, ώστε ένα αρχείο αντιγράφου να τα έχει όλα.
export function putFile(stored, bytes) { db.prepare(`INSERT OR REPLACE INTO files (stored, data) VALUES (?, ?)`).run(stored, bytes); }
export function dropFile(stored) { if (stored) db.prepare(`DELETE FROM files WHERE stored = ?`).run(stored); }
export function getFile(stored) { return stored ? db.prepare(`SELECT data FROM files WHERE stored = ?`).get(stored)?.data : undefined; }

export function exportBytes() {
  const bytes = raw.export();
  raw.exec('PRAGMA foreign_keys = ON;'); // το export() ξανανοίγει τη βάση
  return bytes;
}

let saving = Promise.resolve();
export function saveIfDirty() {
  if (!dirty) return saving;
  dirty = false;
  const bytes = exportBytes();
  saving = saving.then(() => idbPut(bytes)).catch((e) => { dirty = true; throw e; });
  return saving;
}

// Ελέγχει ότι το αρχείο είναι βάση του My Reminder και την αποθηκεύει στη θέση της τρέχουσας.
export async function replaceWith(bytes) {
  const head = new TextDecoder().decode(bytes.slice(0, 15));
  if (head !== 'SQLite format 3') throw new Error('Αυτό δεν είναι αρχείο βάσης του My Reminder.');
  const test = new SQL.Database(bytes);
  try {
    const t = test.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries'`);
    if (!t.length) throw new Error('Το αρχείο δεν έχει δεδομένα του My Reminder.');
  } finally { test.close(); }
  await saving;
  await idbPut(bytes);
}

open(await idbGet());
navigator.storage?.persist?.().catch(() => {});
