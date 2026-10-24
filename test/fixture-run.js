/** Runs the real application core against the deterministic DEMO market (no network). */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/load-config.js';
import { createDemoMarket } from '../src/adapters/outbound/fixtures/demo-market.js';
import { createFixtureProviders } from '../src/adapters/outbound/fixtures/fixture-providers.js';
import { createFsStateRepository } from '../src/adapters/outbound/state/fs-state-repository.js';
import { createFsSnapshotPublisher } from '../src/adapters/outbound/publishing/fs-snapshot-publisher.js';
import { createTelemetry, fixedClock, silentLogger } from '../src/adapters/outbound/system/system.js';
import { runScan } from '../src/application/use-cases/run-scan.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const END_MS = Date.parse('2026-10-17T09:00:00Z');

/**
 * @param {{days?:number, endMs?:number, configPatch?:(c:any)=>void}} opts
 * @returns {Promise<{snapshots:any[], dir:string, stateDir:string, outDir:string, config:any, cleanup:()=>Promise<void>}>}
 */
export async function runFixtureDays({ days = 1, endMs = END_MS, configPatch = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cri-test-'));
  const stateDir = join(dir, 'state');
  const outDir = join(dir, 'out');
  const { config, references, catalysts } = await loadConfig({ root: ROOT, env: {} });
  configPatch?.(config);
  const market = createDemoMarket({ endMs });
  const stateRepo = createFsStateRepository({ dir: stateDir });
  const publisher = createFsSnapshotPublisher({ outDir, schemaPath: join(ROOT, 'schema', 'latest.schema.json') });
  const snapshots = [];
  for (let d = days - 1; d >= 0; d -= 1) {
    const clock = fixedClock(endMs - d * 86_400_000);
    const providers = createFixtureProviders({ market, clock });
    const r = await runScan({ clock, logger: silentLogger, telemetry: createTelemetry(), providers, stateRepo, publisher, referencesConfig: references, manualCatalysts: catalysts, mode: 'fixture' }, config);
    snapshots.push(r.snapshot);
  }
  return { snapshots, dir, stateDir, outDir, config, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
