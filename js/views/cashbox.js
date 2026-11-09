// Ταμείο: ξεχωριστή ενότητα. Μιλά μόνο με το /api/cashbox.
import { api, growInput, categoryInput, confirmDialog, dateField, dialog, el, fill, fmtDate, fmtMoney, fmtPlain, guard, lastAccount, loadCategories, parseMoney, rememberAccount, toast, today } from '../ui.js';
import { cashChart, expectedChart } from './cash-chart.js';

function shiftDate(s, days) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function positive(input) {
  const cents = parseMoney(input.value);
  if (!input.value.trim() || cents === null || cents <= 0) throw new Error('Το ποσό πρέπει να είναι θετικός αριθμός, π.χ. 120,50.');
  return cents;
}

function kindSwitch(value, name) {
  const radio = (v, text) => el('label', {}, el('input', { type: 'radio', name, value: v, checked: value === v }), text);
  const node = el('div.seg', { role: 'radiogroup', 'aria-label': 'Τύπος κίνησης' }, radio('out', 'Έξοδο'), radio('in', 'Έσοδο'));
  return { node, value: () => node.querySelector('input:checked').value };
}

const options = (accounts, selected) => accounts.map((a) => el('option', { value: a.id, selected: String(a.id) === String(selected) }, a.name));

function editMovement(m, accounts, refresh) {
  dialog('center', (close) => {
    const kind = kindSwitch(m.kind, 'edit-kind');
    const amount = el('input', { value: fmtPlain(m.amountCents), inputMode: 'decimal' });
    const account = el('select', {}, options(accounts, m.accountId));
    const date = dateField({ value: m.date, required: true });
    const description = growInput({ value: m.description });
    const category = categoryInput(m.category, 'Κατηγορία');
    return el('form.dlg', { onsubmit: guard(async (ev) => {
      ev.preventDefault();
      await api(`/cashbox/movements/${m.id}`, { method: 'PUT', body: {
        kind: kind.value(), amountCents: positive(amount), accountId: account.value, date: date.value, description: description.value, category: category.value,
      } });
      toast('Οι αλλαγές αποθηκεύτηκαν.');
      close();
      refresh();
    }) },
    el('h2', { style: 'font:600 22px var(--num)' }, 'Κίνηση'),
    el('div.form-grid', {},
      el('div.wide', {}, kind.node),
      el('label.field', {}, 'Ποσό (€)', amount),
      el('label.field', {}, 'Λογαριασμός', account),
      el('label.field', {}, 'Ημερομηνία', date),
      el('label.field', {}, 'Περιγραφή', description),
      el('label.field', {}, 'Κατηγορία', category)),
    el('div.dlg-actions', {},
      el('button.btn.primary', { type: 'submit' }, 'Αποθήκευση αλλαγών'),
      el('button.btn', { type: 'button', onclick: close }, 'Άκυρο')));
  });
}

