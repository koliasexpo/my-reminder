// Ταμείο: ξεχωριστή ενότητα. Μιλά μόνο με το /api/cashbox.
import { api, fail, growInput, categoryInput, confirmDialog, dateField, dialog, el, fill, fmtDate, fmtMoney, fmtPlain, guard, lastAccount, loadCategories, parseMoney, rememberAccount, toast, today } from '../ui.js';
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

// Κάθε τετράγωνο ανοίγει μια δική του οθόνη. Όταν κλείνει, η αρχική οθόνη ανανεώνεται.
function screen(title, build, onClose) {
  const d = dialog('center', (close) => el('div.dlg.screen', {},
    el('div.screen-head', {},
      el('button.btn.back', { type: 'button', 'aria-label': 'Πίσω', onclick: close }, '‹'),
      el('h2', {}, title)),
    build(close)));
  d.addEventListener('close', onClose);
}

const ICON = {
  add: 'M12 5v14M5 12h14',
  in: 'M12 19V5M6 11l6-6 6 6',
  out: 'M12 5v14M6 13l6 6 6-6',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
};
function tileIcon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON[id]);
  svg.append(path);
  return svg;
}

export default {
  id: 'cashbox',
  title: 'Ταμείο',
  async render(root) {
    let accounts = [];
    const dash = el('div.cash-dash');

    const refresh = guard(async () => {
      const s = await api('/cashbox');
      accounts = s.accounts;
      fill(dash,
        el('section.grand.hero', {}, el('span', {}, 'Διαθέσιμα χρήματα'), el('b', { id: 'cash-total' }, fmtMoney(s.totalCents))),
        el('button.cash-exp', { type: 'button', onclick: () => expectedScreen(s) },
          el('span.exp-cell', {}, el('small', {}, 'Να εισπράξω'), el('b.collect', { id: 'cash-collect' }, '+' + fmtMoney(s.collectCents))),
          el('span.exp-cell', {}, el('small', {}, 'Να πληρώσω'), el('b.pay', { id: 'cash-pay' }, '−' + fmtMoney(s.payCents))),
          el('span.exp-cell.final', {}, el('small', {}, 'Μετά τα αναμενόμενα'), el('b', { id: 'cash-projected' }, fmtMoney(s.projectedCents)))),
        el('div.tiles', {},
          tile('add', 'Προσθήκη χρημάτων', 'Υπόλοιπα λογαριασμών', accountsScreen),
          tile('in', 'Έσοδο', 'Νέα είσπραξη', () => movementScreen('in')),
          tile('out', 'Έξοδο', 'Νέα πληρωμή', () => movementScreen('out')),
          tile('list', 'Κινήσεις', 'Ανά ημέρα και μήνα', movementsScreen)));
    });

    const tile = (icon, label, hint, onclick) => el('button.tile.t-' + icon, { type: 'button', onclick: guard(onclick) },
      tileIcon(icon), el('b', {}, label), el('small', {}, hint));

    function expectedScreen(s) {
      screen('Αναμενόμενα', () => el('div', {},
        el('dl.proj', { style: 'margin-top:0' },
          el('dt', {}, 'Διαθέσιμα τώρα'), el('dd', {}, fmtMoney(s.totalCents)),
          el('dt', {}, 'Να πληρώσω'), el('dd', {}, '−' + fmtMoney(s.payCents)),
          el('dt', {}, 'Να εισπράξω'), el('dd', {}, '+' + fmtMoney(s.collectCents)),
          el('dt.final', {}, 'Μετά τα αναμενόμενα'), el('dd.final', {}, fmtMoney(s.projectedCents))),
        expectedChart(s.expected)), refresh);
    }

    function accountsScreen() {
      const body = el('div');
      const paint = (s) => {
        accounts = s.accounts;
        const name = el('input', { placeholder: 'Νέος λογαριασμός', 'aria-label': 'Όνομα νέου λογαριασμού' });
        fill(body,
          el('p.hint', {}, 'Πάτα σε ένα ποσό για να το αλλάξεις.'),
          el('section.ledger', {},
            el('div.grand', {}, el('span', {}, 'Σύνολο'), el('b', {}, fmtMoney(s.totalCents))),
            accounts.map((a) => {
              const input = el('input', { value: fmtPlain(a.balanceCents), inputMode: 'decimal', 'aria-label': `Υπόλοιπο ${a.name}`,
                onfocus: (e) => e.target.select(),
                onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
                onchange: guard(async (e) => {
                  const cents = parseMoney(e.target.value);
                  if (cents === null) { e.target.value = fmtPlain(a.balanceCents); throw new Error('Το ποσό δεν είναι έγκυρο. Γράψε π.χ. 1.250,50.'); }
                  paint(await api(`/cashbox/accounts/${a.id}`, { method: 'PUT', body: { balanceCents: cents } }));
                  toast(`${a.name}: αποθηκεύτηκε.`);
                }) });
              return el('div.acc', {}, el('span', {}, a.name), input,
                el('button.x', { type: 'button', 'aria-label': `Διαγραφή ${a.name}`, onclick: () =>
                  confirmDialog(`Να διαγραφεί ο λογαριασμός «${a.name}»; Το υπόλοιπό του ${fmtMoney(a.balanceCents)} θα αφαιρεθεί από το σύνολο.`, 'Διαγραφή',
                    async () => { paint(await api(`/cashbox/accounts/${a.id}`, { method: 'DELETE' })); }) }, '×'));
            }),
            el('form.acc-add', { onsubmit: guard(async (e) => {
              e.preventDefault();
              paint(await api('/cashbox/accounts', { method: 'POST', body: { name: name.value } }));
            }) }, name, el('button.btn', { type: 'submit' }, 'Προσθήκη'))));
      };
      screen('Λογαριασμοί', () => body, refresh);
      api('/cashbox').then(paint).catch(fail);
    }

    async function movementScreen(kind) {
      await loadCategories();
      if (!accounts.length) throw new Error('Πρόσθεσε πρώτα έναν λογαριασμό από το «Προσθήκη χρημάτων».');
      const amount = el('input', { placeholder: '0,00', inputMode: 'decimal', 'aria-label': 'Ποσό', class: 'big-amount' });
      const account = el('select', { 'aria-label': 'Λογαριασμός' }, options(accounts, lastAccount()));
      const date = dateField({ value: today(), required: true });
      const description = el('input', { placeholder: 'π.χ. Βενζίνη', 'aria-label': 'Περιγραφή' });
      const category = categoryInput('', 'Κατηγορία');
      screen(kind === 'in' ? 'Νέο έσοδο' : 'Νέο έξοδο', (close) => el('form.m-sheet', { onsubmit: guard(async (ev) => {
        ev.preventDefault();
        await api('/cashbox/movements', { method: 'POST', body: {
          date: date.value, kind, amountCents: positive(amount), accountId: account.value, description: description.value, category: category.value,
        } });
        rememberAccount(account.value);
        toast(kind === 'in' ? 'Το έσοδο καταχωρήθηκε.' : 'Το έξοδο καταχωρήθηκε.');
        close();
      }) },
      el('label.field', {}, 'Ποσό (€)', amount),
      el('label.field', {}, 'Λογαριασμός', account),
      el('label.field', {}, 'Ημερομηνία', date),
      el('label.field', {}, 'Περιγραφή', description),
      el('label.field', {}, 'Κατηγορία', category),
      el('button.btn.primary', { type: 'submit' }, kind === 'in' ? 'Καταχώρηση εσόδου' : 'Καταχώρηση εξόδου')), refresh);
      setTimeout(() => amount.focus(), 50);
    }

    function movementsScreen() {
      let date = today();
      let monthOpen = false;
      const dayBody = el('div');
      const monthBox = el('section.chart-card');
      const chart = cashChart();
      const dateInput = dateField({ value: date, required: true, label: 'Ημέρα', onchange: (v) => { if (v) goTo(v); } });

      function rowOf(m, withDate) {
        const kindClass = m.kind === 'in' ? 'collect' : 'pay';
        const label = m.description || (m.kind === 'in' ? 'Έσοδο' : 'Έξοδο');
        const locked = m.pendingId || m.entryId;
        const meta = [withDate && fmtDate(m.date), m.category, m.accountName, m.pendingId && 'από εκκρεμότητα', m.entryId && 'από Ημερολόγιο', m.note].filter(Boolean).join(', ');
        const text = [el('span.p-title', {}, label), el('span.p-meta', {}, meta)];
        return el('div.m-row', {},
          locked ? el('div', {}, text) : el('button.p-main', { type: 'button', onclick: () => editMovement(m, accounts, load) }, text),
          el('span.amount.' + kindClass, {}, (m.kind === 'in' ? '+' : '−') + fmtMoney(m.amountCents)),
          locked ? el('span') : el('button.x', { type: 'button', 'aria-label': `Διαγραφή κίνησης ${label}`, onclick: () =>
            confirmDialog(`Να διαγραφεί η κίνηση «${label}»; Το υπόλοιπο του λογαριασμού θα διορθωθεί.`, 'Διαγραφή', async () => {
              const { restored } = await api(`/cashbox/movements/${m.id}`, { method: 'DELETE' });
              if (!restored) toast('Ο λογαριασμός έχει διαγραφεί, το υπόλοιπο δεν άλλαξε.', true);
              load();
            }) }, '×'));
      }

      const load = guard(async () => {
        const d = await api(`/cashbox/movements?date=${date}`);
        fill(dayBody,
          el('div.sums', {},
            el('div.sum', {}, el('b', {}, fmtMoney(d.inCents)), el('span', {}, 'έσοδα')),
            el('div.sum', {}, el('b', {}, fmtMoney(d.outCents)), el('span', {}, 'έξοδα')),
            el('div.sum', {}, el('b', {}, fmtMoney(d.netCents)), el('span', {}, 'διαφορά'))),
          d.items.length ? el('div', {}, d.items.map((m) => rowOf(m)))
            : el('div.empty', {}, `Καμία κίνηση στις ${fmtDate(d.date)}.`));
        const { items } = await api(`/cashbox/movements?month=${date.slice(0, 7)}`);
        fill(monthBox, el('details.expected', { open: monthOpen, ontoggle: (e) => { monthOpen = e.target.open; } },
          el('summary', {}, el('span', {}, 'Όλες οι κινήσεις του μήνα'), el('b', {}, String(items.length))),
          items.length ? el('div.expected-rows', { style: 'gap:0' }, items.map((m) => rowOf(m, true)))
            : el('p.expected-empty', {}, 'Καμία κίνηση αυτόν τον μήνα.')));
        await chart.load(date);
      });
      function goTo(next) { date = next; dateInput.value = next; load(); }

      screen('Κινήσεις', () => el('div', {},
        el('div.day-nav', {},
          el('button.btn', { type: 'button', 'aria-label': 'Προηγούμενη ημέρα', onclick: () => goTo(shiftDate(date, -1)) }, '‹'),
          dateInput,
          el('button.btn', { type: 'button', onclick: () => goTo(today()) }, 'Σήμερα'),
          el('button.btn', { type: 'button', 'aria-label': 'Επόμενη ημέρα', onclick: () => goTo(shiftDate(date, 1)) }, '›')),
        dayBody, monthBox, chart.node), refresh);
      load();
    }

    root.replaceChildren(dash);
    await refresh();
  },
};
