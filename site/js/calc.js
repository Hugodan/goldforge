// The pricing engine: what things cost, what they sell for after every fee, and which exit wins.
import { DB, item, price } from './data.js';
import { S, addon, knownRecipes, stock } from './profile.js';

const TRADE_GOODS_CLASS = 7;
let memo = new Map();
export const resetMemo = () => { memo = new Map(); };

// ----------------------------------------------------------------------------- selling
export function isCommodity(id) {
  const it = item(id);
  return !(it.cls === 2 || it.cls === 4 || it.cls === 9);   // gear and recipes list one per auction
}

/** The price you would list one unit at, on a given house, or null if there is no market. */
export function listPrice(id, house = S().house) {
  const p = price(house, id);
  if (!p) return null;
  const s = S();
  if (s.sellBasis === 'market') return p.mkt;
  if (s.sellBasis === 'sold' && p.sp7) return p.sp7;
  return Math.max(1, (p.flr ?? p.min) - s.undercut);
}

/** Deposit for one unit for the chosen duration (Classic rule: % of vendor sell price; minimum per listing). */
export function depositPerUnit(id, neutral = false) {
  const s = S(), it = item(id);
  const pctv = s.depositPct[s.duration] ?? 0.6;
  const stack = isCommodity(id) ? s.postStack : 1;
  let d = Math.max(it.sell * pctv, s.minDeposit / stack);
  if (neutral) d *= s.neutralDepositMult;
  return d;
}

export function sellThrough(id) {
  const s = S();
  return isCommodity(id) ? s.sellThroughCommodity : s.sellThroughGear;
}

/**
 * Everything that happens to one unit sold on the auction house:
 * gross list price, the house cut, and the deposits you lose on the listings that expire
 * before one sells (deposit × (1/sell-through − 1)).
 */
export function saleBreakdown(id, house = S().house) {
  const s = S();
  const neutral = +house === +s.neutral;
  const gross = listPrice(id, house);
  if (gross === null) return null;
  const it = item(id);
  if (it.bind === 1) return null; // soulbound: cannot be listed
  const cutRate = neutral ? s.neutralCut : s.ahCut;
  const cut = gross * cutRate;
  const dep = depositPerUnit(id, neutral);
  const r = Math.max(0.05, Math.min(1, sellThrough(id)));
  const depositLoss = dep * (1 / r - 1);
  return { gross, cut, cutRate, deposit: dep, sellThrough: r, depositLoss, net: gross - cut - depositLoss, house: +house };
}

export const netSale = (id, house) => saleBreakdown(id, house)?.net ?? null;

// ----------------------------------------------------------------------------- vendor
export function vendorPrice(id) {
  const s = S();
  const a = addon();
  const learned = a?.vendor?.[id];
  const override = s.vendorOverrides[id];
  if (override === false) return null;
  const discount = 1 - (s.barteringRank || 0) * (DB.constants.legacy?.barteringPerRank ?? 0.05);
  if (learned) return learned * discount;
  if (override === true || DB.constants.vendorGoods[id]) {
    const it = item(id);
    return it.buy > 0 ? it.buy * discount : null;
  }
  return null;
}

// ----------------------------------------------------------------------------- buying
const BUY_QUANTITIES = [5, 10, 20, 30, 50, 100, 200];

function ahBuyUnit(id, qty, house = S().house) {
  const p = price(house, id);
  if (!p || !p.min) return null;
  if (Array.isArray(p.bq) && qty > 1) {
    // exact order-book cost for the next quantity step at or above what you need
    for (let k = 0; k < BUY_QUANTITIES.length; k++) {
      if (BUY_QUANTITIES[k] >= qty) {
        if (p.bq[k]) return p.bq[k];
        return null;      // not enough listed
      }
    }
  }
  if (qty >= 200 && p.b200) return p.b200;
  if (qty >= 50 && p.b50) return p.b50;
  if (qty >= 10 && p.b10) return p.b10;
  if (qty > (p.qty || 0)) return null;
  return p.min;
}

