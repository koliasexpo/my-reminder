import { MONTHS, api, catVar, el, fmtDate, fmtMoney, guard, iso, today, daysUntil } from '../ui.js';
import { openEntry } from '../entry-dialog.js';
import { openImport } from '../excel-import.js';
import { poll } from '../notifications.js';
import { completePending, editPending } from './pending.js';

const DAYS = ['Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ', 'Κυρ'];
const MAX_CHIPS = 3;
const MAX_NEXT = 5;
const state = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: null, showOverdue: false };

const toneOf = (n) => (n < 0 ? 'late' : n === 0 ? 'today' : n <= 7 ? 'soon' : '');
const dayWord = (n) => `${Math.abs(n) === 1 ? 'μέρα' : 'μέρες'}${n < 0 ? ' πριν' : ''}`;

function ticket(e, refresh) {
  const n = daysUntil(e.date);
  const tone = toneOf(n);
  return el('button.tear' + (tone ? '.' + tone : ''), { type: 'button', onclick: () => openEntry(e, refresh) },
    el('div.count', {}, el('b', {}, String(Math.abs(n))), el('span', {}, dayWord(n))),
    el('div.tear-body', {},
      el('div.tear-title', {}, e.title),
      el('div.tear-meta', {}, el('span.tag', { style: catVar(e.category) }, e.category), ` ${fmtDate(e.date)}${e.time ? ' ' + e.time : ''}${e.location ? ', ' + e.location : ''}`)));
}

function pendingTicket(p, accounts, refresh) {
  const n = p.dueDate ? daysUntil(p.dueDate) : null;
  const tone = n === null ? '' : toneOf(n);
  const pay = p.kind === 'pay';
  return el('div.tear.p-tear' + (tone ? '.' + tone : ''), {},
    el('div.count', {},
      el('b', {}, n === null ? '–' : String(Math.abs(n))),
      el('span', {}, n === null ? 'χωρίς' : dayWord(n))),
    el('button.p-main.tear-body', { type: 'button', onclick: () => editPending(p, refresh) },
      el('div.tear-title', {}, p.title),
      el('div.tear-meta', {},
        p.amountCents !== null && el('span.tag.' + (pay ? 'pay' : 'collect'), {}, (pay ? '−' : '+') + fmtMoney(p.amountCents)),
        p.dueDate ? ` έως ${fmtDate(p.dueDate)}` : '')),
    el('label.p-check', { title: 'Ολοκλήρωση' }, el('input', { type: 'checkbox', 'aria-label': `Ολοκλήρωση: ${p.title}`,
      onchange: guard((ev) => { ev.target.disabled = true; return completePending(p, accounts, refresh); }) })));
}

function grid(entries, refresh) {
  const first = new Date(state.year, state.month, 1);
  const start = new Date(state.year, state.month, 1 - ((first.getDay() + 6) % 7));
  const now = today();
  const byDay = Map.groupBy(entries, (e) => e.date);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (i === 35 && d.getMonth() !== state.month) break;
    const key = iso(d);
    const list = byDay.get(key) ?? [];
    const cls = ['day', d.getMonth() !== state.month && 'other', key === now && 'today', key === state.selected && 'selected'].filter(Boolean).join('.');
    cells.push(el('div.' + cls, {
      role: 'button', tabIndex: 0, 'aria-label': `${fmtDate(key)}, ${list.length} καταχωρήσεις`,
      onclick: () => { state.selected = state.selected === key ? null : key; refresh(); },
      onkeydown: (ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) { state.selected = key; refresh(); } },
    },
    el('span.day-num', {}, String(d.getDate())),
    list.slice(0, MAX_CHIPS).map((e) => el('button.chip' + (e.done && e.category !== 'Έξοδο' ? '.done' : ''), {
      type: 'button', style: catVar(e.category), title: e.title,
      onclick: (ev) => { ev.stopPropagation(); openEntry(e, refresh); },
    }, e.title)),
    list.length > MAX_CHIPS && el('span.more', {}, `+${list.length - MAX_CHIPS} ακόμη`),
    list.length > 0 && el('span.dots', {}, list.slice(0, 4).map((e) => el('i', { style: catVar(e.category) })))));
  }
  return el('div.cal', {}, DAYS.map((d) => el('div.dow', {}, d)), cells);
}

