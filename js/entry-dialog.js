// Παράθυρο καταχώρησης: στοιχεία, σχόλια, αρχεία.
import { EVENT_CATEGORY, INCOME_SOURCES, SUPPORT_CATEGORY, api, growInput, confirmDialog, dateField, dialog, el, fail, fmtDate, fmtMoney, fmtPlain, fmtStamp, guard, parseMoney, timeField, toast, today, whenText } from './ui.js';
import { extractText, toBase64 } from './extract.js';
import { eventPayments } from './event-payments.js';
import { commentFile } from './local/api.js';
import { saveAs } from './ui.js';

export const CATEGORIES = ['Domain', 'Φιλοξενία', 'Ραντεβού', EVENT_CATEGORY, SUPPORT_CATEGORY, 'Άλλο'];
const REMINDERS = [[30, '30 μέρες πριν'], [14, '14 μέρες πριν'], [7, '7 μέρες πριν'], [3, '3 μέρες πριν'], [1, '1 μέρα πριν'], [0, 'Την ημέρα']];
const MAX_FILE = 25 * 1024 * 1024;

function moneyField(input, label) {
  if (!input.value.trim()) return null;
  const c = parseMoney(input.value);
  if (c === null || c < 0) throw new Error(`${label}: γράψε θετικό ποσό, π.χ. 1.200,50.`);
  return c;
}
const WEEKDAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const MAX_WEEKS = 110;
const toUtc = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

