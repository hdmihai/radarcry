/**
 * Binance Alpha in the research universe.
 *
 * LAB, BTW and AGT — the three projects this radar is built to find the next one of — were all
 * Binance Alpha tokens, and LAB set up at a $12M market cap, below the ~$15M floor of the
 * aggregators' top 1000. A universe built from the top 1000 alone could not see it at the stage
 * that mattered. These tests pin the three ways an Alpha token can enter, and the two safeguards
 * that make Alpha's numbers usable as a norm.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeUniverse, screenUniverse } from '../../src/domain/asset/universe.js';
import { alphaMarketRow, normalizeAlphaToken } from '../../src/adapters/outbound/providers/exchanges.js';
import { buildBaseline, compareToBaseline } from '../../src/domain/discovery/baseline.js';
import { riskEngine } from '../../src/domain/risk/risk-engine.js';

const NOW = Date.parse('2026-10-25T05:00:00Z');
const H = 3_600_000;

/** The example response from developers.binance.com/docs/alpha/market-data/rest-api/token-list. */
const documented = {
  tokenId: '3F350C8B3621770A673159B7A19BC034', chainId: '56', chainName: 'BSC',
  contractAddress: '0xcf640fdf9b3d9e45cbd69fda91d7e22579c14444', name: 'gorilla', symbol: 'gorilla',
  price: '0.00080595003978242023', percentChange24h: '-7.42', volume24h: '14847.711222633409558029675',
  marketCap: '805950.03978242', fdv: '805950.03978242', liquidity: '263192.72813121626034',
  totalSupply: '1000000000', circulatingSupply: '1000000000', holders: '7120', decimals: 18,
  listingCex: false, hotTag: false, offline: false, alphaId: 'ALPHA_175', offsell: false, count24h: '166',
  onlineTge: false, onlineAirdrop: false, listingTime: 1746686700000, mulPoint: 1,
};

const cgRow = (id, symbol, name, mc, address) => ({
  source: 'coingecko', sourceId: id, symbol, name, rank: 500, price: 1, marketCap: mc, fdv: mc, volume24h: mc / 4,
  circulating: mc, total: mc, max: null, change: { h24: 1, d7: 2, d30: 3 }, ath: 2, athChangePct: -50, athDate: null,
  dateAdded: null, firstDataAt: null, tags: [], platform: address ? { chain: 'binance-smart-chain', address } : null,
  numMarketPairs: null, image: null, lastUpdated: new Date(NOW).toISOString(),
});
const alphaRow = (over = {}) => alphaMarketRow(normalizeAlphaToken({ ...documented, ...over }));

test('the documented Alpha token becomes a complete universe row', () => {
  const r = alphaRow();
  assert.equal(r.source, 'binance_alpha');
  assert.equal(r.sourceId, 'ALPHA_175');
  assert.equal(r.price, 0.00080595003978242023);
  assert.equal(r.marketCap, 805950.03978242);
  assert.equal(r.circulating, 1_000_000_000);
  assert.equal(r.change.h24, -7.42);
  assert.deepEqual(r.platform, { chain: '56', address: '0xcf640fdf9b3d9e45cbd69fda91d7e22579c14444' });
  assert.ok(r.tags.includes('binance-alpha'));
  assert.equal(r.dateAdded, new Date(1746686700000).toISOString());
});

test('an Alpha token already in the top 1000 is enriched, never duplicated', () => {
  const address = '0x00000000000000000000000000000000000000aa';
  const merged = mergeUniverse({
    coingecko: [cgRow('block-street', 'BSB', 'Block Street', 25e6, address)],
    binanceAlpha: [alphaRow({ symbol: 'BSB', name: 'Block Street', contractAddress: address, marketCap: '24000000', alphaId: 'ALPHA_790' })],
    nowMs: NOW,
  });
  assert.equal(merged.length, 1);
  const a = merged[0];
  assert.equal(a.key, 'cg:block-street');
  assert.equal(a.ids.alpha, 'ALPHA_790');
  assert.ok(a.sources.includes('coingecko') && a.sources.includes('binance_alpha'));
  assert.equal(a.market.marketCap, 25e6, 'the aggregator stays the primary source when it has the token');
});

