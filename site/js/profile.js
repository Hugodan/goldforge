// Your settings and the data imported from the Goldforge addon, kept in this browser.
// Settings → Backup lets you copy everything to another device.

const KEY = 'goldforge.profile.v1';

export const DEFAULTS = {
  house: 111,
  neutral: 117,
  sellBasis: 'undercut',     // undercut | market | sold
  undercut: 1,               // copper below the floor
  duration: 24,              // hours: 2 | 8 | 24
  depositPct: { 2: 0.05, 8: 0.20, 24: 0.60 },   // share of vendor sell price (Classic rule)
  minDeposit: 1,             // copper per listing (1 silver before the 17/18 Nov maintenance)
  ahCut: 0.05,
  neutralCut: 0.15,
  neutralDepositMult: 5,
  neutralMinSales: 0.5,      // only count the neutral AH as an exit where it sells at least this many a day
  postStack: 20,             // units per commodity listing
  sellThroughCommodity: 0.85,
  sellThroughGear: 0.40,
  marketShare: 0.25,         // share of daily sales you expect to win
  ownMats: 'sell',           // sell (what you'd get selling them) | buy | free
  useBags: true,
  enchanter: true,
  enchantSkill: 75,
  skinsPerHour: 80,
  bountifulRank: 5,
  onlyKnown: false,
  includeCamp: false,
  vendorOverrides: {},       // itemId -> true/false
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { settings: { ...DEFAULTS, ...(p.settings || {}) }, addon: p.addon || null, manual: p.manual || [],
               dismissed: p.dismissed || {} };
    }
  } catch (_) { /* storage unavailable */ }
  return { settings: { ...DEFAULTS }, addon: null, manual: [], dismissed: {} };
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
}

export const S = () => state.settings;
export function setSetting(k, v) { state.settings[k] = v; save(); }
export function resetSettings() { state.settings = { ...DEFAULTS }; save(); }
export const addon = () => state.addon;
export const manualEntries = () => state.manual;

export function addManual(e) {
  state.manual.push({ ...e, id: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`, manual: true });
  save();
}
export function removeManual(id) { state.manual = state.manual.filter(e => e.id !== id); save(); }

// ----------------------------------------------------------------------------- addon import
export function parseAddonExport(text) {
  text = text.trim();
  if (text.startsWith('GF1:')) text = text.slice(4);
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('That does not look like a Goldforge export. In game type /gf export, press Ctrl+C, then paste here.'); }
  if (!data || data.v !== 1 || !data.chars) throw new Error('Unknown export version. Update the Goldforge addon.');
  return data;
}

const asArray = x => Array.isArray(x) ? x : Object.values(x || {});

export function importAddon(data) {
  const prev = state.addon || { chars: {}, ledger: [], prices: {}, vendor: {}, skins: {}, de: {} };
  const ledger = new Map(prev.ledger.map(e => [e.id, e]));
  for (const e of asArray(data.ledger)) ledger.set(e.id, e);
  for (const c of Object.values(data.chars || {})) {
    for (const r of Object.values(c.recipes || {})) r.r = asArray(r.r);
  }
  state.addon = {
    imported: Math.floor(Date.now() / 1000),
    exported: data.t,
    chars: { ...prev.chars, ...data.chars },
    ledger: [...ledger.values()].sort((a, b) => a.t - b.t),
    prices: { ...prev.prices, ...(data.prices || {}) },
    vendor: { ...prev.vendor, ...(data.vendor || {}) },
    skins: mergeCounts(prev.skins, data.skins, 'npc'),
    de: mergeCounts(prev.de, data.de, 'item'),
    posts: [...new Map([...(prev.posts || []), ...asArray(data.posts)].map(p => [`${p.t}:${p.item}:${p.qty}`, p])).values()].slice(-200),
  };
  save();
  return state.addon;
}

// skins/de are cumulative counters in the addon, so the newest export wins per key
function mergeCounts(a = {}, b = {}) { return { ...a, ...b }; }

export function clearAddon() { state.addon = null; save(); }

// ----------------------------------------------------------------------------- backup
export const exportProfile = () => JSON.stringify({ goldforge: 1, ...state });
export function importProfile(text) {
  const p = JSON.parse(text);
  if (!p.goldforge) throw new Error('Not a Goldforge backup.');
  state = { settings: { ...DEFAULTS, ...p.settings }, addon: p.addon || null, manual: p.manual || [], dismissed: p.dismissed || {} };
  save();
}

// ----------------------------------------------------------------------------- derived views of addon data
export function knownRecipes() {
  const a = state.addon;
  if (!a) return null;
  const set = new Set();
  for (const c of Object.values(a.chars)) for (const k of Object.keys(c.recipes || {})) set.add(k);
  return set;
}

export function stock() {
  const a = state.addon;
  const out = {};
  if (!a) return out;
  for (const c of Object.values(a.chars)) {
    for (const src of [c.bags, c.bank]) for (const [id, n] of Object.entries(src || {})) out[id] = (out[id] || 0) + n;
  }
  return out;
}

/** Recipes the addon read from your profession windows, in the app's recipe format. */
export function addonRecipes() {
  const a = state.addon;
  const out = [];
  if (!a) return out;
  for (const c of Object.values(a.chars)) {
    for (const [k, r] of Object.entries(c.recipes || {})) {
      if (!k.startsWith('s') || !r.i || !r.r?.length) continue;
      out.push({ s: +k.slice(1), p: String(r.prof || 'leatherworking').toLowerCase(), n: r.n, i: r.i, m: r.m || 1, r: r.r, src: 'addon' });
    }
  }
  return out;
}

export function stockByChar() {
  const a = state.addon;
  if (!a) return [];
  return Object.entries(a.chars).map(([k, c]) => ({ key: k, ...c }));
}
