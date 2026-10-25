/**
 * Attach exchange / venue intelligence to canonical assets:
 *  - MEXC spot tickers, perpetual contracts (MEXC, Gate, Bitget, OKX) with funding + open interest
 *  - Korean KRW listings (Upbit, Bithumb), the exchange Alpha programmes with a public list: Binance
 *    Alpha (the on-chain discovery venue of LAB/BTW/AGT) and Gate Alpha
 *  - attention markers (CoinGecko trending, DexScreener boosts, GeckoTerminal trending pools)
 *  - DefiLlama fundamentals (TVL, fees)
 * Symbol collisions are resolved with a price-sanity check, never by symbol alone.
 */
import { isNum, ratio, toNum } from '../shared/math.js';
import { namesMatch, normAddress, normChain, normSymbol } from '../shared/symbols.js';

function symbolIndex(assets) {
  const idx = new Map();
  for (const a of assets) {
    const list = idx.get(a.symbol) ?? [];
    list.push(a);
    idx.set(a.symbol, list);
  }
  return idx;
}

/** Pick the asset whose aggregator price is closest to the venue price, within tolerance. */
function byPrice(candidates, venuePrice, tolerance) {
  if (!candidates?.length) return null;
  if (!isNum(venuePrice) || venuePrice <= 0) return null;
  let best = null;
  let bestDev = Infinity;
  for (const a of candidates) {
    const p = a.market.price;
    if (!isNum(p) || p <= 0) continue;
    const dev = Math.abs(venuePrice / p - 1);
    if (dev < bestDev) { bestDev = dev; best = a; }
  }
  return bestDev <= tolerance ? best : null;
}

/**
 * @param {any[]} assets  canonical assets (mutated: `venues`, `attention`, `fundamentals` attached)
 * @param {{
 *   mexcSpot?: {ok:boolean, data:any[]},
 *   perps?: {venue:string, ok:boolean, data:any[]}[],
 *   upbit?: {ok:boolean, data:any[]}, bithumb?: {ok:boolean, data:any[]},
 *   alpha?: {ok:boolean, data:any[]}, gateAlpha?: {ok:boolean, data:any[]},
 *   cgTrending?: {ok:boolean, data:any[]}, dexBoosts?: {ok:boolean, data:any[]}, gtTrending?: {ok:boolean, data:any[]},
 *   llamaProtocols?: {ok:boolean, data:any[]}, llamaFees?: {ok:boolean, data:any[]}
 * }} v
 */
