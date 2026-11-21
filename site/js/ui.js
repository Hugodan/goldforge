// Shared UI pieces: item links, tooltips, sortable tables, sparklines and the price chart.
import { DB, item, iconUrl, qualityClass, price, money, num, esc, pct, clock } from './data.js';
import { S } from './profile.js';
import { deValue, saleBreakdown, vendorPrice } from './calc.js';

export function icon(id, size = '') {
  const it = item(id);
  const url = iconUrl(id);
  const q = it.q >= 2 ? ` q${it.q}` : '';
  const letter = esc((it.name || '?').replace(/^\W+/, '')[0] || '?');
  return `<span class="icon ${size}${q}"><span class="il">${letter}</span>${url ? `<img src="${url}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}

export function itemLink(id, { count = null, size = 'sm', bracket = false } = {}) {
  const it = item(id);
  const nm = bracket ? `[${esc(it.name)}]` : esc(it.name);
  return `<span class="item" data-item="${it.id}">${icon(id, size)}<span class="nm ${qualityClass(it.q)}">${nm}</span>${count ? `<span class="muted"> ×${num(count, 2)}</span>` : ''}</span>`;
}

// ----------------------------------------------------------------------------- tooltip
const tt = () => document.getElementById('tt');

export function tooltipHTML(id) {
  const it = item(id);
  const s = S();
  const p = price(s.house, id);
  const n = price(s.neutral, id);
  const lines = [];
  lines.push(`<div class="tn ${qualityClass(it.q)}">${esc(it.name)}</div>`);
  if (it.bind === 1) lines.push('<div>Binds when picked up</div>'); else if (it.bind === 2) lines.push('<div>Binds when equipped</div>');
  if (it.ilvl) lines.push(`<div class="muted">Item level ${it.ilvl}</div>`);
  lines.push('<div class="sep"></div>');
  if (p) {
    lines.push(`<div class="tl"><span>Floor</span>${money(p.flr ?? p.min)}</div>`);
    lines.push(`<div class="tl"><span>Market value</span>${money(p.mkt)}</div>`);
    lines.push(`<div class="tl"><span>Listed</span><span>${num(p.qty)} in ${num(p.n)} auctions</span></div>`);
    if (p.spd !== undefined && p.spd !== null) lines.push(`<div class="tl"><span>Sells / day</span><span>~${num(p.spd, 1)}</span></div>`);
    const sb = saleBreakdown(id);
    if (sb) lines.push(`<div class="tl"><span>You keep / unit</span>${money(sb.net)}</div>`);
  } else lines.push('<div class="muted">Not on your auction house right now</div>');
  if (n) lines.push(`<div class="tl"><span>Neutral AH floor</span>${money(n.flr ?? n.min)}</div>`);
  const de = deValue(id);
  if (de) lines.push(`<div class="tl"><span>Disenchant EV</span>${money(de.ev)}</div>`);
  const v = vendorPrice(id);
  if (v) lines.push(`<div class="tl"><span>Vendor sells for</span>${money(v)}</div>`);
  if (it.sell) lines.push(`<div class="tl"><span>Vendor buys at</span>${money(it.sell)}</div>`);
  return lines.join('');
}

export function bindTooltips(root, onClickItem) {
  root.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-item]');
    if (!el || !matchMedia('(hover: hover)').matches) return;
    const t = tt();
    t.innerHTML = tooltipHTML(el.dataset.item);
    t.classList.add('open');
  });
  root.addEventListener('mousemove', e => {
    const t = tt();
    if (!t.classList.contains('open')) return;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = e.clientX + 18, y = e.clientY + 18;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = innerHeight - h - 8;
    t.style.left = `${x}px`; t.style.top = `${y}px`;
  });
  root.addEventListener('mouseout', e => {
    if (e.target.closest('[data-item]')) tt().classList.remove('open');
  });
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-item]');
    if (el && !e.target.closest('a,button,input,select')) { tt().classList.remove('open'); onClickItem(+el.dataset.item); }
  });
}

// ----------------------------------------------------------------------------- tables
/**
 * cols: [{key, label, num, render(row), sort(row) }]
 * Returns HTML; call wireTable(container, state, rerender) after inserting.
 */
