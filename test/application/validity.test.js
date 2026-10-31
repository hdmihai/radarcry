/**
 * The validity gate, wired: universe merge + venues + a GoPlus payload shaped like the public
 * response → the evidence → the verdict → what the snapshot and the universe table publish. The
 * domain rules have their own tests; these pin the seams, where a vocabulary drift would let a
 * honeypot through as "clean" or hold a real project back as "unlisted".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeUniverse } from '../../src/domain/asset/universe.js';
import { attachVenues } from '../../src/domain/asset/venues.js';
import { normalizeEvm } from '../../src/adapters/outbound/providers/onchain.js';
import { gateAlphaMarketRow, normalizeGateAlpha } from '../../src/adapters/outbound/providers/exchanges.js';
import {
  preRejected, validateAsset, validityEvidence, validityPolicy, validityReport, validityView, validityWhy, VALIDITY, VALIDITY_CODE,
} from '../../src/application/use-cases/validity.js';
import { ASSET_FIELDS, SPOT_CODE, universeTable } from '../../src/application/use-cases/universe-view.js';
import { loadConfig } from '../../src/config/load-config.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../fixture-run.js';

const NOW = Date.parse('2026-10-30T05:00:00Z');
const policy = validityPolicy({ universe: { minMarketCapUsd: 1e6, maxMarketCapUsd: 300e6 }, validity: { minDexLiquidityUsd: 50_000 } });

const cgRow = (id, symbol, mc, address, over = {}) => ({
  source: 'coingecko', sourceId: id, symbol, name: `${symbol} Protocol`, rank: 600, price: 1.5, marketCap: mc, fdv: mc * 1.5, volume24h: mc / 5,
  circulating: mc, total: mc, max: null, change: { h24: 1, d7: 6, d30: -9 }, ath: 3, athChangePct: -50, athDate: null,
  dateAdded: '2025-01-10T00:00:00Z', firstDataAt: null, tags: [], platform: address ? { chain: 'binance-smart-chain', address } : null,
  numMarketPairs: null, image: null, lastUpdated: new Date(NOW).toISOString(), ...over,
});
const addr = (n) => `0x${String(n).padStart(40, '0')}`;

/** A universe of four, with the venues of a run where every spot list answered. */
function universe() {
  const assets = mergeUniverse({
    coingecko: [
      cgRow('good', 'GOOD', 60e6, addr(1)),
      cgRow('trap', 'TRAP', 30e6, addr(2)),
      cgRow('nolist', 'NOLIST', 20e6, addr(3)),
      cgRow('big', 'BIG', 900e6, addr(4)),
    ],
    gateAlpha: [gateAlphaMarketRow(normalizeGateAlpha(
      { currency: 'memeboxmeme', name: 'MEME', chain: 'bsc', address: addr(5), status: 1 },
      { currency: 'memeboxmeme', last: '0.01', change: '3', volume: '400000', market_cap: '9000000' },
    ))],
    nowMs: NOW,
  });
  attachVenues(assets, {
    mexcSpot: { ok: true, data: [{ symbol: 'TRAPUSDT', base: 'TRAP', last: 1.5, quoteVolume: 90_000 }] },
    binanceSpot: { ok: true, data: [] },
    spot: [
      { venue: 'gate', ok: true, data: [{ symbol: 'GOOD_USDT', base: 'GOOD', last: 1.51, quoteVolume: 300_000 }, { symbol: 'BIG_USDT', base: 'BIG', last: 1.5, quoteVolume: 9e6 }] },
      { venue: 'okx', ok: true, data: [] },
      { venue: 'bitget', ok: true, data: [] },
    ],
    perps: [],
  });
  return new Map(assets.map((a) => [a.symbol, a]));
}

/** The GoPlus record of one contract, as the adapter normalises the public response. */
const scan = (over = {}) => ({
  ...normalizeEvm({
    is_honeypot: '0', cannot_sell_all: '0', buy_tax: '0', sell_tax: '0', is_mintable: '0', is_open_source: '1',
    owner_address: '0x0000000000000000000000000000000000000000', hidden_owner: '0', holders: [], ...over,
  }),
  asOf: NOW - 3_600_000,
});

