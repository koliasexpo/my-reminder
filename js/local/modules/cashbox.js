// Ταμείο. Ανεξάρτητο από τα υπόλοιπα: εξαρτάται μόνο από το pending.js, ποτέ το αντίστροφο.
// Τα ποσά είναι πάντα ακέραια λεπτά, για να μη χάνονται δεκαδικά στις προσθέσεις.
// Κάθε κίνηση αλλάζει το υπόλοιπο του λογαριασμού της μέσα σε ένα transaction.
import { db, tx } from '../db.js';
import { bad, notFound } from '../http.js';
import { addDays, addMonths, isDate, today } from '../dates.js';
import { createPending, getPending, listSettled, openItems, openTotals, setSettled } from './pending.js';
import { addExpenseEntry, entryDeleted, eventsUntil, getEntry, removeEntry, updateExpenseEntry } from './entries.js';

const STAGES = { deposit: 'Προκαταβολή', final: 'Εξόφληση', payment: 'Είσπραξη' };
const DEFAULT_ACCOUNTS = ['Μετρητά', 'Alpha Bank', 'Eurobank Business', 'Eurobank Personal', 'Revolut', 'Payzy'];

// Κινήσεις με μελλοντική ημερομηνία: το αποθηκευμένο υπόλοιπο τις περιέχει ήδη, αλλά δεν έχουν γίνει ακόμη.
// Μέχρι να έρθει η μέρα τους δεν μετρούν στα διαθέσιμα και φαίνονται ως αναμενόμενες.
const futureMovements = () => db.prepare(`SELECT kind, amount_cents, account_id, description, category, date
  FROM cash_movements WHERE date > ? ORDER BY date`).all(today());
const futureOf = (accountId) => futureMovements().filter((m) => m.account_id === accountId).reduce((sum, m) => sum + delta(m), 0);

function summary() {
  const future = futureMovements();
  const accounts = db.prepare(`SELECT id, name, balance_cents AS balanceCents, updated_at AS updatedAt
    FROM cash_accounts WHERE archived = 0 ORDER BY sort_order, id`).all()
    .map((a) => ({ ...a, balanceCents: a.balanceCents - future.filter((m) => m.account_id === a.id).reduce((sum, m) => sum + delta(m), 0) }));
  const totalCents = accounts.reduce((s, a) => s + a.balanceCents, 0);
  const pending = openTotals();
  const sumFuture = (kind) => future.filter((m) => m.kind === kind).reduce((sum, m) => sum + m.amount_cents, 0);
  const events = expectedFromEvents();
  const payCents = pending.payCents + sumFuture('out');
  const collectCents = pending.collectCents + sumFuture('in') + events.reduce((sum, e) => sum + e.cents, 0);
  const expected = [...events,
    ...openItems().map((p) => ({ source: 'pending', kind: p.kind === 'pay' ? 'out' : 'in', title: p.title, date: p.dueDate, cents: p.amountCents })),
    ...future.map((m) => ({ source: 'movement', kind: m.kind, title: m.description || m.category || 'Κίνηση', date: m.date, cents: m.amount_cents }))];
  return { accounts, totalCents, payCents, collectCents, expected, projectedCents: totalCents - payCents + collectCents };
}

