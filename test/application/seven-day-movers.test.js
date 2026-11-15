/**
 * Seven-day movers (Faza 5): the filters, the health-weighted ordering and the limit. Inline
 * fixtures shaped like discoverAsset() results — no network, no I/O, no data/latest.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH_BOOST, sevenDayMovers } from '../../src/application/use-cases/seven-day-movers.js';

/** One discoverAsset()-shaped result; every field can be overridden. */
function row(key, o = {}) {
  const marketCap = o.marketCap ?? 50_000_000;
  const volume24h = o.volume24h ?? 5_000_000;
  return {
    asset: {
      key,
      symbol: key.toUpperCase(),
      name: `Token ${key}`,
      primary: { chain: o.chain ?? 'ethereum' },
      market: { marketCap, volume24h, change: { d7: 'change7d' in o ? o.change7d : 20 } },
      derived: { turnover: 'turnover' in o ? o.turnover : volume24h / marketCap },
      features: { daily: { upVolRatio: o.upVolRatio ?? 0.6 } },
    },
    thesis: o.health === undefined ? {} : { isMoveHealthy: o.health ? { verdict: o.health } : null },
  };
}

const validityFrom = (map) => (key) => (map[key] ? { status: map[key] } : undefined);

test('filters: REJECTED, volume, market cap, turnover, upVolRatio and change7d ≤ 0 are excluded', () => {
  const rows = [
    row('ok'),
    row('rejected'),
    row('pending'),
    row('lowvol', { volume24h: 499_999, turnover: 0.2 }),
    row('smallcap', { marketCap: 999_999, volume24h: 600_000 }),
    row('bigcap', { marketCap: 300_000_001, volume24h: 50_000_000 }),
    row('lowturn', { turnover: 0.049 }),
    row('lowup', { upVolRatio: 0.549 }),
    row('flat', { change7d: 0 }),
    row('down', { change7d: -12 }),
    row('nochange', { change7d: null }),
    row('noturn', { turnover: null }),
  ];
  const out = sevenDayMovers(rows, { validityOf: validityFrom({ ok: 'VALID', rejected: 'REJECTED', pending: 'PENDING' }) });
  assert.deepEqual(out.map((x) => x.key).sort(), ['ok', 'pending']);
  // Boundaries are inclusive.
  const edge = sevenDayMovers([row('edge', { volume24h: 500_000, marketCap: 1_000_000, turnover: 0.05, upVolRatio: 0.55 })]);
  assert.equal(edge.length, 1);
});

test('ordering: healthBoost applied, ln(volume24h) separates equal moves, UNKNOWN is not bearish', () => {
  const rows = [
    row('dist', { change7d: 40, health: 'DISTRIBUTION' }),
    row('healthy', { change7d: 40, health: 'HEALTHY' }),
    row('fragile', { change7d: 40, health: 'FRAGILE' }),
    row('unknown', { change7d: 40 }),
    row('nullh', { change7d: 40, health: null }),
  ];
  const out = sevenDayMovers(rows);
  assert.deepEqual(out.map((x) => x.key), ['healthy', 'fragile', 'nullh', 'unknown', 'dist']);
  const h = out[0];
  assert.equal(h.healthBoost, HEALTH_BOOST.HEALTHY);
  assert.equal(h.score, Math.round(40 * Math.log(5_000_000) * 1.3 * 100) / 100);
  assert.equal(out.find((x) => x.key === 'nullh').healthVerdict, 'UNKNOWN');
  assert.ok(out.find((x) => x.key === 'unknown').score > out.find((x) => x.key === 'dist').score);

  // Same move, same health: the deeper market ranks first.
  const vol = sevenDayMovers([row('thin', { volume24h: 1_000_000, marketCap: 10_000_000 }), row('deep', { volume24h: 20_000_000, marketCap: 10_000_000 })]);
  assert.deepEqual(vol.map((x) => x.key), ['deep', 'thin']);
});

test('limit: 50 qualifying in → 30 out by default, ranked 1..30; custom limit and topByChange respected', () => {
  const rows = Array.from({ length: 50 }, (_, i) => row(`t${String(i).padStart(2, '0')}`, { change7d: 10 + i }));
  const out = sevenDayMovers(rows);
  assert.equal(out.length, 30);
  assert.deepEqual(out.map((x) => x.rank), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.equal(out[0].key, 't49');
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].score >= out[i].score);

  assert.equal(sevenDayMovers(rows, { limit: 5 }).length, 5);
  // Only the 10 largest 7-day gains are scored, whatever the limit.
  const pool = sevenDayMovers(rows, { topByChange: 10 });
  assert.equal(pool.length, 10);
  assert.ok(pool.every((x) => x.change7d >= 50));
  assert.deepEqual(sevenDayMovers([]), []);
  assert.deepEqual(sevenDayMovers(undefined), []);
});

test('published shape: the fields of briefing §3, plus validity and healthBoost', () => {
  const [x] = sevenDayMovers([row('abc', { health: 'HEALTHY' })], { validityOf: validityFrom({ abc: 'VALID' }) });
  assert.deepEqual(Object.keys(x), [
    'symbol', 'key', 'name', 'chain', 'change7d', 'volume24h', 'marketCap', 'turnover', 'upVolRatio',
    'validity', 'healthVerdict', 'healthBoost', 'score', 'rank',
  ]);
  assert.equal(x.validity, 'VALID');
  assert.equal(x.chain, 'ethereum');
});
