/**
 * CRI Radar dashboard — composition root of the static frontend.
 * Reads data/latest.json (the engine's published contract) and renders it: the navigation model
 * (core/navigation.js) says which sections exist and where they sit, screens.js binds a view to
 * each of them, and this file hosts the shared behaviours — router, the two menus, research
 * drawer, tooltips, theme, copy-to-clipboard.
 */
import { $, html, on, setHTML, storage } from './core/dom.js';
import { pct, score, usd } from './core/format.js';
import { HEALTH, L, icon, initLabels } from './core/labels.js';
import { hrefFor, mainSections, menuSections, parseHash, sectionById } from './core/navigation.js';
import { SnapshotError, loadSnapshot } from './core/store.js';
import { SCREENS } from './screens.js';
import { dnaTooltip } from './charts/dna.js';
import { bindCatalysts } from './views/catalysts.js';
import { bindChat } from './views/chat.js';
import { bindDiscovery } from './views/discovery.js';
import { drawerMarkup } from './views/drawer.js';
import { bindFutures } from './views/futures.js';
import { bindRadar } from './views/radar.js';
import { bindResearch, researchState } from './views/research.js';
import { mainTabsMarkup, marketStrip, menuMarkup, noticeMarkup, notices, topMeta } from './views/shell.js';
import { bindUniverse } from './views/universe.js';
import { bindValidity } from './views/validity.js';
import { criTipBody, gradeTipBody, lifeTipBody, shortSignal, signalTipBody } from './views/widgets.js';

const state = { snap: null, route: null, openKey: null, lastFocus: null };

/* ---------------- theme ---------------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#theme-toggle');
  if (btn) {
    setHTML(btn, icon(theme === 'dark' ? 'sun' : 'moon', 16));
    btn.setAttribute('aria-label', theme === 'dark' ? 'Comută pe tema luminoasă' : 'Comută pe tema întunecată');
  }
}

/* ---------------- navigation ---------------- */

/** Sticky offset for table headers = sticky top of the second menu + its rendered height. */
function measureSticky() {
  const menu = $('#menu');
  if (!menu) return;
  const h = (Number.parseFloat(getComputedStyle(menu).top) || 56) + menu.offsetHeight;
  document.documentElement.style.setProperty('--stick-top', `${h}px`);
}

/** Natural (un-stuck) document offset of the second menu, from a sentinel placed right before it. */
function menuNaturalTop() {
  const anchor = $('#menu-anchor');
  return anchor ? anchor.getBoundingClientRect().top + window.scrollY : 0;
}

/** Keep the horizontal position of the second menu across a re-render, and never leave the current entry off-screen. */
function keepActiveVisible(scrollLeft) {
  const bar = $('#menu .frame');
  if (!bar) return;
  bar.scrollLeft = scrollLeft;
  const cur = $('[aria-current="page"]', bar);
  if (!cur) return;
  const box = bar.getBoundingClientRect();
  const r = cur.getBoundingClientRect();
  if (r.left < box.left || r.right > box.right) bar.scrollLeft += (r.left + r.right) / 2 - (box.left + box.right) / 2;
}

/** Both bars: level 1 (main sections, tabs) and level 2 (the second menu), each entry with its live count. */
function renderNav() {
  const s = state.snap;
  const item = (sec) => ({ id: sec.id, label: sec.label, count: SCREENS[sec.id].count?.(s) ?? null });
  const scrollLeft = $('#menu .frame')?.scrollLeft ?? 0;
  setHTML($('#tabs'), mainTabsMarkup(mainSections().map(item), state.route?.id));
  setHTML($('#menu'), menuMarkup({ work: menuSections('work').map(item), support: menuSections('support').map(item) }, state.route?.id));
  keepActiveVisible(scrollLeft);
  measureSticky();
}

function renderView({ keepFocus = null } = {}) {
  const view = $('#view');
  let caret = null;
  if (keepFocus) {
    const el = $(keepFocus, view);
    if (el && typeof el.selectionStart === 'number') caret = el.selectionStart;
  }
  setHTML(view, html`<div class="frame">${SCREENS[state.route.id].render(state.snap)}</div>`);
  if (keepFocus) {
    const el = $(keepFocus, view);
    if (el) {
      el.focus();
      if (caret !== null) el.setSelectionRange(caret, caret);
    }
  }
}

