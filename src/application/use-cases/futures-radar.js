/**
 * USE-CASE: FUTURES RADAR — section ① of the dashboard.
 *
 * For every instrument of the universe that has a perpetual market (the configured majors first,
 * then the Small-Cap Radar's order, then the rest of the top 1000 by open interest — up to
 * `futures.maxInstruments`), take 1D and 4H candles plus derivatives data and run the five-block
 * grading from the technical solution. Candles already read by the deep research are reused, so the
 * wider horizon costs calls only for the large caps the small-cap research does not cover.
 * Everything is research output: entry zones, invalidation and targets are levels derived from
 * structure, and no part of this project places or transmits an order.
 */
import { isNum, round, toNum } from '../../domain/shared/math.js';
import { dailyTrend } from '../../domain/futures/trend.js';
import { fourHourSetup, tradeLevels } from '../../domain/futures/setup.js';
import { positioning, toPct8h } from '../../domain/futures/positioning.js';
import { liquidationMap } from '../../domain/futures/liquidation-model.js';
import { futuresGrade, liquidityScore, volumeVolatilityScore } from '../../domain/futures/grade.js';
import { dailyFeatures } from '../../domain/features/daily.js';
import { derivativesFacts } from './discovery.js';

const STOP = new Set(['BUDGET_EXHAUSTED', 'CIRCUIT_OPEN', 'QUOTA_EXHAUSTED', 'NOT_CONFIGURED', 'GEO_BLOCKED']);

/**
 * Choose which assets get the futures treatment: the configured watchlist first (so the section is
 * never empty), then the Small-Cap Radar's candidates in its own order, then every other asset of
 * the universe with a perpetual market, deepest open interest first — up to `maxInstruments`.
 * Without `maxInstruments` the radar keeps its original size: the watchlist plus `extraFromRadar`.
 */
export function pickWatchlist({ assets, radarRows, cfg }) {
  const bySymbol = new Map();
  for (const a of assets) {
    const prev = bySymbol.get(a.symbol);
    if (!prev || (a.market?.marketCap ?? 0) > (prev.market?.marketCap ?? 0)) bySymbol.set(a.symbol, a);
  }
  const chosen = [];
  const seen = new Set();
  const take = (a, reason) => {
    chosen.push({ asset: a, reason });
    seen.add(a.key);
  };
  for (const sym of cfg.watchlist ?? []) {
    const a = bySymbol.get(sym);
    if (a && !seen.has(a.key)) take(a, 'listă de urmărire configurată');
  }
  const max = Number.isFinite(cfg.maxInstruments) ? cfg.maxInstruments : (cfg.watchlist?.length ?? 0) + (cfg.extraFromRadar ?? 10);
  for (const r of radarRows ?? []) {
    if (chosen.length >= max) break;
    const a = r.asset;
    if (!a || seen.has(a.key)) continue;
    if (!(a.venues?.perps?.length)) continue;
    take(a, `din Small-Cap Radar (${r.verdict?.bandLabel ?? 'candidat'})`);
  }
  if (Number.isFinite(cfg.maxInstruments)) {
    const oi = (a) => (a.venues?.perps ?? []).reduce((sum, p) => sum + (toNum(p.oiUsd) ?? 0), 0);
    const rest = assets.filter((a) => a.venues?.perps?.length && !seen.has(a.key))
      .sort((x, y) => oi(y) - oi(x) || (y.market?.marketCap ?? 0) - (x.market?.marketCap ?? 0));
    for (const a of rest) {
      if (chosen.length >= max) break;
      take(a, 'piață perpetuă în universul scanat');
    }
  }
  return chosen;
}

/** Resolve each watchlist symbol to its Coinalyze market symbols, per venue. */
export function mapCoinalyzeSymbols(markets, symbols) {
  const out = new Map();
  for (const m of markets ?? []) {
    if (!symbols.has(m.base)) continue;
    if (m.quote && !['USDT', 'USD', 'USDC'].includes(m.quote)) continue;
    const list = out.get(m.base) ?? [];
    if (list.length < 6) list.push(m);
    out.set(m.base, list);
  }
  return out;
}

/**
 * Build the derivatives payload for one base asset from the Coinalyze responses.
 */
