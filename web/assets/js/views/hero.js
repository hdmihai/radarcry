/**
 * Hero: the answer to the project's question, then the setups that currently resemble LAB / BTW /
 * AGT next to the opportunity map.
 *
 * The question comes first because it is the product: a visitor should be able to read the count of
 * projects that satisfy it, and the verdict when none do, before scrolling anywhere.
 */
import { html, tip } from '../core/dom.js';
import { pct, score, usd } from '../core/format.js';
import { SIGNAL_RANK } from '../core/labels.js';
import { dnaStrip } from '../charts/dna.js';
import { opportunityMap } from '../charts/scatter.js';
import { cri, dnaLegend, gradeBadge, lifecycle, refChip, signalBadge } from './widgets.js';

export function pickSetups(s, limit = 8) {
  const live = s.candidates.filter((c) => ['BUY_SETUP', 'ACCUMULATE', 'WATCH'].includes(c.signal?.type));
  return live
    .sort((a, b) => (SIGNAL_RANK[b.signal.type] - SIGNAL_RANK[a.signal.type])
      || ((b.signal.type === 'WATCH' ? (b.analogs?.best?.similarity ?? 0) : b.score.cri) - (a.signal.type === 'WATCH' ? (a.analogs?.best?.similarity ?? 0) : a.score.cri)))
    .slice(0, limit);
}

function setupRow(c, s) {
  const best = c.analogs?.best;
  const ref = best ? s.refBySymbol.get(best.ref) : null;
  return html`<button class="setup-row" type="button" data-open="${c.key}">
    <span class="tok"><span class="setup-sym">${c.symbol}</span><span class="setup-name">${c.name}</span><span class="setup-name">${c.chainLabel ?? ''} ${usd(c.market?.marketCap)}</span></span>
    <span class="setup-mid">
      <span class="setup-line">${signalBadge(c.signal)} ${refChip(best?.ref, best?.similarity)} ${ref ? dnaStrip(c, ref, s.features, s.sigma) : ''} ${lifecycle(c.stage, { proxy: c.stageProxy })} ${gradeBadge(c.risk, c.key)}</span>
      <span class="setup-why">${(c.whyNow ?? []).slice(0, 2).join('; ') || (c.signal?.reasons ?? []).join('; ')}</span>
    </span>
    <span class="setup-score"><span class="setup-cri">${cri(c.score, c.key)}</span><br><span class="xs muted">7z ${pct(c.market?.change?.d7)}</span></span>
  </button>`;
}

/** The one-line state of the project's central question, with the strongest near-miss when zero. */
function questionLine(s) {
  const d = s.discovery ?? {};
  const rows = d.rows ?? [];
  const answering = rows.filter((r) => r.verdict?.answersQuestion);
  if (answering.length) {
    return html`<b>${answering.length} ${answering.length === 1 ? 'proiect răspunde' : 'proiecte răspund'} acum la întrebare</b> —
      ${answering.slice(0, 4).map((r) => html`<a href="#/radar-small-cap" class="qlink">${r.symbol} <span class="muted">${score(r.verdict.opportunity)}/${r.verdict.risk}</span></a>`)}
      ${answering.length > 4 ? html`<span class="muted">și încă ${answering.length - 4}</span>` : ''}`;
  }
  const best = [...rows]
    .filter((r) => Number.isFinite(r.verdict?.opportunity))
    .sort((a, b) => (b.verdict.opportunity ?? 0) - (a.verdict.opportunity ?? 0))[0];
  if (!best) return html`<b>Niciun proiect analizat încă în această rulare.</b>`;
  const failed = (best.verdict.tests ?? []).filter((t) => !t.pass).map((t) => t.label.toLowerCase());
  return html`<b>Niciun proiect nu îndeplinește acum toate cele trei condiții.</b>
    Cel mai aproape: <a href="#/radar-small-cap" class="qlink">${best.symbol}</a> — oportunitate ${score(best.verdict.opportunity)},
    risc ${best.verdict.risk}, precocitate ${best.verdict.earliness}, ${best.changed?.count ?? 0} schimbări în ${best.changed?.familyCount ?? 0} familii${failed.length ? html`; îi lipsește: ${failed.join(', ')}` : ''}.`;
}

export function heroMarkup(s) {
  const setups = pickSetups(s);
  const th = s.methodology?.thresholds?.signals ?? {};
  const refs = s.references ?? [];
  const map = opportunityMap(s.candidates, { minAnalog: th.buySetup?.minAnalog ?? 60, minCri: th.buySetup?.minCri ?? 66 });
  const strong = s.candidates.filter((c) => c.signal?.type === 'BUY_SETUP' || c.signal?.type === 'ACCUMULATE').length;
  const d = s.discovery ?? {};
  return html`<div class="frame">
    <div class="qlead" data-tone="${(d.answering ?? 0) > 0 ? 'good' : 'muted'}">
      <p class="qlead-q" data-tip="${tip('Întrebarea pe care o reproduce întregul proiect, cuvânt cu cuvânt. Fiecare scor, factor și invalidator există ca să răspundă la ea.')}">„Arată-mi proiectele mici unde se schimbă simultan mai multe lucruri importante, înainte ca mișcarea să devină evidentă, și spune-mi ce riscuri pot invalida această ipoteză.”</p>
      <p class="qlead-a">${questionLine(s)}</p>
      <p class="qlead-m">
        <a href="#/radar-small-cap">Small-Cap Radar</a> · <a href="#/futures">Futures Radar</a> · <a href="#/deep-research">Deep Research</a>
        <span class="muted">· ${d.analysed ?? 0} proiecte cercetate în adâncime, ${d.earlyCandidates ?? 0} candidați timpurii · paritate ${score(s.parity?.achieved)}% față de soluțiile comerciale</span>
      </p>
    </div>
  </div>
  <div class="frame hero-grid">
    <div>
      <h2 class="hero-title">Ce seamănă acum cu LAB, BTW sau AGT</h2>
      <p class="hero-lede">Tokeni încă discreți, cu tokenomics și structură apropiate de cele trei referințe înainte de expansiune. ${strong ? `${strong} au acum un setup sau o zonă de acumulare;` : 'Niciun setup confirmat acum;'} restul sunt de urmărit. Prioritate de cercetare, nu recomandare de cumpărare.</p>
      <div class="hero-refs">${refs.map((r) => html`<span class="pill" data-ref="${r.symbol}">${refChip(r.symbol)} ${r.outcome?.gainPct ? `+${Math.round(r.outcome.gainPct).toLocaleString('en-US')}% în ${r.outcome.days} z` : ''}</span>`)}</div>
      <div class="setup-list">
        ${setups.length ? setups.map((c) => setupRow(c, s)) : html`<div class="setup-empty">Niciun token nu trece acum de pragurile de similaritate și structură. Radarul de mai jos arată candidații cei mai apropiați.</div>`}
      </div>
      <div style="margin-top:10px">${dnaLegend()}</div>
    </div>
    <div class="map-panel">
      <div class="panel-head"><h2 class="panel-title">Harta oportunităților</h2><span class="panel-note">${s.candidates.length} tokeni; click pentru fișă</span></div>
      ${map ?? html`<div class="empty">Fără date de similaritate în acest snapshot.</div>`}
      <div class="legend">
        ${refs.map((r) => html`<span data-ref="${r.symbol}"><i class="dot" style="background:var(--ref)"></i>seamănă cu ${r.symbol}</span>`)}
        <span><i class="dot" style="background:transparent;box-shadow:inset 0 0 0 1.6px var(--ink)"></i>cerc mare: Setup BUY / Acumulare</span>
      </div>
    </div>
  </div>`;
}
