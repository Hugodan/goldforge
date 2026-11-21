// One render function per tab, plus the recipe and item drawers.
import { DB, item, price, money, moneyText, num, pct, esc, ago, clock, loadHistory, searchItems, idByName } from './data.js';
import * as P from './profile.js';
import * as C from './calc.js';
import { icon, itemLink, table, wireSort, sparkline, drawHistory, toast, trendTag } from './ui.js';

const S = P.S;
const st = {};   // per-view UI state (sort, filters)
const view = k => (st[k] ||= {});

const exitTag = e => !e ? '<span class="na">no market</span>'
  : `<span class="tag ${e.kind === 'Disenchant' ? 'gold' : e.kind === 'Vendor' ? '' : 'good'}">${e.kind}</span>`;
const profitCell = v => v === null || v === undefined ? '<span class="na">—</span>' : `<span class="${v >= 0 ? 'good' : 'bad'}">${money(v, { sign: true })}</span>`;

function recipeTags(ev) {
  const t = [];
  if (ev.known === false) t.push('<span class="tag warn">not known</span>');
  if (ev.known === true) t.push('<span class="tag good">known</span>');
  if (ev.r.src === 'item' && ev.known !== true) t.push('<span class="tag">pattern</span>');
  if (ev.r.new) t.push('<span class="tag gold">new in Forever</span>');
  if (ev.bop) t.push('<span class="tag bad">BoP</span>');
  if (ev.missing.length) t.push('<span class="tag bad">unpriced reagent</span>');
  return t.join(' ');
}

