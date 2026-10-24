/**
 * Technical indicators on OHLCV candles. Candles: { t, o, h, l, c, v } (v = quote volume, USD/USDT).
 * Every function is pure and only looks at data up to the last candle it receives (no look-ahead).
 */
import { isNum, mean, stdev } from '../shared/math.js';

/** Exponential moving average series (same length as input, null until seeded). */
export function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i];
  let e = seed / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i += 1) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

export const lastEma = (values, period) => {
  const s = emaSeries(values, period);
  return s[s.length - 1] ?? null;
};

/** Wilder RSI on closes. */
export function rsi(closes, period = 14) {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Wilder ATR. Returns null when there are not enough candles. */
export function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const p = candles[i - 1].c;
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p), Math.abs(c.l - p)));
  }
  let a = mean(trs.slice(0, period));
  for (let i = period; i < trs.length; i += 1) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

/** Log returns of a close series. */
export function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i] > 0 && closes[i - 1] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

/**
 * Volatility compression from closes only (works for exchange OHLC and for aggregator close series):
 * stdev(returns of last `short`) / stdev(returns of last `long`). < 1 = coiling, > 1 = expanding.
 */
export function compressionRatio(closes, short = 7, long = 30) {
  if (closes.length < long + 1) return null;
  const r = logReturns(closes.slice(-(long + 1)));
  const sLong = stdev(r);
  const sShort = stdev(r.slice(-short));
  if (!isNum(sLong) || !isNum(sShort) || sLong === 0) return null;
  return sShort / sLong;
}

/**
 * Confirmed fractal pivots (left/right bars). The last `right` candles can never be pivots,
 * which keeps the detection free of look-ahead.
 */
export function pivots(candles, left = 3, right = 3) {
  const highs = [];
  const lows = [];
  for (let i = left; i < candles.length - right; i += 1) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j === i) continue;
      if (candles[j].h >= c.h) isHigh = false;
      if (candles[j].l <= c.l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ i, t: c.t, price: c.h });
    if (isLow) lows.push({ i, t: c.t, price: c.l });
  }
  return { highs, lows };
}

/** Count of successive higher pivot lows among the most recent `lookback` pivots. */
export function higherLowsCount(lows, lookback = 4) {
  const recent = lows.slice(-lookback);
  let count = 0;
  for (let i = 1; i < recent.length; i += 1) if (recent[i].price > recent[i - 1].price) count += 1;
  return count;
}
