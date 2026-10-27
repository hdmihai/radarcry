/**
 * Exchange adapters (all public, keyless, read-only):
 *  - MEXC spot: all 24h tickers + 1D/4H klines (the CRI market-structure source)
 *  - MEXC, Gate, Bitget, OKX perpetuals: funding + open interest (squeeze fuel / crowding)
 *  - Upbit & Bithumb KRW markets, Binance Alpha and Gate Alpha token lists (universe + listing catalysts)
 * No trading endpoint is implemented anywhere in this project.
 */
import { toNum } from '../../../domain/shared/math.js';
import { normChain, splitMultiplier } from '../../../domain/shared/symbols.js';
import { disabled, mapResult, unsupported } from './common.js';

/** Pacing, budget and rate-limit behaviour come from the provider's block in config/default.json. */
const opt = (provider, cfg, endpoint, extra = {}) => ({
  provider, endpoint, timeoutMs: cfg.timeoutMs, retries: cfg.retries, minIntervalMs: cfg.minIntervalMs, maxCalls: cfg.maxCalls, breakerThreshold: 4,
  rateLimitCooldownMs: cfg.rateLimitCooldownMs, rateLimitStrikes: cfg.rateLimitStrikes, maxSlowMs: cfg.maxSlowMs,
  ...extra,
});

/* ----------------------------------------------------------------------------- MEXC */
export function createMexc({ http, cfg, futuresCfg }) {
  const spotTickers = async () => {
    if (!cfg.enabled) return disabled('mexc', '/api/v3/ticker/24hr');
    return mapResult(
      await http.getJson('https://api.mexc.com/api/v3/ticker/24hr', opt('mexc', cfg, '/api/v3/ticker/24hr', { validate: Array.isArray, hash: true })),
      (rows) => rows
        .filter((t) => typeof t.symbol === 'string' && t.symbol.endsWith('USDT') && t.symbol.length > 4)
        .map((t) => {
          const last = toNum(t.lastPrice);
          const open = toNum(t.openPrice);
          return { symbol: t.symbol, base: t.symbol.slice(0, -4), last, quoteVolume: toNum(t.quoteVolume), changePct: last && open ? (last / open - 1) * 100 : null };
        })
        .filter((t) => t.last && t.last > 0),
    );
  };

  /** interval: '1d' | '4h' — MEXC v3 supports 1m,5m,15m,30m,60m,4h,1d,1W,1M; max limit 1000. */
  const klines = async (symbol, interval, limit = 200) => {
    if (!cfg.enabled) return disabled('mexc', '/api/v3/klines');
    const now = Date.now();
    return mapResult(
      await http.getJson(`https://api.mexc.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`, opt('mexc', cfg, `/api/v3/klines ${interval}`, { validate: Array.isArray, retries: 1 })),
      (rows) => rows
        .map((k) => {
          const [t, o, h, l, c, v, closeTime, qv] = k;
          const close = toNum(c);
          const quote = toNum(qv) ?? (toNum(v) !== null && close !== null ? toNum(v) * close : null);
          return { t: toNum(t), o: toNum(o), h: toNum(h), l: toNum(l), c: close, v: quote, closed: toNum(closeTime) ? toNum(closeTime) < now : true };
        })
        .filter((k) => k.t && k.c > 0 && k.h >= k.l),
    );
  };

  const perps = async () => {
    if (!futuresCfg.enabled) return disabled('mexc_futures', '/api/v1/contract/ticker');
    const [tick, det] = await Promise.all([
      http.getJson('https://contract.mexc.com/api/v1/contract/ticker', opt('mexc_futures', futuresCfg, '/api/v1/contract/ticker', { validate: (d) => Array.isArray(d?.data) })),
      http.getJson('https://contract.mexc.com/api/v1/contract/detail', opt('mexc_futures', futuresCfg, '/api/v1/contract/detail', { validate: (d) => Array.isArray(d?.data) })),
    ]);
    if (!tick.ok) return tick;
    const details = new Map((det.ok ? det.data.data : []).map((d) => [d.symbol, d]));
    return mapResult(tick, (d) => d.data
      .filter((t) => typeof t.symbol === 'string' && t.symbol.endsWith('_USDT'))
      .map((t) => {
        const info = details.get(t.symbol) ?? {};
        const rawBase = info.baseCoin ?? t.symbol.slice(0, -5);
        const { base, multiplier } = splitMultiplier(rawBase);
        const price = toNum(t.lastPrice) ?? toNum(t.fairPrice);
        const size = toNum(info.contractSize);
        const hold = toNum(t.holdVol);
        return {
          symbol: t.symbol,
          base,
          multiplier,
          price,
          fundingRate: toNum(t.fundingRate),
          oiUsd: hold !== null && size !== null && price ? hold * size * price : null,
          volume24hUsd: toNum(t.amount24),
          maxLeverage: toNum(info.maxLeverage),
        };
      })
      .filter((p) => p.price));
  };

  return { id: 'mexc', spotTickers, klines, perps };
}

