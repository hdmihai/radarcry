/**
 * Small, reusable pieces of markup shared by the views.
 * Tooltips for repeated widgets are built lazily (data-tipfn) so a 300-row table stays light;
 * the *TipBody builders below are used by the tooltip registry in main.js.
 */
import { html, raw, tip } from '../core/dom.js';
import { pct, score, signClass } from '../core/format.js';
import { GRADE_HELP, L, POLARITY, SIGNAL_HELP, SIGNAL_ICON, TONE_ICON, icon } from '../core/labels.js';

const SHORT_SIGNAL = { BUY_SETUP: 'Setup BUY', ACCUMULATE: 'Acumulare', WATCH: 'Urmărire', LATE: 'Târziu', AVOID: 'Evită', NONE: '—' };
export const shortSignal = (t) => SHORT_SIGNAL[t] ?? t;
const SEV_WORD = { CRITICAL: 'critic', HIGH: 'ridicat', MEDIUM: 'mediu', LOW: 'scăzut' };

/* ---------- tooltip bodies ---------- */
export function signalTipBody(type, strength) {
  const full = L.signals[type] ?? type;
  const st = Number.isFinite(strength) && type !== 'NONE' ? html`<div class="tt-row"><span>Tărie</span><span>${strength}/100</span></div>` : '';
  return html`<b>${type === 'NONE' ? 'Fără semnal' : full}</b><br>${SIGNAL_HELP[type] ?? ''}${st}`;
}

export function gradeTipBody(risk) {
  const g = risk?.grade ?? '?';
  const flags = (risk?.flags ?? []).slice(0, 5);
  return html`<b>${GRADE_HELP[g] ?? 'Risc necunoscut'}</b>${flags.length
    ? flags.map((f) => html`<div class="tt-row"><span>${f.label}</span><span>${SEV_WORD[f.severity] ?? f.severity}</span></div>`)
    : html`<br><span class="muted">fără semnale de risc detectate</span>`}`;
}

export function criTipBody(s) {
  return html`<b>CRI ${score(s.cri)} (tier ${s.tier})</b>
    <div class="tt-row"><span>Scor fuzionat</span><span>${score(s.fused)}</span></div>
    <div class="tt-row"><span>Încredere</span><span>${Math.round((s.confidence ?? 0) * 100)}%</span></div>
    <div class="tt-row"><span>Acoperire date</span><span>${Math.round((s.coverage ?? 0) * 100)}%</span></div>
    <div class="tt-row"><span>Surse independente</span><span>${s.independentSources ?? '—'}</span></div>
    <div class="tt-row"><span>Stare</span><span>${L.states[s.state] ?? s.state}</span></div>
    ${s.conflict ? html`<br><span class="muted">domeniile sunt în conflict: încredere redusă</span>` : ''}`;
}

export function lifeTipBody(stage, proxy) {
  return html`<b>Ciclu de viață</b>${L.stageOrder.map((s) => html`<div class="tt-row"><span>${s === stage ? html`<b>${L.stages[s] ?? s}</b>` : L.stages[s] ?? s}</span><span>${s === stage ? 'acum' : ''}</span></div>`)}${proxy ? html`<br><span class="muted">estimat din date de listare (fără lumânări)</span>` : ''}`;
}

/* ---------- widgets ---------- */
export function signalBadge(signal, { large = false } = {}) {
  const t = signal?.type ?? 'NONE';
  const st = Number.isFinite(signal?.strength) ? signal.strength : '';
  return html`<span class="sig ${large ? 'sig-lg' : ''}" data-sig="${t}" data-tipfn="sig" data-strength="${st}">${icon(SIGNAL_ICON[t] ?? 'dash', large ? 15 : 13)}<span>${shortSignal(t)}</span></span>`;
}

export function gradeBadge(risk, key = null) {
  const g = risk?.grade ?? '?';
  const tipAttr = key ? html`data-tipfn="risk" data-key="${key}"` : html`data-tip="${tip(gradeTipBody(risk))}"`;
  return html`<span class="grade" data-grade="${g}" ${tipAttr} aria-label="Grad de risc ${g}">${g}</span>`;
}

