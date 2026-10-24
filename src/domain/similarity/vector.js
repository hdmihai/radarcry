/**
 * Pattern fingerprint ("DNA") shared by live candidates and LAB/BTW/AGT reference windows.
 * Every feature is mapped onto 0..100 with a FIXED transform (no fitting on the current universe),
 * so fingerprints stay comparable across runs and across time.
 *
 * Two families, reported separately and blended:
 *  - dna   — what KIND of token it is (size, float, concentration, venues, chain, reset, age, turnover)
 *  - phase — WHERE it is in its cycle compared with the reference's last weeks before ignition
 * The measured LAB/BTW/AGT windows show a quiet base right before ignition, so DNA carries most of
 * the weight and timing is judged mainly by the structure/derivatives domains.
 */
import { band, clamp, isNum, log10 } from '../shared/math.js';

/** @type {{key:string,label:string,weight:number,group:'dna'|'phase',map:(r:any)=>number|null, raw:(r:any)=>any}[]} */
export const FEATURES = [
  { key: 'size', label: 'Market cap', group: 'dna', weight: 1.0, raw: (r) => r.mcapUsd, map: (r) => band(log10(r.mcapUsd), 6.5, 9.0) },
  { key: 'float', label: 'Float circulant', group: 'dna', weight: 1.2, raw: (r) => r.floatRatio, map: (r) => band(r.floatRatio, 1.0, 0.05) },
  { key: 'concentration', label: 'Concentrare top 10', group: 'dna', weight: 0.9, raw: (r) => r.top10Pct, map: (r) => (isNum(r.top10Pct) ? clamp(r.top10Pct) : null) },
  { key: 'perps', label: 'Perpetual pe venue-uri', group: 'dna', weight: 1.0, raw: (r) => r.perpVenues, map: (r) => band(r.perpVenues, 0, 3) },
  // Binary traits use soft levels: absence is a difference, not a disqualification.
  { key: 'bnbChain', label: 'BNB Chain', group: 'dna', weight: 0.6, raw: (r) => r.chain, map: (r) => (r.chain ? (r.chain === 'bsc' ? 100 : r.chain === 'native' ? 25 : 45) : null) },
  { key: 'alpha', label: 'Binance Alpha', group: 'dna', weight: 0.8, raw: (r) => r.alphaListed, map: (r) => (r.alphaListed === true ? 100 : r.alphaListed === false ? 35 : null) },
  { key: 'reset', label: 'Distanță de ATH', group: 'dna', weight: 0.9, raw: (r) => r.athChangePct, map: (r) => band(r.athChangePct, 0, -95) },
  { key: 'age', label: 'Vechime listare', group: 'dna', weight: 0.6, raw: (r) => r.ageDays, map: (r) => band(log10(r.ageDays), Math.log10(14), Math.log10(900)) },
  { key: 'turnover', label: 'Turnover volum/MC', group: 'dna', weight: 0.7, raw: (r) => r.turnover, map: (r) => band(log10(r.turnover), -2.5, 0) },
  { key: 'volAccel', label: 'Accelerare volum', group: 'phase', weight: 0.4, raw: (r) => r.volAccel, map: (r) => band(r.volAccel, 0.5, 3.0) },
  { key: 'trend30', label: 'Pantă 30z', group: 'phase', weight: 0.4, raw: (r) => r.slope30, map: (r) => band(r.slope30, -1.5, 2.0) },
  { key: 'trendQuality', label: 'Calitate trend (R²)', group: 'phase', weight: 0.2, raw: (r) => r.r2_30, map: (r) => (isNum(r.r2_30) && isNum(r.slope30) ? clamp(r.r2_30 * 100 * (r.slope30 >= 0 ? 1 : 0.4)) : null) },
  { key: 'rangePos', label: 'Poziție în range 30z', group: 'phase', weight: 0.3, raw: (r) => r.rangePos30, map: (r) => (isNum(r.rangePos30) ? clamp(r.rangePos30 * 100) : null) },
  { key: 'compression', label: 'Compresie volatilitate', group: 'phase', weight: 0.3, raw: (r) => r.compression, map: (r) => band(r.compression, 1.6, 0.4) },
  { key: 'change30', label: 'Variație 30z', group: 'phase', weight: 0.4, raw: (r) => r.change30, map: (r) => band(r.change30, -60, 120) },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

/** raw fingerprint (natural units) → normalised vector (0..100 or null per feature). */
export function toVector(raw) {
  const v = {};
  for (const f of FEATURES) {
    const x = f.map(raw ?? {});
    v[f.key] = isNum(x) ? Math.round(x * 10) / 10 : null;
  }
  return v;
}

export function rawView(raw) {
  const out = {};
  for (const f of FEATURES) out[f.key] = f.raw(raw ?? {}) ?? null;
  return out;
}
