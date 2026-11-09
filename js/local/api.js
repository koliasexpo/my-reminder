// Η «σύνδεση» με τον server: όλα τρέχουν τοπικά και η βάση σώζεται μετά από κάθε αλλαγή.
import { db, saveIfDirty, getFile } from './db.js';
import { createRouter } from './http.js';
import entries from './modules/entries.js';
import pending from './modules/pending.js';
import cashbox from './modules/cashbox.js';

const handle = createRouter([entries, pending, cashbox], db);
await saveIfDirty();

let queue = Promise.resolve();
export function localApi(method, url, body) {
  const job = queue.then(async () => {
    const out = await handle(method, url, body);
    try { await saveIfDirty(); }
    catch { return { status: 500, data: { error: 'Η αποθήκευση στο κινητό απέτυχε. Έλεγξε τον ελεύθερο χώρο.' } }; }
    return out;
  });
  queue = job.catch(() => {});
  return job;
}

export function commentFile(id) {
  const c = db.prepare(`SELECT file_name, file_stored FROM comments WHERE id = ?`).get(id);
  const data = c && getFile(c.file_stored);
  if (!data) throw new Error('Το αρχείο δεν βρέθηκε.');
  return { name: c.file_name, data };
}