test('an Alpha token below the top 1000 enters with its CoinGecko identity when CoinGecko knows the contract', () => {
  const address = '0x00000000000000000000000000000000000000bb';
  // A LAB-like setup: $12M market cap, under the ~$15M floor of the aggregators' top 1000.
  const merged = mergeUniverse({
    coingecko: [cgRow('big-token', 'BIG', 'Big Token', 4e8, '0x00000000000000000000000000000000000000cc')],
    binanceAlpha: [alphaRow({ symbol: 'LABX', name: 'Lab X', contractAddress: address, price: '0.12', marketCap: '12000000', volume24h: '3000000', circulatingSupply: '100000000', alphaId: 'ALPHA_900' })],
    cgPlatforms: new Map([['lab-x', [{ chain: 'binance-smart-chain', address }]]]),
    nowMs: NOW,
  });
  const lab = merged.find((a) => a.symbol === 'LABX');
  assert.ok(lab, 'the Alpha-only token is part of the universe');
  assert.equal(lab.key, 'cg:lab-x', 'same key it will have if it later enters the top 1000');
  assert.equal(lab.ids.coingecko, 'lab-x');
  assert.deepEqual(lab.sources, ['binance_alpha']);
  assert.equal(lab.market.marketCap, 12e6);
  assert.equal(lab.market.change.h24, -7.42);
  assert.equal(lab.primary.chain, 'bsc');

  const { eligible } = screenUniverse(merged, { minMarketCapUsd: 1e6, maxMarketCapUsd: 5e8, minVolume24hUsd: 5e5 });
  assert.ok(eligible.some((a) => a.key === 'cg:lab-x'), 'and it passes the small-cap screen');
});

test('an Alpha token CoinGecko does not know keeps a stable Alpha identity', () => {
  const merged = mergeUniverse({ coingecko: [], binanceAlpha: [alphaRow()], cgPlatforms: new Map(), nowMs: NOW });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].key, 'alpha:ALPHA_175');
  assert.equal(merged[0].ids.coingecko, null);
});

test('a holder count is only ever compared with counts from the same provider', () => {
  const point = (h, src, dt) => ({ at: NOW - dt * H, metrics: { holders: h, holdersSource: src } });
  // Four runs measured by GoPlus, around 10 000 holders.
  const history = [point(10_000, 'goplus', 16), point(10_050, 'goplus', 12), point(10_020, 'goplus', 8), point(10_040, 'goplus', 4)];
  const baseline = buildBaseline(history, { nowMs: NOW, windowDays: 30, minPoints: 4 });

  // Today only Binance Alpha answered, and it counts differently (11 500): not a change.
  const otherSource = compareToBaseline({ holders: 11_500, holdersSource: 'binance_alpha' }, baseline);
  assert.equal(otherSource.holders.n, 0, 'no same-source history');
  assert.equal(otherSource.holders.changePct, null);

  // Same provider, really +14 %: a change.
  const same = compareToBaseline({ holders: 11_450, holdersSource: 'goplus' }, baseline);
  assert.equal(same.holders.n, 4);
  assert.ok(same.holders.changePct > 13 && same.holders.changePct < 15, String(same.holders.changePct));
});

test('extreme turnover on an Alpha token is named as a risk to volume-based readings', () => {
  const base = { market: {}, onchain: {}, risk: {}, quality: { flags: [] } };
  const keys = (asset) => riskEngine({ asset: { ...base, ...asset }, market: { regime: { state: 'NEUTRAL' } }, changed: { count: 0 } }).invalidators.map((i) => i.key);

  const alphaHot = { venues: { alpha: { status: 'LISTED', mulPoint: 2 } }, derived: { turnover: 3.77 } };
  assert.ok(keys(alphaHot).includes('ALPHA_VOLUME'));
  const label = riskEngine({ asset: { ...base, ...alphaHot }, market: { regime: { state: 'NEUTRAL' } }, changed: { count: 0 } }).invalidators.find((i) => i.key === 'ALPHA_VOLUME').label;
  assert.match(label, /377%/);
  assert.match(label, /×2/);

  assert.ok(!keys({ venues: { alpha: { status: 'LISTED' } }, derived: { turnover: 0.2 } }).includes('ALPHA_VOLUME'), 'normal turnover');
  assert.ok(!keys({ venues: { alpha: null }, derived: { turnover: 3 } }).includes('ALPHA_VOLUME'), 'not an Alpha token');
});
