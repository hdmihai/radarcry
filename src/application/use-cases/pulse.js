/**
 * USE-CASE: PULSE — the 15-minute refresh between full scans.
 *
 * A full scan is expensive: it reads two aggregator universes, candles for the shortlist, holder
 * lists, contract security, development and attention. Running that every 15 minutes would burn
 * every free plan in a day. But the facts that move inside 15 minutes are a small, cheap subset:
 * price, 24-hour change, funding and open interest — all available from keyless exchange endpoints
 * plus one Coinalyze batch.
 *
 * So the pulse re-reads only those, recomputes only what depends on them (the positioning block of
 * the Futures Radar, the squeeze watch, and the derivative facts shown on each card), and republishes
 * the same snapshot with the fresh numbers. Everything derived from the full scan keeps its own
 * `asOf`, so the dashboard can show plainly which parts are minutes old and which are hours old
 * instead of implying the whole page was just recomputed.
 *
 * Cost of one pulse: ~8 keyless calls plus at most 3 Coinalyze batches. Nothing with a monthly quota
 * is touched.
 */
import { isNum, round, toNum } from '../../domain/shared/math.js';
import { normSymbol } from '../../domain/shared/symbols.js';
import { positioning, toPct8h } from '../../domain/futures/positioning.js';
import { futuresGrade, liquidityScore, volumeVolatilityScore } from '../../domain/futures/grade.js';
import { mapCoinalyzeSymbols, coinalyzePayload } from './futures-radar.js';

export class NoSnapshotError extends Error {}

const DEFAULT = { ok: false, status: 'SKIPPED', data: null, message: 'neconfigurat', meta: {} };
const safe = async (fn) => {
  try { return (await fn()) ?? DEFAULT; } catch (err) { return { ...DEFAULT, status: 'NETWORK_ERROR', message: String(err?.message ?? err) }; }
};

/** Index the venue responses by base symbol, keeping the deepest market per symbol. */
function priceIndex({ mexc, binance }) {
  const out = new Map();
  const put = (base, row) => {
    const prev = out.get(base);
    if (!prev || (row.quoteVolume ?? 0) > (prev.quoteVolume ?? 0)) out.set(base, row);
  };
  for (const t of binance?.ok ? binance.data : []) put(normSymbol(t.base), { price: t.last, changePct: t.changePct, quoteVolume: t.quoteVolume, venue: 'binance_spot' });
  for (const t of mexc?.ok ? mexc.data : []) put(normSymbol(t.base), { price: t.last, changePct: t.changePct, quoteVolume: t.quoteVolume, venue: 'mexc' });
  return out;
}

/** Aggregate every perp response into per-symbol funding (percent per 8h) and open interest. */
function perpIndex(venues) {
  const out = new Map();
  for (const { venue, res } of venues) {
    if (!res?.ok) continue;
    for (const p of res.data) {
      const base = normSymbol(p.base);
      const row = out.get(base) ?? { fundingByVenue: {}, oiUsd: 0, oiKnown: false, volume24hUsd: 0, venues: new Set() };
      const pct = toPct8h(p.fundingRate, { intervalHours: p.fundingIntervalHours ?? 8, alreadyPercent: false });
      if (isNum(pct)) row.fundingByVenue[venue] = round(pct, 5);
      if (isNum(p.oiUsd)) { row.oiUsd += p.oiUsd; row.oiKnown = true; }
      if (isNum(p.volume24hUsd)) row.volume24hUsd += p.volume24hUsd;
      row.venues.add(venue);
      out.set(base, row);
    }
  }
  return out;
}

/**
 * @param {{clock:any, logger:any, telemetry:any, providers:any, publisher:any, reader:() => Promise<any>}} deps
 * @param {any} config
 */
