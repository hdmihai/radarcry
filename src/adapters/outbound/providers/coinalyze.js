/**
 * COINALYZE adapter — derivatives data for Binance, Bybit and OKX from one free account.
 *
 * Why this provider: CoinGlass is the obvious choice for aggregated funding / open interest, and its
 * API starts at a paid tier, so it is excluded from code by the project's no-subscription rule and
 * kept only as a free web link. Coinalyze publishes the same family of data (funding rate, open
 * interest, predicted funding, liquidations, OHLC per market) on a **free account key**, rate-limited
 * to 40 requests per minute. That is the free replacement, and it is what this adapter talks to.
 *
 * Cost model: each symbol in a request counts as one call against the rate limit, so the adapter
 * batches at most 20 symbols per request and declares `units` equal to the batch size, which feeds
 * the quota ledger.
 */
import { toNum } from '../../../domain/shared/math.js';
import { splitMultiplier } from '../../../domain/shared/symbols.js';
import { disabled, mapResult, notConfigured } from './common.js';

const BASE = 'https://api.coinalyze.net/v1';
export const MAX_SYMBOLS = 20;
export const COINALYZE_ATTRIBUTION = 'Date de derivate: Coinalyze (cont gratuit)';

/** Exchange codes used in Coinalyze market symbols (…PERP.A = Binance, .6 = Bybit, .3 = OKX). */
export const VENUE_CODES = { A: 'binance', 6: 'bybit', 3: 'okx', F: 'bitmex', 2: 'deribit', 4: 'huobi', 7: 'gate', 8: 'bitget' };

export function venueOf(symbol) {
  const m = /\.([A-Z0-9])$/.exec(String(symbol ?? ''));
  return m ? (VENUE_CODES[m[1]] ?? `code_${m[1]}`) : 'unknown';
}

/** Coinalyze timestamps are epoch seconds; be tolerant of millisecond payloads too. */
export function toMsAny(v) {
  const n = toNum(v);
  if (n === null) return null;
  return n < 1e11 ? n * 1000 : n;
}

export function normalizeMarkets(rows) {
  const out = [];
  for (const m of rows ?? []) {
    if (!m?.symbol) continue;
    if (m.is_perpetual === false) continue;
    const base = String(m.base_asset ?? '').toUpperCase();
    if (!base) continue;
    const { base: clean, multiplier } = splitMultiplier(base);
    out.push({
      symbol: m.symbol,
      base: clean,
      multiplier,
      quote: String(m.quote_asset ?? '').toUpperCase() || null,
      venue: venueOf(m.symbol),
      exchange: m.exchange ?? null,
      // Funding interval in hours; the domain normalises every rate to percent per 8h.
      fundingIntervalHours: toNum(m.expire_at) === null ? 8 : 8,
    });
  }
  return out;
}

/** `/open-interest`, `/funding-rate`, `/predicted-funding-rate` share one row shape. */
export function normalizeCurrent(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    if (!r?.symbol) continue;
    out.set(r.symbol, { symbol: r.symbol, value: toNum(r.value), at: toMsAny(r.update) });
  }
  return out;
}

export function normalizeHistory(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    if (!r?.symbol || !Array.isArray(r.history)) continue;
    out.set(r.symbol, r.history.map((p) => ({
      t: toMsAny(p.t),
      o: toNum(p.o),
      h: toNum(p.h),
      l: toNum(p.l),
      c: toNum(p.c),
      v: toNum(p.v),
      // Liquidation history uses l/s (long/short notional) instead of OHLC.
      long: toNum(p.l),
      short: toNum(p.s),
    })).filter((p) => p.t));
  }
  return out;
}

/** Coinalyze funding rates are already percentages per interval. */
export function fundingUnitOf() {
  return { alreadyPercent: true, intervalHours: 8 };
}

