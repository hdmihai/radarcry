/**
 * Evidence Fusion v3 + calibration (CRI v0.8.0 → v0.9.3, consolidated):
 *  - UNKNOWN domains are excluded and lower coverage, never the score;
 *  - confidence-weighted fusion of the available domains;
 *  - conflicts (strong bullish vs strong bearish domains) are preserved and penalised, not averaged away;
 *  - reliability rewards independent source groups (repeated reporting from one source is not confirmation);
 *  - CRI score = fused × (0.70 + 0.20·confidence + 0.10·coverage) — high scores need complete evidence.
 */
import { clamp, isNum, round } from '../shared/math.js';

export const RESEARCH_STATES = ['STRONGLY_POSITIVE', 'POSITIVE', 'SLIGHTLY_POSITIVE', 'NEUTRAL', 'SLIGHTLY_NEGATIVE', 'NEGATIVE', 'STRONGLY_NEGATIVE', 'UNRESOLVED', 'INSUFFICIENT_DATA'];

/** Source groups: providers that would echo the same underlying data count once. */
const SOURCE_GROUP = {
  coingecko: 'aggregator_cg', coinmarketcap: 'aggregator_cmc', coinpaprika: 'aggregator_cp',
  mexc: 'cex_mexc', gate: 'cex_gate', bitget: 'cex_bitget', okx: 'cex_okx', upbit: 'cex_kr', bithumb: 'cex_kr',
  binance_alpha: 'binance', dexscreener: 'dex', geckoterminal: 'dex_gt', goplus: 'security', defillama: 'defillama',
  arkham: 'wallet_intel', history: 'own_history', reference_library: 'own_model', manual: 'manual',
};

/**
 * @param {Array<{id:string, state:string, score:number|null, confidence:number, sources?:string[]}>} domains
 * @param {Record<string, number>} weights
 */
export function fuse(domains, weights) {
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  const usable = domains.filter((d) => d.state === 'AVAILABLE' && isNum(d.score) && (weights[d.id] ?? 0) > 0);
  const availWeight = usable.reduce((s, d) => s + weights[d.id], 0);
  const coverage = total > 0 ? availWeight / total : 0;
  if (!usable.length || coverage < 0.3) {
    return { fused: null, confidence: 0, coverage: round(coverage, 3), state: 'INSUFFICIENT_DATA', conflict: false, independentSources: 0, reliability: 0, reliabilityBand: 'LOW', contributions: {} };
  }
  let num = 0;
  let den = 0;
  for (const d of usable) {
    const w = weights[d.id] * Math.max(0.05, d.confidence);
    num += w * d.score;
    den += w;
  }
  const fused = num / den;
  const confidence = usable.reduce((s, d) => s + weights[d.id] * d.confidence, 0) / availWeight;

  // Conflict: strongly bullish vs strongly bearish domains with comparable weight.
  const bull = usable.filter((d) => d.score >= 65 && d.confidence >= 0.4).reduce((s, d) => s + weights[d.id], 0);
  const bear = usable.filter((d) => d.score <= 35 && d.confidence >= 0.4).reduce((s, d) => s + weights[d.id], 0);
  const conflict = bull > 0 && bear > 0 && Math.abs(bull - bear) / (bull + bear) < 0.5;

  const groups = new Set();
  for (const d of usable) for (const s of d.sources ?? []) groups.add(SOURCE_GROUP[s] ?? s);
  const independentSources = groups.size;

  let reliability = confidence * coverage * (0.5 + 0.5 * Math.min(1, independentSources / 6));
  if (conflict) reliability *= 0.75;
  reliability = clamp(reliability, 0, 1);

  const contributions = {};
  for (const d of usable) contributions[d.id] = round((weights[d.id] * Math.max(0.05, d.confidence) * d.score) / den, 2);

  return {
    fused: round(fused, 1),
    confidence: round(conflict ? confidence * 0.75 : confidence, 3),
    coverage: round(coverage, 3),
    state: researchState(fused, conflict),
    conflict,
    independentSources,
    reliability: round(reliability, 3),
    reliabilityBand: reliabilityBand(reliability),
    contributions,
  };
}

export function researchState(fused, conflict) {
  if (!isNum(fused)) return 'INSUFFICIENT_DATA';
  const net = (fused - 50) / 50;
  if (conflict && Math.abs(net) < 0.12) return 'UNRESOLVED';
  if (net >= 0.5) return 'STRONGLY_POSITIVE';
  if (net >= 0.25) return 'POSITIVE';
  if (net > 0.05) return 'SLIGHTLY_POSITIVE';
  if (net <= -0.5) return 'STRONGLY_NEGATIVE';
  if (net <= -0.25) return 'NEGATIVE';
  if (net < -0.05) return 'SLIGHTLY_NEGATIVE';
  return 'NEUTRAL';
}

export function reliabilityBand(r) {
  if (!isNum(r) || r < 0.25) return 'LOW';
  if (r < 0.5) return 'MEDIUM';
  if (r < 0.7) return 'HIGH';
  return 'VERY_HIGH';
}

/** CRI research score (0..100) and tier. */
export function criScore(f) {
  if (!isNum(f.fused)) return { cri: null, tier: 'E' };
  // Tier from the published (rounded) value, so 0.7 + 0.2 + 0.1 float noise cannot demote a tier.
  const cri = round(clamp(f.fused * (0.7 + 0.2 * f.confidence + 0.1 * f.coverage) * (f.conflict ? 0.95 : 1)), 1);
  const tier = cri >= 80 ? 'A' : cri >= 70 ? 'B' : cri >= 60 ? 'C' : cri >= 50 ? 'D' : 'E';
  return { cri, tier };
}
