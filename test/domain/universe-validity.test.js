/**
 * The universe facts the validity gate stands on: where a capitalisation comes from, which coins are
 * tokens on a chain the pipeline cannot read, when a shared ticker is a different token, which spot
 * markets list an asset, and which assets are not research subjects at all (stablecoins, tokenised
 * shares) — each found on a live run before the gate existed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeUniverse, screenUniverse } from '../../src/domain/asset/universe.js';
import { attachVenues } from '../../src/domain/asset/venues.js';
import { exclusionReason } from '../../src/domain/shared/symbols.js';
import { gateAlphaMarketRow, normalizeGateAlpha } from '../../src/adapters/outbound/providers/exchanges.js';

const NOW = Date.parse('2026-10-30T05:00:00Z');
const cgRow = (id, symbol, name, mc, platform = null, over = {}) => ({
  source: 'coingecko', sourceId: id, symbol, name, rank: 600, price: 1.5, marketCap: mc, fdv: mc, volume24h: mc / 5,
  circulating: mc, total: mc, max: null, change: { h24: 1, d7: 6, d30: -9 }, ath: 3, athChangePct: -50, athDate: null,
  dateAdded: null, firstDataAt: null, tags: [], platform, numMarketPairs: null, image: null, lastUpdated: new Date(NOW).toISOString(),
  ...over,
});
const gateRow = (over = {}) => gateAlphaMarketRow(normalizeGateAlpha(
  { currency: 'memeboxabc', name: 'ABC', chain: 'bsc', address: '0x00000000000000000000000000000000000000b2', status: 1, ...over },
  { currency: 'memeboxabc', last: '1.5', change: '2', volume: '900000', market_cap: '30000000' },
));

test('the capitalisation carries its source, and every source\'s figure', () => {
  const address = '0x00000000000000000000000000000000000000b1';
  const merged = mergeUniverse({
    coingecko: [cgRow('abc', 'ABC', 'ABC', 40e6, { chain: 'binance-smart-chain', address })],
    gateAlpha: [gateRow({ address })],
    nowMs: NOW,
  });
  assert.equal(merged.length, 1);
  const m = merged[0].market;
  assert.equal(m.marketCapSource, 'coingecko');
  assert.equal(m.marketCap, 40e6);
  assert.deepEqual(m.marketCapBySource, { coingecko: 40e6, gate_alpha: 30e6 });

  const alone = mergeUniverse({ coingecko: [], gateAlpha: [gateRow()], nowMs: NOW })[0];
  assert.equal(alone.market.marketCapSource, 'gate_alpha', 'a figure only Gate Alpha reports says so');
});

test('a shared ticker on the same chain at another contract is another token, however close the numbers', () => {
  const merged = mergeUniverse({
    coingecko: [cgRow('abc', 'ABC', 'ABC', 31e6, { chain: 'binance-smart-chain', address: '0x00000000000000000000000000000000000000a1' })],
    gateAlpha: [gateRow({ address: '0x00000000000000000000000000000000000000b2' })],
    nowMs: NOW,
  });
  assert.equal(merged.length, 2, 'not merged into the CoinGecko asset');
  const gate = merged.find((a) => a.sources.includes('gate_alpha'));
  assert.deepEqual(gate.sources, ['gate_alpha']);
  assert.equal(gate.market.marketCapSource, 'gate_alpha');
});

test('a token whose only contract is on a chain the pipeline cannot read is still a token', () => {
  const merged = mergeUniverse({
    coingecko: [cgRow('nearish', 'NRS', 'Nearish', 20e6), cgRow('native', 'NTV', 'Native Coin', 20e6)],
    cgPlatforms: new Map([['nearish', [{ chain: 'near-protocol', address: 'nrs.near', unsupported: true }]]]),
    nowMs: NOW,
  });
  const nrs = merged.find((a) => a.symbol === 'NRS');
  assert.deepEqual(nrs.foreignChains, ['near-protocol']);
  assert.equal(nrs.primary, null);
  assert.deepEqual(merged.find((a) => a.symbol === 'NTV').foreignChains, []);
});

test('spot markets: matched by ticker and price, the busiest pair kept, unread venues not counted as read', () => {
  const merged = mergeUniverse({ coingecko: [cgRow('abc', 'ABC', 'ABC', 40e6), cgRow('xyz', 'XYZ', 'XYZ', 40e6)], nowMs: NOW });
  const stats = attachVenues(merged, {
    spot: [
      { venue: 'gate', ok: true, data: [{ symbol: 'ABC_USDT', base: 'ABC', last: 1.55, quoteVolume: 80_000 }, { symbol: 'XYZ_USDT', base: 'XYZ', last: 9, quoteVolume: 1e6 }] },
      { venue: 'bitget', ok: true, data: [{ symbol: 'ABCUSDT', base: 'ABC', last: 1.49, quoteVolume: 20_000 }] },
      { venue: 'okx', ok: false, data: [] },
    ],
  });
  const abc = merged.find((a) => a.symbol === 'ABC');
  const xyz = merged.find((a) => a.symbol === 'XYZ');
  assert.deepEqual(Object.keys(abc.venues.spot).sort(), ['bitget', 'gate']);
  assert.equal(abc.venues.spot.gate.quoteVolume, 80_000);
  assert.deepEqual(xyz.venues.spot, {}, 'XYZ at $9 on Gate is not the $1.5 XYZ');
  assert.deepEqual(abc.venues.spotKnown, ['gate', 'bitget'], 'OKX did not answer: not a venue that was read');
  assert.deepEqual(stats.spot, { gate: 1, bitget: 1 });
});

test('stablecoins are recognised by behaviour, tokenised shares by id and name', () => {
  const x = (o) => exclusionReason({ change30d: null, ...o });
  // Live run: JupUSD reached the published radar (no "USD" word for a word-boundary test).
  assert.equal(x({ symbol: 'JUPUSD', name: 'Jupiter USD', price: 0.999, change7d: 0.05, change30d: 0.1 }), 'STABLECOIN');
  assert.equal(x({ symbol: 'ZCHF', name: 'Frankencoin', price: 1.25, change7d: 0.4, change30d: 1.1 }), 'STABLECOIN');
  assert.equal(x({ symbol: 'JPYC', name: 'JPYC', price: 0.0068, change7d: 0.6, change30d: 1.5 }), 'STABLECOIN');
  assert.equal(x({ symbol: 'XSGD', name: 'XSGD', price: 0.77, change7d: 0.3, change30d: 0.9 }), 'STABLECOIN');
  // Live run: "NVIDIA • Robinhood Token" was published as an $18M small cap.
  assert.equal(x({ symbol: 'NVDA', name: 'NVIDIA • Robinhood Token', price: 180, change7d: 3, id: 'nvidia-robinhood-token' }), 'TOKENIZED_ASSET');
  assert.equal(x({ symbol: 'TSLAX', name: 'Tesla xStock', price: 430, change7d: -4 }), 'TOKENIZED_ASSET');
  // Real projects stay in: volatile, or a fiat code that is only part of a longer ticker.
  for (const o of [
    { symbol: 'NEURA', name: 'Neura', price: 0.9, change7d: -12, change30d: 30 },
    { symbol: 'ONDO', name: 'Ondo', price: 0.9, change7d: -4, change30d: -12 },
    { symbol: 'ETHBULL', name: '3x Long ETH', price: 5, change7d: 1, change30d: 2 },
    { symbol: 'LAB', name: 'LAB', price: 1.01, change7d: 25, change30d: 300 },
    { symbol: 'EUL', name: 'Euler', price: 1.0, change7d: 9, change30d: -20 },
  ]) assert.equal(x(o), null, o.symbol);
});

test('the screen applies the exclusions with the 30-day change and the aggregator id', () => {
  const merged = mergeUniverse({
    coingecko: [
      cgRow('jupiter-usd', 'JUPUSD', 'Jupiter USD', 50e6, null, { price: 1.0, change: { h24: 0, d7: 0.02, d30: 0.05 } }),
      cgRow('nvidia-robinhood-token', 'NVDA', 'NVIDIA', 18e6, null, { price: 180 }),
      cgRow('realproj', 'REAL', 'Real Project', 50e6),
    ],
    nowMs: NOW,
  });
  const { eligible, excluded } = screenUniverse(merged, { minMarketCapUsd: 1e6, maxMarketCapUsd: 300e6, minVolume24hUsd: 1e5 });
  assert.deepEqual(eligible.map((a) => a.symbol), ['REAL']);
  assert.deepEqual(Object.fromEntries(excluded.filter((e) => e.reason !== 'ABOVE_MAX_MCAP').map((e) => [e.symbol, e.reason])), { JUPUSD: 'STABLECOIN', NVDA: 'TOKENIZED_ASSET' });
});
