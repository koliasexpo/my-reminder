// Κοινά εργαλεία για όλες τις καρτέλες.
import { localApi } from './local/api.js';
export async function api(path, { method = 'GET', body } = {}) {
  const { status, data } = await localApi(method, '/api' + path, body);
  if (status >= 400) throw new Error(data.error || 'Η ενέργεια απέτυχε.');
  return data;
}

// Κατεβάζει δεδομένα ως αρχείο στο κινητό.
export function saveAs(name, bytes, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// el('div.x', { onclick }, child, ...). Το κείμενο μπαίνει πάντα ως text, όχι ως HTML.
export function el(spec, props, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (cls.length) node.className = cls.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style') node.style.cssText = v;
    else if (k in node && k !== 'list' && k !== 'form') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return node;
}

// Αντικαθιστά το περιεχόμενο ενός κόμβου, δέχεται ό,τι δέχεται και το el().
export function fill(node, ...kids) {
  node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
}

const toasts = document.getElementById('toasts');
const MAX_TOASTS = 3;
// Πεδίο κειμένου που μεγαλώνει με το περιεχόμενο, αντί να κρύβει το μισό κείμενο.
export function growInput(props) {
  return el('textarea.grow', { rows: 1, ...props, onkeydown: (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.form?.requestSubmit(); }
  } });
}

export function toast(text, isError) {
  // Τα <dialog> είναι πάνω από όλα, οπότε τα μηνύματα πρέπει να μπουν μέσα στο ανοιχτό παράθυρο.
  [...document.querySelectorAll('dialog[open]')].pop()?.append(toasts);
  const t = el('div.toast' + (isError ? '.err' : ''), {}, text);
  toasts.append(t);
  while (toasts.children.length > MAX_TOASTS) toasts.firstChild.remove();
  setTimeout(() => t.remove(), isError ? 6000 : 2500);
}
export const fail = (e) => toast(e.message, true);
// Τυλίγει χειριστές ώστε κάθε σφάλμα να φαίνεται στον χρήστη.
export const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { fail(e); } };

export function dialog(kind, build) {
  const d = el('dialog.' + kind);
  const close = () => d.close();
  d.addEventListener('close', () => {
    const under = [...document.querySelectorAll('dialog[open]')].pop();
    (under ?? document.body).append(toasts);
    d.remove();
  });
  // Τα παράθυρα κλείνουν μόνο από τα κουμπιά τους, για να μη χάνεται ό,τι έχει γραφτεί.
  d.setAttribute('closedby', 'none');
  d.addEventListener('cancel', (e) => e.preventDefault());
  d.append(build(close));
  document.body.append(d);
  d.showModal();
  return d;
}

export function confirmDialog(message, action, run) {
  return dialog('center', (close) => el('div.dlg', {},
    el('p', {}, message),
    el('div.dlg-actions', {},
      el('button.btn.primary', { type: 'button', onclick: guard(async () => { await run(); close(); }) }, action),
      el('button.btn', { type: 'button', onclick: close }, 'Άκυρο'))));
}

const money = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' });
export const fmtMoney = (cents) => money.format((cents ?? 0) / 100);
const plain = new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPlain = (cents) => plain.format((cents ?? 0) / 100);

