/**
 * Pattern-DNA visuals — the dashboard's signature element.
 *  - dnaStrip: 15 cells (9 structural "ADN" + 6 timing "fază"), each shaded by how closely the token
 *    matches the reference on that feature; hatched = unknown (never treated as a mismatch).
 *  - dnaCompare: per-feature dot plot on the fixed 0..100 scale — the token as a filled dot, each
 *    reference as a labelled tick in its identity colour.
 */
import { esc, html, raw, tip } from '../core/dom.js';
import { agreement } from '../core/store.js';
import { f2, linear } from './scale.js';

const level = (a) => (a === null ? 'u' : a >= 0.8 ? '4' : a >= 0.6 ? '3' : a >= 0.4 ? '2' : a >= 0.2 ? '1' : '0');

export function dnaStrip(cand, ref, features, sigma, { withTip = true } = {}) {
  if (!ref?.vector || !cand?.fingerprint) return raw('<span class="muted xs">—</span>');
  const dna = features.filter((f) => f.group === 'dna');
  const phase = features.filter((f) => f.group !== 'dna');
  const cell = (f) => `<i data-a="${level(agreement(cand.fingerprint, ref.vector, f.key, sigma))}"></i>`;
  const cells = `${dna.map(cell).join('')}<i class="gap"></i>${phase.map(cell).join('')}`;
  // Hover detail only: the strip often sits inside a row button; the drawer carries the full comparison.
  const attrs = withTip ? `data-tipfn="dna" data-key="${esc(cand.key)}" data-ref="${esc(ref.symbol)}"` : '';
  return raw(`<span class="dna" role="img" aria-label="ADN comparat cu ${esc(ref.symbol)}" ${attrs}>${cells}</span>`);
}

/** Tooltip body for a DNA strip (built lazily on hover). */
export function dnaTooltip(cand, ref, features, sigma) {
  const rows = features.map((f) => {
    const a = agreement(cand.fingerprint, ref.vector, f.key, sigma);
    return { f, a };
  });
  const fmt = (a) => (a === null ? 'necunoscut' : `${Math.round(a * 100)}%`);
  const best = cand.analogs?.all?.find((x) => x.ref === ref.symbol);
  return html`<b>ADN vs ${ref.symbol}</b> ${best ? html`<span class="muted">(similaritate ${Math.round(best.similarity)}: ADN ${Math.round(best.dnaSim ?? 0)}, fază ${Math.round(best.phaseSim ?? 0)})</span>` : ''}
    ${rows.map(({ f, a }) => html`<div class="tt-row"><span>${f.label}${f.group === 'dna' ? '' : ' (fază)'}</span><span>${fmt(a)}</span></div>`)}`;
}

export function dnaCompare(cand, refs, features, { width = 820 } = {}) {
  const groups = [
    ['ADN: ce fel de token este', features.filter((f) => f.group === 'dna')],
    ['Fază: unde se află în ciclu', features.filter((f) => f.group !== 'dna')],
  ];
  const rowH = 22;
  const labelW = width < 600 ? 128 : 170;
  const M = { l: labelW, r: 16, t: 22 };
  const rows = groups.reduce((n, [, fs]) => n + fs.length, 0);
  const H = M.t + rows * rowH + groups.length * 26 + 18;
  const W = width;
  const x = linear([0, 100], [M.l, W - M.r]);
  const parts = [];
  // scale header
  for (const v of [0, 25, 50, 75, 100]) parts.push(`<text x="${f2(x(v))}" y="12" text-anchor="middle">${v}</text>`);
  let yy = M.t;
  for (const [title, fs] of groups) {
    yy += 18;
    parts.push(`<text x="0" y="${yy - 4}" class="lbl-strong">${esc(title)}</text>`);
    for (const f of fs) {
      const cy = yy + rowH / 2;
      const cv = cand.fingerprint?.[f.key];
      const known = Number.isFinite(cv);
      parts.push(`<text x="0" y="${f2(cy + 3.5)}">${esc(f.label)}</text>`);
      parts.push(known
        ? `<line x1="${M.l}" x2="${W - M.r}" y1="${f2(cy)}" y2="${f2(cy)}" stroke="var(--grid)" stroke-width="6" stroke-linecap="round"/>`
        : `<rect x="${M.l}" y="${f2(cy - 3)}" width="${f2(W - M.r - M.l)}" height="6" rx="3" fill="url(#hatch)"/>`);
      for (const r of refs) {
        const rv = r.vector?.[f.key];
        if (!Number.isFinite(rv)) continue;
        parts.push(`<line x1="${f2(x(rv))}" x2="${f2(x(rv))}" y1="${f2(cy - 7)}" y2="${f2(cy + 7)}" data-ref="${esc(r.symbol)}" stroke="var(--ref)" stroke-width="3" stroke-linecap="round"/>`);
      }
      if (known) parts.push(`<circle cx="${f2(x(cv))}" cy="${f2(cy)}" r="5.5" fill="var(--ink)" stroke="var(--plane)" stroke-width="2"/>`);
      else parts.push(`<text x="${f2(x(50))}" y="${f2(cy - 6)}" text-anchor="middle">necunoscut, nu penalizează</text>`);
      const tipRows = [html`<div class="tt-row"><span>${cand.symbol}</span><span>${known ? Math.round(cv) : 'necunoscut'}</span></div>`,
        ...refs.map((r) => html`<div class="tt-row"><span>${r.symbol}</span><span>${Number.isFinite(r.vector?.[f.key]) ? Math.round(r.vector[f.key]) : '—'}</span></div>`)];
      parts.push(`<rect class="hit" x="0" y="${f2(yy)}" width="${W}" height="${rowH}" data-tip="${tip(html`<b>${f.label}</b> <span class="muted">(scală fixă 0–100)</span>${tipRows}`)}"/>`);
      yy += rowH;
    }
    yy += 8;
  }
  const defs = '<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--hatch)"/></pattern></defs>';
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${f2(yy + 4)}" role="img" aria-label="Amprenta ${esc(cand.symbol)} comparată cu ${esc(refs.map((r) => r.symbol).join(', '))}">${defs}${parts.join('')}</svg>`);
}
