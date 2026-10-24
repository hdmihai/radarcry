/**
 * Snapshot publisher (outbound adapter for SnapshotPublisherPort): validates the public
 * contract against schema/latest.schema.json and writes data/latest.json atomically.
 * An invalid snapshot is never published — the last good file stays in place.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { validateSchema } from './schema-validator.js';

export function createFsSnapshotPublisher({ outDir, schemaPath, logger = null }) {
  let schemaCache = null;
  async function schema() {
    if (!schemaCache) schemaCache = JSON.parse(await readFile(schemaPath, 'utf8'));
    return schemaCache;
  }
  return {
    async publish(snapshot) {
      const errors = validateSchema(snapshot, await schema());
      if (errors.length) {
        const msg = `snapshot invalid (${errors.length} erori): ${errors.slice(0, 5).join(' | ')}`;
        logger?.error?.(msg);
        throw new Error(msg);
      }
      const path = join(outDir, 'latest.json');
      await mkdir(dirname(path), { recursive: true });
      const body = JSON.stringify(snapshot);
      const tmp = `${path}.tmp-${process.pid}`;
      await writeFile(tmp, body, 'utf8');
      await rename(tmp, path);
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
      return { path, bytes: body.length };
    },
  };
}