export function coinalyzePayload({ markets, funding, oi, oiHistory, liquidations }) {
  const byVenue = {};
  let oiUsd = 0;
  let oiKnown = false;
  for (const m of markets ?? []) {
    const f = funding?.get?.(m.symbol) ?? null;
    if (f && isNum(f.value)) byVenue[m.venue] = f.value;
    const o = oi?.get?.(m.symbol) ?? null;
    if (o && isNum(o.value)) { oiUsd += o.value; oiKnown = true; }
  }
  // Open-interest change over 24h from the history series of the deepest venue.
  let oiChangePct24h = null;
  for (const m of markets ?? []) {
    const hist = oiHistory?.get?.(m.symbol) ?? null;
    if (!Array.isArray(hist) || hist.length < 7) continue;
    const last = hist[hist.length - 1];
    const target = last.t - 24 * 3_600_000;
    let before = null;
    for (const p of hist) if (p.t <= target && (!before || p.t > before.t)) before = p;
    if (before && isNum(before.c) && before.c > 0 && isNum(last.c)) {
      oiChangePct24h = round((last.c / before.c - 1) * 100, 2);
      break;
    }
  }
  let liqLong = null;
  let liqShort = null;
  for (const m of markets ?? []) {
    const hist = liquidations?.get?.(m.symbol) ?? null;
    if (!Array.isArray(hist) || !hist.length) continue;
    const cutoff = hist[hist.length - 1].t - 24 * 3_600_000;
    for (const p of hist) {
      if (p.t < cutoff) continue;
      if (isNum(p.long)) liqLong = (liqLong ?? 0) + p.long;
      if (isNum(p.short)) liqShort = (liqShort ?? 0) + p.short;
    }
  }
  return {
    funding: Object.fromEntries(Object.entries(byVenue).map(([v, value]) => [v, { value }])),
    oiUsd: oiKnown ? oiUsd : null,
    oiChangePct24h,
    liqLong24hUsd: liqLong,
    liqShort24hUsd: liqShort,
    venues: (markets ?? []).map((m) => m.venue),
  };
}

/**
 * @param {{watchlist:{asset:any, reason:string}[], providers:any, cfg:any,
 *          timeLeft:()=>number, logger:any, nowMs:number, candles?:Map<string, any>|null}} input
 *   `candles` — what the deep research already read (key → {d1, h4, d1Source}); those instruments
 *   are not fetched again.
 */
