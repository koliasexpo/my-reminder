// Εισπράξεις από καταχωρήσεις: προκαταβολή και εξόφληση για event, μία είσπραξη για Support Now. Τίποτα δεν περνά στο Ταμείο αν δεν τσεκαριστεί.
import { NOTE_HINT, api, categoryInput, confirmDialog, dateField, dialog, el, fill, fmtDate, fmtMoney, fmtPlain, guard, lastAccount, parseMoney, rememberAccount, toast, today } from './ui.js';

const LABELS = { deposit: 'Εισπράχθηκε η προκαταβολή', final: 'Εισπράχθηκε η εξόφληση', payment: 'Εισπράχθηκαν χρήματα' };

function askPayment(entry, stage, suggested, accounts, reload, onChange, paid = null) {
  const start = paid?.amountCents ?? suggested;
  const amount = el('input', { value: start ? fmtPlain(start) : '', inputMode: 'decimal', name: 'pay-amount' });
  const last = String(paid?.accountId ?? entry.incomeAccountId ?? lastAccount());
  const account = el('select', { name: 'pay-account' }, accounts.map((a) => el('option', { value: a.id, selected: String(a.id) === last }, a.name)));
  const date = dateField({ value: paid?.date ?? today(), required: true, name: 'pay-date' });
  const category = categoryInput(paid?.category ?? (entry.incomeSource || entry.category), 'Κατηγορία');
  const note = el('input', { value: paid?.note ?? '', placeholder: NOTE_HINT, name: 'pay-note' });
  const d = dialog('center', (close) => el('form.dlg', { onsubmit: guard(async (ev) => {
    ev.preventDefault();
    const cents = parseMoney(amount.value);
    if (!amount.value.trim() || cents === null || cents <= 0) throw new Error('Το ποσό πρέπει να είναι θετικός αριθμός, π.χ. 500,00.');
    const body = { stage, amountCents: cents, accountId: account.value, date: date.value, note: note.value, category: category.value };
    if (paid) await api(`/cashbox/event-payments/${entry.id}/${stage}`, { method: 'PUT', body });
    else await api(`/cashbox/event-payments/${entry.id}`, { method: 'POST', body });
    rememberAccount(account.value);
    toast(paid ? 'Η είσπραξη διορθώθηκε.' : `Προστέθηκαν ${fmtMoney(cents)} στο Ταμείο.`);
    onChange();
    close();
  }) },
  el('h2', { style: 'font:600 22px var(--num)' }, LABELS[stage]),
  el('p', { style: 'color:var(--muted)' }, entry.title),
  el('div.form-grid', {},
    el('label.field', {}, 'Ποσό (€)', amount),
    el('label.field', {}, 'Πώς εισπράχθηκαν', account),
    el('label.field', {}, 'Ημερομηνία είσπραξης', date),
    el('label.field', {}, 'Κατηγορία (προαιρετικά)', category),
    el('label.field', {}, 'Σχόλιο (προαιρετικό)', note)),
  el('div.dlg-actions', {},
    el('button.btn.primary', { type: 'submit' }, paid ? 'Αποθήκευση αλλαγών' : 'Καταχώρηση είσπραξης'),
    el('button.btn', { type: 'button', onclick: close }, 'Άκυρο'))));
  d.addEventListener('close', reload);
}

export function eventPayments(entry, amounts, onChange) {
  const box = el('section.pay-box');
  let paidAny = false;

  const load = guard(async () => {
    const [p, { accounts }] = await Promise.all([api(`/cashbox/event-payments/${entry.id}`), api('/cashbox')]);
    const { cost, deposit } = amounts();
    const left = cost === null ? null : Math.max(cost - p.collectedCents, 0);
    const suggest = { deposit: left === null ? deposit : Math.min(deposit ?? 0, left), final: left, payment: left };
    paidAny = p.collectedCents > 0;
    // Με προκαταβολή δύο τικ, αλλιώς ένα. Ό,τι έχει ήδη εισπραχθεί φαίνεται πάντα.
    const wanted = deposit ? ['deposit', 'final'] : ['payment'];
    const stages = ['deposit', 'final', 'payment'].filter((s) => wanted.includes(s) || p[s]);

    const row = (stage) => {
      const paid = p[stage];
      const info = paid
        ? [`${fmtMoney(paid.amountCents)} στις ${fmtDate(paid.date)}`, paid.accountName, paid.note].filter(Boolean).join(', ')
        : suggest[stage] ? `${fmtMoney(suggest[stage])}, δεν έχει περάσει στο Ταμείο` : 'Δεν έχει περάσει στο Ταμείο';
      const box2 = el('input', { type: 'checkbox', checked: !!paid, name: `pay-${stage}`, onchange: () => {
        if (!paid) return askPayment(entry, stage, suggest[stage], accounts, load, onChange);
        confirmDialog(`Να αναιρεθεί η είσπραξη των ${fmtMoney(paid.amountCents)}; Το ποσό θα αφαιρεθεί από το Ταμείο.`, 'Αναίρεση', async () => {
          const { restored } = await api(`/cashbox/event-payments/${entry.id}/${stage}`, { method: 'DELETE' });
          if (!restored) toast('Ο λογαριασμός έχει διαγραφεί, το υπόλοιπο δεν άλλαξε.', true);
          onChange();
        }).addEventListener('close', load);
      } });
      return el('div.pay-line', {},
        el('label.pay-row', {}, box2, el('span', {}, LABELS[stage], el('small', {}, info))),
        paid && el('button.btn.link', { type: 'button', name: `edit-${stage}`,
          onclick: () => askPayment(entry, stage, null, accounts, load, onChange, paid) }, 'Αλλαγή'));
    };

    fill(box,
      el('h3', {}, 'Εισπράξεις'),
      stages.map(row),
      p.collectedCents > 0 && el('p.pay-total', {}, `Εισπράχθηκαν ${fmtMoney(p.collectedCents)}${left ? `, απομένουν ${fmtMoney(left)}` : ''}`));
  });

  load();
  box.reload = load;
  box.hasPaid = () => paidAny;
  return box;
}