/**
 * Cheapest way to obtain `qty` of an item, considering the AH (with slippage for big buys),
 * a vendor, crafting it yourself and what is already in your bags.
 * Returns {unit, source, detail}.
 */
export function acquire(id, qty = 1, depth = 0, seen = new Set()) {
  const key = `${id}|${qty}|${depth}`;
  if (memo.has(key)) return memo.get(key);
  const s = S();
  const opts = [];
  const ah = ahBuyUnit(id, qty);
  if (ah) opts.push({ unit: ah, source: 'AH' });
  const v = vendorPrice(id);
  if (v) opts.push({ unit: v, source: 'Vendor' });
  if (depth < 3 && !seen.has(id)) {
    for (const r of DB.recipesByProduct[id] || []) {
      if (!recipeUsable(r)) continue;
      const nseen = new Set(seen); nseen.add(id);
      const crafts = Math.ceil(qty / (r.m || 1));
      let total = 0, ok = true;
      for (const [rid, n] of r.r) {
        const a = acquire(rid, n * crafts, depth + 1, nseen);
        if (!a || a.unit === null) { ok = false; break; }
        total += a.unit * n;
      }
      if (ok) opts.push({ unit: total / (r.m || 1), source: 'Craft', detail: r });
    }
  }
  if (s.useBags) {
    const have = stock()[id] || 0;
    if (have >= qty) {
      const val = s.ownMats === 'free' ? 0 : s.ownMats === 'buy' ? (ah ?? v ?? null) : (netSale(id) ?? ah ?? v ?? 0);
      if (val !== null) opts.push({ unit: val, source: 'Bags', detail: have });
    }
  }
  let best = opts.length ? opts.reduce((a, b) => (b.unit < a.unit ? b : a)) : { unit: null, source: 'None' };
  best = { ...best, options: opts };
  memo.set(key, best);
  return best;
}

// ----------------------------------------------------------------------------- recipes
export function recipeKnown(r) {
  const k = knownRecipes();
  if (!k) return null;               // unknown: no addon import yet
  return k.has(`s${r.s}`) || k.has(`i${r.i}`) || k.has(`n${r.n}`);
}

export function recipeUsable(r) {
  const s = S();
  if (r.camp && !s.includeCamp) return false;
  if (s.onlyKnown) return recipeKnown(r) !== false;
  return true;
}

export function deOutcomes(id) {
  const it = item(id);
  if (!(it.cls === 2 || it.cls === 4) || it.q < 2 || it.q > 4) return null;
  if (DB.constants.disenchant.notDisenchantableInventoryTypes.includes(it.inv)) return null;
  const learned = addon()?.de?.[id];
  if (learned && learned.n >= 3) {
    return { source: `your ${learned.n} disenchants`, out: Object.entries(learned.out).map(([mid, c]) => [+mid, 1, c / learned.n]) };
  }
  const t = DB.constants.disenchant;
  const table = it.q === 2 ? t.uncommonArmor : it.q === 3 ? t.rare : t.epic;
  const lvl = it.ilvl || 1;
  const row = table.find(b => lvl >= b.min && lvl <= b.max);
  if (!row) return null;
  let out = row.out.map(o => [...o]);
  if (it.q === 2 && it.cls === 2 && t.uncommonWeaponSwapsDustAndEssence && out.length >= 2) {
    const [d, e] = out;
    out[0] = [d[0], e[1], d[2]];
    out[1] = [e[0], d[1], e[2]];
  }
  return { source: 'Classic disenchant table', out };
}

/** Expected value of disenchanting one item, with mats valued at what they net on the AH. */
export function deValue(id) {
  const s = S();
  if (!s.enchanter) return null;
  const o = deOutcomes(id);
  if (!o) return null;
  let ev = 0;
  const lines = o.out.map(([mid, chance, count]) => {
    const unit = netSale(mid) ?? 0;
    const v = chance * count * unit;
    ev += v;
    return { id: mid, chance, count, unit, value: v };
  });
  return { ev, lines, source: o.source };
}

