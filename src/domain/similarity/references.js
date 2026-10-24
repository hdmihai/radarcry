/**
 * Reference library (CRI v0.4.2 / v0.5.7 / v0.5.8): LAB, BTW, AGT pre-expansion fingerprints.
 * When daily history is available the expansion anchor is detected automatically and the
 * fingerprint is measured strictly BEFORE the anchor (anti look-ahead, CRI v0.4.3).
 * Otherwise a documented research estimate (config/references.json) is used and labelled STATIC.
 */
import { isNum, mean, pctChange, round } from '../shared/math.js';
import { DAY_MS, isoDay, toMs } from '../shared/time.js';
import { dailyFeatures } from '../features/daily.js';
import { stageSequence } from '../lifecycle/stage.js';
import { toVector } from './vector.js';

/** CoinGecko market_chart → daily close-only candles with market cap. */
export function chartToDaily(chart) {
  const prices = chart?.prices ?? [];
  const caps = new Map((chart?.market_caps ?? []).map(([t, v]) => [isoDay(t), v]));
  const vols = new Map((chart?.total_volumes ?? []).map(([t, v]) => [isoDay(t), v]));
  const byDay = new Map();
  for (const [t, p] of prices) {
    if (!isNum(p) || p <= 0) continue;
    byDay.set(isoDay(t), { t, c: p });
  }
  return [...byDay.entries()]
    .sort((x, y) => x[1].t - y[1].t)
    .map(([day, { t, c }]) => ({ t, o: c, h: c, l: c, c, v: vols.get(day) ?? null, mc: caps.get(day) ?? null }));
}

/**
 * Find the start of the largest expansion: a close near its 20-day base that is followed by
 * ≥ +100% within 14 days; among those, the one with the largest 45-day forward gain.
 */
export function detectAnchor(candles, { minGain = 1.0, lookahead = 14, outcomeDays = 45, minIndex = 35 } = {}) {
  let best = null;
  const n = candles.length;
  for (let t = minIndex; t < n - 2; t += 1) {
    const c = candles[t].c;
    const fwd = candles.slice(t + 1, Math.min(n, t + 1 + lookahead)).map((k) => k.c);
    if (!fwd.length) continue;
    const gain = Math.max(...fwd) / c - 1;
    if (gain < minGain) continue;
    const base = Math.min(...candles.slice(Math.max(0, t - 20), t + 1).map((k) => k.c));
    if (c > base * 1.35) continue;
    const out = candles.slice(t + 1, Math.min(n, t + 1 + outcomeDays));
    let peakIdx = 0;
    out.forEach((k, i) => { if (k.c > out[peakIdx].c) peakIdx = i; });
    const outcome = out.length ? out[peakIdx].c / c - 1 : gain;
    if (!best || outcome > best.outcome + 1e-9) best = { index: t, outcome, daysToPeak: peakIdx + 1 };
  }
  return best;
}

/**
 * @param {{symbol:string, name:string, listedAt?:string, static:any, sources?:any[], tags?:string[], outcomeNote?:string}} ref
 * @param {any|null} chart CoinGecko market_chart payload (or null)
 */
export function buildReference(ref, chart, nowMs) {
  const base = {
    symbol: ref.symbol,
    name: ref.name,
    chain: ref.static?.chain ?? 'bsc',
    tags: ref.tags ?? [],
    sources: ref.sources ?? [],
    outcomeNote: ref.outcomeNote ?? null,
    coingeckoId: ref.coingeckoId ?? null,
  };
  const staticRaw = { ...ref.static };
  const candles = chart ? chartToDaily(chart) : [];
  const anchor = candles.length >= 60 ? detectAnchor(candles) : null;

  if (!anchor) {
    return {
      ...base,
      status: 'STATIC',
      statusNote: candles.length ? 'istoric disponibil, dar fără ancoră de expansiune detectabilă în 365 zile' : 'istoric indisponibil: se folosește amprenta documentată',
      anchorDate: ref.static?.anchorDate ?? null,
      outcome: ref.static?.outcome ?? null,
      raw: staticRaw,
      vector: toVector(staticRaw),
      sequence: ref.static?.sequence ?? ['BASE', 'BUILDING', 'ACCELERATION', 'PRE_EXPANSION'],
      window: null,
    };
  }

  const pre = candles.slice(0, anchor.index + 1); // strictly up to the anchor close — no future data
  const d = dailyFeatures(pre);
  const last = pre[pre.length - 1];
  const turnovers = pre.slice(-7).map((k) => (isNum(k.v) && isNum(k.mc) && k.mc > 0 ? k.v / k.mc : null));
  const anchorMs = last.t;
  const listedMs = toMs(ref.listedAt);
  const ageDays = isNum(listedMs) ? (anchorMs - listedMs) / DAY_MS : (anchorMs - pre[0].t) / DAY_MS;
  const maxBefore = Math.max(...pre.map((k) => k.c));

  const measured = {
    mcapUsd: last.mc,
    turnover: mean(turnovers),
    volAccel: d?.volAccel ?? null,
    slope30: d?.slope30 ?? null,
    r2_30: d?.r2_30 ?? null,
    rangePos30: d?.rangePos30 ?? null,
    compression: d?.compression ?? null,
    athChangePct: pctChange(maxBefore, last.c),
    change30: d?.change30 ?? null,
    ageDays,
  };
  const raw = { ...staticRaw };
  for (const [k, v] of Object.entries(measured)) if (isNum(v)) raw[k] = v;

  return {
    ...base,
    status: 'COMPUTED',
    statusNote: 'fereastră pre-expansiune măsurată din istoricul zilnic CoinGecko (fără date după ancoră)',
    anchorDate: isoDay(anchorMs),
    outcome: { gainPct: round(anchor.outcome * 100, 0), days: anchor.daysToPeak },
    raw,
    vector: toVector(raw),
    sequence: stageSequence(pre, 30),
    window: {
      from: isoDay(pre[Math.max(0, pre.length - 30)].t),
      to: isoDay(anchorMs),
      closes: pre.slice(-45).map((k) => [k.t, k.c]),
      after: candles.slice(anchor.index + 1, anchor.index + 46).map((k) => [k.t, k.c]),
    },
    ageAtAnchorDays: round(ageDays, 0),
    computedAt: new Date(nowMs).toISOString(),
  };
}

/** Candidate fingerprint in natural units (mirrors the reference fields). */
export function candidateRaw(asset, lf, d1, oc) {
  return {
    mcapUsd: lf.mcap,
    turnover: lf.turnoverSmoothed ?? lf.turnover,
    volAccel: d1?.volAccel ?? lf.turnoverAccel ?? null,
    slope30: d1?.slope30 ?? null,
    r2_30: d1?.r2_30 ?? null,
    rangePos30: d1?.rangePos30 ?? null,
    compression: d1?.compression ?? null,
    athChangePct: lf.athChangePct,
    change30: lf.change30d ?? d1?.change30 ?? null,
    ageDays: lf.ageDays,
    floatRatio: lf.floatRatio,
    top10Pct: oc?.top10EffectivePct ?? oc?.top10Pct ?? null,
    perpVenues: lf.perpsKnown ? lf.perpVenues : null,
    chain: asset.primary?.chain ?? (lf.platformsKnown ? 'native' : null),
    alphaListed: lf.alphaStatus === 'LISTED' ? true : lf.alphaStatus === 'NOT_LISTED' ? false : null,
  };
}