export function attachVenues(assets, v) {
  const idx = symbolIndex(assets);
  const stats = { mexcSpot: 0, binanceSpot: 0, perps: {}, upbit: 0, bithumb: 0, alpha: 0, gateAlpha: 0, alphaPrograms: { binance: 0, gate: 0, both: 0 }, unmatched: {} };
  const knownPerpVenues = (v.perps ?? []).filter((p) => p.ok).map((p) => p.venue);

  for (const a of assets) {
    a.venues = {
      mexcSpot: null,
      binanceSpot: null,
      perps: [],
      perpsKnown: knownPerpVenues.length > 0,
      krw: { upbit: v.upbit?.ok ? false : null, bithumb: v.bithumb?.ok ? false : null, warning: null },
      alpha: v.alpha?.ok ? { status: 'NOT_LISTED' } : { status: 'UNKNOWN' },
      // Absent from a list read only in part is not "not listed": it may sit on an unread page.
      gateAlpha: v.gateAlpha?.ok && v.gateAlpha.meta?.listComplete !== false ? { status: 'NOT_LISTED' } : { status: 'UNKNOWN' },
      alphaPrograms: [],
    };
    a.attention = {
      cgTrending: v.cgTrending?.ok ? false : null,
      cgTrendingRank: null,
      dexBoost: v.dexBoosts?.ok ? 0 : null,
      gtTrending: v.gtTrending?.ok ? false : null,
      known: Boolean(v.cgTrending?.ok || v.dexBoosts?.ok || v.gtTrending?.ok),
    };
    a.fundamentals = null;
  }

  // MEXC spot (USDT pairs).
  for (const t of v.mexcSpot?.ok ? v.mexcSpot.data : []) {
    const hit = byPrice(idx.get(normSymbol(t.base)), t.last, 0.2);
    if (!hit) { stats.unmatched.mexcSpot = (stats.unmatched.mexcSpot ?? 0) + 1; continue; }
    if (hit.venues.mexcSpot && (hit.venues.mexcSpot.quoteVolume ?? 0) >= (t.quoteVolume ?? 0)) continue;
    hit.venues.mexcSpot = { symbol: t.symbol, last: t.last, quoteVolume: t.quoteVolume, changePct: t.changePct };
    stats.mexcSpot += 1;
  }

  // Binance spot via the public data mirror — the deepest book, used first for candles and depth.
  for (const t of v.binanceSpot?.ok ? v.binanceSpot.data : []) {
    const hit = byPrice(idx.get(normSymbol(t.base)), t.last, 0.2);
    if (!hit) { stats.unmatched.binanceSpot = (stats.unmatched.binanceSpot ?? 0) + 1; continue; }
    if (hit.venues.binanceSpot && (hit.venues.binanceSpot.quoteVolume ?? 0) >= (t.quoteVolume ?? 0)) continue;
    hit.venues.binanceSpot = { symbol: t.symbol, quote: t.quote, last: t.last, quoteVolume: t.quoteVolume, changePct: t.changePct, trades: t.trades ?? null };
    stats.binanceSpot = (stats.binanceSpot ?? 0) + 1;
  }

  // Perpetuals: funding + open interest per venue.
  for (const venue of v.perps ?? []) {
    if (!venue.ok) continue;
    let count = 0;
    for (const p of venue.data) {
      const price = isNum(p.price) ? p.price / (p.multiplier || 1) : null;
      const hit = byPrice(idx.get(normSymbol(p.base)), price, 0.25);
      if (!hit) continue;
      if (hit.venues.perps.some((x) => x.venue === venue.venue)) continue;
      hit.venues.perps.push({
        venue: venue.venue,
        symbol: p.symbol,
        fundingRate: toNum(p.fundingRate),
        oiUsd: toNum(p.oiUsd),
        volume24hUsd: toNum(p.volume24hUsd),
        maxLeverage: toNum(p.maxLeverage),
      });
      count += 1;
    }
    stats.perps[venue.venue] = count;
  }

  // Korean KRW markets — symbol + English-name confirmation.
  for (const [venueKey, res] of [['upbit', v.upbit], ['bithumb', v.bithumb]]) {
    for (const m of res?.ok ? res.data : []) {
      const cands = idx.get(normSymbol(m.base)) ?? [];
      const hit = cands.find((a) => namesMatch(a.name, m.englishName)) ?? (cands.length === 1 && !m.englishName ? cands[0] : null);
      if (!hit) continue;
      hit.venues.krw[venueKey] = true;
      if (m.warning) hit.venues.krw.warning = m.warning;
      stats[venueKey] += 1;
    }
  }

  let byChainAddr = null;
  const contractIndex = () => {
    if (byChainAddr) return byChainAddr;
    byChainAddr = new Map();
    for (const a of assets) for (const p of a.platforms) byChainAddr.set(`${p.chain}:${p.address}`, a);
    return byChainAddr;
  };

  // Binance Alpha — exact contract match first, symbol+price fallback.
  if (v.alpha?.ok) {
    const byAddr = contractIndex();
    for (const t of v.alpha.data) {
      const chain = normChain(t.chainId) ?? normChain(t.chainName);
      const addr = chain ? normAddress(chain, t.contractAddress) : null;
      let hit = addr ? byAddr.get(`${chain}:${addr}`) : null;
      if (!hit) hit = byPrice(idx.get(normSymbol(t.symbol)), toNum(t.price), 0.15);
      if (!hit) continue;
      hit.venues.alpha = {
        status: 'LISTED',
        holders: toNum(t.holders),
        listingCex: t.listingCex === true,
        listingTime: toNum(t.listingTime),
        liquidity: toNum(t.liquidity),
        volume24h: toNum(t.volume24h),
        trades24h: toNum(t.trades24h),
        hotTag: t.hotTag === true,
        mulPoint: toNum(t.mulPoint),
        onlineTge: t.onlineTge === true,
        onlineAirdrop: t.onlineAirdrop === true,
        alphaId: t.alphaId ?? null,
      };
      stats.alpha += 1;
    }
  }

  // Gate Alpha — contract match first. Gate names tokens by an internal id, not a ticker, so the
  // symbol + price fallback runs at a tighter tolerance than for Binance Alpha.
  if (v.gateAlpha?.ok) {
    const byAddr = contractIndex();
    for (const t of v.gateAlpha.data) {
      const chain = normChain(t.chain);
      const addr = chain ? normAddress(chain, t.contractAddress) : null;
      let hit = addr ? byAddr.get(`${chain}:${addr}`) : null;
      if (!hit) hit = byPrice(idx.get(normSymbol(t.symbol)), toNum(t.price), 0.1);
      if (!hit || hit.venues.gateAlpha.status === 'LISTED') continue;
      hit.venues.gateAlpha = {
        status: 'LISTED',
        currency: t.currency ?? null,
        volume24h: toNum(t.volume24h),
        marketCap: toNum(t.marketCap),
        changePct: toNum(t.change24h),
      };
      stats.gateAlpha += 1;
    }
  }

  // Which exchange Alpha programmes list each asset: a token several exchanges have each chosen for
  // their early-access programme is a different fact from a token one exchange carries.
  for (const a of assets) {
    if (a.venues.alpha?.status === 'LISTED') a.venues.alphaPrograms.push('binance');
    if (a.venues.gateAlpha?.status === 'LISTED') a.venues.alphaPrograms.push('gate');
    if (a.venues.alphaPrograms.includes('binance')) stats.alphaPrograms.binance += 1;
    if (a.venues.alphaPrograms.includes('gate')) stats.alphaPrograms.gate += 1;
    if (a.venues.alphaPrograms.length >= 2) stats.alphaPrograms.both += 1;
  }

  // Attention markers.
  if (v.cgTrending?.ok) {
    const byCg = new Map(assets.filter((a) => a.ids.coingecko).map((a) => [a.ids.coingecko, a]));
    v.cgTrending.data.forEach((t, i) => {
      const hit = byCg.get(t.id);
      if (hit) { hit.attention.cgTrending = true; hit.attention.cgTrendingRank = i + 1; }
    });
  }
  if (v.dexBoosts?.ok || v.gtTrending?.ok) {
    const byAddr = new Map();
    for (const a of assets) for (const p of a.platforms) byAddr.set(p.address, a);
    for (const b of v.dexBoosts?.ok ? v.dexBoosts.data : []) {
      const hit = byAddr.get(normAddress(normChain(b.chainId) ?? 'evm', b.tokenAddress));
      if (hit) hit.attention.dexBoost = Math.max(hit.attention.dexBoost ?? 0, toNum(b.totalAmount) ?? toNum(b.amount) ?? 1);
    }
    for (const g of v.gtTrending?.ok ? v.gtTrending.data : []) {
      const hit = byAddr.get(normAddress(normChain(g.network) ?? 'evm', g.baseTokenAddress));
      if (hit) hit.attention.gtTrending = true;
    }
  }

  // DefiLlama fundamentals (matched on CoinGecko id).
  if (v.llamaProtocols?.ok) {
    const fees = new Map();
    for (const f of v.llamaFees?.ok ? v.llamaFees.data : []) {
      for (const k of [f.defillamaId, f.parentProtocol, f.slug, f.name]) if (k) fees.set(String(k).toLowerCase(), f);
    }
    const byGecko = new Map();
    for (const p of v.llamaProtocols.data) {
      if (!p.geckoId) continue;
      const prev = byGecko.get(p.geckoId);
      if (!prev || (p.tvl ?? 0) > (prev.tvl ?? 0)) byGecko.set(p.geckoId, p);
    }
    for (const a of assets) {
      const p = a.ids.coingecko ? byGecko.get(a.ids.coingecko) : null;
      if (!p) continue;
      const f = fees.get(String(p.id).toLowerCase()) ?? fees.get(String(p.parentProtocol ?? '').toLowerCase()) ?? fees.get(String(p.slug ?? '').toLowerCase()) ?? null;
      a.fundamentals = {
        protocol: p.name,
        slug: p.slug,
        category: p.category,
        tvl: p.tvl,
        tvlChange1d: p.change1d,
        tvlChange7d: p.change7d,
        mcapToTvl: ratio(a.market.marketCap, p.tvl),
        fees30d: f?.total30d ?? null,
        fees24h: f?.total24h ?? null,
        feesChange1m: f?.change1m ?? null,
      };
    }
  }
  return stats;
}