// Ό,τι απομένει να εισπραχθεί από γάμους και event μέχρι το τέλος του μήνα που τρέχει.
function expectedFromEvents() {
  const monthEnd = addDays(addMonths(`${today().slice(0, 7)}-01`, 1), -1);
  const collected = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM cash_movements WHERE entry_id = ?`);
  return eventsUntil(monthEnd).map((e) => ({
    source: 'event', kind: 'in', title: e.title, date: e.date, label: e.category === 'Γάμος/Event' ? 'Γάμος' : e.incomeSource || e.category,
    cents: Math.max((e.costCents ?? e.depositCents ?? 0) - collected.get(e.id).n, 0),
  })).filter((e) => e.cents > 0);
}

function move(accountId, deltaCents) {
  return db.prepare(`UPDATE cash_accounts SET balance_cents = balance_cents + ?, updated_at = datetime('now')
    WHERE id = ? AND archived = 0`).run(deltaCents, accountId).changes > 0;
}

const delta = (m) => (m.kind === 'in' ? m.amount_cents : -m.amount_cents);

function cleanMovement(b) {
  if (!isDate(b.date)) throw bad('Διάλεξε έγκυρη ημερομηνία.');
  if (!['in', 'out'].includes(b.kind)) throw bad('Διάλεξε έσοδο ή έξοδο.');
  const amount = Number(b.amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw bad('Το ποσό πρέπει να είναι θετικός αριθμός, π.χ. 120,50.');
  return { date: b.date, kind: b.kind, amount_cents: amount, account_id: Number(b.accountId),
    description: String(b.description ?? '').trim(), category: canonCategory(b.category) };
}

// Οι κατηγορίες φτιάχνονται μόνες τους από όσα γράφονται στις κινήσεις.
function categories() {
  return db.prepare(`SELECT DISTINCT category FROM cash_movements WHERE category <> ''`).all()
    .map((r) => r.category).sort((a, b) => a.localeCompare(b, 'el'));
}
// «ενοίκιο» και «Ενοίκιο» είναι η ίδια κατηγορία.
function canonCategory(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  const key = name.toLocaleLowerCase('el');
  return categories().find((c) => c.toLocaleLowerCase('el') === key) ?? name;
}

function editable(id) {
  const m = db.prepare(`SELECT * FROM cash_movements WHERE id = ?`).get(id);
  if (!m) throw notFound('Η κίνηση δεν υπάρχει πια.');
  if (m.pending_id) throw bad('Η κίνηση ήρθε από εκκρεμότητα. Άνοιξε ξανά την εκκρεμότητα για να αναιρεθεί.');
  if (m.entry_id) throw bad('Η κίνηση ήρθε από το Ημερολόγιο. Ξετσέκαρε την είσπραξη μέσα στην καταχώρηση για να αναιρεθεί.');
  return m;
}

const MOVEMENT_ROW = `SELECT m.id, m.date, m.kind, m.amount_cents AS amountCents, m.account_id AS accountId,
    m.description, m.note, m.category, m.pending_id AS pendingId, m.entry_id AS entryId, a.name AS accountName
  FROM cash_movements m LEFT JOIN cash_accounts a ON a.id = m.account_id`;

function dayOf(date) {
  const items = db.prepare(`${MOVEMENT_ROW} WHERE m.date = ? ORDER BY m.id DESC`).all(date);
  const sum = (k) => items.filter((m) => m.kind === k).reduce((s, m) => s + m.amountCents, 0);
  const inCents = sum('in'), outCents = sum('out');
  return { date, items, inCents, outCents, netCents: inCents - outCents };
}

// Κάθε χειροκίνητο έξοδο έχει και μία καταχώρηση στο ημερολόγιο, που ακολουθεί τις αλλαγές του.
const euros = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' });
function expenseEntry(m) {
  const account = db.prepare(`SELECT name FROM cash_accounts WHERE id = ?`).get(m.account_id);
  const amount = euros.format(m.amount_cents / 100);
  return { title: `${m.description || m.category || 'Έξοδο'} −${amount}`, date: m.date,
    notes: [m.category, account?.name].filter(Boolean).join(', ') };
}
function syncCalendar(movementId, m, linked) {
  const setLink = (id) => db.prepare(`UPDATE cash_movements SET calendar_entry_id = ? WHERE id = ?`).run(id, movementId);
  if (m.kind !== 'out') {
    if (linked) { removeEntry(linked); setLink(null); }
  } else if (!linked || !updateExpenseEntry(linked, expenseEntry(m))) {
    setLink(addExpenseEntry(expenseEntry(m)));
  }
}

const insertMovement = (m) => db.prepare(`INSERT INTO cash_movements (date, kind, amount_cents, account_id, description, note, category, pending_id, entry_id, stage)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(m.date, m.kind, m.amount_cents, m.account_id, m.description, m.note ?? '', m.category ?? '',
  m.pending_id ?? null, m.entry_id ?? null, m.stage ?? null);

function settle(p, accountId, note, category) {
  const cents = p.kind === 'pay' ? -p.amountCents : p.amountCents;
  if (!move(accountId, cents)) throw notFound('Ο λογαριασμός δεν υπάρχει πια.');
  setSettled(p.id, accountId, cents);
  insertMovement({ date: today(), kind: cents > 0 ? 'in' : 'out', amount_cents: p.amountCents,
    account_id: accountId, description: p.title, note: String(note ?? '').trim(), category: canonCategory(category), pending_id: p.id });
}

const stageOf = (entryId, stage) => db.prepare(`SELECT m.id, m.date, m.amount_cents AS amountCents, m.note, m.category, m.account_id AS accountId,
    a.name AS accountName FROM cash_movements m LEFT JOIN cash_accounts a ON a.id = m.account_id
  WHERE m.entry_id = ? AND m.stage = ?`).get(entryId, stage) ?? null;

function eventPayments(entryId) {
  const stages = Object.fromEntries(Object.keys(STAGES).map((s) => [s, stageOf(entryId, s)]));
  const collectedCents = Object.values(stages).reduce((sum, m) => sum + (m?.amountCents ?? 0), 0);
  return { ...stages, collectedCents };
}

export default {
  init(database) {
    database.exec(`CREATE TABLE IF NOT EXISTS cash_accounts (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, balance_cents INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT);`);
    // Ο λογαριασμός που διαγράφεται κρύβεται, ώστε οι παλιές κινήσεις να κρατούν το όνομά του.
    if (!database.prepare(`PRAGMA table_info(cash_accounts)`).all().some((c) => c.name === 'archived')) {
      database.exec(`ALTER TABLE cash_accounts ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`);
    }
    // Εφάπαξ: επαναφορά του Alpha Bank με μηδενικό υπόλοιπο. Το user_version εμποδίζει να ξανατρέξει,
    // ώστε μια μελλοντική διαγραφή του να μείνει διαγραφή.
    if (database.prepare(`PRAGMA user_version`).get().user_version < 1) {
      database.exec(`UPDATE cash_accounts SET archived = 0, balance_cents = 0 WHERE name = 'Alpha Bank' AND archived = 1;
                     PRAGMA user_version = 1;`);
    }
    if (!database.prepare(`SELECT COUNT(*) AS n FROM cash_accounts`).get().n) {
      const add = database.prepare(`INSERT INTO cash_accounts (name, sort_order) VALUES (?, ?)`);
      DEFAULT_ACCOUNTS.forEach((name, i) => add.run(name, i));
    }
    const fresh = !database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cash_movements'`).get();
    database.exec(`CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), account_id INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '', pending_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE INDEX IF NOT EXISTS cash_movements_date ON cash_movements (date);`);
    const cols = database.prepare(`PRAGMA table_info(cash_movements)`).all().map((c) => c.name);
    const added = { note: `TEXT NOT NULL DEFAULT ''`, entry_id: 'INTEGER', stage: 'TEXT', category: `TEXT NOT NULL DEFAULT ''`, calendar_entry_id: 'INTEGER' };
    for (const [name, type] of Object.entries(added)) {
      if (!cols.includes(name)) database.exec(`ALTER TABLE cash_movements ADD COLUMN ${name} ${type};`);
    }
    database.exec(`UPDATE cash_movements SET category = (SELECT e.category FROM entries e WHERE e.id = cash_movements.entry_id)
      WHERE category = '' AND entry_id IS NOT NULL AND entry_id IN (SELECT id FROM entries);`);
    // Αν διαγραφεί event, τα χρήματα που μπήκαν μένουν στο ταμείο ως απλή κίνηση.
    entryDeleted.add((id) => {
      db.prepare(`UPDATE cash_movements SET entry_id = NULL, stage = NULL WHERE entry_id = ?`).run(id);
      db.prepare(`UPDATE cash_movements SET calendar_entry_id = NULL WHERE calendar_entry_id = ?`).run(id);
    });
    // Εφάπαξ: όσα χειροκίνητα έξοδα γράφτηκαν πριν συνδεθεί το ταμείο με το ημερολόγιο.
    if (database.prepare(`PRAGMA user_version`).get().user_version < 2) {
      for (const m of database.prepare(`SELECT * FROM cash_movements WHERE kind = 'out' AND pending_id IS NULL
          AND entry_id IS NULL AND calendar_entry_id IS NULL`).all()) syncCalendar(m.id, m, null);
      database.exec(`PRAGMA user_version = 2;`);
    }
    // Εφάπαξ: οι εισπράξεις events ακολουθούν τις νέες πηγές εσόδων.
    if (database.prepare(`PRAGMA user_version`).get().user_version < 3) {
      database.exec(`UPDATE cash_movements SET category = 'Events' WHERE category = 'Γάμος/Event' AND entry_id IS NOT NULL;
                     PRAGMA user_version = 3;`);
    }
    // Οι εκκρεμότητες που έκλεισαν πριν υπάρξουν κινήσεις μπαίνουν στο ιστορικό. Τα υπόλοιπα δεν αλλάζουν.
    if (fresh) {
      for (const p of listSettled()) {
        if (!database.prepare(`SELECT 1 FROM cash_accounts WHERE id = ?`).get(p.accountId)) continue;
        insertMovement({ date: p.date, kind: p.cents > 0 ? 'in' : 'out', amount_cents: Math.abs(p.cents),
          account_id: p.accountId, description: p.title, pending_id: p.id });
      }
    }
  },

  routes(route) {
    route('GET', '/api/cashbox', summary);
    route('PUT', '/api/cashbox/accounts/:id', ({ params, body }) => {
      const cents = Number(body.balanceCents);
      if (!Number.isSafeInteger(cents)) throw bad('Μη έγκυρο ποσό.');
      const r = db.prepare(`UPDATE cash_accounts SET balance_cents = ?, updated_at = datetime('now') WHERE id = ? AND archived = 0`)
        .run(cents + futureOf(Number(params.id)), params.id);
      if (!r.changes) throw notFound('Ο λογαριασμός δεν υπάρχει πια.');
      return summary();
    });

    route('GET', '/api/cashbox/categories', categories);
    route('GET', '/api/cashbox/report', ({ query }) => {
      const month = query.get('month') ?? '';
      if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Μη έγκυρος μήνας.');
      const rows = db.prepare(`SELECT category,
          COALESCE(SUM(CASE WHEN kind = 'in' THEN amount_cents END), 0) AS inCents,
          COALESCE(SUM(CASE WHEN kind = 'out' THEN amount_cents END), 0) AS outCents
        FROM cash_movements WHERE substr(date, 1, 7) = ? GROUP BY category`).all(month);
      return { month, rows: rows.sort((a, b) => (b.inCents + b.outCents) - (a.inCents + a.outCents)) };
    });
    route('GET', '/api/cashbox/movements', ({ query }) => {
      const month = query.get('month');
      if (month) {
        if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Μη έγκυρος μήνας.');
        return { month, items: db.prepare(`${MOVEMENT_ROW} WHERE substr(m.date, 1, 7) = ? ORDER BY m.date DESC, m.id DESC`).all(month) };
      }
      const date = query.get('date') || today();
      if (!isDate(date)) throw bad('Διάλεξε έγκυρη ημερομηνία.');
      return dayOf(date);
    });
    route('POST', '/api/cashbox/movements', ({ body }) => {
      const m = cleanMovement(body);
      tx(() => {
        if (!move(m.account_id, delta(m))) throw notFound('Ο λογαριασμός δεν υπάρχει πια.');
        syncCalendar(Number(insertMovement(m).lastInsertRowid), m, null);
      });
      return { ok: true };
    });
    route('PUT', '/api/cashbox/movements/:id', ({ params, body }) => {
      const old = editable(params.id);
      const m = cleanMovement(body);
      tx(() => {
        if (!move(old.account_id, -delta(old))) throw bad('Ο λογαριασμός της κίνησης έχει διαγραφεί. Διέγραψε την κίνηση και γράψε νέα.');
        if (!move(m.account_id, delta(m))) throw notFound('Ο λογαριασμός δεν υπάρχει πια.');
        db.prepare(`UPDATE cash_movements SET date=?, kind=?, amount_cents=?, account_id=?, description=?, category=? WHERE id=?`)
          .run(m.date, m.kind, m.amount_cents, m.account_id, m.description, m.category, old.id);
        syncCalendar(old.id, m, old.calendar_entry_id);
      });
      return { ok: true };
    });
    route('DELETE', '/api/cashbox/movements/:id', ({ params }) => {
      const old = editable(params.id);
      const restored = tx(() => {
        const ok = move(old.account_id, -delta(old));
        db.prepare(`DELETE FROM cash_movements WHERE id = ?`).run(old.id);
        if (old.calendar_entry_id) removeEntry(old.calendar_entry_id);
        return ok;
      });
      return { restored };
    });

    // Η πληρωμή αφαιρείται από τον λογαριασμό, η είσπραξη προστίθεται.
    route('POST', '/api/cashbox/settle/:id', ({ params, body }) => {
      const p = getPending(params.id);
      if (p.done) throw bad('Η εκκρεμότητα είναι ήδη ολοκληρωμένη.');
      if (!p.amountCents) throw bad('Η εκκρεμότητα δεν έχει ποσό.');
      tx(() => settle(p, Number(body.accountId), body.note, body.category));
      return summary();
    });
    // Πλήρωσα ή Εισέπραξα: γράφεται και κλείνει με μία κίνηση, ώστε να μη μείνει ποτέ μισή.
    route('POST', '/api/cashbox/settle-new', ({ body }) => {
      tx(() => {
        const p = createPending(body);
        if (!p.amountCents) throw bad('Γράψε το ποσό που πέρασε από το ταμείο.');
        settle(p, Number(body.accountId), body.note, body.category);
      });
      return summary();
    });
    route('POST', '/api/cashbox/unsettle/:id', ({ params }) => {
      const p = getPending(params.id);
      if (!p.settledAccountId) throw bad('Η εκκρεμότητα δεν έχει κίνηση στο ταμείο.');
      const restored = tx(() => {
        const ok = move(p.settledAccountId, -p.settledCents);
        setSettled(p.id, null, null);
        db.prepare(`DELETE FROM cash_movements WHERE pending_id = ?`).run(p.id);
        return ok;
      });
      return { ...summary(), restored };
    });

    // Εισπράξεις event: επηρεάζουν το ταμείο μόνο όταν τσεκαριστούν.
    route('GET', '/api/cashbox/event-payments/:entryId', ({ params }) => eventPayments(Number(params.entryId)));
    route('POST', '/api/cashbox/event-payments/:entryId', ({ params, body }) => {
      const entry = getEntry(params.entryId);
      if (!STAGES[body.stage]) throw bad('Μη έγκυρη είσπραξη.');
      if (stageOf(entry.id, body.stage)) throw bad('Η είσπραξη έχει ήδη καταχωρηθεί.');
      // Χωρίς δική της κατηγορία, η είσπραξη παίρνει την κατηγορία της καταχώρησης.
      const m = cleanMovement({ ...body, kind: 'in', description: `${STAGES[body.stage]}: ${entry.title}`,
        category: String(body.category ?? '').trim() || entry.incomeSource || entry.category });
      tx(() => {
        if (!move(m.account_id, delta(m))) throw notFound('Ο λογαριασμός δεν υπάρχει πια.');
        insertMovement({ ...m, note: String(body.note ?? '').trim(), entry_id: entry.id, stage: body.stage });
      });
      return eventPayments(entry.id);
    });
    // Διόρθωση είσπραξης: αν αλλάξει μόνο η ημερομηνία, η κίνηση πάει σε άλλη μέρα και τα υπόλοιπα μένουν ίδια.
    route('PUT', '/api/cashbox/event-payments/:entryId/:stage', ({ params, body }) => {
      const entry = getEntry(params.entryId);
      const old = db.prepare(`SELECT * FROM cash_movements WHERE entry_id = ? AND stage = ?`).get(entry.id, params.stage);
      if (!old) throw notFound('Η είσπραξη δεν υπάρχει πια.');
      const m = cleanMovement({ ...body, kind: 'in', description: old.description,
        category: String(body.category ?? '').trim() || entry.incomeSource || entry.category });
      tx(() => {
        if (!move(old.account_id, -delta(old))) throw bad('Ο λογαριασμός της είσπραξης έχει διαγραφεί. Αναίρεσε την είσπραξη και γράψε νέα.');
        if (!move(m.account_id, delta(m))) throw notFound('Ο λογαριασμός δεν υπάρχει πια.');
        db.prepare(`UPDATE cash_movements SET date=?, amount_cents=?, account_id=?, category=?, note=? WHERE id=?`)
          .run(m.date, m.amount_cents, m.account_id, m.category, String(body.note ?? '').trim(), old.id);
      });
      return eventPayments(entry.id);
    });
    route('DELETE', '/api/cashbox/event-payments/:entryId/:stage', ({ params }) => {
      const entryId = Number(params.entryId);
      const m = db.prepare(`SELECT * FROM cash_movements WHERE entry_id = ? AND stage = ?`).get(entryId, params.stage);
      if (!m) throw notFound('Η είσπραξη δεν υπάρχει πια.');
      const restored = tx(() => {
        const ok = move(m.account_id, -delta(m));
        db.prepare(`DELETE FROM cash_movements WHERE id = ?`).run(m.id);
        return ok;
      });
      return { ...eventPayments(entryId), restored };
    });

    route('POST', '/api/cashbox/accounts', ({ body }) => {
      const name = String(body.name ?? '').trim();
      if (!name) throw bad('Γράψε όνομα λογαριασμού.');
      const same = db.prepare(`SELECT id, archived FROM cash_accounts WHERE name = ?`).get(name);
      if (same && !same.archived) throw bad('Υπάρχει ήδη λογαριασμός με αυτό το όνομα.');
      const next = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM cash_accounts`).get().n;
      if (same) db.prepare(`UPDATE cash_accounts SET archived = 0, balance_cents = 0, sort_order = ? WHERE id = ?`).run(next, same.id);
      else db.prepare(`INSERT INTO cash_accounts (name, sort_order) VALUES (?, ?)`).run(name, next);
      return summary();
    });
    route('DELETE', '/api/cashbox/accounts/:id', ({ params }) => {
      db.prepare(`UPDATE cash_accounts SET archived = 1 WHERE id = ?`).run(params.id);
      return summary();
    });
  },
};
