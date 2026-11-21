// Data loading, item lookups and money formatting.

export const DB = {
  meta: null, constants: null, items: {}, itemCols: [], recipes: [], icons: {},
  prices: {},     // house -> {cols, idx, items, snapshot}
  history: {},    // house -> items
  recipesByProduct: {}, recipesByReagent: {}, nameIndex: [],
};

const bust = () => `?t=${Math.floor(Date.now() / 60000)}`;

async function getJSON(path, optional = false) {
  try {
    const r = await fetch(path + bust(), { cache: 'no-store' });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (optional) return null;
    throw e;
  }
}

export async function loadAll() {
  const [meta, constants, items, recipes, icons] = await Promise.all([
    getJSON('data/meta.json'), getJSON('static/constants.json'), getJSON('data/items.json'),
    getJSON('data/recipes.json'), getJSON('data/icons.json', true),
  ]);
  DB.meta = meta; DB.constants = constants; DB.icons = icons || {};
  DB.itemCols = items.cols; DB.items = items.items;
  DB.recipes = recipes.recipes || []; DB.recipeSource = recipes.source; DB.recipeBuild = recipes.build;
  indexRecipes();
  await Promise.all(Object.keys(meta.houses).map(loadPrices));
  DB.nameIndex = Object.entries(DB.items).map(([id, v]) => [v[0].toLowerCase(), +id]);
}

export async function loadPrices(house) {
  const p = await getJSON(`data/prices-${house}.json`, true);
  if (!p) return;
  const idx = {}; p.cols.forEach((c, i) => (idx[c] = i));
  DB.prices[house] = { ...p, idx };
}

export async function loadHistory(house) {
  if (DB.history[house]) return DB.history[house];
  const h = await getJSON(`data/history-${house}.json`, true);
  DB.history[house] = h ? h.items : {};
  return DB.history[house];
}

export async function refreshMeta() {
  const meta = await getJSON('data/meta.json', true);
  if (!meta) return false;
  const changed = JSON.stringify(Object.values(meta.houses).map(h => h.snapshot)) !==
                  JSON.stringify(Object.values(DB.meta.houses).map(h => h.snapshot));
  if (changed) {
    DB.meta = meta;
    await Promise.all(Object.keys(meta.houses).map(loadPrices));
    DB.history = {};
  }
  return changed;
}

/** Add recipes the database lacks (e.g. read by the addon from your profession window). */
export function addExtraRecipes(list) {
  const have = new Set(DB.recipes.map(r => r.s));
  let added = 0;
  for (const r of list) if (!have.has(r.s)) { DB.recipes.push(r); have.add(r.s); added++; }
  if (added) indexRecipes();
  return added;
}

export function idByName(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  const hit = DB.nameIndex.find(([nm]) => nm === n);
  return hit ? hit[1] : null;
}

function indexRecipes() {
  DB.recipesByProduct = {}; DB.recipesByReagent = {};
  for (const r of DB.recipes) {
    (DB.recipesByProduct[r.i] ||= []).push(r);
    for (const [id] of r.r) (DB.recipesByReagent[id] ||= []).push(r);
  }
}

// ----------------------------------------------------------------------------- items
const QUALITY = ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'artifact', 'heirloom'];

export function item(id) {
  const v = DB.items[id];
  if (!v) return { id: +id, name: `Item ${id}`, q: 1, ilvl: 0, cls: -1, sub: -1, sell: 0, buy: 0, req: 0, bind: 0, inv: 0, known: false };
  return { id: +id, name: v[0], q: v[1], ilvl: v[2], cls: v[3], sub: v[4], sell: v[5], buy: v[6], req: v[7], bind: v[8], inv: v[9], known: true };
}

export const qualityClass = q => `q-${QUALITY[q] || 'common'}`;

export function iconUrl(id) {
  const n = DB.icons[id];
  return n ? `https://render.worldofwarcraft.com/eu/icons/56/${n}.jpg` : null;
}

export function price(house, id) {
  const p = DB.prices[house];
  if (!p) return null;
  const row = p.items[id];
  if (!row) return null;
  const o = {};
  for (const c in p.idx) o[c] = row[p.idx[c]];
  return o;
}

export function searchItems(q, limit = 12) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  const starts = [], contains = [];
  for (const [n, id] of DB.nameIndex) {
    if (n.startsWith(q)) starts.push(id);
    else if (n.includes(q)) contains.push(id);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

// ----------------------------------------------------------------------------- money
export function money(c, { sign = false, short = false } = {}) {
  if (c === null || c === undefined || !isFinite(c)) return '<span class="na">—</span>';
  const neg = c < 0; c = Math.round(Math.abs(c));
  const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), cu = c % 100;
  const parts = [];
  if (g) parts.push(`<span class="mg">${g.toLocaleString('en-GB')}</span>`);
  if ((g || s) && !(short && g >= 100)) parts.push(`<span class="ms">${s}</span>`);
  if (!(short && g)) parts.push(`<span class="mc">${cu}</span>`);
  const pre = neg ? '−' : (sign && c > 0 ? '+' : '');
  return `<span class="money${neg ? ' neg' : ''}">${pre}${parts.join(' ')}</span>`;
}

export const moneyText = c => {
  if (c === null || c === undefined || !isFinite(c)) return '—';
  const neg = c < 0; c = Math.round(Math.abs(c));
  const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), cu = c % 100;
  return (neg ? '-' : '') + [g ? `${g}g` : '', s ? `${s}s` : '', (!g && !s) || cu ? `${cu}c` : ''].filter(Boolean).join(' ');
};

export const pct = (x, digits = 0) => (x === null || x === undefined || !isFinite(x)) ? '—' : `${(x * 100).toFixed(digits)}%`;
export const num = (x, d = 0) => (x === null || x === undefined || !isFinite(x)) ? '—' : Number(x).toLocaleString('en-GB', { maximumFractionDigits: d });

export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export const clock = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
