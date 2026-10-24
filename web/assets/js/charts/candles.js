/**
 * 4H candlestick chart with the SMC read drawn on top: order blocks, fair-value gaps, liquidity
 * sweep, swing levels, BOS/CHoCH marks and the research plan (entry zone, invalidation, targets).
 * All level names live in a right-hand gutter (like an exchange price axis), de-collided, so the
 * plot itself only carries shapes. Up candles are light-bodied and down candles solid, so
 * direction never relies on hue alone.
 */
import { esc, html, raw, tip } from '../core/dom.js';
import { compact, dateTime, dayMonth, price as fp } from '../core/format.js';
import { f2, linear, niceTicks, timeTicks } from './scale.js';

const sec = (t) => (t > 1e11 ? Math.round(t / 1000) : t);

export function candleChart({ h4, smc = null, plan = null, width = 860, height = 340 }) {
  if (!Array.isArray(h4) || h4.length < 5) return null;
  const narrow = width < 600;
  const W = width;
  const H = height;
  const M = { l: 4, r: narrow ? 92 : 128, t: 14, b: 24 };
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;
  const volH = Math.round(plotH * 0.14);
  const priceBottom = M.t + plotH - volH - 8;
  const n = h4.length;
  const step = plotW / n;
  const x = (i) => M.l + step * (i + 0.5);
  const right = M.l + plotW;
  const t0 = h4[0][0];
  const tStep = n > 1 ? (h4[n - 1][0] - t0) / (n - 1) : 14400;
  const xt = (tSec) => x(Math.max(0, Math.min(n - 1, (sec(tSec) - t0) / tStep)));

  let lo = Infinity;
  let hi = -Infinity;
  for (const k of h4) {
    lo = Math.min(lo, k[3]);
    hi = Math.max(hi, k[2]);
  }
  const span0 = hi - lo || hi * 0.05 || 1;
  const near = (v) => Number.isFinite(v) && v > lo - span0 * 0.7 && v < hi + span0 * 0.7;
  const extend = (v) => {
    if (near(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  };
  if (plan) [plan.entryLow, plan.entryHigh, plan.invalidation].forEach(extend);
  const targets = (plan?.targets ?? []).map((t) => ({ ...t, inside: near(t.price) }));
  targets.filter((t) => t.inside).forEach((t) => extend(t.price));
  const pad = (hi - lo) * 0.07;
  const y = linear([lo - pad, hi + pad], [priceBottom, M.t]);
  const inY = (v) => Number.isFinite(v) && y(v) >= M.t - 1 && y(v) <= priceBottom + 1;
  const vmax = Math.max(1e-12, ...h4.map((k) => k[5] || 0));
  const volBase = M.t + plotH;
  const yv = (v) => volBase - (v / vmax) * volH;

  const parts = [];
  const tags = []; // gutter labels: { y, text, color, prio }

  // grid + time axis
  const ticks = niceTicks(lo - pad, hi + pad, 5).filter(inY);
  parts.push('<g class="grid">');
  for (const v of ticks) parts.push(`<line x1="${M.l}" x2="${right}" y1="${f2(y(v))}" y2="${f2(y(v))}"/>`);
  for (const t of timeTicks(t0, h4[n - 1][0], narrow ? 4 : 6)) parts.push(`<line x1="${f2(xt(t))}" x2="${f2(xt(t))}" y1="${M.t}" y2="${volBase}"/>`);
  parts.push('</g>');
  for (const t of timeTicks(t0, h4[n - 1][0], narrow ? 4 : 6)) parts.push(`<text x="${f2(xt(t))}" y="${H - 6}" text-anchor="middle">${esc(dayMonth(t))}</text>`);

  // zones (behind candles), named in the gutter
  const zone = (top, bottom, fromT, color, name, dashed) => {
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;
    const yt = y(Math.max(top, bottom));
    const yb = y(Math.min(top, bottom));
    if (yb < M.t || yt > priceBottom) return;
    const x0 = xt(fromT);
    parts.push(`<rect x="${f2(x0)}" y="${f2(yt)}" width="${f2(right - x0)}" height="${f2(Math.max(2, yb - yt))}" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-opacity="0.6" ${dashed ? 'stroke-dasharray="3 3"' : ''}/>`);
    tags.push({ y: (yt + yb) / 2, text: name, color, prio: 2 });
  };
  for (const ob of (smc?.orderBlocks ?? []).filter((o) => o.dir === 'BULL').slice(0, 2)) zone(ob.top, ob.bottom, ob.t, 'var(--up)', ob.mitigated ? 'OB atins' : 'OB', ob.mitigated);
  for (const g of (smc?.fvgs ?? []).filter((o) => o.dir === 'BULL').slice(0, 2)) zone(g.top, g.bottom, g.t, 'var(--seq-3)', g.partiallyFilled ? 'FVG parțial' : 'FVG', false);

  // research plan
  if (plan && Number.isFinite(plan.entryLow) && Number.isFinite(plan.entryHigh)) {
    const x0 = M.l + plotW * 0.7;
    const yt = y(plan.entryHigh);
    const yb = y(plan.entryLow);
    if (yb > M.t && yt < priceBottom) {
      parts.push(`<rect x="${f2(x0)}" y="${f2(yt)}" width="${f2(right - x0)}" height="${f2(Math.max(2, yb - yt))}" fill="var(--accent)" fill-opacity="0.18" stroke="var(--accent)" stroke-opacity="0.8"/>`);
      tags.push({ y: (yt + yb) / 2, text: `intrare ${fp(plan.entryLow)}–${fp(plan.entryHigh)}`, color: 'var(--accent-ink)', prio: 0 });
    }
  }
  if (plan && inY(plan.invalidation)) {
    const yy = y(plan.invalidation);
    parts.push(`<line x1="${M.l}" x2="${right}" y1="${f2(yy)}" y2="${f2(yy)}" stroke="var(--critical)" stroke-width="1.5" stroke-dasharray="6 4"/>`);
    tags.push({ y: yy, text: `invalidare ${fp(plan.invalidation)}`, color: 'var(--critical-ink)', prio: 0 });
  }
  for (const t of targets.filter((tt) => tt.inside && inY(tt.price))) {
    const yy = y(t.price);
    parts.push(`<line x1="${f2(M.l + plotW * 0.5)}" x2="${right}" y1="${f2(yy)}" y2="${f2(yy)}" stroke="var(--good-ink)" stroke-width="1.2" stroke-dasharray="2 3"/>`);
    tags.push({ y: yy, text: `${t.label.split(' ')[0]} ${fp(t.price)}`, color: 'var(--good-ink)', prio: 0 });
  }

  // liquidity + swings
  if (smc?.sweep && inY(smc.sweep.level)) {
    const yy = y(smc.sweep.level);
    const x0 = xt(smc.sweep.t);
    parts.push(`<line x1="${f2(Math.max(M.l, x0 - step * 10))}" x2="${f2(Math.min(right, x0 + step * 3))}" y1="${f2(yy)}" y2="${f2(yy)}" stroke="var(--ink-2)" stroke-width="1.2" stroke-dasharray="4 3"/>`);
    parts.push(`<circle cx="${f2(x0)}" cy="${f2(y(smc.sweep.low ?? smc.sweep.level))}" r="3" fill="none" stroke="var(--ink-2)" stroke-width="1.2"/>`);
    tags.push({ y: yy, text: 'sweep SSL', color: 'var(--ink-2)', prio: 3 });
  }
  for (const [lvl, name] of [[smc?.swingHigh, 'swing H'], [smc?.swingLow, 'swing L']]) {
    if (inY(lvl)) {
      const yy = y(lvl);
      parts.push(`<line x1="${M.l}" x2="${right}" y1="${f2(yy)}" y2="${f2(yy)}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="1 3"/>`);
      tags.push({ y: yy, text: name, color: 'var(--ink-3)', prio: 4 });
    }
  }

  // volume + candles
  const bw = Math.max(1.4, step * 0.62);
  for (let i = 0; i < n; i += 1) {
    const [, o, , , c, v] = h4[i];
    parts.push(`<rect x="${f2(x(i) - bw / 2)}" y="${f2(yv(v || 0))}" width="${f2(bw)}" height="${f2(Math.max(0.5, volBase - yv(v || 0)))}" fill="var(--ink-3)" fill-opacity="${c >= o ? 0.22 : 0.36}"/>`);
  }
  for (let i = 0; i < n; i += 1) {
    const [, o, h, l, c] = h4[i];
    const up = c >= o;
    const xx = x(i);
    const col = up ? 'var(--up)' : 'var(--down)';
    const top = y(Math.max(o, c));
    const bot = y(Math.min(o, c));
    parts.push(`<line x1="${f2(xx)}" x2="${f2(xx)}" y1="${f2(y(h))}" y2="${f2(y(l))}" stroke="${col}" stroke-width="1"/>`);
    parts.push(`<rect x="${f2(xx - bw / 2)}" y="${f2(top)}" width="${f2(bw)}" height="${f2(Math.max(1, bot - top))}" fill="${col}" fill-opacity="${up ? 0.25 : 1}" stroke="${col}" stroke-width="1"/>`);
  }

  // structure events: short segment from the broken level + small mark (last 3, de-collided)
  const marks = [];
  for (const ev of [...(smc?.events ?? [])].slice(-3)) {
    if (!inY(ev.level)) continue;
    const x0 = xt(ev.t);
    const yy = y(ev.level);
    const ty = ev.dir === 'UP' ? yy - 4 : yy + 11;
    if (marks.some((m) => Math.abs(m.x - x0) < 34 && Math.abs(m.y - ty) < 11)) continue;
    marks.push({ x: x0, y: ty });
    const name = ev.type === 'CHOCH' ? 'CHoCH' : 'BOS';
    parts.push(`<line x1="${f2(x0)}" x2="${f2(Math.min(right, x0 + step * 6))}" y1="${f2(yy)}" y2="${f2(yy)}" stroke="var(--ink-2)" stroke-width="1"/>`);
    parts.push(`<text x="${f2(x0 + 1)}" y="${f2(ty)}" class="lbl-strong">${name}</text>`);
  }

  // gutter: last price first, then plan levels, zones, liquidity, swings; drop what cannot fit
  const last = h4[n - 1][4];
  const yl = y(last);
  parts.push(`<line x1="${M.l}" x2="${right}" y1="${f2(yl)}" y2="${f2(yl)}" stroke="var(--ink-2)" stroke-opacity="0.45" stroke-width="1"/>`);
  const placed = [{ y: yl, h: 16 }];
  const fits = (yy) => yy > M.t + 4 && yy < volBase && placed.every((p) => Math.abs(p.y - yy) >= (p.h + 12) / 2);
  const gutterX = right + 8;
  for (const tg of tags.sort((a, b) => a.prio - b.prio)) {
    let yy = tg.y;
    if (!fits(yy)) {
      const alt = [tg.y - 12, tg.y + 12, tg.y - 24, tg.y + 24].find(fits);
      if (alt === undefined) continue;
      yy = alt;
    }
    placed.push({ y: yy, h: 12 });
    parts.push(`<line x1="${right}" x2="${right + 5}" y1="${f2(tg.y)}" y2="${f2(yy)}" stroke="${tg.color}"/>`);
    parts.push(`<text x="${gutterX}" y="${f2(yy + 3.5)}" style="fill:${tg.color};font-weight:600">${esc(narrow ? tg.text.replace(/^intrare (.*)$/, 'intrare') : tg.text)}</text>`);
  }
  // price ticks only where the gutter is free
  for (const v of ticks) {
    const yy = y(v);
    if (placed.every((p) => Math.abs(p.y - yy) >= (p.h + 10) / 2)) parts.push(`<text x="${gutterX}" y="${f2(yy + 3.5)}">${esc(fp(v))}</text>`);
  }
  parts.push(`<rect x="${right + 2}" y="${f2(yl - 8)}" width="${narrow ? 60 : 66}" height="16" rx="2" fill="var(--ink)"/>`);
  parts.push(`<text x="${gutterX}" y="${f2(yl + 3.5)}" style="fill:var(--plane);font-weight:700">${esc(fp(last))}</text>`);
  const outside = targets.filter((t) => !t.inside);
  if (outside.length) parts.push(`<text x="${right - 4}" y="${M.t + 10}" text-anchor="end" style="fill:var(--good-ink);font-weight:600">${esc(outside.map((t) => `${t.label.split(' ')[0]} ${fp(t.price)} ↑`).join('   '))}</text>`);

  // hover targets
  for (let i = 0; i < n; i += 1) {
    const [t, o, h, l, c, v] = h4[i];
    const chg = o ? ((c - o) / o) * 100 : 0;
    const content = html`<b>${dateTime(t)}</b><div class="tt-row"><span>O</span><span>${fp(o)}</span></div><div class="tt-row"><span>H</span><span>${fp(h)}</span></div><div class="tt-row"><span>L</span><span>${fp(l)}</span></div><div class="tt-row"><span>C</span><span>${fp(c)} (${chg >= 0 ? '+' : '−'}${Math.abs(chg).toFixed(2)}%)</span></div><div class="tt-row"><span>Volum</span><span>${compact(v)}</span></div>`;
    parts.push(`<rect class="hit" x="${f2(x(i) - step / 2)}" y="${M.t}" width="${f2(step)}" height="${plotH}" data-tip="${tip(content)}"/>`);
  }

  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafic 4H cu zone SMC și planul de cercetare">${parts.join('')}</svg>`);
}