export async function runPulse(deps, config) {
  const { clock, logger, providers: P, publisher } = deps;
  const nowMs = clock.now();
  const nowIso = new Date(nowMs).toISOString();

  const snapshot = await deps.reader();
  if (!snapshot || !snapshot.meta) {
    throw new NoSnapshotError('Nu există un snapshot publicat de actualizat. Rulează întâi o scanare completă.');
  }
  logger.info(`CRI pulse — actualizez prețuri, funding și open interest peste snapshot-ul ${snapshot.meta.runId}`);

  /* ── the cheap reads ───────────────────────────────────────────────────────────────────────── */
  const [mexcSpot, binanceSpot, mexcPerps, gate, bitget, okx, hyperliquid] = await Promise.all([
    safe(() => P.mexc.spotTickers()),
    safe(() => P.binanceSpot.spotTickers()),
    safe(() => P.mexc.perps()),
    safe(() => P.gate.perps()),
    safe(() => P.bitget.perps()),
    safe(() => P.okx.perps()),
    safe(() => P.hyperliquid.perps()),
  ]);

  const prices = priceIndex({ mexc: mexcSpot, binance: binanceSpot });
  const perps = perpIndex([
    { venue: 'mexc', res: mexcPerps }, { venue: 'gate', res: gate }, { venue: 'bitget', res: bitget },
    { venue: 'okx', res: okx }, { venue: 'hyperliquid', res: hyperliquid },
  ]);

  if (!prices.size && !perps.size) {
    logger.warn('pulse: nicio bursă nu a răspuns — snapshot-ul rămâne neschimbat');
    return { snapshot, published: null, summary: { updated: 0, prices: 0, perpSymbols: 0, coinalyze: 0, fullScanAt: snapshot.meta.generatedAt, note: 'nicio sursă disponibilă' } };
  }

  // One Coinalyze batch for the futures watchlist, when the free key is configured.
  const watchSymbols = new Set((snapshot.futures?.rows ?? []).map((r) => r.symbol));
  const coinalyzeBySymbol = new Map();
  if (P.coinalyze && watchSymbols.size) {
    const mk = await safe(() => P.coinalyze.markets());
    if (mk.ok) {
      const mapped = mapCoinalyzeSymbols(mk.data, watchSymbols);
      const symbols = [...mapped.values()].flat().map((m) => m.symbol).slice(0, (config.futures?.coinalyze?.maxSymbols ?? 20) * 3);
      const [funding, oi] = await Promise.all([
        safe(() => P.coinalyze.current('funding-rate', symbols)),
        safe(() => P.coinalyze.current('open-interest', symbols)),
      ]);
      for (const [base, list] of mapped) {
        coinalyzeBySymbol.set(base, coinalyzePayload({
          markets: list,
          funding: funding.ok ? funding.data : null,
          oi: oi.ok ? oi.data : null,
          oiHistory: null,
          liquidations: null,
        }));
      }
    }
  }

  /* ── apply to the published snapshot ───────────────────────────────────────────────────────── */
  const next = structuredClone(snapshot);
  let updated = 0;

  /** Fresh derivative facts for one symbol, merging exchange reads with the Coinalyze batch. */
  const derivativesFor = (symbol, marketCap, previous) => {
    const p = perps.get(normSymbol(symbol));
    const ca = coinalyzeBySymbol.get(symbol);
    const byVenue = { ...(p?.fundingByVenue ?? {}) };
    for (const [venue, row] of Object.entries(ca?.funding ?? {})) {
      const pct = toPct8h(row.value, { intervalHours: 8, alreadyPercent: true });
      if (isNum(pct)) byVenue[venue] = round(pct, 5);
    }
    const vals = Object.values(byVenue).filter(isNum);
    const oiUsd = isNum(ca?.oiUsd) ? ca.oiUsd : p?.oiKnown ? p.oiUsd : null;
    if (!vals.length && !isNum(oiUsd)) return null;
    return {
      venues: Object.keys(byVenue).length || previous?.venues || 0,
      venueNames: [...new Set([...(p?.venues ?? []), ...Object.keys(ca?.funding ?? {})])],
      fundingPct8h: vals.length ? round(vals.reduce((s, x) => s + x, 0) / vals.length, 5) : previous?.fundingPct8h ?? null,
      fundingByVenue: byVenue,
      oiUsd: isNum(oiUsd) ? Math.round(oiUsd) : previous?.oiUsd ?? null,
      oiToMcap: isNum(oiUsd) && isNum(marketCap) && marketCap > 0 ? round(oiUsd / marketCap, 4) : previous?.oiToMcap ?? null,
      oiChangePct24h: isNum(ca?.oiChangePct24h) ? ca.oiChangePct24h : previous?.oiChangePct24h ?? null,
      perpVolume24hUsd: isNum(p?.volume24hUsd) && p.volume24hUsd > 0 ? Math.round(p.volume24hUsd) : previous?.perpVolume24hUsd ?? null,
      source: Object.keys(ca?.funding ?? {}).length ? 'coinalyze + burse publice' : 'burse publice',
    };
  };

  /** Refresh the price block of one published row in place. */
  const refreshMarket = (market, symbol) => {
    const q = prices.get(normSymbol(symbol));
    if (!q || !isNum(q.price)) return false;
    market.price = q.price;
    if (isNum(q.changePct)) market.change = { ...(market.change ?? {}), h24: round(q.changePct, 2) };
    return true;
  };

  // ① Futures Radar — the section a pulse exists for. The positioning block and the grade are
  //    recomputed from the fresh funding and open interest; trend and structure keep their own
  //    `asOf`, because candles have not been re-read.
  for (const row of next.futures?.rows ?? []) {
    const touched = refreshMarket(row, row.symbol) | 0;
    const d = derivativesFor(row.symbol, row.marketCap, row.derivatives);
    if (!d) { if (touched) updated += 1; continue; }
    row.derivatives = d;
    const pos = positioning({ ...d, pricePct24h: row.change?.h24 ?? null, venues: d.venues });
    row.positioning = {
      score: pos.score,
      funding: pos.funding,
      fundingPct8h: pos.fundingPct8h,
      fundingSpreadPct: pos.fundingSpreadPct,
      regime: pos.regime,
      oiToMcap: pos.oiToMcap,
      reasons: pos.reasons.slice(0, 5),
    };
    // Re-grade with the blocks that are still valid, so the note reflects the new positioning.
    const grade = futuresGrade({
      trend: row.trend ? { ...row.trend, bars: row.bars?.d1 ?? 0 } : null,
      setup: row.setup ? { score: row.setup.score, smc: { close: row.price, structure: row.setup.structure, lastEvent: row.setup.lastEvent, orderBlocks: row.setup.orderBlocks, fvgs: row.setup.fvgs, sweep: row.setup.sweep, dealingRange: row.setup.dealingRange, swingLow: null, swingHigh: null, atr14: null }, entryZone: row.setup.entryZone, chasePct: row.setup.chasePct, chasing: row.setup.chasing, reasons: row.setup.reasons } : null,
      positioning: pos,
      liquidity: row.liquidity ? { score: row.liquidity.score, reasons: row.liquidity.reasons } : null,
      volume: row.volume ? { score: row.volume.score, reasons: row.volume.reasons } : null,
      levels: row.levels,
    });
    row.grade = { ...row.grade, ...grade, blocks: grade.blocks, reasons: grade.reasons.slice(0, 8) };
    row.pulsedAt = nowIso;
    updated += 1;
  }

  // ② Small-Cap Radar — prices and derivative facts only. Scores stay from the full scan: a
  //    pre-expansion score recomputed without fresh holder, liquidity or baseline data would be a
  //    different number pretending to be the same one.
  for (const row of next.discovery?.rows ?? []) {
    const touched = refreshMarket(row.market, row.symbol);
    const d = derivativesFor(row.symbol, row.market?.marketCap, row.derivatives);
    if (d) row.derivatives = d;
    if (touched || d) { row.pulsedAt = nowIso; updated += 1; }
  }

  // ③ The legacy candidate list, so the CRI radar and the drawer stay in sync on price.
  for (const c of next.candidates ?? []) {
    if (refreshMarket(c.market, c.symbol)) updated += 1;
  }

  // The squeeze watch is entirely a function of funding and open interest, so it is rebuilt.
  next.derivatives = {
    ...next.derivatives,
    squeezeWatch: (next.candidates ?? [])
      .filter((c) => c.derivatives?.venues?.length && isNum(c.derivatives.fundingAvg))
      .slice(0, 40)
      .map((c) => ({ ...c.derivatives, key: c.key, symbol: c.symbol, change7d: c.market?.change?.d7 ?? null, cri: c.score?.cri ?? null })),
  };

  next.meta = {
    ...next.meta,
    pulsedAt: nowIso,
    pulse: {
      at: nowIso,
      updated,
      refreshed: ['preț', 'variație 24h', 'funding', 'open interest'],
      keptFromFullScan: ['scoruri', 'ce s-a schimbat', 'deținători', 'risc', 'teze', 'structură 1D/4H'],
      fullScanAt: snapshot.meta.generatedAt,
      note: 'Un puls reîmprospătează doar faptele care se mișcă în 15 minute și care sunt disponibile din endpoint-uri publice. Tot ce depinde de scanarea completă păstrează marcajul de timp al acesteia, ca să se vadă clar ce este vechi de minute și ce este vechi de ore.',
    },
  };

  const published = await publisher.publish(next);
  logger.info(`pulse publicat: ${published.path} (${updated} rânduri actualizate, ${Math.round(published.bytes / 1024)} KB)`);
  return {
    snapshot: next,
    published,
    summary: {
      updated,
      prices: prices.size,
      perpSymbols: perps.size,
      coinalyze: coinalyzeBySymbol.size,
      fullScanAt: snapshot.meta.generatedAt,
    },
  };
}
