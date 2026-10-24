/**
 * FUTURES RADAR · block 3 — POSITIONING / DERIVATIVES (25 points of 100).
 *
 * Funding and open interest answer a question price alone cannot: *who is already in the trade and
 * how much does it cost them to stay*. The thresholds and the four price/OI regimes below are taken
 * from the technical solution verbatim.
 *
 * Funding per 8h:
 *   +0.001 %  healthy / neutral
 *   +0.015 %  crowded longs — the move is being paid for
 *   +0.05  %  danger — long squeeze fuel
 *   −0.03  %  crowded shorts — short squeeze fuel (bullish for a LONG thesis)
 *
 * Price / OI regimes:
 *   price ↑ OI ↑  long buildup       — real money entering, healthiest continuation
 *   price ↓ OI ↑  short buildup      — shorts pressing; squeeze risk both ways
 *   price ↑ OI ↓  short covering     — a bounce paid for by closing shorts, not by new demand
 *   price ↓ OI ↓  long liquidation   — positions being flushed; the cleanest reset
 */
import { clamp, isNum, round } from '../shared/math.js';

export const FUNDING = {
  HEALTHY: 0.001,
  CROWDED_LONG: 0.015,
  DANGER_LONG: 0.05,
  CROWDED_SHORT: -0.03,
};

export const FUNDING_STATE = {
  CROWDED_SHORTS: 'CROWDED_SHORTS',
  NEUTRAL: 'NEUTRAL',
  HEALTHY: 'HEALTHY',
  CROWDED_LONGS: 'CROWDED_LONGS',
  DANGER: 'DANGER',
  UNKNOWN: 'UNKNOWN',
};

export const FUNDING_LABEL_RO = {
  CROWDED_SHORTS: 'short-uri aglomerate (combustibil pentru squeeze în sus)',
  NEUTRAL: 'funding neutru',
  HEALTHY: 'funding sănătos, pozitiv ușor',
  CROWDED_LONGS: 'long-uri aglomerate — mișcarea este plătită',
  DANGER: 'funding periculos — risc de long squeeze',
  UNKNOWN: 'funding necunoscut',
};

export const OI_REGIME = {
  LONG_BUILDUP: 'LONG_BUILDUP',
  SHORT_BUILDUP: 'SHORT_BUILDUP',
  SHORT_COVERING: 'SHORT_COVERING',
  LONG_LIQUIDATION: 'LONG_LIQUIDATION',
  UNKNOWN: 'UNKNOWN',
};

export const OI_LABEL_RO = {
  LONG_BUILDUP: 'preț ↑ / OI ↑ — acumulare de long-uri noi',
  SHORT_BUILDUP: 'preț ↓ / OI ↑ — short-uri noi apasă prețul',
  SHORT_COVERING: 'preț ↑ / OI ↓ — urcare din închideri de short, nu din cerere nouă',
  LONG_LIQUIDATION: 'preț ↓ / OI ↓ — lichidare de long-uri, resetare',
  UNKNOWN: 'regim OI necunoscut',
};

/** Classify an 8h-normalised funding rate expressed in percent. */
export function fundingState(pct8h) {
  if (!isNum(pct8h)) return FUNDING_STATE.UNKNOWN;
  if (pct8h >= FUNDING.DANGER_LONG) return FUNDING_STATE.DANGER;
  if (pct8h >= FUNDING.CROWDED_LONG) return FUNDING_STATE.CROWDED_LONGS;
  if (pct8h <= FUNDING.CROWDED_SHORT) return FUNDING_STATE.CROWDED_SHORTS;
  if (pct8h >= FUNDING.HEALTHY) return FUNDING_STATE.HEALTHY;
  return FUNDING_STATE.NEUTRAL;
}

/** Classify the price/OI pair. Thresholds are deliberately wide enough to ignore noise. */
export function oiRegime(pricePct, oiPct, { priceEps = 1, oiEps = 2 } = {}) {
  if (!isNum(pricePct) || !isNum(oiPct)) return OI_REGIME.UNKNOWN;
  const up = pricePct > priceEps;
  const down = pricePct < -priceEps;
  const oiUp = oiPct > oiEps;
  const oiDown = oiPct < -oiEps;
  if (up && oiUp) return OI_REGIME.LONG_BUILDUP;
  if (down && oiUp) return OI_REGIME.SHORT_BUILDUP;
  if (up && oiDown) return OI_REGIME.SHORT_COVERING;
  if (down && oiDown) return OI_REGIME.LONG_LIQUIDATION;
  return OI_REGIME.UNKNOWN;
}

/**
 * @param {{fundingPct8h:number|null, fundingByVenue?:Record<string, number|null>,
 *   oiUsd:number|null, oiChangePct24h:number|null, pricePct24h:number|null,
 *   oiToMcap:number|null, longShortRatio?:number|null, liqLong24hUsd?:number|null, liqShort24hUsd?:number|null,
 *   venues?:number}} d
 * @returns {{score:number, funding:string, fundingPct8h:number|null, fundingSpreadPct:number|null,
 *   regime:string, reasons:string[], capsAtB:boolean, oiToMcap:number|null}}
 */
