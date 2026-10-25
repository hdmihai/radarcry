/**
 * The exchange Alpha adapters: Gate Alpha's public list (API v4) and Binance Alpha's public klines.
 *
 * Gate is the second exchange that publishes its Alpha programme as an official keyless list, so it
 * is read like Binance Alpha: one memoised read per run, shared by the venue tagger and the
 * universe. These tests pin the parts of Gate's surface that differ from Binance's — paginated
 * lists, ids that are not tickers, chain spellings, empty objects in place of an empty array — and
 * the two safeguards: only tradable tokens count, and a list cut short says so.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alphaSymbols, classifyBapi, createBinanceAlpha, createGateAlpha, gateAlphaMarketRow, gateAlphaSymbol, normalizeGateAlpha, normalizeKlineRows,
} from '../../src/adapters/outbound/providers/exchanges.js';

const cfg = { enabled: true, timeoutMs: 1000, retries: 0, minIntervalMs: 0, maxCalls: 100, maxPages: 5 };
const ok = (data, provider = 'gate_alpha') => ({ ok: true, status: 'OK', data, message: '', meta: { provider, endpoint: 'x', fetchedAt: '2026-10-25T00:00:00Z', latencyMs: 1, httpStatus: 200 } });
const fail = (status) => ({ ok: false, status, data: null, message: status, meta: { provider: 'gate_alpha', endpoint: 'x' } });

/** A fake HTTP port that serves Gate's two lists page by page and records every URL it was asked for. */
function gateHttp({ currencies, tickers, failAt = null }) {
  const urls = [];
  const page = (rows, url) => {
    const u = new URL(url);
    const p = Number(u.searchParams.get('page'));
    const limit = Number(u.searchParams.get('limit'));
    return rows.slice((p - 1) * limit, p * limit);
  };
  return {
    urls,
    getJson: async (url) => {
      urls.push(url);
      if (failAt && url.includes(failAt.path) && url.includes(`page=${failAt.page}`)) return fail(failAt.status);
      if (url.includes('/alpha/currencies')) return ok(page(currencies, url));
      if (url.includes('/alpha/tickers')) return ok(page(tickers, url));
      throw new Error(`unexpected ${url}`);
    },
  };
}

const currency = (i, over = {}) => ({ currency: `memeboxtok${i}`, name: `Token ${i}`, chain: i % 2 ? 'SOLANA' : 'bsc', address: i % 2 ? `So1ana${i}` : `0x${String(i).padStart(40, 'a')}`, amount_precision: 2, precision: 6, status: 1, ...over });
const ticker = (i) => ({ currency: `memeboxtok${i}`, last: String(0.01 * (i + 1)), change: '-7.45', volume: String(1000 * i), market_cap: String(1e6 * (i + 1)) });

test('Gate Alpha ids are not tickers: the display symbol drops the MemeBox prefix', () => {
  assert.equal(gateAlphaSymbol('memeboxtrump'), 'TRUMP');
  assert.equal(gateAlphaSymbol('memeboxsst'), 'SST');
  assert.equal(gateAlphaSymbol('pengu'), 'PENGU');
  assert.equal(gateAlphaSymbol('memebox'), 'MEMEBOX', 'a bare prefix is a name, not an empty ticker');
});

test('a Gate Alpha token becomes a universe row without invented supply', () => {
  const t = normalizeGateAlpha(currency(2), ticker(2));
  assert.equal(t.status, 'TRADING');
  assert.equal(t.price, 0.03);
  assert.equal(t.change24h, -7.45);
  assert.equal(t.marketCap, 3e6);
  const row = gateAlphaMarketRow(t);
  assert.equal(row.source, 'gate_alpha');
  assert.equal(row.sourceId, 'memeboxtok2');
  assert.equal(row.symbol, 'TOK2');
  assert.deepEqual(row.platform, { chain: 'bsc', address: t.contractAddress });
  assert.equal(row.circulating, null, 'Gate reports no supply; it is never back-computed from the market cap');
  assert.equal(row.total, null);
  assert.deepEqual(row.tags, ['gate-alpha']);
  assert.equal(normalizeGateAlpha(currency(3, { status: 2 })).status, 'SUSPENDED');
  assert.equal(normalizeGateAlpha(currency(3, { status: 3 })).status, 'DELISTED');
});

test('Gate Alpha is read page by page, once per run, and only tradable tokens count', async () => {
  const currencies = [...Array.from({ length: 150 }, (_, i) => currency(i)), currency(150, { status: 2 }), {}, {}];
  const tickers = Array.from({ length: 140 }, (_, i) => ticker(i));
  const http = gateHttp({ currencies, tickers });
  const gate = createGateAlpha({ http, cfg });

  const markets = await gate.markets();
  assert.ok(markets.ok);
  assert.equal(markets.data.length, 150, 'suspended tokens and empty objects are dropped');
  assert.ok(markets.data.every((t) => t.status === 'TRADING'));

  const top = await gate.listTop();
  assert.equal(top.data.length, 140, 'a token without a ticker has no price or market cap: it tags venues but does not enter the universe');
  assert.ok(top.data.every((r) => r.marketCap > 0 && r.price > 0 && r.platform?.address));

  // Two lists × two pages each, read once and shared by both ports.
  assert.equal(http.urls.filter((u) => u.includes('/alpha/currencies')).length, 2);
  assert.equal(http.urls.filter((u) => u.includes('/alpha/tickers')).length, 2);
  assert.ok(http.urls.every((u) => u.startsWith('https://api.gateio.ws/api/v4/alpha/') && /limit=100/.test(u)));
  assert.equal(markets.meta.partial, false);
  assert.equal(markets.meta.listComplete, true);
});

