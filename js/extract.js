// Μετατροπή αρχείων σε κείμενο, μέσα στον browser. Word, Excel, PowerPoint και απλό κείμενο
// δουλεύουν χωρίς internet. Οι εικόνες και τα σκαναρισμένα PDF χρειάζονται OCR.
const OCR_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MAX_OCR_PAGES = 20;
const TEXT_EXT = ['txt', 'csv', 'tsv', 'md', 'log', 'json', 'xml', 'html', 'htm', 'eml'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'];

const extOf = (name) => name.split('.').pop().toLowerCase();

async function readZip(buffer) {
  const v = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Το αρχείο δεν είναι έγκυρο ή είναι κατεστραμμένο.');
  const entries = new Map();
  let p = v.getUint32(eocd + 16, true);
  const count = v.getUint16(eocd + 10, true);
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), note = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    entries.set(dec.decode(new Uint8Array(buffer, p + 46, nameLen)), { method, size, local });
    p += 46 + nameLen + extra + note;
  }
  return {
    has: (n) => entries.has(n),
    names: () => [...entries.keys()],
    async text(name) {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
      const raw = new Uint8Array(buffer, start, e.size);
      if (e.method === 0) return dec.decode(raw);
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    },
  };
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const byLocal = (node, name) => [...node.getElementsByTagNameNS('*', name)];