/** Aggregate perp data of one asset into the derivatives facts used by scoring. */
export function derivativesSummary(asset) {
  const perps = asset.venues?.perps ?? [];
  if (!perps.length) return { venues: 0, oiUsd: null, oiToMcap: null, fundingAvg: null, fundingMin: null, fundingMax: null, byVenue: {} };
  let oi = 0;
  let oiKnown = false;
  let fw = 0;
  let fwDen = 0;
  const fundings = [];
  const byVenue = {};
  for (const p of perps) {
    if (isNum(p.oiUsd)) { oi += p.oiUsd; oiKnown = true; }
    if (isNum(p.fundingRate)) {
      fundings.push(p.fundingRate);
      const w = isNum(p.oiUsd) && p.oiUsd > 0 ? p.oiUsd : 1;
      fw += p.fundingRate * w;
      fwDen += w;
    }
    byVenue[p.venue] = { fundingRate: p.fundingRate, oiUsd: p.oiUsd, volume24hUsd: p.volume24hUsd };
  }
  return {
    venues: perps.length,
    oiUsd: oiKnown ? oi : null,
    oiToMcap: oiKnown ? ratio(oi, asset.market.marketCap) : null,
    fundingAvg: fwDen > 0 ? fw / fwDen : null,
    fundingMin: fundings.length ? Math.min(...fundings) : null,
    fundingMax: fundings.length ? Math.max(...fundings) : null,
    byVenue,
  };
}