/* ----------------------------------------------------------------------------- Gate */
export function createGate({ http, cfg }) {
  const perps = async () => {
    if (!cfg.enabled) return disabled('gate', '/futures/usdt/tickers');
    const [tick, contracts] = await Promise.all([
      http.getJson('https://api.gateio.ws/api/v4/futures/usdt/tickers', opt('gate', cfg, '/futures/usdt/tickers', { validate: Array.isArray })),
      http.getJson('https://api.gateio.ws/api/v4/futures/usdt/contracts', opt('gate', cfg, '/futures/usdt/contracts', { validate: Array.isArray })),
    ]);
    if (!tick.ok) return tick;
    const mult = new Map((contracts.ok ? contracts.data : []).map((c) => [c.name, c]));
    return mapResult(tick, (rows) => rows
      .filter((t) => typeof t.contract === 'string' && t.contract.endsWith('_USDT'))
      .map((t) => {
        const c = mult.get(t.contract) ?? {};
        const { base, multiplier } = splitMultiplier(t.contract.slice(0, -5));
        const mark = toNum(t.mark_price) ?? toNum(t.last);
        const q = toNum(c.quanto_multiplier);
        const size = toNum(t.total_size);
        return {
          symbol: t.contract,
          base,
          multiplier,
          price: toNum(t.last) ?? mark,
          fundingRate: toNum(t.funding_rate),
          oiUsd: size !== null && q !== null && mark ? size * q * mark : null,
          volume24hUsd: toNum(t.volume_24h_quote) ?? toNum(t.volume_24h_settle),
          maxLeverage: toNum(c.leverage_max),
        };
      })
      .filter((p) => p.price));
  };
  return { id: 'gate', perps };
}

/* ----------------------------------------------------------------------------- Bitget */
export function createBitget({ http, cfg }) {
  const perps = async () => {
    if (!cfg.enabled) return disabled('bitget', '/api/v2/mix/market/tickers');
    return mapResult(
      await http.getJson('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES', opt('bitget', cfg, '/api/v2/mix/market/tickers', { validate: (d) => Array.isArray(d?.data) })),
      (d) => d.data
        .filter((t) => typeof t.symbol === 'string' && t.symbol.endsWith('USDT'))
        .map((t) => {
          const { base, multiplier } = splitMultiplier(t.symbol.slice(0, -4));
          const mark = toNum(t.markPrice) ?? toNum(t.lastPr);
          const hold = toNum(t.holdingAmount);
          return {
            symbol: t.symbol,
            base,
            multiplier,
            price: toNum(t.lastPr) ?? mark,
            fundingRate: toNum(t.fundingRate),
            oiUsd: hold !== null && mark ? hold * mark : null,
            volume24hUsd: toNum(t.usdtVolume) ?? toNum(t.quoteVolume),
            maxLeverage: null,
          };
        })
        .filter((p) => p.price),
    );
  };
  return { id: 'bitget', perps };
}