// Δέχεται 1.234,56 και 1234.56 και 1,234.56. Επιστρέφει λεπτά ή null αν δεν είναι ποσό.
export function parseMoney(input) {
  let s = String(input).replace(/[\s€]/g, '');
  if (!s) return 0;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    s = /^-?\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replaceAll(',', '') : s.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replaceAll('.', '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

const LAST_ACCOUNT = 'reminder.lastAccount';
export function lastAccount() { try { return localStorage.getItem(LAST_ACCOUNT); } catch { return null; } }
export function rememberAccount(id) { try { localStorage.setItem(LAST_ACCOUNT, id); } catch { /* χωρίς μνήμη browser */ } }
export const NOTE_HINT = 'π.χ. μπήκαν στην τράπεζα';

export const MONTHS = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];
export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const fmtDate = (s) => (s ? s.split('-').reverse().join('/') : '');
export const daysUntil = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  const [a, b, c] = today().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(a, b - 1, c)) / 86400000);
};
export function whenText(s) {
  const n = daysUntil(s);
  if (n === 0) return 'σήμερα';
  if (n === 1) return 'αύριο';
  if (n === -1) return 'έληξε χθες';
  return n > 0 ? `σε ${n} μέρες` : `έληξε πριν ${-n} μέρες`;
}
// Τα timestamps της βάσης είναι UTC.
export const fmtStamp = (s) => {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function parseDate(text) {
  const s = text.trim();
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  if (!m) return '';
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const t = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  if (t.getUTCMonth() !== Number(m[2]) - 1 || t.getUTCDate() !== Number(m[1])) return '';
  return t.toISOString().slice(0, 10);
}
function parseTime(text) {
  const s = text.trim();
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(s) ?? /^(\d{2})(\d{2})$/.exec(s) ?? /^(\d{1,2})()$/.exec(s);
  if (!m) return '';
  const h = Number(m[1]), min = Number(m[2] || 0);
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : '';
}

// Οι έτοιμες ημερομηνίες του browser ακολουθούν τη γλώσσα του, γι' αυτό τα πεδία είναι δικά μας.
// Και τα δύο δίνουν .value όπως ένα κανονικό input: YYYY-MM-DD και ΩΩ:ΛΛ.
function maskedInput({ name, required, label, placeholder, maxLength, parse, format, message, separators, onchange }) {
  const input = el('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', name, required, placeholder, maxLength, 'aria-label': label });
  const check = () => input.setCustomValidity(input.value.trim() && !parse(input.value) ? message : '');
  input.addEventListener('input', (e) => {
    if (e.inputType !== 'deleteContentBackward' && separators.test(input.value)) input.value += format.sep;
    check();
  });
  input.addEventListener('change', () => {
    const value = parse(input.value);
    if (value) input.value = format.show(value);
    check();
    onchange?.(value);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !input.form) input.blur(); });
  return input;
}

export function dateField({ value = '', name, required, label, onchange } = {}) {
  const text = maskedInput({ name, required, label, placeholder: 'ηη/μμ/εεεε', maxLength: 10, parse: parseDate, separators: /^\d{2}$|^\d{1,2}\/\d{2}$/,
    format: { sep: '/', show: fmtDate }, message: 'Γράψε ημερομηνία της μορφής ηη/μμ/εεεε.', onchange });
  text.value = fmtDate(value);
  const native = el('input.date-native', { type: 'date', tabIndex: -1, 'aria-hidden': 'true', onchange: () => {
    text.value = fmtDate(native.value);
    text.setCustomValidity('');
    onchange?.(native.value);
  } });
  const open = el('button.date-btn', { type: 'button', 'aria-label': 'Άνοιγμα ημερολογίου', onclick: () => { native.value = parseDate(text.value); native.showPicker?.(); } });
  open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v3M17 2v3M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>';
  const wrap = el('div.date-field', {}, text, open, native);
  Object.defineProperty(wrap, 'value', { get: () => parseDate(text.value), set: (v) => { text.value = fmtDate(v); text.setCustomValidity(''); } });
  return wrap;
}

export function timeField({ value = '', name, label } = {}) {
  const input = maskedInput({ name, label, placeholder: 'ΩΩ:ΛΛ', maxLength: 5, parse: parseTime, separators: /^\d{2}$/,
    format: { sep: ':', show: (v) => v }, message: 'Γράψε ώρα 24ώρου, π.χ. 14:30.' });
  input.value = value;
  const wrap = el('div', {}, input);
  Object.defineProperty(wrap, 'value', { get: () => parseTime(input.value), set: (v) => { input.value = v; } });
  return wrap;
}

// Κοινή λίστα προτάσεων για το πεδίο κατηγορίας του ταμείου.
export async function loadCategories() {
  let list = document.getElementById('cash-cats');
  if (!list) { list = el('datalist', { id: 'cash-cats' }); document.body.append(list); }
  const names = await api('/cashbox/categories').catch(() => []);
  list.replaceChildren(...names.map((c) => el('option', { value: c })));
}
export const categoryInput = (value = '', label) => {
  loadCategories();
  return el('input', { value, list: 'cash-cats', placeholder: 'Κατηγορία', autocomplete: 'off', 'aria-label': label, name: 'category' });
};

export const EVENT_CATEGORY = 'Γάμος/Event';
export const SUPPORT_CATEGORY = 'Support Now';
export const INCOME_SOURCES = ['Hosting / Domain', 'Μουσική', 'Support Now', 'Events', 'Άλλο'];
const NAMED = { 'Domain': 0, 'Φιλοξενία': 1, 'Ραντεβού': 2, 'Άλλο': 3, [SUPPORT_CATEGORY]: 4, [EVENT_CATEGORY]: 5 };
export function catVar(category) {
  let i = NAMED[category];
  if (i === undefined) { i = 0; for (const ch of category) i = (i * 31 + ch.codePointAt(0)) % 997; i = i % 2 ? 5 : 4; }
  return `--cat: var(--c${i})`;
}