// ============================================================================= GOLD BOARD
export function board(el, ctx) {
  const s = S();
  const rows = C.allRecipeRows('leatherworking').filter(r => r.profit !== null && r.profit > 0 && !r.missing.length && r.known !== false);
  const byDaily = [...rows].filter(r => r.daily).sort((a, b) => b.daily - a.daily);
  const best = byDaily[0] || [...rows].sort((a, b) => b.profit - a.profit)[0];
  const tiers = C.skinTierValues();
  const specials = tiers.flatMap(t => t.specials).sort((a, b) => b.perHour - a.perHour);
  const farmBest = [...tiers, ...specials].sort((a, b) => b.perHour - a.perHour)[0];
  const de = C.deFlips(5);
  const nf = C.neutralFlips({ limit: 5 });
  const bags = P.addon() ? C.bagAdvice() : [];
  const bagWorth = bags.reduce((t, b) => t + b.value, 0);
  const top5 = byDaily.slice(0, 5);
  const maxDaily = Math.max(1, ...top5.map(r => r.daily));

  const meter = top5.map(r => {
    const coins = Math.max(1, Math.round(r.daily / maxDaily * 11));
    return `<div class="stack" title="${esc(r.r.n)}: ${moneyText(r.daily)} / day"><div class="coins">${'<i class="coin"></i>'.repeat(coins)}</div><div class="cap"><span class="cn">${esc(item(r.r.i).name)}</span>${money(r.daily, { short: true })}</div></div>`;
  }).join('');

  const moves = [];
  if (farmBest) moves.push({ kind: 'Farm', name: farmBest.label ? `${farmBest.label} — ${farmBest.zones?.[0] || ''}` : `${farmBest.mob} (${farmBest.zone})`,
    amt: `${money(farmBest.perHour, { short: true })}<span class="muted small"> / hour</span>`, id: farmBest.item || farmBest.out?.[1]?.[0], go: '#skinning' });
  if (de[0]) moves.push({ kind: 'Buy & disenchant', name: item(de[0].id).name, amt: `${profitCell(de[0].profit)}<span class="muted small"> each</span>`, id: de[0].id, go: '#disenchant' });
  if (nf[0]) moves.push({ kind: nf[0].dir, name: item(nf[0].id).name, amt: `${profitCell(nf[0].profit)}<span class="muted small"> each</span>`, id: nf[0].id, go: '#neutral' });
  for (const r of byDaily.slice(1, 4)) moves.push({ kind: 'Craft', name: item(r.r.i).name, amt: `${money(r.daily, { short: true })}<span class="muted small"> / day</span>`, id: r.r.i, recipe: r.r.s });
  if (P.addon()) moves.push({ kind: 'Your bags & bank', name: `${bags.length} item types`, amt: money(bagWorth, { short: true }), go: '#bags' });

  const key = [8170, 4304, 15417, 8171, 15407, 249427, 16204, 14344].filter(id => price(s.house, id));

  el.innerHTML = `
    <div class="vhead"><div><h2>Gold Board</h2>
      <p>What to do with your time right now on <b>${esc(DB.meta.houses[s.house]?.label || s.house)}</b>, after the 5% house cut, lost deposits and what your materials could sell for.</p></div></div>
    ${P.addon() ? '' : `<div class="note" style="margin-bottom:16px">Import your Goldforge addon data in <a href="#setup">Settings</a> to limit this to recipes you know, use what's in your bags and keep a real ledger. Until then every Leatherworking recipe is ranked.</div>`}
    <div class="hero">
      <div class="panel best studs">
        <p class="kicker">Best craft right now</p>
        ${best ? `
          <div class="what">${icon(best.r.i, 'lg')}<div><div class="name ${'q-' + ['poor','common','uncommon','rare','epic','legendary'][item(best.r.i).q]}" data-item="${best.r.i}">${esc(item(best.r.i).name)}</div>
            <div class="muted small">${recipeTags(best)}</div></div></div>
          <div class="grid g3" style="margin-top:8px">
            <div class="stat"><div class="label">Profit per craft</div><div class="val">${profitCell(best.profit)}</div></div>
            <div class="stat"><div class="label">Margin</div><div class="val">${pct(best.margin)}</div></div>
            <div class="stat"><div class="label">At ${pct(s.marketShare)} of ~${num(best.spd, 1)} sales/day</div><div class="val">${money(best.daily, { short: true })}</div></div>
          </div>
          <p class="small muted" style="margin-top:8px">Best exit: ${exitTag(best.best)} · cost ${money(best.cost)} · <a href="#" data-recipe="${best.r.s}">see every cost</a></p>
          ${top5.length > 1 ? `<div class="coinmeter" aria-label="Daily gold potential of the top five crafts">${meter}</div>` : ''}
        ` : '<div class="empty">No profitable Leatherworking craft at current prices. Check Skinning and the Neutral AH.</div>'}
      </div>
      <div class="panel"><h3>Other moves</h3><div class="moves">
        ${moves.map(m => `<button class="move" ${m.recipe ? `data-recipe="${m.recipe}"` : m.go ? `data-go="${m.go}"` : ''}>${m.id ? icon(m.id) : '<span class="icon">◆</span>'}
          <span><span class="kind">${esc(m.kind)}</span><br>${esc(m.name)}</span><span class="amt">${m.amt}</span></button>`).join('')}
      </div></div>
    </div>
    <div class="section"><h3>Market pulse</h3>
      <div class="grid g4" id="pulse">${key.map(id => {
        const p = price(s.house, id);
        return `<div class="panel" data-item="${id}" style="cursor:pointer"><div style="display:flex;gap:10px;align-items:center">${icon(id)}<span class="${'q-' + ['poor','common','uncommon','rare','epic'][item(id).q]}">${esc(item(id).name)}</span></div>
          <div style="display:flex;justify-content:space-between;align-items:end;margin-top:8px"><div><div class="stat val" style="font-size:20px">${money(p.flr ?? p.min)}</div>
          <div class="small">${trendTag(p.tr1)} <span class="muted">· ${num(p.qty)} listed</span></div></div><span class="sp" data-spark="${id}"></span></div></div>`;
      }).join('')}</div>
    </div>`;

  loadHistory(s.house).then(h => {
    el.querySelectorAll('[data-spark]').forEach(n => {
      const x = h[n.dataset.spark];
      if (x) n.innerHTML = sparkline((x.h?.length > 6 ? x.h.map(e => e[1]) : x.d.map(e => e[1])));
    });
  });
  el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => (location.hash = b.dataset.go)));
}

// ============================================================================= LEATHERWORKING
export function leatherworking(el, ctx) {
  const v = view('lw');
  v.sortKey ??= 'daily'; v.filter ??= 'profitable'; v.q ??= '';
  const rows = C.allRecipeRows('leatherworking');
  const known = P.knownRecipes();
  const shown = rows.filter(r => {
    if (v.q && !item(r.r.i).name.toLowerCase().includes(v.q.toLowerCase()) && !r.r.n.toLowerCase().includes(v.q.toLowerCase())) return false;
    if (v.filter === 'profitable') return r.profit !== null && r.profit > 0;
    if (v.filter === 'known') return r.known === true;
    if (v.filter === 'nopattern') return r.r.src !== 'item' || r.known === true;
    return true;
  });
  const profitable = rows.filter(r => r.profit > 0 && !r.missing.length);
  const cols = [
    { key: 'name', label: 'Craft', sort: r => item(r.r.i).name, render: r => `${itemLink(r.r.i, { count: r.makes > 1 ? r.makes : null })}<div class="small">${recipeTags(r)}</div>` },
    { key: 'skill', label: 'Skill', num: true, sort: r => r.r.l || r.r.y, render: r => `${r.r.l || '—'}<span class="muted small"> / ${r.r.y || '?'}</span>` },
    { key: 'cost', label: 'Cost', num: true, render: r => money(r.cost) },
    { key: 'exit', label: 'Best exit', sort: r => r.best?.value, render: r => r.best ? `${exitTag(r.best)} ${money(r.best.value * r.makes)}` : exitTag(null) },
    { key: 'profit', label: 'Profit', num: true, render: r => profitCell(r.profit) },
    { key: 'margin', label: 'Margin', num: true, render: r => r.margin === null ? '—' : `<span class="${r.margin >= 0 ? 'good' : 'bad'}">${pct(r.margin)}</span>` },
    { key: 'spd', label: 'Sells/day', num: true, render: r => r.spd === null ? '<span class="na">—</span>' : num(r.spd, 1) },
    { key: 'daily', label: 'Gold/day', num: true, sort: r => r.daily ?? -1, render: r => r.daily ? money(r.daily, { short: true }) : '<span class="na">—</span>' },
  ];
  el.innerHTML = `
    <div class="vhead"><div><h2>Leatherworking</h2>
      <p>${rows.length} recipes priced from live listings. Reagents use the cheapest of the AH (with slippage on big buys), a vendor, crafting them yourself${S().useBags && P.addon() ? ', or your own bags' : ''}. Profit is after the house cut and the deposits you lose on unsold listings.</p></div>
      <div class="grid g3" style="min-width:min(420px,100%)">
        <div class="stat"><div class="label">Profitable now</div><div class="val">${profitable.length}</div></div>
        <div class="stat"><div class="label">Best margin</div><div class="val good">${pct(Math.max(0, ...profitable.map(r => r.margin)))}</div></div>
        <div class="stat"><div class="label">Known recipes</div><div class="val">${known ? rows.filter(r => r.known).length : '<span class="na small">import addon</span>'}</div></div>
      </div></div>
    <div class="toolbar">
      <input type="search" id="lwq" placeholder="Filter recipes…" value="${esc(v.q)}" style="flex:1 1 220px">
      <div class="seg" role="group" aria-label="Show">
        ${[['profitable', 'Profitable'], ['known', 'Known'], ['nopattern', 'No pattern needed'], ['all', 'All']].map(([k, l]) => `<button aria-pressed="${v.filter === k}" data-f="${k}">${l}</button>`).join('')}
      </div>
    </div>
    <div id="lwtable">${table(shown, cols, { sortKey: v.sortKey, asc: v.asc, rowAttr: r => `class="click${r.known === false ? ' dimrow' : ''}" data-recipe="${r.r.s}"` })}</div>`;
  const q = el.querySelector('#lwq');
  q.addEventListener('input', () => { v.q = q.value; clearTimeout(v._t); v._t = setTimeout(() => { ctx.rerender(); document.getElementById('lwq')?.focus(); }, 250); });
  el.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { v.filter = b.dataset.f; ctx.rerender(); }));
  wireSort(el, v, ctx.rerender);
}

// ============================================================================= SKINNING
export function skinning(el, ctx) {
  const s = S();
  const tiers = C.skinTierValues();
  const logged = C.loggedSkinning();
  const specials = tiers.flatMap(t => t.specials).sort((a, b) => b.perHour - a.perHour);
  const leathers = [2934, 2318, 783, 2319, 4232, 4234, 4235, 4304, 8169, 8170, 8171, ...DB.constants.skinning.special.map(x => x.item), ...DB.constants.skinning.scarce]
    .filter((id, i, a) => a.indexOf(id) === i);
  const rvc = leathers.map(id => ({ id, ...C.rawVersusCraft(id), p: price(s.house, id), n: C.netSale(id, s.neutral) }));
  el.innerHTML = `
    <div class="vhead"><div><h2>Skinning</h2>
      <p>Gold per hour by leather tier and special targets, with your Bountiful Harvest rank boosting scarce materials. Yields are Classic baselines until the addon has logged your own skins. Then <b>Your mobs</b> shows real numbers.</p></div>
      <div class="toolbar" style="margin:0">
        <label class="field">Skins per hour<input id="sph" type="number" min="1" max="600" value="${s.skinsPerHour}" style="width:120px"></label>
        <label class="field">Bountiful Harvest rank<select id="bh">${[0, 1, 2, 3, 4, 5].map(n => `<option ${n === s.bountifulRank ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div></div>
    <div class="grid g2">
      <div class="panel"><h3>Leather tiers</h3>
        ${table(tiers, [
          { key: 'label', label: 'Tier', render: t => `${esc(t.label)}<div class="small muted">mobs ${t.mob[0]}–${t.mob[1]} · ${esc(t.zones.slice(0, 3).join(', '))}</div>` },
          { key: 'base', label: 'Leather', num: true, sort: t => t.perSkin - t.scarce, render: t => money(t.perSkin - t.scarce) },
          { key: 'scarce', label: 'Scarce', num: true, render: t => money(t.scarce) },
          { key: 'perHour', label: 'Per hour', num: true, render: t => `<b>${money(t.perHour, { short: true })}</b>` },
        ], { sortKey: 'perHour', limit: 20 })}
        <p class="small muted">Per skin. Scarce materials (Pristine Leather, Hide and Scale) are counted at ${pct(tiers[0]?.scarceChance, 1)} per skin with your Bountiful Harvest rank. That chance is a guess until your own skinning log replaces it. Prices are what you keep after the cut and deposits.</p>
      </div>
      <div class="panel"><h3>Special targets</h3>
        ${table(specials, [
          { key: 'item', label: 'Target', render: x => `${itemLink(x.item)}<div class="small muted">${esc(x.mob)} · ${esc(x.zone)}</div>` },
          { key: 'unit', label: 'Each', num: true, render: x => money(x.unit) },
          { key: 'perHour', label: 'Per hour', num: true, render: x => `<b>${money(x.perHour, { short: true })}</b>` },
        ], { sortKey: 'perHour', limit: 20 })}
      </div>
    </div>
    <div class="section"><h3>Your mobs <span class="muted small">(from the addon's skinning log)</span></h3>
      ${logged.length ? table(logged, [
        { key: 'name', label: 'Mob', render: m => `${esc(m.name)}<div class="small muted">${esc(m.zone || '')} · ${m.n} skins</div>` },
        { key: 'loot', label: 'Typical loot', nosort: true, render: m => m.lines.sort((a, b) => b.per * b.unit - a.per * a.unit).slice(0, 4).map(l => itemLink(l.id, { count: l.per })).join('<br>') },
        { key: 'perSkin', label: 'Per skin', num: true, render: m => money(m.perSkin) },
        { key: 'rate', label: 'Skins/h', num: true, render: m => m.rate && m.n >= 20 ? num(m.rate) : `<span class="na">${s.skinsPerHour}</span>` },
        { key: 'perHour', label: 'Per hour', num: true, render: m => `<b>${money(m.perHour, { short: true })}</b>` },
      ], { sortKey: 'perHour' }) : '<div class="empty">Skin a few beasts with the Goldforge addon installed, then import. Every skin logs the mob and exactly what it dropped.</div>'}
    </div>
    <div class="section"><h3>Sell raw or craft?</h3>
      ${table(rvc.filter(x => x.p || x.best), [
        { key: 'id', label: 'Material', sort: x => item(x.id).name, render: x => itemLink(x.id) },
        { key: 'raw', label: 'Sell raw (Alliance)', num: true, render: x => money(x.raw) },
        { key: 'n', label: 'Sell raw (neutral)', num: true, render: x => x.n !== null && x.raw !== null && x.n > x.raw ? `<span class="good">${money(x.n)}</span>` : money(x.n) },
        { key: 'craft', label: 'Best craft, per unit', num: true, sort: x => x.best?.perLeather, render: x => x.best ? `${money(x.best.perLeather)}<div class="small"><a href="#" data-recipe="${x.best.r.s}">${esc(item(x.best.r.i).name)}</a></div>` : '<span class="na">—</span>' },
        { key: 'call', label: 'Do this', nosort: true, render: x => {
          const opts = [['Sell raw', x.raw ?? -Infinity], ['Neutral AH', x.n ?? -Infinity], ['Craft', x.best?.perLeather ?? -Infinity]];
          const w = opts.sort((a, b) => b[1] - a[1])[0];
          return w[1] === -Infinity ? '<span class="na">—</span>' : `<span class="tag ${w[0] === 'Craft' ? 'gold' : 'good'}">${w[0]}</span>`;
        } },
        { key: 'spd', label: 'Sells/day', num: true, sort: x => x.p?.spd, render: x => num(x.p?.spd, 0) },
        { key: 'tr', label: '24 h', num: true, sort: x => x.p?.tr1, render: x => trendTag(x.p?.tr1) },
      ], { sortKey: 'raw', limit: 60 })}
    </div>`;
  el.querySelector('#sph').addEventListener('change', e => { P.setSetting('skinsPerHour', Math.max(1, +e.target.value || 80)); ctx.rerender(); });
  el.querySelector('#bh').addEventListener('change', e => { P.setSetting('bountifulRank', +e.target.value); ctx.rerender(); });
}

// ============================================================================= DISENCHANTING
export function disenchant(el, ctx) {
  const s = S();
  const v = view('de');
  v.sortKey ??= 'profit';
  const mats = DB.constants.enchantMats.filter(id => price(s.house, id));
  const crafts = C.allRecipeRows('leatherworking').filter(r => r.cost !== null && r.exits.some(e => e.kind === 'Disenchant'))
    .map(r => { const d = r.exits.find(e => e.kind === 'Disenchant'); return { ...r, deEv: d.value * r.makes, deProfit: d.value * r.makes - r.cost }; })
    .filter(r => r.known !== false).sort((a, b) => b.deProfit - a.deProfit).slice(0, 40);
  const flips = C.deFlips(150);
  const learned = Object.entries(P.addon()?.de || {});
  el.innerHTML = `
    <div class="vhead"><div><h2>Disenchanting</h2>
      <p>In WoW Forever disenchanting has no skill requirement, so your Enchanting 75 bank alt can break anything you mail it. Values use the Classic disenchant table until the addon has logged ${'≥'}3 of your alt's disenchants of an item. Then your real results take over.</p></div>
      <label class="check"><input type="checkbox" id="ench" ${s.enchanter ? 'checked' : ''}> I have an enchanter to mail items to</label></div>
    ${s.enchanter ? '' : '<div class="note warn">Disenchanting is switched off, so it is ignored everywhere.</div>'}
    <div class="panel"><h3>Craft, mail, disenchant</h3>
        ${table(crafts, [
          { key: 'name', label: 'Craft', render: r => itemLink(r.r.i) },
          { key: 'cost', label: 'Cost', num: true, render: r => money(r.cost) },
          { key: 'deEv', label: 'DE value', num: true, render: r => money(r.deEv) },
          { key: 'deProfit', label: 'Profit', num: true, render: r => profitCell(r.deProfit) },
          { key: 'best', label: 'Best exit', nosort: true, render: r => exitTag(r.best) },
        ], { sortKey: 'deProfit', limit: 40, rowAttr: r => `class="click" data-recipe="${r.r.s}"` })}
    </div>
    <div class="panel section"><h3>Enchanting materials</h3>
        ${table(mats.map(id => ({ id, p: price(s.house, id), net: C.netSale(id) })), [
          { key: 'id', label: 'Material', sort: r => item(r.id).name, render: r => itemLink(r.id) },
          { key: 'flr', label: 'Floor', num: true, sort: r => r.p.flr, render: r => money(r.p.flr ?? r.p.min) },
          { key: 'net', label: 'You keep', num: true, render: r => money(r.net) },
          { key: 'spd', label: 'Sells/day', num: true, sort: r => r.p.spd, render: r => num(r.p.spd, 0) },
          { key: 'tr', label: '24 h', num: true, sort: r => r.p.tr1, render: r => trendTag(r.p.tr1) },
        ], { sortKey: 'net', limit: 40 })}
    </div>
    <div class="section"><h3>Buy on the AH to disenchant</h3>
      <p class="muted small">Gear listed below its expected disenchant value after selling the mats (5% cut and deposit risk included). Expected value means averages: single items can come out below it.</p>
      ${table(flips, [
        { key: 'id', label: 'Item', sort: r => r.it.name, render: r => `${itemLink(r.id)}<div class="small muted">ilvl ${r.it.ilvl || '?'} · ${r.de.source}</div>` },
        { key: 'buy', label: 'Buy at', num: true, render: r => money(r.buy) },
        { key: 'ev', label: 'DE value', num: true, render: r => money(r.ev) },
        { key: 'profit', label: 'Profit', num: true, render: r => profitCell(r.profit) },
        { key: 'roi', label: 'ROI', num: true, render: r => pct(r.roi) },
        { key: 'listed', label: 'Listings', num: true, render: r => num(r.listed) },
      ], { sortKey: v.sortKey, asc: v.asc, limit: 150 })}
    </div>
    <div class="section"><h3>Your disenchant log</h3>
      ${learned.length ? table(learned.map(([id, x]) => ({ id: +id, ...x })), [
        { key: 'id', label: 'Item', render: r => itemLink(r.id) },
        { key: 'n', label: 'Times', num: true },
        { key: 'out', label: 'Average result', nosort: true, render: r => Object.entries(r.out).map(([m, c]) => itemLink(+m, { count: c / r.n })).join('<br>') },
      ], { sortKey: 'n' }) : '<div class="empty">Disenchant on your alt with the addon installed and import. Results replace the Classic table item by item.</div>'}
    </div>`;
  el.querySelector('#ench').addEventListener('change', e => { P.setSetting('enchanter', e.target.checked); ctx.rerender(); });
  wireSort(el.querySelector('.section'), v, ctx.rerender);
}

// ============================================================================= NEUTRAL AH
export function neutral(el, ctx) {
  const s = S();
  const v = view('nf');
  v.minProfit ??= 2000; v.minRoi ??= 0.15; v.sortKey ??= 'score';
  const flips = C.neutralFlips({ minProfit: v.minProfit, minRoi: v.minRoi, limit: 200 });
  const goods = [8170, 4304, 4234, 8171, 15417, 15419, 15422, 15423, 15408, 249427, 249428, 249429, 16204, 14344, 16203]
    .filter(id => price(s.house, id) || price(s.neutral, id))
    .map(id => ({ id, a: C.netSale(id, s.house), n: C.netSale(id, s.neutral), na: price(s.house, id)?.spd, nn: price(s.neutral, id)?.spd }));
  const nm = DB.meta.houses[s.neutral];
  el.innerHTML = `
    <div class="vhead"><div><h2>Neutral auction house</h2>
      <p>The Blackwater auction house in Gadgetzan, Booty Bay and Everlook is the only place Alliance and Horde trade. It keeps <b>15%</b> of each sale and charges <b>5×</b> the deposit, and every number here includes both. Snapshot ${nm ? ago(nm.snapshot) : 'not loaded'}.</p></div></div>
    <div class="panel" style="margin-bottom:16px"><h3>Where to sell your goods</h3>
      ${table(goods, [
        { key: 'id', label: 'Item', sort: g => item(g.id).name, render: g => itemLink(g.id) },
        { key: 'a', label: 'You keep (Alliance)', num: true, render: g => money(g.a) },
        { key: 'n', label: 'You keep (neutral)', num: true, render: g => money(g.n) },
        { key: 'na', label: 'Sells/day (Alliance)', num: true, render: g => num(g.na, 1) },
        { key: 'nn', label: 'Sells/day (neutral)', num: true, render: g => num(g.nn, 1) },
        { key: 'w', label: 'Sell on', nosort: true, render: g => g.a === null && g.n === null ? '—' : (g.n ?? -1) > (g.a ?? -1)
          ? `<span class="tag gold">Neutral</span>${g.nn !== undefined && g.nn !== null && g.nn < 2 ? ' <span class="tag warn">slow market</span>' : ''}` : '<span class="tag good">Alliance</span>' },
      ], { sortKey: 'a', limit: 30 })}
    </div>
    <div class="toolbar">
      <label class="field">Min profit per unit<select id="mp">${[[500, '5s'], [2000, '20s'], [10000, '1g'], [50000, '5g']].map(([c, l]) => `<option value="${c}" ${c === v.minProfit ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Min return<select id="mr">${[[0.05, '5%'], [0.15, '15%'], [0.3, '30%'], [0.5, '50%']].map(([c, l]) => `<option value="${c}" ${c === v.minRoi ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="muted small" style="flex:1 1 280px">Ranked by profit × the units you could realistically move (what's cheaply available, capped by sales per day on the side you sell to).</p>
    </div>
    ${table(flips, [
      { key: 'id', label: 'Item', sort: f => item(f.id).name, render: f => itemLink(f.id) },
      { key: 'dir', label: 'Route', render: f => `<span class="tag ${f.dir.startsWith('Alliance') ? 'gold' : 'good'}">${f.dir}</span>` },
      { key: 'buy', label: 'Buy at', num: true, render: f => money(f.buy) },
      { key: 'sell', label: 'List at', num: true, render: f => money(f.sell) },
      { key: 'profit', label: 'Profit/unit', num: true, render: f => profitCell(f.profit) },
      { key: 'roi', label: 'Return', num: true, render: f => pct(f.roi) },
      { key: 'avail', label: 'Cheap units', num: true, render: f => num(f.avail) },
      { key: 'demand', label: 'Sells/day there', num: true, render: f => num(f.demand, 1) },
      { key: 'score', label: 'Potential', num: true, render: f => money(f.score, { short: true }) },
    ], { sortKey: v.sortKey, asc: v.asc, limit: 200 })}`;
  el.querySelector('#mp').addEventListener('change', e => { v.minProfit = +e.target.value; ctx.rerender(); });
  el.querySelector('#mr').addEventListener('change', e => { v.minRoi = +e.target.value; ctx.rerender(); });
  wireSort(el, v, ctx.rerender);
}

// ============================================================================= BAGS
export function bags(el, ctx) {
  const a = P.addon();
  if (!a) {
    el.innerHTML = `<div class="vhead"><div><h2>My Bags</h2></div></div><div class="empty">Install the Goldforge addon, log in on your Hunter and your bank alt (open the bank once on each), type <b>/gf export</b>, then paste it in <a href="#setup">Settings</a>.</div>`;
    return;
  }
  const v = view('bags');
  v.sortKey ??= 'value';
  const rows = C.bagAdvice();
  const chars = P.stockByChar();
  const total = rows.reduce((t, r) => t + r.value, 0);
  el.innerHTML = `
    <div class="vhead"><div><h2>My Bags</h2><p>Everything in your bags and bank across ${chars.length} character${chars.length === 1 ? '' : 's'}, with the best thing to do with each. Exported ${ago(a.exported)}.</p></div>
      <div class="stat"><div class="label">Worth (best exits)</div><div class="val">${money(total, { short: true })}</div></div></div>
    <div class="grid g4" style="margin-bottom:16px">${chars.map(c => `<div class="panel"><p class="kicker">${esc(c.faction || '')} · level ${c.level || '?'}</p><h3>${esc(c.name)}</h3>
      <div class="small">${money(c.money || 0)}<br>${Object.entries(c.profs || {}).map(([p, x]) => `${esc(p)} ${x.rank}/${x.max}`).join(' · ')}</div></div>`).join('')}</div>
    ${table(rows, [
      { key: 'id', label: 'Item', sort: r => r.it.name, render: r => itemLink(r.id, { count: r.n }) },
      { key: 'best', label: 'Best exit', sort: r => r.best?.value, render: r => r.best ? `${exitTag(r.best)} ${money(r.best.value)} each` : '<span class="na">keep / no market</span>' },
      { key: 'value', label: 'Total', num: true, render: r => money(r.value) },
      { key: 'craft', label: 'Or craft', sort: r => r.craft?.profit, render: r => r.craft ? `<a href="#" data-recipe="${r.craft.r.s}">${esc(item(r.craft.r.i).name)}</a> <span class="good">${money(r.craft.profit, { sign: true })}</span>` : '<span class="na">—</span>' },
    ], { sortKey: v.sortKey, asc: v.asc })}`;
  wireSort(el, v, ctx.rerender);
}

// ============================================================================= LEDGER
export function ledger(el, ctx) {
  const a = P.addon();
  const entries = [...(a?.ledger || []), ...P.manualEntries()].map(e => (e.item || !e.name ? e : { ...e, item: idByName(e.name) }))
    .sort((x, y) => y.t - x.t);
  const now = Date.now() / 1000;
  const sum = (days, f) => entries.filter(e => e.t >= now - days * 86400).reduce((t, e) => t + f(e), 0);
  const income = e => e.type === 'sale' ? e.gold : e.type === 'other' && e.gold > 0 ? e.gold : 0;
  const spent = e => e.type === 'buy' ? e.gold : e.type === 'other' && e.gold < 0 ? -e.gold : 0;
  const fees = e => (e.cut || 0) + (e.type === 'expired' || e.type === 'cancelled' ? (e.deposit || 0) : 0);
  const net = e => income(e) - spent(e) - (e.type === 'expired' || e.type === 'cancelled' ? (e.deposit || 0) : 0);
  const days = [...Array(30)].map((_, i) => {
    const d0 = Math.floor(now / 86400 - 29 + i) * 86400;
    return { d0, v: entries.filter(e => e.t >= d0 && e.t < d0 + 86400).reduce((t, e) => t + net(e), 0) };
  });
  const maxAbs = Math.max(1, ...days.map(d => Math.abs(d.v)));
  const byItem = {};
  for (const e of entries.filter(x => x.t >= now - 30 * 86400)) {
    const k = e.item || e.name || 'other';
    byItem[k] ||= { k, item: e.item, name: e.name, in: 0, out: 0, n: 0 };
    byItem[k].in += income(e); byItem[k].out += spent(e); byItem[k].n += e.qty || 1;
  }
  const label = { sale: 'Sold', buy: 'Bought', expired: 'Expired', cancelled: 'Cancelled', other: 'Other', post: 'Posted' };
  el.innerHTML = `
    <div class="vhead"><div><h2>Ledger</h2><p>Sales and purchases the addon reads from your mailbox and the auction house, plus anything you add by hand. Fees are the 5% cut plus deposits lost on auctions that expired or that you cancelled.</p></div></div>
    <div class="grid g4">
      ${[['Income, 7 days', sum(7, income)], ['Spent, 7 days', -sum(7, spent)], ['Fees, 7 days', -sum(7, fees)], ['Net, 30 days', sum(30, net)]].map(([l, val]) =>
        `<div class="panel stat"><div class="label">${l}</div><div class="val">${money(val, { sign: true, short: true })}</div></div>`).join('')}
    </div>
    <div class="panel section"><h3>Net per day, last 30 days</h3>
      ${entries.length ? `<div class="ledgerbars">${days.map(d => `<div class="${d.v >= 0 ? 'pos' : 'negb'}" style="height:${Math.max(2, Math.abs(d.v) / maxAbs * 100)}%" title="${new Date(d.d0 * 1000).toLocaleDateString('en-GB')} ${moneyText(d.v)}"></div>`).join('')}</div>` : '<div class="empty">No entries yet. Import from the addon after a selling session, or add one below.</div>'}
    </div>
    <div class="grid g2 section">
      <div class="panel"><h3>Top items, 30 days</h3>
        ${table(Object.values(byItem), [
          { key: 'k', label: 'Item', render: r => r.item ? itemLink(r.item) : esc(r.name || 'Other') },
          { key: 'in', label: 'Income', num: true, render: r => money(r.in) },
          { key: 'out', label: 'Spent', num: true, render: r => money(r.out) },
          { key: 'net', label: 'Net', num: true, sort: r => r.in - r.out, render: r => profitCell(r.in - r.out) },
        ], { sortKey: 'net', limit: 15 })}
      </div>
      <div class="panel"><h3>Add an entry</h3>
        <form id="addEntry" class="grid" style="gap:10px">
          <label class="field">What<select name="type"><option value="sale">Sale</option><option value="buy">Purchase</option><option value="other">Other (+ or −)</option></select></label>
          <label class="field">Item or note<input name="name" required placeholder="e.g. Rugged Leather"></label>
          <div class="grid g3"><label class="field">Gold<input name="g" type="number" min="0" value="0"></label><label class="field">Silver<input name="s" type="number" min="0" max="99" value="0"></label><label class="field">Quantity<input name="qty" type="number" min="1" value="1"></label></div>
          <button class="btn" type="submit">Add to ledger</button>
        </form>
      </div>
    </div>
    <div class="section"><h3>Entries</h3>
      ${table(entries.slice(0, 300), [
        { key: 't', label: 'When', render: e => new Date(e.t * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) },
        { key: 'type', label: 'Type', render: e => `<span class="tag ${e.type === 'sale' ? 'good' : e.type === 'buy' ? '' : 'warn'}">${label[e.type] || e.type}</span>${e.manual ? ' <span class="tag">manual</span>' : ''}` },
        { key: 'item', label: 'Item', render: e => e.item ? itemLink(e.item, { count: e.qty }) : `${esc(e.name || '')}${e.qty > 1 ? ` ×${e.qty}` : ''}` },
        { key: 'gold', label: 'Amount', num: true, render: e => profitCell(e.type === 'buy' ? -e.gold : (e.type === 'expired' || e.type === 'cancelled') ? -(e.deposit || 0) : e.gold) },
        { key: 'cut', label: 'AH cut', num: true, render: e => e.cut ? money(e.cut) : '' },
        { key: 'char', label: 'Character', render: e => esc(e.char || '') },
        { key: 'x', label: '', nosort: true, render: e => e.manual ? `<button class="btn ghost" data-del="${e.id}" style="min-height:32px;padding:2px 10px">Remove</button>` : '' },
      ], { sortKey: 't' })}
    </div>`;
  el.querySelector('#addEntry').addEventListener('submit', ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const gold = (+f.get('g') || 0) * 10000 + (+f.get('s') || 0) * 100;
    const name = String(f.get('name')).trim();
    const match = searchItems(name, 1)[0];
    const exact = match && item(match).name.toLowerCase() === name.toLowerCase() ? match : null;
    P.addManual({ t: Math.floor(Date.now() / 1000), type: f.get('type'), name, item: exact, qty: +f.get('qty') || 1, gold: f.get('type') === 'other' ? gold : gold });
    toast('Added to the ledger');
    ctx.rerender();
  });
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { P.removeManual(b.dataset.del); ctx.rerender(); }));
}

// ============================================================================= MARKET
export function market(el, ctx) {
  const s = S();
  const v = view('market');
  v.sortKey ??= 'spd'; v.cat ??= 'leather'; v.q ??= '';
  const pr = DB.prices[s.house];
  const leatherSet = new Set([2934, 2318, 783, 2319, 4232, 4234, 4235, 4304, 8169, 8170, 8171, 15407, 4231, 4233, 4236, 8172,
    ...DB.constants.skinning.special.map(x => x.item), ...DB.constants.skinning.scarce, 248825]);
  const lwProducts = new Set(DB.recipes.filter(r => r.p === 'leatherworking').map(r => r.i));
  const lwReagents = new Set(DB.recipes.filter(r => r.p === 'leatherworking').flatMap(r => r.r.map(x => x[0])));
  const ench = new Set(DB.constants.enchantMats);
  const ids = Object.keys(pr?.items || {}).map(Number).filter(id => {
    if (v.q) return item(id).name.toLowerCase().includes(v.q.toLowerCase());
    if (v.cat === 'leather') return leatherSet.has(id);
    if (v.cat === 'reagents') return lwReagents.has(id);
    if (v.cat === 'crafts') return lwProducts.has(id);
    if (v.cat === 'enchanting') return ench.has(id);
    return true;
  });
  const rows = ids.map(id => ({ id, p: price(s.house, id), n: price(s.neutral, id) }));
  el.innerHTML = `
    <div class="vhead"><div><h2>Market</h2><p>Every item on your auction house in the latest snapshot (${num(Object.keys(pr?.items || {}).length)} items). Search for any item, or browse a group.</p></div></div>
    <div class="toolbar">
      <input type="search" id="mq" placeholder="Search all items…" value="${esc(v.q)}" style="flex:1 1 220px">
      <div class="seg" role="group" aria-label="Group">${[['leather', 'Leather & skins'], ['reagents', 'LW reagents'], ['crafts', 'LW crafts'], ['enchanting', 'Enchanting'], ['all', 'All']].map(([k, l]) => `<button aria-pressed="${!v.q && v.cat === k}" data-c="${k}">${l}</button>`).join('')}</div>
    </div>
    ${table(rows, [
      { key: 'id', label: 'Item', sort: r => item(r.id).name, render: r => itemLink(r.id) },
      { key: 'flr', label: 'Floor', num: true, sort: r => r.p.flr, render: r => money(r.p.flr ?? r.p.min) },
      { key: 'mkt', label: 'Market', num: true, sort: r => r.p.mkt, render: r => money(r.p.mkt) },
      { key: 'avg7', label: '7-day avg', num: true, sort: r => r.p.avg7, render: r => money(r.p.avg7) },
      { key: 'tr1', label: '24 h', num: true, sort: r => r.p.tr1, render: r => trendTag(r.p.tr1) },
      { key: 'qty', label: 'Listed', num: true, sort: r => r.p.qty, render: r => num(r.p.qty) },
      { key: 'spd', label: 'Sells/day', num: true, sort: r => r.p.spd, render: r => num(r.p.spd, 1) },
      { key: 'neutral', label: 'Neutral floor', num: true, sort: r => r.n?.flr, render: r => money(r.n ? (r.n.flr ?? r.n.min) : null) },
    ], { sortKey: v.sortKey, asc: v.asc, limit: 300 })}`;
  const q = el.querySelector('#mq');
  q.addEventListener('input', () => { v.q = q.value; clearTimeout(v._t); v._t = setTimeout(() => { ctx.rerender(); document.getElementById('mq')?.focus(); }, 250); });
  el.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => { v.cat = b.dataset.c; v.q = ''; ctx.rerender(); }));
  wireSort(el, v, ctx.rerender);
}

