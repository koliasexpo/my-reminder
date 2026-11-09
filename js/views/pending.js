import { api, confirmDialog, dialog, el, fill, fmtDate, fmtMoney, fmtPlain, growInput, guard, parseMoney, toast, daysUntil, lastAccount, rememberAccount, NOTE_HINT, categoryInput, dateField } from '../ui.js';

const NO_MONEY = 'Χωρίς έσοδα / έξοδα';
const KIND_LABEL = { pay: 'Να πληρώσω', collect: 'Να εισπράξω', none: NO_MONEY };
const DONE_LABEL = { pay: 'Πλήρωσα', collect: 'Εισέπραξα', none: NO_MONEY };
const kindLabel = (p) => (p.done ? DONE_LABEL : KIND_LABEL)[p.kind];
const NOW = { paid: 'pay', collected: 'collect' };

const kindSelect = (value, labels) => el('select', { 'aria-label': 'Τύπος' },
  Object.entries(labels).map(([v, t]) => el('option', { value: v, selected: value === v }, t)));

function amountOf(input) {
  if (!input.value.trim()) return null;
  const c = parseMoney(input.value);
  if (c === null || c < 0) throw new Error('Το ποσό πρέπει να είναι θετικός αριθμός, π.χ. 120,50.');
  return c;
}

export function editPending(p, refresh) {
  dialog('center', (close) => {
    const title = growInput({ value: p.title, required: true });
    const amount = el('input', { value: p.amountCents === null ? '' : fmtPlain(p.amountCents), inputMode: 'decimal' });
    const kind = kindSelect(p.kind, p.done ? DONE_LABEL : KIND_LABEL);
    const syncAmount = () => { amount.disabled = kind.value === 'none'; if (amount.disabled) amount.value = ''; };
    kind.addEventListener('change', syncAmount);
    syncAmount();
    const due = dateField({ value: p.dueDate });
    const notes = el('textarea', { value: p.notes, rows: 3 });
    return el('form.dlg', { onsubmit: guard(async (ev) => {
      ev.preventDefault();
      await api(`/pending/${p.id}`, { method: 'PUT', body: { title: title.value, amountCents: amountOf(amount), kind: kind.value, dueDate: due.value, notes: notes.value } });
      toast('Οι αλλαγές αποθηκεύτηκαν.');
      close(); refresh();
    }) },
    el('h2', { style: 'font:600 22px var(--num)' }, 'Εκκρεμότητα'),
    el('div.form-grid', {},
      el('label.field.wide', {}, 'Τι εκκρεμεί', title),
      el('label.field', {}, 'Ποσό (€)', amount),
      el('label.field', {}, 'Τύπος', kind),
      el('label.field', {}, 'Προθεσμία', due),
      el('label.field.wide', {}, 'Σημειώσεις', notes)),
    el('div.dlg-actions', {},
      el('button.btn.primary', { type: 'submit' }, 'Αποθήκευση αλλαγών'),
      el('button.btn', { type: 'button', onclick: close }, 'Άκυρο'),
      el('button.btn.danger.push', { type: 'button', onclick: () => confirmDialog(`Να διαγραφεί η εκκρεμότητα «${p.title}»;`, 'Διαγραφή', async () => {
        await api(`/pending/${p.id}`, { method: 'DELETE' });
        toast('Η εκκρεμότητα διαγράφηκε.');
        close(); refresh();
      }) }, 'Διαγραφή')));
  });
}

const NO_MOVE = 'none';

