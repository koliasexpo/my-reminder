// Γράφημα εσόδων και εξόδων ανά κατηγορία για τον μήνα της επιλεγμένης ημέρας.
// Τα χρώματα είναι ελεγμένα για σκούρο φόντο και αχρωματοψία (ορίζονται στο .chart-card).
import { MONTHS, api, el, fill, fmtDate, fmtMoney } from '../ui.js';

const HIDDEN_KEY = 'reminder.hiddenCategories';
const NO_CATEGORY = 'Χωρίς κατηγορία';

function loadHidden() { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY)) ?? []); } catch { return new Set(); } }
function saveHidden(set) { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch { /* χωρίς μνήμη browser */ } }

const MONTHS_OF = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];

// Δύο λίστες που ανοίγουν με κλικ: τι περιμένω να εισπράξω και τι περιμένω να πληρώσω.
// Ό,τι έχει ανοίξει μένει ανοιχτό όταν ξαναζωγραφίζεται το Ταμείο.
const opened = { in: false, out: false };

export function expectedChart(items) {
  const max = Math.max(1, ...items.map((i) => i.cents));
  const label = (i) => {
    if (i.source !== 'event') return i.title;
    const [, m, d] = i.date.split('-').map(Number);
    return `${i.label} ${d} ${MONTHS_OF[m - 1]}`;
  };
  const detail = (i) => (i.source === 'event' ? i.title : i.date ? `έως ${fmtDate(i.date)}` : '');
  const row = (i) => el('div.ch-row', {},
    el('div.ch-name', {}, label(i), detail(i) && el('small', {}, detail(i))),
    el('div.ch-bar-wrap', { title: `${label(i)}: ${fmtMoney(i.cents)}` },
      el(`div.ch-bar.${i.kind}`, { style: `width: calc((100% - 110px) * ${i.cents / max})` }),
      el('span.ch-value', {}, fmtMoney(i.cents))));
  const group = (kind, title, emptyText) => {
    const rows = items.filter((i) => i.kind === kind);
    const total = rows.reduce((sum, i) => sum + i.cents, 0);
    return el('details.expected', { open: opened[kind], id: `expected-${kind}`,
      ontoggle: (e) => { opened[kind] = e.target.open; } },
    el('summary', {}, el('span', {}, title), el('b', {}, fmtMoney(total))),
    rows.length ? el('div.expected-rows', {}, rows.map(row)) : el('p.expected-empty', {}, emptyText));
  };
  return el('section.chart-card', { id: 'expected-chart' },
    group('in', 'Εισπράξεις που αναμένονται', 'Δεν αναμένονται εισπράξεις αυτόν τον μήνα.'),
    group('out', 'Πληρωμές που αναμένονται', 'Δεν αναμένονται πληρωμές.'));
}

export function cashChart() {
  const node = el('section.chart-card');
  const hidden = loadHidden();
  let month = '';
  let rows = [];

  const name = (r) => r.category || NO_CATEGORY;

  function bar(kind, cents, max, category) {
    if (!cents) return null;
    const label = kind === 'in' ? 'Έσοδα' : 'Έξοδα';
    return el('div.ch-bar-wrap', { title: `${category}, ${label}: ${fmtMoney(cents)}` },
      el('div.ch-bar.' + kind, { style: `width: calc((100% - 96px) * ${cents / max})` }),
      el('span.ch-value', {}, fmtMoney(cents)));
  }

  function paint() {
    const [y, m] = month.split('-').map(Number);
    const visible = rows.filter((r) => !hidden.has(name(r)));
    const max = Math.max(1, ...visible.flatMap((r) => [r.inCents, r.outCents]));
    const total = (k) => visible.reduce((s, r) => s + r[k], 0);
    fill(node,
      el('h3', {}, `Έσοδα και έξοδα ανά κατηγορία, ${MONTHS[m - 1]} ${y}`),
      rows.length === 0 && el('div.empty', {}, 'Καμία κίνηση αυτόν τον μήνα. Οι κατηγορίες που γράφεις στις κινήσεις εμφανίζονται εδώ.'),
      rows.length > 0 && el('div.chart-legend', {},
        el('span', {}, el('i', { style: 'background: var(--chart-in)' }), 'Έσοδα'),
        el('span', {}, el('i', { style: 'background: var(--chart-out)' }), 'Έξοδα')),
      rows.length > 0 && el('div.chart-filters', {}, rows.map((r) => el('label', {},
        el('input', { type: 'checkbox', checked: !hidden.has(name(r)), onchange: (e) => {
          if (e.target.checked) hidden.delete(name(r)); else hidden.add(name(r));
          saveHidden(hidden);
          paint();
        } }), name(r)))),
      visible.map((r) => el('div.ch-row', {},
        el('div.ch-name', {}, name(r)),
        bar('in', r.inCents, max, name(r)),
        bar('out', r.outCents, max, name(r)))),
      rows.length > 0 && !visible.length && el('p', { style: 'color:var(--muted);font-size:14px' }, 'Τσέκαρε μια κατηγορία για να τη δεις.'),
      visible.length > 0 && el('p.ch-total', {}, `Σύνολο επιλεγμένων: έσοδα ${fmtMoney(total('inCents'))}, έξοδα ${fmtMoney(total('outCents'))}`));
  }

  return {
    node,
    async load(date) {
      month = date.slice(0, 7);
      try { rows = (await api(`/cashbox/report?month=${month}`)).rows; } catch { rows = []; }
      paint();
    },
  };
}