/** All the ways out for one crafted item, best first. */
export function exits(id) {
  const out = [];
  const sale = saleBreakdown(id);
  if (sale) out.push({ kind: 'AH', value: sale.net, sale });
  const n = netSale(id, S().neutral);
  if (n !== null && item(id).bind !== 1) {
    const spdN = price(S().neutral, id)?.spd;
    // The neutral house is thin: one overpriced listing is not a price you can sell at.
    const real = spdN !== null && spdN !== undefined && spdN >= S().neutralMinSales;
    out.push({ kind: 'Neutral AH', value: n, sale: saleBreakdown(id, S().neutral), unproven: !real });
  }
  const de = deValue(id);
  if (de) out.push({ kind: 'Disenchant', value: de.ev, de });
  const it = item(id);
  if (it.sell > 0) out.push({ kind: 'Vendor', value: it.sell });
  return out.sort((a, b) => (a.unproven - b.unproven) || (b.value - a.value));
}

/** Thin market: few listings and no measured sales, so the floor is just someone's asking price. */
export function thinMarket(id, house = S().house) {
  const p = price(house, id);
  if (!p) return false;
  return (p.n ?? 0) <= 2 && !(p.spd > 0);
}

export function evaluateRecipe(r, crafts = 1) {
  const reagents = r.r.map(([id, n]) => {
    const a = acquire(id, n * crafts);
    return { id, n, unit: a.unit, source: a.source, detail: a.detail, options: a.options, total: a.unit === null ? null : a.unit * n };
  });
  const missing = reagents.filter(x => x.unit === null);
  const cost = missing.length ? null : reagents.reduce((t, x) => t + x.total, 0);
  const ex = exits(r.i);
  const best = ex.find(e => !e.unproven) || null;
  const chef = r.p === 'cooking' ? (S().masterChefRank || 0) * (DB.constants.legacy?.masterChefPerRank ?? 0.1) : 0;
  const makes = (r.m || 1) * (1 + chef);
  const revenue = best ? best.value * makes : null;
  const profit = cost !== null && revenue !== null ? revenue - cost : null;
  const p = price(S().house, r.i);
  const spd = p?.spd ?? null;
  const share = S().marketShare;
  const daily = profit !== null && spd ? Math.max(0, profit) * Math.min(spd * share, 50) / makes : null;
  return {
    r, reagents, missing, cost, exits: ex, best, makes, revenue, profit,
    margin: profit !== null && cost ? profit / cost : null,
    spd, daily, market: p, known: recipeKnown(r),
    bop: item(r.i).bind === 1,
    thin: best?.kind === 'AH' && thinMarket(r.i),
    chef,
  };
}

export function allRecipeRows(profession = 'leatherworking') {
  resetMemo();
  return DB.recipes.filter(r => r.p === profession && recipeUsable(r)).map(r => evaluateRecipe(r));
}

// ----------------------------------------------------------------------------- farming
export function skinTierValues() {
  const s = S();
  const sk = DB.constants.skinning;
  const scarceIds = sk.scarce;
  const scarceVals = scarceIds.map(id => netSale(id)).filter(v => v !== null);
  const scarceAvg = scarceVals.length ? scarceVals.reduce((a, b) => a + b, 0) / scarceVals.length : 0;
  const scarceChance = sk.scarceChancePerSkin * (1 + s.bountifulRank * sk.bountifulHarvestPerRank);
  return sk.tiers.map(t => {
    const lines = t.out.map(([id, count]) => ({ id, count, unit: netSale(id) ?? 0, value: count * (netSale(id) ?? 0) }));
    const base = lines.reduce((a, l) => a + l.value, 0);
    const perSkin = base + scarceChance * scarceAvg;
    const specials = sk.special.filter(x => x.tier === t.id).map(x => {
      const unit = netSale(x.item) ?? 0;
      const v = perSkin + x.chance * unit;
      return { ...x, unit, perSkin: v, perHour: v * (x.rate || s.skinsPerHour) };
    }).sort((a, b) => b.perHour - a.perHour);
    return { ...t, lines, scarce: scarceChance * scarceAvg, scarceChance, perSkin, perHour: perSkin * s.skinsPerHour, specials };
  });
}

