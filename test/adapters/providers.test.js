/**
 * Contract tests for provider adapters: realistic payload shapes in, normalised domain rows out.
 * The HTTP port is replaced by a stub that serves recorded-style payloads per URL pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMexc } from '../../src/adapters/outbound/providers/exchanges.js';
import { arkhamClass, createArkham, createDexScreener, createGoPlus, normalizeEvm, normalizeTopFlows } from '../../src/adapters/outbound/providers/onchain.js';
import { normalizeMarket } from '../../src/adapters/outbound/providers/coingecko.js';
import { createCoinMarketCap, listingCredits, normalizeListing } from '../../src/adapters/outbound/providers/coinmarketcap.js';

function stubHttp(routes) {
  const seen = [];
  return {
    seen,
    async getJson(url, o) {
      seen.push(url);
      this.lastHeaders = o.headers ?? {};
      const hit = routes.find(([re]) => re.test(url));
      if (!hit) return { ok: false, status: 'HTTP_ERROR', data: null, message: 'no route', meta: { provider: o.provider } };
      const data = typeof hit[1] === 'function' ? hit[1](url) : hit[1];
      if (o.validate && !o.validate(data)) return { ok: false, status: 'INVALID_PAYLOAD', data: null, message: 'invalid', meta: { provider: o.provider } };
      // The stub mirrors the real client's contract, including the quota units a call declares:
      // the credit accounting is part of what the adapters are responsible for getting right.
      return { ok: true, status: 'OK', data, message: '', meta: { provider: o.provider, units: o.units ?? 1, latencyMs: 1, records: Array.isArray(data) ? data.length : null } };
    },
    async postJson(url, payload, o) {
      seen.push(url);
      this.lastBody = payload;
      return this.getJson(url, o);
    },
  };
}

const cfg = { enabled: true, minIntervalMs: 0, timeoutMs: 1000, retries: 0 };

test('MEXC: spot USDT tickers, closed-candle flag, perp OI = holdVol × contractSize × price', async () => {
  const now = Date.now();
  const http = stubHttp([
    [/api\/v3\/ticker\/24hr/, [
      { symbol: 'LABUSDT', lastPrice: '0.12', openPrice: '0.10', quoteVolume: '1500000' },
      { symbol: 'LABUSDC', lastPrice: '0.12', openPrice: '0.10', quoteVolume: '1' },
      { symbol: 'DEADUSDT', lastPrice: '0', openPrice: '0', quoteVolume: '0' },
    ]],
    [/api\/v3\/klines/, [
      [now - 2 * 86_400_000, '1', '1.2', '0.9', '1.1', '1000', now - 86_400_000 - 1, '1100'],
      [now - 86_400_000, '1.1', '1.3', '1.0', '1.2', '900', now + 1000, '1080'],
    ]],
    [/contract\/ticker/, { success: true, data: [{ symbol: '1000PEPE_USDT', lastPrice: 0.012, fundingRate: -0.0003, holdVol: 50_000, amount24: 2_000_000 }, { symbol: 'LAB_USDT', lastPrice: 0.12, fundingRate: 0.0001, holdVol: 1_000_000, amount24: 500_000 }] }],
    [/contract\/detail/, { success: true, data: [{ symbol: '1000PEPE_USDT', baseCoin: '1000PEPE', contractSize: 1000, maxLeverage: 50 }, { symbol: 'LAB_USDT', baseCoin: 'LAB', contractSize: 10, maxLeverage: 20 }] }],
  ]);
  const mexc = createMexc({ http, cfg, futuresCfg: cfg });
  const spot = await mexc.spotTickers();
  assert.deepEqual(spot.data.map((t) => t.base), ['LAB']);
  assert.ok(Math.abs(spot.data[0].changePct - 20) < 1e-9);
  const k = await mexc.klines('LABUSDT', '1d', 2);
  assert.deepEqual(k.data.map((x) => x.closed), [true, false], 'the forming candle is marked open');
  assert.equal(k.data[0].v, 1100, 'volume in quote currency');
  const perps = await mexc.perps();
  const pepe = perps.data.find((p) => p.base === 'PEPE');
  assert.equal(pepe.multiplier, 1000);
  const lab = perps.data.find((p) => p.base === 'LAB');
  assert.equal(lab.oiUsd, 1_000_000 * 10 * 0.12);
  assert.equal(lab.fundingRate, 0.0001);
});

test('DexScreener: pairs aggregate per token (liquidity, txns, oldest pair, top pair)', async () => {
  const addr = '0xAbCdEf0000000000000000000000000000000001';
  const http = stubHttp([[/tokens\/v1\/bsc\//, [
    { baseToken: { address: addr }, liquidity: { usd: 300_000 }, volume: { h24: 90_000 }, txns: { h24: { buys: 120, sells: 80 }, h6: { buys: 30, sells: 20 } }, pairCreatedAt: 1_700_000_000_000, url: 'https://dexscreener.com/bsc/pair1', dexId: 'pancakeswap', pairAddress: '0xp1', priceUsd: '0.12', info: { websites: [{ url: 'https://lab.example' }], socials: [{ type: 'twitter', url: 'https://x.com/lab' }] } },
    { baseToken: { address: addr.toLowerCase() }, liquidity: { usd: 100_000 }, volume: { h24: 10_000 }, txns: { h24: { buys: 10, sells: 20 } }, pairCreatedAt: 1_650_000_000_000, url: 'https://dexscreener.com/bsc/pair2', dexId: 'uniswap', pairAddress: '0xp2', priceUsd: '0.121' },
    { baseToken: { address: '0x9999999999999999999999999999999999999999' }, liquidity: { usd: 5 } },
  ]]]);
  const ds = createDexScreener({ http, cfg });
  const r = await ds.tokens('bsc', [addr]);
  const agg = r.data[addr.toLowerCase()];
  assert.equal(agg.pairs, 2);
  assert.equal(agg.liquidityUsd, 400_000);
  assert.equal(agg.buys24h, 130);
  assert.equal(agg.oldestPairAt, 1_650_000_000_000);
  assert.equal(agg.topPair.pairAddress, '0xp1');
  assert.equal(Object.keys(r.data).length, 1, 'unrelated base tokens are ignored');
});

test('GoPlus EVM: fractional taxes, renounced owner, concentration net of burn/LP/CEX', async () => {
  const sec = normalizeEvm({
    is_honeypot: '0', cannot_sell_all: '0', buy_tax: '0.05', sell_tax: '0.1', is_mintable: '0', owner_address: '0x000000000000000000000000000000000000dead',
    hidden_owner: '0', is_open_source: '1', holder_count: '8852', total_supply: '1000000',
    holders: [
      { address: '0x000000000000000000000000000000000000dead', percent: '0.30', tag: '' },
      { address: '0x1111', percent: '0.20', tag: 'PancakeSwap V2 LP' },
      { address: '0x2222', percent: '0.10', tag: 'Binance 14' },
      { address: '0x3333', percent: '0.05', tag: '', is_locked: 0 },
    ],
  });
  assert.equal(sec.holders, 8852);
  assert.equal(sec.security.buyTax, 0.05);
  assert.equal(sec.security.ownerRenounced, true);
  assert.equal(sec.security.openSource, true);
  assert.ok(Math.abs(sec.top10Pct - 65) < 1e-9);
  assert.ok(Math.abs(sec.top10EffectivePct - 5) < 1e-9, 'burn, LP and exchange wallets excluded from effective concentration');

  const http = stubHttp([[/token_security\/56/, (url) => ({ code: 1, result: { [url.split('=')[1].toLowerCase()]: { is_honeypot: '1', holder_count: '10' } } })]]);
  const gp = createGoPlus({ http, cfg: { ...cfg, batchSize: 1 } });
  const r = await gp.security('bsc', ['0xAAA']);
  assert.equal(r.data['0xaaa'].security.honeypot, true);
});

test('CoinGecko markets row normalises to the shared MarketRow shape', () => {
  const row = normalizeMarket({ id: 'lab', symbol: 'lab', name: 'LAB', market_cap_rank: 412, current_price: 0.12, market_cap: 2.1e7, fully_diluted_valuation: 2.6e8, total_volume: 3e6, circulating_supply: 8e7, total_supply: 1e9, max_supply: 1e9, price_change_percentage_7d_in_currency: 12.5, ath: 0.5, ath_change_percentage: -76, last_updated: '2026-10-17T08:59:00Z' });
  assert.equal(row.source, 'coingecko');
  assert.equal(row.change.d7, 12.5);
  assert.equal(row.fdv, 2.6e8);
  assert.equal(row.athChangePct, -76);
});

test('CoinMarketCap: official Pro API only, credits charged per 100 coins, no key = clear instruction', async () => {
  // The adapter deliberately speaks only to the documented Pro endpoint with a free Basic key.
  // Earlier versions also called the website's undocumented data-api; a research tool must not
  // depend on a surface that can be withdrawn without notice, so that path is gone.
  const row = normalizeListing({
    id: 1, slug: 'lab', symbol: 'LAB', name: 'LAB', cmc_rank: 400, is_active: 1,
    circulating_supply: 8e7, total_supply: 1e9, date_added: '2025-10-15T00:00:00Z',
    tags: ['bnb-chain-ecosystem'], platform: { slug: 'bnb', token_address: '0xABC' },
    quote: { USD: { price: 0.12, market_cap: 2.1e7, volume_24h: 3e6, percent_change_7d: 10, fully_diluted_market_cap: 1.2e8 } },
  });
  assert.equal(row.price, 0.12);
  assert.equal(row.marketCap, 2.1e7);
  assert.equal(row.circulating, 8e7);
  assert.equal(row.rank, 400);
  assert.equal(row.change.d7, 10);
  assert.equal(row.fdv, 1.2e8);
  assert.deepEqual(row.tags, ['bnb-chain-ecosystem']);
  assert.equal(row.platform.address, '0xABC');
  assert.equal(row.dateAdded, '2025-10-15T00:00:00Z');

  // Credits: 1 per 100 coins, minimum 1 — the unit the free plan actually bills.
  assert.equal(listingCredits(100), 1);
  assert.equal(listingCredits(1000), 10);
  assert.equal(listingCredits(1), 1);
  assert.equal(listingCredits(0), 1);

  // With a key: one documented endpoint, the key in the documented header, credits declared.
  const http = stubHttp([[/listings\/latest/, { data: [{ id: 1, symbol: 'LAB', name: 'LAB', is_active: 1, quote: { USD: { price: 1 } } }] }]]);
  const withKey = createCoinMarketCap({ http, cfg: { ...cfg, pageSize: 1000 }, apiKey: 'free-basic-key' });
  const res = await withKey.listTop(1000);
  assert.equal(res.ok, true);
  assert.equal(http.seen.length, 1, 'top 1000 is one page, not ten');
  assert.ok(http.seen[0].startsWith('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest'), http.seen[0]);
  assert.equal(http.lastHeaders['X-CMC_PRO_API_KEY'], 'free-basic-key');
  assert.equal(res.meta.units, 10, 'a top-1000 listing costs 10 of the 10 000 free monthly credits');

  // Without a key: NOT_CONFIGURED plus the exact free signup step, never a silent failure.
  const noKey = createCoinMarketCap({ http: stubHttp([]), cfg, apiKey: null });
  const miss = await noKey.listTop(100);
  assert.equal(miss.ok, false);
  assert.equal(miss.status, 'NOT_CONFIGURED');
  assert.match(miss.message, /gratuit/);
  assert.match(miss.message, /pro\.coinmarketcap\.com/);
});

test('Arkham top_flow: wallet vs exchange vs protocol flows, entity context (CRI wallet intelligence)', () => {
  const rows = [
    { address: { address: '0xcex', chain: 'bsc', arkhamEntity: { id: 'binance', name: 'Binance', type: 'cex' } }, inUSD: 100_000, outUSD: 400_000, inValue: 1, outValue: 4 },
    { address: { address: '0xfund', chain: 'bsc', arkhamEntity: { id: 'fund-x', name: 'Fund X', type: 'fund' } }, inUSD: 300_000, outUSD: 50_000 },
    { address: { address: '0xpool', chain: 'bsc', arkhamEntity: { id: 'pcs', name: 'PancakeSwap', type: 'dex' } }, inUSD: 200_000, outUSD: 210_000 },
    { address: { address: '0xwhale', chain: 'bsc' }, inUSD: 120_000, outUSD: 20_000 },
    { address: { address: '0xzero', chain: 'bsc' }, inUSD: 0, outUSD: 0 },
  ];
  const f = normalizeTopFlows(rows, '7d');
  assert.equal(f.addresses, 4, 'rows without flow are ignored');
  assert.equal(f.walletInUsd, 420_000);
  assert.equal(f.walletOutUsd, 70_000);
  assert.ok(Math.abs(f.netflowRatio - 350 / 490) < 1e-9, 'wallets accumulate');
  assert.equal(f.exchangeNetUsd, -300_000, 'net withdrawals from exchanges');
  assert.ok(Math.abs(f.exchangeBias - 0.6) < 1e-9);
  assert.equal(f.protocolNetUsd, -10_000, 'DEX pools are kept out of the wallet bias');
  assert.equal(f.entityCount, 3);
  assert.ok(Math.abs(f.labeledShare - 0.9) < 1e-9);
  assert.deepEqual(f.topEntities.map((e) => e.name), ['Binance', 'Fund X', 'PancakeSwap']);
  assert.equal(arkhamClass('Exchange'), 'cex');
  assert.equal(arkhamClass('lending-decentralized'), 'protocol');
  assert.equal(arkhamClass(null), 'wallet');
});

test('Arkham adapter: documented endpoint + API-Key header; NOT_CONFIGURED without a key', async () => {
  const none = createArkham({ http: stubHttp([]), cfg });
  const r0 = await none.tokenFlows('lab');
  assert.equal(r0.status, 'NOT_CONFIGURED');
  assert.equal(none.keyed, false);

  const http = stubHttp([[/\/token\/top_flow\/lab\?timeLast=7d$/, [{ address: { arkhamEntity: { id: 'cex', name: 'CEX', type: 'cex' } }, inUSD: 10, outUSD: 30 }]]]);
  const ark = createArkham({ http, cfg: { ...cfg, window: '7d' }, apiKey: 'k-123' });
  const r = await ark.tokenFlows('lab');
  assert.equal(r.ok, true);
  assert.equal(http.seen[0], 'https://api.arkm.com/token/top_flow/lab?timeLast=7d');
  assert.equal(http.lastHeaders['API-Key'], 'k-123');
  assert.equal(r.data.exchangeNetUsd, -20);

  const custom = stubHttp([[/top_flow/, []]]);
  await createArkham({ http: custom, cfg, apiKey: 'k', baseUrl: 'https://proxy.example/arkham/' }).tokenFlows('lab');
  assert.ok(custom.seen[0].startsWith('https://proxy.example/arkham/token/top_flow/lab'), 'ARKHAM_API_BASE override');
});
