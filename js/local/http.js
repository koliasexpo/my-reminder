// Ο ίδιος μικρός router του server, χωρίς δίκτυο: τα αιτήματα απαντώνται μέσα στο κινητό.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (message) => new HttpError(400, message);
export const notFound = (message = 'Δεν βρέθηκε.') => new HttpError(404, message);

export function createRouter(modules, db) {
  const table = [];
  const route = (method, path, handler) => {
    const names = [];
    const rx = new RegExp('^' + path.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    table.push({ method, rx, names, handler });
  };
  for (const m of modules) { m.init(db); m.routes(route); }

  return async (method, url, body) => {
    const u = new URL(url, 'http://local');
    const hit = table.find((r) => r.method === method && r.rx.test(u.pathname));
    if (!hit) return { status: 404, data: { error: 'Δεν βρέθηκε.' } };
    try {
      const m = hit.rx.exec(u.pathname);
      const params = Object.fromEntries(hit.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const input = body === undefined ? {} : JSON.parse(JSON.stringify(body));
      const out = await hit.handler({ params, body: input, query: u.searchParams });
      return { status: 200, data: out === undefined ? {} : JSON.parse(JSON.stringify(out)) };
    } catch (e) {
      if (!e.status) console.error(e);
      return { status: e.status || 500, data: { error: e.status ? e.message : 'Κάτι πήγε στραβά: ' + (e.message || e) } };
    }
  };
}