export async function runFuturesRadar({ watchlist, providers: P, cfg, timeLeft, logger, nowMs, candles = null }) {
  const usage = {};
  const track = (provider, r) => {
    const u = (usage[provider] ??= { calls: 0, ok: 0, units: 0, lastStatus: null, lastMessage: '' });
    u.calls += 1;
    u.units += r?.meta?.units ?? 0;
    if (r?.ok) u.ok += 1;
    else { u.lastStatus = r?.status ?? 'NETWORK_ERROR'; u.lastMessage = r?.message ?? ''; }
    return r;
  };
  const enough = (ms = 40_000) => timeLeft() > ms;

  /* ── derivatives, once for the whole watchlist ─────────────────────────────────────────────── */
  const symbols = new Set(watchlist.map((w) => w.asset.symbol));
  let coinalyzeBySymbol = new Map();
  let coinalyzeNote = null;
  if (P.coinalyze) {
    const mk = track('coinalyze', await P.coinalyze.markets());
    if (mk.ok) {
      const mapped = mapCoinalyzeSymbols(mk.data, symbols);
      const allSymbols = [...mapped.values()].flat().map((m) => m.symbol);
      const budget = cfg.coinalyze?.maxSymbols ?? 20;
      const slice = allSymbols.slice(0, budget * 3);
      const [funding, oi] = await Promise.all([
        P.coinalyze.current('funding-rate', slice).then((r) => track('coinalyze', r)),
        P.coinalyze.current('open-interest', slice).then((r) => track('coinalyze', r)),
      ]);
      // History only for the deepest market of each symbol, to stay inside 40 calls/minute; the
      // adapter takes 20 symbols per call, so a wider budget is read in batches.
      const primary = [...mapped.values()].map((list) => list[0]?.symbol).filter(Boolean).slice(0, budget);
      const fromSec = Math.floor((nowMs - (cfg.coinalyze?.historyDays ?? 14) * 86_400_000) / 1000);
      const toSec = Math.floor(nowMs / 1000);
      const batched = async (kind) => {
        const merged = new Map();
        let last = { ok: false, data: null, status: 'SKIPPED' };
        for (let i = 0; i < primary.length; i += 20) {
          if (!enough(60_000)) break;
          const r = track('coinalyze', await P.coinalyze.history(kind, primary.slice(i, i + 20), '4hour', fromSec, toSec));
          last = r;
          if (r.ok) for (const [k, v] of r.data) merged.set(k, v);
          else if (STOP.has(r.status)) break;
        }
        return merged.size ? { ok: true, data: merged, status: 'OK' } : last;
      };
      const [oiHistory, liquidations] = await Promise.all([batched('open-interest-history'), batched('liquidation-history')]);

      for (const [base, list] of mapped) {
        coinalyzeBySymbol.set(base, coinalyzePayload({
          markets: list,
          funding: funding.ok ? funding.data : null,
          oi: oi.ok ? oi.data : null,
          oiHistory: oiHistory.ok ? oiHistory.data : null,
          liquidations: liquidations.ok ? liquidations.data : null,
        }));
      }
      coinalyzeNote = P.coinalyze.attribution ?? null;
    } else if (STOP.has(mk.status)) {
      coinalyzeNote = mk.message ?? null;
      logger?.debug?.(`coinalyze indisponibil: ${mk.status}`);
    }
  }

  /* ── candles: reuse the deep research, fetch the rest (one lane per venue) ─────────────────────── */
  const bars = new Map();
  const missing = [];
  for (const { asset } of watchlist) {
    const c = candles?.get?.(asset.key);
    if (c?.d1?.length && c?.h4?.length) bars.set(asset.key, { d1: c.d1, h4: c.h4, source: c.d1Source ?? null });
    else missing.push(asset);
  }
  const lanes = new Map();
  for (const asset of missing) {
    const venueSym = asset.venues?.binanceSpot?.symbol ?? asset.venues?.mexcSpot?.symbol ?? null;
    const api = asset.venues?.binanceSpot ? P.binanceSpot : asset.venues?.mexcSpot ? P.mexc : null;
    if (!venueSym || !api?.klines) continue;
    if (!lanes.has(api.id)) lanes.set(api.id, []);
    lanes.get(api.id).push({ asset, api, venueSym });
  }
  await Promise.all([...lanes.values()].map(async (list) => {
    let i = 0;
    const worker = async () => {
      while (i < list.length && enough(35_000)) {
        const { asset, api, venueSym } = list[i];
        i += 1;
        const [rd, rh] = await Promise.all([
          api.klines(venueSym, '1d', cfg.klines?.d1Limit ?? 260).then((r) => track(api.id, r)),
          api.klines(venueSym, '4h', cfg.klines?.h4Limit ?? 260).then((r) => track(api.id, r)),
        ]);
        bars.set(asset.key, { d1: rd.ok && rd.data.length ? rd.data : null, h4: rh.ok && rh.data.length ? rh.data : null, source: rd.ok && rd.data.length ? api.id : null });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker));
  }));

  /* ── per asset ─────────────────────────────────────────────────────────────────────────────── */
  const rows = [];
  for (const { asset, reason } of watchlist) {
    if (!enough(20_000)) break;
    const b = bars.get(asset.key) ?? null;
    const d1 = b?.d1 ?? null;
    const h4 = b?.h4 ?? null;
    const candleSource = d1 ? b.source : null;

    const coinalyze = coinalyzeBySymbol.get(asset.symbol) ?? null;
    const derivatives = derivativesFacts(asset, { coinalyze });
    const trend = d1 ? dailyTrend(d1) : null;
    const setup = h4 ? fourHourSetup(h4) : null;
    const daily = d1 ? dailyFeatures(d1) : null;
    const pos = positioning({ ...derivatives, venues: derivatives.venues });
    const liq = liquidityScore({
      volume24hUsd: asset.market?.volume24h ?? null,
      turnover: asset.derived?.turnover ?? null,
      perpVolume24hUsd: derivatives.perpVolume24hUsd,
      oiUsd: derivatives.oiUsd,
      depthUsd: asset.onchain?.liquidityUsd ?? null,
      venues: derivatives.venues,
    });
    const vol = volumeVolatilityScore({
      volAccel: daily?.volAccel ?? null,
      compression: daily?.compression ?? null,
      atrPct: daily?.atrPct14 ?? null,
      rvol: null,
      changePct24h: asset.market?.change?.h24 ?? null,
    });
    const levels = setup ? tradeLevels(setup, trend) : null;
    const grade = futuresGrade({ trend, setup, positioning: pos, liquidity: liq, volume: vol, levels });
    const liqMap = h4 && isNum(asset.market?.price)
      ? liquidationMap({ candles: h4, oiUsd: derivatives.oiUsd, funding: pos.funding, price: asset.market.price })
      : null;

    rows.push({
      key: asset.key,
      symbol: asset.symbol,
      name: asset.name,
      reason,
      price: asset.market?.price ?? null,
      marketCap: asset.market?.marketCap ?? null,
      change: { h24: asset.market?.change?.h24 ?? null, d7: asset.market?.change?.d7 ?? null },
      candleSource,
      trend,
      setup,
      positioning: pos,
      liquidity: liq,
      volume: vol,
      levels,
      grade,
      liquidationMap: liqMap,
      derivatives,
      bars: { d1: d1?.length ?? 0, h4: h4?.length ?? 0 },
    });
    // The asset carries its futures view so the discovery engine can read the structure change.
    asset.futures = { trend, setup, grade, levels };
  }

  const graded = rows.filter((r) => r.grade.grade !== 'NO_TRADE');
  return {
    rows: rows.sort((a, b) => (b.grade.score ?? -1) - (a.grade.score ?? -1)),
    usage,
    summary: {
      scanned: rows.length,
      graded: graded.length,
      best: graded[0] ? { symbol: graded[0].symbol, grade: graded[0].grade.grade, score: graded[0].grade.score } : null,
      byGrade: rows.reduce((acc, r) => { acc[r.grade.grade] = (acc[r.grade.grade] ?? 0) + 1; return acc; }, {}),
      derivativesSource: coinalyzeNote,
      note: 'Note de research. Nivelele provin din structura 4H; proiectul nu execută și nu transmite ordine.',
    },
  };
}

