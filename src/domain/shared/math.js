/**
 * Pure numeric helpers. No I/O, no clock, no randomness — deterministic by construction.
 * Convention: a missing value is `null` and propagates as UNKNOWN; it is never coerced to 0.
 */

/** @param {unknown} x @returns {x is number} */
export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Parse numbers coming from APIs (strings, numbers, null). Returns null when unusable. */
export function toNum(x) {
  if (x === null || x === undefined || x === '' || typeof x === 'boolean') return null;
  const n = typeof x === 'number' ? x : Number(String(x).trim());
  return Number.isFinite(n) ? n : null;
}

export const clamp = (x, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));

/** Linear map of x from [lo, hi] onto [0, 100] (works with lo > hi for inverted scales). */
export function band(x, lo, hi) {
  if (!isNum(x)) return null;
  if (hi === lo) return 50;
  return clamp(((x - lo) / (hi - lo)) * 100);
}

/** Gaussian bump centred on `center`, 100 at the centre. */
export function bell(x, center, width) {
  if (!isNum(x) || !isNum(center) || !(width > 0)) return null;
  return 100 * Math.exp(-0.5 * ((x - center) / width) ** 2);
}

export const log10 = (x) => (isNum(x) && x > 0 ? Math.log10(x) : null);

/** Safe ratio a / b — null when either side is unknown or b is 0. */
export function ratio(a, b) {
  if (!isNum(a) || !isNum(b) || b === 0) return null;
  return a / b;
}

/** Percentage change from a to b (b / a - 1) * 100. */
export function pctChange(from, to) {
  if (!isNum(from) || !isNum(to) || from === 0) return null;
  return (to / from - 1) * 100;
}

export function round(x, digits = 2) {
  if (!isNum(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** Round to N significant digits — keeps tiny token prices readable without bloating JSON. */
export function sig(x, digits = 6) {
  if (!isNum(x)) return null;
  if (x === 0) return 0;
  return Number.parseFloat(x.toPrecision(digits));
}

export function sum(xs) {
  let s = 0;
  for (const x of xs) if (isNum(x)) s += x;
  return s;
}

export function mean(xs) {
  const v = xs.filter(isNum);
  return v.length ? sum(v) / v.length : null;
}

export function median(xs) {
  const v = xs.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function quantile(xs, q) {
  const v = xs.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function stdev(xs) {
  const v = xs.filter(isNum);
  if (v.length < 2) return null;
  const m = sum(v) / v.length;
  return Math.sqrt(sum(v.map((x) => (x - m) ** 2)) / (v.length - 1));
}

/**
 * Weighted mean of {value, weight} pairs, skipping unknown values.
 * Returns { value, weight } where weight is the total weight that was actually available.
 */
export function weightedMean(pairs) {
  let num = 0;
  let den = 0;
  for (const { value, weight } of pairs) {
    if (!isNum(value) || !isNum(weight) || weight <= 0) continue;
    num += value * weight;
    den += weight;
  }
  return { value: den > 0 ? num / den : null, weight: den };
}

/**
 * Ordinary least squares on y over x = 0..n-1.
 * Returns slope, intercept and r² (goodness of fit) — r² is how "clean" a trend is.
 */
export function linreg(ys) {
  const pts = [];
  ys.forEach((y, i) => { if (isNum(y)) pts.push([i, y]); });
  const n = pts.length;
  if (n < 3) return { slope: null, intercept: null, r2: null };
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0; let syy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  const den = n * sxx - sx * sx;
  if (den === 0) return { slope: 0, intercept: sy / n, r2: 0 };
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  let ssRes = 0;
  for (const [x, y] of pts) ssRes += (y - (intercept + slope * x)) ** 2;
  const r2 = ssTot > 0 ? clamp(1 - ssRes / ssTot, 0, 1) : 0;
  return { slope, intercept, r2 };
}

/**
 * Wilson score interval for a binomial proportion — an honest confidence interval
 * for hit-rates on small samples (never a pseudo-probability).
 */
export function wilson(successes, n, z = 1.96) {
  if (!isNum(successes) || !isNum(n) || n <= 0) return { p: null, low: null, high: null, n: n || 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, low: clamp(centre - half, 0, 1), high: clamp(centre + half, 0, 1), n };
}

/** Longest common subsequence length — order-preserving sequence alignment. */
export function lcsLength(a, b) {
  if (!a.length || !b.length) return 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Collapse consecutive duplicates: [A,A,B,B,A] -> [A,B,A]. */
export function compress(seq) {
  const out = [];
  for (const s of seq) if (s !== undefined && s !== null && out[out.length - 1] !== s) out.push(s);
  return out;
}
