/**
 * Fixture providers — implement the same ports as the HTTP adapters, backed by the
 * deterministic DEMO market simulator. Used by `npm run demo`, the e2e tests and CI smoke runs.
 */
import { candlesAt, hashSeed, mulberry32, stateAt } from './demo-market.js';
import { normChain } from '../../../domain/shared/symbols.js';
import { isNum } from '../../../domain/shared/math.js';
import { normalizeTopFlows } from '../providers/onchain.js';
import { alphaMarketRow, gateAlphaMarketRow, normalizeGateAlpha } from '../providers/exchanges.js';

const DAY = 86_400_000;
const CG_CHAIN = { bsc: 'binance-smart-chain', ethereum: 'ethereum', solana: 'solana', base: 'base', arbitrum: 'arbitrum-one' };
const CMC_CHAIN = { bsc: 'bnb', ethereum: 'ethereum', solana: 'solana', base: 'base', arbitrum: 'arbitrum' };
const GATE_CHAIN = { bsc: 'bsc', ethereum: 'eth', solana: 'SOLANA', base: 'base', arbitrum: 'arbitrum' };

export function createFixtureProviders({ market, clock }) {
  const now = () => clock.now();
  const ok = (provider, endpoint, data, extra = {}) => ({ ok: true, status: 'OK', data, message: '', meta: { provider, endpoint, fetchedAt: new Date(now()).toISOString(), latencyMs: 1, httpStatus: 200, records: Array.isArray(data) ? data.length : data instanceof Map ? data.size : null, mode: 'fixture', ...extra } });
  const fail = (provider, endpoint, status, message) => ({ ok: false, status, data: null, message, meta: { provider, endpoint, fetchedAt: new Date(now()).toISOString(), latencyMs: 0, httpStatus: null } });
  const jitter = (id, salt, amp) => 1 + amp * (mulberry32(hashSeed(`${id}:${salt}:${Math.floor(now() / DAY)}`))() - 0.5) * 2;

  const live = () => market.assets.map((a) => ({ a, s: stateAt(market, a, now()) })).filter((x) => x.s && x.s.price > 0);
  const ranked = (salt) => live().map((x) => ({ ...x, mc: x.s.marketCap * jitter(x.a.id, salt, 0.025) })).sort((p, q) => q.mc - p.mc);
  const rel = (a) => Math.floor((now() - market.endMs) / DAY);
  const findBySym = (sym) => market.assets.find((a) => `${a.symbol}USDT` === sym || `${a.symbol}_USDT` === sym);

  function phase(a) {
    const r = rel(a);
    const s = stateAt(market, a, now());
    if (!s) return 'none';
    if (a.archetype === 'HYPED' && r > -9) return 'hyped';
    if ((s.change.d7 ?? 0) > 60) return 'expansion';
    if (a.archetype === 'SETUP' && (s.change.d30 ?? 0) > -5 && (s.change.d7 ?? 0) < 40) return 'pre';
    return 'normal';
  }

  function perpFor(a, venue) {
    const s = stateAt(market, a, now());
    if (!s || !a.venues.perps.includes(venue)) return null;
    if (a.perpListedDaysAgo !== null && a.perpListedDaysAgo !== undefined && now() < market.endMs - a.perpListedDaysAgo * DAY) return null;
    const ph = phase(a);
    const r = mulberry32(hashSeed(`${a.id}:${venue}:${Math.floor(now() / (4 * 3_600_000))}`));
    const funding = ph === 'pre' ? -0.0002 - r() * 0.0004 : ph === 'hyped' ? 0.0009 + r() * 0.0008 : ph === 'expansion' ? 0.0004 + r() * 0.0006 : 0.00005 + (r() - 0.5) * 0.0002;
    const oiRatio = (ph === 'pre' ? 0.08 + 0.006 * Math.max(0, 20 + rel(a)) : ph === 'hyped' ? 0.45 : 0.03 + r() * 0.06) / Math.max(1, a.venues.perps.length * 0.7);
    return { symbol: venue === 'okx' ? `${a.symbol}-USDT-SWAP` : venue === 'bitget' ? `${a.symbol}USDT` : `${a.symbol}_USDT`, base: a.symbol, multiplier: 1, price: s.price * (1 + (r() - 0.5) * 0.002), fundingRate: venue === 'okx' ? null : funding, oiUsd: s.marketCap * oiRatio * (0.9 + r() * 0.2), volume24hUsd: s.volume24h * 1.8, maxLeverage: 50 };
  }

  const listing = (x, source, rank) => {
    const { a, s } = x;
    const mcap = x.mc;
    const circ = mcap / s.price;
    return {
      source,
      sourceId: source === 'coingecko' ? a.id : source === 'coinmarketcap' ? String(hashSeed(a.id) % 900000 + 1000) : `${a.symbol.toLowerCase()}-${a.id}`,
      slug: a.id,
      symbol: source === 'coingecko' ? a.symbol.toLowerCase() : a.symbol,
      name: a.name,
      rank,
      price: s.price,
      marketCap: mcap,
      fdv: a.max || a.total ? s.price * (a.max ?? a.total) : null,
      volume24h: s.volume24h,
      circulating: source === 'coinmarketcap' && hashSeed(a.id) % 97 === 0 ? circ * 3 : circ,
      total: a.total,
      max: a.max,
      change: s.change,
      mcapChange24h: source === 'coingecko' ? s.change.h24 : null,
      ath: s.ath,
      athChangePct: source === 'coinmarketcap' ? null : s.athChangePct,
      athDate: null,
      atlDate: null,
      dateAdded: source === 'coinmarketcap' ? new Date(a.listedAt).toISOString() : null,
      firstDataAt: source === 'coinpaprika' ? new Date(a.listedAt).toISOString() : null,
      tags: source === 'coinmarketcap' ? [...a.tags, ...(a.categories ?? []).map((c) => c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))] : [],
      platform: source === 'coinmarketcap' && a.chain && a.address ? { chain: CMC_CHAIN[a.chain], address: a.address } : null,
      numMarketPairs: source === 'coinmarketcap' ? 3 + (hashSeed(a.id) % 40) : null,
      image: null,
      lastUpdated: new Date(now() - 120_000).toISOString(),
    };
  };

  const coingecko = {
    id: 'coingecko',
    keyed: false,
    listTop: async (topN) => ok('coingecko', '/coins/markets', ranked('cg').slice(0, topN).map((x, i) => listing(x, 'coingecko', i + 1))),
    trending: async () => ok('coingecko', '/search/trending', live().filter(({ a }) => phase(a) === 'hyped' || phase(a) === 'expansion').slice(0, 15).map(({ a }) => ({ id: a.id, symbol: a.symbol, name: a.name, rank: null }))),
    categories: async () => {
      const acc = new Map();
      for (const { a, s } of live()) {
        for (const c of a.categories) {
          const x = acc.get(c) ?? { id: c.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: c, marketCap: 0, w: 0, volume24h: 0, top: [] };
          x.marketCap += s.marketCap;
          x.w += s.marketCap * (s.change.h24 ?? 0);
          x.volume24h += s.volume24h;
          x.top.push([s.marketCap, a.id]);
          acc.set(c, x);
        }
      }
      return ok('coingecko', '/coins/categories', [...acc.values()].map((x) => ({ id: x.id, name: x.name, marketCap: x.marketCap, change24hPct: x.w / x.marketCap, volume24h: x.volume24h, topCoins: x.top.sort((p, q) => q[0] - p[0]).slice(0, 3).map((t) => t[1]) })));
    },
    global: async () => {
      const all = live();
      const total = all.reduce((s, x) => s + x.s.marketCap, 0);
      const btc = all.find((x) => x.a.symbol === 'BTC');
      const eth = all.find((x) => x.a.symbol === 'ETH');
      const ch = all.reduce((s, x) => s + x.s.marketCap * (x.s.change.h24 ?? 0), 0) / total;
      return ok('coingecko', '/global', { totalMarketCapUsd: total, totalVolumeUsd: all.reduce((s, x) => s + x.s.volume24h, 0), change24hPct: ch, btcDominance: (btc.s.marketCap / total) * 100, ethDominance: (eth.s.marketCap / total) * 100, activeCryptocurrencies: 17_000 });
    },
    platforms: async () => {
      const m = new Map();
      for (const a of market.assets) if (a.chain && a.address) m.set(a.id, [{ chain: CG_CHAIN[a.chain], address: a.address }]);
      return ok('coingecko', '/coins/list', m);
    },
    detail: async (id) => {
      const a = market.assets.find((x) => x.id === id);
      if (!a) return fail('coingecko', '/coins/{id}', 'HTTP_ERROR', 'HTTP 404');
      const days = (now() - market.startMs) / DAY;
      const ph = phase(a);
      const growth = ph === 'pre' ? 1.012 : ph === 'hyped' ? 1.03 : 1.001;
      return ok('coingecko', '/coins/{id}', { id, categories: a.categories, genesisDate: null, homepage: `https://example.org/${a.symbol.toLowerCase()}`, twitter: null, telegram: null, github: isNum(a.devCommits) ? `https://github.com/demo-labs/${a.id}` : null, watchlistUsers: Math.round(a.watch0 * growth ** Math.max(0, days - 380)), sentimentUpPct: 70, twitterFollowers: null, telegramUsers: null, commits4w: a.devCommits, stars: null, description: 'Proiect fictiv din setul DEMO.' });
    },
    search: async (q) => ok('coingecko', '/search', market.assets.filter((a) => a.symbol === q.toUpperCase() || a.name.toLowerCase().includes(q.toLowerCase())).map((a) => ({ id: a.id, symbol: a.symbol, name: a.name, rank: null }))),
    marketChart: async (id, days) => {
      const a = market.assets.find((x) => x.id === id);
      if (!a) return fail('coingecko', '/coins/{id}/market_chart', 'HTTP_ERROR', 'HTTP 404');
      const end = Math.floor((now() - market.startMs) / DAY);
      const prices = [];
      const caps = [];
      const vols = [];
      for (let i = Math.max(0, end - days + 1); i <= end; i += 1) {
        const t = market.startMs + i * DAY;
        if (t < a.listedAt) continue;
        const p = a.path.c[i];
        prices.push([t, p]);
        caps.push([t, p * a.circ]);
        vols.push([t, p * a.circ * a.path.turnover[i]]);
      }
      return ok('coingecko', '/coins/{id}/market_chart', { prices, market_caps: caps, total_volumes: vols });
    },
  };

  const coinmarketcap = {
    id: 'coinmarketcap',
    keyed: false,
    listTop: async (topN) => ok('coinmarketcap', '/public-api/v3/cryptocurrency/listings/latest', ranked('cmc').filter(({ a }) => hashSeed(`cmc:${a.id}`) % 50 !== 0).slice(0, topN).map((x, i) => listing(x, 'coinmarketcap', i + 1)), { mode: 'fixture' }),
    fearGreed: async () => {
      const btc = live().find((x) => x.a.symbol === 'BTC');
      const v = Math.round(Math.max(5, Math.min(95, 50 + (btc?.s.change.d7 ?? 0) * 3)));
      return ok('coinmarketcap', '/v3/fear-and-greed/latest', { value: v, label: v >= 75 ? 'Extreme greed' : v >= 55 ? 'Greed' : v >= 45 ? 'Neutral' : v >= 25 ? 'Fear' : 'Extreme fear', updatedAt: new Date(now()).toISOString() });
    },
    altseason: async () => {
      const top = ranked('cmc').slice(0, 100);
      const btc = top.find((x) => x.a.symbol === 'BTC');
      const share = top.filter((x) => (x.s.change.d30 ?? 0) > (btc?.s.change.d30 ?? 0)).length;
      return ok('coinmarketcap', '/v1/altcoin-season-index/latest', { value: share });
    },
  };

  const coinpaprika = { id: 'coinpaprika', keyed: false, listTop: async (topN) => ok('coinpaprika', '/v1/tickers', ranked('cp').slice(0, Math.round(topN * 1.2)).map((x, i) => listing(x, 'coinpaprika', i + 1))) };

  const mexc = {
    id: 'mexc',
    spotTickers: async () => ok('mexc', '/api/v3/ticker/24hr', live().filter(({ a }) => a.venues.mexc).map(({ a, s }) => ({ symbol: `${a.symbol}USDT`, base: a.symbol, last: s.price, quoteVolume: s.volume24h * 0.3, changePct: s.change.h24 }))),
    klines: async (symbol, interval, limit) => {
      const a = findBySym(symbol);
      if (!a) return fail('mexc', '/api/v3/klines', 'HTTP_ERROR', 'HTTP 400: invalid symbol');
      return ok('mexc', `/api/v3/klines ${interval}`, candlesAt(market, a, now(), interval, limit));
    },
    perps: async () => ok('mexc_futures', '/api/v1/contract/ticker', live().map(({ a }) => perpFor(a, 'mexc')).filter(Boolean)),
  };
  const venue = (id) => ({ id, perps: async () => ok(id, '/perps', live().map(({ a }) => perpFor(a, id)).filter(Boolean)) });

  const krw = (id, flag) => ({ id, markets: async () => ok(id, '/v1/market/all', live().filter(({ a }) => a.venues[flag]).map(({ a }) => ({ market: `KRW-${a.symbol}`, base: a.symbol, englishName: a.name, warning: null }))) });

  // Same port vocabulary as the live normaliser (normalizeAlphaToken), and the universe rows are
  // built by the live adapter's own alphaMarketRow — so the demo exercises the real mapping.
  const alphaTokens = () => live().filter(({ a }) => a.venues.alpha && a.chain === 'bsc').map(({ a, s }) => ({
    tokenId: `T${hashSeed(a.id)}`, alphaId: `ALPHA_${hashSeed(a.id) % 900}`,
    chainId: '56', chainName: 'BSC', contractAddress: a.address, symbol: a.symbol, name: a.name, image: null,
    price: s.price, percentChange24h: s.change.h24, marketCap: s.marketCap, fdv: s.marketCap * 1.4,
    circulating: a.circ, total: a.circ * 1.4, liquidity: poolLiquidity(a, s), volume24h: s.volume24h * 0.2,
    trades24h: Math.round((s.volume24h * 0.2) / 900), holders: holdersAt(a), listingCex: a.venues.alphaCex,
    listingTime: a.listedAt + 2 * DAY, hotTag: phase(a) === 'hyped', mulPoint: hashSeed(`${a.id}:mul`) % 3 === 0 ? 2 : 1,
    onlineTge: false, onlineAirdrop: false,
  }));
  const binanceAlpha = {
    id: 'binance_alpha',
    markets: async () => ok('binance_alpha', '/alpha/all/token/list', alphaTokens()),
    listTop: async () => ok('binance_alpha', '/alpha/all/token/list', alphaTokens().map(alphaMarketRow)),
    klines: async (alphaId, interval, limit) => {
      const a = market.assets.find((x) => x.venues.alpha && `ALPHA_${hashSeed(x.id) % 900}` === alphaId);
      if (!a) return fail('binance_alpha', '/bapi/.../alpha-trade/klines', 'SKIPPED', `${alphaId}: nicio pereche Alpha activă`);
      return ok('binance_alpha', `/bapi/.../alpha-trade/klines ${interval}`, candlesAt(market, a, now(), interval, limit));
    },
  };

  /*
   * Gate Alpha: two thirds of the on-chain projects, each joining the list on its own day after
   * listing — so a long simulation sees projects *enter* Gate Alpha and produce NEW_GATE_ALPHA
   * catalysts. Rows are built by the live adapter's own normaliser and market-row mapper, with
   * Gate's id convention (some `memebox<ticker>`, some the bare ticker) and its chain spellings.
   */
  const gateAlphaTokens = () => live()
    .filter(({ a }) => a.chain && a.address && GATE_CHAIN[a.chain] && hashSeed(`gate:${a.id}`) % 3 !== 0
      && now() >= a.listedAt + (hashSeed(`${a.id}:ga`) % 40) * DAY)
    .map(({ a, s }) => {
      const currency = hashSeed(a.id) % 2 ? `memebox${a.symbol.toLowerCase()}` : a.symbol.toLowerCase();
      return normalizeGateAlpha(
        { currency, name: a.name, chain: GATE_CHAIN[a.chain], address: a.address, status: 1 },
        { currency, last: String(s.price), change: String(s.change.h24 ?? 0), volume: String(s.volume24h * 0.05), market_cap: String(s.marketCap) },
      );
    });
  const gateAlpha = {
    id: 'gate_alpha',
    markets: async () => ok('gate_alpha', '/alpha/currencies + /alpha/tickers', gateAlphaTokens()),
    listTop: async () => ok('gate_alpha', '/alpha/currencies + /alpha/tickers', gateAlphaTokens().filter((t) => t.contractAddress && t.marketCap > 0 && t.price > 0).map(gateAlphaMarketRow)),
  };

  /** A GoPlus-shaped top-10 list: one LP pool, one exchange wallet, the rest ordinary holders. */
  function fixtureTopHolders(a) {
    const hex = (n) => `0x${(hashSeed(`${a.id}:h${n}`) >>> 0).toString(16).padStart(8, '0').repeat(5)}`;
    const rest = Math.max(4, (a.top10 ?? 40) - 16);
    const wallets = Array.from({ length: 8 }, (_, i) => ({ address: hex(i), share: (rest * (8 - i)) / 36, balance: null, tag: null, locked: false, isContract: false }));
    return [
      { address: hex(90), share: 10, balance: null, tag: 'PancakeSwap V2 Pool', locked: false, isContract: true },
      { address: hex(91), share: 6, balance: null, tag: 'Binance 14', locked: false, isContract: false },
      ...wallets,
    ];
  }

  /*
   * One model of a project's pools, read by both simulated sources that report it (DexScreener and
   * Binance Alpha), as the real ones read the same pools. A stable share of market cap per project,
   * a ramp while the project is setting up (liquidity providers arrive, as holders do in holdersAt),
   * and a few percent of daily noise. The earlier DexScreener model drew a fresh 0.8–5.8 % share
   * every day: any "liquidity growth" it produced was noise, not a planted signal.
   */
  function poolLiquidity(a, s) {
    const share = 0.012 + (hashSeed(`${a.id}:liq`) % 30) / 1000;
    const setup = phase(a) === 'pre' ? 1 + 0.012 * Math.max(0, 25 + rel(a)) : 1;
    const noise = 1 + (mulberry32(hashSeed(`${a.id}:liqd:${Math.floor(now() / DAY)}`))() - 0.5) * 0.08;
    return s.marketCap * share * setup * noise;
  }

  function holdersAt(a) {
    const days = (now() - market.startMs) / DAY;
    const ph = phase(a);
    return Math.round(a.holders0 * (1 + 0.0015 * days) * (ph === 'pre' ? 1 + 0.015 * Math.max(0, 25 + rel(a)) : 1));
  }

  const dexscreener = {
    id: 'dexscreener',
    boosts: async () => ok('dexscreener', '/token-boosts/top/v1', live().filter(({ a }) => phase(a) === 'hyped' && a.chain).map(({ a }) => ({ chainId: a.chain, tokenAddress: a.address, amount: 500, totalAmount: 1500 }))),
    tokens: async (chain, addresses) => {
      const out = {};
      for (const addr of addresses) {
        const a = market.assets.find((x) => x.address && x.address.toLowerCase() === String(addr).toLowerCase() && x.chain === chain);
        const s = a ? stateAt(market, a, now()) : null;
        if (!a || !s) continue;
        const ph = phase(a);
        const r = mulberry32(hashSeed(`${a.id}:dex:${Math.floor(now() / DAY)}`));
        const buys = Math.round(800 + r() * 3000);
        const ratio = ph === 'pre' ? 1.25 + r() * 0.3 : ph === 'hyped' ? 1.1 : 0.85 + r() * 0.3;
        out[addr] = { pairs: 1 + Math.floor(r() * 4), liquidityUsd: poolLiquidity(a, s), volume24h: s.volume24h * 0.25, buys24h: buys, sells24h: Math.round(buys / ratio), buys6h: Math.round(buys / 4), sells6h: Math.round(buys / 4 / ratio), oldestPairAt: a.listedAt, topPair: { url: `https://dexscreener.com/${chain}/${addr}`, dexId: 'demo', pairAddress: addr, liquidityUsd: s.marketCap * 0.02, priceUsd: s.price }, websites: [], socials: [] };
      }
      return ok('dexscreener', '/tokens/v1/{chain}/{addresses}', out);
    },
  };

  const geckoterminal = {
    id: 'geckoterminal',
    trendingPools: async () => ok('geckoterminal', '/networks/trending_pools', live().filter(({ a }) => phase(a) === 'hyped' && a.chain).slice(0, 10).map(({ a }) => ({ network: a.chain === 'ethereum' ? 'eth' : a.chain, baseTokenAddress: a.address, name: `${a.symbol} / USDT` }))),
    tokenInfo: async (chain, address) => {
      const a = market.assets.find((x) => x.address === address);
      if (!a) return fail('geckoterminal', '/tokens/{address}/info', 'HTTP_ERROR', 'HTTP 404');
      return ok('geckoterminal', '/tokens/{address}/info', { holders: holdersAt(a), top10Pct: a.top10, distribution: { top_10: String(a.top10) }, gtScore: 60, honeypot: a.honeypot, mintAuthority: null, freezeAuthority: null, categories: [], twitter: null, websites: [] });
    },
  };

  const goplus = {
    id: 'goplus',
    security: async (chain, addresses) => {
      const out = {};
      for (const addr of addresses) {
        const a = market.assets.find((x) => x.address === addr);
        if (!a) continue;
        out[addr] = {
          holders: holdersAt(a),
          top10Pct: Math.min(100, a.top10 + 4),
          top10EffectivePct: a.top10,
          // Same port vocabulary as the live GoPlus normaliser (normalizeEvm), field for field.
          topHolders: fixtureTopHolders(a),
          creatorAddress: null,
          ownerAddress: null,
          lpLockedPct: a.honeypot ? 12 : 60 + (hashSeed(`${a.id}:lp`) % 40),
          security: { honeypot: a.honeypot, cannotSell: a.honeypot, buyTax: 0, sellTax: a.sellTax, mintable: false, ownerRenounced: true, hiddenOwner: false, canTakeBackOwnership: false, transferPausable: false, blacklist: false, slippageModifiable: false, proxy: hashSeed(a.id) % 9 === 0, openSource: true, trustList: false },
        };
      }
      return ok('goplus', '/token_security/{chain}', out);
    },
  };

  const defillama = {
    id: 'defillama',
    protocols: async () => ok('defillama', '/protocols', market.assets.filter((a) => a.tvl).map((a, i) => ({ id: String(1000 + i), name: a.name, slug: a.id, geckoId: a.id, category: 'Dexs', tvl: a.tvl, change1d: 1.2, change7d: phase(a) === 'pre' ? 18 : 2, parentProtocol: null }))),
    fees: async () => ok('defillama', '/overview/fees', market.assets.filter((a) => a.tvl).map((a, i) => ({ defillamaId: String(1000 + i), parentProtocol: null, slug: a.id, name: a.name, total24h: a.tvl * 0.001, total30d: a.tvl * 0.03, change1m: phase(a) === 'pre' ? 35 : 3 }))),
  };

  /*
   * Arkham in DEMO mode behaves like a configured key: raw rows in the documented top_flow shape
   * (address intelligence object + inUSD/outUSD), normalised by the same function as the live adapter.
   * Entity names are fictional and marked "(simulat)". Setups accumulate (coins leave exchanges into
   * wallets), hyped/declining tokens distribute.
   */
  const SIM_ENTITIES = [
    { id: 'sim-cex-a', name: 'Exchange A (simulat)', type: 'cex', share: 0.2, sign: -1 },
    { id: 'sim-cex-b', name: 'Exchange B (simulat)', type: 'cex', share: 0.1, sign: -0.8 },
    { id: 'sim-fund', name: 'Fond Alpha (simulat)', type: 'fund', share: 0.12, sign: 1 },
    { id: 'sim-mm', name: 'Market maker Bravo (simulat)', type: 'market maker', share: 0.15, sign: 0.3 },
    { id: 'sim-dex', name: 'Pool DEX (simulat)', type: 'dex', share: 0.12, sign: 0.05 },
  ];
  const arkham = {
    id: 'arkham',
    keyed: true,
    tokenFlows: async (pricingId) => {
      const a = market.assets.find((x) => x.id === pricingId);
      const s = a ? stateAt(market, a, now()) : null;
      if (!s) return fail('arkham', '/token/top_flow/{id}', 'HTTP_ERROR', 'HTTP 404');
      const ph = phase(a);
      const r = mulberry32(hashSeed(`${a.id}:arkham:${Math.floor(now() / DAY)}`));
      const bias = ph === 'pre' ? 0.42 : ph === 'hyped' || ph === 'expansion' ? -0.4
        : a.archetype === 'ACCUM' ? 0.25 : a.archetype === 'DUMPED' || a.archetype === 'DECLINER' ? -0.3 : (r() - 0.5) * 0.3;
      const weekly = s.volume24h * 7 * 0.15;
      const rows = SIM_ENTITIES.map((e, i) => {
        const b = Math.max(-0.95, Math.min(0.95, bias * e.sign + (r() - 0.5) * 0.08));
        const gross = weekly * e.share * (0.85 + r() * 0.3);
        return { address: { address: `0xsim${i}${a.id.length}`, chain: a.chain, arkhamEntity: { id: e.id, name: e.name, type: e.type } }, inUSD: gross * (1 + b) / 2, outUSD: gross * (1 - b) / 2, inValue: null, outValue: null };
      });
      for (let i = 0; i < 6; i += 1) {
        const b = Math.max(-0.95, Math.min(0.95, bias + (r() - 0.5) * 0.5));
        const gross = weekly * 0.05 * (0.5 + r());
        rows.push({ address: { address: `0xwhale${i}${a.id.length}`, chain: a.chain }, inUSD: gross * (1 + b) / 2, outUSD: gross * (1 - b) / 2, inValue: null, outValue: null });
      }
      return ok('arkham', '/token/top_flow/{id}', normalizeTopFlows(rows, '7d'), { records: rows.length });
    },
    /** Entity intelligence for a batch of addresses — the Level 2 slot, simulated. */
    addresses: async (list, { max = 25 } = {}) => {
      const out = new Map();
      for (const addr of (list ?? []).slice(0, max)) {
        const a = String(addr).toLowerCase();
        const pick = (name, type) => out.set(a, { name, entity: name, type, id: `sim-${type}`, cls: type });
        if (a.includes('cexa')) pick('Binance (simulat)', 'cex');
        else if (a.includes('cexb')) pick('OKX (simulat)', 'cex');
        else if (a.includes('trez')) pick('Trezoreria proiectului (simulat)', 'treasury');
        else if (a.includes('pool')) pick('Pool DEX (simulat)', 'dex');
        else if (a.includes('brdg')) pick('Wormhole (simulat)', 'bridge');
        else if (a.includes('stak')) pick('Contract de staking (simulat)', 'staking');
        else if (a.includes('whal0')) pick('Fond Alpha (simulat)', 'fund');
        else if (a.includes('flag')) pick('Adresă semnalată (simulat)', 'hack');
      }
      return ok('arkham', '/intelligence/address/{address}', out, { records: out.size, requested: (list ?? []).length });
    },
  };


  /* ───────────────────────── Binance public data mirror (DEMO) ─────────────────────────────── */
  const binanceSpot = {
    id: 'binance_spot',
    spotTickers: async () => ok('binance_spot', '/api/v3/ticker/24hr', live()
      .filter(({ a }) => a.venues.mexc && hashSeed(`bnb:${a.id}`) % 3 !== 0)
      .map(({ a, s }) => ({ symbol: `${a.symbol}USDT`, base: a.symbol, quote: 'USDT', last: s.price, quoteVolume: s.volume24h * 0.45, changePct: s.change.h24, trades: 20_000 }))),
    klines: async (symbol, interval, limit) => {
      const a = findBySym(symbol);
      if (!a) return fail('binance_spot', '/api/v3/klines', 'HTTP_ERROR', 'HTTP 400: invalid symbol');
      return ok('binance_spot', `/api/v3/klines ${interval}`, candlesAt(market, a, now(), interval, limit));
    },
    depth: async (symbol) => {
      const a = findBySym(symbol);
      const s = a ? stateAt(market, a, now()) : null;
      if (!s) return fail('binance_spot', '/api/v3/depth', 'HTTP_ERROR', 'HTTP 400');
      return ok('binance_spot', '/api/v3/depth', { mid: s.price, spreadPct: 0.02, bidDepth1pct: s.volume24h * 0.004, askDepth1pct: s.volume24h * 0.0038, bidDepth2pct: s.volume24h * 0.009, askDepth2pct: s.volume24h * 0.0085 });
    },
  };

  /* ───────────────────────── Hyperliquid (DEMO) ─────────────────────────────────────────────── */
  const hyperliquid = {
    id: 'hyperliquid',
    perps: async () => ok('hyperliquid', '/info metaAndAssetCtxs', live()
      .filter(({ a }) => a.venues.perps.includes('mexc') && hashSeed(`hl:${a.id}`) % 2 === 0)
      .map(({ a }) => {
        const p = perpFor(a, 'mexc');
        return p ? { ...p, symbol: a.symbol, fundingIntervalHours: 1, fundingRate: p.fundingRate === null ? null : p.fundingRate / 8 } : null;
      })
      .filter(Boolean)),
  };

  /* ───────────────────────── Coinalyze (DEMO) ───────────────────────────────────────────────── */
  const CA_VENUES = [['A', 'binance'], ['6', 'bybit'], ['3', 'okx']];
  const coinalyze = {
    id: 'coinalyze',
    keyed: true,
    attribution: 'Date de derivate: Coinalyze (cont gratuit) — valori simulate în modul DEMO',
    markets: async () => ok('coinalyze', '/future-markets', live()
      .filter(({ a }) => a.venues.perps.length)
      .flatMap(({ a }) => CA_VENUES.map(([code, venue]) => ({ symbol: `${a.symbol}USDT_PERP.${code}`, base: a.symbol, multiplier: 1, quote: 'USDT', venue, exchange: venue, fundingIntervalHours: 8 })))),
    current: async (metric, symbols) => {
      const out = new Map();
      for (const sym of symbols ?? []) {
        const base = String(sym).split('USDT')[0];
        const x = live().find(({ a }) => a.symbol === base);
        if (!x) continue;
        const p = perpFor(x.a, 'mexc');
        if (!p) continue;
        const value = metric === 'open-interest'
          ? (p.oiUsd ?? 0) / 3
          : (p.fundingRate ?? 0) * 100;
        out.set(sym, { symbol: sym, value, at: now() });
      }
      return ok('coinalyze', `/${metric}`, out, { units: (symbols ?? []).length });
    },
    history: async (kind, symbols, interval, fromSec, toSec) => {
      const out = new Map();
      const step = 4 * 3_600_000;
      for (const sym of symbols ?? []) {
        const base = String(sym).split('USDT')[0];
        const x = live().find(({ a }) => a.symbol === base);
        if (!x) continue;
        const p = perpFor(x.a, 'mexc');
        if (!p) continue;
        const series = [];
        for (let t = fromSec * 1000; t <= toSec * 1000; t += step) {
          const prog = (t - fromSec * 1000) / Math.max(1, toSec * 1000 - fromSec * 1000);
          const r = mulberry32(hashSeed(`${sym}:${kind}:${t}`))();
          if (kind === 'liquidation-history') {
            series.push({ t, long: (p.oiUsd ?? 0) * 0.002 * r, short: (p.oiUsd ?? 0) * 0.003 * (1 - r) });
          } else {
            const c = ((p.oiUsd ?? 0) / 3) * (0.6 + 0.4 * prog) * (0.95 + r * 0.1);
            series.push({ t, o: c, h: c * 1.02, l: c * 0.98, c, v: c * 0.1 });
          }
        }
        out.set(sym, series);
      }
      return ok('coinalyze', `/${kind} ${interval}`, out, { units: (symbols ?? []).length });
    },
  };

  /* ───────────────────────── alternative.me Fear & Greed (DEMO) ────────────────────────────── */
  const sentiment = {
    id: 'alternative_me',
    attribution: 'Fear & Greed Index: alternative.me',
    fearGreed: async (limit = 90) => {
      const btc = live().find((x) => x.a.symbol === 'BTC');
      const v = Math.round(Math.max(5, Math.min(95, 50 + (btc?.s.change.d7 ?? 0) * 3)));
      const label = v >= 75 ? 'lăcomie extremă' : v >= 55 ? 'lăcomie' : v >= 45 ? 'neutru' : v >= 25 ? 'frică' : 'frică extremă';
      const history = [];
      for (let i = 0; i < Math.min(limit, 90); i += 1) {
        history.push({ at: new Date(now() - i * DAY).toISOString(), value: Math.round(Math.max(5, Math.min(95, v + (mulberry32(hashSeed(`fng:${i}`))() - 0.5) * 20))) });
      }
      return ok('alternative_me', '/fng', { value: v, classification: label, label, at: new Date(now()).toISOString(), change7d: 4, change30d: -3, history, attribution: 'Fear & Greed Index: alternative.me' });
    },
  };

  /* ───────────────────────── Holder lists (DEMO) ────────────────────────────────────────────── */
  /**
   * Synthetic but *structured* holder lists: a liquidity pool, two exchange wallets, a treasury, a
   * bridge, a staking contract and a tail of individual wallets. Their shares drift over time with
   * the asset's phase, so the accumulation/distribution engine has two different snapshots to
   * compare between runs — exactly as it would on-chain.
   */
  function holderListFor(a) {
    const s = stateAt(market, a, now());
    if (!s) return null;
    const ph = phase(a);
    const r = mulberry32(hashSeed(`${a.id}:holders:${Math.floor(now() / (6 * 3_600_000))}`));
    // Drift: a pre-expansion token sees coins leave exchanges into wallets; a hyped one the reverse.
    const drift = ph === 'pre' ? 1 : ph === 'hyped' || ph === 'expansion' ? -1 : a.archetype === 'ACCUM' ? 0.5 : a.archetype === 'DUMPED' || a.archetype === 'DECLINER' ? -0.8 : 0;
    const t = Math.max(0, 30 + rel(a)) / 12;
    const rows = [
      { address: `0xpool${a.id}`.slice(0, 42), tag: 'PancakeSwap LP (simulat)', share: 6 + r() * 3 },
      { address: `0xcexa${a.id}`.slice(0, 42), tag: 'Binance Exchange (simulat)', share: Math.max(0.4, 8 - drift * 2.4 * t + r() * 0.6) },
      { address: `0xcexb${a.id}`.slice(0, 42), tag: 'OKX Exchange (simulat)', share: Math.max(0.3, 4 - drift * 1.1 * t + r() * 0.4) },
      { address: `0xtrez${a.id}`.slice(0, 42), tag: 'Treasury multisig (simulat)', share: Math.max(1, a.top10 * 0.18 - (drift < 0 ? 0.8 * t : 0)) },
      { address: `0xbrdg${a.id}`.slice(0, 42), tag: 'Wormhole Bridge (simulat)', share: 2 + r() },
      { address: `0xstak${a.id}`.slice(0, 42), tag: 'Staking rewards pool (simulat)', share: 3 + r() * 2 },
      { address: '0x000000000000000000000000000000000000dead', tag: 'Burn address', share: 1.5 },
    ];
    const whales = 7;
    for (let i = 0; i < whales; i += 1) {
      const base = Math.max(0.15, a.top10 * 0.05 * (1 - i * 0.1));
      rows.push({ address: `0xwhal${i}${a.id}`.slice(0, 42), tag: null, share: Math.max(0.1, base + drift * 0.55 * t * (1 - i * 0.08) + (r() - 0.5) * 0.08) });
    }
    for (let i = 0; i < 8; i += 1) rows.push({ address: `0xtail${i}${a.id}`.slice(0, 42), tag: null, share: Math.max(0.02, 0.4 - i * 0.04 + (r() - 0.5) * 0.05) });
    if (a.honeypot) rows.push({ address: `0xflag${a.id}`.slice(0, 42), tag: 'Phish/Hack suspect (simulat)', share: 2.2 });

    const total = rows.reduce((acc, x) => acc + x.share, 0);
    const supply = a.circ ?? 1e9;
    return {
      holders: rows
        .map((x) => ({ address: x.address, tag: x.tag, share: x.share, balance: (x.share / 100) * supply, isContract: /pool|brdg|stak|trez/.test(x.address) }))
        .sort((p, q) => q.share - p.share),
      totalSupply: supply,
      holderCount: holdersAt(a),
      coveredPct: total,
      source: 'demo',
    };
  }

  const nodereal = {
    id: 'nodereal',
    cuPerCall: { tokenHolders: 300 },
    tokenHolders: async (chain, address) => {
      const a = market.assets.find((x) => x.address === address && x.chain === chain);
      if (!a) return fail('nodereal', `nr_getTokenHolders ${chain}`, 'HTTP_ERROR', 'HTTP 404');
      const d = holderListFor(a);
      if (!d) return fail('nodereal', `nr_getTokenHolders ${chain}`, 'INVALID_PAYLOAD', 'fără stare');
      return ok('nodereal', `nr_getTokenHolders ${chain}`, d, { units: 300, records: d.holders.length });
    },
  };

  const solanaRpc = {
    id: 'solana_rpc',
    tokenHolders: async (mint) => {
      const a = market.assets.find((x) => x.address === mint);
      if (!a) return fail('solana_rpc', 'getTokenLargestAccounts', 'HTTP_ERROR', 'HTTP 404');
      const d = holderListFor(a);
      if (!d) return fail('solana_rpc', 'getTokenLargestAccounts', 'INVALID_PAYLOAD', 'fără stare');
      return ok('solana_rpc', 'getTokenLargestAccounts', { ...d, source: 'solana_rpc', holders: d.holders.slice(0, 20) }, { records: 20 });
    },
    // The live adapter is a pool of nodes; the simulator is one node that serves every method.
    diagnose: async () => [{
      id: 'fixture', label: 'simulator DEMO', keyed: false,
      methods: {
        getTokenSupply: { status: 'OK', httpStatus: 200, latencyMs: 1, records: 1, message: '' },
        getTokenLargestAccounts: { status: 'OK', httpStatus: 200, latencyMs: 1, records: 20, message: '' },
      },
    }],
    describe: () => ({ account: null, endpoints: [{ id: 'fixture', label: 'simulator DEMO', keyed: false }] }),
  };

  /* ───────────────────────── GitHub + YouTube (DEMO) ────────────────────────────────────────── */
  const github = {
    id: 'github',
    parse: (x) => (x ? { owner: 'demo', repo: String(x).split('/').pop() } : null),
    repo: async (owner, name) => ok('github', '/repos/:owner/:repo', { fullName: `${owner}/${name}`, stars: 1200, forks: 180, openIssues: 24, archived: false, pushedAt: new Date(now() - DAY).toISOString(), language: 'Rust', url: `https://github.com/${owner}/${name}` }),
    commitActivity: async (owner, name) => {
      const a = market.assets.find((x) => x.id === name || x.symbol.toLowerCase() === String(name).toLowerCase());
      const ph = a ? phase(a) : 'normal';
      const base = a?.devCommits ?? 30;
      const mult = ph === 'pre' ? 1.9 : ph === 'hyped' ? 1.2 : 1;
      return ok('github', '/stats/commit_activity', {
        commits30d: Math.round(base * mult),
        commits60to30d: Math.round(base),
        commitsChangePct: Math.round((mult - 1) * 100),
        commits365d: Math.round(base * 12),
        medianWeekly: Math.round(base / 4),
        activeWeeks52: 44,
        lastCommitAt: new Date(now() - 2 * DAY).toISOString(),
        stale: false,
      });
    },
  };

  const youtube = {
    id: 'youtube',
    unitsPerSearch: 100,
    mentions: async ({ symbol, name }) => {
      const a = market.assets.find((x) => x.symbol === symbol);
      const ph = a ? phase(a) : 'normal';
      const n = ph === 'hyped' ? 180 : ph === 'pre' ? 9 : ph === 'expansion' ? 40 : 3;
      return ok('youtube', '/youtube/v3/search', {
        mentions7d: n,
        mentions30d: Math.round(n * 2.6),
        channels: Math.max(1, Math.round(n / 3)),
        latest: [{ title: `${name} (${symbol}) — analiză DEMO`, channel: 'Canal simulat', at: new Date(now() - DAY).toISOString(), videoId: null }],
        scanned: 50,
      }, { units: 100 });
    },
  };

  const cryptoquant = {
    id: 'cryptoquant',
    keyed: true,
    freeEndpoints: ['btcPriceUsd', 'btcOpenInterest', 'btcFunding', 'ethPriceUsd'],
    limits: { plan: 'Basic (gratuit)', creditsMonth: 10_000, requestsPerMinute: 10, historyDays: 30, window: 'zilnic' },
    series: async (key) => {
      const btc = live().find((x) => x.a.symbol === 'BTC');
      if (!btc) return fail('cryptoquant', key, 'HTTP_ERROR', 'HTTP 404');
      return ok('cryptoquant', key, { latest: btc.s.price, at: new Date(now()).toISOString(), change7dPct: btc.s.change.d7, change30dPct: btc.s.change.d30, points: [], window: 'day' }, { units: 1 });
    },
  };

  return {
    coingecko, coinmarketcap, coinpaprika, mexc, binanceSpot,
    gate: venue('gate'), bitget: venue('bitget'), okx: venue('okx'), hyperliquid,
    coinalyze, upbit: krw('upbit', 'upbit'), bithumb: krw('bithumb', 'bithumb'),
    binanceAlpha, gateAlpha, dexscreener, geckoterminal, goplus, nodereal, solanaRpc,
    defillama, sentiment, cryptoquant, github, youtube, arkham,
  };
}

export { normChain };