/** Skinning value per mob from your own addon log (real yields). */
export function loggedSkinning() {
  const a = addon();
  if (!a?.skins) return [];
  const s = S();
  return Object.entries(a.skins).map(([npc, x]) => {
    let v = 0;
    const lines = Object.entries(x.items || {}).map(([id, c]) => {
      const unit = netSale(+id) ?? item(+id).sell ?? 0;
      const per = c / Math.max(1, x.n);
      v += per * unit;
      return { id: +id, per, unit };
    });
    const rate = x.active > 0 ? x.n / (x.active / 3600) : null;
    return { npc, name: x.name, zone: x.zone, n: x.n, lines, perSkin: v, rate,
             perHour: v * (rate && x.n >= 20 ? rate : s.skinsPerHour) };
  }).sort((a, b) => b.perHour - a.perHour);
}

/** Is it better to sell this leather raw or to turn it into something? */
export function rawVersusCraft(leatherId) {
  const raw = netSale(leatherId);
  let best = null;
  for (const r of DB.recipesByReagent[leatherId] || []) {
    if (!recipeUsable(r)) continue;
    const ev = evaluateRecipe(r);
    if (ev.profit === null || !ev.best) continue;
    const need = r.r.find(([id]) => id === leatherId)[1];
    const otherCost = ev.reagents.filter(x => x.id !== leatherId).reduce((t, x) => t + x.total, 0);
    const perLeather = (ev.revenue - otherCost) / need;
    if (!best || perLeather > best.perLeather) best = { r, perLeather, ev };
  }
  return { raw, best };
}

// ----------------------------------------------------------------------------- disenchant arbitrage
export function deFlips(limit = 120) {
  const s = S();
  if (!s.enchanter) return [];
  const p = DB.prices[s.house];
  if (!p) return [];
  const out = [];
  for (const idStr of Object.keys(p.items)) {
    const id = +idStr;
    const it = item(id);
    if (!(it.cls === 2 || it.cls === 4) || it.q < 2) continue;
    const de = deValue(id);
    if (!de || de.ev <= 0) continue;
    const pr = price(s.house, id);
    const buy = pr.min;
    const profit = de.ev - buy;
    if (profit <= 0) continue;
    out.push({ id, it, buy, ev: de.ev, profit, roi: profit / buy, listed: pr.n, de });
  }
  return out.sort((a, b) => b.profit - a.profit).slice(0, limit);
}

// ----------------------------------------------------------------------------- neutral arbitrage
export function neutralFlips({ minProfit = 2000, minRoi = 0.1, limit = 150 } = {}) {
  const s = S();
  const A = DB.prices[s.house], N = DB.prices[s.neutral];
  if (!A || !N) return [];
  const out = [];
  for (const idStr of Object.keys(N.items)) {
    const id = +idStr;
    if (!A.items[idStr]) continue;
    if (item(id).bind === 1) continue;
    const a = price(s.house, id), n = price(s.neutral, id);
    // Alliance -> neutral
    const toN = netSale(id, s.neutral);
    if (toN !== null && a.min && (n.spd === null || n.spd === undefined || n.spd >= s.neutralMinSales)) {
      const profit = toN - a.min;
      if (profit >= minProfit && profit / a.min >= minRoi) {
        out.push({ id, dir: 'Alliance → Neutral', buy: a.min, sell: listPrice(id, s.neutral), net: toN, profit,
                   roi: profit / a.min, avail: a.wall ?? a.qty, demand: n.spd, competition: n.qty });
      }
    }
    // neutral -> Alliance
    const toA = netSale(id, s.house);
    if (toA !== null && n.min) {
      const profit = toA - n.min;
      if (profit >= minProfit && profit / n.min >= minRoi) {
        out.push({ id, dir: 'Neutral → Alliance', buy: n.min, sell: listPrice(id, s.house), net: toA, profit,
                   roi: profit / n.min, avail: n.wall ?? n.qty, demand: a.spd, competition: a.qty });
      }
    }
  }
  return out.map(x => ({ ...x, score: x.profit * Math.min(x.avail || 1, Math.max(1, x.demand || 1)) }))
    .sort((a, b) => b.score - a.score).slice(0, limit);
}