/* ----------------------------------------------------------------------------- OKX */
export function createOkx({ http, cfg }) {
  const perps = async () => {
    if (!cfg.enabled) return disabled('okx', '/api/v5/public/open-interest');
    const [oi, tick] = await Promise.all([
      http.getJson('https://www.okx.com/api/v5/public/open-interest?instType=SWAP', opt('okx', cfg, '/api/v5/public/open-interest', { validate: (d) => Array.isArray(d?.data) })),
      http.getJson('https://www.okx.com/api/v5/market/tickers?instType=SWAP', opt('okx', cfg, '/api/v5/market/tickers', { validate: (d) => Array.isArray(d?.data) })),
    ]);
    if (!tick.ok) return tick;
    const oiMap = new Map((oi.ok ? oi.data.data : []).map((x) => [x.instId, x]));
    return mapResult(tick, (d) => d.data
      .filter((t) => typeof t.instId === 'string' && t.instId.endsWith('-USDT-SWAP'))
      .map((t) => {
        const { base, multiplier } = splitMultiplier(t.instId.split('-')[0]);
        const last = toNum(t.last);
        const o = oiMap.get(t.instId);
        const oiUsd = toNum(o?.oiUsd) ?? (toNum(o?.oiCcy) !== null && last ? toNum(o.oiCcy) * last : null);
        return { symbol: t.instId, base, multiplier, price: last, fundingRate: null, oiUsd, volume24hUsd: toNum(t.volCcy24h) !== null && last ? toNum(t.volCcy24h) * last : null, maxLeverage: null };
      })
      .filter((p) => p.price));
  };
  return { id: 'okx', perps };
}

/* ----------------------------------------------------------------------------- Korea */
export function createUpbit({ http, cfg }) {
  const markets = async () => {
    if (!cfg.enabled) return disabled('upbit', '/v1/market/all');
    return mapResult(
      await http.getJson('https://api.upbit.com/v1/market/all?is_details=true', opt('upbit', cfg, '/v1/market/all', { validate: Array.isArray })),
      (rows) => rows
        .filter((m) => typeof m.market === 'string' && m.market.startsWith('KRW-'))
        .map((m) => ({
          market: m.market,
          base: m.market.slice(4),
          englishName: m.english_name ?? null,
          warning: m.market_warning === 'CAUTION' || m.market_event?.warning === true ? 'CAUTION' : null,
        })),
    );
  };
  return { id: 'upbit', markets };
}

export function createBithumb({ http, cfg }) {
  const markets = async () => {
    if (!cfg.enabled) return disabled('bithumb', '/v1/market/all');
    return mapResult(
      await http.getJson('https://api.bithumb.com/v1/market/all?isDetails=true', opt('bithumb', cfg, '/v1/market/all', { validate: Array.isArray })),
      (rows) => rows
        .filter((m) => typeof m.market === 'string' && m.market.startsWith('KRW-'))
        .map((m) => ({ market: m.market, base: m.market.slice(4), englishName: m.english_name ?? null, warning: m.market_warning === 'CAUTION' ? 'CAUTION' : null })),
    );
  };
  return { id: 'bithumb', markets };
}

/* ----------------------------------------------------------------------------- Binance Alpha */
/**
 * One Binance Alpha token, in the port's vocabulary. Field names follow the public token list
 * documented at developers.binance.com/docs/alpha/market-data/rest-api/token-list; numbers arrive
 * as strings there and leave as numbers (or null) here.
 */
export function normalizeAlphaToken(t) {
  return {
    tokenId: t.tokenId ?? null,
    alphaId: t.alphaId ?? null,
    chainId: t.chainId,
    chainName: t.chainName,
    contractAddress: t.contractAddress,
    symbol: t.symbol,
    name: t.name,
    image: t.iconUrl ?? null,
    price: toNum(t.price),
    percentChange24h: toNum(t.percentChange24h),
    marketCap: toNum(t.marketCap),
    fdv: toNum(t.fdv),
    circulating: toNum(t.circulatingSupply),
    total: toNum(t.totalSupply),
    liquidity: toNum(t.liquidity),
    volume24h: toNum(t.volume24h),
    trades24h: toNum(t.count24h),
    holders: toNum(t.holders),
    listingCex: t.listingCex === true,
    listingTime: toNum(t.listingTime),
    hotTag: t.hotTag === true,
    // Binance's own per-token points multiplier for trading volume (undocumented semantics): kept
    // as a published fact next to the volume it may have inflated, never used as a score input.
    mulPoint: toNum(t.mulPoint),
    onlineTge: t.onlineTge === true,
    onlineAirdrop: t.onlineAirdrop === true,
  };
}

