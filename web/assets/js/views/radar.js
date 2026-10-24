/** Radar: the full screener of published candidates with filters and sortable columns. */
import { html, tip } from '../core/dom.js';
import { frac, funding, pct, signClass, usd } from '../core/format.js';
import { L, SIGNAL_ORDER, SIGNAL_RANK, icon } from '../core/labels.js';
import { ui } from '../core/store.js';
import { dnaStrip } from '../charts/dna.js';
import { sparkline } from '../charts/lines.js';
import { change, cri, gradeBadge, lifecycle, refChip, shortSignal, signalBadge } from './widgets.js';

const HYPE_SHORT = { STEALTH: 'discret', EMERGING: 'atenție în creștere', HYPED: 'hype activ', EXHAUSTED: 'hype epuizat', UNKNOWN: 'atenție necunoscută' };
const GRADE_ORDER = { A: 1, B: 2, C: 3, D: 4 };
const PAGE = 150;
let shown = PAGE;

const SORTERS = {
  rank: (c) => SIGNAL_RANK[c.signal?.type ?? 'NONE'] * 1000 + (c.score?.cri ?? 0),
  cri: (c) => c.score?.cri,
  analog: (c) => c.analogs?.best?.similarity,
  stage: (c) => L.stageOrder.indexOf(c.stage),
  mcap: (c) => c.market?.marketCap,
  d7: (c) => c.market?.change?.d7,
  turnover: (c) => c.market?.turnover,
  oi: (c) => c.derivatives?.oiToMcap,
  risk: (c) => GRADE_ORDER[c.risk?.grade] ?? 9,
};

export function filterCandidates(s, f = ui.filters) {
  const q = f.q.trim().toLowerCase();
  return s.candidates.filter((c) => {
    if (q && !(`${c.symbol} ${c.name} ${c.contract ?? ''}`.toLowerCase().includes(q))) return false;
    if (f.signal !== 'ALL' && c.signal?.type !== f.signal) return false;
    if (f.stage !== 'ALL' && c.stage !== f.stage) return false;
    if (f.analog !== 'ALL' && c.analogs?.best?.ref !== f.analog) return false;
    if (f.chain !== 'ALL' && c.chain !== f.chain) return false;
    if (f.grade !== 'ALL' && c.risk?.grade !== f.grade) return false;
    if (f.deepOnly && c.depth !== 'deep') return false;
    if (f.hideLate && (c.signal?.type === 'LATE' || c.hype === 'HYPED' || c.stage === 'EXPANSION' || c.stage === 'POST_EXPANSION')) return false;
    return true;
  });
}

function sortCandidates(list) {
  const fn = SORTERS[ui.sort.key] ?? SORTERS.rank;
  const dir = ui.sort.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = fn(a);
    const vb = fn(b);
    const na = Number.isFinite(va);
    const nb = Number.isFinite(vb);
    if (!na && !nb) return 0;
    if (!na) return 1; // unknown values always last, whatever the direction
    if (!nb) return -1;
    return (va - vb) * dir;
  });
}