// Κοινό παράθυρο: σε ποιον λογαριασμό πέρασε το ποσό, με προαιρετικό σχόλιο.
function accountDialog({ title, question, accounts, allowNoMove, submit, onClose }) {
  const last = lastAccount();
  const pick = el('select', {},
    accounts.map((a) => el('option', { value: a.id, selected: String(a.id) === last }, `${a.name} (${fmtMoney(a.balanceCents)})`)),
    allowNoMove && el('option', { value: NO_MOVE, selected: !accounts.length }, 'Χωρίς κίνηση στο ταμείο'));
  const note = el('input', { placeholder: NOTE_HINT });
  const category = categoryInput('', 'Κατηγορία');
  const d = dialog('center', (close) => el('form.dlg', { onsubmit: guard(async (ev) => {
    ev.preventDefault();
    if (!pick.value) throw new Error('Πρόσθεσε πρώτα έναν λογαριασμό στο Ταμείο.');
    await submit(pick.value === NO_MOVE ? null : pick.value, note.value, category.value);
    if (pick.value !== NO_MOVE) rememberAccount(pick.value);
    close();
  }) },
  el('h2', { style: 'font:600 22px var(--num)' }, title),
  el('p', {}, question),
  el('label.field', {}, 'Λογαριασμός', pick),
  el('label.field', {}, 'Κατηγορία (προαιρετικά)', category),
  el('label.field', {}, 'Σχόλιο (προαιρετικό)', note),
  el('div.dlg-actions', {},
    el('button.btn.primary', { type: 'submit' }, 'Ολοκλήρωση'),
    el('button.btn', { type: 'button', onclick: close }, 'Άκυρο'))));
  if (onClose) d.addEventListener('close', onClose);
}

const question = (kind, cents) => `${kind === 'pay' ? 'Από ποιον λογαριασμό πληρώθηκαν' : 'Σε ποιον λογαριασμό μπήκαν'} τα ${fmtMoney(cents)};`;
const moved = (kind, cents) => `${kind === 'pay' ? 'Αφαιρέθηκαν' : 'Προστέθηκαν'} ${fmtMoney(cents)}.`;

function settle(p, accounts, refresh) {
  accountDialog({
    title: p.title, question: question(p.kind, p.amountCents), accounts, allowNoMove: true,
    // Με το Άκυρο το κουτάκι ξαναγυρίζει στην κανονική του κατάσταση.
    onClose: refresh,
    async submit(accountId, note, cat) {
      if (accountId === null) return api(`/pending/${p.id}/done`, { method: 'POST', body: { done: true } });
      await api(`/cashbox/settle/${p.id}`, { method: 'POST', body: { accountId, note, category: cat } });
      toast(moved(p.kind, p.amountCents));
    },
  });
}

// Με ποσό ρωτά για λογαριασμό, χωρίς ποσό ολοκληρώνεται κατευθείαν.
export async function completePending(p, accounts, refresh) {
  if (p.amountCents) return settle(p, accounts, refresh);
  await api(`/pending/${p.id}/done`, { method: 'POST', body: { done: true } });
  refresh();
}

function rowOf(p, accounts, refresh) {
  const late = !p.done && p.dueDate && daysUntil(p.dueDate) < 0;
  const account = accounts.find((a) => a.id === p.settledAccountId);
  const meta = [kindLabel(p), p.dueDate && `${late ? 'Πέρασε η προθεσμία' : 'Έως'} ${fmtDate(p.dueDate)}`, p.notes,
    account && `${p.kind === 'pay' ? 'από' : 'στον λογαριασμό'} ${account.name}`].filter(Boolean).join(', ');
  return el('div.p-row' + (p.done ? '.done' : ''), {},
    el('input', { type: 'checkbox', checked: p.done, 'aria-label': `Ολοκλήρωση: ${p.title}`, onchange: guard(async (ev) => {
      if (ev.target.checked) return completePending(p, accounts, refresh);
      if (p.settledAccountId) {
        const { restored } = await api(`/cashbox/unsettle/${p.id}`, { method: 'POST' });
        toast(restored ? 'Το ποσό επέστρεψε στον λογαριασμό.' : 'Ο λογαριασμός δεν υπάρχει πια, άνοιξε χωρίς κίνηση.', !restored);
      } else await api(`/pending/${p.id}/done`, { method: 'POST', body: { done: ev.target.checked } });
      refresh();
    }) }),
    el('button.p-main', { type: 'button', onclick: () => editPending(p, refresh) },
      el('span.p-title', {}, p.title), meta && el('span.p-meta', { style: late ? 'color:var(--late)' : '' }, meta)),
    p.amountCents !== null && el('span.amount.' + p.kind, {}, (p.kind === 'pay' ? '−' : '+') + fmtMoney(p.amountCents)));
}