// ----------------------------------------------------------------------------- bags
export function bagAdvice() {
  const st = stock();
  const rows = [];
  for (const [idStr, n] of Object.entries(st)) {
    const id = +idStr;
    const it = item(id);
    const ex = exits(id);
    let craft = null;
    for (const r of DB.recipesByReagent[id] || []) {
      if (!recipeUsable(r) || recipeKnown(r) === false) continue;
      const ev = evaluateRecipe(r);
      if (ev.profit !== null && ev.profit > 0 && (!craft || ev.profit > craft.profit)) craft = ev;
    }
    const best = ex.find(e => !e.unproven);
    rows.push({ id, it, n, exits: ex, best, craft, value: best ? best.value * n : 0 });
  }
  return rows.sort((a, b) => b.value - a.value);
}

// ----------------------------------------------------------------------------- house check
/** Compare prices you saw in game (addon) with each house's snapshot to find your market. */
export function houseMatch() {
  const obs = addon()?.prices;
  if (!obs) return null;
  const res = [];
  for (const h of Object.keys(DB.meta.houses)) {
    if (DB.meta.houses[h].faction === 'Neutral') continue;
    let n = 0, close = 0;
    for (const [id, o] of Object.entries(obs)) {
      const p = price(h, id);
      if (!p || !o.p) continue;
      n++;
      const ref = p.min;
      if (Math.abs(ref - o.p) / Math.max(1, o.p) <= 0.05) close++;
    }
    if (n) res.push({ house: +h, n, close, rate: close / n, label: DB.meta.houses[h].label });
  }
  return res.sort((a, b) => b.rate - a.rate);
}

export function isTradeGood(id) { return item(id).cls === TRADE_GOODS_CLASS; }


// ----------------------------------------------------------------------------- where recipes come from
const npcName = id => DB.sources.npcs?.[id];

/** Learn source for a recipe: trainer / starter / pattern (vendor, drop, chest, quest, seen by you). */
export function recipeSource(r) {
  if (!r.pat) {
    if (r.src === 'start') return { type: 'Starter', text: 'Known when you learn the profession' };
    if (r.src === 'quest') return { type: 'Quest', text: 'Quest reward' };
    if (r.src === 'npc') return { type: 'NPC', text: 'Taught by a special NPC' };
    return { type: 'Trainer', text: `Profession trainer${r.l > 1 ? ` at skill ${r.l}` : ''}` };
  }
  return patternSource(r.pat, r);
}

export function patternSource(patId, r = null) {
  const src = DB.sources.items?.[patId];
  const seenV = addon()?.recipeVendors?.[patId];
  const seenD = addon()?.recipeDrops?.[patId];
  const fac = S().faction === 'Horde' ? 'H' : 'A';
  const out = { pat: patId, vendors: [], drops: null, objects: [], quests: [], seen: [] };
  if (seenV) out.seen.push(`Sold by ${seenV.npc} (${seenV.zone})${seenV.cost ? ` for ${seenV.cost}` : ''}`);
  if (seenD) out.seen.push(`Dropped by ${seenD.mob || 'a mob'} in ${seenD.zone} (${seenD.n || 1}×)`);
  if (src?.v) {
    for (const id of src.v) {
      const n = npcName(id);
      if (!n) continue;
      out.vendors.push({ id, name: n[0], zone: n[3], friendly: n[4], title: n[5], ok: !n[4] || n[4].includes(fac) });
    }
  }
  if (src?.d) {
    const d = src.d;
    out.drops = { count: d.n, lv: d.lv, zones: d.zones, npcs: d.npcs.map(id => npcName(id)).filter(Boolean)
      .map(n => ({ name: n[0], lv: n[2], zone: n[3], rank: n[6] || 0 })) };
  }
  if (src?.o) out.objects = src.o.map(id => DB.sources.objects?.[id]).filter(Boolean).map(o => ({ name: o[0], zone: o[1] }));
  if (src?.q) out.quests = src.q.map(id => DB.sources.quests?.[id]).filter(Boolean).map(q => ({ name: q[0], lv: q[1] }));
  let type = 'Pattern';
  if (out.vendors.length) type = 'Vendor';
  else if (out.drops) type = out.drops.count > 12 ? 'World drop' : 'Drop';
  else if (out.objects.length) type = 'Chest';
  else if (out.quests.length) type = 'Quest';
  else if (out.seen.length) type = seenV ? 'Vendor' : 'Drop';
  else if (r?.new || !src) type = 'New pattern';
  out.type = type;
  out.text = sourceText(out);
  return out;
}

