import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowPersistence } from '../../src/application/use-cases/research.js';

test('accumulation persistence needs two observations and counts positive wallet flows', () => {
  assert.equal(flowPersistence(0.3, []), null, 'a single observation is not persistence');
  assert.deepEqual(flowPersistence(0.3, [{ walletNet: 0.2 }, { walletNet: -0.1 }, { walletNet: null }]), { positive: 2, total: 3, share: 0.667 });
  assert.equal(flowPersistence(null, [{ walletNet: 0.2 }, { walletNet: 0.4 }]).total, 2);
  const long = Array.from({ length: 12 }, () => ({ walletNet: 0.5 }));
  assert.equal(flowPersistence(0.5, long).total, 6, 'looks at the six most recent observations');
});

test('the prescreen measures a market-level change against the project\'s own norm, with no call', async () => {
  const { prescreenAsset } = await import('../../src/application/use-cases/discovery.js');
  const NOW = Date.parse('2026-10-24T21:00:00Z');
  const H = 3_600_000;
  const config = { discovery: { baselineWindowDays: 30, baselineMinPoints: 4, changeWindowDays: 7 } };
  const asset = {
    key: 'cg:quiet', symbol: 'QT',
    market: { price: 1, marketCap: 50e6, volume24h: 9e6, circulating: 50e6, change: { h24: 3, d7: 6, d30: 9 } },
    derived: { turnover: 0.18 },
    venues: { perps: [] },
    catalysts: [],
  };
  // Six earlier runs with a steady ~1.5M volume: today's 9M is a change for *this* project.
  const steady = [0, 1, 2, 3, 4, 5].map((i) => ({
    at: NOW - (i + 1) * 4 * H,
    metrics: { price: 1, marketCap: 50e6, volume24h: 1.4e6 + i * 0.05e6, turnover: 0.028 + i * 0.001, circulating: 50e6 },
  })).reverse();

  const fresh = prescreenAsset({ asset, points: [], config, nowMs: NOW });
  assert.equal(fresh.baselineSufficient, false);
  assert.equal(fresh.score, 0, 'with no history nothing can be measured against a norm');
  assert.equal(fresh.current.volume24h, 9e6, 'the market-level point is still recorded for next time');

  const r = prescreenAsset({ asset, points: steady, config, nowMs: NOW });
  assert.equal(r.baselineSufficient, true);
  const keys = r.changed.changes.map((c) => c.key);
  assert.ok(keys.includes('VOLUME_EXPANSION'), keys.join(', '));
  assert.ok(r.score > 0);
  // Deep facts are absent and stay absent: unmeasured, never zero.
  assert.equal(r.current.holders, null);
  assert.equal(r.current.liquidityUsd, null);
});

test('provider health tells the HTTP truth: partial coverage is PARTIAL, a missing key is named', async () => {
  const { buildProviderHealth } = await import('../../src/application/use-cases/snapshot.js');
  // The first live run, verbatim: the use case saw 3 of 4 chain batches succeed, while 21 of the
  // 43 underlying per-token calls had failed.
  const results = { goplus: { status: 'OK', message: '3/4 apeluri reușite' }, coingecko: { status: 'OK', message: '' } };
  const telemetry = {
    goplus: { calls: 43, ok: 22, failures: 21, statuses: { OK: 22, RATE_LIMITED: 18, TIMEOUT: 3 }, lastMessage: '/token_security/{chain}: TIMEOUT' },
    coingecko: { calls: 41, ok: 41, failures: 0, statuses: { OK: 41 }, lastMessage: null },
  };
  const rows = buildProviderHealth(results, telemetry, {}, { github: true });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));

  assert.equal(by.goplus.status, 'PARTIAL');
  assert.match(by.goplus.message, /^22\/43 apeluri reușite · RATE_LIMITED ×18 · TIMEOUT ×3/);
  assert.deepEqual(by.goplus.statuses, telemetry.goplus.statuses);
  assert.equal(by.coingecko.status, 'OK', 'a clean provider stays OK');

  // Arkham was never called because no key was configured: say which key, not "SKIPPED".
  assert.equal(by.arkham.status, 'NOT_CONFIGURED');
  assert.match(by.arkham.message, /ARKHAM_API_KEY/);
  assert.equal(by.cryptoquant.status, 'NOT_CONFIGURED');
  assert.match(by.cryptoquant.message, /CRYPTOQUANT_API_KEY/);
});
