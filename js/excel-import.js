// Εισαγωγή Excel. Κάθε πρότυπο είναι ένα αντικείμενο στο TEMPLATES:
// στήλες, μετατροπή γραμμής σε καταχωρήσεις και στήλες προεπισκόπησης.
import { EVENT_CATEGORY, api, dialog, el, fmtDate, fmtMoney, guard, parseMoney, toast } from './ui.js';
import { readRows, serialToIso } from './extract.js';

const norm = (s) => String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const header = (s) => norm(s).replace(/[().:]/g, ' ').replace(/\s+/g, ' ').trim();

function parseDate(v) {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialToIso(v) : null;
  const s = String(v).trim();
  if (/^\d{5}$/.test(s)) return parseDate(Number(s));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y, mo, d;
  if (m) [, y, mo, d] = m;
  else {
    m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
    if (!m) return null;
    [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
  }
  const t = new Date(Date.UTC(+y, +mo - 1, +d));
  if (t.getUTCMonth() !== +mo - 1 || t.getUTCDate() !== +d) return null;
  return t.toISOString().slice(0, 10);
}

// Κενό δίνει null, μη έγκυρο ποσό δίνει undefined.
function parseAmount(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v >= 0 ? Math.round(v * 100) : undefined;
  if (!String(v).trim()) return null;
  const c = parseMoney(v);
  return c === null || c < 0 ? undefined : c;
}

const dateCell = (d) => (d ? fmtDate(d) : '');

export const TEMPLATES = {
  domains: {
    title: 'Domain & Hosting',
    file: 'protypo-domains-hosting.xlsx',
    columns: ['Domain Name', 'Ημερομηνία Λήξης Domain', 'Ανανέωση Hosting (Ετήσια)'],
    fields: {
      domain: ['domain name', 'domain', 'domains'],
      expiry: ['ημερομηνια ληξης domain', 'ληξη domain', 'ημερομηνια ληξης'],
      hosting: ['ανανεωση hosting ετησια', 'ανανεωση hosting', 'hosting'],
    },
    preview: ['Τίτλος', 'Ημερομηνία', 'Κατηγορία'],
    previewRow: (r) => [r.item.title, r.item.date ? fmtDate(r.item.date) : String(r.rawDate), r.item.category],
    // Μία γραμμή δίνει έως δύο καταχωρήσεις με ετήσια επανάληψη: τη λήξη domain και την ανανέωση hosting.
    toItems(cell) {
      const name = String(cell('domain')).trim();
      const expiryRaw = cell('expiry'), hostingRaw = cell('hosting');
      const expiry = parseDate(expiryRaw);
      const out = [];
      const add = (title, category, date, rawDate) => out.push({
        item: { title, category, date, repeat: 'yearly' },
        status: !name ? 'Λείπει το domain' : !date ? 'Λάθος ημερομηνία' : 'ok', rawDate,
      });
      const hostingText = norm(hostingRaw);
      const hasHosting = hostingText !== '' && !['οχι', 'no', '-'].includes(hostingText);
      if (String(expiryRaw).trim() !== '' || !hasHosting) add(name, 'Domain', expiry, expiryRaw);
      if (hasHosting) {
        const sameDay = ['ναι', 'yes', 'x', 'ετησια'].includes(hostingText);
        add(`Hosting ${name}`, 'Φιλοξενία', sameDay ? expiry : parseDate(hostingRaw), hostingRaw);
      }
      return out;
    },
  },
  events: {
    title: 'Γάμοι & Event',
    file: 'protypo-gamoi-event.xlsx',
    columns: ['Ημερομηνία', 'Ονοματεπώνυμο', 'Τοποθεσία', 'Τηλ Επικοινωνίας', 'Ενέργειες που έχουν γίνει', 'Τελικό Κόστος', 'Προκαταβολή', 'Ενέργειες που απομένουν'],
    fields: {
      date: ['ημερομηνια', 'ημερομηνια event', 'ημερομηνια γαμου'],
      name: ['ονοματεπωνυμο', 'ονομα'],
      location: ['τοποθεσια'],
      phone: ['τηλ επικοινωνιας', 'τηλεφωνο επικοινωνιας', 'τηλεφωνο', 'τηλ'],
      doneActions: ['ενεργειες που εχουν γινει'],
      cost: ['τελικο κοστος', 'κοστος'],
      deposit: ['προκαταβολη'],
      todoActions: ['ενεργειες που απομενουν'],
    },
    preview: ['Ημερομηνία', 'Ονοματεπώνυμο', 'Τοποθεσία', 'Κόστος', 'Προκαταβολή'],
    previewRow: (r) => [r.item.date ? fmtDate(r.item.date) : String(r.rawDate), r.item.title, r.item.location,
      r.item.costCents ? fmtMoney(r.item.costCents) : '', r.item.depositCents ? fmtMoney(r.item.depositCents) : ''],
    toItems(cell) {
      const title = String(cell('name')).trim();
      const rawDate = cell('date');
      const date = parseDate(rawDate);
      const costCents = parseAmount(cell('cost')), depositCents = parseAmount(cell('deposit'));
      const bad = costCents === undefined || depositCents === undefined;
      return [{
        rawDate,
        status: !title ? 'Λείπει ονοματεπώνυμο' : !date ? 'Λάθος ημερομηνία' : bad ? 'Λάθος ποσό' : 'ok',
        item: { title, date, category: EVENT_CATEGORY, hasIncome: true, incomeSource: 'Events', location: String(cell('location')).trim(), phone: String(cell('phone')).trim(),
          doneActions: String(cell('doneActions')).trim(), todoActions: String(cell('todoActions')).trim(),
          costCents: bad ? null : costCents, depositCents: bad ? null : depositCents },
      }];
    },
  },
};

function mapHeaders(row, fields) {
  const map = {};
  row.forEach((cell, i) => {
    const h = header(cell);
    for (const [key, names] of Object.entries(fields)) if (!(key in map) && names.includes(h)) map[key] = i;
  });
  return map;
}

export function buildRows(template, rows, existing) {
  const keys = Object.keys(template.fields);
  const best = rows.slice(0, 10).map((r) => mapHeaders(r, template.fields));
  const at = best.findIndex((m) => keys.slice(0, 2).every((k) => k in m));
  if (at < 0) throw new Error(`Το αρχείο δεν ταιριάζει με το πρότυπο «${template.title}». Χρειάζονται οι στήλες: ${template.columns.join(', ')}.`);
  const map = best[at];
  const seen = new Set(existing.map((e) => `${norm(e.title)}|${e.date}`));
  return rows.slice(at + 1).filter((r) => r.some((c) => String(c).trim() !== '')).flatMap((r) =>
    template.toItems((k) => (k in map ? r[map[k]] ?? '' : ''))).map((row) => {
    const key = `${norm(row.item.title)}|${row.item.date}`;
    if (row.status === 'ok') { if (seen.has(key)) row.status = 'Υπάρχει ήδη'; else seen.add(key); }
    return row;
  });
}

function pickFile(template, onDone) {
  const input = el('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,.xls', hidden: true });
  input.addEventListener('change', guard(async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    const [rows, existing] = await Promise.all([readRows(file), api('/entries')]);
    preview(file.name, template, buildRows(template, rows, existing), onDone);
  }));
  document.body.append(input);
  input.click();
}