export function positioning(d) {
  const reasons = [];
  let points = 50;
  const f = isNum(d.fundingPct8h) ? d.fundingPct8h : null;
  const state = fundingState(f);
  const regime = oiRegime(d.pricePct24h, d.oiChangePct24h);

  switch (state) {
    case FUNDING_STATE.CROWDED_SHORTS:
      points += 18;
      reasons.push(`funding ${round(f, 4)}%/8h — short-uri aglomerate, combustibil pentru squeeze`);
      break;
    case FUNDING_STATE.HEALTHY:
      points += 10;
      reasons.push(`funding ${round(f, 4)}%/8h — sănătos`);
      break;
    case FUNDING_STATE.NEUTRAL:
      points += 4;
      reasons.push(`funding ${round(f, 4)}%/8h — neutru`);
      break;
    case FUNDING_STATE.CROWDED_LONGS:
      points -= 14;
      reasons.push(`funding ${round(f, 4)}%/8h — long-uri aglomerate (prag 0.015%)`);
      break;
    case FUNDING_STATE.DANGER:
      points -= 28;
      reasons.push(`funding ${round(f, 4)}%/8h — zona de pericol (prag 0.05%)`);
      break;
    default:
      reasons.push('funding indisponibil — factor scos din ponderare, nu penalizat');
  }

  switch (regime) {
    case OI_REGIME.LONG_BUILDUP:
      points += 14;
      reasons.push(OI_LABEL_RO.LONG_BUILDUP);
      break;
    case OI_REGIME.SHORT_BUILDUP:
      points += 6;
      reasons.push(OI_LABEL_RO.SHORT_BUILDUP);
      break;
    case OI_REGIME.SHORT_COVERING:
      points -= 10;
      reasons.push(OI_LABEL_RO.SHORT_COVERING);
      break;
    case OI_REGIME.LONG_LIQUIDATION:
      points -= 4;
      reasons.push(OI_LABEL_RO.LONG_LIQUIDATION);
      break;
    default:
      break;
  }

  // Open interest relative to market cap: leverage concentration.
  if (isNum(d.oiToMcap)) {
    if (d.oiToMcap > 0.25) { points -= 12; reasons.push(`OI = ${Math.round(d.oiToMcap * 100)}% din capitalizare — levier concentrat`); }
    else if (d.oiToMcap > 0.1) { points -= 4; reasons.push(`OI = ${Math.round(d.oiToMcap * 100)}% din capitalizare`); }
    else if (d.oiToMcap > 0.02) { points += 4; reasons.push(`OI sănătos (${Math.round(d.oiToMcap * 1000) / 10}% din capitalizare)`); }
  }

  // Disagreement between venues is itself information (a single venue can be manipulated).
  const vals = Object.values(d.fundingByVenue ?? {}).filter(isNum);
  const spread = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null;
  if (isNum(spread) && spread > 0.03) { points -= 6; reasons.push(`funding diferă cu ${round(spread, 4)}% între burse — date fragile`); }

  if (isNum(d.longShortRatio)) {
    if (d.longShortRatio > 2.2) { points -= 8; reasons.push(`raport long/short ${round(d.longShortRatio, 2)} — poziționare într-o singură direcție`); }
    else if (d.longShortRatio < 0.8) { points += 6; reasons.push(`raport long/short ${round(d.longShortRatio, 2)} — short-uri dominante`); }
  }

  if (isNum(d.liqLong24hUsd) && isNum(d.liqShort24hUsd) && d.liqLong24hUsd + d.liqShort24hUsd > 0) {
    const shortShare = d.liqShort24hUsd / (d.liqLong24hUsd + d.liqShort24hUsd);
    if (shortShare > 0.7) { points += 6; reasons.push('lichidările din 24h sunt predominant de short — presiune în sus'); }
    if (shortShare < 0.3) { points -= 4; reasons.push('lichidările din 24h sunt predominant de long'); }
  }

  if ((d.venues ?? 0) === 0) reasons.push('fără contracte perpetue listate — blocul futures nu se aplică');

  return {
    score: clamp(points, 0, 100),
    funding: state,
    fundingPct8h: isNum(f) ? round(f, 5) : null,
    fundingSpreadPct: isNum(spread) ? round(spread, 5) : null,
    regime,
    oiToMcap: isNum(d.oiToMcap) ? round(d.oiToMcap, 4) : null,
    reasons,
    // The attachment's hard cap: extreme funding can never produce an A-grade setup.
    capsAtB: state === FUNDING_STATE.DANGER,
  };
}

/** Normalise a venue funding rate to percent per 8 hours. */
export function toPct8h(rate, { intervalHours = 8, alreadyPercent = false } = {}) {
  if (!isNum(rate)) return null;
  const pct = alreadyPercent ? rate : rate * 100;
  const h = isNum(intervalHours) && intervalHours > 0 ? intervalHours : 8;
  return pct * (8 / h);
}