/**
 * An Alpha token as a universe row (MarketRow). This is what lets the radar see the projects it
 * exists for: LAB, BTW and AGT were all Binance Alpha tokens, and LAB set up at a $12M market cap —
 * below the ~$15M floor of the aggregators' top 1000 in late 2026. Alpha reports supply, holders
 * and liquidity for every token, so these rows are complete enough to be researched like any other.
 */
export function alphaMarketRow(t) {
  return {
    source: 'binance_alpha',
    sourceId: t.alphaId ?? t.tokenId ?? `${t.chainId}:${t.contractAddress}`,
    symbol: t.symbol,
    name: t.name,
    rank: null,
    price: t.price,
    marketCap: t.marketCap,
    fdv: t.fdv,
    volume24h: t.volume24h,
    circulating: t.circulating,
    total: t.total,
    max: null,
    change: { h24: t.percentChange24h },
    ath: null,
    athChangePct: null,
    athDate: null,
    dateAdded: Number.isFinite(t.listingTime) ? new Date(t.listingTime).toISOString() : null,
    firstDataAt: null,
    tags: ['binance-alpha', ...(t.chainName ? [`${String(t.chainName).toLowerCase()}-ecosystem`] : [])],
    // Binance ids chains by number ('56') and Solana as 'CT_501'; when an id is one the research
    // pipeline does not know, the chain name ('Sui') may still be.
    platform: t.contractAddress ? { chain: normChain(t.chainId) ? t.chainId : (t.chainName ?? t.chainId), address: t.contractAddress } : null,
    numMarketPairs: null,
    image: t.image,
    lastUpdated: null,
  };
}

export function createBinanceAlpha({ http, cfg }) {
  /*
   * One HTTP call per run, shared by both ports: `markets()` tags the aggregator assets that are
   * Alpha-listed, `listTop()` brings the Alpha tokens themselves into the universe. Memoised per
   * adapter instance, and the composition root builds one instance per run.
   */
  let pending = null;
  const fetchList = () => {
    if (!cfg.enabled) return Promise.resolve(disabled('binance_alpha', 'alpha/all/token/list'));
    pending ??= http.getJson('https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list', opt('binance_alpha', cfg, '/bapi/.../alpha/all/token/list', { validate: (d) => Array.isArray(d?.data), hash: true }))
      .then((r) => mapResult(r, (d) => d.data
        // Delisted or trading-halted tokens are not research candidates.
        .filter((t) => t && t.offline !== true && t.offsell !== true)
        .map(normalizeAlphaToken)));
    return pending;
  };

  const markets = () => fetchList();
  const listTop = async () => mapResult(await fetchList(), (rows) => rows.filter((t) => t.contractAddress).map(alphaMarketRow));

  /*
   * Candles for Alpha tokens, from the same official public market-data surface
   * (developers.binance.com/docs/alpha/market-data): GET /bapi/defi/v1/public/alpha-trade/klines.
   * Most Alpha tokens have no centralised spot market yet — that is what Alpha is — so without
   * these they would have no price structure at all. The trading symbol is the token id plus a
   * quote asset (ALPHA_175USDT; a few quote in USDC): the exchange info, read once per run, says
   * which. `limit` accepts a fixed set of sizes, so the next size up is requested and trimmed.
   */
  let infoPending = null;
  const exchangeInfo = () => {
    infoPending ??= http.getJson('https://www.binance.com/bapi/defi/v1/public/alpha-trade/get-exchange-info', opt('binance_alpha', cfg, '/bapi/.../alpha-trade/get-exchange-info', { validate: (d) => Array.isArray(d?.data?.symbols), classify: classifyBapi }))
      .then((r) => mapResult(r, (d) => alphaSymbols(d.data.symbols)));
    return infoPending;
  };
  const klines = async (alphaId, interval, limit = 260) => {
    if (!cfg.enabled) return disabled('binance_alpha', 'alpha-trade/klines');
    const info = await exchangeInfo();
    // Without a usable exchange info, USDT — the quote of nearly every Alpha pair — is the best guess.
    const symbol = info.ok && info.data.size ? info.data.get(alphaId) ?? null : `${alphaId}USDT`;
    if (!symbol) return unsupported('binance_alpha', 'alpha-trade/klines', `${alphaId}: nicio pereche Alpha activă`);
    const size = ALPHA_KLINE_SIZES.find((x) => x >= limit) ?? ALPHA_KLINE_SIZES[ALPHA_KLINE_SIZES.length - 1];
    const now = Date.now();
    return mapResult(
      await http.getJson(`https://www.binance.com/bapi/defi/v1/public/alpha-trade/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${size}`, opt('binance_alpha', cfg, `/bapi/.../alpha-trade/klines ${interval}`, { validate: (d) => Array.isArray(d?.data), classify: classifyBapi, retries: 1 })),
      (d) => normalizeKlineRows(d.data, now).slice(-limit),
    );
  };
  return { id: 'binance_alpha', markets, listTop, klines };
}

