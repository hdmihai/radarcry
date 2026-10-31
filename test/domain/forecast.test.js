/**
 * The ≥100× forecast: how a winner is recognised in a year of daily closes (and how a bad tick is
 * not), what its fingerprint may read (only the days up to its low), and how the base rate and the
 * likelihood ratio combine into a probability that stays honest with few examples.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintAt, judgeWinner, largestRun, marketCandidate, roundTrip, vectorCoverage, WINNER_STATUS } from '../../src/domain/forecast/winners.js';
import { baseRate, eventsFor, forecastBand, forecastUniverse, kernel, positivesFor, posterior, separation } from '../../src/domain/forecast/model.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-31T00:00:00Z');

/** Daily candles from a list of [daysAgo, price] knots, geometric in between; mcap = price × supply. */
function series(knots, { supply = 1e8, turnover = 0.2, from = 400 } = {}) {
  const out = [];
  for (let d = from; d >= 0; d -= 1) {
    let k = 0;
    while (k < knots.length - 2 && d < knots[k + 1][0]) k += 1;
    const [d0, p0] = knots[k];
    const [d1, p1] = knots[k + 1];
    const f = d0 === d1 ? 0 : Math.min(1, Math.max(0, (d0 - d) / (d0 - d1)));
    const c = Math.exp(Math.log(p0) + (Math.log(p1) - Math.log(p0)) * f);
    out.push({ t: NOW - d * DAY, o: c, h: c, l: c, c, mc: c * supply, v: c * supply * turnover });
  }
  return out;
}

/** 120× run: base at $0.05 (mcap $5M) 200 days ago, peak $6 100 days ago, then −90%. */
const RUN = series([[400, 0.2], [230, 0.06], [200, 0.05], [100, 6], [70, 0.6], [0, 0.6]]);

test('a run inside the window is found on median closes: its low, its peak, its multiple', () => {
  const r = largestRun(RUN, { nowMs: NOW });
  // Read on 3-day medians, the multiple is slightly conservative (the exact knots are 0.05 → 6).
  assert.ok(r.multiple > 105 && r.multiple < 125, String(r.multiple));
  const daysAgo = (at) => Math.round((NOW - Date.parse(`${at}T00:00:00Z`)) / DAY);
  assert.ok(Math.abs(daysAgo(r.low.at) - 200) <= 1, `low ${r.low.at}`);
  assert.ok(Math.abs(daysAgo(r.peak.at) - 100) <= 1, `peak ${r.peak.at}`);
  assert.ok(Math.abs(r.days - 100) <= 2);
  assert.ok(r.drawdownNowPct < -89 && r.drawdownNowPct > -91);
});

test('a single bad tick cannot make a low, and an illiquid low does not count', () => {
  const spiked = RUN.map((k, i) => (i === 300 ? { ...k, c: k.c / 1000 } : k));
  assert.ok(largestRun(spiked, { nowMs: NOW }).multiple < 125, 'the one-day 1000× "low" is ignored by the median');
  // The same shape with a $50k low: the run can only be counted from the first investable day
  // (capitalisation ≥ $1M), which removes almost all of it.
  const tiny = series([[400, 0.2], [200, 0.05], [100, 6], [0, 0.6]], { supply: 1e6 });
  assert.ok((largestRun(tiny, { nowMs: NOW, minLowMcapUsd: 1e6 })?.multiple ?? 0) < 10);
});

test('only the last twelve months count: an older low does not inflate the multiple', () => {
  const old = series([[700, 0.01], [500, 1], [365, 1], [100, 3], [0, 2]], { from: 700 });
  const r = largestRun(old, { nowMs: NOW });
  assert.ok(r.multiple < 3.5, `in-window multiple only (${r.multiple})`);
});

test('the fingerprint at the low reads nothing after the low', () => {
  const r = largestRun(RUN, { nowMs: NOW });
  const a = fingerprintAt(RUN, r.lowIdx, { chain: 'bsc', listedMs: NOW - 380 * DAY });
  const altered = RUN.map((k, i) => (i > r.lowIdx ? { ...k, c: k.c * 7, mc: k.mc * 7, v: k.v * 3 } : k));
  const b = fingerprintAt(altered, r.lowIdx, { chain: 'bsc', listedMs: NOW - 380 * DAY });
  assert.deepEqual(a.vector, b.vector, 'no look-ahead');
  assert.ok(a.coverage >= 0.35, `enough of the fingerprint is known (${a.coverage})`);
  assert.equal(a.vector.bnbChain, 100);
});

