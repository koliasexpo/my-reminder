// Καταχωρήσεις ημερολογίου, σχόλια με αρχεία, ειδοποιήσεις.
import { extname } from '../path.js';
import { db, tx, putFile, dropFile } from '../db.js';
import { bad, notFound } from '../http.js';
import { addMonths, daysBetween, isDate, today } from '../dates.js';

const REPEATS = ['none', 'monthly', 'yearly'];
const CHECK_EVERY_MS = 10 * 60 * 1000;
const MAX_FILE = 25 * 1024 * 1024;

function clean(b) {
  const title = String(b.title ?? '').trim();
  if (!title) throw bad('Γράψε τίτλο.');
  if (!isDate(b.date)) throw bad('Διάλεξε έγκυρη ημερομηνία.');
  const time = b.time ? String(b.time) : '';
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw bad('Η ώρα πρέπει να είναι της μορφής 14:30.');
  const repeat = b.repeat ?? 'none';
  if (!REPEATS.includes(repeat)) throw bad('Μη έγκυρη επανάληψη.');
  const remind = [...new Set((b.remind ?? [30, 7, 1, 0]).map(Number))];
  if (remind.some((n) => !Number.isInteger(n) || n < 0 || n > 730)) throw bad('Οι υπενθυμίσεις μετρούν μέρες από 0 έως 730.');
  const cents = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 0) throw bad('Τα ποσά πρέπει να είναι θετικοί αριθμοί.');
    return n;
  };
  return {
    hasIncome: b.hasIncome ? 1 : 0, incomeSource: String(b.incomeSource ?? '').trim(),
    incomeWhat: String(b.incomeWhat ?? '').trim(), incomeAccountId: b.incomeAccountId ? Number(b.incomeAccountId) : null,
    location: String(b.location ?? '').trim(), phone: String(b.phone ?? '').trim(),
    doneActions: String(b.doneActions ?? '').trim(), todoActions: String(b.todoActions ?? '').trim(),
    costCents: cents(b.costCents), depositCents: cents(b.depositCents),
    title, date: b.date, time, repeat,
    category: String(b.category ?? '').trim() || 'Άλλο',
    notes: String(b.notes ?? '').trim(),
    remind: JSON.stringify(remind.sort((x, y) => y - x)),
  };
}

const row = (r) => r && {
  ...r, remind: JSON.parse(r.remind), done: !!r.done,
  doneActions: r.done_actions, todoActions: r.todo_actions, costCents: r.cost_cents, depositCents: r.deposit_cents,
  hasIncome: !!r.has_income, incomeSource: r.income_source, incomeWhat: r.income_what, incomeAccountId: r.income_account_id,
};
const LIST = `SELECT e.*, (SELECT COUNT(*) FROM comments c WHERE c.entry_id = e.id) AS comment_count FROM entries e`;
const get = (id) => row(db.prepare(`${LIST} WHERE e.id = ?`).get(id));
function must(id) { const e = get(id); if (!e) throw notFound('Η καταχώρηση δεν υπάρχει πια.'); return e; }

// Το ταμείο ακούει εδώ, ώστε οι καταχωρήσεις να μην εξαρτώνται από αυτό.
export const entryDeleted = new Set();
export const getEntry = must;

// Καταχωρήσεις με έσοδα έως και το τέλος αυτού του μήνα. Το ταμείο αφαιρεί όσα έχουν εισπραχθεί.
export const EVENT_CATEGORY = 'Γάμος/Event';
export function eventsUntil(date) {
  return db.prepare(`SELECT id, title, date, category, income_source AS incomeSource, cost_cents AS costCents, deposit_cents AS depositCents
    FROM entries WHERE has_income = 1 AND date <= ? ORDER BY date`).all(date);
}

