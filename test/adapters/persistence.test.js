import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsStateRepository, decodeHistory, encodeHistory } from '../../src/adapters/outbound/state/fs-state-repository.js';
import { validateSchema } from '../../src/adapters/outbound/publishing/schema-validator.js';
import { createFsSnapshotPublisher } from '../../src/adapters/outbound/publishing/fs-snapshot-publisher.js';
import { ROOT } from '../fixture-run.js';

test('history codec round-trips points (stages and signals as one-letter codes)', () => {
  const history = {
    'cg:lab': { lastSeen: '2026-10-17T09:00:00.000Z', points: [
      { t: '2026-10-16T09:00:00.000Z', price: 0.12, mcap: 2e7, turnover: 0.1, rank: 400, oiUsd: 1e6, funding: -0.0002, cri: 61.2, stage: 'PRE_EXPANSION', signal: 'WATCH', holders: 9000, watchlist: 1200, cgTrending: false, walletNet: 0.31 },
      { t: '2026-10-17T09:00:00.000Z', price: 0.13, mcap: 2.1e7, turnover: null, rank: 390, oiUsd: null, funding: null, cri: 66.1, stage: 'ACCELERATION', signal: 'BUY_SETUP', holders: null, watchlist: null, cgTrending: true, walletNet: null },
    ] },
  };
  const enc = encodeHistory(history);
  assert.equal(enc.assets['cg:lab'].p[0][8], 'P');
  assert.equal(enc.assets['cg:lab'].p[1][9], 'S');
  assert.deepEqual(decodeHistory(JSON.parse(JSON.stringify(enc))), history);
  assert.deepEqual(decodeHistory(history), history, 'legacy object format passes through');
  const older = { fields: enc.fields.slice(0, -1), assets: { k: { l: 1, p: [enc.assets['cg:lab'].p[0].slice(0, -1)] } } };
  assert.equal(decodeHistory(older).k.points[0].walletNet, undefined, 'states written before a field existed still decode');
});

test('state repository: atomic save/load, corrupt files fall back per file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cri-state-'));
  try {
    const repo = createFsStateRepository({ dir });
    const empty = await repo.load();
    assert.deepEqual(empty.journal, { entries: [] });
    empty.meta.runs = 3;
    empty.history = { k: { lastSeen: '2026-10-17T09:00:00.000Z', points: [] } };
    await repo.save(empty);
    await writeFile(join(dir, 'journal.json'), '{broken');
    const again = await repo.load();
    assert.equal(again.meta.runs, 3);
    assert.deepEqual(again.journal, { entries: [] }, 'a corrupt file resets only itself');
    assert.ok(again.history.k);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('schema validator reports path-qualified errors', () => {
  const schema = { type: 'object', required: ['a'], properties: { a: { type: 'array', items: { enum: ['X', 'Y'] } }, b: { type: 'number', minimum: 0 } } };
  assert.deepEqual(validateSchema({ a: ['X'] }, schema), []);
  const errs = validateSchema({ a: ['Z'], b: -1 }, schema);
  assert.equal(errs.length, 2);
  assert.ok(errs.some((e) => e.includes('$.a[0]')));
  assert.ok(errs.some((e) => e.includes('$.b')));
  assert.ok(validateSchema({}, schema).some((e) => e.includes('a')), 'missing required key');
});

test('publisher refuses to overwrite latest.json with an invalid snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cri-pub-'));
  try {
    const pub = createFsSnapshotPublisher({ outDir: dir, schemaPath: join(ROOT, 'schema', 'latest.schema.json') });
    await assert.rejects(() => pub.publish({ schemaVersion: '3.0.0', meta: {} }, { runId: 'x' }));
    await assert.rejects(() => readFile(join(dir, 'latest.json')), 'nothing written');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
