#!/usr/bin/env node
/**
 * Composition root — the only file that knows every concrete adapter. Wires:
 *   SnapshotPort  ← File/HttpSnapshotRepository   (the scanner's published contract)
 *   runners       ← same adapters on data/runners.json (Python runners module)
 *   AnalystPort   ← PythonBridge                   (services/analyst-python, http or spawn)
 *   CachePort     ← MemoryCache
 *   ClockPort     ← system clock
 * and hands the use-cases to the Express inbound adapter.
 */
import { createApp } from './app.js';
import { createUseCases } from './application/use-cases.js';
import { loadConfig } from './config.js';
import { MemoryCache } from './services/MemoryCache.js';
import { PythonBridge } from './services/PythonBridge.js';
import { createRunnersRepository, createSnapshotRepository } from './services/SnapshotRepository.js';

const config = loadConfig();
const useCases = createUseCases({
  snapshots: createSnapshotRepository({ source: config.snapshotSource, ttlMs: config.snapshotTtlMs }),
  analyst: new PythonBridge(config.analyst),
  cache: new MemoryCache({ max: 1000, ttlMs: 15 * 60_000 }),
  clock: { now: () => Date.now() },
  runners: createRunnersRepository({ snapshotSource: config.snapshotSource, ttlMs: config.snapshotTtlMs }),
});

const app = createApp({ useCases, config });
const server = app.listen(config.port, config.host, () => {
  console.log(`radarcry api-node v${config.version} pe http://${config.host}:${config.port}`);
  console.log(`  snapshot: ${config.snapshotSource}`);
  console.log(`  analist:  ${config.analyst.mode === 'http' ? config.analyst.baseUrl : `spawn ${config.analyst.python} ${config.analyst.cliPath}`}`);
  if (config.frontendDir) console.log(`  dashboard: http://localhost:${config.port}/`);
});

const shutdown = (sig) => {
  console.log(`${sig}: închid serverul`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
