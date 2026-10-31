/**
 * NORMS — what "normal" looks like for this project, learned from its own history.
 *
 * Every metric the agent watches (a scan's duration, the size of the universe, the share of projects
 * the validity gate rejects, calls per provider, the gap between two scheduled runs…) is kept as a
 * bounded series of (time, value) points in the agent's memory. A new value is judged against the
 * series *before* it, with a robust z-score (median and MAD, so one past outlier cannot move the
 * norm), and only once the series holds enough points: until then the verdict is LEARNING, which is
 * honest — a norm built from three points would raise false alarms or hide real ones.
 *
 * Pure: no clock; time arrives inside the points.
 */
import { isNum, quantile, robustZ, round } from './stats.js';

export const NORM_DEFAULTS = Object.freeze({
  /** Points needed before a value is judged against the norm. */
  minSamples: 8,
  /** Robust z beyond which a value is an anomaly. */
  z: 3.5,
  /** Points kept per metric (oldest dropped first). */
  maxPoints: 120,
  /** Only the most recent points form the norm, so it follows slow legitimate drift. */
  window: 60,
});

/** Append one point, keeping the series sorted, without duplicate timestamps, and bounded. */
export function appendPoint(series, t, v, maxPoints = NORM_DEFAULTS.maxPoints) {
  if (!isNum(t) || !isNum(v)) return series ?? [];
  const out = (series ?? []).filter(([pt]) => pt !== t);
  out.push([t, v]);
  out.sort((a, b) => a[0] - b[0]);
  return out.length > maxPoints ? out.slice(out.length - maxPoints) : out;
}

/** Summary of a series: size, median, spread and the last value. */
export function describe(series, { window = NORM_DEFAULTS.window } = {}) {
  const pts = (series ?? []).slice(-window);
  const v = pts.map(([, x]) => x);
  return {
    n: pts.length,
    median: round(quantile(v, 0.5), 3),
    p10: round(quantile(v, 0.1), 3),
    p90: round(quantile(v, 0.9), 3),
    last: pts.length ? pts[pts.length - 1][1] : null,
    lastAt: pts.length ? pts[pts.length - 1][0] : null,
  };
}

/**
 * Judge `value` (observed at time `t`) against the norm formed by the points strictly before `t`.
 * `direction` limits which side counts as a problem: 'high' (durations, failures), 'low' (counts that
 * should not shrink), or 'both'.
 *
 * @returns {{status:'LEARNING'|'NORMAL'|'ANOMALY', z:number|null, median:number|null, n:number, direction:string}}
 */
export function assess(series, value, t, { minSamples = NORM_DEFAULTS.minSamples, z = NORM_DEFAULTS.z, window = NORM_DEFAULTS.window, direction = 'both', relFloor = 0.02 } = {}) {
  const before = (series ?? []).filter(([pt]) => !isNum(t) || pt < t).slice(-window).map(([, x]) => x);
  if (!isNum(value)) return { status: 'LEARNING', z: null, median: null, n: before.length, direction };
  if (before.length < minSamples) return { status: 'LEARNING', z: null, median: round(quantile(before, 0.5), 3), n: before.length, direction };
  const r = robustZ(value, before, { relFloor });
  const off = direction === 'high' ? r.z > z : direction === 'low' ? r.z < -z : Math.abs(r.z) > z;
  return { status: off ? 'ANOMALY' : 'NORMAL', z: round(r.z, 2), median: round(r.median, 3), n: before.length, direction };
}