function sourceText(o) {
  if (o.seen.length && !o.vendors.length && !o.drops) return `${o.seen.join(' · ')} (seen by you)`;
  if (o.vendors.length) {
    const ok = o.vendors.filter(v => v.ok);
    const list = (ok.length ? ok : o.vendors).slice(0, 3).map(v => `${v.name} (${v.zone || '?'}${v.friendly === 'AH' || !v.friendly ? ', neutral' : ''})`);
    return `${ok.length ? '' : 'Other faction only: '}${list.join(', ')}${o.vendors.length > 3 ? ` +${o.vendors.length - 3} more` : ''}`;
  }
  if (o.drops) {
    const d = o.drops;
    if (d.count > 12) return `World drop from level ${d.lv[0]}–${d.lv[1]} mobs · most in ${d.zones.slice(0, 3).map(z => z[0]).join(', ')}`;
    return d.npcs.slice(0, 4).map(n => `${n.name} (${n.zone || '?'}, lvl ${n.lv}${n.rank === 3 ? ', boss' : n.rank === 4 || n.rank === 2 ? ', rare' : ''})`).join(', ');
  }
  if (o.objects.length) return `Found in ${[...new Set(o.objects.map(x => `${x.name} (${x.zone})`))].slice(0, 3).join(', ')}`;
  if (o.quests.length) return `Quest: ${o.quests.map(q => `${q.name} (lvl ${q.lv})`).join(', ')}`;
  if (o.seen.length) return `${o.seen.join(' · ')} (seen by you)`;
  return 'New in Forever: not in the open data yet. The addon records it when you see it sold or dropped.';
}

export const wowheadItem = id => `https://www.wowhead.com/forever/item=${id}`;

/** Recipe items worth farming or flipping: AH value, demand and where they come from. */
export function recipeFarmRows() {
  const s = S();
  const pr = DB.prices[s.house]?.items || {};
  const ids = new Set([...Object.keys(pr), ...Object.keys(DB.sources.items || {})]);
  const out = [];
  for (const idStr of ids) {
    const id = +idStr;
    const it = item(id);
    if (it.cls !== 9 && !DB.sources.items?.[idStr]) continue;
    const p = price(s.house, id);
    const rec = (DB.recipesByPattern[id] || [])[0];
    const src = patternSource(id, rec);
    const net = it.bind === 1 ? null : netSale(id);
    const vend = src.vendors.filter(v => v.ok).length && it.buy > 0 ? it.buy * (1 - (s.barteringRank || 0) * 0.05) : null;
    out.push({ id, it, p, net, rec, src, vend, flip: vend !== null && net !== null ? net - vend : null,
               bop: it.bind === 1, prof: rec?.p || guessProf(it.name) });
  }
  return out;
}

function guessProf(name) {
  for (const [pre, profs] of Object.entries(DB.constants.recipePrefixes || {})) if (name.startsWith(pre)) return profs[0] || '';
  return '';
}
