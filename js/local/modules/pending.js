// Εκκρεμότητες. Το ταμείο διαβάζει μόνο το openTotals().
import { db } from '../db.js';
import { bad, notFound } from '../http.js';
import { isDate } from '../dates.js';

function clean(b) {
  const title = String(b.title ?? '').trim();
  if (!title) throw bad('Γράψε τι εκκρεμεί.');
  const amount = b.amountCents === null || b.amountCents === undefined || b.amountCents === '' ? null : Number(b.amountCents);
  if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) throw bad('Το ποσό πρέπει να είναι θετικός αριθμός.');
  const kind = b.kind ?? 'pay';
  if (!['pay', 'collect', 'none'].includes(kind)) throw bad('Μη έγκυρος τύπος.');
  const due = b.dueDate || '';
  if (due && !isDate(due)) throw bad('Μη έγκυρη ημερομηνία.');
  return { title, amount: kind === 'none' ? null : amount, kind, due, notes: String(b.notes ?? '').trim() };
}

const shape = (r) => r && {
  id: r.id, title: r.title, amountCents: r.amount_cents, kind: r.kind, dueDate: r.due_date,
  notes: r.notes, done: !!r.done, createdAt: r.created_at,
  settledAccountId: r.settled_account_id, settledCents: r.settled_cents,
};
function must(id) {
  const r = db.prepare(`SELECT * FROM pending WHERE id = ?`).get(id);
  if (!r) throw notFound('Η εκκρεμότητα δεν υπάρχει πια.');
  return r;
}

export function openTotals() {
  const r = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN kind = 'pay' THEN amount_cents END), 0) AS pay,
    COALESCE(SUM(CASE WHEN kind = 'collect' THEN amount_cents END), 0) AS collect
    FROM pending WHERE done = 0`).get();
  return { payCents: r.pay, collectCents: r.collect };
}

// Το ταμείο καλεί αυτά τα δύο για να κλείσει ή να ξανανοίξει μια εκκρεμότητα με κίνηση λογαριασμού.
export function getPending(id) { return shape(must(id)); }
export function setSettled(id, accountId, cents) {
  db.prepare(`UPDATE pending SET done = ?, settled_account_id = ?, settled_cents = ? WHERE id = ?`)
    .run(accountId === null ? 0 : 1, accountId, cents, id);
}

export function openItems() {
  return db.prepare(`SELECT title, kind, due_date AS dueDate, amount_cents AS amountCents FROM pending
    WHERE done = 0 AND amount_cents > 0 ORDER BY due_date = '', due_date, id`).all();
}

export function createPending(body) {
  const p = clean(body);
  const r = db.prepare(`INSERT INTO pending (title, amount_cents, kind, due_date, notes) VALUES (?, ?, ?, ?, ?)`)
    .run(p.title, p.amount, p.kind, p.due, p.notes);
  return getPending(Number(r.lastInsertRowid));
}

// Για το ιστορικό του ταμείου: όσες έκλεισαν με κίνηση λογαριασμού.
export function listSettled() {
  return db.prepare(`SELECT id, title, settled_account_id AS accountId, settled_cents AS cents,
    date(created_at, 'localtime') AS date FROM pending WHERE settled_account_id IS NOT NULL`).all();
}

export default {
  init(database) {
    database.exec(`CREATE TABLE IF NOT EXISTS pending (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, amount_cents INTEGER, kind TEXT NOT NULL DEFAULT 'pay',
      due_date TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    const cols = database.prepare(`PRAGMA table_info(pending)`).all().map((c) => c.name);
    if (!cols.includes('settled_account_id')) {
      database.exec(`ALTER TABLE pending ADD COLUMN settled_account_id INTEGER;
                     ALTER TABLE pending ADD COLUMN settled_cents INTEGER;`);
    }
  },
  routes(route) {
    route('GET', '/api/pending', () =>
      db.prepare(`SELECT * FROM pending ORDER BY done, due_date = '', due_date, id DESC`).all().map(shape));
    route('POST', '/api/pending', ({ body }) => createPending(body));
    route('PUT', '/api/pending/:id', ({ params, body }) => {
      must(params.id);
      const p = clean(body);
      db.prepare(`UPDATE pending SET title=?, amount_cents=?, kind=?, due_date=?, notes=? WHERE id=?`)
        .run(p.title, p.amount, p.kind, p.due, p.notes, params.id);
      return shape(must(params.id));
    });
    route('POST', '/api/pending/:id/done', ({ params, body }) => {
      must(params.id);
      db.prepare(`UPDATE pending SET done = ? WHERE id = ?`).run(body.done === false ? 0 : 1, params.id);
      return shape(must(params.id));
    });
    route('DELETE', '/api/pending/:id', ({ params }) => {
      db.prepare(`DELETE FROM pending WHERE id = ?`).run(params.id);
      return { ok: true };
    });
  },
};
