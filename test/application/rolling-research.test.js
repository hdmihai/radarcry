/**
 * The rolling research layer — how a few dozen free-plan calls per run reach the whole top 1000
 * without corrupting anyone's history.
 *
 * Static facts (contract flags, categories, repository) are carried between runs with the time
 * they were read. Measurements (holder counts, the raw top-10 share, commits, mentions) are never
 * carried: a project not refreshed this run reports them as unmeasured, because writing yesterday's
 * reading into today's point would flatten the project's norm and manufacture changes against it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheCoverage, cachedFact, pruneCache, rotationOrder, staticDetail, staticSecurity, storeFact } from '../../src/application/use-cases/deep-cache.js';
import { collectDeepData } from '../../src/application/use-cases/deep-research.js';
import { onchainFacts } from '../../src/application/use-cases/discovery.js';
import { emptyLabelIndex } from '../../src/domain/onchain/labels.js';
import { ROOT } from '../fixture-run.js';

const config = JSON.parse(readFileSync(join(ROOT, 'config', 'default.json'), 'utf8'));
const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const rt = { timeLeft: () => 600_000, logger: quiet };
const NOW = Date.parse('2026-10-25T12:00:00Z');
const H = 3_600_000;

const goplusPayload = (holders) => ({
  holders, top10Pct: 41, top10EffectivePct: 30,
  topHolders: [{ address: '0xaaa', share: 12, balance: 1, tag: null, locked: false, isContract: false }],
  creatorAddress: '0xc0', ownerAddress: null, lpLockedPct: 95,
  security: { honeypot: false, cannotSell: false, buyTax: 0, sellTax: 0.01, mintable: false, ownerRenounced: true, hiddenOwner: false, canTakeBackOwnership: false, transferPausable: false, proxy: false, openSource: true },
});

test('only the static part of a fact is ever carried', () => {
  const sec = staticSecurity(goplusPayload(5000));
  assert.equal(sec.holders, undefined, 'the holder count is a measurement');
  assert.equal(sec.top10Pct, undefined, 'so is the raw top-10 share');
  assert.equal(sec.security.sellTax, 0.01);
  assert.equal(sec.lpLockedPct, 95);
  assert.equal(sec.topHolders.length, 1, 'who the large holders are stays, for the concentration risk');
  const det = staticDetail({ id: 'x', categories: ['AI'], github: 'https://github.com/a/b', watchlistUsers: 9000, commits4w: 30, stars: 5 });
  assert.deepEqual(Object.keys(det).sort(), ['categories', 'description', 'genesisDate', 'github', 'homepage', 'id', 'telegram', 'twitter']);
  assert.equal(staticSecurity({ holders: 3 }), null, 'a payload without security flags is not a security fact');
});

test('a carried fact expires with its TTL and never comes from a clock ahead of ours', () => {
  const cache = {};
  storeFact(cache, 'k', 'security', goplusPayload(1), NOW - 100 * H);
  assert.ok(cachedFact(cache, 'k', 'security', { nowMs: NOW }), '100 h is inside the 7-day TTL');
  assert.equal(cachedFact(cache, 'k', 'security', { nowMs: NOW + 80 * H }), null, '180 h is not');
  assert.equal(cachedFact(cache, 'k', 'security', { nowMs: NOW - 200 * H }), null, 'a fact from the future is no fact');
  assert.equal(cachedFact(cache, 'k', 'detail', { nowMs: NOW }), null);
});

test('the rotation serves the research priority first, then whatever was measured longest ago', () => {
  const list = ['p1', 'p2', 'a', 'b', 'c', 'd'].map((key) => ({ key }));
  const last = { p1: NOW - 1 * H, p2: null, a: NOW - 5 * H, b: null, c: NOW - 50 * H, d: NOW - 2 * H };
  const order = rotationOrder(list, { priority: new Set(['p1', 'p2']), last: (x) => last[x.key], nowMs: NOW }).map((x) => x.key);
  // p1 was measured an hour ago (a re-run): it does not take a slot the universe needs.
  assert.deepEqual(order, ['p2', 'b', 'c', 'a']);
});

test('a carried security scan feeds the risk read, never the holder count', () => {
  const asset = { key: 'k', primary: { chain: 'bsc', address: '0xabc' }, venues: {} };
  const fresh = onchainFacts({ asset, deep: { security: goplusPayload(5000) }, labelIndex: emptyLabelIndex(), flowHistory: [], nowMs: NOW });
  assert.equal(fresh.holders, 5000);
  assert.equal(fresh.holdersSource, 'goplus');
  assert.equal(fresh.top10Pct, 41);

  const carried = { ...staticSecurity(goplusPayload(5000)), asOf: NOW - 30 * H, carried: true };
  const later = onchainFacts({ asset, deep: { security: carried }, labelIndex: emptyLabelIndex(), flowHistory: [], nowMs: NOW });
  assert.equal(later.holders, null, 'not measured this run: unknown, not the old number');
  assert.equal(later.top10Pct, null);
  assert.equal(later.security.sellTaxPct, 1, 'the contract facts are still there');
  assert.equal(later.security.carried, true);
  assert.equal(later.security.asOf, new Date(NOW - 30 * H).toISOString());
  assert.ok(Number.isFinite(later.top10ActorsPct) || later.concentrationBasis !== null, 'the concentration risk still has its basis');
});

test('deep research covers the whole horizon: bulk facts for all, budgeted slices by rotation', async () => {
  const n = 12;
  const assets = Array.from({ length: n }, (_, i) => ({
    key: `k${i}`, symbol: `T${i}`, name: `T${i}`, ids: { coingecko: `t${i}` }, links: {}, market: {},
    venues: { mexcSpot: { symbol: `T${i}USDT` } },
    primary: { chain: 'bsc', address: `0x${String(i).padStart(40, '0')}` },
  }));
  const calls = { goplus: [], detail: [], gt: [], klines: 0, dex: 0 };
  const okR = (data) => ({ ok: true, status: 'OK', data, message: '', meta: { provider: 'x', endpoint: 'x', units: 1 } });
  const P = {
    mexc: { klines: async () => { calls.klines += 1; return okR(Array.from({ length: 60 }, (_, j) => ({ t: j, o: 1, h: 1, l: 1, c: 1, v: 1 }))); } },
    dexscreener: { tokens: async (chain, addrs) => { calls.dex += 1; return okR(Object.fromEntries(addrs.map((a) => [a, { liquidityUsd: 1000 }]))); } },
    goplus: { security: async (chain, addrs) => { calls.goplus.push(...addrs); return okR(Object.fromEntries(addrs.map((a) => [a, goplusPayload(100)]))); } },
    geckoterminal: { tokenInfo: async (chain, address) => { calls.gt.push(address); return okR({ holders: 50, top10Pct: 20 }); } },
    coingecko: { detail: async (id) => { calls.detail.push(id); return okR({ id, categories: ['AI'], watchlistUsers: 10 }); }, marketChart: async () => okR([]) },
  };
  const cfg = { ...config.deep, securityLimit: 4, coinDetailLimit: 3, holdersInfoLimit: 5, githubLimit: 0, youtubeLimit: 0, cgChartFallback: 0 };
  const priority = new Set(['k0', 'k1']);
  const cache = {};

  const first = await collectDeepData(assets, P, cfg, rt, { priorityKeys: priority, cache, nowMs: NOW });
  assert.equal(calls.klines, 2 * n, 'candles for every project, every run');
  assert.equal(calls.dex, 1, 'DEX liquidity in one batch');
  assert.equal(calls.goplus.length, 4, 'security within its per-run budget');
  assert.ok(calls.goplus.includes(assets[0].primary.address) && calls.goplus.includes(assets[1].primary.address), 'priority first');
  assert.equal(calls.gt.length, 5);
  assert.equal(first.tiers.security.fresh, 4);
  assert.equal(first.tiers.security.carried, 0);

  // Next run, six hours later: the four scanned contracts are carried, four new ones are read.
  calls.goplus = [];
  calls.gt = [];
  calls.detail = [];
  const second = await collectDeepData(assets, P, cfg, rt, { priorityKeys: priority, cache, nowMs: NOW + 6 * H });
  assert.equal(second.tiers.security.carried, 4);
  assert.equal(calls.goplus.length, 4);
  assert.ok(!calls.goplus.includes(assets[0].primary.address), 'a valid scan is not repeated');
  assert.equal(second.byKey.get('k0').security.carried, true);
  assert.equal(second.byKey.get('k0').security.holders, undefined, 'carried without its measurements');
  assert.equal(second.byKey.get('k0').detail.watchlistUsers, undefined);
  // Measurements rotate: the priority again (measured 6 h ago), then those never measured.
  assert.equal(calls.gt.length, 5);
  assert.ok(calls.gt.includes(assets[0].primary.address));
  const neverBefore = calls.gt.filter((a) => !['k0', 'k1', 'k2', 'k3', 'k4'].map((k) => assets[Number(k.slice(1))].primary.address).includes(a));
  assert.equal(neverBefore.length, 3, 'the rest of the slice goes to projects never measured');
  const notMeasured = assets.filter((a) => !calls.gt.includes(a.primary.address));
  for (const a of notMeasured) assert.equal(second.byKey.get(a.key).holdersInfo, undefined, `${a.key}: not refreshed → no holder reading this run`);

  const cov = cacheCoverage(cache, assets.map((a) => a.key), { nowMs: NOW + 6 * H });
  assert.equal(cov.security, 8);
  assert.equal(cov.projects, n);
});

test('the cache stays bounded by the universe', () => {
  const cache = {};
  storeFact(cache, 'gone', 'security', goplusPayload(1), NOW - 30 * 86_400_000);
  storeFact(cache, 'recent', 'security', goplusPayload(1), NOW - 2 * 86_400_000);
  storeFact(cache, 'kept', 'security', goplusPayload(1), NOW - 40 * 86_400_000);
  const pruned = pruneCache(cache, { keepKeys: new Set(['kept']), nowMs: NOW });
  assert.deepEqual(Object.keys(pruned).sort(), ['kept', 'recent']);
});