function th(key, label, { n = false, title = '' } = {}) {
  const active = ui.sort.key === key;
  const aria = active ? (ui.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return html`<th class="${n ? 'n' : ''}" aria-sort="${aria}" ${title ? html`title="${title}"` : ''}><button type="button" data-sort="${key}">${label}${active ? (ui.sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`;
}

function row(c, s) {
  const best = c.analogs?.best;
  const ref = best ? s.refBySymbol.get(best.ref) : null;
  const d = c.derivatives ?? {};
  const deepMark = c.depth === 'deep' ? html`<span class="depth-dot" data-tip="${tip('Cercetat în profunzime: lumânări 1D/4H, SMC, on-chain, securitate')}"></span>` : '';
  return html`<tr data-open="${c.key}">
    <td><span class="tok"><span><button class="tok-btn" type="button" data-open="${c.key}">${c.symbol}</button>${deepMark}</span><span class="tok-sub">${c.name}${c.chainLabel ? `, ${c.chainLabel}` : ''}</span></span></td>
    <td>${signalBadge(c.signal)}</td>
    <td class="n">${cri(c.score, c.key)}</td>
    <td><span class="cell-2">${refChip(best?.ref, best?.similarity)}${ref ? dnaStrip(c, ref, s.features, s.sigma) : ''}</span></td>
    <td><span class="tok">${lifecycle(c.stage, { proxy: c.stageProxy })}<span class="tok-sub">${HYPE_SHORT[c.hype] ?? ''}</span></span></td>
    <td class="n"><span class="tok"><span>${usd(c.market?.marketCap)}</span><span class="tok-sub num">${mcGrowth(c.market)}</span></span></td>
    <td class="n"><span class="tok"><span>${change(c.market?.change?.d7)}</span><span class="tok-sub num ${signClass(c.market?.change?.d30)}">${pct(c.market?.change?.d30)} 30z</span></span></td>
    <td class="n">${frac(c.market?.turnover)}</td>
    <td class="n"><span class="tok"><span class="num">${frac(d.oiToMcap)}</span><span class="tok-sub num">${d.venues?.length ? `funding ${funding(d.fundingAvg)}` : 'fără perp'}</span></span></td>
    <td>${gradeBadge(c.risk, c.key)}</td>
    <td>${sparkline(c.sparkline)}</td>
  </tr>`;
}

/** Market-cap growth sub-line: 7d from own history when available, otherwise CoinGecko 24h. */
function mcGrowth(m) {
  const g = m?.mcapChange ?? {};
  if (Number.isFinite(g.d7)) return html`<span class="${signClass(g.d7)}">MC ${pct(g.d7)} 7z</span>`;
  if (Number.isFinite(g.h24)) return html`<span class="${signClass(g.h24)}">MC ${pct(g.h24)} 24h</span>`;
  return '';
}

function card(c, s) {
  const best = c.analogs?.best;
  const ref = best ? s.refBySymbol.get(best.ref) : null;
  return html`<button class="card-row" type="button" data-open="${c.key}">
    <span class="tok"><b>${c.symbol}</b><span class="tok-sub">${c.name}</span></span>
    <span>${cri(c.score, c.key)}</span>
    <span class="line">${signalBadge(c.signal)} ${refChip(best?.ref, best?.similarity)} ${ref ? dnaStrip(c, ref, s.features, s.sigma, { withTip: false }) : ''}</span>
    <span class="line">${lifecycle(c.stage, { proxy: c.stageProxy })} ${usd(c.market?.marketCap)} ${change(c.market?.change?.d7)} 7z ${gradeBadge(c.risk, c.key)}</span>
  </button>`;
}

function options(values, current, labelFn) {
  return values.map((v) => html`<option value="${v}" ${v === current ? 'selected' : ''}>${labelFn(v)}</option>`);
}

export function radarMarkup(s) {
  const f = ui.filters;
  const all = filterCandidates(s, { ...f, signal: 'ALL' });
  const list = sortCandidates(filterCandidates(s));
  const counts = Object.fromEntries(SIGNAL_ORDER.map((t) => [t, all.filter((c) => c.signal?.type === t).length]));
  const chains = [...new Set(s.candidates.map((c) => c.chain).filter(Boolean))];
  const chainLabel = Object.fromEntries(s.candidates.map((c) => [c.chain, c.chainLabel ?? c.chain]));
  const refs = (s.references ?? []).map((r) => r.symbol);
  const visible = list.slice(0, shown);
  return html`
  <div class="view-head">
    <div><h2 class="view-title">Radar</h2><p class="view-lede">Toți tokenii publicați din scanarea top 1000 CoinGecko + CoinMarketCap, ordonați după semnal și scor. Primii ${s.health?.universe?.deep ?? ''} au cercetare în profunzime (lumânări, SMC, on-chain, securitate), marcați cu punct albastru; restul au o evaluare rapidă din piață, venue-uri și derivate.</p></div>
  </div>
  <div class="filters" role="search">
    <label class="search"><span class="sr-only">Caută token</span>${icon('search', 14)}<input type="search" placeholder="Caută simbol, nume sau contract" value="${f.q}" data-filter="q" autocomplete="off"></label>
    <div class="seg" role="group" aria-label="Semnal">
      <button type="button" data-signal="ALL" aria-pressed="${f.signal === 'ALL'}">Toate <span class="count">${all.length}</span></button>
      ${SIGNAL_ORDER.filter((t) => t !== 'NONE').map((t) => html`<button type="button" data-signal="${t}" aria-pressed="${f.signal === t}">${shortSignal(t)} <span class="count">${counts[t]}</span></button>`)}
    </div>
    <select class="select" data-filter="stage" aria-label="Stadiu">${options(['ALL', ...L.stageOrder], f.stage, (v) => (v === 'ALL' ? 'Orice stadiu' : L.stages[v] ?? v))}</select>
    <select class="select" data-filter="analog" aria-label="Analog">${options(['ALL', ...refs], f.analog, (v) => (v === 'ALL' ? 'Orice analog' : `Seamănă cu ${v}`))}</select>
    <select class="select" data-filter="chain" aria-label="Rețea">${options(['ALL', ...chains], f.chain, (v) => (v === 'ALL' ? 'Orice rețea' : chainLabel[v] ?? v))}</select>
    <select class="select" data-filter="grade" aria-label="Grad de risc">${options(['ALL', 'A', 'B', 'C', 'D'], f.grade, (v) => (v === 'ALL' ? 'Orice risc' : `Risc ${v}`))}</select>
    <label class="check"><input type="checkbox" data-filter="deepOnly" ${f.deepOnly ? 'checked' : ''}>Doar cercetați în profunzime</label>
    <label class="check"><input type="checkbox" data-filter="hideLate" ${f.hideLate ? 'checked' : ''}>Ascunde ce a pornit deja</label>
    <span class="result-count" aria-live="polite">${list.length} rezultate</span>
  </div>
  ${list.length ? html`
  <div class="tbl-wrap responsive sticky">
    <table class="tbl">
      <thead><tr>
        ${th('rank', 'Token')}
        <th>Semnal</th>
        ${th('cri', 'CRI', { n: true, title: 'Scor de cercetare 0–100' })}
        ${th('analog', 'Analog și ADN', { title: 'Cel mai apropiat analog; celulele: 9 trăsături structurale, apoi 6 de fază' })}
        ${th('stage', 'Stadiu și hype')}
        ${th('mcap', 'Market cap', { n: true })}
        ${th('d7', '7z / 30z', { n: true })}
        ${th('turnover', 'Turnover', { n: true, title: 'Volum 24h / market cap' })}
        ${th('oi', 'OI/MC, funding', { n: true, title: 'Open interest / market cap; funding mediu ponderat cu OI' })}
        ${th('risk', 'Risc')}
        <th>Preț 30z</th>
      </tr></thead>
      <tbody>${visible.map((c) => row(c, s))}</tbody>
    </table>
  </div>
  <div class="cards">${visible.map((c) => card(c, s))}</div>
  ${list.length > shown ? html`<p style="margin-top:12px"><button class="btn" type="button" data-more>Arată încă ${Math.min(PAGE, list.length - shown)} din ${list.length - shown}</button></p>` : ''}
  ` : html`<div class="empty"><strong>Niciun token pentru filtrele alese.</strong>Relaxează un filtru (de exemplu stadiul sau gradul de risc) sau șterge căutarea.</div>`}
  `;
}

/** Wire filter/sort controls once on the view root; `rerender` re-renders this view only. */
export function bindRadar(root, rerender) {
  let timer = null;
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el?.dataset?.filter !== 'q') return;
    ui.filters.q = el.value;
    shown = PAGE;
    clearTimeout(timer);
    timer = setTimeout(() => rerender({ keepFocus: '[data-filter="q"]' }), 140);
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    const k = el?.dataset?.filter;
    if (!k || k === 'q') return;
    ui.filters[k] = el.type === 'checkbox' ? el.checked : el.value;
    shown = PAGE;
    rerender({ keepFocus: `[data-filter="${k}"]` });
  });
  root.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const sigBtn = t?.closest('[data-signal]');
    if (sigBtn) {
      ui.filters.signal = sigBtn.dataset.signal;
      shown = PAGE;
      rerender({ keepFocus: `[data-signal="${sigBtn.dataset.signal}"]` });
      return;
    }
    const sortBtn = t?.closest('[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort;
      ui.sort = ui.sort.key === key ? { key, dir: ui.sort.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'risk' || key === 'stage' ? 'asc' : 'desc' };
      rerender({ keepFocus: `[data-sort="${key}"]` });
      return;
    }
    if (t?.closest('[data-more]')) {
      shown += PAGE;
      rerender();
    }
  });
}
