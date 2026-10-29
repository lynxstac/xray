export async function load(name: string) {
  const m = await import('./math');
  const n = await import(name);
  const r = require('./utils');
  const q = require(name);
  return [m, n, r, q];
}
