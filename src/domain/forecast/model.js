/**
 * FORECAST — how likely is a project to rise at least N× within twelve months, given what it looks
 * like today and what the last year's winners looked like at their lows?
 *
 *   P(≥N× | x) = p0·LR(x) / (p0·LR(x) + 1 − p0)
 *
 *   p0      the base rate: of the small caps the radar tracks, how many did ≥N× in a year. A Beta
 *           posterior with a deliberately sceptical prior (0.5%, weighted like 200 projects), so a
 *           short history cannot talk the rate up. The aggregators' list is a survivor list — the
 *           projects that died are missing from the denominator — so the data side is an upper
 *           bound, and the prior pulls it down until the radar's own year of observations exists.
 *   LR(x)   the likelihood ratio: how much more densely the winners' fingerprints at their lows sit
 *           around x than the whole universe does today. A Gaussian kernel on the similarity
 *           engine's fixed 0–100 features, unknown features skipped (UNKNOWN is not bearish), shrunk
 *           towards 1 when there are few winners, and clamped — eight examples cannot justify a
 *           thousandfold lift.
 *
 * Every forecast carries its interval: the base rate's interval combined with the spread of LR
 * when each winner is left out in turn. A wide interval is the honest answer, not a defect.
 *
 * This is a statistical description of a rare event, not a prediction and not advice. Most of the
 * last year's ≥100× runs gave back 90% or more afterwards; the forecast says nothing about holding.
 *
 * Pure: no I/O, no clock.
 */
import { clamp, isNum, median, round, wilson } from '../shared/math.js';
import { FEATURES } from '../similarity/vector.js';
import { WINNER_STATUS } from './winners.js';

export const FORECAST_DEFAULTS = Object.freeze({
  /** The multiples forecast: the headline target and the "LAB / BTW / IRYS-class" one. */
  targets: [100, 20],
  horizonDays: 365,
  /** Kernel width on the 0–100 feature scale — the similarity engine's own σ. */
  sigma: 22,
  /** Share of the fingerprint's weight two projects must both know to be compared. */
  minCoverage: 0.35,
  /** LR shrinkage towards 1: with n winners, the evidence counts n / (n + k). */
  shrinkK: 5,
  /** Hard bound on the likelihood ratio, both ways. */
  lrClamp: 25,
  /** Sceptical prior on the base rate: 0.5% a year, weighted like 200 projects. */
  priorRate: 0.005,
  priorWeight: 200,
});

const TOTAL_WEIGHT = FEATURES.reduce((s, f) => s + f.weight, 0);

/** Gaussian kernel between two fingerprints, or null when they share too little to compare. */
export function kernel(a, b, { sigma = FORECAST_DEFAULTS.sigma, minCoverage = FORECAST_DEFAULTS.minCoverage } = {}) {
  if (!a || !b) return null;
  let num = 0;
  let den = 0;
  for (const f of FEATURES) {
    const x = a[f.key];
    const y = b[f.key];
    if (!isNum(x) || !isNum(y)) continue;
    num += f.weight * (x - y) ** 2;
    den += f.weight;
  }
  if (den === 0 || den / TOTAL_WEIGHT < minCoverage) return null;
  const d = Math.sqrt(num / den);
  return Math.exp(-0.5 * (d / sigma) ** 2);
}

/**
 * The base rate with its interval: Beta posterior under the sceptical prior, the interval read as a
 * Wilson interval on the posterior's pseudo-counts (90%).
 * @param {{events:number, population:number, priorRate?:number, priorWeight?:number}} input
 */
export function baseRate({ events, population, priorRate = FORECAST_DEFAULTS.priorRate, priorWeight = FORECAST_DEFAULTS.priorWeight }) {
  const k = Math.max(0, events ?? 0);
  const n = Math.max(k, population ?? 0);
  const alpha = k + priorRate * priorWeight;
  const total = n + priorWeight;
  const w = wilson(alpha, total, 1.645);
  return { p: alpha / total, lo: w.low, hi: w.high, events: k, population: n, priorRate, priorWeight, observed: n > 0 ? k / n : null };
}

/** Posterior probability from a base rate and a likelihood ratio. */
export const posterior = (p0, lr) => (isNum(p0) && isNum(lr) ? (p0 * lr) / (p0 * lr + (1 - p0)) : null);

/** The winners usable as positives for one target: confirmed, comparable, at least that multiple. */
export function positivesFor(winners, target, { minCoverage = FORECAST_DEFAULTS.minCoverage } = {}) {
  return (winners ?? []).filter((w) => w.status === WINNER_STATUS.CONFIRMED && w.vector && w.coverage >= minCoverage && isNum(w.multiple) && w.multiple >= target);
}

/** Winners that count towards the base rate for one target: confirmed or documented with sources. */
export function eventsFor(winners, target) {
  return (winners ?? []).filter((w) => (w.status === WINNER_STATUS.CONFIRMED || w.status === WINNER_STATUS.DOCUMENTED) && isNum(w.multiple) && w.multiple >= target).length;
}

const shrinkLr = (lr, n, { shrinkK, lrClamp }) => {
  if (!isNum(lr) || lr <= 0 || n <= 0) return 1;
  const s = n / (n + shrinkK);
  return clamp(Math.exp(s * Math.log(lr)), 1 / lrClamp, lrClamp);
};

