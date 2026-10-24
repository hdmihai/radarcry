/**
 * Exchange adapters (all public, keyless, read-only):
 *  - MEXC spot: all 24h tickers + 1D/4H klines (the CRI market-structure source)
 *  - MEXC, Gate, Bitget, OKX perpetuals: funding + open interest (squeeze fuel / crowding)
 *  - Upbit & Bithumb KRW markets, Binance Alpha token list (listing catalysts)
 * No trading endpoint is implemented anywhere in this project.
 */
import { toNum } from '../../../domain/shared/math.js';
import { splitMultiplier } from '../../../domain/shared/symbols.js';
import { disabled, mapResult } from './common.js';

const opt = (provider, cfg, endpoint, extra = {}) => ({ provider, endpoint, timeoutMs: cfg.timeoutMs, retries: cfg.retries, minIntervalMs: cfg.minIntervalMs, maxCalls: cfg.maxCalls, breakerThreshold: 4, ...extra });

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
export function createBinanceAlpha({ http, cfg }) {
  const markets = async () => {
    if (!cfg.enabled) return disabled('binance_alpha', 'alpha/all/token/list');
    return mapResult(
      await http.getJson('https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list', opt('binance_alpha', cfg, '/bapi/.../alpha/all/token/list', { validate: (d) => Array.isArray(d?.data), hash: true })),
      (d) => d.data
        .filter((t) => t && t.offline !== true)
        .map((t) => ({
          chainId: t.chainId,
          chainName: t.chainName,
          contractAddress: t.contractAddress,
          symbol: t.symbol,
          name: t.name,
          price: toNum(t.price),
          marketCap: toNum(t.marketCap),
          liquidity: toNum(t.liquidity),
          volume24h: toNum(t.volume24h),
          holders: toNum(t.holders),
          listingCex: t.listingCex === true,
          listingTime: toNum(t.listingTime),
          hotTag: t.hotTag === true,
          alphaId: t.alphaId ?? null,
        })),
    );
  };
  return { id: 'binance_alpha', markets };
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
