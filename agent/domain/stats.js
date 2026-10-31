/**
 * Numeric helpers of the agent. Pure: no I/O, no clock, no randomness.
 * A missing value is `null` and stays unknown — it is never coerced to 0.
 */

/** @param {unknown} x @returns {x is number} */
export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function round(x, digits = 1) {
  if (!isNum(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Linear-interpolated quantile of the numeric values (q in [0, 1]). */
export function quantile(xs, q) {
  const v = xs.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export const median = (xs) => quantile(xs, 0.5);

export function mean(xs) {
  const v = xs.filter(isNum);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

/** Median absolute deviation around the median. */
export function mad(xs, med = median(xs)) {
  if (!isNum(med)) return null;
  return median(xs.filter(isNum).map((x) => Math.abs(x - med)));
}

/**
 * Robust z-score of `x` against a sample: (x − median) / scale, with scale = 1.4826·MAD (the normal
 * consistency constant). A sample with no spread (a count that is always 1000) would make any change
 * infinitely surprising, so the scale has a floor: `relFloor` of the median's size, or `absFloor`.
 */
export function robustZ(x, xs, { relFloor = 0.02, absFloor = 1e-9 } = {}) {
  const v = xs.filter(isNum);
  if (!isNum(x) || !v.length) return { z: null, median: null, scale: null, n: v.length };
  const med = median(v);
  const scale = Math.max(1.4826 * mad(v, med), relFloor * Math.abs(med), absFloor);
  return { z: (x - med) / scale, median: med, scale, n: v.length };
}

/**
 * Exact Poisson interval for an observed count (Garwood), by bisection on the CDF — used to judge an
 * observed/expected ratio of rare events without pretending they are normal.
 */
export function poissonInterval(observed, level = 0.9) {
  const a = (1 - level) / 2;
  const cdf = (k, lambda) => {
    let term = Math.exp(-lambda);
    let s = term;
    for (let i = 1; i <= k; i += 1) {
      term *= lambda / i;
      s += term;
    }
    return s;
  };
  const solve = (f) => {
    let lo = 0;
    let hi = Math.max(10, observed * 4 + 10);
    for (let i = 0; i < 100; i += 1) {
      const mid = (lo + hi) / 2;
      if (f(mid)) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
  // lower: P(X ≥ observed | λ) = a  ⇔  1 − cdf(observed − 1, λ) = a
  const lower = observed === 0 ? 0 : solve((l) => 1 - cdf(observed - 1, l) >= a);
  // upper: P(X ≤ observed | λ) = a
  const upper = solve((l) => cdf(observed, l) <= a);
  return { lower, upper };
}

/** Short stable hash (FNV-1a, 32 bit, hex) — fingerprints of findings, no crypto needed. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Milliseconds from an ISO string (or a number); null when unusable. */
export function toMs(x) {
  if (isNum(x)) return x;
  if (typeof x !== 'string' || !x) return null;
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : null;
}

export const isoOf = (ms) => (isNum(ms) ? new Date(ms).toISOString() : null);
