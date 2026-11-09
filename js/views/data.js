// Δεδομένα: εισαγωγή από τον υπολογιστή και αντίγραφο ασφαλείας του κινητού.
import { confirmDialog, el, guard, saveAs, today, toast } from '../ui.js';
import { exportBytes, replaceWith } from '../local/db.js';

const box = (title, text, ...kids) => el('section.data-box', {}, el('h2', {}, title), el('p', {}, text), el('div.dlg-actions', {}, ...kids));

export default {
  id: 'data',
  title: 'Δεδομένα',
  async render(root) {
    const picker = el('input', { type: 'file', hidden: true, onchange: guard(async () => {
      const file = picker.files[0]; picker.value = '';
      if (!file) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      confirmDialog('Τα δεδομένα του κινητού θα αντικατασταθούν από αυτά του αρχείου. Να συνεχίσω;', 'Αντικατάσταση', async () => {
        await replaceWith(bytes);
        toast('Τα δεδομένα μεταφέρθηκαν.');
        setTimeout(() => { location.hash = '#/calendar'; location.reload(); }, 600);
      });
    }) });

    root.append(el('div.data-page', {},
      box('Μεταφορά από τον υπολογιστή',
        'Στον υπολογιστή, διπλό κλικ στο «για-κινητό.bat». Φτιάχνει στην Επιφάνεια εργασίας το αρχείο my-reminder-kinito.db. Στείλ’ το στο κινητό (π.χ. Viber, email, Drive) και διάλεξέ το εδώ. Ό,τι υπάρχει στο κινητό αντικαθίσταται.',
        el('button.btn.primary', { type: 'button', onclick: () => picker.click() }, 'Εισαγωγή αρχείου'), picker),
      box('Αντίγραφο ασφαλείας',
        'Τα δεδομένα ζουν μόνο σε αυτό το κινητό. Κράτα κάθε τόσο ένα αντίγραφο. Το ίδιο αρχείο επαναφέρεται με την «Εισαγωγή αρχείου».',
        el('button.btn', { type: 'button', onclick: guard(() => saveAs(`my-reminder-${today()}.db`, exportBytes())) }, 'Λήψη αντιγράφου'))));
  },
};
