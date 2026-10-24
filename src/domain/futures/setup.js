/**
 * FUTURES RADAR · block 2 — 4H STRUCTURE (30 points of 100, the heaviest block).
 *
 * The 4H timeframe decides *the entry*: where the structure broke, which demand zone is still
 * unmitigated, whether liquidity below was swept, and how far price has already run from the zone.
 * The attachment's "chase" rule lives here: more than 8 % above the entry zone caps the grade,
 * because a correct idea entered late is a different trade.
 */
import { clamp, isNum, round } from '../shared/math.js';
import { smcFeatures } from '../features/smc.js';

export const CHASE_LIMIT_PCT = 8;

/** The closest a stop may sit to the entry, in 4H ATRs: anything nearer is inside ordinary noise. */
export const MIN_STOP_ATR = 1;

/**
 * @param {{t:number,o:number,h:number,l:number,c:number,v:number|null}[]} candles  4H, oldest → newest
 * @returns {null|{score:number, smc:any, entryZone:{top:number,bottom:number,kind:string}|null,
 *   chasePct:number|null, chasing:boolean, invalidation:number|null, reasons:string[]}}
 */
export function fourHourSetup(candles) {
  const smc = smcFeatures(candles);
  if (!smc) return null;
  const close = smc.close;
  const reasons = [];
  let points = 50;

  if (smc.structure === 'BULLISH') { points += 14; reasons.push('structură 4H bullish (BOS în sus)'); }
  else if (smc.structure === 'BEARISH') { points -= 14; reasons.push('structură 4H bearish'); }

  const ev = smc.lastEvent;
  if (ev?.type === 'CHOCH' && ev.dir === 'UP' && ev.barsAgo <= 18) { points += 12; reasons.push(`CHoCH în sus acum ${ev.barsAgo} bare de 4H`); }
  if (ev?.type === 'BOS' && ev.dir === 'UP' && ev.barsAgo <= 12) { points += 8; reasons.push('BOS recent în sus'); }
  if (ev?.type === 'CHOCH' && ev.dir === 'DOWN' && ev.barsAgo <= 18) { points -= 12; reasons.push('CHoCH în jos recent'); }

  if (smc.sweep && smc.sweep.barsAgo <= 10) { points += 10; reasons.push(`lichiditate măturată sub ${round(smc.sweep.level, 6)} și recuperată`); }

  const ob = smc.orderBlocks?.[0] ?? null;
  const fvg = smc.fvgs?.[0] ?? null;
  let entryZone = null;
  if (ob) entryZone = { top: ob.top, bottom: ob.bottom, kind: ob.mitigated ? 'OB_MITIGAT' : 'OB_NEMITIGAT' };
  else if (fvg) entryZone = { top: fvg.top, bottom: fvg.bottom, kind: fvg.partiallyFilled ? 'FVG_PARTIAL' : 'FVG' };
  else if (isNum(smc.swingLow)) entryZone = { top: smc.swingLow * 1.01, bottom: smc.swingLow * 0.985, kind: 'SWING_LOW' };

  if (ob && !ob.mitigated) { points += 8; reasons.push('order block nemitigat sub preț'); }
  else if (ob) { points += 4; reasons.push('order block testat, încă valid'); }
  if (fvg) { points += 4; reasons.push('fair value gap deschis sub preț'); }
  if (!ob && !fvg) { points -= 6; reasons.push('nicio zonă clară de cerere sub preț'); }

  const pos = smc.dealingRange?.position;
  if (isNum(pos)) {
    if (pos <= 0.5) { points += 6; reasons.push(`preț în discount (${Math.round(pos * 100)}% din range)`); }
    else if (pos >= 0.85) { points -= 8; reasons.push(`preț în premium extrem (${Math.round(pos * 100)}% din range)`); }
  }

  // Chase: distance from the top of the entry zone to the current price.
  const chasePct = entryZone && isNum(entryZone.top) && entryZone.top > 0 ? (close / entryZone.top - 1) * 100 : null;
  const chasing = isNum(chasePct) && chasePct > CHASE_LIMIT_PCT;
  if (chasing) reasons.push(`preț la ${round(chasePct, 1)}% peste zona de intrare — intrare târzie`);

  const invalidation = isNum(smc.swingLow) ? smc.swingLow : entryZone ? entryZone.bottom * 0.985 : null;

  return {
    score: clamp(points, 0, 100),
    smc: {
      structure: smc.structure,
      lastEvent: smc.lastEvent,
      events: smc.events,
      orderBlocks: smc.orderBlocks,
      fvgs: smc.fvgs,
      sweep: smc.sweep,
      dealingRange: smc.dealingRange,
      swingLow: smc.swingLow,
      swingHigh: smc.swingHigh,
      rsi14: isNum(smc.rsi14) ? round(smc.rsi14, 1) : null,
      atr14: smc.atr14,
      close,
    },
    entryZone,
    chasePct: isNum(chasePct) ? round(chasePct, 2) : null,
    chasing,
    invalidation,
    reasons,
  };
}