// ============================================================================= SETTINGS
export function setup(el, ctx) {
  const s = S();
  const a = P.addon();
  const hm = C.houseMatch();
  const houses = Object.entries(DB.meta.houses);
  const check = [8170, 4304, 2318, 4234, 16204, 14344].filter(id => price(s.house, id));
  const sel = (key, opts) => `<select data-k="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const numIn = (key, step = 1, scale = 1) => `<input type="number" data-k="${key}" data-scale="${scale}" step="${step}" value="${+(s[key] * scale).toFixed(4)}">`;
  el.innerHTML = `
    <div class="vhead"><div><h2>Settings</h2><p>Everything here stays in this browser. Use Backup to copy it to your phone.</p></div></div>
    <div class="grid g2">
      <div class="panel"><h3>Your market</h3>
        <div class="grid g2">
          <label class="field">Your auction house${sel('house', houses.filter(([, h]) => h.faction !== 'Neutral').map(([id, h]) => [id, `${h.label} (#${id})`]))}</label>
          <label class="field">Neutral auction house${sel('neutral', houses.filter(([, h]) => h.faction === 'Neutral').map(([id, h]) => [id, `${h.label} (#${id})`]))}</label>
        </div>
        <h3 class="section" style="margin-top:16px">House check</h3>
        ${hm && hm.length ? `<p>Compared ${hm[0].n} prices you saw in game with each snapshot:</p>${table(hm, [
            { key: 'label', label: 'House', render: r => `${esc(r.label)} <span class="muted">#${r.house}</span>` },
            { key: 'rate', label: 'Prices within 5%', num: true, render: r => `${r.close} / ${r.n} (${pct(r.rate)})` },
          ], { sortKey: 'rate', stack: false })}
          ${hm[0].house !== +s.house && hm[0].rate > (hm.find(h => h.house === +s.house)?.rate ?? 0) + 0.2 ? `<div class="note warn">Your prices match #${hm[0].house} better than #${s.house}. <button class="btn ghost" data-sethouse="${hm[0].house}">Switch to #${hm[0].house}</button></div>` : '<div class="note">Your in-game prices match the selected house.</div>'}`
          : `<p class="small">Blizzard does not label the houses. #111 is EU Normal Alliance by its ID group (EU Normal Horde #114 is confirmed). To confirm, check these floors in game. They are from the ${clock(DB.meta.houses[s.house]?.snapshot || 0)} snapshot, so small moves are normal:</p>
          <div class="kv">${check.map(id => `<dt>${itemLink(id)}</dt><dd>${money(price(s.house, id).flr ?? price(s.house, id).min)}</dd>`).join('')}</div>
          <p class="small muted">With the addon, searching a few commodities at the AH and importing does this check for you.</p>`}
      </div>
      <div class="panel"><h3>Goldforge addon</h3>
        ${a ? `<p>Imported ${ago(a.imported)} · ${Object.keys(a.chars).length} character(s): ${Object.values(a.chars).map(c => esc(c.name)).join(', ')} · ${a.ledger.length} ledger entries.</p>` : '<p>Not imported yet.</p>'}
        <ol class="small"><li>Copy the <b>Goldforge</b> folder from the repo's <code>addon/</code> folder into <code>World of Warcraft\\_forever_\\Interface\\AddOns</code>.</li>
        <li>Log in, open your Leatherworking window once, and open the bank and mailbox on each character.</li><li>Type <b>/gf export</b>, press Ctrl+C, and paste below.</li></ol>
        <textarea id="imp" placeholder="GF1:{…}" aria-label="Addon export"></textarea>
        <div class="toolbar" style="margin-top:8px"><button class="btn" id="doImp">Import</button>${a ? '<button class="btn ghost" id="clrImp">Forget imported data</button>' : ''}</div>
      </div>
    </div>
    <div class="grid g2 section">
      <div class="panel"><h3>Selling and fees</h3>
        <div class="grid g2">
          <label class="field">Price you list at${sel('sellBasis', [['undercut', 'Undercut the floor'], ['market', 'Market value'], ['sold', 'What it actually sold for (7 days)']])}</label>
          <label class="field">Undercut by (copper)${numIn('undercut')}</label>
          <label class="field">Auction duration${sel('duration', [[2, '2 hours'], [8, '8 hours'], [24, '24 hours']])}</label>
          <label class="field">Minimum deposit per listing${sel('minDeposit', [[1, '1 copper (after Nov 17/18 change)'], [100, '1 silver (launch rule)']])}</label>
          <label class="field">Deposit, % of vendor price (${s.duration} h)<input type="number" id="dp" step="1" value="${Math.round((s.depositPct[s.duration] ?? 0.6) * 100)}"></label>
          <label class="field">House cut, faction AH (%)${numIn('ahCut', 0.5, 100)}</label>
          <label class="field">House cut, neutral AH (%)${numIn('neutralCut', 0.5, 100)}</label>
          <label class="field">Neutral deposit multiplier${numIn('neutralDepositMult', 0.5)}</label>
          <label class="field">Units per commodity listing${numIn('postStack')}</label>
          <label class="field">Commodity sell-through (%)${numIn('sellThroughCommodity', 1, 100)}</label>
          <label class="field">Gear sell-through (%)${numIn('sellThroughGear', 1, 100)}</label>
          <label class="field">Share of daily sales you win (%)${numIn('marketShare', 1, 100)}</label>
        </div>
        <p class="small muted">Sell-through is the share of listings that sell before they expire. Every failed listing loses its deposit, so a low sell-through raises the real cost of selling.</p>
      </div>
      <div class="panel"><h3>Materials and crafting</h3>
        <div class="grid">
          <label class="field">Value materials you already own at${sel('ownMats', [['sell', 'What they would sell for (recommended)'], ['buy', 'What they cost to buy'], ['free', 'Free (cash view)']])}</label>
          <label class="check"><input type="checkbox" data-k="useBags" ${s.useBags ? 'checked' : ''}> Use what's in my bags and bank first</label>
          <label class="check"><input type="checkbox" data-k="onlyKnown" ${s.onlyKnown ? 'checked' : ''}> Only recipes I know (needs the addon)</label>
          <label class="check"><input type="checkbox" data-k="includeCamp" ${s.includeCamp ? 'checked' : ''}> Include camp objects</label>
          <label class="check"><input type="checkbox" data-k="enchanter" ${s.enchanter ? 'checked' : ''}> I have an enchanter (bank alt) for disenchanting</label>
          <label class="field">Skins per hour${numIn('skinsPerHour')}</label>
          <label class="field">Bountiful Harvest rank${sel('bountifulRank', [0, 1, 2, 3, 4, 5].map(n => [n, n]))}</label>
        </div>
        <div class="toolbar" style="margin-top:10px"><button class="btn ghost" id="reset">Reset to defaults</button></div>
      </div>
    </div>
    <div class="grid g2 section">
      <div class="panel"><h3>Backup and other devices</h3>
        <p class="small">Copies your settings, imported addon data and manual ledger entries. Paste it into Goldforge on another device.</p>
        <div class="toolbar"><button class="btn ghost" id="copyBk">Copy backup</button></div>
        <textarea id="bk" placeholder="Paste a backup here to restore it" aria-label="Backup"></textarea>
        <div class="toolbar" style="margin-top:8px"><button class="btn ghost" id="restore">Restore</button></div>
      </div>
      <div class="panel"><h3>Data</h3>
        <dl class="kv">
          ${houses.map(([id, h]) => `<dt>#${id} ${esc(h.label)}</dt><dd>snapshot ${h.snapshot ? `${clock(h.snapshot)} (${ago(h.snapshot)})` : '—'} · ${num(h.items)} items${h.coverage7h !== undefined ? ` · ${num(h.coverage7h)} h of sales history` : ''}</dd>`).join('')}
          <dt>Recipes</dt><dd>${DB.recipes.length} from ${esc(DB.recipeSource || 'seed')}</dd>
          <dt>Updated</dt><dd>${ago(DB.meta.generated)}</dd>
        </dl>
        ${DB.meta.dev ? '<div class="note warn">Preview data: real prices from a public EU snapshot, simulated sales history.</div>' : ''}
      </div>
    </div>`;

  el.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', () => {
    const k = inp.dataset.k;
    let val = inp.type === 'checkbox' ? inp.checked : inp.value;
    if (inp.type === 'number') val = (+inp.value || 0) / (+inp.dataset.scale || 1);
    else if (['house', 'neutral', 'duration', 'minDeposit', 'bountifulRank'].includes(k)) val = +val;
    P.setSetting(k, val);
    ctx.rerender(); toast('Saved');
  }));
  el.querySelector('#dp').addEventListener('change', e => { P.setSetting('depositPct', { ...s.depositPct, [s.duration]: (+e.target.value || 0) / 100 }); ctx.rerender(); });
  el.querySelector('#reset').addEventListener('click', () => { P.resetSettings(); ctx.rerender(); toast('Settings reset'); });
  el.querySelector('#doImp').addEventListener('click', () => {
    try {
      const data = P.parseAddonExport(el.querySelector('#imp').value);
      const r = P.importAddon(data);
      toast(`Imported ${Object.keys(data.chars).length} character(s), ${r.ledger.length} ledger entries`);
      ctx.rerender();
    } catch (e) { toast(e.message); }
  });
  el.querySelector('#clrImp')?.addEventListener('click', () => { P.clearAddon(); ctx.rerender(); toast('Imported data removed'); });
  el.querySelector('[data-sethouse]')?.addEventListener('click', e => { P.setSetting('house', +e.target.dataset.sethouse); ctx.rerender(); });
  el.querySelector('#copyBk').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(P.exportProfile()); toast('Backup copied'); }
    catch (_) { el.querySelector('#bk').value = P.exportProfile(); el.querySelector('#bk').select(); toast('Select the text and copy it'); }
  });
  el.querySelector('#restore').addEventListener('click', () => {
    try { P.importProfile(el.querySelector('#bk').value); ctx.rerender(); toast('Restored'); } catch (e) { toast(e.message); }
  });
}

// ============================================================================= DRAWERS
export function recipeDrawer(body, spell, ctx) {
  const r = DB.recipes.find(x => x.s === +spell);
  if (!r) { body.innerHTML = '<p>Recipe not found.</p>'; return; }
  const v = view('drawer');
  const crafts = v.crafts || 1;
  C.resetMemo();
  const ev = C.evaluateRecipe(r, crafts);
  const s = S();
  const prod = item(r.i);
  const sale = ev.exits.find(e => e.kind === 'AH')?.sale;
  const best = ev.best;
  const stockMap = P.stock();
  const shopping = ev.reagents.map(x => {
    const need = x.n * crafts;
    const have = s.useBags ? Math.min(stockMap[x.id] || 0, need) : 0;
    return { ...x, need, have, buy: need - have };
  });
  const ahList = shopping.filter(x => x.buy > 0 && x.source !== 'Vendor').map(x => `"${item(x.id).name}"`);
  const auctionator = `Goldforge ${prod.name}^${ahList.join('^')}`;
  const wf = [];
  if (best) {
    if (best.kind === 'AH' || best.kind === 'Neutral AH') {
      const b = best.sale;
      wf.push(['Listed at', b.gross * ev.makes * crafts]);
      wf.push([`House cut (${pct(b.cutRate)})`, -b.cut * ev.makes * crafts, true]);
      wf.push([`Deposits lost (${pct(b.sellThrough)} sell-through)`, -b.depositLoss * ev.makes * crafts, true]);
    } else {
      wf.push([best.kind === 'Disenchant' ? 'Disenchant value (mats after fees)' : 'Vendor', best.value * ev.makes * crafts]);
    }
  }
  wf.push(['Reagents', -(ev.cost ?? 0) * crafts, true]);
  body.innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;margin-right:48px">${icon(r.i, 'lg')}<div>
      <h2 class="${'q-' + ['poor','common','uncommon','rare','epic','legendary'][prod.q]}" style="color:inherit">${esc(prod.name)}</h2>
      <div class="small muted">Leatherworking · learn ${r.l || '?'} · yellow ${r.y || '?'} · grey ${r.g || '?'} · ${r.src === 'item' ? `pattern${r.patn ? `: ${esc(r.patn)}` : ''}` : esc(r.src || 'trainer')}</div>
      <div class="small">${recipeTags(ev)}</div></div></div>
    <div class="toolbar section"><label class="field">Crafts<input id="crafts" type="number" min="1" max="500" value="${crafts}" style="width:110px"></label>
      <div class="stat"><div class="label">Profit</div><div class="val">${profitCell(ev.profit === null ? null : ev.profit * crafts)}</div></div>
      <div class="stat"><div class="label">Margin</div><div class="val">${pct(ev.margin)}</div></div>
      <div class="stat"><div class="label">Sells/day</div><div class="val">${num(ev.spd, 1)}</div></div></div>
    <div class="section"><h3>Where the gold goes</h3><div class="waterfall">
      ${wf.map(([l, val, neg]) => `<div class="wf"><span>${l}</span><span class="${neg ? 'neg' : ''}">${money(val, { sign: !!neg })}</span></div>`).join('')}
      <div class="wf total"><span>Profit</span>${profitCell(ev.profit === null ? null : ev.profit * crafts)}</div></div>
      ${ev.bop ? '<div class="note warn">This item binds when picked up. It cannot be sold on the auction house. Disenchant or vendor only.</div>' : ''}
    </div>
    <div class="section"><h3>Reagents for ${crafts} craft${crafts > 1 ? 's' : ''}</h3>
      ${table(shopping, [
        { key: 'id', label: 'Reagent', render: x => itemLink(x.id, { count: x.need }) },
        { key: 'source', label: 'Cheapest from', render: x => `<span class="tag ${x.source === 'Craft' ? 'gold' : x.source === 'Bags' ? 'good' : ''}">${x.source}${x.source === 'Craft' ? `: ${esc(item(x.detail.i).name)}` : ''}</span>${x.options?.length > 1 ? `<div class="small muted">${x.options.filter(o => o.source !== x.source).map(o => `${o.source} ${moneyText(o.unit)}`).join(' · ')}</div>` : ''}` },
        { key: 'unit', label: 'Each', num: true, render: x => money(x.unit) },
        { key: 'have', label: 'In bags', num: true, render: x => x.have ? num(x.have) : '' },
        { key: 'total', label: 'Total', num: true, render: x => money(x.unit === null ? null : x.unit * x.need) },
      ], { stack: false })}
      <div class="toolbar" style="margin-top:8px"><button class="btn ghost" id="copyAuc">Copy Auctionator shopping list</button></div>
    </div>
    <div class="section"><h3>Ways to sell one</h3>
      ${table(ev.exits, [
        { key: 'kind', label: 'Exit', render: e => exitTag(e) },
        { key: 'value', label: 'You keep', num: true, render: e => money(e.value) },
        { key: 'how', label: 'How', nosort: true, render: e => e.sale ? `list ${moneyText(e.sale.gross)}, cut ${moneyText(e.sale.cut)}, deposit risk ${moneyText(e.sale.depositLoss)}`
          : e.de ? e.de.lines.map(l => `${(l.chance * 100).toFixed(0)}% × ${num(l.count, 1)} ${esc(item(l.id).name)}`).join(', ') + ` <span class="muted">(${esc(e.de.source)})</span>` : 'sell to any vendor' },
      ], { stack: false })}
    </div>
    <div class="section"><h3>Price history</h3><div class="fig" id="hist"></div>
      ${ev.market ? `<p class="small muted">Floor ${moneyText(ev.market.flr ?? ev.market.min)} · market ${moneyText(ev.market.mkt)} · ${num(ev.market.qty)} listed in ${num(ev.market.n)} auctions${ev.market.wall ? ` · ${num(ev.market.wall)} within 5% of the floor` : ''}</p>` : '<p class="small muted">Not listed on your auction house right now.</p>'}
    </div>`;
  body.querySelector('#crafts').addEventListener('change', e => { v.crafts = Math.max(1, Math.min(500, +e.target.value || 1)); recipeDrawer(body, spell, ctx); });
  body.querySelector('#copyAuc').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(auctionator); toast('Copied — Auctionator → Shopping → Import'); }
    catch (_) { toast('Copy blocked by the browser'); }
  });
  loadHistory(s.house).then(h => drawHistory(body.querySelector('#hist'), h[r.i]));
}