const ALPHA_KLINE_SIZES = [5, 10, 20, 50, 100, 500, 1000];

/** Binance's `bapi` envelope: HTTP 200 with `success: false` and a code when the request failed. */
export function classifyBapi(d) {
  if (!d || typeof d !== 'object') return { status: 'INVALID_PAYLOAD', message: 'Binance Alpha: răspuns gol' };
  if (d.success === false || (d.code !== undefined && d.code !== '000000' && d.code !== 0 && d.code !== '0')) {
    const message = String(d.message ?? d.messageDetail ?? '').trim();
    return { status: /frequen|too many|limit/i.test(message) ? 'RATE_LIMITED' : 'INVALID_PAYLOAD', message: `Binance Alpha ${d.code ?? ''}: ${message || 'cerere respinsă'}`.trim() };
  }
  return null;
}

/**
 * Map each Alpha token id to its trading symbol, preferring the USDT pair. The id is read from the
 * pair itself (symbol minus quote asset: ALPHA_175USDT → ALPHA_175) as well as from `baseAsset`, so
 * the map holds whichever of the two the exchange info uses for the token list's `alphaId`.
 */
export function alphaSymbols(symbols) {
  const out = new Map();
  const put = (id, s) => {
    if (!id) return;
    const prev = out.get(id);
    if (!prev || s.quoteAsset === 'USDT') out.set(id, s.symbol);
  };
  for (const s of symbols ?? []) {
    if (typeof s?.symbol !== 'string' || !s.symbol) continue;
    if (s.status && s.status !== 'TRADING') continue;
    const quote = typeof s.quoteAsset === 'string' ? s.quoteAsset : '';
    if (quote && s.symbol.endsWith(quote)) put(s.symbol.slice(0, -quote.length), s);
    if (typeof s.baseAsset === 'string') put(s.baseAsset, s);
  }
  return out;
}

/** Binance-style kline rows (strings) → the venue-agnostic candle shape used by the domain. */
export function normalizeKlineRows(rows, nowMs) {
  return (rows ?? [])
    .map((k) => {
      const [t, o, h, l, c, v, closeTime, qv] = k;
      const close = toNum(c);
      const quote = toNum(qv) ?? (toNum(v) !== null && close !== null ? toNum(v) * close : null);
      return { t: toNum(t), o: toNum(o), h: toNum(h), l: toNum(l), c: close, v: quote, closed: toNum(closeTime) ? toNum(closeTime) < nowMs : true };
    })
    .filter((k) => k.t && k.c > 0 && k.h >= k.l);
}