const chunk = (xs, n) => {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * @param {{http:any, cfg:any, apiKey:string|null}} o
 */
export function createCoinalyze({ http, cfg, apiKey = null }) {
  const headers = apiKey ? { api_key: apiKey } : {};
  const opt = (endpoint, extra = {}) => ({
    provider: 'coinalyze',
    endpoint,
    headers,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    minIntervalMs: cfg.minIntervalMs,
    maxCalls: cfg.maxCalls,
    breakerThreshold: 3,
    ...extra,
  });

  const guard = (endpoint) => {
    if (!cfg.enabled) return disabled('coinalyze', endpoint);
    if (!apiKey) {
      return notConfigured('coinalyze', endpoint,
        'lipsește COINALYZE_API_KEY — cheia este gratuită (cont Coinalyze, 40 apeluri/minut) și deblochează funding + open interest pentru Binance, Bybit și OKX');
    }
    return null;
  };

  /** The market catalogue: one call, cached by the caller for the whole run. */
  const markets = async () => {
    const stop = guard('/future-markets');
    if (stop) return stop;
    return mapResult(
      await http.getJson(`${BASE}/future-markets`, opt('/future-markets', { validate: Array.isArray, units: 1, hash: true })),
      normalizeMarkets,
    );
  };

  /**
   * Current value of one metric for many symbols.
   * @param {'open-interest'|'funding-rate'|'predicted-funding-rate'} metric
   */
  const current = async (metric, symbols) => {
    const endpoint = `/${metric}`;
    const stop = guard(endpoint);
    if (stop) return stop;
    const list = [...new Set((symbols ?? []).filter(Boolean))];
    if (!list.length) return { ok: true, status: 'OK', data: new Map(), message: '', meta: { provider: 'coinalyze', endpoint, fetchedAt: new Date().toISOString(), latencyMs: 0, httpStatus: null, records: 0, units: 0 } };
    const batches = chunk(list, MAX_SYMBOLS);
    const results = [];
    for (const b of batches) {
      const res = await http.getJson(
        `${BASE}${endpoint}?symbols=${encodeURIComponent(b.join(','))}`,
        opt(endpoint, { validate: Array.isArray, units: b.length, retries: 1 }),
      );
      results.push(res);
    }
    const okRes = results.filter((r) => r.ok);
    if (!okRes.length) return results[0];
    const merged = new Map();
    for (const r of okRes) for (const [k, v] of normalizeCurrent(r.data)) merged.set(k, v);
    return {
      ok: true,
      status: 'OK',
      data: merged,
      message: okRes.length < results.length ? `parțial: ${okRes.length}/${results.length} loturi` : '',
      meta: {
        ...okRes[0].meta,
        endpoint,
        records: merged.size,
        units: results.reduce((s, r) => s + (r.meta?.units ?? 0), 0),
        latencyMs: results.reduce((s, r) => s + (r.meta?.latencyMs ?? 0), 0),
        partial: okRes.length < results.length,
      },
    };
  };

  /**
   * History for one metric.
   * @param {'open-interest-history'|'funding-rate-history'|'liquidation-history'|'ohlcv-history'} kind
   * @param {'1min'|'5min'|'15min'|'30min'|'1hour'|'2hour'|'4hour'|'6hour'|'12hour'|'daily'} interval
   */
  const history = async (kind, symbols, interval, fromSec, toSec) => {
    const endpoint = `/${kind}`;
    const stop = guard(endpoint);
    if (stop) return stop;
    const list = [...new Set((symbols ?? []).filter(Boolean))].slice(0, MAX_SYMBOLS);
    if (!list.length) return disabled('coinalyze', endpoint);
    const url = `${BASE}${endpoint}?symbols=${encodeURIComponent(list.join(','))}&interval=${interval}&from=${Math.floor(fromSec)}&to=${Math.floor(toSec)}`;
    return mapResult(
      await http.getJson(url, opt(`${endpoint} ${interval}`, { validate: Array.isArray, units: list.length, retries: 1 })),
      normalizeHistory,
    );
  };

  return { id: 'coinalyze', markets, current, history, attribution: COINALYZE_ATTRIBUTION };
}
