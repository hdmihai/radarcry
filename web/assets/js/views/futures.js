/**
 * FUTURES RADAR — section ① of the dashboard.
 *
 * The five blocks of the grade are shown as blocks, with their nominal and effective weights, so
 * the note is auditable rather than asserted. The hard filters are printed next to the grade
 * whenever they fired: a B that *would* have been an A+ without the chase penalty is a different
 * piece of information from a plain B, and the researcher needs to see which one it is.
 *
 * Everything here is research output. The levels come from the 4H structure; nothing in this
 * project places or transmits an order.
 */
import { html, tip } from '../core/dom.js';
import { pct, price, score, signClass, usd } from '../core/format.js';
import { icon } from '../core/labels.js';
import { futuresGradeBadge } from './widgets.js';

const TREND_TONE = {
  STRONG_BULL: 'good', BULL: 'good', NEUTRAL: 'muted', BEAR: 'warning', STRONG_BEAR: 'serious', UNKNOWN: 'muted',
};

const FUNDING_TONE = {
  CROWDED_SHORTS: 'good', HEALTHY: 'good', NEUTRAL: 'muted', CROWDED_LONGS: 'warning', DANGER: 'serious', UNKNOWN: 'muted',
};

const BLOCK_LABEL = {
  trend1d: 'Trend 1D', structure4h: 'Structură 4H', positioning: 'Futures', liquidity: 'Lichiditate', volume: 'Volum/volatilitate',
};

function blockBars(grade) {
  return html`<div class="fbars">${(grade.blocks ?? []).map((b) => html`
    <div class="fbar" data-tip="${tip(html`<b>${b.label}</b><br>${b.evidence ?? ''}<br><span class="muted">pondere ${b.weight} → efectivă ${b.effectiveWeight}% · contribuție ${b.points}</span>`)}">
      <span class="bar-k">${BLOCK_LABEL[b.key] ?? b.label}</span>
      <span class="domain-bar"><i style="width:${Math.max(2, Math.round(b.score))}%"></i></span>
      <span class="bar-v num">${score(b.score)}</span>
      <span class="bar-w muted xs">${b.weight}</span>
    </div>`)}
    ${(grade.missing ?? []).length ? html`<p class="panel-note">Blocuri nemăsurate, scoase din ponderare: ${grade.missing.map((m) => `${m.label} (${m.reason})`).join('; ')}.</p>` : ''}
  </div>`;
}

function levelsPanel(l) {
  if (!l) return html`<p class="muted small">Fără zonă de intrare identificabilă pe 4H în această rulare.</p>`;
  return html`<div class="facts">
    <div class="kv"><span>Direcție</span><b>${l.bias}</b></div>
    <div class="kv"><span>Zonă de intrare</span><b class="num">${l.entryZone ? `$${price(l.entryZone.bottom)} – $${price(l.entryZone.top)}` : `$${price(l.entry)}`}</b></div>
    <div class="kv"><span>Invalidare</span><b class="num">$${price(l.stop)}${l.stopBasis === 'ATR_FLOOR' ? html` <span class="muted small" data-tip="${tip('Invalidarea structurală era mai aproape de un ATR(4H) de intrare, adică în zgomotul obișnuit al pieței. Stopul a fost mutat la 1 ATR(4H) sub intrare, iar R:R este calculat față de acest risc.')}">lărgită la 1 ATR</span>` : ''}</b></div>
    <div class="kv"><span>Obiectiv 1</span><b class="num">$${price(l.target1)}</b></div>
    <div class="kv"><span>Obiectiv 2</span><b class="num">$${price(l.target2)}</b></div>
    <div class="kv"><span>Risc / R:R</span><b>${pct(l.riskPct, { sign: false })} · ${l.rr1 ?? '—'}R → ${l.rr2 ?? '—'}R</b></div>
    ${l.entryZone ? html`<div class="kv"><span>Tip zonă</span><b>${l.entryZone.kind}</b></div>` : ''}
    <div class="kv"><span>ATR 4H</span><b>${pct(l.atrPct, { sign: false })}</b></div>
  </div>
  <p class="panel-note">${l.note}</p>`;
}

