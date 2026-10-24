/**
 * The 15-minute pulse: it must refresh exactly the facts that move that fast, leave everything else
 * alone, and say which is which. A pulse that quietly recomputed a score from stale inputs would be
 * worse than no pulse at all, because the dashboard would imply the whole page was just rebuilt.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { runFixtureDays } from '../fixture-run.js';
import { NoSnapshotError, runPulse } from '../../src/application/use-cases/pulse.js';
import { createFixtureProviders } from '../../src/adapters/outbound/fixtures/fixture-providers.js';
import { createDemoMarket } from '../../src/adapters/outbound/fixtures/demo-market.js';
import { fixedClock, createTelemetry, silentLogger } from '../../src/adapters/outbound/system/system.js';

let run;
let full;
before(async () => {
  run = await runFixtureDays({ days: 3 });
  full = run.snapshots.at(-1);
});
after(async () => run?.cleanup());

/** A publisher that captures instead of writing, so the test sees exactly what would ship. */
function capture() {
  const out = {};
  return {
    out,
    publish: async (snapshot) => {
      out.snapshot = snapshot;
      return { path: 'memory', bytes: JSON.stringify(snapshot).length };
    },
  };
}

function pulseDeps({ snapshot, atMs }) {
  const clock = fixedClock(atMs);
  const market = createDemoMarket({ endMs: atMs });
  return {
    clock,
    logger: silentLogger,
    telemetry: createTelemetry(),
    providers: createFixtureProviders({ market, clock }),
    publisher: capture(),
    reader: async () => (snapshot ? JSON.parse(JSON.stringify(snapshot)) : null),
  };
}

test('a pulse without a published snapshot refuses instead of inventing one', async () => {
  const deps = pulseDeps({ snapshot: null, atMs: Date.parse('2026-06-01T00:00:00Z') });
  await assert.rejects(() => runPulse(deps, run.config), NoSnapshotError);
});

test('a pulse refreshes price, funding and open interest — and nothing else', async () => {
  const atMs = Date.parse(full.meta.generatedAt) + 15 * 60_000;
  const deps = pulseDeps({ snapshot: full, atMs });
  const res = await runPulse(deps, run.config);
  const next = deps.publisher.out.snapshot;

  assert.ok(res.summary.updated > 0, 'something was refreshed');
  assert.equal(next.meta.pulsedAt, new Date(atMs).toISOString());
  assert.equal(next.meta.generatedAt, full.meta.generatedAt, 'the full-scan timestamp is preserved');
  assert.equal(next.meta.runId, full.meta.runId, 'a pulse is not a new run');
  assert.equal(next.meta.pulse.fullScanAt, full.meta.generatedAt);
  assert.ok(next.meta.pulse.refreshed.includes('funding'));
  assert.ok(next.meta.pulse.keptFromFullScan.includes('scoruri'));

  // The scores, the change list and the risk are *not* recomputed: they depend on holder lists,
  // baselines and candles that a pulse never re-reads.
  for (const [i, row] of (next.discovery?.rows ?? []).entries()) {
    const before = full.discovery.rows[i];
    assert.equal(row.key, before.key);
    assert.deepEqual(row.score, before.score, `${row.symbol}: the score must not move on a pulse`);
    assert.deepEqual(row.changed, before.changed, `${row.symbol}: what changed must not move on a pulse`);
    assert.deepEqual(row.risk, before.risk, `${row.symbol}: the risk must not move on a pulse`);
    assert.deepEqual(row.verdict, before.verdict, `${row.symbol}: the verdict must not move on a pulse`);
    assert.deepEqual(row.onchain.holderTable, before.onchain.holderTable, `${row.symbol}: holders are not re-read`);
  }
});

test('the futures positioning block and grade are recomputed from the fresh derivatives', async () => {
  const atMs = Date.parse(full.meta.generatedAt) + 15 * 60_000;
  const deps = pulseDeps({ snapshot: full, atMs });
  await runPulse(deps, run.config);
  const next = deps.publisher.out.snapshot;

  const rows = next.futures?.rows ?? [];
  assert.ok(rows.length > 0, 'the demo snapshot carries a futures watchlist');
  const pulsed = rows.filter((r) => r.pulsedAt);
  assert.ok(pulsed.length > 0, 'at least one instrument was refreshed');
  for (const r of pulsed) {
    assert.equal(r.pulsedAt, new Date(atMs).toISOString());
    assert.ok(Number.isFinite(r.positioning.score), `${r.symbol} re-scored its positioning`);
    assert.ok(['A++', 'A+', 'A', 'B', 'NO_TRADE'].includes(r.grade.grade));
    // The structural blocks keep their values: candles were not re-read.
    const before = full.futures.rows.find((x) => x.key === r.key);
    assert.deepEqual(r.trend, before.trend, `${r.symbol}: the daily trend is not re-read on a pulse`);
    assert.deepEqual(r.setup, before.setup, `${r.symbol}: the 4H structure is not re-read on a pulse`);
  }
});

test('a pulse publishes a document that still satisfies the contract', async () => {
  const atMs = Date.parse(full.meta.generatedAt) + 15 * 60_000;
  const deps = pulseDeps({ snapshot: full, atMs });
  await runPulse(deps, run.config);
  const next = deps.publisher.out.snapshot;
  // Spot-check the invariants the schema enforces, so a pulse can never ship a broken contract.
  assert.equal(next.schemaVersion, full.schemaVersion);
  assert.equal(next.meta.scope.researchOnly, true);
  assert.equal(next.meta.policy.freeOnly, true);
  assert.ok(Array.isArray(next.candidates) && next.candidates.length === full.candidates.length);
  assert.ok(next.parity && next.methodology && next.health);
});
