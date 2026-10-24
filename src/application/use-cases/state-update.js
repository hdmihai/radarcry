/**
 * Use-case helpers that evolve the research state between runs with bounded retention:
 * history points (compacted to 1/day after 72h), catalyst log, telemetry, last-seen research state.
 */
import { isNum, round, sig } from '../../domain/shared/math.js';
import { DAY_MS, HOUR_MS, isoDay, toMs } from '../../domain/shared/time.js';

/**
 * Append one point per tracked asset and compact old points.
 * @param {Record<string,{points:any[], lastSeen:string}>} history
 * @param {{key:string, point:any}[]} rows
 */
export function appendHistory(history, rows, nowMs, cfg) {
  const next = {};
  const nowIso = new Date(nowMs).toISOString();
  const seenNow = new Set(rows.map((r) => r.key));
  for (const [key, h] of Object.entries(history ?? {})) {
    if (seenNow.has(key)) continue;
    if (nowMs - toMs(h.lastSeen) <= cfg.dropUnseenDays * DAY_MS) next[key] = h;
  }
  for (const { key, point } of rows) {
    const prev = history?.[key]?.points ?? [];
    const points = compact([...prev, { t: nowIso, ...point }], nowMs, cfg);
    next[key] = { points, lastSeen: nowIso };
  }
  return next;
}

function compact(points, nowMs, cfg) {
  const recent = [];
  const byDay = new Map();
  for (const p of points) {
    const t = toMs(p.t);
    if (!isNum(t) || nowMs - t > cfg.maxDays * DAY_MS) continue;
    if (nowMs - t <= 72 * HOUR_MS) recent.push(p);
    else byDay.set(isoDay(t), p); // keeps the last point of each day
  }
  return [...byDay.values(), ...recent].sort((a, b) => toMs(a.t) - toMs(b.t)).slice(-cfg.maxPointsPerAsset);
}

/** Compact point stored for every eligible asset (light) — deep fields when available. */
export function historyPoint(r) {
  const lf = r.lf;
  return {
    price: sig(lf.price, 7),
    mcap: isNum(lf.mcap) ? Math.round(lf.mcap) : null,
    turnover: isNum(lf.turnover) ? round(lf.turnover, 5) : null,
    rank: lf.rankNow ?? null,
    oiUsd: isNum(lf.oiUsd) ? Math.round(lf.oiUsd) : null,
    funding: isNum(lf.fundingAvg) ? sig(lf.fundingAvg, 4) : null,
    cri: r.cri,
    stage: r.stageInfo.stage,
    signal: r.signal.type,
    holders: r.oc?.holders ?? null,
    watchlist: r.detail?.watchlistUsers ?? null,
    cgTrending: r.asset.attention?.cgTrending ?? null,
    walletNet: isNum(r.oc?.walletFlows?.netflowRatio) ? round(r.oc.walletFlows.netflowRatio, 3) : null,
  };
}

export function appendCatalysts(log, events, nowMs, retentionDays) {
  const byId = new Map((log ?? []).map((e) => [e.id, e]));
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()]
    .filter((e) => nowMs - toMs(e.observedAt) <= retentionDays * DAY_MS)
    .sort((a, b) => toMs(b.observedAt) - toMs(a.observedAt));
}

export function appendTelemetry(log, runSummary, keep = 120) {
  return [...(log ?? []), runSummary].slice(-keep);
}

/** Success rate per provider over the retained runs (for the health panel). */
export function providerSuccessRates(log) {
  const acc = {};
  for (const run of log ?? []) {
    for (const [p, s] of Object.entries(run.providers ?? {})) {
      const a = (acc[p] ??= { calls: 0, ok: 0, runs: 0 });
      a.calls += s.calls;
      a.ok += s.ok;
      a.runs += 1;
    }
  }
  const out = {};
  for (const [p, a] of Object.entries(acc)) out[p] = { runs: a.runs, successRate: a.calls ? round((a.ok / a.calls) * 100, 1) : null };
  return out;
}

/* ────────────────────────── v4 state: quota ledger, holder-flow snapshots, journal ─────────── */

/**
 * Keep a bounded series of classified holder snapshots per asset, dropping assets we have not seen
 * for a while so the state does not grow without limit.
 */
export function appendFlows(flows, rows, nowMs, cfg) {
  const next = {};
  const seenNow = new Set(rows.map((r) => r.key));
  for (const [key, series] of Object.entries(flows ?? {})) {
    if (seenNow.has(key)) continue;
    const last = Array.isArray(series) && series.length ? series[series.length - 1]?.at : null;
    if (isNum(last) && nowMs - last <= cfg.dropUnseenDays * DAY_MS) next[key] = series;
  }
  for (const { key, snapshot } of rows) {
    if (!snapshot) {
      const existing = flows?.[key];
      if (existing) next[key] = existing;
      continue;
    }
    const prev = flows?.[key] ?? [];
    const merged = [...prev, snapshot]
      .filter((s) => s && isNum(s.at) && nowMs - s.at <= cfg.maxDays * DAY_MS)
      .sort((a, b) => a.at - b.at);
    // One snapshot per hour at most.
    const seen = new Set();
    const out = [];
    for (let i = merged.length - 1; i >= 0; i -= 1) {
      const h = Math.floor(merged[i].at / HOUR_MS);
      if (seen.has(h)) continue;
      seen.add(h);
      out.unshift(merged[i]);
    }
    next[key] = out.slice(-(cfg.flowSnapshots ?? 24));
  }
  return next;
}

/** The point appended to each asset's own history by the v4 discovery pipeline. */
export function discoveryPoint(row, nowMs) {
  const m = row.current ?? {};
  const v = row.verdict ?? {};
  return {
    at: nowMs,
    metrics: {
      ...m,
      circulating: row.asset?.market?.circulating ?? null,
    },
    verdict: {
      stage: v.stage ?? null,
      opportunity: isNum(v.opportunity) ? round(v.opportunity, 1) : null,
      risk: v.risk ?? null,
      earliness: v.earliness ?? null,
      confidence: v.confidence ?? null,
      changes: row.changed?.count ?? null,
      families: row.changed?.familyCount ?? null,
    },
  };
}

/** Append v4 discovery points with the same retention policy as the legacy history. */
export function appendDiscoveryHistory(history, rows, nowMs, cfg) {
  const next = {};
  const seenNow = new Set(rows.map((r) => r.key));
  for (const [key, h] of Object.entries(history ?? {})) {
    if (seenNow.has(key)) continue;
    const last = h?.points?.length ? h.points[h.points.length - 1]?.at : null;
    if (isNum(last) && nowMs - last <= cfg.dropUnseenDays * DAY_MS) next[key] = h;
  }
  for (const { key, point } of rows) {
    const prev = history?.[key]?.points ?? [];
    const merged = [...prev, point]
      .filter((p) => p && isNum(p.at) && nowMs - p.at <= cfg.maxDays * DAY_MS)
      .sort((a, b) => a.at - b.at);
    // Keep every point from the last 72h, then one per day.
    const recent = [];
    const byDay = new Map();
    for (const p of merged) {
      if (nowMs - p.at <= 72 * HOUR_MS) recent.push(p);
      else byDay.set(isoDay(p.at), p);
    }
    next[key] = {
      points: [...byDay.values(), ...recent].sort((a, b) => a.at - b.at).slice(-cfg.maxPointsPerAsset),
      lastSeen: new Date(nowMs).toISOString(),
    };
  }
  return next;
}