function liquidationPanel(m) {
  if (!m) return '';
  return html`<section class="panel">
    <div class="panel-head"><h4 class="panel-title">Hartă de lichidări <span class="pill" data-tone="muted">model</span></h4></div>
    <div class="liqmap">
      ${(m.clusters ?? []).slice(0, 8).map((c) => html`<div class="liqrow" data-side="${c.side}">
        <span class="num">$${price(c.price)}</span>
        <span class="liqbar" aria-hidden="true"><i style="width:${Math.max(3, Math.round((c.weight ?? 0) * 100 * 6))}%"></i></span>
        <span class="xs muted">${c.side === 'LONG' ? 'long' : 'short'} · ${pct(c.distancePct)} · levier ${c.leverage.join('/')}x</span>
      </div>`)}
    </div>
    ${m.magnetBelow || m.magnetAbove ? html`<p class="panel-note">Cel mai greu cluster sub preț: ${m.magnetBelow ? `$${price(m.magnetBelow.price)} (${pct(m.magnetBelow.distancePct)})` : '—'} · deasupra: ${m.magnetAbove ? `$${price(m.magnetAbove.price)} (${pct(m.magnetAbove.distancePct)})` : '—'}.</p>` : ''}
    <details><summary class="xs muted">Ipotezele modelului</summary><ul class="xs">${(m.assumptions ?? []).map((a) => html`<li>${a}</li>`)}</ul></details>
    <p class="panel-note">${m.note}</p>
  </section>`;
}

function row(r) {
  const g = r.grade;
  const t = r.trend;
  const s = r.setup;
  const p = r.positioning;
  return html`<article class="fcard" id="f-${r.key}">
    <header class="fcard-head">
      <div class="dcard-id">
        <button class="tok-btn" type="button" data-open="${r.key}"><span class="tok">${r.symbol}</span><span class="tok-sub">${r.name}</span></button>
        ${futuresGradeBadge(g.grade)}
        <span class="num muted">${score(g.score)}/100</span>
        ${t ? html`<span class="pill" data-tone="${TREND_TONE[t.regime] ?? 'muted'}" data-tip="${tip(html`<b>Trend 1D</b>${t.reasons.map((x) => html`<br>${x}`)}`)}">1D ${t.regime.toLowerCase().replace('_', ' ')}</span>` : ''}
        <span class="pill" data-tone="${FUNDING_TONE[p.funding] ?? 'muted'}" data-tip="${tip(html`<b>Poziționare</b>${p.reasons.map((x) => html`<br>${x}`)}`)}">${p.fundingPct8h === null ? 'funding —' : `funding ${p.fundingPct8h > 0 ? '+' : ''}${p.fundingPct8h.toFixed(4)}%/8h`}</span>
        <span class="muted xs">${r.reason}</span>
      </div>
      <div class="fcard-nums">
        <span class="kv"><span>Preț</span><b class="num">$${price(r.price)}</b></span>
        <span class="kv"><span>24h</span><b class="num ${signClass(r.change.h24)}">${pct(r.change.h24)}</b></span>
        <span class="kv"><span>Capitalizare</span><b>${usd(r.marketCap)}</b></span>
        <span class="kv"><span>Open interest</span><b>${usd(r.derivatives.oiUsd)}</b></span>
        <span class="kv"><span>Burse perp</span><b>${r.derivatives.venueNames?.join(', ') || '—'}</b></span>
      </div>
    </header>

    ${g.blocked?.length ? html`<div class="hardfilter" data-kind="block">${icon('stop', 14)}<div><b>Filtru dur activ.</b> ${g.blocked.join(' · ')}</div></div>` : ''}
    ${g.caps?.length ? html`<div class="hardfilter" data-kind="cap">${icon('warn', 14)}<div><b>Notă plafonată.</b> ${g.caps.join(' · ')}${g.rawGrade !== g.grade ? ` (fără plafon ar fi fost ${g.rawGrade})` : ''}</div></div>` : ''}

    <div class="dcard-grid">
      <section class="panel">
        <div class="panel-head"><h4 class="panel-title">Cele cinci blocuri</h4><span class="muted xs">25 / 30 / 25 / 10 / 10 · încredere ${g.confidence}%</span></div>
        ${blockBars(g)}
      </section>

      <section class="panel">
        <div class="panel-head"><h4 class="panel-title">Nivele de research</h4></div>
        ${levelsPanel(r.levels)}
      </section>

      <section class="panel">
        <div class="panel-head"><h4 class="panel-title">Structură 4H</h4></div>
        ${s ? html`<div class="facts">
          <div class="kv"><span>Structură</span><b>${s.structure.toLowerCase()}</b></div>
          <div class="kv"><span>Ultimul eveniment</span><b>${s.lastEvent ? `${s.lastEvent.type} ${s.lastEvent.dir === 'UP' ? 'în sus' : 'în jos'}, acum ${s.lastEvent.barsAgo} bare` : '—'}</b></div>
          <div class="kv"><span>Order blocks sub preț</span><b>${s.orderBlocks?.length ?? 0}</b></div>
          <div class="kv"><span>Fair value gaps</span><b>${s.fvgs?.length ?? 0}</b></div>
          <div class="kv"><span>Măturare de lichiditate</span><b>${s.sweep ? `da, acum ${s.sweep.barsAgo} bare` : 'nu'}</b></div>
          <div class="kv"><span>Poziție în range</span><b>${s.dealingRange ? `${Math.round(s.dealingRange.position * 100)}%` : '—'}</b></div>
          <div class="kv"><span>Distanță față de zonă</span><b class="${s.chasing ? 'neg' : ''}">${pct(s.chasePct)}</b></div>
        </div>
        <ul class="xs">${s.reasons.map((x) => html`<li>${x}</li>`)}</ul>` : html`<p class="muted small">Fără lumânări 4H suficiente pentru analiza de structură.</p>`}
      </section>

      ${liquidationPanel(r.liquidationMap)}
    </div>

    <footer class="dcard-foot">
      <div class="dcard-timing">${icon('info', 13)} ${g.verdict}</div>
      <div class="muted xs">Lumânări: ${r.candleSource ?? '—'} (${r.bars?.d1 ?? 0} × 1D, ${r.bars?.h4 ?? 0} × 4H) · derivate: ${r.derivatives.source ?? '—'}</div>
    </footer>
  </article>`;
}