export default {
  id: 'calendar',
  title: 'Ημερολόγιο',
  async render(root, actions) {
    const refresh = guard(async () => {
      const [entries, pendings, { accounts }] = await Promise.all([api('/entries'), api('/pending'), api('/cashbox')]);
      const openPending = pendings.filter((p) => !p.done);
      poll();
      const open = entries.filter((e) => !e.done);
      const go = (delta) => {
        const d = new Date(state.year, state.month + delta, 1);
        state.year = d.getFullYear(); state.month = d.getMonth();
        refresh();
      };
      const shown = state.selected ? entries.filter((e) => e.date === state.selected) : open.filter((e) => daysUntil(e.date) >= 0).slice(0, MAX_NEXT);
      const overdue = open.filter((e) => daysUntil(e.date) < 0).reverse();
      const newEntry = () => openEntry(null, refresh, { date: state.selected ?? undefined });

      root.replaceChildren(el('div.cal-layout', {},
        el('section', {},
          el('div.cal-head', {},
            el('h2', {}, `${MONTHS[state.month]} ${state.year}`),
            el('button.btn', { type: 'button', onclick: () => go(-1), 'aria-label': 'Προηγούμενος μήνας' }, '‹'),
            el('button.btn', { type: 'button', onclick: () => { const n = new Date(); state.year = n.getFullYear(); state.month = n.getMonth(); state.selected = null; refresh(); } }, 'Σήμερα'),
            el('button.btn', { type: 'button', onclick: () => go(1), 'aria-label': 'Επόμενος μήνας' }, '›')),
          grid(entries, refresh)),
        el('section.rail', {},
          !state.selected && overdue.length > 0 && el('button.overdue-btn', {
            type: 'button', 'aria-expanded': String(state.showOverdue),
            onclick: () => { state.showOverdue = !state.showOverdue; refresh(); },
          }, `Έληξαν (${overdue.length})`, el('span', {}, state.showOverdue ? 'Απόκρυψη' : 'Εμφάνιση')),
          !state.selected && state.showOverdue && overdue.map((e) => ticket(e, refresh)),
          el('div.rail-head', {},
            el('h2', {}, state.selected ? fmtDate(state.selected) : 'Επόμενα'),
            state.selected && el('button.btn.link', { type: 'button', onclick: () => { state.selected = null; refresh(); } }, 'Όλα τα επόμενα')),
          shown.length ? shown.map((e) => ticket(e, refresh)) : el('div.empty', {},
            el('p', {}, state.selected ? 'Τίποτα αυτή την ημέρα.' : 'Πρόσθεσε το πρώτο domain, ανανέωση ή ραντεβού.'),
            el('button.btn.primary', { type: 'button', onclick: newEntry }, 'Νέα καταχώρηση')),
          el('div.rail-head.rail-second', {},
            el('h2', {}, 'Εκκρεμότητες'),
            el('a.btn.link', { href: '#/pending' }, openPending.length > MAX_NEXT ? `Όλες (${openPending.length})` : 'Όλες')),
          openPending.length ? openPending.slice(0, MAX_NEXT).map((p) => pendingTicket(p, accounts, refresh))
            : el('div.empty', {}, 'Καμία ανοιχτή εκκρεμότητα.'))));

      actions.replaceChildren(
        el('button.btn.primary', { type: 'button', onclick: newEntry }, 'Νέα καταχώρηση'),
        el('button.btn', { type: 'button', onclick: () => openImport(refresh) }, 'Εισαγωγή Excel'));
    });
    await refresh();
  },
};
