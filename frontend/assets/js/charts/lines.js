/** Line charts: table sparklines, reference pre-ignition windows, CRI history, 1D closes. */
import { esc, html, raw, tip } from '../core/dom.js';
import { dateTime, dayMonth, pct, price as fp, score } from '../core/format.js';
import { f2, linePath, linear, logScale, logTicks, niceTicks, timeTicks } from './scale.js';

export function sparkline(values, { w = 84, h = 24 } = {}) {
  const vals = (values ?? []).filter((v) => Number.isFinite(v));
  if (vals.length < 3) return raw('<span class="muted xs">fără istoric</span>');
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const x = linear([0, vals.length - 1], [1.5, w - 3.5]);
  const y = linear([min, max === min ? min + 1 : max], [h - 2, 2]);
  const up = vals[vals.length - 1] >= vals[0];
  const col = up ? 'var(--up)' : 'var(--down)';
  const d = linePath(vals.map((v, i) => [x(i), y(v)]));
  const change = ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100;
  return raw(`<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Preț ~30 zile: ${esc(pct(change))}"><path d="${d}" stroke="${col}"/><circle cx="${f2(x(vals.length - 1))}" cy="${f2(y(vals[vals.length - 1]))}" r="2" fill="${col}"/></svg>`);
}

/**
 * Reference window: the 45 daily closes before the anchor (what candidates are compared to) and the
 * 45 after it (the outcome), on a log scale so a +1,500 % move does not flatten the base.
 */
export function referenceWindowChart(ref, { width = 420, height = 180 } = {}) {
  const pre = ref?.window?.closes ?? [];
  const after = ref?.window?.after ?? [];
  if (pre.length < 5) return null;
  const all = [...pre, ...after].filter((p) => Number.isFinite(p[1]) && p[1] > 0);
  const W = width;
  const H = height;
  const M = { l: 6, r: 52, t: 12, b: 22 };
  const t0 = all[0][0];
  const t1 = all[all.length - 1][0];
  const x = linear([t0, t1], [M.l, W - M.r]);
  const min = Math.min(...all.map((p) => p[1]));
  const max = Math.max(...all.map((p) => p[1]));
  const y = logScale([min * 0.92, max * 1.08], [H - M.b, M.t]);
  const parts = ['<g class="grid">'];
  const yt = logTicks(min * 0.92, max * 1.08).slice(0, 7);
  for (const v of yt) parts.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${f2(y(v))}" y2="${f2(y(v))}"/>`);
  parts.push('</g>');
  for (const v of yt) parts.push(`<text x="${W - M.r + 6}" y="${f2(y(v) + 3.5)}">${esc(fp(v))}</text>`);
  for (const t of timeTicks(t0, t1, 4)) parts.push(`<text x="${f2(x(t))}" y="${H - 6}" text-anchor="middle">${esc(dayMonth(t))}</text>`);

  const anchorT = pre[pre.length - 1][0];
  const from = Date.parse(ref.window.from) / 1000;
  if (Number.isFinite(from)) {
    parts.push(`<rect x="${f2(x(from))}" y="${M.t}" width="${f2(x(anchorT) - x(from))}" height="${H - M.t - M.b}" fill="var(--ref)" fill-opacity="0.1"/>`);
    parts.push(`<text x="${f2(x(from) + 4)}" y="${M.t + 10}" class="lbl-strong">fereastra comparată</text>`);
  }
  parts.push(`<line x1="${f2(x(anchorT))}" x2="${f2(x(anchorT))}" y1="${M.t}" y2="${H - M.b}" stroke="var(--ink-2)" stroke-dasharray="3 3"/>`);
  parts.push(`<text x="${f2(x(anchorT) + 4)}" y="${H - M.b - 6}" class="lbl-strong">ancoră</text>`);
  parts.push(`<path d="${linePath(pre.map((p) => [x(p[0]), y(p[1])]))}" fill="none" stroke="var(--ref)" stroke-width="2" stroke-linejoin="round"/>`);
  if (after.length) {
    parts.push(`<path d="${linePath([pre[pre.length - 1], ...after].map((p) => [x(p[0]), y(p[1])]))}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="4 3" stroke-linejoin="round"/>`);
  }
  // hover columns
  const step = (W - M.l - M.r) / Math.max(1, all.length);
  for (const p of all) {
    const isAfter = p[0] > anchorT;
    const content = html`<b>${dateTime(p[0])}</b><div class="tt-row"><span>${isAfter ? 'după ancoră' : 'înainte de ancoră'}</span><span>${fp(p[1])}</span></div>`;
    parts.push(`<rect class="hit" x="${f2(x(p[0]) - step / 2)}" y="${M.t}" width="${f2(step)}" height="${H - M.t - M.b}" data-tip="${tip(content)}"/>`);
  }
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fereastra pre-expansiune ${esc(ref.symbol)} pe scară logaritmică">${parts.join('')}</svg>`);
}

