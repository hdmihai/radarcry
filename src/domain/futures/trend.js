/**
 * FUTURES RADAR · block 1 — 1D TREND (25 points of 100).
 *
 * The daily timeframe decides *direction and permission*: the attachment's rule is that a 1D
 * STRONG BEAR removes LONG from the table entirely, no matter how good the 4H setup looks. This
 * module turns daily candles into a regime label plus the 0..100 sub-score for the 25-point block.
 */
import { clamp, isNum, round } from '../shared/math.js';
import { emaSeries, higherLowsCount, pivots, rsi } from '../features/indicators.js';

export const TREND = {
  STRONG_BULL: 'STRONG_BULL',
  BULL: 'BULL',
  NEUTRAL: 'NEUTRAL',
  BEAR: 'BEAR',
  STRONG_BEAR: 'STRONG_BEAR',
  UNKNOWN: 'UNKNOWN',
};

export const TREND_LABEL_RO = {
  STRONG_BULL: 'trend puternic ascendent',
  BULL: 'trend ascendent',
  NEUTRAL: 'lateral / indecis',
  BEAR: 'trend descendent',
  STRONG_BEAR: 'trend puternic descendent',
  UNKNOWN: 'necunoscut',
};

/**
 * @param {{t:number,o:number,h:number,l:number,c:number,v:number|null}[]} candles  1D, oldest → newest
 * @returns {null|{regime:string, score:number, close:number, ema20:number|null, ema50:number|null,
 *   ema200:number|null, rsi14:number|null, slopePct20:number|null, structure:string, higherLows:number,
 *   distToEma50Pct:number|null, reasons:string[], blocksLong:boolean, blocksShort:boolean}}
 */
export function dailyTrend(candles) {
  if (!Array.isArray(candles) || candles.length < 30) return null;
  const n = candles.length;
  const closes = candles.map((k) => k.c);
  const close = closes[n - 1];
  const e20 = emaSeries(closes, 20)[n - 1];
  const e50 = closes.length >= 50 ? emaSeries(closes, 50)[n - 1] : null;
  const e200 = closes.length >= 200 ? emaSeries(closes, 200)[n - 1] : null;
  const r = rsi(closes, 14);

  // Slope of the 20-day EMA in % per day — "is the mean itself moving?"
  const e20series = emaSeries(closes, 20);
  const prev = e20series[n - 6];
  const slopePct20 = isNum(e20) && isNum(prev) && prev > 0 ? ((e20 / prev) ** (1 / 5) - 1) * 100 : null;

  const { highs, lows } = pivots(candles.slice(-90), 3, 3);
  const hl = higherLowsCount(lows, 4);
  const hh = higherLowsCount(highs, 4);
  /*
   * A judgement needs pivots to judge. With fewer than three confirmed swings on each side — a very
   * smooth advance, a freshly listed token, a long flat stretch — the swing structure is UNKNOWN,
   * not descending: scoring it as LH_LL would turn the cleanest uptrend in the universe into a
   * broken one. Unknown contributes nothing here, exactly as everywhere else in the project.
   */
  const enoughPivots = lows.length >= 3 && highs.length >= 3;
  const structure = !enoughPivots ? 'UNKNOWN'
    : hl >= 2 && hh >= 2 ? 'HH_HL'
      : hl <= 1 && hh <= 1 ? 'LH_LL' : 'MIXED';

  const reasons = [];
  let points = 50; // neutral start: unknown is not bearish

  const above20 = isNum(e20) ? close > e20 : null;
  const above50 = isNum(e50) ? close > e50 : null;
  const above200 = isNum(e200) ? close > e200 : null;
  const aligned = isNum(e20) && isNum(e50) ? e20 > e50 : null;

  if (above20 === true) { points += 8; reasons.push('preț peste EMA20 (1D)'); }
  if (above20 === false) { points -= 8; reasons.push('preț sub EMA20 (1D)'); }
  if (above50 === true) { points += 10; reasons.push('preț peste EMA50 (1D)'); }
  if (above50 === false) { points -= 10; reasons.push('preț sub EMA50 (1D)'); }
  if (above200 === true) { points += 8; reasons.push('preț peste EMA200 (1D)'); }
  if (above200 === false) { points -= 6; reasons.push('preț sub EMA200 (1D)'); }
  if (aligned === true) { points += 6; reasons.push('EMA20 > EMA50 (structură de trend)'); }
  if (aligned === false) { points -= 6; reasons.push('EMA20 < EMA50'); }
  if (structure === 'HH_HL') { points += 10; reasons.push('maxime și minime crescătoare'); }
  if (structure === 'LH_LL') { points -= 10; reasons.push('maxime și minime descrescătoare'); }
  if (isNum(slopePct20)) {
    if (slopePct20 > 0.5) { points += 6; reasons.push(`media mobilă urcă ${round(slopePct20, 2)}%/zi`); }
    else if (slopePct20 < -0.5) { points -= 6; reasons.push(`media mobilă scade ${round(slopePct20, 2)}%/zi`); }
  }
  if (isNum(r)) {
    if (r >= 70) reasons.push(`RSI 1D ${round(r, 0)} — extins`);
    else if (r <= 30) reasons.push(`RSI 1D ${round(r, 0)} — vândut excesiv`);
  }

  const score = clamp(points, 0, 100);

  // Regime labels are deliberately conservative: STRONG only when the whole stack agrees.
  let regime = TREND.NEUTRAL;
  const bullStack = above20 === true && above50 === true && aligned === true;
  const bearStack = above20 === false && above50 === false && aligned === false;
  if (bullStack && structure !== 'LH_LL' && structure !== 'MIXED' && (above200 !== false)) regime = TREND.STRONG_BULL;
  else if (above50 === true && score >= 58) regime = TREND.BULL;
  else if (bearStack && structure !== 'HH_HL' && structure !== 'MIXED') regime = TREND.STRONG_BEAR;
  else if (above50 === false && score <= 42) regime = TREND.BEAR;

  return {
    regime,
    score,
    close,
    ema20: isNum(e20) ? e20 : null,
    ema50: isNum(e50) ? e50 : null,
    ema200: isNum(e200) ? e200 : null,
    rsi14: isNum(r) ? round(r, 1) : null,
    slopePct20: isNum(slopePct20) ? round(slopePct20, 3) : null,
    structure,
    higherLows: hl,
    higherHighs: hh,
    distToEma50Pct: isNum(e50) && e50 > 0 ? round((close / e50 - 1) * 100, 2) : null,
    reasons,
    // The attachment's hard permission rule.
    blocksLong: regime === TREND.STRONG_BEAR,
    blocksShort: regime === TREND.STRONG_BULL,
    bars: n,
  };
}
