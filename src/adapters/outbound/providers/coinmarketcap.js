/**
 * CoinMarketCap adapter — the **official, documented Pro API only**, with a free Basic key.
 *
 * Why nothing else: earlier versions of this project also called `/public-api/...` and the website's
 * `data-api` endpoints. Neither is a published free API — they are undocumented surfaces that can be
 * withdrawn without notice, and a research tool must not depend on them. The project's rule is
 * "public and documented, or a free account key", so this adapter does exactly one thing: it calls
 * `/v1/cryptocurrency/listings/latest` with `X-CMC_PRO_API_KEY`, and reports NOT_CONFIGURED with the
 * exact signup instruction when no key is present.
 *
 * Cost model (Basic plan: 10 000 credits per month, 30 calls per minute): CoinMarketCap bills
 * 1 credit per 200 data points returned, rounded up, so the top-1000 listing costs 5 credits — about
 * 900 credits a month at six scans a day. The adapter declares those credits as `units`, which is
 * what the quota ledger charges and what the 95 % pause gate watches.
 *
 * Not called here: Fear & Greed and the Altcoin Season Index. Both are outside the Basic plan, so
 * sentiment comes from alternative.me and the altseason index is computed locally from our own
 * top 100 (see src/domain/market/altseason.js).
 */
import { toNum } from '../../../domain/shared/math.js';
import { disabled, mapResult, mergePages, notConfigured } from './common.js';

const PRO = 'https://pro-api.coinmarketcap.com';

/** Credits consumed by a listings call of `limit` coins: 1 per 200 (rounded up), minimum 1. */
export const listingCredits = (limit) => Math.max(1, Math.ceil((Number(limit) || 0) / 200));

/** The Basic plan caps a single listings call at 5 000; we page well below that. */
export const MAX_PAGE = 1000;

export function createCoinMarketCap({ http, cfg, apiKey = null }) {
  const headers = apiKey ? { 'X-CMC_PRO_API_KEY': apiKey } : {};
  const o = (endpoint, extra = {}) => ({
    provider: 'coinmarketcap',
    endpoint,
    headers,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    minIntervalMs: cfg.minIntervalMs,
    maxCalls: cfg.maxCalls,
    breakerThreshold: 4,
    hash: true,
    ...extra,
  });

  const AUX = 'num_market_pairs,cmc_rank,date_added,tags,platform,max_supply,circulating_supply,total_supply,is_active';

  async function listTop(topN) {
    const endpoint = '/v1/cryptocurrency/listings/latest';
    if (!cfg.enabled) return disabled('coinmarketcap', endpoint);
    if (!apiKey) {
      return notConfigured('coinmarketcap', endpoint,
        'lipsește CMC_API_KEY — cheia Basic este gratuită (10 000 credite/lună, 30 apeluri/minut) de la pro.coinmarketcap.com/signup; '
        + 'universul rulează în continuare doar pe CoinGecko, cu verificare încrucișată redusă');
    }
    const pageSize = Math.min(cfg.pageSize ?? MAX_PAGE, MAX_PAGE);
    const pages = [];
    for (let start = 1; start <= topN; start += pageSize) {
      const limit = Math.min(pageSize, topN - start + 1);
      const url = `${PRO}${endpoint}?start=${start}&limit=${limit}&convert=USD&sort=market_cap&aux=${AUX}`;
      const r = await http.getJson(url, o(endpoint, {
        validate: (d) => Array.isArray(d?.data),
        units: listingCredits(limit),
      }));
      pages.push(mapResult(r, (d) => d.data.filter((x) => x && x.is_active !== 0).map(normalizeListing)));
      if (!r.ok) break;
    }
    const merged = mergePages('coinmarketcap', endpoint, pages);
    return {
      ...merged,
      meta: {
        ...merged.meta,
        mode: 'pro-key',
        units: pages.reduce((s, p) => s + (p.meta?.units ?? 0), 0),
        credits: pages.reduce((s, p) => s + (p.meta?.units ?? 0), 0),
      },
    };
  }

  // Credit accounting happens inside listTop, which stamps meta.units on every page; listingCredits
  // is exported for the quota tests, not hung off the port, so the fixture adapter can mirror this
  // surface exactly (test/architecture.test.js checks that it does).
  return { id: 'coinmarketcap', keyed: Boolean(apiKey), listTop };
}

function usdQuote(item) {
  return item.quote?.USD ?? item.quote?.usd ?? {};
}

/** Normalise a v1 listings row into the project's MarketRow contract. */
export function normalizeListing(item) {
  const q = usdQuote(item);
  const pick = (...keys) => {
    for (const k of keys) {
      const v = q?.[k];
      if (v !== undefined && v !== null) return toNum(v);
    }
    return null;
  };
  const platform = item.platform && (item.platform.token_address || item.platform.tokenAddress)
    ? { chain: item.platform.slug ?? item.platform.name, address: item.platform.token_address ?? item.platform.tokenAddress }
    : null;
  const tags = (item.tags ?? []).map((t) => (typeof t === 'string' ? t : t?.slug ?? t?.name)).filter(Boolean);
  const price = pick('price');
  return {
    source: 'coinmarketcap',
    sourceId: String(item.id),
    slug: item.slug ?? null,
    symbol: item.symbol,
    name: item.name,
    rank: toNum(item.cmc_rank),
    price,
    marketCap: pick('market_cap'),
    fdv: pick('fully_diluted_market_cap'),
    volume24h: pick('volume_24h'),
    volumeChange24h: pick('volume_change_24h'),
    circulating: toNum(item.circulating_supply),
    total: toNum(item.total_supply),
    max: toNum(item.max_supply),
    change: {
      h1: pick('percent_change_1h'),
      h24: pick('percent_change_24h'),
      d7: pick('percent_change_7d'),
      d30: pick('percent_change_30d'),
      d60: pick('percent_change_60d'),
      d90: pick('percent_change_90d'),
    },
    mcapChange24h: null,
    ath: null,
    athChangePct: null,
    athDate: null,
    dateAdded: item.date_added ?? null,
    firstDataAt: null,
    tags,
    platform,
    numMarketPairs: toNum(item.num_market_pairs),
    image: null,
    lastUpdated: item.last_updated ?? q.last_updated ?? null,
  };
}