/** Daily closes (up to 90) as a quiet context line under the 4H chart. */
export function dailyChart(d1, { width = 820, height = 120 } = {}) {
  const pts = (d1 ?? []).filter((p) => Number.isFinite(p[1]));
  if (pts.length < 5) return null;
  const W = width;
  const H = height;
  const M = { l: 4, r: 70, t: 10, b: 20 };
  const x = linear([pts[0][0], pts[pts.length - 1][0]], [M.l, W - M.r]);
  const min = Math.min(...pts.map((p) => p[1]));
  const max = Math.max(...pts.map((p) => p[1]));
  const y = linear([min, max === min ? min * 1.01 + 1e-12 : max], [H - M.b, M.t]);
  const parts = ['<g class="grid">'];
  const ticks = niceTicks(min, max, 3);
  for (const v of ticks) parts.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${f2(y(v))}" y2="${f2(y(v))}"/>`);
  parts.push('</g>');
  for (const v of ticks) parts.push(`<text x="${W - M.r + 8}" y="${f2(y(v) + 3.5)}">${esc(fp(v))}</text>`);
  for (const t of timeTicks(pts[0][0], pts[pts.length - 1][0], 6)) parts.push(`<text x="${f2(x(t))}" y="${H - 5}" text-anchor="middle">${esc(dayMonth(t))}</text>`);
  parts.push(`<path d="${linePath(pts.map((p) => [x(p[0]), y(p[1])]))}" fill="none" stroke="var(--ink-2)" stroke-width="1.6" stroke-linejoin="round"/>`);
  const step = (W - M.l - M.r) / pts.length;
  for (const p of pts) parts.push(`<rect class="hit" x="${f2(x(p[0]) - step / 2)}" y="${M.t}" width="${f2(step)}" height="${H - M.t - M.b}" data-tip="${tip(html`<b>${dateTime(p[0])}</b><div class="tt-row"><span>Închidere 1D</span><span>${fp(p[1])}</span></div>`)}"/>`);
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Închideri zilnice, ultimele ${pts.length} zile">${parts.join('')}</svg>`);
}

/** CRI history with stage changes, against the BUY / accumulate thresholds. */
export function criHistoryChart(rows, thresholds, stageLabels, { width = 820, height = 150 } = {}) {
  const pts = (rows ?? []).map((r) => ({ t: Date.parse(r[0]) / 1000, cri: r[1], stage: r[2], price: r[3] })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.cri));
  if (pts.length < 2) return null;
  const W = width;
  const H = height;
  const M = { l: 4, r: 70, t: 12, b: 22 };
  const x = linear([pts[0].t, pts[pts.length - 1].t], [M.l, W - M.r]);
  const lo = Math.max(0, Math.min(40, ...pts.map((p) => p.cri)) - 5);
  const hi = Math.min(100, Math.max(80, ...pts.map((p) => p.cri)) + 5);
  const y = linear([lo, hi], [H - M.b, M.t]);
  const parts = ['<g class="grid">'];
  for (const v of niceTicks(lo, hi, 4)) parts.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${f2(y(v))}" y2="${f2(y(v))}"/>`);
  parts.push('</g>');
  for (const v of niceTicks(lo, hi, 4)) parts.push(`<text x="${W - M.r + 8}" y="${f2(y(v) + 3.5)}">${v}</text>`);
  const buy = thresholds?.buySetup?.minCri;
  const acc = thresholds?.accumulate?.minCri;
  for (const [v, name] of [[buy, 'prag Setup BUY'], [acc, 'prag acumulare']]) {
    if (Number.isFinite(v) && v > lo && v < hi) {
      parts.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${f2(y(v))}" y2="${f2(y(v))}" stroke="var(--ink-3)" stroke-dasharray="4 4"/>`);
      parts.push(`<text x="${M.l + 4}" y="${f2(y(v) - 4)}">${name} ${v}</text>`);
    }
  }
  for (const t of timeTicks(pts[0].t, pts[pts.length - 1].t, 6)) parts.push(`<text x="${f2(x(t))}" y="${H - 5}" text-anchor="middle">${esc(dayMonth(t))}</text>`);
  // stage changes as ticks on the baseline
  let prevStage = null;
  for (const p of pts) {
    if (p.stage && p.stage !== prevStage) {
      parts.push(`<line x1="${f2(x(p.t))}" x2="${f2(x(p.t))}" y1="${H - M.b - 6}" y2="${H - M.b}" stroke="var(--ink-2)"/>`);
      prevStage = p.stage;
    }
  }
  parts.push(`<path d="${linePath(pts.map((p) => [x(p.t), y(p.cri)]))}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`);
  const lastP = pts[pts.length - 1];
  parts.push(`<circle cx="${f2(x(lastP.t))}" cy="${f2(y(lastP.cri))}" r="3.5" fill="var(--accent)" stroke="var(--plane)" stroke-width="2"/>`);
  const step = (W - M.l - M.r) / pts.length;
  for (const p of pts) {
    parts.push(`<rect class="hit" x="${f2(x(p.t) - step / 2)}" y="${M.t}" width="${f2(step)}" height="${H - M.t - M.b}" data-tip="${tip(html`<b>${dateTime(p.t)}</b><div class="tt-row"><span>CRI</span><span>${score(p.cri)}</span></div><div class="tt-row"><span>Stadiu</span><span>${stageLabels?.[p.stage] ?? p.stage ?? '—'}</span></div><div class="tt-row"><span>Preț</span><span>${fp(p.price)}</span></div>`)}"/>`);
  }
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evoluția scorului CRI">${parts.join('')}</svg>`);
}