test('a listed project with a clean contract is VALID; the evidence names every listing', () => {
  const U = universe();
  const good = U.get('GOOD');
  const ev = validityEvidence({ asset: good, deep: { security: scan(), dex: { liquidityUsd: 250_000, oldestPairAt: NOW - 300 * 86_400_000 } }, nowMs: NOW });
  assert.deepEqual(ev.spot, [{ venue: 'gate', quoteVolume: 300_000 }]);
  assert.equal(ev.venuesRead.spot, true);
  assert.equal(ev.marketCapSource, 'coingecko');
  assert.deepEqual(ev.aggregators, ['coingecko']);
  assert.equal(ev.hasContract, true);
  assert.equal(ev.scanner, true, 'BSC has a free scanner');
  assert.equal(ev.security.honeypot, false);
  const r = validateAsset({ asset: good, deep: { security: scan(), dex: { liquidityUsd: 250_000 } }, nowMs: NOW, policy });
  assert.equal(r.status, VALIDITY.VALID, JSON.stringify(r.reasons));
});

test('a honeypot in the GoPlus payload is rejected through the whole seam, not published as clean', () => {
  const r = validateAsset({ asset: universe().get('TRAP'), deep: { security: scan({ is_honeypot: '1' }) }, nowMs: NOW, policy });
  assert.equal(r.status, VALIDITY.REJECTED);
  assert.deepEqual(r.reasons.flatMap((x) => x.codes), ['HONEYPOT']);
  const owner = validateAsset({ asset: universe().get('TRAP'), deep: { security: scan({ owner_change_balance: '1' }) }, nowMs: NOW, policy });
  assert.deepEqual(owner.reasons.flatMap((x) => x.codes), ['OWNER_CHANGE_BALANCE']);
});

test('no contract scan yet keeps the project pending; GoPlus\'s exchange list can supply the listing', () => {
  const U = universe();
  const pending = validateAsset({ asset: U.get('GOOD'), deep: {}, nowMs: NOW, policy });
  assert.equal(pending.status, VALIDITY.PENDING);
  assert.deepEqual(pending.missing.flatMap((x) => x.codes), ['NOT_SCANNED']);

  const unlisted = validateAsset({ asset: U.get('NOLIST'), deep: { security: scan() }, nowMs: NOW, policy });
  assert.equal(unlisted.status, VALIDITY.REJECTED);
  assert.ok(unlisted.reasons.flatMap((x) => x.codes).includes('NOT_LISTED'));

  const viaGoplus = validateAsset({ asset: U.get('NOLIST'), deep: { security: scan({ is_in_cex: { listed: '1', cex_list: ['KuCoin'] } }), dex: { liquidityUsd: 90_000 } }, nowMs: NOW, policy });
  assert.equal(viaGoplus.status, VALIDITY.VALID, JSON.stringify(viaGoplus.reasons));
  assert.equal(viaGoplus.listingTier, 2);
});

test('the first pass rejects, before any deep call, only what no contract scan could rescue', () => {
  const U = universe();
  assert.equal(preRejected({ asset: U.get('GOOD'), nowMs: NOW, policy }), null);
  assert.equal(preRejected({ asset: U.get('NOLIST'), nowMs: NOW, policy }), null, 'GoPlus may still show a listing');
  const big = preRejected({ asset: U.get('BIG'), nowMs: NOW, policy });
  assert.ok(big.reasons.some((x) => x.codes.includes('MCAP_ABOVE_CAP')));
  const meme = preRejected({ asset: U.get('MEME'), nowMs: NOW, policy });
  assert.ok(meme.reasons.some((x) => x.codes.includes('ALPHA_ONLY')));
  assert.ok(meme.reasons.some((x) => x.codes.includes('MCAP_UNVERIFIED')));
});

test('the policy is the universe band plus config.validity', () => {
  const p = validityPolicy({ universe: { minMarketCapUsd: 2e6, maxMarketCapUsd: 250e6 }, validity: { maxTaxPct: 8 } });
  assert.equal(p.minMarketCapUsd, 2e6);
  assert.equal(p.maxMarketCapUsd, 250e6);
  assert.equal(p.maxTaxPct, 8);
  assert.equal(p.minSpotVolumeUsd, 10_000, 'defaults fill the rest');
});