function insert(e) {
  const r = db.prepare(`INSERT INTO entries (title, date, time, category, notes, remind, repeat,
      location, phone, done_actions, todo_actions, cost_cents, deposit_cents, has_income, income_source, income_what, income_account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.title, e.date, e.time, e.category, e.notes, e.remind, e.repeat,
    e.location, e.phone, e.doneActions, e.todoActions, e.costCents, e.depositCents, e.hasIncome, e.incomeSource, e.incomeWhat, e.incomeAccountId);
  return Number(r.lastInsertRowid);
}

// Για κάθε ανοιχτή καταχώρηση βγαίνει μόνο η πιο πρόσφατη υπενθύμιση που έχει έρθει η ώρα της,
// ώστε μια εισαγωγή Excel να μη γεμίζει το καμπανάκι με παλιές ειδοποιήσεις.
export function checkReminders(now = today()) {
  const add = db.prepare(`INSERT OR IGNORE INTO notifications (entry_id, due_date, offset_days) VALUES (?, ?, ?)`);
  for (const r of db.prepare(`SELECT id, date, remind FROM entries WHERE done = 0`).all()) {
    const left = daysBetween(now, r.date);
    const due = JSON.parse(r.remind).filter((o) => o >= left);
    if (due.length) add.run(r.id, r.date, Math.min(...due));
  }
}

// Έξοδα από το Ταμείο: μπαίνουν στο ημερολόγιο ως ολοκληρωμένα, χωρίς υπενθυμίσεις.
export const EXPENSE_CATEGORY = 'Έξοδο';
export function addExpenseEntry({ title, date, notes }) {
  const id = insert(clean({ title, date, notes, category: EXPENSE_CATEGORY, remind: [] }));
  db.prepare(`UPDATE entries SET done = 1 WHERE id = ?`).run(id);
  return id;
}
export function updateExpenseEntry(id, { title, date, notes }) {
  return db.prepare(`UPDATE entries SET title = ?, date = ?, notes = ? WHERE id = ?`).run(title, date, notes, id).changes > 0;
}
export function removeEntry(id) {
  db.prepare(`DELETE FROM entries WHERE id = ?`).run(id);
}

function changed(id) {
  db.prepare(`DELETE FROM notifications WHERE entry_id = ? AND read_at IS NULL`).run(id);
  checkReminders();
}

function saveFile(c) {
  const bin = atob(String(c.data));
  const buf = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  if (buf.length > MAX_FILE) throw bad('Το αρχείο ξεπερνά το όριο των 25 MB.');
  const stored = crypto.randomUUID() + extname(String(c.fileName)).toLowerCase().replace(/[^.\w]/g, '');
  putFile(stored, buf);
  return stored;
}
const removeFile = dropFile;

export default {
  init(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Άλλο', notes TEXT NOT NULL DEFAULT '',
        remind TEXT NOT NULL DEFAULT '[30,7,1,0]', repeat TEXT NOT NULL DEFAULT 'none',
        done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        body TEXT NOT NULL DEFAULT '', file_name TEXT, file_mime TEXT, file_stored TEXT, extract_note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        due_date TEXT NOT NULL, offset_days INTEGER NOT NULL, read_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (entry_id, due_date, offset_days));`);
    const cols = database.prepare(`PRAGMA table_info(entries)`).all().map((c) => c.name);
    const added = { location: `TEXT NOT NULL DEFAULT ''`, phone: `TEXT NOT NULL DEFAULT ''`, done_actions: `TEXT NOT NULL DEFAULT ''`,
      todo_actions: `TEXT NOT NULL DEFAULT ''`, cost_cents: 'INTEGER', deposit_cents: 'INTEGER',
      has_income: 'INTEGER NOT NULL DEFAULT 0', income_source: `TEXT NOT NULL DEFAULT ''`, income_what: `TEXT NOT NULL DEFAULT ''`, income_account_id: 'INTEGER' };
    for (const [name, type] of Object.entries(added)) {
      if (!cols.includes(name)) database.exec(`ALTER TABLE entries ADD COLUMN ${name} ${type};`);
    }
    // Όσες καταχωρήσεις είχαν ήδη έσοδα, όταν προστέθηκε το "Έχει έσοδα".
    if (!cols.includes('has_income')) {
      database.prepare(`UPDATE entries SET has_income = 1, income_source = 'Events' WHERE category = ?`).run(EVENT_CATEGORY);
      database.exec(`UPDATE entries SET has_income = 1, income_source = 'Support Now' WHERE category = 'Support Now';`);
    }
    checkReminders();
    // Στο κινητό ο έλεγχος γίνεται σε κάθε ανανέωση των ειδοποιήσεων (κάθε λεπτό).
  },

  routes(route) {
    route('GET', '/api/entries', () => db.prepare(`${LIST} ORDER BY e.date, e.time, e.id`).all().map(row));
    route('POST', '/api/entries', ({ body }) => { const id = insert(clean(body)); changed(id); return get(id); });
    route('POST', '/api/entries/bulk', ({ body }) => {
      const items = (body.items ?? []).map(clean);
      const n = tx(() => { items.forEach(insert); return items.length; });
      checkReminders();
      return { imported: n };
    });
    route('GET', '/api/entries/:id', ({ params }) => must(params.id));
    route('PUT', '/api/entries/:id', ({ params, body }) => {
      must(params.id);
      const e = clean(body);
      db.prepare(`UPDATE entries SET title=?, date=?, time=?, category=?, notes=?, remind=?, repeat=?,
          location=?, phone=?, done_actions=?, todo_actions=?, cost_cents=?, deposit_cents=?,
          has_income=?, income_source=?, income_what=?, income_account_id=? WHERE id=?`)
        .run(e.title, e.date, e.time, e.category, e.notes, e.remind, e.repeat,
          e.location, e.phone, e.doneActions, e.todoActions, e.costCents, e.depositCents,
          e.hasIncome, e.incomeSource, e.incomeWhat, e.incomeAccountId, params.id);
      changed(params.id);
      return get(params.id);
    });
    route('DELETE', '/api/entries/:id', ({ params }) => {
      const files = db.prepare(`SELECT file_stored FROM comments WHERE entry_id = ?`).all(params.id);
      db.prepare(`DELETE FROM entries WHERE id = ?`).run(params.id);
      entryDeleted.forEach((fn) => fn(Number(params.id)));
      files.forEach((f) => removeFile(f.file_stored));
      return { ok: true };
    });
    // Με επανάληψη η ημερομηνία πάει στην επόμενη φορά και μένει ιστορικό στα σχόλια.
    route('POST', '/api/entries/:id/done', ({ params, body }) => {
      const e = must(params.id);
      if (body.done === false) db.prepare(`UPDATE entries SET done = 0 WHERE id = ?`).run(e.id);
      else if (e.repeat === 'none') db.prepare(`UPDATE entries SET done = 1 WHERE id = ?`).run(e.id);
      else {
        const next = addMonths(e.date, e.repeat === 'yearly' ? 12 : 1);
        const [y, m, d] = e.date.split('-');
        tx(() => {
          db.prepare(`UPDATE entries SET date = ? WHERE id = ?`).run(next, e.id);
          db.prepare(`INSERT INTO comments (entry_id, body) VALUES (?, ?)`).run(e.id, `Ολοκληρώθηκε για ${d}/${m}/${y}.`);
        });
      }
      changed(e.id);
      return get(e.id);
    });

    route('GET', '/api/entries/:id/comments', ({ params }) =>
      db.prepare(`SELECT id, entry_id, body, file_name, file_mime, extract_note, created_at FROM comments
                  WHERE entry_id = ? ORDER BY id DESC`).all(params.id));
    route('POST', '/api/entries/:id/comments', ({ params, body }) => {
      must(params.id);
      const text = String(body.body ?? '').trim();
      const hasFile = body.fileName && body.data;
      if (!text && !hasFile) throw bad('Γράψε ένα σχόλιο ή διάλεξε αρχείο.');
      const stored = hasFile ? saveFile(body) : null;
      const r = db.prepare(`INSERT INTO comments (entry_id, body, file_name, file_mime, file_stored, extract_note)
        VALUES (?, ?, ?, ?, ?, ?)`).run(params.id, text, hasFile ? String(body.fileName) : null,
        hasFile ? String(body.fileMime || '') : null, stored, body.extractNote ? String(body.extractNote) : null);
      return { id: Number(r.lastInsertRowid) };
    });
    route('DELETE', '/api/comments/:id', ({ params }) => {
      const c = db.prepare(`SELECT file_stored FROM comments WHERE id = ?`).get(params.id);
      db.prepare(`DELETE FROM comments WHERE id = ?`).run(params.id);
      removeFile(c?.file_stored);
      return { ok: true };
    });
    route('GET', '/api/notifications', () => {
      checkReminders();
      return db.prepare(`SELECT n.id, n.entry_id, n.due_date, n.offset_days, n.read_at, e.title, e.date, e.category
        FROM notifications n JOIN entries e ON e.id = n.entry_id
        ORDER BY n.read_at IS NOT NULL, n.id DESC LIMIT 50`).all();
    });
    route('POST', '/api/notifications/read', ({ body }) => {
      const stamp = `UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL`;
      if (body.id) db.prepare(`${stamp} AND id = ?`).run(body.id);
      else db.prepare(stamp).run();
      return { ok: true };
    });
  },
};

