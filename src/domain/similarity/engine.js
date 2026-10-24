/**
 * Historical similarity engine (CRI v0.4.1 + v0.4.5 + v0.7.9 + v0.9.0, consolidated):
 *  - weighted Euclidean distance on fixed-scale fingerprints → Gaussian similarity 0..100;
 *  - UNKNOWN features are skipped (never treated as zero) and lower coverage instead;
 *  - separate DNA (what kind of token) and PHASE (where in the cycle) similarities for transparency;
 *  - order-preserving sequence alignment (LCS) of lifecycle stages, blended with a small weight;
 *  - explainability: per-feature agreement, strongest matches and weakest links.
 */
import { compress, isNum, lcsLength, mean, round } from '../shared/math.js';
import { FEATURES } from './vector.js';

function gaussianSimilarity(a, b, features, sigma) {
  let num = 0;
  let den = 0;
  for (const f of features) {
    const x = a?.[f.key];
    const y = b?.[f.key];
    if (!isNum(x) || !isNum(y)) continue;
    num += f.weight * (x - y) ** 2;
    den += f.weight;
  }
  if (den === 0) return { similarity: null, weight: 0, distance: null };
  const d = Math.sqrt(num / den);
  return { similarity: 100 * Math.exp(-0.5 * (d / sigma) ** 2), weight: den, distance: d };
}

/**
 * @param {Record<string, number|null>} a candidate vector
 * @param {Record<string, number|null>} b reference vector
 * @param {{sigma?:number, minCoverage?:number}} opts
 */
export function compareVectors(a, b, { sigma = 22, minCoverage = 0.4 } = {}) {
  const totalW = FEATURES.reduce((s, f) => s + f.weight, 0);
  const components = FEATURES.map((f) => {
    const x = a?.[f.key];
    const y = b?.[f.key];
    if (!isNum(x) || !isNum(y)) return { key: f.key, label: f.label, group: f.group, a: x ?? null, b: y ?? null, diff: null, agreement: null };
    const diff = x - y;
    return { key: f.key, label: f.label, group: f.group, a: x, b: y, diff: round(diff, 1), agreement: round(100 * Math.exp(-0.5 * (diff / sigma) ** 2), 1) };
  });
  const all = gaussianSimilarity(a, b, FEATURES, sigma);
  const dna = gaussianSimilarity(a, b, FEATURES.filter((f) => f.group === 'dna'), sigma);
  const phase = gaussianSimilarity(a, b, FEATURES.filter((f) => f.group === 'phase'), sigma);
  const coverage = all.weight / totalW;
  const known = components.filter((c) => isNum(c.agreement)).sort((p, q) => q.agreement - p.agreement || q.key.localeCompare(p.key));
  if (all.weight === 0 || coverage < minCoverage) return { similarity: null, dnaSim: round(dna.similarity, 1), phaseSim: round(phase.similarity, 1), coverage: round(coverage, 3), components, topMatches: [], weakest: [] };
  return {
    similarity: round(all.similarity, 1),
    dnaSim: round(dna.similarity, 1),
    phaseSim: round(phase.similarity, 1),
    distance: round(all.distance, 2),
    coverage: round(coverage, 3),
    components,
    topMatches: known.slice(0, 4).map((c) => c.key),
    weakest: known.slice(-3).reverse().map((c) => c.key),
  };
}

/** Order-preserving stage alignment: LCS(compressed a, compressed b) / max length. */
export function sequenceSimilarity(seqA, seqB) {
  const a = compress(seqA ?? []).filter((s) => s !== 'UNKNOWN');
  const b = compress(seqB ?? []).filter((s) => s !== 'UNKNOWN');
  if (a.length < 2 || b.length < 2) return null;
  const tailA = a.slice(-Math.max(b.length, 3));
  return round((lcsLength(tailA, b) / Math.max(tailA.length, b.length)) * 100, 1);
}

export function compositeSimilarity(featureSim, sequenceSim, { featureWeight = 0.85, sequenceWeight = 0.15 } = {}) {
  if (!isNum(featureSim)) return null; // the fingerprint is mandatory
  if (!isNum(sequenceSim)) return round(featureSim, 1);
  return round((featureSim * featureWeight + sequenceSim * sequenceWeight) / (featureWeight + sequenceWeight), 1);
}

/**
 * Compare one candidate with every reference.
 * @param {{vector:Record<string,number|null>, sequence?:string[]|null}} cand
 * @param {{symbol:string, vector:Record<string,number|null>, sequence?:string[]}[]} references
 */
export function matchAnalogs(cand, references, cfg = {}) {
  const all = [];
  for (const ref of references) {
    const fv = compareVectors(cand.vector, ref.vector, cfg);
    const seq = sequenceSimilarity(cand.sequence, ref.sequence);
    all.push({
      ref: ref.symbol,
      similarity: compositeSimilarity(fv.similarity, seq, cfg),
      featureSim: fv.similarity,
      dnaSim: fv.dnaSim,
      phaseSim: fv.phaseSim,
      sequenceSim: seq,
      coverage: fv.coverage,
      topMatches: fv.topMatches,
      weakest: fv.weakest,
      components: fv.components,
    });
  }
  const valid = all.filter((x) => isNum(x.similarity)).sort((p, q) => q.similarity - p.similarity || p.ref.localeCompare(q.ref));
  const best = valid[0] ?? null;
  const consensus = valid.length >= 2 ? round(mean(valid.slice(0, 2).map((x) => x.similarity)), 1) : best?.similarity ?? null;
  const supporting = valid.filter((x) => x.similarity >= 60).length;
  return { best, consensus, supporting, all };
}

/** Pairwise similarity between references: does the "LAB-like" pattern generalise? */
export function crossSimilarity(references, cfg = {}) {
  const matrix = {};
  for (const a of references) {
    matrix[a.symbol] = {};
    for (const b of references) {
      matrix[a.symbol][b.symbol] = a === b ? 100 : compositeSimilarity(compareVectors(a.vector, b.vector, cfg).similarity, sequenceSimilarity(a.sequence, b.sequence), cfg);
    }
  }
  return matrix;
}