test('what the snapshot publishes: verdict views, the report in engine order, one sentence per held row', () => {
  const U = universe();
  const deep = { GOOD: { security: scan(), dex: { liquidityUsd: 250_000 } }, TRAP: { security: scan({ sell_tax: '0.35' }) } };
  const results = new Map([...U.values()].map((a) => [a.key, validateAsset({ asset: a, deep: deep[a.symbol] ?? {}, nowMs: NOW, policy })]));
  const ordered = ['TRAP', 'GOOD', 'BIG', 'NOLIST', 'MEME'].map((s) => U.get(s));
  const report = validityReport({ ordered, results, policy });
  assert.deepEqual({ v: report.summary.valid, p: report.summary.pending, r: report.summary.rejected }, { v: 1, p: 0, r: 4 });
  assert.deepEqual(report.rejected.map((x) => x.symbol), ['TRAP', 'BIG', 'NOLIST', 'MEME'], 'in the engine\'s order');
  assert.deepEqual(report.rejected[0].codes, ['HIGH_TAX']);
  assert.match(report.rejected[0].why, /taxă de 35%/);
  assert.equal(report.checks.length, 7);
  assert.equal(report.policy.maxMarketCapUsd, 300e6);
  assert.equal(validityReport({ ordered, results, policy, limit: 2 }).rejected.length, 2, 'the list is capped, the counts are not');

  const view = validityView(results.get(U.get('GOOD').key));
  assert.equal(view.status, 'VALID');
  assert.equal(view.tier, 2);
  assert.equal(view.checks.length, 7);
  assert.equal(validityWhy(results.get(U.get('GOOD').key)), null);
  assert.match(validityWhy(results.get(U.get('BIG').key)), /peste plafonul/);
});

test('the universe table: verified rows first, a V/P/R column with the reason, every spot market', () => {
  const U = universe();
  const assets = [...U.values()];
  const deep = { GOOD: { security: scan(), dex: { liquidityUsd: 250_000 } } };
  const validity = new Map(assets.map((a) => [a.key, validateAsset({ asset: a, deep: deep[a.symbol] ?? {}, nowMs: NOW, policy })]));
  const doc = universeTable({
    eligible: assets, researched: [], ranked: [], futuresRows: [],
    published: { discovery: new Map(), futures: new Set() },
    selectedBy: () => null, validity,
    meta: { generatedAt: new Date(NOW).toISOString(), runId: 'r1', mode: 'fixture' },
  });
  const col = (f) => ASSET_FIELDS.indexOf(f);
  const rows = doc.assets.rows;
  assert.equal(rows[0][col('symbol')], 'GOOD', 'the verified project leads');
  assert.equal(rows[0][col('valid')], VALIDITY_CODE.VALID);
  assert.equal(rows[0][col('validWhy')], null);
  assert.equal(rows[0][col('spot')], SPOT_CODE.gate);
  const trap = rows.find((r) => r[col('symbol')] === 'TRAP');
  assert.equal(trap[col('valid')], 'P', 'not scanned yet: pending, not rejected');
  assert.equal(trap[col('spot')], 'M');
  const big = rows.find((r) => r[col('symbol')] === 'BIG');
  assert.equal(big[col('valid')], 'R');
  assert.match(big[col('validWhy')], /peste plafonul/);
  const order = rows.map((r) => r[col('valid')]);
  assert.deepEqual(order, [...order].sort((a, b) => 'VPR'.indexOf(a) - 'VPR'.indexOf(b)), 'V, then P, then R');
});

test('the shipped configuration caps the universe at $300M; the gate thresholds are validated at load', async () => {
  const { config } = await loadConfig({ root: ROOT, env: {} });
  assert.equal(config.universe.maxMarketCapUsd, 300e6, 'small and mid caps: under $300M');
  assert.equal(validityPolicy(config).maxMarketCapUsd, 300e6, 'the gate uses the same cap');
  assert.equal(config.validity.acceptGateAlphaOnly, false);
  const dir = await mkdtemp(join(tmpdir(), 'cri-cfg-'));
  try {
    await mkdir(join(dir, 'config'));
    await writeFile(join(dir, 'config', 'default.json'), JSON.stringify({ ...config, validity: { ...config.validity, maxTaxPct: 150, minDexLiquidityUsd: -1 } }));
    await assert.rejects(loadConfig({ root: dir, env: {} }), /validity\.maxTaxPct[\s\S]*validity\.minDexLiquidityUsd/);
    await writeFile(join(dir, 'config', 'default.json'), JSON.stringify({ ...config, deep: { ...config.deep, refreshHours: { security: 500 } } }));
    await assert.rejects(loadConfig({ root: dir, env: {} }), /deep\.refreshHours\.security/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