export function refChip(ref, sim) {
  if (!ref) return raw('<span class="muted">—</span>');
  return html`<span class="ref-chip" data-ref="${ref}">${ref}${Number.isFinite(sim) ? html` <span class="sim">${Math.round(sim)}</span>` : ''}</span>`;
}

export function lifecycle(stage, { proxy = false, label = true } = {}) {
  const order = L.stageOrder;
  const idx = order.indexOf(stage);
  const cells = order.map((s, i) => {
    if (i !== idx) return '<i></i>';
    const late = s === 'EXPANSION' || s === 'POST_EXPANSION';
    return `<i class="on"${late ? ' data-late' : ''}${s === 'DECLINE' ? ' data-down' : ''}></i>`;
  }).join('');
  const name = L.stages[stage] ?? stage ?? 'Necunoscut';
  return html`<span class="life" data-tipfn="life" data-stage="${stage ?? ''}" data-proxy="${proxy ? '1' : ''}"><span class="life-bar" aria-hidden="true">${raw(cells)}</span>${label ? html`<span class="life-label">${name}${proxy ? html` <span class="life-proxy">(estimat)</span>` : ''}</span>` : ''}</span>`;
}

export function change(x, opts) {
  return html`<span class="num ${signClass(x)}">${pct(x, opts)}</span>`;
}

export function cri(scoreObj, key = null) {
  if (!scoreObj) return raw('<span class="muted">—</span>');
  const tipAttr = key ? html`data-tipfn="cri" data-key="${key}"` : html`data-tip="${tip(criTipBody(scoreObj))}"`;
  return html`<span class="num" ${tipAttr}><b>${score(scoreObj.cri)}</b><span class="tier">${scoreObj.tier}</span></span>`;
}

export function statusLine(tone, label, { size = 14 } = {}) {
  return html`<span class="status" data-tone="${tone}">${icon(TONE_ICON[tone] ?? 'dot', size)}<span>${label}</span></span>`;
}

export function polarity(p) {
  const meta = POLARITY[p] ?? POLARITY.UNKNOWN;
  return html`<span class="status" data-tone="${meta.tone}">${icon(meta.icon, 13)}<span class="sr-only">${meta.label}</span></span>`;
}

