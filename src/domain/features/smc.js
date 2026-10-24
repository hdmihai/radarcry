/**
 * Smart Money Concepts on 4H candles: market structure (BOS / CHoCH), order blocks,
 * fair value gaps, sell-side liquidity sweeps and premium/discount of the dealing range.
 * Deterministic and look-ahead free: pivots are confirmed fractals, breaks are judged on closes.
 */
import { isNum } from '../shared/math.js';
import { atr, emaSeries, pivots, rsi } from './indicators.js';

const MAX_ZONES = 3;

function lastBearishCandleBefore(candles, fromIdx, toIdx) {
  for (let i = toIdx; i >= fromIdx; i -= 1) if (candles[i].c < candles[i].o) return i;
  return null;
}

/**
 * @param {{t:number,o:number,h:number,l:number,c:number,v:number|null}[]} candles  4H, oldest → newest
 */
export function smcFeatures(candles) {
  if (!Array.isArray(candles) || candles.length < 40) return null;
  const n = candles.length;
  const close = candles[n - 1].c;
  const { highs, lows } = pivots(candles, 3, 3);

  // Walk forward through time: a swing becomes "active" once confirmed (3 bars after it formed).
  const events = [];
  let trend = 'UNKNOWN';
  let activeHigh = null;
  let activeLow = null;
  let hp = 0;
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    while (hp < highs.length && highs[hp].i + 3 <= i) { activeHigh = { ...highs[hp], broken: false }; hp += 1; }
    while (lp < lows.length && lows[lp].i + 3 <= i) { activeLow = { ...lows[lp], broken: false }; lp += 1; }
    const c = candles[i];
    if (activeHigh && !activeHigh.broken && c.c > activeHigh.price) {
      events.push({ type: trend === 'BEARISH' ? 'CHOCH' : 'BOS', dir: 'UP', level: activeHigh.price, i, t: c.t, swingIdx: activeHigh.i });
      trend = 'BULLISH';
      activeHigh.broken = true;
    } else if (activeLow && !activeLow.broken && c.c < activeLow.price) {
      events.push({ type: trend === 'BULLISH' ? 'CHOCH' : 'BOS', dir: 'DOWN', level: activeLow.price, i, t: c.t, swingIdx: activeLow.i });
      trend = 'BEARISH';
      activeLow.broken = true;
    }
  }

  // Bullish order blocks: last bearish candle before the impulse of each UP break, still valid (no close below).
  const orderBlocks = [];
  for (const ev of events.filter((e) => e.dir === 'UP').slice(-6)) {
    const prevLow = [...lows].reverse().find((p) => p.i < ev.i);
    const from = prevLow ? prevLow.i : Math.max(0, ev.i - 12);
    const obIdx = lastBearishCandleBefore(candles, from, ev.i - 1);
    if (obIdx === null) continue;
    const ob = candles[obIdx];
    const invalidated = candles.slice(ev.i + 1).some((k) => k.c < ob.l);
    if (invalidated) continue;
    const mitigated = candles.slice(ev.i + 1).some((k) => k.l <= ob.h);
    orderBlocks.push({ dir: 'BULL', top: ob.h, bottom: ob.l, t: ob.t, mitigated, sourceEvent: ev.type });
  }

  // Bullish FVGs: low[i] > high[i-2]; keep gaps not fully filled afterwards.
  const fvgs = [];
  for (let i = 2; i < n; i += 1) {
    const a = candles[i - 2];
    const k = candles[i];
    if (k.l > a.h) {
      const after = candles.slice(i + 1);
      const minLow = after.length ? Math.min(...after.map((x) => x.l)) : Infinity;
      if (minLow <= a.h) continue; // fully filled
      fvgs.push({ dir: 'BULL', top: k.l, bottom: a.h, t: candles[i - 1].t, partiallyFilled: minLow < k.l });
    }
  }

  // Sell-side liquidity sweep: wick below a confirmed swing low and close back above it (last 20 bars).
  let sweep = null;
  for (let i = Math.max(1, n - 20); i < n; i += 1) {
    const c = candles[i];
    const ref = [...lows].reverse().find((p) => p.i + 3 <= i && p.i < i);
    if (ref && c.l < ref.price && c.c > ref.price) sweep = { dir: 'SELL_SIDE', level: ref.price, low: c.l, t: c.t, barsAgo: n - 1 - i };
  }

  const lastEvent = events.length ? events[events.length - 1] : null;
  const recentLows = lows.filter((p) => p.price < close).slice(-1)[0] ?? null;
  const recentHighs = highs.slice(-1)[0] ?? null;
  let dealingRange = null;
  if (recentLows && recentHighs && recentHighs.price > recentLows.price) {
    const hi = Math.max(recentHighs.price, close);
    dealingRange = { high: hi, low: recentLows.price, position: (close - recentLows.price) / (hi - recentLows.price) };
  }

  const closes = candles.map((k) => k.c);
  const ema50s = emaSeries(closes, 50);
  const below = (z) => z.top < close * 1.002 && z.top > close * 0.82;
  const nearestBelow = (zones) => zones.filter(below).sort((a, b) => b.top - a.top).slice(0, MAX_ZONES);

  return {
    structure: trend,
    lastEvent: lastEvent ? { type: lastEvent.type, dir: lastEvent.dir, level: lastEvent.level, t: lastEvent.t, barsAgo: n - 1 - lastEvent.i } : null,
    events: events.slice(-6).map((e) => ({ type: e.type, dir: e.dir, level: e.level, t: e.t })),
    orderBlocks: nearestBelow(orderBlocks),
    fvgs: nearestBelow(fvgs),
    sweep,
    dealingRange,
    swingLow: recentLows ? recentLows.price : null,
    swingHigh: recentHighs ? recentHighs.price : null,
    rsi14: rsi(closes, 14),
    ema50: ema50s[n - 1],
    atr14: atr(candles, 14),
    close,
  };
}

/** Compact 0..100 structure score from SMC features (null when unknown). */
export function smcScore(f) {
  if (!f) return null;
  let s = f.structure === 'BULLISH' ? 72 : f.structure === 'BEARISH' ? 28 : 50;
  if (f.lastEvent?.type === 'CHOCH' && f.lastEvent.dir === 'UP' && f.lastEvent.barsAgo <= 36) s += 10;
  if (f.lastEvent?.type === 'CHOCH' && f.lastEvent.dir === 'DOWN' && f.lastEvent.barsAgo <= 36) s -= 10;
  if (f.sweep && f.sweep.barsAgo <= 12) s += 8;
  if (f.structure === 'BULLISH' && isNum(f.dealingRange?.position) && f.dealingRange.position < 0.5) s += 5;
  if (f.orderBlocks.length || f.fvgs.length) s += 4;
  return Math.max(0, Math.min(100, s));
}
