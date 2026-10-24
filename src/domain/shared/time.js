/** Time helpers. The domain never reads the wall clock: `now` is always passed in. */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** Parse ISO strings, epoch ms or epoch seconds into epoch ms (null when unusable). */
export function toMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e11 ? value * 1000 : value; // seconds vs milliseconds
  }
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

export function daysBetween(fromMs, toMsValue) {
  if (fromMs === null || toMsValue === null) return null;
  return (toMsValue - fromMs) / DAY_MS;
}

export function ageDays(sinceValue, nowMs) {
  const t = toMs(sinceValue);
  if (t === null) return null;
  const d = daysBetween(t, nowMs);
  return d !== null && d >= 0 ? d : null;
}

export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const iso = (ms) => new Date(ms).toISOString();
