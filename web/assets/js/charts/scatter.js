/**
 * Opportunity map: structural resemblance to the best analog (DNA similarity, x) against the
 * research score (CRI, y). Colour = which reference the token resembles (3 validated hues),
 * larger ringed dots = current Setup BUY / Acumulare. Dashed lines are the engine's own thresholds.
 */
import { esc, raw } from '../core/dom.js';
import { f2, linear, niceTicks } from './scale.js';

export function opportunityMap(cands, { minAnalog = 60, minCri = 66, width = 560, height = 360 } = {}) {
  const pts = cands
    .filter((c) => Number.isFinite(c.analogs?.best?.dnaSim) && Number.isFinite(c.score?.cri))
    .map((c) => ({ c, x: c.analogs.best.dnaSim, y: c.score.cri, ref: c.analogs.best.ref, sig: c.signal?.type ?? 'NONE' }));
  if (!pts.length) return null;
  const W = width;
  const H = height;
  const M = { l: 36, r: 12, t: 12, b: 34 };
  const ys = pts.map((p) => p.y);
  const yLo = Math.max(0, Math.floor((Math.min(...ys) - 4) / 10) * 10);
  const yHi = Math.min(100, Math.ceil((Math.max(...ys, minCri) + 4) / 10) * 10);
  const x = linear([0, 100], [M.l, W - M.r]);
  const y = linear([yLo, yHi], [H - M.b, M.t]);
  const parts = ['<g class="grid">'];
  for (const v of niceTicks(0, 100, 5)) parts.push(`<line x1="${f2(x(v))}" x2="${f2(x(v))}" y1="${M.t}" y2="${H - M.b}"/>`);
  for (const v of niceTicks(yLo, yHi, 5)) parts.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${f2(y(v))}" y2="${f2(y(v))}"/>`);
  parts.push('</g>');
  for (const v of niceTicks(0, 100, 5)) parts.push(`<text x="${f2(x(v))}" y="${H - M.b + 14}" text-anchor="middle">${v}</text>`);
  for (const v of niceTicks(yLo, yHi, 5)) parts.push(`<text x="${M.l - 6}" y="${f2(y(v) + 3.5)}" text-anchor="end">${v}</text>`);
  parts.push(`<text x="${f2((M.l + W - M.r) / 2)}" y="${H - 4}" text-anchor="middle" class="lbl-strong">Similaritate ADN cu cel mai apropiat analog</text>`);
  parts.push(`<text transform="translate(11 ${f2((M.t + H - M.b) / 2)}) rotate(-90)" text-anchor="middle" class="lbl-strong">Scor CRI</text>`);

  // engine thresholds (labels kept clear of the dense upper-right corner)
  const boxes = [];
  if (minAnalog > 0 && minAnalog < 100) {
    parts.push(`<line x1="${f2(x(minAnalog))}" x2="${f2(x(minAnalog))}" y1="${M.t}" y2="${H - M.b}" stroke="var(--ink-3)" stroke-dasharray="4 4"/>`);
    parts.push(`<text x="${f2(x(minAnalog) - 4)}" y="${H - M.b - 6}" text-anchor="end">prag ADN ${minAnalog}</text>`);
    boxes.push({ x0: x(minAnalog) - 70, x1: x(minAnalog), y0: H - M.b - 16, y1: H - M.b });
  }
  if (minCri > yLo && minCri < yHi) {
    parts.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${f2(y(minCri))}" y2="${f2(y(minCri))}" stroke="var(--ink-3)" stroke-dasharray="4 4"/>`);
    parts.push(`<text x="${M.l + 4}" y="${f2(y(minCri) - 5)}">prag CRI Setup BUY ${minCri}</text>`);
    boxes.push({ x0: M.l, x1: M.l + 130, y0: y(minCri) - 15, y1: y(minCri) });
  }

  // dots: quiet ones first, highlighted on top
  const strong = (p) => p.sig === 'BUY_SETUP' || p.sig === 'ACCUMULATE';
  const ordered = [...pts].sort((a, b) => Number(strong(a)) - Number(strong(b)) || a.y - b.y);
  for (const p of ordered) {
    const r = strong(p) ? 6 : 4;
    const dim = p.sig === 'NONE' || p.sig === 'AVOID' || p.sig === 'LATE';
    parts.push(`<circle cx="${f2(x(p.x))}" cy="${f2(y(p.y))}" r="${r}" data-ref="${esc(p.ref)}" fill="var(--ref)" fill-opacity="${dim ? 0.45 : 0.9}" stroke="${strong(p) ? 'var(--ink)' : 'var(--surface)'}" stroke-width="${strong(p) ? 1.6 : 1}" />`);
  }
  // direct labels for the strongest few, placed greedily where they do not collide
  const top = [...pts].filter(strong).sort((a, b) => b.y - a.y).slice(0, 8);
  const overlaps = (b) => boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  for (const p of pts.filter(strong)) boxes.push({ x0: x(p.x) - 7, x1: x(p.x) + 7, y0: y(p.y) - 7, y1: y(p.y) + 7 });
  for (const p of top) {
    const px = x(p.x);
    const py = y(p.y);
    const w = p.c.symbol.length * 6.6 + 2;
    const options = [
      { tx: px + 9, ty: py + 3.5, anchor: 'start', b: { x0: px + 8, x1: px + 8 + w, y0: py - 6, y1: py + 6 } },
      { tx: px - 9, ty: py + 3.5, anchor: 'end', b: { x0: px - 8 - w, x1: px - 8, y0: py - 6, y1: py + 6 } },
      { tx: px, ty: py - 10, anchor: 'middle', b: { x0: px - w / 2, x1: px + w / 2, y0: py - 20, y1: py - 8 } },
      { tx: px, ty: py + 17, anchor: 'middle', b: { x0: px - w / 2, x1: px + w / 2, y0: py + 7, y1: py + 19 } },
    ].filter((o) => o.b.x0 >= M.l && o.b.x1 <= W - M.r && o.b.y0 >= M.t);
    const pick = options.find((o) => !overlaps(o.b));
    if (!pick) continue;
    boxes.push(pick.b);
    parts.push(`<text x="${f2(pick.tx)}" y="${f2(pick.ty)}" text-anchor="${pick.anchor}" class="lbl-strong">${esc(p.c.symbol)}</text>`);
  }
  // generous hit targets on top (transparent), carrying the candidate key
  for (const p of ordered) {
    parts.push(`<circle class="hit" cx="${f2(x(p.x))}" cy="${f2(y(p.y))}" r="9" data-open="${esc(p.c.key)}" data-tipfn="cand" data-key="${esc(p.c.key)}" style="cursor:pointer"/>`);
  }
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hartă: similaritate ADN vs scor CRI pentru ${pts.length} tokeni">${parts.join('')}</svg>`);
}