export default {
  id: 'cashbox',
  title: 'Ταμείο',
  async render(root) {
    let date = today();
    let accounts = [];
    const left = el('div');
    const dayBody = el('div');

    const dateInput = dateField({ value: date, required: true, label: 'Ημέρα', onchange: (v) => { if (v) goTo(v); } });
    const chart = cashChart();
    const monthBox = el('section.chart-card');
    let monthOpen = false;
    const kind = kindSwitch('out', 'new-kind');
    const amount = el('input', { placeholder: 'Ποσό (€)', 'aria-label': 'Ποσό', inputMode: 'decimal' });
    const account = el('select', { 'aria-label': 'Λογαριασμός' });
    const description = el('input', { placeholder: 'Περιγραφή', 'aria-label': 'Περιγραφή' });
    const category = categoryInput('', 'Κατηγορία');

    function paintAccounts(s) {
      accounts = s.accounts;
      const keep = account.value || lastAccount();
      fill(account, options(accounts, keep));
      const name = el('input', { placeholder: 'Νέος λογαριασμός', 'aria-label': 'Όνομα νέου λογαριασμού' });
      fill(left,
        el('section.ledger', {},
          el('div.grand', {}, el('span', {}, 'Διαθέσιμα χρήματα'), el('b', { id: 'cash-total' }, fmtMoney(s.totalCents))),
          accounts.map((a) => {
            const input = el('input', { value: fmtPlain(a.balanceCents), inputMode: 'decimal', 'aria-label': `Υπόλοιπο ${a.name}`,
              onfocus: (e) => e.target.select(),
              onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
              onchange: guard(async (e) => {
                const cents = parseMoney(e.target.value);
                if (cents === null) { e.target.value = fmtPlain(a.balanceCents); throw new Error('Το ποσό δεν είναι έγκυρο. Γράψε π.χ. 1.250,50.'); }
                paintAccounts(await api(`/cashbox/accounts/${a.id}`, { method: 'PUT', body: { balanceCents: cents } }));
                toast(`${a.name}: αποθηκεύτηκε.`);
              }) });
            return el('div.acc', {}, el('span', {}, a.name), input,
              el('button.x', { type: 'button', 'aria-label': `Διαγραφή ${a.name}`, title: 'Διαγραφή λογαριασμού', onclick: () =>
                confirmDialog(`Να διαγραφεί ο λογαριασμός «${a.name}»; Το υπόλοιπό του ${fmtMoney(a.balanceCents)} θα αφαιρεθεί από το σύνολο.`, 'Διαγραφή',
                  async () => { paintAccounts(await api(`/cashbox/accounts/${a.id}`, { method: 'DELETE' })); }) }, '×'));
          }),
          el('form.acc-add', { onsubmit: guard(async (e) => {
            e.preventDefault();
            paintAccounts(await api('/cashbox/accounts', { method: 'POST', body: { name: name.value } }));
          }) }, name, el('button.btn', { type: 'submit' }, 'Προσθήκη'))),
        el('dl.proj', {},
          el('dt', {}, 'Διαθέσιμα τώρα'), el('dd', {}, fmtMoney(s.totalCents)),
          el('dt', {}, 'Να πληρώσω'), el('dd', { id: 'cash-pay' }, '−' + fmtMoney(s.payCents)),
          el('dt', {}, 'Να εισπράξω'), el('dd', { id: 'cash-collect' }, '+' + fmtMoney(s.collectCents)),
          el('dt.final', {}, 'Μετά τα αναμενόμενα'), el('dd.final', { id: 'cash-projected' }, fmtMoney(s.projectedCents))),
        expectedChart(s.expected));
    }

    function rowOf(m, withDate) {
      const kindClass = m.kind === 'in' ? 'collect' : 'pay';
      const label = m.description || (m.kind === 'in' ? 'Έσοδο' : 'Έξοδο');
      const locked = m.pendingId || m.entryId;
      const meta = [withDate && fmtDate(m.date), m.category, m.accountName, m.pendingId && 'από εκκρεμότητα', m.entryId && 'από Ημερολόγιο', m.note].filter(Boolean).join(', ');
      const text = [el('span.p-title', {}, label), el('span.p-meta', {}, meta)];
      return el('div.m-row', {},
        locked ? el('div', {}, text) : el('button.p-main', { type: 'button', onclick: () => editMovement(m, accounts, refresh) }, text),
        el('span.amount.' + kindClass, {}, (m.kind === 'in' ? '+' : '−') + fmtMoney(m.amountCents)),
        locked ? el('span') : el('button.x', { type: 'button', 'aria-label': `Διαγραφή κίνησης ${label}`, title: 'Διαγραφή κίνησης', onclick: () =>
          confirmDialog(`Να διαγραφεί η κίνηση «${label}»; Το υπόλοιπο του λογαριασμού θα διορθωθεί.`, 'Διαγραφή', async () => {
            const { restored } = await api(`/cashbox/movements/${m.id}`, { method: 'DELETE' });
            if (!restored) toast('Ο λογαριασμός έχει διαγραφεί, το υπόλοιπο δεν άλλαξε.', true);
            refresh();
          }) }, '×'));
    }

    function paintDay(d) {
      fill(dayBody,
        el('div.sums', {},
          el('div.sum', {}, el('b', { id: 'day-in' }, fmtMoney(d.inCents)), el('span', {}, 'έσοδα')),
          el('div.sum', {}, el('b', { id: 'day-out' }, fmtMoney(d.outCents)), el('span', {}, 'έξοδα')),
          el('div.sum', {}, el('b', { id: 'day-net' }, fmtMoney(d.netCents)), el('span', {}, 'διαφορά ημέρας'))),
        d.items.length ? el('div', {}, d.items.map((m) => rowOf(m)))
          : el('div.empty', {}, `Καμία κίνηση στις ${fmtDate(d.date)}. Γράψε την πρώτη στη φόρμα από πάνω.`));
    }

    // Όλες οι κινήσεις του μήνα, για να βρίσκεται και να διορθώνεται μια κίνηση χωρίς να ψάχνεις τη μέρα της.
    async function loadMonth() {
      const { items } = await api(`/cashbox/movements?month=${date.slice(0, 7)}`);
      fill(monthBox, el('details.expected', { open: monthOpen, id: 'month-movements', ontoggle: (e) => { monthOpen = e.target.open; } },
        el('summary', {}, el('span', {}, 'Όλες οι κινήσεις του μήνα'), el('b', {}, String(items.length))),
        items.length ? el('div.expected-rows', { style: 'gap:0' }, items.map((m) => rowOf(m, true)))
          : el('p.expected-empty', {}, 'Καμία κίνηση αυτόν τον μήνα.')));
    }

    const refresh = guard(async () => {
      // Οι λογαριασμοί φαίνονται πάντα, ακόμη κι αν αποτύχει το φόρτωμα των κινήσεων.
      paintAccounts(await api('/cashbox'));
      try { paintDay(await api(`/cashbox/movements?date=${date}`)); }
      catch { fill(dayBody, el('div.empty', {}, 'Οι κινήσεις δεν φορτώθηκαν. Κλείσε το παράθυρο της εφαρμογής και τρέξε ξανά το start.bat.')); }
      await Promise.all([chart.load(date), loadCategories(), loadMonth()]);
    });
    function goTo(next) { date = next; dateInput.value = next; refresh(); }

    root.replaceChildren(el('div.cash-layout', {}, left,
      el('section', {},
        el('h2', { style: 'font:600 20px/1.2 var(--num);margin-bottom:10px' }, 'Κινήσεις ημέρας'),
        el('div.day-nav', {},
          el('button.btn', { type: 'button', 'aria-label': 'Προηγούμενη ημέρα', onclick: () => goTo(shiftDate(date, -1)) }, '‹'),
          dateInput,
          el('button.btn', { type: 'button', onclick: () => goTo(today()) }, 'Σήμερα'),
          el('button.btn', { type: 'button', 'aria-label': 'Επόμενη ημέρα', onclick: () => goTo(shiftDate(date, 1)) }, '›')),
        el('form.m-form', { onsubmit: guard(async (ev) => {
          ev.preventDefault();
          if (!account.value) throw new Error('Πρόσθεσε πρώτα έναν λογαριασμό.');
          await api('/cashbox/movements', { method: 'POST', body: {
            date, kind: kind.value(), amountCents: positive(amount), accountId: account.value, description: description.value, category: category.value,
          } });
          rememberAccount(account.value);
          toast(kind.value() === 'in' ? 'Το έσοδο καταχωρήθηκε.' : 'Το έξοδο καταχωρήθηκε.');
          amount.value = ''; description.value = ''; category.value = '';
          amount.focus();
          refresh();
        }) },
        el('div.wide', {}, kind.node), amount, account,
        description, category,
        el('button.btn.primary.wide', { type: 'submit' }, 'Καταχώρηση κίνησης')),
        dayBody, chart.node, monthBox)));
    await refresh();
  },
};