function onRoute() {
  const { id, token } = parseHash(location.hash);
  const route = sectionById(id);
  const screen = SCREENS[id];
  const first = state.route === null;
  const changed = state.route?.id !== id;
  state.route = route;
  document.documentElement.dataset.page = id; // a page may restyle the frame (the assistant hides the market strip)
  if (changed) {
    renderNav();
    renderView();
    // A screen with its own data file renders a loading state first, then itself once it arrives.
    if (screen.enter) {
      screen.enter(state.snap).then(() => {
        if (state.route !== route) return;
        renderNav(); // counts that depend on the loaded data (assistant history, agent findings)
        renderView();
      });
    }
    // Switching sections while scrolled down: bring the new section's start under the sticky second menu.
    const stickTop = Number.parseFloat(getComputedStyle($('#menu')).top) || 56;
    const target = menuNaturalTop() - stickTop;
    if (!first && window.scrollY > target) window.scrollTo({ top: target });
  }
  if (token && token !== state.openKey) openDrawer(token, { fromRoute: true });
  if (!token && state.openKey) closeDrawer({ fromRoute: true });
}

/* ---------------- drawer ---------------- */
function openDrawer(key, { fromRoute = false } = {}) {
  const c = state.snap.byKey.get(key);
  if (!c) return;
  if (!fromRoute) {
    location.hash = hrefFor(state.route.id, key);
    return; // hashchange re-enters with fromRoute
  }
  state.openKey = key;
  if (!state.lastFocus) state.lastFocus = document.activeElement;
  const drawer = $('#drawer');
  setHTML(drawer, drawerMarkup(c, state.snap, { narrow: window.innerWidth < 720 }));
  drawer.hidden = false;
  $('#scrim').hidden = false;
  document.body.style.overflow = 'hidden';
  drawer.scrollTop = 0;
  $('[data-close]', drawer)?.focus();
  document.title = `${c.symbol} | CRI Radar`;
}

function closeDrawer({ fromRoute = false } = {}) {
  if (!fromRoute) {
    location.hash = hrefFor(state.route.id);
    return;
  }
  state.openKey = null;
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
  document.body.style.overflow = '';
  document.title = 'CRI Radar';
  hideTip();
  if (state.lastFocus?.isConnected) state.lastFocus.focus();
  state.lastFocus = null;
}

function trapFocus(e) {
  const drawer = $('#drawer');
  if (drawer.hidden || e.key !== 'Tab') return;
  const items = [...drawer.querySelectorAll('a[href], button, [tabindex="0"], summary')].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------------- tooltips ---------------- */
const tipEl = () => $('#tooltip');
let tipTarget = null;

const TIP_FNS = {
  sig: (el) => signalTipBody(el.dataset.sig, el.dataset.strength === '' ? null : Number(el.dataset.strength)),
  life: (el) => lifeTipBody(el.dataset.stage, el.dataset.proxy === '1'),
  risk: (el) => {
    const c = state.snap.byKey.get(el.dataset.key);
    return c ? gradeTipBody(c.risk) : null;
  },
  cri: (el) => {
    const c = state.snap.byKey.get(el.dataset.key);
    return c ? criTipBody(c.score) : null;
  },
  dna: (el) => {
    const c = state.snap.byKey.get(el.dataset.key);
    const ref = state.snap.refBySymbol.get(el.dataset.ref);
    return c && ref ? dnaTooltip(c, ref, state.snap.features, state.snap.sigma) : null;
  },
  cand: (el) => {
    const c = state.snap.byKey.get(el.dataset.key);
    if (!c) return null;
    const b = c.analogs?.best;
    return html`<b>${c.symbol}</b> <span class="muted">${c.name}</span>
      <div class="tt-row"><span>Semnal</span><span>${shortSignal(c.signal?.type ?? 'NONE')}</span></div>
      <div class="tt-row"><span>CRI</span><span>${score(c.score?.cri)} (${c.score?.tier})</span></div>
      <div class="tt-row"><span>Analog</span><span>${b ? `${b.ref} ${Math.round(b.similarity)} (ADN ${Math.round(b.dnaSim ?? 0)})` : '—'}</span></div>
      <div class="tt-row"><span>Stadiu</span><span>${L.stages[c.stage] ?? c.stage}</span></div>
      <div class="tt-row"><span>Market cap</span><span>${usd(c.market?.marketCap)}</span></div>
      <div class="tt-row"><span>7 zile</span><span>${pct(c.market?.change?.d7)}</span></div>`;
  },
};

function showTip(target, x, y) {
  const el = tipEl();
  let content = null;
  if (target.dataset.tipfn) content = TIP_FNS[target.dataset.tipfn]?.(target) ?? null;
  else content = target.dataset.tip ?? null;
  if (!content) return;
  // data-tip holds markup this app generated (values escaped at build time); tipfn returns Raw.
  if (typeof content === 'string') el.innerHTML = content;
  else setHTML(el, content);
  el.hidden = false;
  tipTarget = target;
  positionTip(x, y);
}

function positionTip(x, y) {
  const el = tipEl();
  if (el.hidden) return;
  const pad = 14;
  const r = el.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - pad);
  if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - pad);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function hideTip() {
  const el = tipEl();
  if (el) el.hidden = true;
  tipTarget = null;
}

