/**
 * CRI Radar dashboard — composition of the static frontend.
 * Reads data/latest.json (the engine's published contract), renders views by hash route, and hosts
 * the shared behaviours: research drawer, tooltips, theme, copy-to-clipboard.
 */
import { $, html, on, setHTML, storage } from './core/dom.js';
import { pct, score, usd } from './core/format.js';
import { HEALTH, L, icon, initLabels } from './core/labels.js';
import { SnapshotError, loadSnapshot } from './core/store.js';
import { dnaTooltip } from './charts/dna.js';
import { analogsMarkup } from './views/analogs.js';
import { bindCatalysts, catalystsMarkup } from './views/catalysts.js';
import { drawerMarkup } from './views/drawer.js';
import { healthMarkup } from './views/health.js';
import { heroMarkup } from './views/hero.js';
import { derivativesMarkup, narrativesMarkup } from './views/markets.js';
import { methodologyMarkup } from './views/methodology.js';
import { bindRadar, radarMarkup } from './views/radar.js';
import { bindDiscovery, discoveryMarkup } from './views/discovery.js';
import { bindFutures, futuresMarkup } from './views/futures.js';
import { bindResearch, researchMarkup, researchState } from './views/research.js';
import { parityMarkup } from './views/parity.js';
import { marketStrip, noticeMarkup, notices, topMeta } from './views/shell.js';
import { trackMarkup } from './views/track.js';
import { bindUniverse, ensureUniverse, universeMarkup } from './views/universe.js';
import { criTipBody, gradeTipBody, lifeTipBody, shortSignal, signalTipBody } from './views/widgets.js';

/**
 * Three primary sections, then the secondary menu. The order is the order a researcher works in:
 * where is the market right now (futures), what is quietly changing (small-cap radar), and then one
 * project in full (deep research). Everything after the separator supports those three.
 */
const ROUTES = [
  { id: 'futures', label: 'Futures Radar', primary: true, render: futuresMarkup, count: (s) => (s.futures?.summary?.graded ?? 0) },
  { id: 'radar-small-cap', label: 'Small-Cap Radar', primary: true, render: discoveryMarkup, count: (s) => (s.discovery?.answering ?? 0) },
  { id: 'deep-research', label: 'Deep Research', primary: true, render: researchMarkup, count: (s) => (s.discovery?.rows ?? []).filter((r) => r.detail === 'full' || r.platforms?.length).length },
  // The whole horizon, from data/universe.json — loaded only when this screen is opened.
  { id: 'univers', label: 'Univers', render: universeMarkup, count: (s) => s.meta?.universe?.projects ?? 0, enter: (s) => (s.meta?.universe ? ensureUniverse(s.meta.universe.file ?? 'data/universe.json') : Promise.resolve()) },
  { id: 'alerte', label: 'Alerte', render: catalystsMarkup, count: (s) => (s.alerts?.items ?? []).length },
  { id: 'analogi', label: 'Analogi LAB/BTW/AGT', render: analogsMarkup, count: (s) => (s.references ?? []).length },
  { id: 'radar', label: 'Radar CRI', render: radarMarkup, count: (s) => s.candidates.length },
  { id: 'derivate', label: 'Derivate', render: derivativesMarkup, count: (s) => (s.derivatives?.squeezeWatch ?? []).length },
  { id: 'narative', label: 'Narative', render: narrativesMarkup },
  { id: 'track-record', label: 'Track record', render: trackMarkup, count: (s) => (s.trackRecord?.recent ?? []).length },
  { id: 'paritate', label: 'Paritate și bugete', render: parityMarkup },
  { id: 'surse', label: 'Date și surse', render: healthMarkup },
  { id: 'metodologie', label: 'Metodologie', render: methodologyMarkup },
];

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

/* ---------------- routing ---------------- */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  const route = ROUTES.find((r) => r.id === path) ?? ROUTES[0];
  return { route, token: params.get('t') };
}

function hrefFor(routeId, token) {
  return `#/${routeId}${token ? `?t=${encodeURIComponent(token)}` : ''}`;
}

/** Sticky offset for table headers = sticky top of the tabs + their rendered height. */
function measureSticky() {
  const tabs = $('#tabs');
  if (!tabs) return;
  const h = (Number.parseFloat(getComputedStyle(tabs).top) || 56) + tabs.offsetHeight;
  document.documentElement.style.setProperty('--stick-top', `${h}px`);
}

/** Natural (un-stuck) document offset of the tabs, from a sentinel placed right before them. */
function tabsNaturalTop() {
  const anchor = $('#tabs-anchor');
  const tabs = $('#tabs');
  const margin = Number.parseFloat(getComputedStyle(tabs).marginTop) || 0;
  return (anchor ? anchor.getBoundingClientRect().top + window.scrollY : 0) + margin;
}

function renderTabs() {
  const s = state.snap;
  const tab = (r) => {
    const n = r.count ? r.count(s) : null;
    return html`<a class="tab" ${r.primary ? html`data-primary="1"` : ''} href="${hrefFor(r.id)}" ${state.route?.id === r.id ? html`aria-current="page"` : ''}>${r.label}${Number.isFinite(n) && n > 0 ? html`<span class="count">${n}</span>` : ''}</a>`;
  };
  setHTML($('#tabs'), html`<div class="frame">
    ${ROUTES.filter((r) => r.primary).map(tab)}
    <span class="tab-sep" aria-hidden="true"></span>
    ${ROUTES.filter((r) => !r.primary).map(tab)}
  </div>`);
  measureSticky();
}

function renderView({ keepFocus = null } = {}) {
  const view = $('#view');
  let caret = null;
  if (keepFocus) {
    const el = $(keepFocus, view);
    if (el && typeof el.selectionStart === 'number') caret = el.selectionStart;
  }
  setHTML(view, html`<div class="frame">${state.route.render(state.snap)}</div>`);
  if (keepFocus) {
    const el = $(keepFocus, view);
    if (el) {
      el.focus();
      if (caret !== null) el.setSelectionRange(caret, caret);
    }
  }
}

function onRoute() {
  const { route, token } = parseHash();
  const first = state.route === null;
  const changed = state.route?.id !== route.id;
  state.route = route;
  if (changed) {
    renderTabs();
    renderView();
    // A screen with its own data file renders a loading state first, then itself once it arrives.
    if (route.enter) route.enter(state.snap).then(() => { if (state.route === route) renderView(); });
    // Switching sections while scrolled down: bring the new section's start under the sticky tabs.
    const stickTop = Number.parseFloat(getComputedStyle($('#tabs')).top) || 56;
    const target = tabsNaturalTop() - stickTop;
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
  for (const id of ['#market-strip', '#tabs', '#hero']) {
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
  setHTML($('#hero'), heroMarkup(snap));
  $('#footer-meta') && setHTML($('#footer-meta'), html`Schema ${snap.schemaVersion}, rulare ${snap.meta.runId}, ${HEALTH[snap.health?.overall]?.label ?? ''}.`);


  const view = $('#view');
  bindRadar(view, (opts) => renderView(opts));
  bindCatalysts(view, () => renderView());
  bindDiscovery(view, (opts) => renderView(opts));
  bindFutures(view, () => renderView());
  bindResearch(view, () => renderView());
  bindUniverse(view, (opts) => renderView(opts));

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
