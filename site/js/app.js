// Router, header status, search, drawers and the live refresh loop.
import { DB, loadAll, refreshMeta, ago, clock, esc, searchItems, item, addExtraRecipes } from './data.js';
import { S, addonRecipes } from './profile.js';
import { resetMemo } from './calc.js';
import { bindTooltips, itemLink, toast } from './ui.js';
import * as V from './views.js';

// Replaced with the commit id when the site is deployed; the page compares it with
// version.txt so a tab left open (or a cached copy) offers a reload after an update.
const BUILD = '__BUILD__';
let updateReady = false;
const VIEWS = ['board', 'leatherworking', 'cooking', 'skinning', 'disenchant', 'recipes', 'recipefarm', 'neutral', 'bags', 'ledger', 'market', 'setup'];
const el = document.getElementById('view');
const drawer = document.getElementById('drawer');
const drawerBody = document.getElementById('drawerBody');
let current = 'board';
let drawerState = null;

const ctx = {
  rerender: () => render(false),
  openItem: id => openDrawer({ kind: 'item', id }),
  openRecipe: s => openDrawer({ kind: 'recipe', id: s }),
};

function route() {
  const h = location.hash.replace('#', '');
  current = VIEWS.includes(h) ? h : 'board';
  document.querySelectorAll('#tabs a').forEach(a => (a.dataset.view === current
    ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  render(true);
}

function render(scrollTop) {
  resetMemo();
  addExtraRecipes(addonRecipes());
  try {
    V[current](el, ctx);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="empty">Something went wrong drawing this page: ${esc(e.message)}</div>`;
  }
  if (scrollTop) window.scrollTo({ top: 0 });
  if (drawerState) openDrawer(drawerState, true);
  status();
}

function status() {
  const s = S();
  const h = DB.meta.houses[s.house];
  const n = DB.meta.houses[s.neutral];
  const age = h?.snapshot ? Date.now() / 1000 - h.snapshot : Infinity;
  const dot = age < 75 * 60 ? '' : age < 3 * 3600 ? 'stale' : 'old';
  const next = h?.snapshot ? h.snapshot + 3600 : null;
  document.getElementById('status').innerHTML = `
    <span class="chip alliance"><span class="dot ${dot}"></span><b>${esc(h?.label || `House ${s.house}`)}</b></span>
    <span class="chip" title="Blizzard snapshot time">Prices ${h?.snapshot ? `${clock(h.snapshot)} · ${ago(h.snapshot)}` : 'not loaded'}</span>
    ${next ? `<span class="chip">Next ≈ ${clock(next)}</span>` : ''}
    ${n?.snapshot ? `<span class="chip">Neutral ${ago(n.snapshot)}</span>` : ''}
    ${updateReady ? '<button type="button" class="chip update" id="reloadApp">Goldforge updated · reload</button>' : ''}`;
}

async function checkVersion() {
  if (BUILD.startsWith('__')) return;            // local preview
  try {
    const r = await fetch(`version.txt?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const live = (await r.text()).trim();
    if (live && live !== BUILD && !updateReady) {
      // Nothing typed yet on a page that just opened with stale code: reload straight away.
      if (performance.now() < 15000 && !sessionStorage.getItem('gf.reloaded.' + live)) {
        sessionStorage.setItem('gf.reloaded.' + live, '1');
        location.reload();
        return;
      }
      updateReady = true;
      status();
    }
  } catch (_) { /* offline */ }
}
document.addEventListener('click', e => { if (e.target.closest('#reloadApp')) location.reload(); });

// ----------------------------------------------------------------------------- drawer
function openDrawer(state, silent = false) {
  drawerState = state;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  if (state.kind === 'recipe') V.recipeDrawer(drawerBody, state.id, ctx);
  else V.itemDrawer(drawerBody, state.id, ctx);
  if (!silent) drawer.querySelector('.drawer-frame').scrollTop = 0;
}
function closeDrawer() {
  drawerState = null;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}
document.getElementById('drawerClose').addEventListener('click', closeDrawer);
drawer.addEventListener('click', e => { if (e.target === drawer) closeDrawer(); });
addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

// recipe links anywhere
document.addEventListener('click', e => {
  const r = e.target.closest('[data-recipe]');
  if (r && !e.target.closest('input,select,textarea')) { e.preventDefault(); openDrawer({ kind: 'recipe', id: +r.dataset.recipe }); }
});

// ----------------------------------------------------------------------------- search
const search = document.getElementById('search');
const results = document.getElementById('searchResults');
search.addEventListener('input', () => {
  const ids = searchItems(search.value);
  results.innerHTML = ids.map(id => `<button type="button" data-open="${id}" role="option">${itemLink(id)}</button>`).join('');
  results.classList.toggle('open', ids.length > 0);
});
results.addEventListener('click', e => {
  const b = e.target.closest('[data-open]');
  if (!b) return;
  e.stopPropagation();
  results.classList.remove('open');
  search.value = '';
  openDrawer({ kind: 'item', id: +b.dataset.open });
});
search.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const first = results.querySelector('[data-open]'); if (first) first.click(); }
});
document.addEventListener('click', e => { if (!e.target.closest('.search')) results.classList.remove('open'); });

// ----------------------------------------------------------------------------- boot
async function boot() {
  try {
    await loadAll();
  } catch (e) {
    el.innerHTML = `<div class="empty"><h3>No price data yet</h3><p>${esc(e.message)}</p>
      <p>The collector publishes <code>data/</code> after its first successful run. Check the repo's Actions tab, and that the BNET_CLIENT_ID and BNET_CLIENT_SECRET secrets are set.</p></div>`;
    return;
  }
  bindTooltips(document.body, id => openDrawer({ kind: 'item', id }));
  addEventListener('hashchange', route);
  route();
  setInterval(status, 30000);
  checkVersion();
  setInterval(checkVersion, 4 * 60 * 1000);
  setInterval(async () => {
    try {
      if (await refreshMeta()) { render(false); toast(`New prices: ${clock(DB.meta.houses[S().house].snapshot)} snapshot`); }
    } catch (_) { /* offline: keep showing what we have */ }
  }, 4 * 60 * 1000);
}
boot();
