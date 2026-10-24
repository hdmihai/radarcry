/**
 * CoinPaprika adapter (keyless, free) — fallback universe and listing-age enrichment
 * (`first_data_at`). Replaces the CoinCap fallback of CRI v1.3.2: CoinCap's keyless v2 API
 * was shut down and v3 requires an account key.
 */
import { toNum } from '../../../domain/shared/math.js';
import { disabled, mapResult } from './common.js';

export function createCoinPaprika({ http, cfg }) {
  async function listTop(topN) {
    if (!cfg.enabled) return disabled('coinpaprika', '/v1/tickers');
    const r = await http.getJson('https://api.coinpaprika.com/v1/tickers?quotes=USD', {
      provider: 'coinpaprika', endpoint: '/v1/tickers', timeoutMs: Math.max(cfg.timeoutMs, 40_000), retries: cfg.retries, minIntervalMs: cfg.minIntervalMs, maxCalls: cfg.maxCalls, validate: Array.isArray, hash: true,
    });
    return mapResult(r, (rows) => rows
      .filter((x) => toNum(x.rank) && x.rank > 0 && x.rank <= Math.round(topN * 1.6))
      .sort((a, b) => a.rank - b.rank)
      .map(normalizeTicker));
  }
  return { id: 'coinpaprika', keyed: false, listTop };
}

export function normalizeTicker(x) {
  const q = x.quotes?.USD ?? {};
  return {
    source: 'coinpaprika',
    sourceId: x.id,
    symbol: x.symbol,
    name: x.name,
    rank: toNum(x.rank),
    price: toNum(q.price),
    marketCap: toNum(q.market_cap),
    fdv: null,
    volume24h: toNum(q.volume_24h),
    circulating: toNum(x.circulating_supply),
    total: toNum(x.total_supply),
    max: toNum(x.max_supply),
    change: { h1: toNum(q.percent_change_1h), h24: toNum(q.percent_change_24h), d7: toNum(q.percent_change_7d), d30: toNum(q.percent_change_30d), y1: toNum(q.percent_change_1y) },
    ath: toNum(q.ath_price),
    athChangePct: toNum(q.percent_from_price_ath),
    athDate: q.ath_date ?? null,
    atlDate: null,
    dateAdded: null,
    firstDataAt: x.first_data_at ?? null,
    tags: [],
    platform: null,
    numMarketPairs: null,
    image: null,
    lastUpdated: x.last_updated ?? null,
  };
}
