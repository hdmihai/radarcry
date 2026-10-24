/**
 * Forward track record: hit rate per signal type and horizon with its Wilson 95 % interval.
 * A dot without a whisker would overstate certainty on small samples, so the interval is the mark.
 */
import { esc, html, raw, tip } from '../core/dom.js';
import { f2, linear } from './scale.js';

export function wilsonChart(byType, types, labels, { width = 640 } = {}) {
  const rows = [];
  for (const t of types) {
    for (const h of byType?.[t]?.horizons ?? []) rows.push({ type: t, ...h });
  }
  if (!rows.length) return null;
  const rowH = 30;
  const M = { l: 150, r: 70, t: 24, b: 26 };
  const W = width;
  const H = M.t + rows.length * rowH + M.b;
  const x = linear([0, 100], [M.l, W - M.r]);
  const parts = ['<g class="grid">'];
  for (const v of [0, 25, 50, 75, 100]) parts.push(`<line x1="${f2(x(v))}" x2="${f2(x(v))}" y1="${M.t - 6}" y2="${H - M.b}"/>`);
  parts.push('</g>');
  for (const v of [0, 25, 50, 75, 100]) parts.push(`<text x="${f2(x(v))}" y="${H - 8}" text-anchor="middle">${v}%</text>`);
  parts.push(`<text x="${M.l}" y="12" class="lbl-strong">Rata de reușită (interval Wilson 95%)</text>`);
  rows.forEach((r, i) => {
    const cy = M.t + i * rowH + rowH / 2;
    const first = i === 0 || rows[i - 1].type !== r.type;
    if (first) parts.push(`<text x="0" y="${f2(cy + 3.5)}" class="lbl-strong">${esc(labels[r.type] ?? r.type)}</text>`);
    parts.push(`<text x="${M.l - 10}" y="${f2(cy + 3.5)}" text-anchor="end">${r.days} zile</text>`);
    if (!r.n) {
      parts.push(`<text x="${f2(x(0) + 4)}" y="${f2(cy + 3.5)}">încă nu există rezultate închise</text>`);
      return;
    }
    const lo = r.ciLow ?? 0;
    const hi = r.ciHigh ?? 100;
    const p = r.hitRate ?? 0;
    parts.push(`<line x1="${f2(x(lo))}" x2="${f2(x(hi))}" y1="${f2(cy)}" y2="${f2(cy)}" stroke="var(--seq-3)" stroke-width="3" stroke-linecap="round"/>`);
    parts.push(`<line x1="${f2(x(lo))}" x2="${f2(x(lo))}" y1="${f2(cy - 6)}" y2="${f2(cy + 6)}" stroke="var(--seq-3)" stroke-width="2"/>`);
    parts.push(`<line x1="${f2(x(hi))}" x2="${f2(x(hi))}" y1="${f2(cy - 6)}" y2="${f2(cy + 6)}" stroke="var(--seq-3)" stroke-width="2"/>`);
    parts.push(`<circle cx="${f2(x(p))}" cy="${f2(cy)}" r="5" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"/>`);
    parts.push(`<text x="${W - M.r + 8}" y="${f2(cy + 3.5)}">${r.hits}/${r.n}</text>`);
    const body = html`<b>${labels[r.type] ?? r.type}, ${r.days} zile</b>
      <div class="tt-row"><span>Reușite</span><span>${r.hits} din ${r.n}</span></div>
      <div class="tt-row"><span>Rată</span><span>${p.toFixed(1)}%</span></div>
      <div class="tt-row"><span>Interval 95%</span><span>${lo.toFixed(1)}–${hi.toFixed(1)}%</span></div>
      <div class="tt-row"><span>Randament mediu</span><span>${r.meanReturnPct ?? '—'}%</span></div>
      <div class="tt-row"><span>MFE / MAE medii</span><span>${r.meanMfePct ?? '—'}% / ${r.meanMaePct ?? '—'}%</span></div>`;
    parts.push(`<rect class="hit" x="0" y="${f2(cy - rowH / 2)}" width="${W}" height="${rowH}" data-tip="${tip(body)}"/>`);
  });
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rata de reușită a semnalelor cu intervale Wilson">${parts.join('')}</svg>`);
}
