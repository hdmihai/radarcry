/** Scales and tick helpers for the hand-built SVG charts (no chart library). */
export function linear([d0, d1], [r0, r1]) {
  const span = d1 - d0;
  const k = span === 0 ? 0 : (r1 - r0) / span;
  const f = (x) => r0 + (x - d0) * k;
  f.invert = (y) => (k === 0 ? d0 : d0 + (y - r0) / k);
  f.domain = [d0, d1];
  return f;
}

export function logScale([d0, d1], [r0, r1]) {
  const l0 = Math.log10(Math.max(d0, 1e-12));
  const l1 = Math.log10(Math.max(d1, 1e-12));
  const inner = linear([l0, l1], [r0, r1]);
  const f = (x) => inner(Math.log10(Math.max(x, 1e-12)));
  f.domain = [d0, d1];
  return f;
}

export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const err = raw / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number.parseFloat(v.toPrecision(12)));
  return out;
}

export function logTicks(min, max) {
  const out = [];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  for (let e = lo; e <= hi; e += 1) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= min && v <= max) out.push(v);
    }
  }
  return out.length >= 2 ? out : niceTicks(min, max, 4);
}

export const f2 = (x) => (Math.round(x * 100) / 100).toString();

/** Compact path from points [[x,y],…], skipping nulls (breaks the line). */
export function linePath(points) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${f2(p[0])} ${f2(p[1])}`;
    pen = true;
  }
  return d;
}

/** Day-boundary time ticks for epoch-second series. */
export function timeTicks(t0, t1, maxTicks = 6) {
  const DAY = 86400;
  const spanDays = Math.max(1, (t1 - t0) / DAY);
  const steps = [1, 2, 3, 5, 7, 10, 14, 21, 30, 60, 90];
  const step = steps.find((s) => spanDays / s <= maxTicks) ?? 120;
  const out = [];
  let t = Math.ceil(t0 / DAY) * DAY;
  while (t <= t1) {
    out.push(t);
    t += step * DAY;
  }
  return out;
}
