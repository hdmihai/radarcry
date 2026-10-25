/**
 * BASELINES — the point-in-time memory that makes "something changed" measurable.
 *
 * A single snapshot can only say what a token looks like; it cannot say what is *different*. Every
 * run appends a compact point per asset to the state branch, and this module turns that series into
 * baselines: median, robust spread (MAD), percentile rank and a robust z-score per metric.
 *
 * Two rules are absolute here:
 *  · no look-ahead — a baseline for run T only ever uses points strictly before T;
 *  · a short history is reported as a short history (low confidence), never padded with assumptions.
 */
import { isNum, median, quantile, round } from '../shared/math.js';
import { DAY_MS } from '../shared/time.js';

/** Metrics tracked per asset, per run. Keep this list stable: the state codec is columnar. */
export const TRACKED = [
  'price',
  'marketCap',
  'volume24h',
  'turnover',
  'liquidityUsd',
  'holders',
  'holdersEffective',
  'top10Pct',
  'oiUsd',
  'fundingPct8h',
  'tvl',
  'devCommits30d',
  'mentions7d',
  'cexBalancePct',
  'whaleBalancePct',
];

const MAD_TO_SIGMA = 1.4826;

/**
 * Metrics whose value depends on *who* measured it. Holder counts from Binance Alpha, GoPlus,
 * GeckoTerminal and a NodeReal holder list differ systematically; so do DexScreener's and Alpha's
 * liquidity. Which provider answers can change from one run to the next (a rate limit is enough),
 * and comparing a GoPlus count against a GeckoTerminal median would report a change in holders that
 * is only a change in sources. These metrics are compared against history from the same source
 * only; a reading with no recorded source is compared only with other unsourced readings.
 */
export const SOURCED = { holders: 'holdersSource', liquidityUsd: 'liquiditySource', top10Pct: 'top10Source' };
const UNSOURCED = '∅';

/** Against a perfectly flat history, a move smaller than this share of the level is not a change. */
export const FLAT_HISTORY_MIN_MOVE = 0.1;

/** Robust z-score: (x − median) / (1.4826 · MAD). Immune to the single spike that breaks a mean. */
export function robustZ(values, x) {
  if (!isNum(x)) return null;
  const xs = values.filter(isNum);
  if (xs.length < 4) return null;
  const m = median(xs);
  const mad = median(xs.map((v) => Math.abs(v - m)));
  const sigma = mad * MAD_TO_SIGMA;
  if (!isNum(sigma) || sigma === 0) {
    /*
     * A perfectly flat history has no measurable spread, so a z-score cannot be computed. Falling
     * back to "any move is notable" would make a 1 % drift look like a 3-sigma event, which is how a
     * change detector starts firing on noise. Instead the move is judged against the level itself:
     * below a tenth of the median it is indistinguishable from the flat norm at our resolution, and
     * above it we report direction at a fixed magnitude rather than inventing a size.
     */
    if (x === m) return 0;
    const scale = Math.abs(m);
    if (scale === 0) return x > 0 ? 3 : -3;
    const relative = Math.abs(x - m) / scale;
    if (relative < FLAT_HISTORY_MIN_MOVE) return 0;
    return x > m ? 3 : -3;
  }
  return (x - m) / sigma;
}

/** Share of historical values at or below x, in 0..1. */
export function percentileOf(values, x) {
  const xs = values.filter(isNum).sort((a, b) => a - b);
  if (!xs.length || !isNum(x)) return null;
  let below = 0;
  for (const v of xs) if (v <= x) below += 1;
  return below / xs.length;
}

/**
 * @param {{at:number, metrics:Record<string, number|null>}[]} points  ascending by time
 * @param {{nowMs:number, windowDays?:number, minPoints?:number}} o
 * @returns {{windowDays:number, points:number, spanDays:number|null, metrics:Record<string, any>, sufficient:boolean}}
 */