test('market candidates: ATL before ATH, the ATH inside the window, a multiple worth checking', () => {
  const asset = (m) => ({ key: 'cg:x', symbol: 'X', name: 'X', ids: { coingecko: 'x' }, primary: { chain: 'bsc' }, market: m });
  const c = marketCandidate(asset({ atl: 0.01, atlDate: '2026-02-01T00:00:00Z', ath: 2, athDate: '2026-09-01T00:00:00Z' }), { nowMs: NOW });
  assert.equal(c.claimed.multiple, 200);
  assert.equal(c.id, 'x');
  assert.equal(marketCandidate(asset({ atl: 0.01, atlDate: '2026-09-02T00:00:00Z', ath: 2, athDate: '2026-09-01T00:00:00Z' }), { nowMs: NOW }), null, 'low after the high');
  assert.equal(marketCandidate(asset({ atl: 0.01, atlDate: '2024-01-01T00:00:00Z', ath: 2, athDate: '2024-06-01T00:00:00Z' }), { nowMs: NOW }), null, 'peak outside the window');
  assert.equal(marketCandidate(asset({ atl: 1, atlDate: '2026-02-01T00:00:00Z', ath: 5, athDate: '2026-09-01T00:00:00Z' }), { nowMs: NOW }), null, 'a 5× rally is not in the class');
});

test('a candidate is confirmed, contradicted, documented or pending — never assumed', () => {
  const entry = { id: 'x', symbol: 'X', name: 'X', chain: 'bsc', claimed: { multiple: 900 } };
  const ok = judgeWinner(entry, RUN, { nowMs: NOW });
  assert.equal(ok.status, WINNER_STATUS.CONFIRMED);
  assert.ok(ok.vector && ok.multiple > 100);
  const flat = series([[400, 1], [0, 1.4]]);
  assert.equal(judgeWinner(entry, flat, { nowMs: NOW }).status, WINNER_STATUS.BELOW, 'the claim of 900× is contradicted');
  assert.equal(judgeWinner({ ...entry, documented: { multiple: 300 } }, null).status, WINNER_STATUS.DOCUMENTED);
  assert.equal(judgeWinner(entry, null).status, WINNER_STATUS.PENDING);
  assert.equal(roundTrip([{ drawdownNowPct: -90 }, { drawdownNowPct: -98 }, { drawdownNowPct: -40 }]).medianDrawdownPct, -90);
});

test('the base rate: a sceptical prior holds a short history down, data takes over as it grows', () => {
  const short = baseRate({ events: 3, population: 50 });
  assert.ok(short.p < 0.02, `3 of 50 does not mean 6% (${short.p})`);
  assert.ok(short.lo <= short.p && short.p <= short.hi);
  const long = baseRate({ events: 40, population: 8000 });
  assert.ok(Math.abs(long.p - 41 / 8200) < 1e-9, 'posterior mean: (40 + 0.5% × 200) / (8000 + 200)');
  assert.equal(baseRate({ events: 0, population: 0 }).p, 0.005, 'no data: the prior');
  assert.equal(posterior(0.01, 1), 0.01);
  assert.ok(posterior(0.01, 5) > 0.04 && posterior(0.01, 5) < 0.05);
});

const vec = (o) => ({ size: 50, float: 50, concentration: 50, perps: 50, bnbChain: 50, alpha: 50, reset: 50, age: 50, turnover: 50, volAccel: 50, trend30: 50, trendQuality: 50, rangePos: 50, compression: 50, change30: 50, ...o });

test('the kernel compares only what both fingerprints know, and only when it is enough', () => {
  assert.equal(kernel(vec({}), vec({})), 1);
  assert.ok(kernel(vec({}), vec({ size: 90 })) < 1);
  const sparse = { size: 50, bnbChain: 100 };
  assert.equal(kernel(sparse, vec({})), null, 'too little known in common');
});

