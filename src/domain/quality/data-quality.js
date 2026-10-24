/**
 * DATA QUALITY ENGINE — the rule that keeps the whole project honest: every number that reaches a
 * score carries its source, its timestamp, its age and a quality grade, and **UNKNOWN is never
 * treated as bearish**. A missing factor is removed from the weighting and lowers Confidence; it is
 * never silently scored as zero, because "we could not measure it" and "it is bad" are different
 * facts and only one of them is in the data.
 *
 * Grades:
 *   HIGH    — fresh, from a primary source (exchange, chain, official API)
 *   MEDIUM  — fresh but derived / aggregated, or a secondary source
 *   LOW     — present but weak: a single thin source, or a value we could not cross-check
 *   STALE   — real data, but older than the factor's useful horizon
 *   UNKNOWN — absent (provider failed, no key, nothing listed, not applicable)
 *
 * The grade is attached by whoever measured the number, because only that caller knows which
 * source it came from and how old it is; this module decides what a grade is *worth*. Staleness
 * is therefore observed upstream (universe.js flags a quote older than six hours against the run
 * clock it is given) and applied here as the STALE grade, never read from a clock in this layer:
 * nothing in the domain may call Date.now(), or a replay of the same inputs would not reproduce
 * the same scores. That rule is enforced by test/architecture.test.js.
 */
import { clamp, isNum, round } from '../shared/math.js';

export const QUALITY = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', STALE: 'STALE', UNKNOWN: 'UNKNOWN' };

/** Confidence multiplier of each grade — how much a factor of this grade is allowed to count. */
export const QUALITY_WEIGHT = { HIGH: 1, MEDIUM: 0.85, LOW: 0.6, STALE: 0.4, UNKNOWN: 0 };

export const QUALITY_LABEL_RO = {
  HIGH: 'sursă primară, proaspătă',
  MEDIUM: 'sursă derivată sau secundară',
  LOW: 'o singură sursă subțire',
  STALE: 'date reale, dar învechite',
  UNKNOWN: 'lipsește (nu „negativ”)',
};

/**
 * Score one weighted factor set with redistribution. Factors whose quality is UNKNOWN are dropped
 * from the denominator (their weight is redistributed over what *is* known), and the share of weight
 * that was measurable becomes the Confidence of the result.
 *
 * @param {{key:string, label:string, weight:number, score:number|null, quality?:string,
 *          evidence?:string|null, sources?:string[]}[]} factors   score = 0..100 or null
 * @param {{minCoverage?:number}} [o]
 * @returns {{score:number|null, confidence:number, coverage:number, usedWeight:number, totalWeight:number,
 *            factors:any[], missing:any[], redistributed:boolean}}
 */
export function weightedScore(factors, { minCoverage = 0 } = {}) {
  const totalWeight = factors.reduce((s, f) => s + (f.weight ?? 0), 0);
  const known = [];
  const missing = [];
  for (const f of factors) {
    const q = f.quality ?? (f.score === null || f.score === undefined ? QUALITY.UNKNOWN : QUALITY.MEDIUM);
    if (q === QUALITY.UNKNOWN || f.score === null || f.score === undefined) {
      missing.push({ key: f.key, label: f.label, weight: f.weight, reason: f.evidence ?? 'nemăsurat în această rulare' });
      continue;
    }
    known.push({ ...f, quality: q, qualityWeight: QUALITY_WEIGHT[q] ?? 0.6 });
  }
  const usedWeight = known.reduce((s, f) => s + f.weight, 0);
  if (!usedWeight) {
    return { score: null, confidence: 0, coverage: 0, usedWeight: 0, totalWeight, factors: [], missing, redistributed: missing.length > 0 };
  }
  // Redistribute: each known factor keeps its share of the weight that actually arrived.
  let acc = 0;
  const out = [];
  for (const f of known) {
    const effective = f.weight / usedWeight;
    acc += clamp(f.score, 0, 100) * effective;
    out.push({
      key: f.key,
      label: f.label,
      weight: f.weight,
      effectiveWeight: round(effective * 100, 1),
      score: round(clamp(f.score, 0, 100), 1),
      points: round(clamp(f.score, 0, 100) * effective, 2),
      quality: f.quality,
      evidence: f.evidence ?? null,
      sources: f.sources ?? [],
    });
  }
  const coverage = usedWeight / (totalWeight || 1);
  // Confidence punishes both missing factors and weak grades of the factors we did get.
  const gradeFactor = known.reduce((s, f) => s + f.weight * f.qualityWeight, 0) / usedWeight;
  const confidence = clamp(Math.round(coverage * gradeFactor * 100), 0, 100);
  return {
    score: coverage >= minCoverage ? round(acc, 1) : null,
    confidence,
    coverage: round(coverage, 3),
    usedWeight: round(usedWeight, 3),
    totalWeight: round(totalWeight, 3),
    factors: out.sort((a, b) => b.points - a.points),
    missing,
    redistributed: missing.length > 0,
  };
}

/** Human label for a confidence number. */
export function confidenceLabel(c) {
  if (!isNum(c)) return 'NECUNOSCUT';
  if (c >= 85) return 'ÎNALTĂ';
  if (c >= 70) return 'BUNĂ';
  if (c >= 50) return 'MEDIE';
  if (c >= 30) return 'SCĂZUTĂ';
  return 'INSUFICIENTĂ';
}

/**
 * Aggregate coverage of a whole snapshot: which provider families answered, which did not, and
 * what that means for how much of the dashboard can be trusted this run.
 * @param {{key:string, label:string, required?:boolean, ok:boolean, status?:string, message?:string}[]} sources
 */
export function coverageReport(sources) {
  const total = sources.length || 1;
  const ok = sources.filter((s) => s.ok);
  const requiredMissing = sources.filter((s) => s.required && !s.ok);
  return {
    sources: sources.map((s) => ({ ...s, quality: s.ok ? QUALITY.HIGH : QUALITY.UNKNOWN })),
    okCount: ok.length,
    total: sources.length,
    coverage: round(ok.length / total, 3),
    degraded: requiredMissing.length > 0,
    requiredMissing: requiredMissing.map((s) => ({ key: s.key, label: s.label, status: s.status ?? null, message: s.message ?? null })),
  };
}