export function table(rows, cols, { sortKey, asc = false, rowAttr = () => '', limit = 400, stack = true } = {}) {
  const col = cols.find(c => c.key === sortKey);
  if (col) {
    const f = col.sort || (r => r[col.key]);
    rows = [...rows].sort((a, b) => {
      const x = f(a), y = f(b);
      if (x === y) return 0;
      if (x === null || x === undefined || Number.isNaN(x)) return 1;
      if (y === null || y === undefined || Number.isNaN(y)) return -1;
      return (x < y ? -1 : 1) * (asc ? 1 : -1);
    });
  }
  const head = cols.map(c => `<th${c.num ? ' class="n' : ' class="'}${c.key === sortKey ? ` sorted${asc ? ' asc' : ''}` : ''}"${c.nosort ? '' : ` data-sort="${c.key}"`} scope="col">${c.label}</th>`).join('');
  const body = rows.slice(0, limit).map(r => `<tr ${rowAttr(r)}>${cols.map(c => `<td${c.num ? ' class="n"' : ''}>${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
  const more = rows.length > limit ? `<p class="muted small">Showing ${limit} of ${rows.length}. Narrow the filter to see more.</p>` : '';
  return `<div class="tablewrap"><table class="${stack ? 'stack' : ''}"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="muted">Nothing matches.</td></tr>`}</tbody></table></div>${more}`;
}

export function wireSort(container, state, rerender) {
  container.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (state.sortKey === k) state.asc = !state.asc; else { state.sortKey = k; state.asc = false; }
    rerender();
  }));
}

// ----------------------------------------------------------------------------- charts
export function sparkline(values, { w = 90, h = 26, color = '#ffd100' } = {}) {
  const v = values.filter(x => x !== null && x !== undefined);
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 2 - (x - lo) / span * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Draw a price history chart into an element with class .fig (daily market + hourly floor). */
export function drawHistory(fig, hist) {
  if (!hist || (!hist.d?.length && !hist.h?.length)) { fig.innerHTML = '<div class="empty">No history yet — it builds up hour by hour once the collector runs.</div>'; fig.style.minHeight = '0'; return; }
  const svgNS = 'http://www.w3.org/2000/svg';
  const draw = () => {
    const W = fig.clientWidth, H = fig.clientHeight;
    if (!W) return;
    const daily = (hist.d || []).filter(d => d[1]).map(d => [Date.parse(d[0] + 'T12:00:00Z') / 1000, d[1]]);
    const hourly = (hist.h || []).map(h => [h[0], h[1]]);
    const all = [...daily, ...hourly];
    const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]));
    const lo = Math.min(...all.map(p => p[1])) * 0.95, hi = Math.max(...all.map(p => p[1])) * 1.05;
    const L = 64, R = 10, T = 12, B = 26;
    const x = t => L + (t - t0) / Math.max(1, t1 - t0) * (W - L - R);
    const y = v => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
    const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    const ticks = [lo, (lo + hi) / 2, hi].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#2c2218"/><text x="${L - 6}" y="${y(v) + 4}" fill="#a8977c" font-size="11" text-anchor="end">${fmtShort(v)}</text>`).join('');
    const days = W > 520 ? daily.filter((_, i) => i % Math.ceil(daily.length / 6) === 0).map(p => `<text x="${x(p[0])}" y="${H - 6}" fill="#786a55" font-size="11" text-anchor="middle">${new Date(p[0] * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</text>`).join('') : '';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `${ticks}${days}
      ${daily.length > 1 ? `<path d="${path(daily)}" fill="none" stroke="#ffd100" stroke-width="2.2"/>` : ''}
      ${hourly.length > 1 ? `<path d="${path(hourly)}" fill="none" stroke="#3d9cff" stroke-width="1.4" opacity=".9"/>` : ''}
      <g font-size="12"><rect x="${L + 6}" y="${T}" width="10" height="3" fill="#ffd100"/><text x="${L + 20}" y="${T + 5}" fill="#dccba7">Daily market value</text>
      <rect x="${L + 150}" y="${T}" width="10" height="3" fill="#3d9cff"/><text x="${L + 164}" y="${T + 5}" fill="#dccba7">Hourly floor (72 h)</text></g>`;
    fig.replaceChildren(svg);
  };
  const ro = new ResizeObserver(draw);
  ro.observe(fig);
  draw();
}

function fmtShort(c) {
  if (c >= 10000) return `${(c / 10000).toFixed(c >= 100000 ? 0 : 1)}g`;
  if (c >= 100) return `${(c / 100).toFixed(0)}s`;
  return `${Math.round(c)}c`;
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('open');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('open'), 3200);
}

export const trendTag = tr => tr === null || tr === undefined ? '<span class="na">—</span>'
  : `<span class="${tr > 0 ? 'good' : tr < 0 ? 'bad' : 'muted'}">${tr > 0 ? '▲' : tr < 0 ? '▼' : '■'} ${Math.abs(tr).toFixed(0)}%</span>`;

export { pct, money, num, esc, clock };