test('the forecast: near the winners above the base rate, far from them below, no winners = base rate', () => {
  const W = { status: WINNER_STATUS.CONFIRMED, coverage: 1 };
  const winners = [
    { ...W, symbol: 'W1', name: 'W1', multiple: 150, vector: vec({ size: 20, float: 10, concentration: 90 }) },
    { ...W, symbol: 'W2', name: 'W2', multiple: 220, vector: vec({ size: 22, float: 12, concentration: 88 }) },
    { ...W, symbol: 'W3', name: 'W3', multiple: 30, vector: vec({ size: 25, float: 15, concentration: 85 }) },
  ];
  const projects = [
    { key: 'near', vector: vec({ size: 21, float: 11, concentration: 89 }) },
    { key: 'far', vector: vec({ size: 95, float: 95, concentration: 5, bnbChain: 0, alpha: 0 }) },
    ...Array.from({ length: 40 }, (_, i) => ({ key: `bg${i}`, vector: vec({ size: 40 + (i % 20) * 3, float: 30 + (i % 7) * 10, concentration: 20 + (i % 5) * 10 }) })),
  ];
  const rates = { 100: baseRate({ events: 2, population: 600 }), 20: baseRate({ events: 3, population: 600 }) };
  const out = forecastUniverse(projects, winners, { rates }, { targets: [100, 20] });
  const near = out.get('near').targets[100];
  const far = out.get('far').targets[100];
  assert.ok(near.p > rates[100].p && near.lift > 1, `near the winners: ${near.p} vs ${rates[100].p}`);
  assert.ok(far.p < rates[100].p, 'far from them: below the base rate');
  assert.ok(near.lo <= near.p && near.p <= near.hi, 'the interval contains the estimate');
  assert.ok(near.lift <= 25, 'clamped');
  assert.deepEqual(out.get('near').nearest.map((n) => n.symbol).slice(0, 2).sort(), ['W1', 'W2']);
  assert.equal(out.get('near').targets[20].positives, 3, 'the ≥20× target learns from all three');

  const none = forecastUniverse(projects, [], { rates }, { targets: [100] });
  assert.equal(none.get('near').targets[100].p, Number(rates[100].p.toFixed(5)));
  assert.equal(none.get('near').targets[100].basis, 'rata de bază');
});

test('with a single winner the lift is shrunk hard; positives and events are counted per target', () => {
  const one = [{ status: WINNER_STATUS.CONFIRMED, coverage: 1, symbol: 'W', name: 'W', multiple: 300, vector: vec({ size: 10, float: 5 }) }];
  const projects = [{ key: 'twin', vector: vec({ size: 10, float: 5 }) }, ...Array.from({ length: 30 }, (_, i) => ({ key: `b${i}`, vector: vec({ size: 60 + i, float: 60 }) }))];
  const rates = { 100: baseRate({ events: 1, population: 500 }) };
  const t = forecastUniverse(projects, one, { rates }, { targets: [100] }).get('twin').targets[100];
  assert.ok(t.lr <= 25 ** (1 / 6) + 1e-9, `one example counts 1/(1+5) of its evidence (lr ${t.lr})`);
  const ws = [...one, { status: WINNER_STATUS.DOCUMENTED, multiple: 120 }, { status: WINNER_STATUS.PENDING, multiple: 400 }, { status: WINNER_STATUS.CONFIRMED, multiple: 40, coverage: 1, vector: vec({}) }];
  assert.equal(eventsFor(ws, 100), 2, 'confirmed and documented count, pending does not');
  assert.equal(positivesFor(ws, 100).length, 1, 'only measured fingerprints are positives');
  assert.equal(positivesFor(ws, 20).length, 2);
});

test('separation and bands are reported, not assumed', () => {
  const W = { status: WINNER_STATUS.CONFIRMED, coverage: 1, multiple: 150 };
  const winners = [{ ...W, vector: vec({ size: 10 }) }, { ...W, vector: vec({ size: 12 }) }, { ...W, vector: vec({ size: 11 }) }];
  const projects = Array.from({ length: 30 }, (_, i) => ({ key: `p${i}`, vector: vec({ size: 40 + i * 2 }) }));
  const sep = separation(winners, projects, 100);
  assert.ok(sep.medianLift > 1 && sep.n === 3);
  assert.equal(separation(winners.slice(0, 1), projects, 100), null, 'one winner cannot be left out');
  assert.equal(forecastBand(0.05, 0.01).key, 'HIGH');
  assert.equal(forecastBand(0.02, 0.01).key, 'ABOVE');
  assert.equal(forecastBand(0.01, 0.01).key, 'BASE');
  assert.equal(forecastBand(0.004, 0.01).key, 'BELOW');
  assert.equal(vectorCoverage(vec({})), 1);
});
