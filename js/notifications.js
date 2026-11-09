// Καμπανάκι, ειδοποιήσεις του κινητού όσο η εφαρμογή είναι ανοιχτή.
import { api, el, fill, fmtDate, guard, whenText } from './ui.js';
import { openEntry } from './entry-dialog.js';

const SEEN_KEY = 'reminder.seen';
const POLL_MS = 60 * 1000;
const bell = document.getElementById('bell');
const count = document.getElementById('bell-count');
const panel = document.getElementById('notif-panel');
let items = [];
let refreshView = () => {};

function loadSeen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) ?? []; } catch { return []; } }
function saveSeen(ids) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-500))); } catch { /* χωρίς μνήμη browser */ } }

const openFrom = guard(async (n) => {
  panel.hidden = true;
  await api('/notifications/read', { method: 'POST', body: { id: n.id } });
  poll();
  openEntry(await api(`/entries/${n.entry_id}`), () => { refreshView(); poll(); });
});

function alertDesktop(unread) {
  const seen = loadSeen();
  const fresh = unread.filter((n) => !seen.includes(n.id));
  if ('Notification' in window && Notification.permission === 'granted') {
    for (const n of fresh.slice(0, 5)) {
      // Στο Android οι ειδοποιήσεις βγαίνουν μόνο μέσω του service worker.
      navigator.serviceWorker?.ready.then((reg) => reg.showNotification(n.title,
        { body: `${fmtDate(n.date)}, ${whenText(n.date)}`, tag: `n${n.id}`, icon: 'icons/icon-192.png', data: { id: n.id } })).catch(() => {});
    }
    saveSeen([...seen, ...fresh.map((n) => n.id)]);
  }
}

function renderPanel() {
  const canAsk = 'Notification' in window && Notification.permission === 'default';
  const blocked = 'Notification' in window && Notification.permission === 'denied';
  fill(panel,
    el('div.n-head', {}, el('b', {}, 'Ειδοποιήσεις'),
      items.some((n) => !n.read_at) && el('button.btn.link', { type: 'button', onclick: guard(async () => {
        await api('/notifications/read', { method: 'POST', body: {} });
        poll();
      }) }, 'Ανάγνωση όλων')),
    canAsk && el('div.n-permission', {}, 'Για να βλέπεις ειδοποιήσεις και στο κινητό: ',
      el('button.btn.link', { type: 'button', onclick: async () => { await Notification.requestPermission(); poll(); } }, 'Ενεργοποίηση')),
    blocked && el('div.n-permission', {}, 'Οι ειδοποιήσεις είναι μπλοκαρισμένες. Ενεργοποίησέ τες από τις ρυθμίσεις της εφαρμογής στο κινητό.'),
    items.length ? items.map((n) => el('button.n-item' + (n.read_at ? '' : '.unread'), { type: 'button', onclick: () => openFrom(n) },
      n.title, el('small', {}, `${fmtDate(n.date)}, ${whenText(n.date)}`))) : el('p', { style: 'padding:12px;color:var(--muted)' }, 'Καμία ειδοποίηση ακόμη.'));
}

export async function poll() {
  try { items = await api('/notifications'); } catch { return; }
  const unread = items.filter((n) => !n.read_at);
  count.hidden = !unread.length;
  count.textContent = unread.length > 99 ? '99+' : unread.length;
  document.title = unread.length ? `(${unread.length}) My Reminder` : 'My Reminder';
  renderPanel();
  alertDesktop(unread);
}

export function startNotifications(onRefresh) {
  refreshView = onRefresh;
  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    bell.setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.addEventListener('click', (e) => { if (!panel.contains(e.target)) panel.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.hidden = true; });
  poll();
  setInterval(poll, POLL_MS);
}