/**
 * Forecast every project of the universe for every target.
 *
 * @param {{key:string, vector:Record<string, number|null>|null}[]} projects the universe today; it is
 *   also the background density (each project is left out of its own background)
 * @param {any[]} winners the learning list (judgeWinner output)
 * @param {{rates:Record<number, ReturnType<typeof baseRate>>}} ctx
 * @returns {Map<string, any>} key → { coverage, targets: { [N]: {p, lo, hi, lift, lr, basis} }, nearest }
 */
export function forecastUniverse(projects, winners, ctx, opts = {}) {
  const o = { ...FORECAST_DEFAULTS, ...opts };
  const kopts = { sigma: o.sigma, minCoverage: o.minCoverage };
  const list = (projects ?? []).filter((p) => p?.key);
  const comparable = (winners ?? []).filter((w) => w.status === WINNER_STATUS.CONFIRMED && w.vector && w.coverage >= o.minCoverage);
  const out = new Map();

  // Background density: the mean kernel of each project to the rest of the universe.
  const vectors = list.map((p) => p.vector ?? null);
  const bgSum = new Array(list.length).fill(0);
  const bgN = new Array(list.length).fill(0);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const k = kernel(vectors[i], vectors[j], kopts);
      if (k === null) continue;
      bgSum[i] += k; bgN[i] += 1;
      bgSum[j] += k; bgN[j] += 1;
    }
  }

  for (let i = 0; i < list.length; i += 1) {
    const x = vectors[i];
    const coverage = x ? FEATURES.reduce((s, f) => s + (isNum(x[f.key]) ? f.weight : 0), 0) / TOTAL_WEIGHT : 0;
    const w0 = bgN[i] > 0 ? bgSum[i] / bgN[i] : null;
    const kTo = comparable.map((w) => ({ w, k: kernel(x, w.vector, kopts) })).filter((e) => e.k !== null);
    const targets = {};
    for (const target of o.targets) {
      const rate = ctx.rates?.[target];
      const p0 = rate?.p ?? null;
      const pos = kTo.filter((e) => e.w.multiple >= target);
      if (!isNum(p0)) {
        targets[target] = { p: null, lo: null, hi: null, lift: null, lr: null, basis: 'necunoscut' };
        continue;
      }
      if (!pos.length || !isNum(w0) || w0 <= 0 || coverage < o.minCoverage) {
        // No comparable winner (or too little known about the project): the base rate is the answer.
        targets[target] = { p: round(p0, 5), lo: round(rate.lo, 5), hi: round(rate.hi, 5), lift: 1, lr: 1, positives: pos.length, basis: 'rata de bază' };
        continue;
      }
      const sum = pos.reduce((s, e) => s + e.k, 0);
      const lr = shrinkLr(sum / pos.length / w0, pos.length, o);
      // Leave-one-out spread of the likelihood ratio: how much any single winner moves it.
      let lrMin = lr;
      let lrMax = lr;
      if (pos.length > 1) {
        for (const e of pos) {
          const l = shrinkLr((sum - e.k) / (pos.length - 1) / w0, pos.length - 1, o);
          lrMin = Math.min(lrMin, l);
          lrMax = Math.max(lrMax, l);
        }
      }
      const p = posterior(p0, lr);
      targets[target] = {
        p: round(p, 5),
        lo: round(posterior(rate.lo, lrMin), 5),
        hi: round(posterior(rate.hi, lrMax), 5),
        lift: round(p / p0, 2),
        lr: round(lr, 2),
        positives: pos.length,
        basis: 'model',
      };
    }
    const nearest = [...kTo].sort((a, b) => b.k - a.k).slice(0, 3)
      .map((e) => ({ symbol: e.w.symbol, name: e.w.name, multiple: e.w.multiple, similarity: round(e.k * 100, 1), peakAt: e.w.peak?.at ?? null }));
    out.set(list[i].key, { coverage: round(coverage, 3), targets, nearest });
  }
  return out;
}

/**
 * Separation check, on the training data itself (optimistic by construction): the median lift the
 * model gives the winners' own fingerprints, each against the universe. Near 1 means the features do
 * not tell winners apart and the forecast is close to the base rate for everyone.
 */
export function separation(winners, projects, target, opts = {}) {
  const o = { ...FORECAST_DEFAULTS, ...opts };
  const pos = positivesFor(winners, target, o);
  if (pos.length < 2 || !projects?.length) return null;
  const kopts = { sigma: o.sigma, minCoverage: o.minCoverage };
  const lifts = [];
  for (const w of pos) {
    const others = pos.filter((x) => x !== w);
    const k1 = others.map((x) => kernel(w.vector, x.vector, kopts)).filter((k) => k !== null);
    const k0 = projects.map((p) => kernel(w.vector, p.vector, kopts)).filter((k) => k !== null);
    if (!k1.length || !k0.length) continue;
    const w0 = k0.reduce((s, k) => s + k, 0) / k0.length;
    if (w0 <= 0) continue;
    lifts.push(shrinkLr(k1.reduce((s, k) => s + k, 0) / k1.length / w0, others.length, o));
  }
  return lifts.length ? { medianLift: round(median(lifts), 2), n: lifts.length } : null;
}

/** Reader-facing band of a probability, relative to the base rate. */
export function forecastBand(p, p0) {
  if (!isNum(p) || !isNum(p0) || p0 <= 0) return { key: 'UNKNOWN', label: 'necunoscută' };
  const lift = p / p0;
  if (lift >= 4) return { key: 'HIGH', label: 'mult peste rata de bază' };
  if (lift >= 1.5) return { key: 'ABOVE', label: 'peste rata de bază' };
  if (lift > 0.67) return { key: 'BASE', label: 'în jurul ratei de bază' };
  return { key: 'BELOW', label: 'sub rata de bază' };
}
