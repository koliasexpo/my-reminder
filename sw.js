// Κρατά την εφαρμογή στο κινητό ώστε να ανοίγει και χωρίς internet.
// Με internet φέρνει πάντα την πιο πρόσφατη έκδοση, χωρίς internet ανοίγει ό,τι έχει.
const CACHE = 'my-reminder-v1';
const FILES = ["./", "css/app.css", "icons/icon-192.png", "icons/icon-512.png", "index.html", "js/app.js", "js/entry-dialog.js", "js/event-payments.js", "js/excel-import.js", "js/extract.js", "js/local/api.js", "js/local/dates.js", "js/local/db.js", "js/local/http.js", "js/local/modules/cashbox.js", "js/local/modules/entries.js", "js/local/modules/pending.js", "js/local/path.js", "js/notifications.js", "js/ui.js", "js/version.js", "js/views/calendar.js", "js/views/cash-chart.js", "js/views/cashbox.js", "js/views/data.js", "js/views/pending.js", "manifest.webmanifest", "protypo-domains-hosting.xlsx", "protypo-gamoi-event.xlsx", "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs", "vendor/pdfjs/wasm/jbig2.wasm", "vendor/pdfjs/wasm/jbig2_nowasm_fallback.js", "vendor/pdfjs/wasm/openjpeg.wasm", "vendor/pdfjs/wasm/openjpeg_nowasm_fallback.js", "vendor/pdfjs/wasm/qcms_bg.wasm", "vendor/pdfjs/wasm/quickjs-eval.js", "vendor/pdfjs/wasm/quickjs-eval.wasm", "vendor/sqljs/sql-wasm.js", "vendor/sqljs/sql-wasm.wasm"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./'))));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) =>
    list.length ? list[0].focus() : self.clients.openWindow('./')));
});