export function extLink(href, label) {
  if (!href) return '';
  return html`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

export function dnaLegend() {
  return html`<span class="dna-legend"><span>potrivire slabă</span><span class="ramp"><i style="background:var(--seq-0)"></i><i style="background:var(--seq-1)"></i><i style="background:var(--seq-2)"></i><i style="background:var(--seq-3)"></i><i style="background:var(--seq-4)"></i></span><span>puternică</span><span class="hatch-swatch"></span><span>necunoscut</span></span>`;
}

/* ---------- v4 widgets: meters, quality dots, controls ---------- */

/**
 * A labelled 0..100 meter. `invert` means lower is better (used for risk), which flips the fill
 * direction so the eye reads "more bar = more of the bad thing" consistently.
 */
export function meter(label, value, { tone = 'muted', tip: tipBody = null, invert = false } = {}) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const attrs = tipBody ? html`data-tip="${tip(html`<b>${label}</b><br>${tipBody}`)}"` : '';
  return html`<div class="meter" data-tone="${tone}" ${attrs}>
    <span class="meter-k">${label}</span>
    <span class="meter-v num">${v === null ? '—' : score(v)}</span>
    <span class="meter-bar" aria-hidden="true"><i style="width:${v === null ? 0 : Math.max(2, Math.round(v))}%"${invert ? ' data-invert' : ''}></i></span>
  </div>`;
}

const QUALITY_WORD = {
  HIGH: 'sursă primară, proaspătă',
  MEDIUM: 'sursă derivată sau secundară',
  LOW: 'o singură sursă subțire',
  STALE: 'date reale, dar învechite',
  UNKNOWN: 'lipsește — nu „negativ”',
};

/** A single dot that carries the data-quality grade of a factor. */
export function qualityDot(quality) {
  const q = quality ?? 'UNKNOWN';
  return html`<i class="qdot" data-q="${q}" data-tip="${tip(html`<b>Calitatea datelor: ${q}</b><br>${QUALITY_WORD[q] ?? ''}`)}" aria-label="calitate ${q}"></i>`;
}

export function searchBox(value, id, placeholder) {
  return html`<label class="search"><span class="sr-only">${placeholder}</span>${icon('search', 14)}<input type="search" id="${id}" placeholder="${placeholder}" value="${value}" autocomplete="off"></label>`;
}

export function sortSelect(options, current, id) {
  return html`<select class="select" id="${id}" aria-label="Ordonează">${options.map((o) => html`<option value="${o.id}" ${o.id === current ? 'selected' : ''}>${o.label}</option>`)}</select>`;
}

/** Grade badge for the Futures Radar (A++ … NO_TRADE). */
export function futuresGradeBadge(grade) {
  const g = grade ?? 'NO_TRADE';
  const tone = g === 'A++' || g === 'A+' ? 'good' : g === 'A' ? 'good' : g === 'B' ? 'warning' : 'muted';
  return html`<span class="fgrade" data-tone="${tone}">${g === 'NO_TRADE' ? 'fără setup' : g}</span>`;
}

/* ── validity gate ──────────────────────────────────────────────────────────────────────────── */

const CHECK_TONE = { PASS: 'good', WARN: 'warning', FAIL: 'serious', UNKNOWN: 'muted', NA: 'muted' };
const CHECK_ICON = { PASS: 'check', WARN: 'warn', FAIL: 'stop', UNKNOWN: 'minus', NA: 'dash' };
const CHECK_WORD = { PASS: 'trece', WARN: 'atenție', FAIL: 'respins', UNKNOWN: 'lipsește dovada', NA: 'nu se aplică' };
const STATUS_TONE = { VALID: 'good', PENDING: 'muted', REJECTED: 'serious' };

/** The checks of one verdict, as a compact list (used inside tooltips and panels). */
export function validityList(v, { compact = false } = {}) {
  if (!v?.checks?.length) return '';
  return html`<ul class="vchecks${compact ? ' compact' : ''}">${v.checks.map((c) => html`<li data-tone="${CHECK_TONE[c.status] ?? 'muted'}">
    <span class="vc-ico">${icon(CHECK_ICON[c.status] ?? 'dot', 13)}</span>
    <span class="vc-body"><b>${c.label}</b> <span class="muted xs">· ${CHECK_WORD[c.status] ?? c.status}</span>${c.detail ? html`<br><span class="xs">${c.detail}</span>` : ''}</span>
  </li>`)}</ul>`;
}

/**
 * The validity pill shown next to a project everywhere it is listed: "verificat", with the number of
 * warnings when there are any, and every check in the tooltip.
 */
export function validityBadge(v, { compact = false } = {}) {
  if (!v) return '';
  const warn = v.warnings?.length ?? 0;
  const tone = v.status === 'VALID' && warn ? 'warning' : STATUS_TONE[v.status] ?? 'muted';
  const label = compact
    ? (v.status === 'VALID' ? (warn ? `${warn}` : '') : v.label ?? v.status)
    : v.status === 'VALID' ? `verificat${warn ? ` · ${warn} ${warn === 1 ? 'atenționare' : 'atenționări'}` : ''}` : v.label ?? v.status;
  const aria = v.status === 'VALID' ? `verificat${warn ? `, ${warn} ${warn === 1 ? 'atenționare' : 'atenționări'}` : ''}` : v.label ?? v.status;
  return html`<span class="pill${compact ? ' vpill' : ''}" data-tone="${tone}" aria-label="${aria}" data-tip="${tip(html`<b>Verificare de validitate: ${v.label ?? v.status}</b>${validityList(v, { compact: true })}`)}">${icon(v.status === 'VALID' ? 'check' : v.status === 'REJECTED' ? 'stop' : 'minus', 12)}${label ? ` ${label}` : ''}</span>`;
}

/* ── forecast (≥100× / ≥20× in twelve months) ───────────────────────────────────────────────── */

const FC_TONE = { HIGH: 'good', ABOVE: 'good', BASE: 'muted', BELOW: 'muted', UNKNOWN: 'muted' };
const pctText = (x) => (Number.isFinite(x) ? `${x < 1 ? x.toFixed(2) : x < 10 ? x.toFixed(1) : x.toFixed(0)}%` : '—');
const liftText = (x) => (Number.isFinite(x) ? `×${x.toFixed(x < 10 ? 1 : 0)}` : '');

/** One target of a forecast as text: "0.86% (0.37–1.65%)". */
export function forecastText(t) {
  if (!t || !Number.isFinite(t.pct)) return '—';
  return `${pctText(t.pct)}${Number.isFinite(t.lo) && Number.isFinite(t.hi) ? ` (${pctText(t.lo)}–${pctText(t.hi)})` : ''}`;
}

/**
 * The forecast pill shown next to a project: the ≥100× probability and its lift over the base rate,
 * with the ≥20× probability, the nearest winners and the caveats in the tooltip.
 */
export function forecastPill(fc, { target = '100', compact = false } = {}) {
  const t = fc?.targets?.[target];
  if (!t || !Number.isFinite(t.pct)) return '';
  const t20 = fc.targets?.['20'];
  const near = (fc.nearest ?? []).map((n) => `${n.symbol} ${n.multiple}× (${n.similarity}%)`).join(', ');
  const body = html`<b>Probabilitate ≥${target}× în 12 luni: ${forecastText(t)}</b><br>${t.basis === 'model' ? `${liftText(t.lift)} față de rata de bază` : 'egală cu rata de bază: nicio amprentă de câștigător comparabilă'}${t20 ? html`<br>≥20×: ${forecastText(t20)}` : ''}${near ? html`<br>Cei mai apropiați câștigători la minimul lor: ${near}` : ''}${fc.pastRun ? html`<br>A făcut deja ${fc.pastRun.multiple}× (vârf ${fc.pastRun.peakAt}), acum ${fc.pastRun.drawdownNowPct}% de la vârf.` : ''}<br><span class="muted">Estimare statistică a unui eveniment rar, nu predicție și nu sfat financiar.</span>`;
  return html`<span class="pill fcpill" data-tone="${FC_TONE[t.band] ?? 'muted'}" data-tip="${tip(body)}">${icon('target', 11)} ≥${target}×: ${pctText(t.pct)}${!compact && t.basis === 'model' && Number.isFinite(t.lift) && t.lift !== 1 ? ` ${liftText(t.lift)}` : ''}</span>`;
}

/**
 * The forecast as a block (dossier and research card): both targets with their intervals, the
 * nearest winners at their low, and the reading rules.
 */
export function forecastBlock(fc, { base = null } = {}) {
  if (!fc?.targets) return '';
  const row = (target) => {
    const t = fc.targets[target];
    if (!t) return '';
    const b = (base ?? []).find((x) => String(x.multiple) === String(target));
    return html`<div class="kv"><span>≥${target}× în 12 luni</span><b>${forecastText(t)}</b></div>
      <div class="kv"><span>față de rata de bază${b ? ` (${b.pct?.toFixed(2)}%)` : ''}</span><b>${t.basis === 'model' && Number.isFinite(t.lift) ? `×${t.lift.toFixed(2)}` : 'egală'}</b></div>`;
  };
  return html`<div class="facts">${row('100')}${row('20')}<div class="kv"><span>Trăsături cunoscute</span><b>${Number.isFinite(fc.coverage) ? `${Math.round(fc.coverage * 100)}%` : '—'}</b></div></div>
    ${(fc.nearest ?? []).length ? html`<p class="small" style="margin-top:8px">Cel mai mult seamănă cu: ${fc.nearest.map((n, i) => html`${i ? ' · ' : ''}<b>${n.symbol}</b> ${n.multiple}× (similaritate ${n.similarity}%)`)} — comparat cu amprenta lor la minim, înainte de mișcare.</p>` : html`<p class="small muted" style="margin-top:8px">Nicio amprentă de câștigător destul de comparabilă: probabilitatea este rata de bază.</p>`}
    ${fc.pastRun ? html`<p class="small" style="margin-top:6px">${icon('info', 12)} Proiectul este el însuși pe lista de învățare: a făcut ${fc.pastRun.multiple}× (vârf ${fc.pastRun.peakAt}) și este acum ${fc.pastRun.drawdownNowPct}% de la vârf.</p>` : ''}
    <p class="panel-note">Estimare statistică a unui eveniment rar, nu predicție și nu sfat financiar. Detaliile modelului și lista câștigătorilor: <a href="#/prognoza">Prognoză</a>.</p>`;
}
