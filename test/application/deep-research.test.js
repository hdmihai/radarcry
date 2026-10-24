/**
 * Deep research collection — the two ordering bugs found in the first live run.
 *
 *  1. Development activity was collected in parallel with the coin details it depends on, so it
 *     never found a repository and made zero GitHub calls.
 *  2. Adapters reported "this chain is not covered" as NOT_CONFIGURED, which the collectors treat
 *     as "switch this provider off for the rest of the run": one SUI token early in the list was
 *     enough to stop security scans for every BSC token after it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectDeepData } from '../../src/application/use-cases/deep-research.js';
import { createFixtureProviders } from '../../src/adapters/outbound/fixtures/fixture-providers.js';
import { createDemoMarket } from '../../src/adapters/outbound/fixtures/demo-market.js';
import { createGoPlus, createGeckoTerminal, createDexScreener } from '../../src/adapters/outbound/providers/onchain.js';
import { createNodeReal } from '../../src/adapters/outbound/providers/holders.js';
import { unsupported } from '../../src/adapters/outbound/providers/common.js';
import { ROOT } from '../fixture-run.js';

const config = JSON.parse(readFileSync(join(ROOT, 'config', 'default.json'), 'utf8'));
const quietLogger = { info() {}, warn() {}, debug() {}, error() {} };
const rt = { timeLeft: () => 600_000, logger: quietLogger };

test('development activity is collected after the coin details that carry the repository link', async () => {
  const endMs = Date.parse('2026-06-15T00:00:00Z');
  const market = createDemoMarket({ endMs, days: 60, size: 60 });
  const P = createFixtureProviders({ market, clock: { now: () => endMs } });
  const withDev = market.assets.filter((a) => Number.isFinite(a.devCommits)).slice(0, 8);
  assert.ok(withDev.length >= 3, 'the demo market must contain projects with a repository');
  const shortlist = withDev.map((a) => ({
    key: `cg:${a.id}`, symbol: a.symbol, name: a.name, ids: { coingecko: a.id }, venues: {}, links: {}, market: {},
    primary: null, // no on-chain address: isolates the CoinGecko → GitHub dependency
  }));

  const { byKey, usage } = await collectDeepData(shortlist, P, config.deep, rt);
  assert.ok((usage.github?.calls ?? 0) > 0, 'GitHub must be called once coin details have arrived');
  const measured = shortlist.filter((a) => Number.isFinite(byKey.get(a.key)?.dev?.activity?.commits30d));
  assert.ok(measured.length >= 3, `commit activity measured for ${measured.length} of ${shortlist.length}`);
});

test('a chain one provider does not cover never switches that provider off for the others', async () => {
  const calls = { security: [], holders: [] };
  const okResult = (data) => ({ ok: true, status: 'OK', data, message: '', meta: { provider: 'x', endpoint: 'x' } });
  const P = {
    goplus: {
      security: async (chain, addresses) => {
        calls.security.push(chain);
        if (chain === 'sui') return unsupported('goplus', '/token_security', 'lanț nesuportat: sui');
        return okResult(Object.fromEntries(addresses.map((a) => [a, { holders: 100, security: { honeypot: false } }])));
      },
    },
    geckoterminal: {
      tokenInfo: async (chain, address) => {
        calls.holders.push(chain);
        if (chain === 'sui') return unsupported('geckoterminal', '/tokens/{address}/info', 'lanț nesuportat: sui');
        return okResult({ holders: 500, top10Pct: 30, address });
      },
    },
  };
  const asset = (i, chain) => ({ key: `k${i}`, symbol: `T${i}`, ids: {}, venues: {}, links: {}, market: {}, primary: { chain, address: `0x${String(i).padStart(40, '0')}` } });
  // The unsupported chain comes first, which is exactly the order that used to stop the loops.
  const shortlist = [asset(1, 'sui'), asset(2, 'bsc'), asset(3, 'bsc'), asset(4, 'base')];

  const { byKey } = await collectDeepData(shortlist, P, config.deep, rt);
  assert.deepEqual([...new Set(calls.security)].sort(), ['base', 'bsc', 'sui']);
  for (const k of ['k2', 'k3', 'k4']) {
    assert.ok(byKey.get(k).security, `${k}: security must still be collected after the SUI token`);
    assert.ok(byKey.get(k).holdersInfo, `${k}: holder info must still be collected after the SUI token`);
  }
});

test('adapters report an unsupported chain as SKIPPED for that input, never as NOT_CONFIGURED', async () => {
  const http = { getJson: async () => { throw new Error('no network call expected'); }, postJson: async () => { throw new Error('no network call expected'); } };
  const cfg = { enabled: true, timeoutMs: 1000, retries: 0, minIntervalMs: 0, maxCalls: 5 };

  const goplus = await createGoPlus({ http, cfg }).security('sui', ['0xabc']);
  assert.equal(goplus.status, 'SKIPPED');
  const gt = await createGeckoTerminal({ http, cfg }).tokenInfo('nochain', '0xabc');
  assert.equal(gt.status, 'SKIPPED');
  const ds = await createDexScreener({ http, cfg }).tokens('nochain', ['0xabc']);
  assert.equal(ds.status, 'SKIPPED');
  const nr = await createNodeReal({ http, cfg, apiKey: 'free-key' }).tokenHolders('nochain', '0xabc');
  assert.equal(nr.status, 'SKIPPED');

  // A missing key, on the other hand, is a run-wide fact and stays NOT_CONFIGURED.
  const noKey = await createNodeReal({ http, cfg, apiKey: null }).tokenHolders('bsc', '0xabc');
  assert.equal(noKey.status, 'NOT_CONFIGURED');
});
