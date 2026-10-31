/**
 * WINNERS — the learning set of the ≥100× forecast: the projects that, inside the last twelve
 * months, rose from a low to a peak many times higher (LAB, BTW, IRYS and every project like them),
 * each with its state *at the low*, measured strictly before the run.
 *
 * Two free sources feed it:
 *  · the aggregators' all-time low and all-time high, which arrive with the market list every run
 *    already reads — so candidates are flagged across the whole market, including projects that have
 *    since grown far past the small-cap band or fallen out of it;
 *  · a year of daily closes (CoinGecko market_chart, a few per run), which confirms each candidate and
 *    yields its fingerprint at the low. Confirmation matters: one bad tick on an illiquid pair can
 *    fake a "low" a thousand times below the real price, and an all-time low two years old says
 *    nothing about the last twelve months.
 * A documented seed list (config/winners.json, every entry with its sources) covers projects the
 * market list no longer carries.
 *
 * Point-in-time: the fingerprint of a winner uses only the candles up to its low. What happened after
 * is the label, never a feature.
 *
 * Pure: no I/O, no clock — time arrives as `nowMs`.
 */
import { isNum, mean, median, pctChange, round } from '../shared/math.js';
import { DAY_MS, isoDay, toMs } from '../shared/time.js';
import { dailyFeatures } from '../features/daily.js';
import { FEATURES, toVector } from '../similarity/vector.js';

export const WINNER_DEFAULTS = Object.freeze({
  /** The look-back of the learning list: "the last year". */
  windowDays: 365,
  /** Lowest multiple kept in the list: runs of the LAB / BTW / IRYS class, not ordinary rallies. */
  minMultiple: 15,
  /** A low counts only where the project was investable: inside the universe's capitalisation floor… */
  minLowMcapUsd: 1_000_000,
  /** …and traded (USD volume that day), so an empty order book cannot print the low. */
  minLowVolumeUsd: 25_000,
  /** Rolling median applied to daily closes before lows and peaks are read. */
  medianDays: 3,
  /** Days of history a winner needs before its low for the phase features to exist. */
  phaseHistoryDays: 35,
});

export const WINNER_STATUS = Object.freeze({
  CONFIRMED: 'CONFIRMED', // daily closes show the run inside the window
  DOCUMENTED: 'DOCUMENTED', // a seed with sources, not yet (or not) measured from history
  PENDING: 'PENDING', // flagged by the aggregator's ATL/ATH, waiting for its history
  BELOW: 'BELOW', // the history contradicts the claim (bad tick, or the low predates the window)
});

export const WINNER_STATUS_RO = Object.freeze({
  CONFIRMED: 'confirmat din istoricul zilnic',
  DOCUMENTED: 'documentat (surse), încă nemăsurat',
  PENDING: 'semnalat de ATL/ATH, în verificare',
  BELOW: 'infirmat de istoricul zilnic',
});

const TOTAL_WEIGHT = FEATURES.reduce((s, f) => s + f.weight, 0);

/** Share of the fingerprint's weight that is known (the kernel needs enough of it to compare). */
export function vectorCoverage(vector) {
  if (!vector) return 0;
  return FEATURES.reduce((s, f) => s + (isNum(vector[f.key]) ? f.weight : 0), 0) / TOTAL_WEIGHT;
}

/** Rolling median of closes: a single bad tick can make neither a low nor a peak. */
export function medianCloses(candles, k = 3) {
  const half = Math.floor(k / 2);
  return candles.map((_, i) => median(candles.slice(Math.max(0, i - half), i + half + 1).map((x) => x.c).filter(isNum)));
}

/**
 * The largest rise inside the window, read on median closes: the low (only where the project was
 * investable — capitalisation and volume floors, when known) and the highest later close.
 * One pass with a running minimum.
 *
 * @param {{t:number,c:number,v?:number|null,mc?:number|null}[]} candles oldest → newest, daily
 */