test('a Gate list cut short says so, so the registry never reads it as complete', async () => {
  const currencies = Array.from({ length: 250 }, (_, i) => currency(i));
  const tickers = Array.from({ length: 250 }, (_, i) => ticker(i));
  const cut = createGateAlpha({ http: gateHttp({ currencies, tickers, failAt: { path: '/alpha/currencies', page: 2, status: 'RATE_LIMITED' } }), cfg });
  const r = await cut.markets();
  assert.ok(r.ok, 'the first page is still worth using');
  assert.equal(r.data.length, 100);
  assert.equal(r.meta.partial, true);
  assert.equal(r.meta.listComplete, false, 'the token list itself is incomplete');
  assert.match(r.message, /pagina 2 \(RATE_LIMITED\)/);

  const capped = createGateAlpha({ http: gateHttp({ currencies, tickers }), cfg: { ...cfg, maxPages: 2 } });
  const c = await capped.markets();
  assert.equal(c.data.length, 200);
  assert.equal(c.meta.partial, true);
  assert.match(c.message, /peste 2 pagini/);

  const down = createGateAlpha({ http: gateHttp({ currencies, tickers, failAt: { path: '/alpha/currencies', page: 1, status: 'HTTP_ERROR' } }), cfg });
  const d = await down.markets();
  assert.equal(d.ok, false);
  assert.equal(d.status, 'HTTP_ERROR');
});

test('Binance Alpha klines resolve the trading pair from the exchange info and keep the requested length', async () => {
  const urls = [];
  const rows = Array.from({ length: 500 }, (_, i) => [String(1.7e12 + i * 864e5), '1', '1.2', '0.9', '1.1', '100', String(1.7e12 + i * 864e5 + 1), '110', 5, '50', '55', '0']);
  const http = {
    getJson: async (url) => {
      urls.push(url);
      if (url.includes('get-exchange-info')) {
        return ok({ code: '000000', success: true, data: { symbols: [
          { symbol: 'ALPHA_175USDC', status: 'TRADING', baseAsset: 'ALPHA_175', quoteAsset: 'USDC' },
          { symbol: 'ALPHA_175USDT', status: 'TRADING', baseAsset: 'ALPHA_175', quoteAsset: 'USDT' },
          { symbol: 'ALPHA_118USDC', status: 'TRADING', baseAsset: 'ALPHA_118', quoteAsset: 'USDC' },
          { symbol: 'ALPHA_9USDT', status: 'BREAK', baseAsset: 'ALPHA_9', quoteAsset: 'USDT' },
        ] } }, 'binance_alpha');
      }
      if (url.includes('alpha-trade/klines')) return ok({ code: '000000', success: true, data: rows }, 'binance_alpha');
      throw new Error(`unexpected ${url}`);
    },
  };
  const alpha = createBinanceAlpha({ http, cfg });
  const k = await alpha.klines('ALPHA_175', '1d', 260);
  assert.ok(k.ok);
  assert.equal(k.data.length, 260, 'the next documented size (500) is requested, then trimmed');
  assert.equal(k.data.at(-1).c, 1.1);
  assert.match(urls.find((u) => u.includes('klines')), /symbol=ALPHA_175USDT&interval=1d&limit=500/, 'USDT pair preferred');
  await alpha.klines('ALPHA_118', '4h', 260);
  assert.match(urls.filter((u) => u.includes('klines')).at(-1), /symbol=ALPHA_118USDC/, 'a USDC-only token uses its USDC pair');
  const halted = await alpha.klines('ALPHA_9', '1d', 260);
  assert.equal(halted.status, 'SKIPPED', 'a halted pair costs no call');
  assert.equal(urls.filter((u) => u.includes('get-exchange-info')).length, 1, 'the exchange info is read once');
});

test('Binance bapi envelopes: HTTP 200 with success:false is a failure with the provider\'s reason', () => {
  assert.equal(classifyBapi({ code: '000000', success: true, data: [] }), null);
  assert.deepEqual(classifyBapi({ code: '100001005', success: false, message: 'Too many requests' }).status, 'RATE_LIMITED');
  assert.equal(classifyBapi({ code: '000002', success: false, message: 'illegal parameter' }).status, 'INVALID_PAYLOAD');
  const m = alphaSymbols([{ symbol: 'X', status: 'TRADING' }, { symbol: 'ALPHA_1USDT', quoteAsset: 'USDT' }]);
  assert.equal(m.get('ALPHA_1'), 'ALPHA_1USDT', 'the id is read from the pair even without baseAsset');
  const k = normalizeKlineRows([['1', '1', '2', '0.5', '1.5', '10', '2', '15'], ['0', 'x', 'y', 'z', '0', '0', '0', '0']], 10);
  assert.equal(k.length, 1, 'malformed rows are dropped');
  assert.equal(k[0].v, 15, 'volume is the quote volume');
});