export function itemDrawer(body, id, ctx) {
  const s = S();
  const it = item(id);
  const ex = C.exits(id);
  const de = C.deValue(id);
  const madeBy = DB.recipesByProduct[id] || [];
  C.resetMemo();
  const usedIn = (DB.recipesByReagent[id] || []).map(r => C.evaluateRecipe(r)).sort((a, b) => (b.profit ?? -1e12) - (a.profit ?? -1e12)).slice(0, 12);
  const houses = Object.entries(DB.meta.houses).map(([h, m]) => ({ h, m, p: price(h, id) })).filter(x => x.p);
  body.innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;margin-right:48px">${icon(id, 'lg')}<div>
      <h2 class="${'q-' + ['poor','common','uncommon','rare','epic','legendary'][it.q]}" style="color:inherit">${esc(it.name)}</h2>
      <div class="small muted">${it.ilvl ? `Item level ${it.ilvl} · ` : ''}${it.bind === 1 ? 'Binds when picked up' : it.bind === 2 ? 'Binds when equipped' : 'Tradeable'}${it.sell ? ` · vendor ${moneyText(it.sell)}` : ''}</div></div></div>
    <div class="section"><h3>Auction houses</h3>
      ${houses.length ? table(houses, [
        { key: 'h', label: 'House', render: x => `${esc(x.m.label)} <span class="muted">#${x.h}</span>${+x.h === +s.house ? ' <span class="tag good">yours</span>' : ''}` },
        { key: 'flr', label: 'Floor', num: true, sort: x => x.p.flr, render: x => money(x.p.flr ?? x.p.min) },
        { key: 'mkt', label: 'Market', num: true, sort: x => x.p.mkt, render: x => money(x.p.mkt) },
        { key: 'qty', label: 'Listed', num: true, sort: x => x.p.qty, render: x => num(x.p.qty) },
        { key: 'spd', label: 'Sells/day', num: true, sort: x => x.p.spd, render: x => num(x.p.spd, 1) },
      ], { stack: false }) : '<div class="empty">Not listed on any tracked auction house right now.</div>'}
    </div>
    <div class="section"><h3>Ways to sell one</h3>
      ${ex.length ? table(ex, [
        { key: 'kind', label: 'Exit', render: e => exitTag(e) },
        { key: 'value', label: 'You keep', num: true, render: e => money(e.value) },
      ], { stack: false }) : '<div class="empty">No way to sell this.</div>'}
      ${de ? `<p class="small muted">Disenchants into ${de.lines.map(l => `${(l.chance * 100).toFixed(0)}% × ${num(l.count, 1)} ${esc(item(l.id).name)}`).join(', ')} (${esc(de.source)}).</p>` : ''}
    </div>
    <div class="section"><h3>Price history</h3><div class="fig" id="hist"></div></div>
    ${madeBy.length ? `<div class="section"><h3>Made by</h3>${madeBy.map(r => `<p><a href="#" data-recipe="${r.s}">${esc(r.n)}</a> <span class="muted small">(${r.p}, skill ${r.l || r.y})</span></p>`).join('')}</div>` : ''}
    ${usedIn.length ? `<div class="section"><h3>Used in</h3>${table(usedIn, [
      { key: 'r', label: 'Craft', render: e => itemLink(e.r.i) },
      { key: 'profit', label: 'Profit', num: true, render: e => profitCell(e.profit) },
      { key: 'margin', label: 'Margin', num: true, render: e => pct(e.margin) },
    ], { sortKey: 'profit', stack: false, rowAttr: e => `class="click" data-recipe="${e.r.s}"` })}</div>` : ''}`;
  loadHistory(s.house).then(h => drawHistory(body.querySelector('#hist'), h[id]));
}
