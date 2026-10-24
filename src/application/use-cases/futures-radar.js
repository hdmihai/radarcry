/**
 * USE-CASE: FUTURES RADAR — section ① of the dashboard.
 *
 * For a bounded watchlist (the configured majors plus whatever the Small-Cap Radar surfaced that has
 * a perpetual market), collect 1D and 4H candles plus derivatives data and run the five-block grading
 * from the technical solution. Everything is research output: entry zones, invalidation and targets
 * are levels derived from structure, and no part of this project places or transmits an order.
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
 * never empty), then the highest-ranked radar candidates that actually have a perpetual market.
 */
export function pickWatchlist({ assets, radarRows, cfg }) {
  const bySymbol = new Map();
  for (const a of assets) {
    const prev = bySymbol.get(a.symbol);
    if (!prev || (a.market?.marketCap ?? 0) > (prev.market?.marketCap ?? 0)) bySymbol.set(a.symbol, a);
  }
  const chosen = [];
  const seen = new Set();
  for (const sym of cfg.watchlist ?? []) {
    const a = bySymbol.get(sym);
    if (a && !seen.has(a.key)) { chosen.push({ asset: a, reason: 'listă de urmărire configurată' }); seen.add(a.key); }
  }
  const extra = cfg.extraFromRadar ?? 10;
  for (const r of radarRows ?? []) {
    if (chosen.length >= (cfg.watchlist?.length ?? 0) + extra) break;
    const a = r.asset;
    if (!a || seen.has(a.key)) continue;
    if (!(a.venues?.perps?.length)) continue;
    chosen.push({ asset: a, reason: `din Small-Cap Radar (${r.verdict?.bandLabel ?? 'candidat'})` });
    seen.add(a.key);
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
 *          timeLeft:()=>number, logger:any, nowMs:number}} input
 */
export async function runFuturesRadar({ watchlist, providers: P, cfg, timeLeft, logger, nowMs }) {
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
      // History only for the deepest market of each symbol, to stay inside 40 calls/minute.
      const primary = [...mapped.values()].map((list) => list[0]?.symbol).filter(Boolean).slice(0, budget);
      const fromSec = Math.floor((nowMs - (cfg.coinalyze?.historyDays ?? 14) * 86_400_000) / 1000);
      const toSec = Math.floor(nowMs / 1000);
      const [oiHistory, liquidations] = enough(60_000)
        ? await Promise.all([
          P.coinalyze.history('open-interest-history', primary, '4hour', fromSec, toSec).then((r) => track('coinalyze', r)),
          P.coinalyze.history('liquidation-history', primary, '4hour', fromSec, toSec).then((r) => track('coinalyze', r)),
        ])
        : [{ ok: false, data: null, status: 'SKIPPED' }, { ok: false, data: null, status: 'SKIPPED' }];

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

  /* ── per asset ─────────────────────────────────────────────────────────────────────────────── */
  const rows = [];
  for (const { asset, reason } of watchlist) {
    if (!enough(35_000)) break;
    const venueSym = asset.venues?.binanceSpot?.symbol ?? asset.venues?.mexcSpot?.symbol ?? null;
    const api = asset.venues?.binanceSpot ? P.binanceSpot : asset.venues?.mexcSpot ? P.mexc : null;
    let d1 = null;
    let h4 = null;
    let candleSource = null;
    if (venueSym && api?.klines) {
      const [rd, rh] = await Promise.all([
        api.klines(venueSym, '1d', cfg.klines?.d1Limit ?? 260).then((r) => track(api.id, r)),
        api.klines(venueSym, '4h', cfg.klines?.h4Limit ?? 260).then((r) => track(api.id, r)),
      ]);
      if (rd.ok && rd.data.length) { d1 = rd.data; candleSource = api.id; }
      if (rh.ok && rh.data.length) h4 = rh.data;
    }

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