function bindTooltips() {
  const finder = (t) => (t instanceof Element ? t.closest('[data-tip],[data-tipfn]') : null);
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = finder(e.target);
    if (t && t !== tipTarget) showTip(t, e.clientX, e.clientY);
    if (!t && tipTarget) hideTip();
  });
  document.addEventListener('pointermove', (e) => {
    if (tipTarget) positionTip(e.clientX, e.clientY);
  });
  document.addEventListener('pointerout', (e) => {
    if (tipTarget && !finder(e.relatedTarget)) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const t = finder(e.target);
    if (t) {
      const r = t.getBoundingClientRect();
      showTip(t, r.left, r.bottom);
    }
  });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true });
}

/* ---------------- boot ---------------- */
function renderError(err) {
  const kind = err instanceof SnapshotError ? err.kind : 'UNKNOWN';
  const local = location.protocol === 'file:';
  setHTML($('#view'), html`<div class="frame"><div class="empty" style="margin-top:24px;text-align:left;max-width:720px">
    <strong>${kind === 'MISSING' ? 'Încă nu există un snapshot publicat.' : 'Snapshot-ul nu a putut fi citit.'}</strong>
    <p style="margin-top:6px">${local ? 'Pagina a fost deschisă direct din fișier; browserul blochează citirea datelor. Pornește serverul local: npm run demo (date simulate) sau npm run scan && npm run build && npm run serve (date reale).' : kind === 'MISSING' ? 'Rulează workflow-ul „Scan & deploy” din tab-ul Actions al repository-ului; după primul run, dashboard-ul se populează automat la fiecare 4 ore.' : `Detalii: ${err?.message ?? err}. Reîncarcă pagina; dacă persistă, verifică ultimul run din GitHub Actions.`}</p>
  </div></div>`);
  setHTML($('#snapshot-meta'), html`<span class="muted">fără date</span>`);
  for (const id of ['#market-strip', '#tabs', '#menu']) {
    const el = $(id);
    if (el) el.hidden = true;
  }
}

async function boot() {
  applyTheme(storage.get('cri.theme', 'dark') === 'light' ? 'light' : 'dark');
  on(document, 'click', '#theme-toggle', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    storage.set('cri.theme', next);
    applyTheme(next);
  });
  bindTooltips();

  let snap;
  try {
    snap = await loadSnapshot('data/latest.json');
  } catch (err) {
    renderError(err);
    return;
  }
  state.snap = snap;
  initLabels(snap.methodology);

  setHTML($('#snapshot-meta'), topMeta(snap));
  setHTML($('#notice'), noticeMarkup(notices(snap)));
  setHTML($('#market-strip'), marketStrip(snap));
  $('#footer-meta') && setHTML($('#footer-meta'), html`Schema ${snap.schemaVersion}, rulare ${snap.meta.runId}, ${HEALTH[snap.health?.overall]?.label ?? ''}.`);


  const view = $('#view');
  bindRadar(view, (opts) => renderView(opts));
  bindCatalysts(view, () => renderView());
  bindDiscovery(view, (opts) => renderView(opts));
  bindFutures(view, () => renderView());
  bindResearch(view, () => renderView());
  bindUniverse(view, (opts) => renderView(opts));
  bindValidity(view, (opts) => renderView(opts));
  bindChat(view);

  // Opening a project from any list jumps to its full dossier when the drawer is not the better fit.
  on(document, 'click', '[data-dossier]', (e, el) => {
    e.preventDefault();
    researchState.key = el.dataset.dossier;
    location.hash = hrefFor('deep-research');
  });

  on(document, 'click', '[data-open]', (e, el) => {
    if (e.target instanceof Element && e.target.closest('a[href]')) return;
    e.preventDefault();
    openDrawer(el.dataset.open);
  });
  on(document, 'click', '[data-close]', () => closeDrawer());
  on(document, 'click', '#scrim', () => closeDrawer());
  on(document, 'click', '[data-copy]', async (e, el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.copy);
      const old = el.dataset.tip;
      el.dataset.tip = 'Copiat în clipboard';
      showTip(el, e.clientX, e.clientY);
      setTimeout(() => {
        el.dataset.tip = old ?? '';
      }, 1500);
    } catch {
      /* clipboard unavailable: the address is still visible in the tooltip */
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#drawer').hidden) closeDrawer();
      hideTip();
    }
    trapFocus(e);
  });
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('resize', measureSticky, { passive: true });
  onRoute();
}

boot();
