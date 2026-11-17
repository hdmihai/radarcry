import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analystPayload, findCandidate, parseRadarQuery, parseSeriesInput, queryRadar, snapshotMeta } from '../src/domain/radar.js';
import { DomainError } from '../src/domain/errors.js';
import { snapshot } from './helpers.js';

test('parseRadarQuery: defaults, lists, bounds', () => {
  const q = parseRadarQuery({});
  assert.equal(q.sort, 'score');
  assert.equal(q.order, 'desc');
  assert.equal(q.limit, 50);
  const q2 = parseRadarQuery({ stage: 'base, building', chain: 'BSC', limit: '10', minScore: '50', deep: 'true' });
  assert.deepEqual(q2.stage, ['BASE', 'BUILDING']);
  assert.deepEqual(q2.chain, ['bsc']);
  assert.equal(q2.limit, 10);
  assert.equal(q2.minScore, 50);
  assert.equal(q2.deepOnly, true);
  for (const bad of [{ sort: 'magic' }, { order: 'up' }, { limit: '0' }, { limit: '1000' }, { minScore: 'x' }]) {
    assert.throws(() => parseRadarQuery(bad), (e) => e instanceof DomainError && e.kind === 'INVALID_INPUT', JSON.stringify(bad));
  }
});

test('queryRadar: filter, sort, paginate; unknown values sort last', () => {
  const s = snapshot();
  const all = queryRadar(s, parseRadarQuery({ limit: '200' }));
  assert.equal(all.total, 9);
  assert.equal(all.items[0].key, 'cg:coin-7');
  assert.equal(all.items.at(-1).key, 'cg:no-chart', 'null score goes last');
  const asc = queryRadar(s, parseRadarQuery({ order: 'asc', limit: '200' }));
  assert.equal(asc.items.at(-1).key, 'cg:no-chart', 'null score goes last in asc too');
  const bsc = queryRadar(s, parseRadarQuery({ chain: 'bsc', minScore: '50', maxRisk: '30' }));
  assert.ok(bsc.items.every((x) => x.chain === 'bsc' && x.score >= 50 && x.risk.score <= 30));
  const page = queryRadar(s, parseRadarQuery({ limit: '2', offset: '2' }));
  assert.deepEqual(page.items.map((x) => x.key), ['cg:coin-5', 'cg:coin-4']);
  const search = queryRadar(s, parseRadarQuery({ q: 'coin 3' }));
  assert.deepEqual(search.items.map((x) => x.symbol), ['C3']);
});

test('projection never leaks undefined and marks analysable rows', () => {
  const { items } = queryRadar(snapshot(), parseRadarQuery({ limit: '200' }));
  for (const it of items) assert.ok(!JSON.stringify(it).includes('undefined'));
  assert.equal(items.find((x) => x.key === 'cg:no-chart').analysable, false);
  assert.equal(items.find((x) => x.key === 'cg:coin-1').analysable, true);
});

test('findCandidate by key or symbol', () => {
  const s = snapshot();
  assert.equal(findCandidate(s, 'cg:coin-2').symbol, 'C2');
  assert.equal(findCandidate(s, 'c2').key, 'cg:coin-2');
  assert.equal(findCandidate(s, 'nope'), null);
});

test('analystPayload keeps only clean numeric rows of both shapes', () => {
  const c = snapshot().candidates[1];
  c.chart.d1.push([1, null], ['x', 2]);
  c.chart.h4 = [[1, 1, 2, 0.5, 1.5, 10], [2, 1, 2]];
  const p = analystPayload(c);
  assert.equal(p.series.d1.length, 40);
  assert.deepEqual(p.series.h4, [[1, 1, 2, 0.5, 1.5, 10]]);
  assert.deepEqual(p.scoreHistory[0], { at: '2026-11-01T00:00:00.000Z', score: 50, stage: 'BASE', price: 1.1 });
  assert.deepEqual(Object.keys(p).sort(), ['chain', 'contract', 'key', 'market', 'scoreHistory', 'series', 'symbol']);
});

test('parseSeriesInput validates', () => {
  const closes = Array.from({ length: 12 }, (_, i) => 1 + i);
  assert.equal(parseSeriesInput({ closes }).periodsPerYear, 365);
  assert.throws(() => parseSeriesInput({ closes: [1, 2] }));
  assert.throws(() => parseSeriesInput({ closes: [...closes.slice(1), -1] }));
  assert.throws(() => parseSeriesInput({ closes, volumes: [1] }));
});

test('snapshotMeta', () => {
  const m = snapshotMeta(snapshot());
  assert.equal(m.runId, '20261117T170000');
  assert.equal(m.candidates, 9);
  assert.equal(m.health, 'HEALTHY');
});
