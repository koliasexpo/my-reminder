export function extname(p) {
  const base = String(p).split(/[\\/]/).pop();
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i) : '';
}
