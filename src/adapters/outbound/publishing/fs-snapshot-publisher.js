/**
 * Snapshot publisher (outbound adapter for SnapshotPublisherPort): validates the public
 * contract against schema/latest.schema.json and writes data/latest.json atomically, plus the
 * horizon table data/universe.json (validated against schema/universe.schema.json) when given.
 * An invalid snapshot is never published — the last good file stays in place.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { validateSchema } from './schema-validator.js';

export function createFsSnapshotPublisher({ outDir, schemaPath, universeSchemaPath = null, logger = null }) {
  const cache = new Map();
  async function schema(path) {
    if (!cache.has(path)) cache.set(path, JSON.parse(await readFile(path, 'utf8')));
    return cache.get(path);
  }
  async function writeAtomic(path, body) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, path);
  }
  const check = (label, errors) => {
    if (!errors.length) return;
    const msg = `${label} invalid (${errors.length} erori): ${errors.slice(0, 5).join(' | ')}`;
    logger?.error?.(msg);
    throw new Error(msg);
  };
  return {
    async publish(snapshot, { universe = null } = {}) {
      check('snapshot', validateSchema(snapshot, await schema(schemaPath)));
      const uPath = universeSchemaPath ?? join(dirname(schemaPath), 'universe.schema.json');
      if (universe) check('universe', validateSchema(universe, await schema(uPath)));
      // The table first, then the contract that points to it: a reader never finds a latest.json
      // whose universe file belongs to an older run.
      let universeOut = null;
      if (universe) {
        const uBody = JSON.stringify(universe);
        await writeAtomic(join(outDir, 'universe.json'), uBody);
        universeOut = { path: join(outDir, 'universe.json'), bytes: uBody.length };
      }
      const path = join(outDir, 'latest.json');
      const body = JSON.stringify(snapshot);
      await writeAtomic(path, body);
      const summary = {
        schemaVersion: snapshot.schemaVersion,
        generatedAt: snapshot.meta.generatedAt,
        mode: snapshot.meta.mode,
        overall: snapshot.health.overall,
        universe: snapshot.health.universe,
        signals: snapshot.stats.signals,
        top: snapshot.candidates.slice(0, 10).map((c) => ({ symbol: c.symbol, cri: c.score.cri, signal: c.signal.type, stage: c.stage })),
      };
      await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
      return { path, bytes: body.length, universe: universeOut };
    },
  };
}