export function buildBaseline(points, { nowMs, windowDays = 30, minPoints = 4 }) {
  const from = nowMs - windowDays * DAY_MS;
  const hist = (points ?? []).filter((p) => isNum(p.at) && p.at < nowMs && p.at >= from);
  const metrics = {};
  for (const key of TRACKED) {
    const values = hist.map((p) => p.metrics?.[key]).filter(isNum);
    // For sourced metrics keep each provider's series apart (see SOURCED).
    let bySource = null;
    if (SOURCED[key]) {
      bySource = {};
      for (const p of hist) {
        const v = p.metrics?.[key];
        if (!isNum(v)) continue;
        const src = p.metrics?.[SOURCED[key]] ?? UNSOURCED;
        (bySource[src] ??= []).push(v);
      }
    }
    if (!values.length) {
      metrics[key] = { n: 0, median: null, p10: null, p90: null, min: null, max: null, bySource };
      continue;
    }
    metrics[key] = {
      n: values.length,
      median: round(median(values), 8),
      p10: round(quantile(values, 0.1), 8),
      p90: round(quantile(values, 0.9), 8),
      min: round(Math.min(...values), 8),
      max: round(Math.max(...values), 8),
      values,
      bySource,
    };
  }
  const spanDays = hist.length >= 2 ? round((hist[hist.length - 1].at - hist[0].at) / DAY_MS, 2) : null;
  return { windowDays, points: hist.length, spanDays, metrics, sufficient: hist.length >= minPoints };
}

/**
 * Compare the current reading of each metric against its baseline.
 * @returns {Record<string, {value:number|null, median:number|null, changePct:number|null, z:number|null,
 *   percentile:number|null, n:number}>}
 */
export function compareToBaseline(current, baseline) {
  const out = {};
  for (const key of TRACKED) {
    const b = baseline?.metrics?.[key] ?? { n: 0, median: null, values: [] };
    const x = isNum(current?.[key]) ? current[key] : null;
    let values = b.values ?? [];
    let med = b.median ?? null;
    let source = null;
    if (SOURCED[key]) {
      source = current?.[SOURCED[key]] ?? null;
      values = b.bySource?.[source ?? UNSOURCED] ?? [];
      med = values.length ? round(median(values), 8) : null;
    }
    out[key] = {
      value: x,
      median: med,
      changePct: isNum(x) && isNum(med) && med !== 0 ? round((x / med - 1) * 100, 2) : null,
      z: round(robustZ(values, x), 2),
      percentile: round(percentileOf(values, x), 3),
      n: values.length,
      ...(SOURCED[key] ? { source } : {}),
    };
  }
  return out;
}

/** Append one point, keeping the series bounded and ordered. */
export function appendPoint(points, point, { maxPoints = 240 } = {}) {
  const next = [...(points ?? []), point].sort((a, b) => a.at - b.at);
  // De-duplicate runs that landed in the same minute (a re-run of the same schedule).
  const seen = new Set();
  const dedup = [];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const k = Math.floor(next[i].at / 60_000);
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.unshift(next[i]);
  }
  return dedup.slice(-maxPoints);
}

/** Collapse an asset's current facts into the compact metric row stored per run. */
export function metricRow(a) {
  const m = a.market ?? {};
  const d = a.derivatives ?? {};
  const oc = a.onchain ?? {};
  return {
    price: m.price ?? null,
    marketCap: m.marketCap ?? null,
    volume24h: m.volume24h ?? null,
    turnover: a.derived?.turnover ?? null,
    liquidityUsd: oc.liquidityUsd ?? null,
    liquiditySource: oc.liquiditySource ?? null,
    holders: oc.holders ?? null,
    holdersSource: oc.holdersSource ?? null,
    holdersEffective: oc.holdersEffective ?? null,
    top10Pct: oc.top10Pct ?? null,
    top10Source: oc.top10Source ?? null,
    oiUsd: d.oiUsd ?? null,
    fundingPct8h: d.fundingPct8h ?? null,
    tvl: a.fundamentals?.tvl ?? null,
    devCommits30d: a.social?.devCommits30d ?? null,
    mentions7d: a.social?.mentions7d ?? null,
    cexBalancePct: oc.cexBalancePct ?? null,
    whaleBalancePct: oc.whaleBalancePct ?? null,
  };
}