export function largestRun(candles, opts = {}) {
  const o = { ...WINNER_DEFAULTS, ...opts };
  if (!Array.isArray(candles) || candles.length < 5 || !isNum(o.nowMs)) return null;
  const from = o.nowMs - o.windowDays * DAY_MS;
  const m = medianCloses(candles, o.medianDays);
  let lowIdx = -1;
  let best = null;
  for (let j = 0; j < candles.length; j += 1) {
    const k = candles[j];
    if (k.t < from || k.t > o.nowMs || !isNum(m[j]) || m[j] <= 0) continue;
    if (lowIdx >= 0 && j > lowIdx) {
      const multiple = m[j] / m[lowIdx];
      if (!best || multiple > best.multiple) best = { lowIdx, peakIdx: j, multiple };
    }
    const liquid = (!isNum(k.mc) || k.mc >= o.minLowMcapUsd) && (!isNum(k.v) || k.v >= o.minLowVolumeUsd);
    if (liquid && (lowIdx < 0 || m[j] < m[lowIdx])) lowIdx = j;
  }
  if (!best) return null;
  const low = candles[best.lowIdx];
  const peak = candles[best.peakIdx];
  const last = candles[candles.length - 1];
  const lastMedian = m[m.length - 1];
  return {
    lowIdx: best.lowIdx,
    peakIdx: best.peakIdx,
    multiple: best.multiple,
    low: { at: isoDay(low.t), price: m[best.lowIdx], mcap: isNum(low.mc) ? low.mc : null },
    peak: { at: isoDay(peak.t), price: m[best.peakIdx], mcap: isNum(peak.mc) ? peak.mc : null },
    days: Math.round((peak.t - low.t) / DAY_MS),
    lastAt: isoDay(last.t),
    drawdownNowPct: isNum(lastMedian) ? round(pctChange(m[best.peakIdx], lastMedian), 1) : null,
  };
}

/**
 * The project as it was at index `idx`, in the similarity engine's units — only the candles up to
 * and including that day are read. Facts the history cannot give (float, holder concentration,
 * perpetual venues, Alpha listing at the time) stay unknown unless a documented seed states them.
 */
export function fingerprintAt(candles, idx, { listedMs = null, chain = null, staticRaw = {} } = {}) {
  const pre = candles.slice(0, idx + 1);
  const last = pre[pre.length - 1];
  const d = pre.length >= WINNER_DEFAULTS.phaseHistoryDays ? dailyFeatures(pre) : null;
  const turnovers = pre.slice(-7).map((k) => (isNum(k.v) && isNum(k.mc) && k.mc > 0 ? k.v / k.mc : null)).filter(isNum);
  const maxBefore = Math.max(...pre.map((k) => k.c));
  const raw = {
    ...staticRaw,
    mcapUsd: isNum(last.mc) ? last.mc : staticRaw.mcapUsd ?? null,
    turnover: turnovers.length ? mean(turnovers) : staticRaw.turnover ?? null,
    volAccel: d?.volAccel ?? null,
    slope30: d?.slope30 ?? null,
    r2_30: d?.r2_30 ?? null,
    rangePos30: d?.rangePos30 ?? null,
    compression: d?.compression ?? null,
    athChangePct: pre.length >= 10 ? pctChange(maxBefore, last.c) : staticRaw.athChangePct ?? null,
    change30: d?.change30 ?? null,
    ageDays: isNum(listedMs) && listedMs <= last.t ? (last.t - listedMs) / DAY_MS : staticRaw.ageDays ?? null,
    chain: chain ?? staticRaw.chain ?? null,
  };
  const vector = toVector(raw);
  return { raw, vector, coverage: round(vectorCoverage(vector), 3), at: isoDay(last.t) };
}

/**
 * A candidate from the aggregator's ATL/ATH: a peak inside the window, a low before it, and a
 * claimed multiple worth checking. The claim is an upper bound — the low may be a wick, or older
 * than the window — so it is never used as a confirmed run.
 */
