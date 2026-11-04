/* Shared bag for the shop (/glassi/) and the world (/glassi/world). Lines are keyed by version + arm style + frame + lens.
   Version 2 lines saved before the plain/lettered choice existed came from the lettered 3D model, so they migrate to 'lettered'. */
import { PRODUCTS, FRAMES, LENSES } from './catalog.js';

const KEY = 'glassi-bag-v2';
let mem = null;
const subs = new Set();

const templeOk = i => { const t = PRODUCTS[i.version].temples; return t ? t.some(x => x.id === i.temple) : !i.temple; };
const valid = i => i && PRODUCTS[i.version] && PRODUCTS[i.version].price != null && templeOk(i)
  && FRAMES.some(f => f.name === i.frame) && LENSES.some(l => l.name === i.lens) && Number.isInteger(i.qty) && i.qty > 0;
const migrate = i => (i && i.version === 'version-2' && !i.temple ? { ...i, temple: 'lettered' } : i);

export const keyOf = i => `${i.version}|${i.temple || '-'}|${i.frame}|${i.lens}`;

export function read() {
  if (mem) return mem.map(x => ({ ...x }));
  let a = [];
  try { a = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { a = []; }
  mem = Array.isArray(a) ? a.map(migrate).filter(valid) : [];
  return mem.map(x => ({ ...x }));
}
function write(a) {
  mem = a.filter(valid);
  try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* private mode: keep it in memory */ }
  subs.forEach(fn => fn(read()));
}
export function add(version, frame, lens, temple) {
  const item = { version, frame, lens, ...(temple ? { temple } : {}) };
  const a = read(); const k = keyOf(item);
  const ex = a.find(i => keyOf(i) === k);
  if (ex) ex.qty++; else a.push({ ...item, qty: 1 });
  write(a);
}
export function setQty(key, qty) { write(read().map(i => keyOf(i) === key ? { ...i, qty } : i).filter(i => i.qty > 0)); }
export function clear() { write([]); }
export const count = (a = read()) => a.reduce((n, i) => n + i.qty, 0);
export const subtotal = (a = read()) => a.reduce((n, i) => n + i.qty * PRODUCTS[i.version].price, 0);
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
addEventListener('storage', e => { if (e.key === KEY) { mem = null; subs.forEach(fn => fn(read())); } });

export const lineTitle = i => `Afterparty / ${PRODUCTS[i.version].label}`;
export const lineMeta = i => { const t = PRODUCTS[i.version].temples?.find(x => x.id === i.temple); return `${i.frame} frame, ${i.lens} lens${t ? ', ' + t.line : ''}`; };
export const hexOf = i => ({ f: FRAMES.find(f => f.name === i.frame)?.hex, l: LENSES.find(l => l.name === i.lens)?.hex });
