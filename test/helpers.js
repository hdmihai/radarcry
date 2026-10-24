/** Shared test helpers: deterministic synthetic candles and small fixtures. */
export const DAY = 86_400_000;
export const H4 = 4 * 3_600_000;

/** Deterministic PRNG (mulberry32). */
export function rng(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Candles from a list of daily (or 4H) returns. `vol` scales intrabar range; volume follows `volume(i)`.
 * @param {number[]} returns  per-bar fractional returns
 */
export function candlesFromReturns(returns, { start = 1, t0 = Date.parse('2026-01-01T00:00:00Z'), step = DAY, vol = 0.02, volume = () => 1_000_000, seed = 3 } = {}) {
  const r = rng(seed);
  const out = [];
  let price = start;
  returns.forEach((ret, i) => {
    const o = price;
    const c = Math.max(1e-9, o * (1 + ret));
    const h = Math.max(o, c) * (1 + vol * r());
    const l = Math.min(o, c) * (1 - vol * r());
    out.push({ t: t0 + i * step, o, h, l, c, v: volume(i), closed: true });
    price = c;
  });
  return out;
}

export const flat = (n, noise = 0.01, seed = 5) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => (r() - 0.5) * 2 * noise);
};