export default {
  id: 'pending',
  title: 'Εκκρεμότητες',
  async render(root) {
    const title = el('input.q-title', { placeholder: 'Τι εκκρεμεί;', 'aria-label': 'Τι εκκρεμεί', required: true });
    const amount = el('input', { placeholder: 'Ποσό (€)', 'aria-label': 'Ποσό', inputMode: 'decimal' });
    const kind = kindSelect('pay', { pay: KIND_LABEL.pay, collect: KIND_LABEL.collect, paid: DONE_LABEL.pay, collected: DONE_LABEL.collect, none: NO_MONEY });
    kind.addEventListener('change', () => { amount.disabled = kind.value === 'none'; if (amount.disabled) amount.value = ''; });
    const due = dateField({ label: 'Προθεσμία' });
    const body = el('div');

    const refresh = guard(async () => {
      const [rows, { accounts }] = await Promise.all([api('/pending'), api('/cashbox')]);
      const open = rows.filter((p) => !p.done), done = rows.filter((p) => p.done);
      const sum = (k) => open.filter((p) => p.kind === k).reduce((s, p) => s + (p.amountCents ?? 0), 0);
      fill(body,
        el('div.sums', {},
          el('div.sum', {}, el('b', {}, String(open.length)), el('span', {}, 'ανοιχτές')),
          el('div.sum', {}, el('b', {}, fmtMoney(sum('pay'))), el('span', {}, 'να πληρώσω')),
          el('div.sum', {}, el('b', {}, fmtMoney(sum('collect'))), el('span', {}, 'να εισπράξω'))),
        open.length ? el('div', {}, open.map((p) => rowOf(p, accounts, refresh)))
          : el('div.empty', {}, 'Καμία ανοιχτή εκκρεμότητα. Γράψε την πρώτη στο πεδίο από πάνω.'),
        done.length > 0 && el('details', {}, el('summary', {}, `Ολοκληρωμένες (${done.length})`), el('div', {}, done.map((p) => rowOf(p, accounts, refresh)))));
    });

    root.replaceChildren(el('div.narrow', {},
      el('form.quick', { onsubmit: guard(async (ev) => {
        ev.preventDefault();
        const form = ev.target;
        const done = () => { form.reset(); amount.disabled = false; title.focus(); refresh(); };
        const item = { title: title.value, amountCents: amountOf(amount), dueDate: due.value };
        const nowKind = NOW[kind.value];
        if (!nowKind) {
          await api('/pending', { method: 'POST', body: { ...item, kind: kind.value } });
          return done();
        }
        // Πλήρωσα ή Εισέπραξα: πάει απευθείας στο ταμείο και στις ολοκληρωμένες.
        if (!item.title.trim()) throw new Error('Γράψε τι πλήρωσες ή τι εισέπραξες.');
        if (!item.amountCents) throw new Error('Γράψε το ποσό που πέρασε από το ταμείο.');
        const { accounts } = await api('/cashbox');
        accountDialog({
          title: item.title, question: question(nowKind, item.amountCents), accounts, allowNoMove: false,
          async submit(accountId, note, cat) {
            await api('/cashbox/settle-new', { method: 'POST', body: { ...item, kind: nowKind, accountId, note, category: cat } });
            toast(moved(nowKind, item.amountCents));
            done();
          },
        });
      }) }, title, amount, kind, due, el('button.btn.primary', { type: 'submit' }, 'Προσθήκη')),
      body));
    await refresh();
  },
};
