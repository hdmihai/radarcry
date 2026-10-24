/**
 * Listing-level features for every eligible asset (stage 1 of the funnel) — built only from
 * aggregator data, venue attachments and the asset's own point-in-time history.
 */
import { isNum, mean, round } from '../shared/math.js';
import { DAY_MS, HOUR_MS, toMs } from '../shared/time.js';
import { derivativesSummary } from '../asset/venues.js';

/**
 * @param {any} asset canonical asset with venues/attention attached
 * @param {{t:string, turnover?:number, rank?:number, oiUsd?:number, funding?:number, holders?:number, watchlist?:number}[]} points history (oldest → newest)
 * @param {number} nowMs
 * @param {{platformsKnown:boolean}} ctx
 */
export function listingFeatures(asset, points, nowMs, ctx) {
  const m = asset.market;
  const d = derivativesSummary(asset);
  const hist = (points ?? []).filter((p) => isNum(toMs(p.t)) && toMs(p.t) < nowMs);

  const turnover = asset.derived.turnover;
  const recent = hist.filter((p) => nowMs - toMs(p.t) <= 2 * DAY_MS).map((p) => p.turnover).filter(isNum);
  const older = hist.filter((p) => { const age = nowMs - toMs(p.t); return age > 3 * DAY_MS && age <= 30 * DAY_MS; }).map((p) => p.turnover).filter(isNum);
  const turnoverSmoothed = isNum(turnover) ? mean([turnover, ...recent]) : mean(recent);
  const turnoverAccel = older.length >= 3 && isNum(turnoverSmoothed) && mean(older) > 0 ? turnoverSmoothed / mean(older) : null;

  const rankNow = asset.rank.cmc ?? asset.rank.coingecko;
  const weekAgo = closestBefore(hist, nowMs - 7 * DAY_MS, 3 * DAY_MS);
  const dayAgo = closestBefore(hist, nowMs - DAY_MS, 12 * HOUR_MS);
  const rankGain7d = isNum(rankNow) && isNum(weekAgo?.rank) ? weekAgo.rank - rankNow : null;
  // Market-cap growth (CRI dashboard section): 24h from CoinGecko, 7d / 30d from the own history.
  const monthAgo = closestBefore(hist, nowMs - 30 * DAY_MS, 5 * DAY_MS);
  const mcapGrowth = (then) => (isNum(m.marketCap) && isNum(then?.mcap) && then.mcap > 0 ? (m.marketCap / then.mcap - 1) * 100 : null);
  const oiChangePct = isNum(d.oiUsd) && isNum(dayAgo?.oiUsd) && dayAgo.oiUsd > 0 ? (d.oiUsd / dayAgo.oiUsd - 1) * 100 : null;

  return {
    mcap: m.marketCap,
    fdv: m.fdv,
    price: m.price,
    volume24h: m.volume24h,
    turnover,
    turnoverSmoothed: isNum(turnoverSmoothed) ? round(turnoverSmoothed, 5) : null,
    turnoverAccel: isNum(turnoverAccel) ? round(turnoverAccel, 3) : null,
    floatRatio: asset.derived.floatRatio,
    fdvToMcap: asset.derived.fdvToMcap,
    change1h: m.change.h1,
    change24h: m.change.h24,
    change7d: m.change.d7,
    change14d: m.change.d14,
    change30d: m.change.d30,
    athChangePct: m.athChangePct,
    mcapChange24h: m.mcapChange24h ?? null,
    mcapChange7d: isNum(mcapGrowth(weekAgo)) ? round(mcapGrowth(weekAgo), 2) : null,
    mcapChange30d: isNum(mcapGrowth(monthAgo)) ? round(mcapGrowth(monthAgo), 2) : null,
    ageDays: asset.derived.ageDays,
    rankNow,
    rankGain7d,
    perpsKnown: Boolean(asset.venues?.perpsKnown),
    perpVenues: d.venues,
    perpSources: (asset.venues?.perps ?? []).map((p) => p.venue),
    oiUsd: d.oiUsd,
    oiToMcap: d.oiToMcap,
    oiChangePct: isNum(oiChangePct) ? round(oiChangePct, 1) : null,
    fundingAvg: d.fundingAvg,
    fundingByVenue: d.byVenue,
    mexcSpot: Boolean(asset.venues?.mexcSpot),
    krw: asset.venues?.krw ?? null,
    krwWarning: asset.venues?.krw?.warning ?? null,
    alphaStatus: asset.venues?.alpha?.status ?? 'UNKNOWN',
    alphaListingCex: asset.venues?.alpha?.listingCex ?? null,
    alphaHolders: asset.venues?.alpha?.holders ?? null,
    platformsKnown: ctx.platformsKnown,
    sources: asset.sources,
  };
}

function closestBefore(points, targetMs, toleranceMs) {
  let best = null;
  let bestGap = Infinity;
  for (const p of points) {
    const gap = Math.abs(toMs(p.t) - targetMs);
    if (gap < bestGap) { bestGap = gap; best = p; }
  }
  return bestGap <= toleranceMs ? best : null;
}
