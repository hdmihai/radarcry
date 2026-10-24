/**
 * Daily (1D) feature extraction. The same function runs on exchange candles for live candidates
 * and on CoinGecko close/volume series for historical LAB/BTW/AGT reference windows, so both sides of
 * every similarity comparison are measured with an identical ruler.
 */
import { isNum, linreg, mean, pctChange, sum } from '../shared/math.js';
import { atr, compressionRatio, emaSeries, higherLowsCount, pivots, rsi } from './indicators.js';

/**
 * @param {{t:number,o:number,h:number,l:number,c:number,v:number|null}[]} candles  oldest → newest, 1D
 * @returns {Record<string, number|boolean|null>|null}
 */
export function dailyFeatures(candles) {
  if (!Array.isArray(candles) || candles.length < 20) return null;
  const closes = candles.map((k) => k.c);
  const vols = candles.map((k) => (isNum(k.v) ? k.v : null));
  const n = closes.length;
  const close = closes[n - 1];

  const e20 = emaSeries(closes, 20);
  const e50 = emaSeries(closes, 50);
  const ema20 = e20[n - 1];
  const ema50 = e50[n - 1];

  const win30 = closes.slice(-30);
  const high30 = Math.max(...candles.slice(-30).map((k) => k.h));
  const low30 = Math.min(...candles.slice(-30).map((k) => k.l));
  const rangePos30 = high30 > low30 ? (close - low30) / (high30 - low30) : null;

  // Trend: regression on ln(close) — slope converted to % per day, r² = cleanliness of the trend.
  const reg = linreg(win30.map((c) => (c > 0 ? Math.log(c) : null)));
  const slope30 = isNum(reg.slope) ? (Math.exp(reg.slope) - 1) * 100 : null;

  const hasOhlc = candles.some((k) => k.h !== k.l);
  const atr14 = hasOhlc ? atr(candles, 14) : null;

  const v7 = mean(vols.slice(-7));
  const v30 = mean(vols.slice(-30));
  const volAccel = isNum(v7) && isNum(v30) && v30 > 0 ? v7 / v30 : null;

  // Share of volume printed on up-days over the last 14 sessions (accumulation proxy).
  let upVol = 0;
  let allVol = 0;
  for (let i = Math.max(1, n - 14); i < n; i += 1) {
    const v = vols[i];
    if (!isNum(v)) continue;
    allVol += v;
    if (closes[i] >= closes[i - 1]) upVol += v;
  }
  const upVolRatio = allVol > 0 ? upVol / allVol : null;

  const { lows } = pivots(candles.slice(-60), 2, 2);
  const priorHigh = Math.max(...candles.slice(-31, -1).map((k) => k.h));

  // Largest 14-day forward gain that started inside the last 60 sessions (detects a recent expansion).
  let expansionGainPct = null;
  const start = Math.max(0, n - 60);
  for (let i = start; i < n - 1; i += 1) {
    const fwd = Math.max(...closes.slice(i + 1, Math.min(n, i + 15)));
    const g = pctChange(closes[i], fwd);
    if (isNum(g) && (expansionGainPct === null || g > expansionGainPct)) expansionGainPct = g;
  }

  const maxClose = Math.max(...closes);

  return {
    close,
    bars: n,
    ema20,
    ema50,
    aboveEma20: isNum(ema20) ? close > ema20 : null,
    aboveEma50: isNum(ema50) ? close > ema50 : null,
    emaAligned: isNum(ema20) && isNum(ema50) ? ema20 > ema50 : null,
    rsi14: rsi(closes, 14),
    atrPct14: isNum(atr14) && close > 0 ? (atr14 / close) * 100 : null,
    slope30,
    r2_30: reg.r2,
    high30,
    low30,
    rangePos30,
    dd30: pctChange(high30, close),
    compression: compressionRatio(closes, 7, 30),
    volAccel,
    upVolRatio,
    higherLows: higherLowsCount(lows, 4),
    breakout30: isNum(priorHigh) ? close > priorHigh : null,
    change7: n > 7 ? pctChange(closes[n - 8], close) : null,
    change30: n > 30 ? pctChange(closes[n - 31], close) : null,
    drawdownFromMax: pctChange(maxClose, close),
    expansionGainPct,
    avgVol7: v7,
    totalVol30: sum(vols.slice(-30)),
  };
}