/** Compact the futures rows for the published snapshot. */
export function futuresView(row) {
  const t = row.trend;
  const s = row.setup;
  return {
    key: row.key,
    symbol: row.symbol,
    name: row.name,
    reason: row.reason,
    price: row.price,
    marketCap: row.marketCap,
    change: row.change,
    grade: {
      grade: row.grade.grade,
      rawGrade: row.grade.rawGrade,
      score: row.grade.score,
      confidence: row.grade.confidence,
      coverage: row.grade.coverage,
      verdict: row.grade.verdict,
      caps: row.grade.caps,
      blocked: row.grade.blocked,
      blocks: row.grade.blocks,
      missing: row.grade.missing,
      reasons: row.grade.reasons.slice(0, 8),
    },
    trend: t ? {
      regime: t.regime,
      score: t.score,
      structure: t.structure,
      rsi14: t.rsi14,
      ema20: t.ema20,
      ema50: t.ema50,
      ema200: t.ema200,
      distToEma50Pct: t.distToEma50Pct,
      blocksLong: t.blocksLong,
      reasons: t.reasons.slice(0, 5),
    } : null,
    setup: s ? {
      score: s.score,
      structure: s.smc.structure,
      lastEvent: s.smc.lastEvent,
      orderBlocks: s.smc.orderBlocks,
      fvgs: s.smc.fvgs,
      sweep: s.smc.sweep,
      dealingRange: s.smc.dealingRange,
      entryZone: s.entryZone,
      chasePct: s.chasePct,
      chasing: s.chasing,
      reasons: s.reasons.slice(0, 6),
    } : null,
    positioning: {
      score: row.positioning.score,
      funding: row.positioning.funding,
      fundingPct8h: row.positioning.fundingPct8h,
      fundingSpreadPct: row.positioning.fundingSpreadPct,
      regime: row.positioning.regime,
      oiToMcap: row.positioning.oiToMcap,
      reasons: row.positioning.reasons.slice(0, 5),
    },
    liquidity: { score: row.liquidity.score, reasons: row.liquidity.reasons.slice(0, 3) },
    volume: { score: row.volume.score, reasons: row.volume.reasons.slice(0, 3) },
    levels: row.levels,
    liquidationMap: row.liquidationMap ? {
      modelled: true,
      clusters: row.liquidationMap.clusters,
      magnetBelow: row.liquidationMap.magnetBelow,
      magnetAbove: row.liquidationMap.magnetAbove,
      longShare: row.liquidationMap.longShare,
      assumptions: row.liquidationMap.assumptions,
      note: row.liquidationMap.note,
    } : null,
    derivatives: {
      venues: row.derivatives.venues,
      venueNames: row.derivatives.venueNames,
      fundingByVenue: row.derivatives.fundingByVenue,
      oiUsd: row.derivatives.oiUsd,
      oiChangePct24h: row.derivatives.oiChangePct24h,
      perpVolume24hUsd: row.derivatives.perpVolume24hUsd,
      source: row.derivatives.source,
    },
    bars: row.bars,
    candleSource: row.candleSource,
  };
}

export const futuresTotals = (rows) => ({
  oiUsd: rows.reduce((s, r) => s + (toNum(r.derivatives?.oiUsd) ?? 0), 0) || null,
});
