/**
 * CoinGecko adapter — universe (top N by market cap), trending, categories, global,
 * platform/contract index, coin detail (categories, dev activity, attention), search and
 * daily history for reference windows. Works keyless; a free Demo key raises the rate limit.
 */
import { toNum } from '../../../domain/shared/math.js';
import { normChain } from '../../../domain/shared/symbols.js';
import { disabled, mapResult, mergePages } from './common.js';

export function createCoinGecko({ http, cfg, apiKey = null, plan = 'demo' }) {
  const isPro = apiKey && plan === 'pro';
  const base = isPro ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
  const headers = apiKey ? { [isPro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: apiKey } : {};
  const o = (endpoint, extra = {}) => ({
    provider: 'coingecko',
    endpoint,
    headers,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    minIntervalMs: apiKey ? cfg.minIntervalMsWithKey : cfg.minIntervalMs,
    maxCalls: apiKey ? cfg.maxCallsWithKey : cfg.maxCalls,
    breakerThreshold: 5,
    ...extra,
  });

  async function listTop(topN) {
    if (!cfg.enabled) return disabled('coingecko', '/coins/markets');
    const pages = Math.ceil(topN / 250);
    const results = [];
    for (let page = 1; page <= pages; page += 1) {
      const url = `${base}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=1h,24h,7d,14d,30d,200d,1y`;
      const r = await http.getJson(url, o('/coins/markets', { validate: Array.isArray, hash: true }));
      results.push(mapResult(r, (rows) => rows.map(normalizeMarket)));
      if (!r.ok && r.status !== 'RATE_LIMITED') break;
    }
    const merged = mergePages('coingecko', '/coins/markets', results);
    if (merged.ok) merged.data = merged.data.slice(0, topN);
    return merged;
  }

  const trending = async () => mapResult(
    await http.getJson(`${base}/search/trending`, o('/search/trending', { validate: (d) => Array.isArray(d?.coins) })),
    (d) => d.coins.map((c) => ({ id: c.item?.id, symbol: c.item?.symbol, name: c.item?.name, rank: toNum(c.item?.market_cap_rank) })).filter((c) => c.id),
  );

  const categories = async () => mapResult(
    await http.getJson(`${base}/coins/categories`, o('/coins/categories', { validate: Array.isArray })),
    (rows) => rows.map((c) => ({ id: c.id, name: c.name, marketCap: toNum(c.market_cap), change24hPct: toNum(c.market_cap_change_24h), volume24h: toNum(c.volume_24h), topCoins: c.top_3_coins_id ?? [] })),
  );

  const global = async () => mapResult(
    await http.getJson(`${base}/global`, o('/global', { validate: (d) => d?.data })),
    (d) => ({
      totalMarketCapUsd: toNum(d.data.total_market_cap?.usd),
      totalVolumeUsd: toNum(d.data.total_volume?.usd),
      change24hPct: toNum(d.data.market_cap_change_percentage_24h_usd),
      btcDominance: toNum(d.data.market_cap_percentage?.btc),
      ethDominance: toNum(d.data.market_cap_percentage?.eth),
      activeCryptocurrencies: toNum(d.data.active_cryptocurrencies),
    }),
  );

  const platforms = async () => mapResult(
    await http.getJson(`${base}/coins/list?include_platform=true`, o('/coins/list', { validate: Array.isArray, timeoutMs: Math.max(cfg.timeoutMs, 40_000) })),
    (rows) => {
      const map = new Map();
      for (const r of rows) {
        const list = [];
        for (const [chain, address] of Object.entries(r.platforms ?? {})) {
          if (!address) continue;
          // Chains the pipeline cannot read stay in the map, marked: they still say the coin is a
          // token (with a contract somewhere), not a chain's native coin — the validity gate needs that.
          list.push(normChain(chain) ? { chain, address } : { chain, address, unsupported: true });
        }
        if (list.length) map.set(r.id, list);
      }
      return map;
    },
  );

  const detail = async (id) => mapResult(
    await http.getJson(`${base}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=true&developer_data=true&sparkline=false`, o('/coins/{id}', { validate: (d) => d?.id })),
    (d) => ({
      id: d.id,
      categories: (d.categories ?? []).filter(Boolean),
      genesisDate: d.genesis_date ?? null,
      homepage: (d.links?.homepage ?? []).find(Boolean) ?? null,
      twitter: d.links?.twitter_screen_name || null,
      telegram: d.links?.telegram_channel_identifier || null,
      github: (d.links?.repos_url?.github ?? []).find(Boolean) ?? null,
      watchlistUsers: toNum(d.watchlist_portfolio_users),
      sentimentUpPct: toNum(d.sentiment_votes_up_percentage),
      twitterFollowers: toNum(d.community_data?.twitter_followers),
      telegramUsers: toNum(d.community_data?.telegram_channel_user_count),
      commits4w: toNum(d.developer_data?.commit_count_4_weeks),
      stars: toNum(d.developer_data?.stars),
      description: (d.description?.en ?? '').replace(/<[^>]+>/g, '').slice(0, 420) || null,
    }),
  );

  const search = async (query) => mapResult(
    await http.getJson(`${base}/search?query=${encodeURIComponent(query)}`, o('/search', { validate: (d) => Array.isArray(d?.coins) })),
    (d) => d.coins.map((c) => ({ id: c.id, symbol: String(c.symbol ?? '').toUpperCase(), name: c.name, rank: toNum(c.market_cap_rank) })),
  );

  const marketChart = async (id, days = 365) => http.getJson(
    `${base}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
    o('/coins/{id}/market_chart', { validate: (d) => Array.isArray(d?.prices) }),
  );

  return { id: 'coingecko', keyed: Boolean(apiKey), listTop, trending, categories, global, platforms, detail, search, marketChart };
}

export function normalizeMarket(r) {
  return {
    source: 'coingecko',
    sourceId: r.id,
    symbol: r.symbol,
    name: r.name,
    rank: toNum(r.market_cap_rank),
    price: toNum(r.current_price),
    marketCap: toNum(r.market_cap),
    fdv: toNum(r.fully_diluted_valuation),
    volume24h: toNum(r.total_volume),
    circulating: toNum(r.circulating_supply),
    total: toNum(r.total_supply),
    max: toNum(r.max_supply),
    change: {
      h1: toNum(r.price_change_percentage_1h_in_currency),
      h24: toNum(r.price_change_percentage_24h_in_currency ?? r.price_change_percentage_24h),
      d7: toNum(r.price_change_percentage_7d_in_currency),
      d14: toNum(r.price_change_percentage_14d_in_currency),
      d30: toNum(r.price_change_percentage_30d_in_currency),
      d200: toNum(r.price_change_percentage_200d_in_currency),
      y1: toNum(r.price_change_percentage_1y_in_currency),
    },
    mcapChange24h: toNum(r.market_cap_change_percentage_24h),
    ath: toNum(r.ath),
    athChangePct: toNum(r.ath_change_percentage),
    athDate: r.ath_date ?? null,
    atlDate: r.atl_date ?? null,
    dateAdded: null,
    firstDataAt: null,
    tags: [],
    platform: null,
    numMarketPairs: null,
    image: r.image ?? null,
    lastUpdated: r.last_updated ?? null,
  };
}