export function marketCandidate(asset, opts = {}) {
  const o = { ...WINNER_DEFAULTS, ...opts };
  const m = asset?.market ?? {};
  const atlMs = toMs(m.atlDate);
  const athMs = toMs(m.athDate);
  if (!isNum(m.atl) || !isNum(m.ath) || m.atl <= 0 || !isNum(atlMs) || !isNum(athMs)) return null;
  if (athMs < o.nowMs - o.windowDays * DAY_MS || athMs > o.nowMs || atlMs >= athMs) return null;
  const multiple = m.ath / m.atl;
  if (multiple < o.minMultiple) return null;
  return {
    id: asset.ids?.coingecko ?? null,
    key: asset.key,
    symbol: asset.symbol,
    name: asset.name,
    chain: asset.primary?.chain ?? null,
    claimed: { low: { price: m.atl, at: isoDay(atlMs) }, peak: { price: m.ath, at: isoDay(athMs) }, multiple: round(multiple, 1), source: 'aggregator ATL/ATH' },
  };
}

/**
 * Judge one candidate against its daily history: confirmed (with the fingerprint at the low),
 * contradicted, or still pending when there is no history.
 *
 * @param {{id?:string|null, symbol:string, name?:string, chain?:string|null, listedAt?:string|null,
 *          static?:any, claimed?:any, documented?:any}} entry
 * @param {{t:number,c:number,v?:number|null,mc?:number|null}[]|null} candles
 */
export function judgeWinner(entry, candles, opts = {}) {
  const o = { ...WINNER_DEFAULTS, ...opts };
  const base = {
    id: entry.id ?? null,
    key: entry.key ?? null,
    symbol: entry.symbol,
    name: entry.name ?? entry.symbol,
    chain: entry.chain ?? null,
    claimed: entry.claimed ?? entry.documented ?? null,
    sources: entry.sources ?? [],
    note: entry.note ?? null,
    seed: Boolean(entry.documented),
  };
  if (!candles?.length) {
    const doc = entry.documented;
    if (doc && isNum(doc.multiple)) {
      return { ...base, status: WINNER_STATUS.DOCUMENTED, multiple: doc.multiple, low: doc.low ?? null, peak: doc.peak ?? null, days: doc.days ?? null, drawdownNowPct: doc.drawdownNowPct ?? null, vector: null, coverage: 0 };
    }
    return { ...base, status: WINNER_STATUS.PENDING, multiple: entry.claimed?.multiple ?? null, low: entry.claimed?.low ?? null, peak: entry.claimed?.peak ?? null, days: null, drawdownNowPct: null, vector: null, coverage: 0 };
  }
  const run = largestRun(candles, o);
  if (!run || run.multiple < o.minMultiple) {
    return { ...base, status: WINNER_STATUS.BELOW, multiple: run ? round(run.multiple, 1) : null, low: run?.low ?? null, peak: run?.peak ?? null, days: run?.days ?? null, drawdownNowPct: run?.drawdownNowPct ?? null, vector: null, coverage: 0 };
  }
  const fp = fingerprintAt(candles, run.lowIdx, { listedMs: toMs(entry.listedAt), chain: entry.chain ?? null, staticRaw: entry.static ?? {} });
  return {
    ...base,
    status: WINNER_STATUS.CONFIRMED,
    multiple: round(run.multiple, 1),
    low: run.low,
    peak: run.peak,
    days: run.days,
    drawdownNowPct: run.drawdownNowPct,
    vector: fp.vector,
    coverage: fp.coverage,
    anchorAt: fp.at,
    historyDaysBeforeLow: run.lowIdx,
  };
}

/** Summary of the round trips: how much of the peak the winners kept by now (median, percent). */
export function roundTrip(winners) {
  const dd = winners.map((w) => w.drawdownNowPct).filter(isNum);
  return dd.length ? { medianDrawdownPct: round(median(dd), 1), n: dd.length, worst: round(Math.min(...dd), 1) } : null;
}