/* ----------------------------------------------------------------------------- Gate Alpha */
/**
 * Gate Alpha — Gate's on-chain trading programme (Solana, BNB Chain, Ethereum, Base, Sui, Arbitrum,
 * Avalanche, Polygon, Optimism and more). Unlike Bybit Alpha, Bitget Onchain, KuCoin Alpha or MEXC's
 * Alpha zone, Gate publishes its Alpha list in the official API v4, keyless:
 *
 *   GET /alpha/currencies   id, name, chain, contract address, trading status (1 normal, 2 suspended, 3 delisted)
 *   GET /alpha/tickers      id, last price, 24h change %, 24h volume (USDT), market cap
 *
 * Both are paginated (limit ≤ 100, page ≥ 1). Those two read endpoints are the only ones used: Gate's
 * Alpha quote, order and account endpoints need a key and are trading surfaces, and this project is
 * research-only (the architecture test forbids them in the source).
 *
 * Gate identifies Alpha tokens by an internal id (`memeboxtrump` — the programme began as Gate
 * MemeBox), not by ticker, and an empty answer can arrive as `[{}, {}]` rather than `[]`. Rows without
 * an id are therefore dropped, and the derived ticker is used for display only: the universe matches
 * Gate Alpha tokens to the rest of the research universe by chain and contract.
 */
const GATE_ALPHA_STATUS = { 1: 'TRADING', 2: 'SUSPENDED', 3: 'DELISTED' };
const GATE_ALPHA_PAGE = 100;

export function gateAlphaSymbol(currency) {
  const id = String(currency ?? '').trim();
  const bare = id.toLowerCase().startsWith('memebox') && id.length > 'memebox'.length ? id.slice('memebox'.length) : id;
  return bare.toUpperCase();
}

/** One Gate Alpha token: the currency row joined with its ticker (which may be missing). */
export function normalizeGateAlpha(c, t = null) {
  return {
    currency: c.currency,
    symbol: gateAlphaSymbol(c.currency),
    name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : null,
    chain: c.chain ?? null,
    contractAddress: typeof c.address === 'string' && c.address.trim() ? c.address.trim() : null,
    status: GATE_ALPHA_STATUS[Number(c.status)] ?? 'UNKNOWN',
    price: toNum(t?.last),
    change24h: toNum(t?.change),
    volume24h: toNum(t?.volume),
    marketCap: toNum(t?.market_cap),
  };
}

/**
 * A Gate Alpha token as a universe row. Gate reports price, market cap and its own 24h volume, but
 * no supply: circulating and total stay null (unknown), never back-computed from the market cap.
 */
export function gateAlphaMarketRow(t) {
  return {
    source: 'gate_alpha',
    sourceId: t.currency,
    symbol: t.symbol,
    name: t.name ?? t.symbol,
    rank: null,
    price: t.price,
    marketCap: t.marketCap,
    fdv: null,
    volume24h: t.volume24h,
    circulating: null,
    total: null,
    max: null,
    change: { h24: t.change24h },
    ath: null,
    athChangePct: null,
    athDate: null,
    dateAdded: null,
    firstDataAt: null,
    tags: ['gate-alpha'],
    platform: t.contractAddress ? { chain: t.chain, address: t.contractAddress } : null,
    numMarketPairs: null,
    image: null,
    lastUpdated: null,
  };
}

