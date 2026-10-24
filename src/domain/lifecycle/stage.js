/**
 * Lifecycle stage of a candidate (CRI v0.5.8 stage model, extended with DECLINE):
 * DECLINE → BASE → BUILDING → ACCELERATION → PRE_EXPANSION → EXPANSION → POST_EXPANSION
 * The classifier is shared by live candidates and historical reference windows.
 */
import { isNum } from '../shared/math.js';
import { dailyFeatures } from '../features/daily.js';

export const STAGES = ['DECLINE', 'BASE', 'BUILDING', 'ACCELERATION', 'PRE_EXPANSION', 'EXPANSION', 'POST_EXPANSION'];

export const STAGE_LABELS = {
  DECLINE: 'Declin',
  BASE: 'Bază',
  BUILDING: 'Construcție',
  ACCELERATION: 'Accelerare',
  PRE_EXPANSION: 'Pre-expansiune',
  EXPANSION: 'Expansiune',
  POST_EXPANSION: 'Post-expansiune',
  UNKNOWN: 'Necunoscut',
};

const between = (x, lo, hi) => isNum(x) && x >= lo && x <= hi;

/**
 * Stage from daily features. `athChangePct` (aggregator) is optional context.
 * Returns { stage, reasons[] } — reasons make the classification auditable.
 */
export function stageFromDaily(f, { athChangePct = null } = {}) {
  if (!f) return { stage: 'UNKNOWN', reasons: ['date 1D insuficiente'] };
  const r = [];
  const c7 = f.change7;
  const c30 = f.change30;

  if ((isNum(c7) && c7 >= 80) || (isNum(c30) && c30 >= 150 && isNum(f.dd30) && f.dd30 > -25)) {
    r.push(`mișcare deja verticală (7z ${fmt(c7)}%, 30z ${fmt(c30)}%)`);
    return { stage: 'EXPANSION', reasons: r };
  }
  if (isNum(f.expansionGainPct) && f.expansionGainPct >= 150 && isNum(f.dd30) && f.dd30 <= -35) {
    r.push(`expansiune recentă (+${fmt(f.expansionGainPct)}%) urmată de retragere ${fmt(f.dd30)}%`);
    return { stage: 'POST_EXPANSION', reasons: r };
  }
  const coiled = isNum(f.compression) && f.compression <= 0.9;
  const volUp = isNum(f.volAccel) && f.volAccel >= 1.3;
  if (isNum(f.rangePos30) && f.rangePos30 >= 0.72 && coiled && volUp && f.higherLows >= 2 && between(c7, -6, 40) && f.aboveEma20 !== false) {
    r.push('preț în treimea superioară a range-ului', 'volatilitate comprimată', `volum în creștere (x${fmt(f.volAccel, 2)})`, `${f.higherLows} minime ascendente`);
    return { stage: 'PRE_EXPANSION', reasons: r };
  }
  if (isNum(f.volAccel) && f.volAccel >= 1.5 && f.aboveEma20 === true && between(c7, 10, 80)) {
    r.push(`volum accelerat (x${fmt(f.volAccel, 2)})`, `7z +${fmt(c7)}%`, 'peste EMA20');
    return { stage: 'ACCELERATION', reasons: r };
  }
  if (f.higherLows >= 1 && (f.aboveEma50 === true || (isNum(f.slope30) && f.slope30 > 0)) && isNum(f.rangePos30) && f.rangePos30 >= 0.4) {
    r.push('minime ascendente', f.aboveEma50 ? 'peste EMA50' : 'pantă 30z pozitivă');
    return { stage: 'BUILDING', reasons: r };
  }
  if (isNum(f.slope30) && f.slope30 < -0.6 && f.aboveEma50 === false && isNum(f.rangePos30) && f.rangePos30 < 0.3) {
    r.push(`trend descendent (${fmt(f.slope30, 2)}%/zi)`, 'sub EMA50');
    return { stage: 'DECLINE', reasons: r };
  }
  r.push('consolidare fără direcție clară');
  if (isNum(athChangePct) && athChangePct <= -50) r.push(`la ${fmt(athChangePct)}% de ATH`);
  return { stage: 'BASE', reasons: r };
}

/** Fallback when no candles are available: only aggregator % changes (lower confidence). */
export function stageFromListing(m) {
  const c7 = m.change7d;
  const c30 = m.change30d;
  if ((isNum(c7) && c7 >= 80) || (isNum(c30) && c30 >= 150)) return { stage: 'EXPANSION', reasons: ['proxy: variație 7z/30z extremă'], proxy: true };
  if (isNum(c30) && c30 <= -45 && isNum(m.athChangePct) && m.athChangePct > -60) return { stage: 'POST_EXPANSION', reasons: ['proxy: retragere puternică după maxim recent'], proxy: true };
  if (between(c7, 10, 80) && isNum(c30) && c30 > 0) return { stage: 'ACCELERATION', reasons: ['proxy: momentum pozitiv 7z și 30z'], proxy: true };
  if (between(c7, -5, 10) && between(c30, 0, 60)) return { stage: 'BUILDING', reasons: ['proxy: 30z pozitiv, 7z stabil'], proxy: true };
  if (isNum(c30) && c30 < -25) return { stage: 'DECLINE', reasons: ['proxy: 30z negativ'], proxy: true };
  if (!isNum(c7) && !isNum(c30)) return { stage: 'UNKNOWN', reasons: ['fără date'], proxy: true };
  return { stage: 'BASE', reasons: ['proxy: lateral'], proxy: true };
}

/**
 * Stage sequence over the last `days` sessions, computed on trailing windows (point-in-time):
 * the stage at day d only uses candles up to d. Used for sequence alignment with references.
 */
export function stageSequence(candles, days = 30, minBars = 35) {
  const out = [];
  if (!Array.isArray(candles) || candles.length < minBars) return out;
  const start = Math.max(minBars, candles.length - days);
  for (let end = start; end <= candles.length; end += 1) {
    const f = dailyFeatures(candles.slice(0, end));
    out.push(stageFromDaily(f).stage);
  }
  return out;
}

export const stageIndex = (s) => STAGES.indexOf(s);

function fmt(x, d = 0) {
  return isNum(x) ? x.toFixed(d) : '?';
}
