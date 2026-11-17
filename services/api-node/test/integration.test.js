/**
 * Real Node ↔ Python integration: the actual PythonBridge (spawn transport) runs the actual
 * services/analyst-python/cli.py over the actual snapshot published by the scanner.
 *
 * Runs when ANALYST_PYTHON points to a Python with requirements installed and data/latest.json
 * exists (CI: after the demo scan). Otherwise it is skipped, so `npm test` works anywhere.
 *   ANALYST_PYTHON=$(which python) npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../src/config.js';
import { createUseCases } from '../src/application/use-cases.js';
import { MemoryCache } from '../src/services/MemoryCache.js';
import { PythonBridge } from '../src/services/PythonBridge.js';
import { FileSnapshotRepository } from '../src/services/SnapshotRepository.js';

const python = process.env.ANALYST_PYTHON;
const snapshotPath = join(REPO_ROOT, 'data', 'latest.json');
const skip = !python ? 'ANALYST_PYTHON nu este setat' : !existsSync(snapshotPath) ? 'data/latest.json lipsește (rulează npm run scan:demo)' : false;

test('scanner snapshot → api-node → PythonBridge(spawn) → analyst-python', { skip, timeout: 120_000 }, async () => {
  const uc = createUseCases({
    snapshots: new FileSnapshotRepository({ path: snapshotPath }),
    analyst: new PythonBridge({ mode: 'spawn', python, cliPath: join(REPO_ROOT, 'services', 'analyst-python', 'cli.py'), cwd: join(REPO_ROOT, 'services', 'analyst-python'), timeoutMs: 60_000 }),
    cache: new MemoryCache(),
    clock: { now: () => Date.now() },
  });

  const h = await uc.health();
  assert.equal(h.status, 'ok', JSON.stringify(h));

  const list = await uc.listRadar({ limit: '200' });
  const target = list.items.find((x) => x.analysable);
  assert.ok(target, 'at least one analysable project in the snapshot');

  const a = await uc.analyzeAsset(target.key);
  assert.equal(a.key, target.key);
  assert.ok(['FAVORABIL', 'NEUTRU', 'NEFAVORABIL'].includes(a.analysis.verdict.band));
  assert.ok(a.analysis.metrics.points >= 20);

  const u = await uc.analyzeUniverse({ limit: '60' });
  assert.ok(u.analysis.assets >= 3);
  const same = u.analysis.ranking.find((r) => r.key === target.key);
  if (same) assert.equal(same.quantScore, a.analysis.verdict.quantScore, 'one scoring function for both endpoints');

  await assert.rejects(uc.analyzeSeries({ closes: [1, 2, 3] }), (e) => e.kind === 'INVALID_INPUT');
  const s = await uc.analyzeSeries({ closes: Array.from({ length: 40 }, (_, i) => 1 + Math.sin(i / 4) * 0.1 + i * 0.01) });
  assert.equal(s.metrics.points, 40);
});