/**
 * Trade levels derived from the 4H setup: entry zone, invalidation and two targets taken from the
 * structure itself (swing high, then the measured move), with the resulting reward/risk.
 * Research output only — the project never places an order anywhere.
 */
export function tradeLevels(setup, trend) {
  if (!setup) return null;
  const close = setup.smc.close;
  const zone = setup.entryZone;
  const entry = zone ? (zone.top + zone.bottom) / 2 : close;
  // The invalidation must always sit below the entry: when the demand zone formed *below* the most
  // recent swing low, the swing low is not an invalidation for this entry, the zone's own floor is.
  const candidates = [setup.invalidation, setup.smc.swingLow, zone ? zone.bottom * 0.985 : null]
    .filter((x) => isNum(x) && x > 0 && x < entry);
  const atr = setup.smc.atr14;
  let stop = candidates.length ? Math.max(...candidates) : null;
  /*
   * Volatility floor. A structural stop closer than one 4H ATR sits inside ordinary noise: the next
   * average candle reaches it without the structure having changed at all. In the first live run a
   * stop 2.7 % under the entry of a token with a 27 % 4H ATR produced a reward/risk of 116, which is
   * a number that describes the stop, not the opportunity. The stop is therefore pushed out to one
   * ATR below the entry, and the levels say so, so that R:R — and the R:R < 2 hard filter that
   * depends on it — is computed against a risk the market can actually respect.
   */
  let stopBasis = isNum(stop) ? 'STRUCTURE' : null;
  if (isNum(stop) && isNum(atr) && atr > 0 && entry - stop < MIN_STOP_ATR * atr) {
    const widened = entry - MIN_STOP_ATR * atr;
    if (widened > 0) {
      stop = widened;
      stopBasis = 'ATR_FLOOR';
    } else {
      stop = null; // one ATR is larger than the price itself: no meaningful long invalidation exists
      stopBasis = null;
    }
  }
  const swingHigh = setup.smc.swingHigh;
  const risk = isNum(stop) && stop > 0 ? entry - stop : null;

  let t1 = isNum(swingHigh) && swingHigh > entry ? swingHigh : isNum(atr) ? entry + 2 * atr : null;
  if (isNum(t1) && isNum(risk) && risk > 0 && t1 - entry < risk) t1 = entry + 1.5 * risk;
  const t2 = isNum(t1) && isNum(risk) && risk > 0 ? entry + Math.max(3 * risk, (t1 - entry) * 1.8) : isNum(atr) ? entry + 4 * atr : null;

  const rr1 = isNum(risk) && risk > 0 && isNum(t1) ? (t1 - entry) / risk : null;
  const rr2 = isNum(risk) && risk > 0 && isNum(t2) ? (t2 - entry) / risk : null;
  return {
    bias: trend?.blocksLong ? 'FĂRĂ LONG' : 'LONG',
    entryZone: zone,
    entry: round(entry, 8),
    stop: isNum(stop) ? round(stop, 8) : null,
    stopBasis,
    target1: isNum(t1) ? round(t1, 8) : null,
    target2: isNum(t2) ? round(t2, 8) : null,
    riskPct: isNum(risk) && entry > 0 ? round((risk / entry) * 100, 2) : null,
    rr1: isNum(rr1) ? round(rr1, 2) : null,
    rr2: isNum(rr2) ? round(rr2, 2) : null,
    atrPct: isNum(atr) && close > 0 ? round((atr / close) * 100, 2) : null,
    note: stopBasis === 'ATR_FLOOR'
      ? 'Nivele de research, derivate din structura 4H. Invalidarea structurală era în interiorul zgomotului, așa că stopul a fost lărgit la 1 ATR(4H) sub intrare. Proiectul nu execută și nu transmite ordine.'
      : 'Nivele de research, derivate din structura 4H. Proiectul nu execută și nu transmite ordine.',
  };
}