export function createGateAlpha({ http, cfg }) {
  const maxPages = Math.max(1, cfg.maxPages ?? 30);
  const BASE = 'https://api.gateio.ws/api/v4';

  /** Read one paginated list until a short page, a failure, or the page budget. */
  const readPages = async (path) => {
    const rows = [];
    let first = null;
    let failure = null;
    let pages = 0;
    let complete = false;
    for (let page = 1; page <= maxPages; page += 1) {
      const r = await http.getJson(`${BASE}${path}?limit=${GATE_ALPHA_PAGE}&page=${page}`, opt('gate_alpha', cfg, path, { validate: Array.isArray }));
      if (!r.ok) { failure = r; break; }
      first ??= r;
      pages += 1;
      rows.push(...r.data.filter((x) => x && typeof x === 'object' && typeof x.currency === 'string' && x.currency.trim()));
      if (r.data.length < GATE_ALPHA_PAGE) { complete = true; break; }
    }
    return { rows, first, failure, pages, complete };
  };

  /* One read per run, shared by the venue tagger and the universe — memoised like Binance Alpha. */
  let pending = null;
  const fetchAll = () => {
    if (!cfg.enabled) return Promise.resolve(disabled('gate_alpha', '/alpha/currencies'));
    pending ??= (async () => {
      const [cur, tick] = await Promise.all([readPages('/alpha/currencies'), readPages('/alpha/tickers')]);
      if (!cur.pages) return cur.failure;
      const tickers = new Map(tick.rows.map((t) => [t.currency, t]));
      const seen = new Set();
      const tokens = [];
      for (const c of cur.rows) {
        if (seen.has(c.currency)) continue;
        seen.add(c.currency);
        tokens.push(normalizeGateAlpha(c, tickers.get(c.currency) ?? null));
      }
      const gaps = [];
      if (!cur.complete) gaps.push(cur.failure ? `lista de tokenuri s-a oprit la pagina ${cur.pages + 1} (${cur.failure.status})` : `lista de tokenuri are peste ${maxPages} pagini; s-au citit ${maxPages}`);
      if (!tick.pages) gaps.push(`tickerele nu au răspuns (${tick.failure?.status ?? 'necunoscut'}) — fără preț, volum și capitalizare`);
      else if (!tick.complete) gaps.push(`tickere citite pe ${tick.pages} pagini`);
      return {
        ok: true,
        status: 'OK',
        data: tokens,
        message: gaps.join('; '),
        meta: {
          ...cur.first.meta,
          endpoint: '/alpha/currencies + /alpha/tickers',
          records: tokens.length,
          partial: gaps.length > 0,
          // Whether the token list itself was read to its last page: only then is a token's
          // absence a fact ("not listed") and a token's first appearance an entry.
          listComplete: cur.complete,
          pages: { currencies: cur.pages, tickers: tick.pages },
        },
      };
    })();
    return pending;
  };

  // Only tokens Gate lists as tradable are research candidates or venue tags.
  const markets = async () => mapResult(await fetchAll(), (rows) => rows.filter((t) => t.status === 'TRADING'));
  const listTop = async () => mapResult(await markets(), (rows) => rows.filter((t) => t.contractAddress && t.marketCap > 0 && t.price > 0).map(gateAlphaMarketRow));
  return { id: 'gate_alpha', markets, listTop };
}

/* --------------------------------------------------------------- Binance public data mirror */
/**
 * Binance's public *data* mirror (data-api.binance.vision). It serves market data only — there is
 * no account or trading surface on that host at all — and it answers from regions where the main
 * api.binance.com is geo-restricted, which makes it the safest way to read the deepest spot book
 * in a CI runner. No key, no account.
 */
export function normalizeBinanceSpot(rows, { nowMs = Date.now() } = {}) {
  const QUOTES = ['USDT', 'FDUSD', 'USDC'];
  const best = new Map();
  for (const t of rows ?? []) {
    if (typeof t.symbol !== 'string') continue;
    const quote = QUOTES.find((q) => t.symbol.endsWith(q));
    if (!quote) continue;
    const base = t.symbol.slice(0, -quote.length);
    if (!base || base.length < 2) continue;
    const last = toNum(t.lastPrice);
    const open = toNum(t.openPrice);
    const quoteVolume = toNum(t.quoteVolume);
    if (!last || last <= 0) continue;
    const closeTime = toNum(t.closeTime);
    // Drop pairs whose last print is older than two days: a delisted pair is not a venue.
    if (closeTime && nowMs - closeTime > 2 * 86_400_000) continue;
    const row = {
      symbol: t.symbol,
      base,
      quote,
      last,
      quoteVolume,
      changePct: last && open ? (last / open - 1) * 100 : null,
      trades: toNum(t.count),
    };
    const prev = best.get(base);
    if (!prev || (row.quoteVolume ?? 0) > (prev.quoteVolume ?? 0)) best.set(base, row);
  }
  return [...best.values()];
}