// Το ένα κουμπί «Εισαγωγή Excel» ανοίγει τις επιλογές.
export function openImport(onDone) {
  dialog('center', (close) => el('div.dlg', {},
    el('div.dlg-head', {}, el('h2', {}, 'Εισαγωγή Excel'), el('button.btn', { type: 'button', onclick: close }, 'Κλείσιμο')),
    el('div.imp-grid', {}, Object.values(TEMPLATES).map((t) => el('section.imp-card', {},
      el('h3', {}, t.title),
      el('ul', {}, t.columns.map((c) => el('li', {}, c))),
      el('div.dlg-actions', {},
        el('button.btn.primary', { type: 'button', onclick: () => { close(); pickFile(t, onDone); } }, 'Επιλογή αρχείου'),
        el('a.btn', { href: t.file, download: '' }, 'Κατέβασμα προτύπου')))))));
}

function preview(name, template, rows, onDone) {
  const good = rows.filter((r) => r.status === 'ok');
  dialog('center', (close) => el('div.dlg', {},
    el('div.dlg-head', {}, el('h2', {}, template.title), el('button.btn', { type: 'button', onclick: close }, 'Κλείσιμο')),
    el('p', {}, `${name}: έτοιμες ${good.length} από ${rows.length} καταχωρήσεις.`),
    el('div.table-wrap', {}, el('table', {},
      el('thead', {}, el('tr', {}, [...template.preview, 'Κατάσταση'].map((h) => el('th', {}, h)))),
      el('tbody', {}, rows.map((r) => el('tr' + (r.status === 'ok' ? '' : '.skip'), {},
        template.previewRow(r).map((c) => el('td', {}, c)),
        el('td', { className: r.status === 'ok' ? 'st-ok' : r.status === 'Υπάρχει ήδη' ? 'st-dup' : 'st-bad' }, r.status === 'ok' ? 'Έτοιμη' : r.status)))))),
    el('div.dlg-actions', {},
      el('button.btn.primary', { type: 'button', disabled: !good.length, onclick: guard(async () => {
        const { imported } = await api('/entries/bulk', { method: 'POST', body: { items: good.map((r) => r.item) } });
        toast(imported === 1 ? 'Προστέθηκε 1 καταχώρηση.' : `Προστέθηκαν ${imported} καταχωρήσεις.`);
        onDone();
        close();
      }) }, good.length === 1 ? 'Εισαγωγή 1 καταχώρησης' : `Εισαγωγή ${good.length} καταχωρήσεων`),
      el('button.btn', { type: 'button', onclick: close }, 'Άκυρο'))));
}