export const futuresState = { only: null };

/** Open on the graded set when there is one, otherwise on everything — never on an empty list. */
function resolveOnly(gradedCount) {
  if (futuresState.only) return futuresState.only;
  return gradedCount > 0 ? 'graded' : 'all';
}

export function futuresMarkup(s) {
  const f = s.futures ?? { rows: [], summary: {} };
  const gradedRows = f.rows.filter((r) => r.grade.grade !== 'NO_TRADE');
  const only = resolveOnly(gradedRows.length);
  const rows = only === 'graded' ? gradedRows : f.rows;
  const sum = f.summary ?? {};
  return html`
    <div class="view-head">
      <h2 class="view-title">Futures Radar</h2>
      <p class="view-lede">Cinci blocuri ponderate — trend 1D (25), structură 4H (30), poziționare pe derivate (25), lichiditate (10), volum și volatilitate (10) — plus filtrele dure care pot plafona sau anula nota. A++ ≥ 95 · A+ ≥ 90 · A ≥ 85 · B ≥ 80.</p>
    </div>

    <div class="qbar">
      <div class="qstat"><b class="num">${sum.scanned ?? 0}</b><span>instrumente scanate</span></div>
      <div class="qstat" data-tone="${(sum.graded ?? 0) > 0 ? 'good' : 'muted'}"><b class="num">${sum.graded ?? 0}</b><span>cu notă de minimum B</span></div>
      <div class="qstat"><b>${sum.best ? `${sum.best.symbol} ${sum.best.grade}` : '—'}</b><span>cel mai bun setup</span></div>
      <div class="qstat"><b class="xs">${Object.entries(sum.byGrade ?? {}).map(([k, v]) => `${k === 'NO_TRADE' ? 'fără setup' : k}: ${v}`).join(' · ') || '—'}</b><span>distribuția notelor</span></div>
    </div>

    <div class="filters">
      <div class="seg" role="group" aria-label="Filtrează">
        <button class="pill" type="button" data-fonly="graded" aria-selected="${only === 'graded' ? 'true' : 'false'}">Doar cu notă<span class="count">${gradedRows.length}</span></button>
        <button class="pill" type="button" data-fonly="all" aria-selected="${only === 'all' ? 'true' : 'false'}">Toate<span class="count">${f.rows.length}</span></button>
      </div>
      <span class="result-count">${rows.length} ${rows.length === 1 ? 'instrument' : 'instrumente'}</span>
    </div>
    ${(sum.scanned ?? 0) > f.rows.length ? html`<p class="panel-note">${icon('info', 12)} Aici sunt primele ${f.rows.length} instrumente după notă, cu toate dovezile; toate cele ${sum.scanned} piețe perpetue evaluate sunt în <a href="#/univers">Univers → Perpetue</a>.</p>` : ''}

    ${rows.length ? html`<div class="dlist">${rows.map(row)}</div>` : html`<div class="empty">
      <strong>Niciun setup nu trece pragul de 80 de puncte în această rulare.</strong>
      <p>Este rezultatul normal al filtrelor dure: un trend zilnic puternic descendent exclude complet direcția LONG, iar funding extrem, o intrare la peste 8% deasupra zonei sau un raport câștig/risc sub 2 plafonează nota la B. Comută pe „Toate” pentru a vedea ce îi lipsește fiecărui instrument.</p>
    </div>`}

    <p class="panel-note">${sum.note ?? ''}${sum.derivativesSource ? ` ${sum.derivativesSource}.` : ''}</p>`;
}

export function bindFutures(root, rerender) {
  root.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-fonly]') : null;
    if (!el) return;
    futuresState.only = el.dataset.fonly;
    rerender();
  });
}