async function docxText(buffer) {
  const zip = await readZip(buffer);
  const doc = await zip.text('word/document.xml');
  if (!doc) throw new Error('Δεν βρέθηκε περιεχόμενο στο αρχείο Word.');
  return byLocal(xml(doc), 'p').map((p) => {
    let line = '';
    const walk = (n) => {
      for (const c of n.children) {
        if (c.localName === 't') line += c.textContent;
        else if (c.localName === 'tab') line += '\t';
        else if (c.localName === 'br') line += '\n';
        else walk(c);
      }
    };
    walk(p);
    return line;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function pptxText(buffer) {
  const zip = await readZip(buffer);
  const slides = zip.names().filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const out = [];
  for (const [i, name] of slides.entries()) {
    const paras = byLocal(xml(await zip.text(name)), 'p')
      .map((p) => byLocal(p, 't').map((t) => t.textContent).join('')).filter(Boolean);
    if (paras.length) out.push(`Διαφάνεια ${i + 1}\n${paras.join('\n')}`);
  }
  return out.join('\n\n');
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
export const serialToIso = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
const colIndex = (ref) => { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
const serialTime = (n) => {
  const mins = Math.round((n % 1) * 1440);
  return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};

// Επιστρέφει [{ name, rows }]. Οι ημερομηνίες του Excel γίνονται YYYY-MM-DD και οι ώρες ΩΩ:ΛΛ.
export async function readWorkbook(buffer) {
  const zip = await readZip(buffer);
  const wbXml = await zip.text('xl/workbook.xml');
  if (!wbXml) throw new Error('Το αρχείο δεν είναι έγκυρο Excel.');
  const wb = xml(wbXml);
  const rels = xml(await zip.text('xl/_rels/workbook.xml.rels'));
  const target = new Map(byLocal(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const sstXml = await zip.text('xl/sharedStrings.xml');
  const sst = sstXml ? byLocal(xml(sstXml), 'si').map((si) => byLocal(si, 't')
    .filter((t) => t.parentElement.localName !== 'rPh').map((t) => t.textContent).join('')) : [];

  const stylesXml = await zip.text('xl/styles.xml');
  const dateStyles = [];
  if (stylesXml) {
    const st = xml(stylesXml);
    const custom = new Map(byLocal(st, 'numFmt').map((f) => [f.getAttribute('numFmtId'), f.getAttribute('formatCode')]));
    const xfs = byLocal(st, 'cellXfs')[0];
    for (const xf of xfs ? [...xfs.children] : []) {
      const id = xf.getAttribute('numFmtId');
      const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
      dateStyles.push(BUILTIN_DATE.has(Number(id)) ? (id >= 18 && id <= 21 || id >= 45 && id <= 47 ? 'time' : 'date')
        : /[dy]/i.test(code) ? 'date' : /h|s/i.test(code) ? 'time' : null);
    }
  }

  const sheets = [];
  for (const s of byLocal(wb, 'sheet')) {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? s.getAttribute('r:id');
    let path = target.get(rid) ?? '';
    path = path.startsWith('/') ? path.slice(1) : 'xl/' + path;
    const sheetXml = await zip.text(path);
    if (!sheetXml) continue;
    const rows = [];
    for (const r of byLocal(xml(sheetXml), 'row')) {
      const row = [];
      for (const c of [...r.children].filter((x) => x.localName === 'c')) {
        const type = c.getAttribute('t'), ref = c.getAttribute('r');
        const raw = byLocal(c, 'v')[0]?.textContent ?? '';
        const kind = dateStyles[Number(c.getAttribute('s') ?? 0)];
        let val = raw;
        if (type === 's') val = sst[Number(raw)] ?? '';
        else if (type === 'inlineStr') val = byLocal(c, 't').map((t) => t.textContent).join('');
        else if (type === 'b') val = raw === '1' ? 'Ναι' : 'Όχι';
        else if (raw !== '' && type !== 'str' && type !== 'e') {
          const n = Number(raw);
          val = kind === 'date' ? serialToIso(n) : kind === 'time' ? serialTime(n) : n;
        }
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows[Number(r.getAttribute('r') ?? rows.length + 1) - 1] = Array.from(row, (v) => v ?? '');
    }
    sheets.push({ name: s.getAttribute('name'), rows: Array.from(rows, (r) => r ?? []) });
  }
  return sheets;
}

function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1253').decode(bytes); }
}

export function parseCsv(text) {
  const first = text.split('\n')[0];
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export async function readRows(file) {
  const ext = extOf(file.name);
  const buffer = await file.arrayBuffer();
  if (ext === 'xls') throw new Error('Το παλιό .xls δεν υποστηρίζεται. Αποθήκευσέ το ως .xlsx από το Excel.');
  if (ext === 'csv' || ext === 'tsv') return parseCsv(decodeText(buffer));
  if (ext !== 'xlsx' && ext !== 'xlsm') throw new Error('Διάλεξε αρχείο .xlsx ή .csv.');
  const sheet = (await readWorkbook(buffer)).find((s) => s.rows.some((r) => r.some((c) => c !== '')));
  if (!sheet) throw new Error('Το Excel είναι άδειο.');
  return sheet.rows;
}

let tesseract;
function loadTesseract() {
  tesseract ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OCR_CDN;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { tesseract = null; reject(new Error('Η ανάγνωση εικόνων χρειάζεται σύνδεση στο internet.')); };
    document.head.append(s);
  });
  return tesseract;
}

async function ocr(images, onStatus) {
  onStatus?.('Φόρτωση αναγνώρισης κειμένου…');
  const T = await loadTesseract();
  const worker = await T.createWorker('ell+eng');
  try {
    const out = [];
    for (const [i, img] of images.entries()) {
      onStatus?.(`Ανάγνωση εικόνας ${i + 1} από ${images.length}…`);
      const { data } = await worker.recognize(img);
      out.push(data.text.trim());
    }
    return out.join('\n\n');
  } finally { await worker.terminate(); }
}

async function pdfText(buffer, onStatus) {
  const pdfjs = await import(new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), wasmUrl: new URL('../vendor/pdfjs/wasm/', import.meta.url).href }).promise;
  } catch (e) {
    throw new Error(e.name === 'PasswordException' ? 'Το PDF έχει κωδικό και δεν διαβάζεται.' : 'Το PDF δεν άνοιξε.');
  }
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onStatus?.(`Ανάγνωση σελίδας ${i} από ${doc.numPages}…`);
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('').trim());
  }
  const text = pages.join('\n\n').trim();
  if (text.replace(/\s/g, '').length >= 20 * doc.numPages || text.replace(/\s/g, '').length > 200) return { text };

  // Σκαναρισμένο PDF: κάθε σελίδα γίνεται εικόνα και περνά από OCR.
  const count = Math.min(doc.numPages, MAX_OCR_PAGES);
  const canvases = [];
  for (let i = 1; i <= count; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = Object.assign(document.createElement('canvas'), { width: viewport.width, height: viewport.height });
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    canvases.push(canvas);
  }
  return {
    text: await ocr(canvases, onStatus),
    note: doc.numPages > count ? `Διαβάστηκαν οι πρώτες ${count} από τις ${doc.numPages} σελίδες.` : null,
  };
}

// Επιστρέφει { text, note }. Δεν πετάει ποτέ σφάλμα: το αρχείο σώζεται και χωρίς κείμενο.
export async function extractText(file, onStatus) {
  const ext = extOf(file.name);
  try {
    const buffer = await file.arrayBuffer();
    let result;
    if (ext === 'pdf') result = await pdfText(buffer, onStatus);
    else if (ext === 'docx') result = { text: await docxText(buffer) };
    else if (ext === 'pptx') result = { text: await pptxText(buffer) };
    else if (ext === 'xlsx' || ext === 'xlsm') {
      const sheets = await readWorkbook(buffer);
      result = { text: sheets.map((s) => `${s.name}\n${s.rows.filter((r) => r.some((c) => c !== '')).map((r) => r.join('\t')).join('\n')}`).join('\n\n') };
    } else if (TEXT_EXT.includes(ext)) result = { text: decodeText(buffer) };
    else if (IMAGE_EXT.includes(ext)) result = { text: await ocr([file], onStatus) };
    else if (ext === 'doc' || ext === 'xls' || ext === 'ppt') return { text: '', note: 'Τα παλιά αρχεία Office δεν μετατρέπονται σε κείμενο. Αποθήκευσέ το ως .docx, .xlsx ή .pptx.' };
    else return { text: '', note: 'Αυτός ο τύπος αρχείου δεν μετατρέπεται σε κείμενο. Το αρχείο αποθηκεύτηκε.' };
    const text = (result.text ?? '').trim();
    return { text, note: result.note ?? (text ? null : 'Δεν βρέθηκε κείμενο στο αρχείο.') };
  } catch (e) {
    return { text: '', note: e.message };
  }
}

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