export function createBinanceSpot({ http, cfg, now = Date.now }) {
  const BASE = 'https://data-api.binance.vision';
  const spotTickers = async () => {
    if (!cfg.enabled) return disabled('binance_spot', '/api/v3/ticker/24hr');
    return mapResult(
      await http.getJson(`${BASE}/api/v3/ticker/24hr`, opt('binance_spot', cfg, '/api/v3/ticker/24hr', { validate: Array.isArray, hash: true })),
      (rows) => normalizeBinanceSpot(rows, { nowMs: now() }),
    );
  };
  /** interval: '1d' | '4h'. Same shape as the MEXC adapter so the feature pipeline is venue-agnostic. */
  const klines = async (symbol, interval, limit = 200) => {
    if (!cfg.enabled) return disabled('binance_spot', '/api/v3/klines');
    const nowMs = now();
    return mapResult(
      await http.getJson(`${BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`, opt('binance_spot', cfg, `/api/v3/klines ${interval}`, { validate: Array.isArray, retries: 1 })),
      (rows) => rows
        .map((k) => {
          const [t, o, h, l, c, v, closeTime, qv] = k;
          const close = toNum(c);
          const quote = toNum(qv) ?? (toNum(v) !== null && close !== null ? toNum(v) * close : null);
          return { t: toNum(t), o: toNum(o), h: toNum(h), l: toNum(l), c: close, v: quote, closed: toNum(closeTime) ? toNum(closeTime) < nowMs : true };
        })
        .filter((k) => k.t && k.c > 0 && k.h >= k.l),
    );
  };
  const depth = async (symbol, limit = 100) => {
    if (!cfg.enabled) return disabled('binance_spot', '/api/v3/depth');
    return mapResult(
      await http.getJson(`${BASE}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`, opt('binance_spot', cfg, '/api/v3/depth', { validate: (d) => Array.isArray(d?.bids), retries: 1 })),
      (d) => {
        const side = (rows) => rows.map(([p, q]) => ({ price: toNum(p), qty: toNum(q) })).filter((x) => x.price && x.qty);
        const bids = side(d.bids);
        const asks = side(d.asks);
        const mid = bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : null;
        const within = (rows, pct) => (mid ? rows.filter((r) => Math.abs(r.price / mid - 1) <= pct).reduce((s, r) => s + r.price * r.qty, 0) : null);
        return {
          mid,
          spreadPct: bids[0] && asks[0] && mid ? ((asks[0].price - bids[0].price) / mid) * 100 : null,
          bidDepth1pct: within(bids, 0.01),
          askDepth1pct: within(asks, 0.01),
          bidDepth2pct: within(bids, 0.02),
          askDepth2pct: within(asks, 0.02),
        };
      },
    );
  };
  return { id: 'binance_spot', spotTickers, klines, depth };
}

/* ----------------------------------------------------------------------------- Hyperliquid */
/**
 * Hyperliquid's `info` endpoint is a public POST API with no key: `metaAndAssetCtxs` returns every
 * perpetual with its funding, open interest and mark price in one call.
 */
export function normalizeHyperliquid(payload) {
  const [meta, ctxs] = Array.isArray(payload) ? payload : [null, null];
  const universe = meta?.universe ?? [];
  const out = [];
  (ctxs ?? []).forEach((c, i) => {
    const u = universe[i];
    if (!u?.name) return;
    const { base, multiplier } = splitMultiplier(u.name);
    const mark = toNum(c.markPx) ?? toNum(c.midPx) ?? toNum(c.oraclePx);
    if (!mark) return;
    const oi = toNum(c.openInterest);
    out.push({
      symbol: u.name,
      base,
      multiplier,
      price: mark,
      // Hyperliquid funding is hourly; the domain normalises to 8h.
      fundingRate: toNum(c.funding),
      fundingIntervalHours: 1,
      oiUsd: oi !== null ? oi * mark : null,
      volume24hUsd: toNum(c.dayNtlVlm),
      maxLeverage: toNum(u.maxLeverage),
    });
  });
  return out;
}

export function createHyperliquid({ http, cfg }) {
  const perps = async () => {
    if (!cfg.enabled) return disabled('hyperliquid', '/info metaAndAssetCtxs');
    return mapResult(
      await http.postJson('https://api.hyperliquid.xyz/info', { type: 'metaAndAssetCtxs' }, opt('hyperliquid', cfg, '/info metaAndAssetCtxs', { validate: (d) => Array.isArray(d) && d.length >= 2 })),
      normalizeHyperliquid,
    );
  };
  return { id: 'hyperliquid', perps };
}