// Κάθε εβδομάδα γίνεται ξεχωριστή καταχώρηση, ώστε κάθε φορά να έχει τη δική της είσπραξη.
function weeklyDates(from, until) {
  const out = [];
  if (!from || !until) return out;
  const end = toUtc(until).getTime();
  for (let t = toUtc(from).getTime(); t <= end && out.length < MAX_WEEKS; t += 7 * 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const moneyValue = (c) => (c === null || c === undefined ? '' : fmtPlain(c));

export function openEntry(entry, onChange, defaults = {}) {
  const e = entry ?? { title: '', date: defaults.date ?? today(), time: '', category: '', notes: '', repeat: 'none', remind: [30, 7, 1, 0] };

  dialog('drawer', (close) => {
    const f = {
      title: growInput({ value: e.title, required: true, maxLength: 200, autocomplete: 'off', name: 'title' }),
      date: dateField({ value: e.date, required: true, name: 'date' }),
      time: timeField({ value: e.time, name: 'time' }),
      category: el('input', { value: e.category, list: 'cat-list', name: 'category' }),
      repeat: el('select', { name: 'repeat' },
        [['none', 'Χωρίς επανάληψη'], ['weekly', 'Κάθε εβδομάδα'], ['monthly', 'Κάθε μήνα'], ['yearly', 'Κάθε χρόνο']].map(([v, t]) => el('option', { value: v, selected: e.repeat === v }, t))),
      notes: el('textarea', { value: e.notes, rows: 2, name: 'notes' }),
    };
    const untilDefault = new Date(toUtc(e.date).getTime() + 182 * 86400000).toISOString().slice(0, 10);
    const weeklyInfo = el('p.remaining');
    const syncWeekly = () => {
      weeklyBox.hidden = f.repeat.value !== 'weekly';
      const dates = weeklyDates(f.date.value, until.value);
      weeklyInfo.textContent = dates.length ? `Κάθε ${WEEKDAYS[toUtc(f.date.value).getUTCDay()]}, ${dates.length === 1 ? '1 καταχώρηση' : `${dates.length} καταχωρήσεις`}` : 'Η λήξη είναι πριν την ημερομηνία.';
    };
    const until = dateField({ value: untilDefault, name: 'until', onchange: () => syncWeekly() });
    const weeklyBox = el('div.wide', { hidden: true },
      el('label.field', {}, 'Επανάληψη έως', until), weeklyInfo);
    f.repeat.addEventListener('change', syncWeekly);
    f.date.addEventListener('change', syncWeekly);
    const extra = e.remind.filter((n) => !REMINDERS.some(([d]) => d === n));
    const boxes = [...REMINDERS, ...extra.map((n) => [n, `${n} μέρες πριν`])].map(([days, text]) => {
      const box = el('input', { type: 'checkbox', checked: e.remind.includes(days), value: days });
      return { box, label: el('label', {}, box, text) };
    });

    const ev2 = {
      location: growInput({ value: e.location ?? '', name: 'location' }),
      phone: el('input', { value: e.phone ?? '', type: 'tel', name: 'phone' }),
      cost: el('input', { value: moneyValue(e.costCents), inputMode: 'decimal', name: 'cost' }),
      deposit: el('input', { value: moneyValue(e.depositCents), inputMode: 'decimal', name: 'deposit' }),
      doneActions: el('textarea', { value: e.doneActions ?? '', rows: 2, name: 'doneActions' }),
      todoActions: el('textarea', { value: e.todoActions ?? '', rows: 2, name: 'todoActions' }),
    };
    const remaining = el('p.remaining');
    const showRemaining = () => {
      const cost = parseMoney(ev2.cost.value), dep = parseMoney(ev2.deposit.value);
      remaining.textContent = ev2.cost.value.trim() && cost !== null && dep !== null ? `Υπόλοιπο: ${fmtMoney(cost - dep)}` : '';
    };
    ev2.cost.addEventListener('input', showRemaining);
    ev2.deposit.addEventListener('input', showRemaining);
    showRemaining();
    const eventBox = el('div.form-grid', {},
      el('label.field', {}, 'Τοποθεσία', ev2.location),
      el('label.field', {}, 'Τηλ. επικοινωνίας', ev2.phone),
      el('label.field.wide', {}, 'Ενέργειες που έχουν γίνει', ev2.doneActions),
      el('label.field.wide', {}, 'Ενέργειες που απομένουν', ev2.todoActions));
    const income = {
      has: el('input', { type: 'checkbox', checked: !!e.hasIncome, name: 'has-income' }),
      source: el('select', { name: 'income-source' }, INCOME_SOURCES.map((c) => el('option', { value: c, selected: c === (e.incomeSource || 'Άλλο') }, c))),
      what: growInput({ value: e.incomeWhat ?? '', name: 'income-what', placeholder: 'π.χ. ετήσια ανανέωση' }),
      account: el('select', { name: 'income-account' }, el('option', { value: '' }, 'Θα το δω στην είσπραξη')),
    };
    api('/cashbox').then(({ accounts }) => income.account.append(...accounts.map((a) =>
      el('option', { value: a.id, selected: a.id === e.incomeAccountId }, a.name)))).catch(() => {});
    const payments = e.id ? eventPayments(e, () => ({ cost: parseMoney(ev2.cost.value), deposit: parseMoney(ev2.deposit.value) }), onChange) : null;
    ev2.deposit.addEventListener('change', () => payments?.reload());
    ev2.cost.addEventListener('change', () => payments?.reload());
    const incomeFields = el('div.form-grid', {},
      el('label.field', {}, 'Από πού', income.source),
      el('label.field', {}, 'Πώς θα εισπραχθεί', income.account),
      el('label.field.wide', {}, 'Τι αφορά', income.what),
      el('label.field', {}, 'Τελικό ποσό (€)', ev2.cost),
      el('label.field', {}, 'Προκαταβολή (€)', ev2.deposit),
      el('div.wide', {}, remaining),
      el('div.wide', {}, payments ?? el('p', { style: 'color:var(--muted);font-size:14px' }, 'Οι εισπράξεις τσεκάρονται μετά την αποθήκευση.')));
    const incomeBox = el('div', { style: 'display:grid;gap:12px' },
      el('label.pay-row', {}, income.has, el('span', {}, 'Έχει έσοδα')), incomeFields);
    const SOURCE_OF = { Domain: 'Hosting / Domain', 'Φιλοξενία': 'Hosting / Domain', [EVENT_CATEGORY]: 'Events', [SUPPORT_CATEGORY]: 'Support Now' };
    const syncEvent = () => {
      const category = f.category.value.trim();
      eventBox.hidden = category !== EVENT_CATEGORY;
      if (!e.id && SOURCE_OF[category]) income.source.value = SOURCE_OF[category];
      if (!e.id && (category === EVENT_CATEGORY || category === SUPPORT_CATEGORY)) income.has.checked = true;
      incomeFields.hidden = !income.has.checked;
    };
    income.has.addEventListener('change', syncEvent);
    f.category.addEventListener('input', syncEvent);
    syncEvent();

    const save = guard(async (ev) => {
      ev.preventDefault();
      if (!income.has.checked && payments?.hasPaid()) throw new Error('Υπάρχουν εισπράξεις. Αναίρεσέ τες πρώτα για να βγάλεις το «Έχει έσοδα».');
      const body = {
        hasIncome: income.has.checked, incomeSource: income.source.value, incomeWhat: income.what.value, incomeAccountId: income.account.value,
        location: ev2.location.value, phone: ev2.phone.value,
        costCents: moneyField(ev2.cost, 'Τελικό κόστος'), depositCents: moneyField(ev2.deposit, 'Προκαταβολή'),
        doneActions: ev2.doneActions.value, todoActions: ev2.todoActions.value,
        title: f.title.value, date: f.date.value, time: f.time.value, category: f.category.value,
        repeat: f.repeat.value, notes: f.notes.value,
        remind: boxes.filter((b) => b.box.checked).map((b) => Number(b.box.value)),
      };
      if (body.repeat === 'weekly') {
        const dates = weeklyDates(body.date, until.value);
        if (!dates.length) throw new Error('Διάλεξε ημερομηνία λήξης μετά την ημερομηνία της καταχώρησης.');
        body.repeat = 'none';
        if (e.id) await api(`/entries/${e.id}`, { method: 'PUT', body });
        const rest = e.id ? dates.slice(1) : dates;
        await api('/entries/bulk', { method: 'POST', body: { items: rest.map((date) => ({ ...body, date })) } });
        toast(`Δημιουργήθηκαν ${dates.length === 1 ? '1 καταχώρηση' : `${dates.length} καταχωρήσεις`}.`);
      } else {
        await (e.id ? api(`/entries/${e.id}`, { method: 'PUT', body }) : api('/entries', { method: 'POST', body }));
        toast(e.id ? 'Οι αλλαγές αποθηκεύτηκαν.' : 'Η καταχώρηση αποθηκεύτηκε.');
      }
      onChange();
      close();
    });

    const markDone = guard(async () => {
      const u = await api(`/entries/${e.id}/done`, { method: 'POST', body: { done: !e.done } });
      toast(e.repeat !== 'none' && !e.done ? `Επόμενη φορά: ${fmtDate(u.date)}.` : e.done ? 'Άνοιξε ξανά.' : 'Ολοκληρώθηκε.');
      onChange();
      close();
    });

    const remove = () => confirmDialog(`Να διαγραφεί η καταχώρηση «${e.title}» με τα σχόλια και τα αρχεία της;${e.category === EVENT_CATEGORY ? ' Όσες εισπράξεις έχουν γίνει μένουν στο Ταμείο.' : ''}`, 'Διαγραφή', async () => {
      await api(`/entries/${e.id}`, { method: 'DELETE' });
      toast('Η καταχώρηση διαγράφηκε.');
      onChange();
      close();
    });

    return el('div.dlg', {},
      el('div.dlg-head', {},
        el('h2', {}, e.id ? e.title : 'Νέα καταχώρηση'),
        el('button.btn', { type: 'button', onclick: close }, 'Κλείσιμο')),
      e.id && el('p', { style: 'color:var(--muted)' }, e.done ? 'Ολοκληρωμένη' : `${fmtDate(e.date)}, ${whenText(e.date)}`),
      el('form', { onsubmit: save, style: 'display:grid;gap:16px' },
        el('div.form-grid', {},
          el('label.field.wide', {}, f.category.value.trim() === EVENT_CATEGORY ? 'Ονοματεπώνυμο' : 'Τίτλος', f.title),
          el('label.field', {}, 'Ημερομηνία', f.date),
          el('label.field', {}, 'Ώρα 24ώρου (προαιρετικά)', f.time),
          el('label.field', {}, 'Κατηγορία', f.category,
            el('datalist', { id: 'cat-list' }, CATEGORIES.map((c) => el('option', { value: c })))),
          el('label.field', {}, 'Επανάληψη', f.repeat),
          weeklyBox,
          el('label.field.wide', {}, 'Σημειώσεις', f.notes),
          el('fieldset.wide', {}, el('legend', {}, 'Ειδοποίηση'), el('div.checks', {}, boxes.map((b) => b.label)))),
        eventBox, incomeBox,
        el('div.dlg-actions', {},
          el('button.btn.primary', { type: 'submit' }, e.id ? 'Αποθήκευση αλλαγών' : 'Αποθήκευση'),
          e.id && el('button.btn', { type: 'button', onclick: markDone },
            e.done ? 'Άνοιγμα ξανά' : e.repeat === 'none' ? 'Ολοκλήρωση' : 'Ολοκλήρωση και επόμενη φορά'),
          e.id && el('button.btn.danger.push', { type: 'button', onclick: remove }, 'Διαγραφή'))),
      e.id ? commentsPanel(e, onChange) : el('p', { style: 'color:var(--muted);font-size:14px' }, 'Σχόλια και αρχεία προστίθενται μετά την αποθήκευση.'));
  });
}

function commentsPanel(e, onChange) {
  const list = el('div');
  const status = el('p.progress', { hidden: true });
  const text = el('textarea', { rows: 2, placeholder: 'Γράψε ένα σχόλιο', 'aria-label': 'Σχόλιο' });
  const picker = el('input', { type: 'file', multiple: true, hidden: true, onchange: () => { upload([...picker.files]); picker.value = ''; } });

  const load = guard(async () => {
    const rows = await api(`/entries/${e.id}/comments`);
    list.replaceChildren(...rows.map((c) => el('article.comment', {},
      el('div.comment-meta', {},
        el('span', {}, fmtStamp(c.created_at)),
        c.file_name && el('a', { href: '#', onclick: guard((ev) => { ev.preventDefault(); const f = commentFile(c.id); saveAs(f.name, f.data); }) }, c.file_name),
        el('button.btn.link', { type: 'button', onclick: () => confirmDialog('Να διαγραφεί το σχόλιο;', 'Διαγραφή', async () => {
          await api(`/comments/${c.id}`, { method: 'DELETE' });
          onChange(); load();
        }) }, 'Διαγραφή')),
      c.body && el('div.comment-body', {}, c.body),
      c.extract_note && el('p.comment-note', {}, c.extract_note))));
  });

  const send = guard(async () => {
    await api(`/entries/${e.id}/comments`, { method: 'POST', body: { body: text.value } });
    text.value = '';
    onChange(); load();
  });

  async function upload(files) {
    for (const file of files) {
      if (file.size > MAX_FILE) { fail(new Error(`Το ${file.name} ξεπερνά τα 25 MB.`)); continue; }
      status.hidden = false;
      status.textContent = `Μετατροπή του ${file.name}…`;
      const { text: body, note } = await extractText(file, (s) => { status.textContent = `${file.name}: ${s}`; });
      try {
        await api(`/entries/${e.id}/comments`, { method: 'POST', body: {
          body, fileName: file.name, fileMime: file.type, extractNote: note, data: toBase64(await file.arrayBuffer()),
        } });
        toast(`Το ${file.name} προστέθηκε.`);
      } catch (err) { fail(err); }
    }
    status.hidden = true;
    onChange(); load();
  }

  const drop = el('div.drop', {
    ondragover: (ev) => { ev.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: (ev) => { ev.preventDefault(); drop.classList.remove('over'); upload([...ev.dataTransfer.files]); },
  }, el('button.btn', { type: 'button', onclick: () => picker.click() }, 'Προσθήκη αρχείου'),
  'ή σύρε το εδώ. PDF, Word, Excel, PowerPoint, κείμενο, εικόνες.', picker);

  load();
  return el('section', { style: 'display:grid;gap:10px' },
    el('h3.section-title', {}, 'Σχόλια'), text,
    el('div.dlg-actions', {}, el('button.btn.primary', { type: 'button', onclick: send }, 'Προσθήκη σχολίου')),
    drop, status, list);
}
