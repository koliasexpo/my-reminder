// Για νέα καρτέλα: ένα αρχείο στο views/ και μία γραμμή εδώ.
import calendar from './views/calendar.js';
import pending from './views/pending.js';
import cashbox from './views/cashbox.js';
import data from './views/data.js';
import { el, fail } from './ui.js';
import { VERSION } from './version.js';
import { poll, startNotifications } from './notifications.js';

const views = [calendar, pending, cashbox, data];
const nav = document.getElementById('nav');
const root = document.getElementById('view');
const actions = document.getElementById('top-actions');
const title = document.getElementById('page-title');

const ICONS = {
  calendar: 'M7 2v3M17 2v3M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  pending: 'M9 6h12M9 12h12M9 18h12M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  cashbox: 'M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2',
  data: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
};
const icon = (id) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[id]);
  svg.append(path);
  return svg;
};
nav.append(...views.map((v) => el('a', { href: '#/' + v.id, id: 'nav-' + v.id }, icon(v.id), el('span', {}, v.title))));

async function show() {
  const view = views.find((v) => '#/' + v.id === location.hash) ?? views[0];
  title.textContent = view.title;
  actions.replaceChildren();
  root.replaceChildren();
  nav.querySelectorAll('a').forEach((a) => a.removeAttribute('aria-current'));
  document.getElementById('nav-' + view.id).setAttribute('aria-current', 'page');
  try { await view.render(root, actions); } catch (e) { fail(e); }
}

window.addEventListener('hashchange', show);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

startNotifications(() => { poll(); show(); });
show();
