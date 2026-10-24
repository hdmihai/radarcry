/**
 * The Futures Radar: five weighted blocks and the hard filters that override them.
 *
 * The hard filters are the point of the grade. Arithmetic alone will happily hand an A+ to a long
 * setup inside a collapsing daily trend, or to an entry chased 20 % above its zone. These tests pin
 * each override from the technical solution so none of them can be lost in a refactor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUTURES_WEIGHTS, GRADE_CUTS, RR_MIN, futuresGrade, gradeOf, liquidityScore, volumeVolatilityScore } from '../../src/domain/futures/grade.js';
import { TREND, dailyTrend } from '../../src/domain/futures/trend.js';
import { CHASE_LIMIT_PCT, fourHourSetup, tradeLevels } from '../../src/domain/futures/setup.js';
import { FUNDING, FUNDING_STATE, OI_REGIME, fundingState, oiRegime, positioning, toPct8h } from '../../src/domain/futures/positioning.js';
import { liquidationMap } from '../../src/domain/futures/liquidation-model.js';

const HOUR = 3_600_000;

/** A deterministic candle series: `fn(i)` returns the close, the body is drawn around it. */
function candles(n, fn, { step = 86_400_000, start = Date.parse('2025-06-01T00:00:00Z') } = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const c = fn(i);
    const o = i === 0 ? c : fn(i - 1);
    out.push({ t: start + i * step, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: 1_000_000, closed: true });
  }
  return out;
}

test('the five block weights are exactly the ones from the technical solution', () => {
  assert.deepEqual(FUTURES_WEIGHTS, { trend1d: 25, structure4h: 30, positioning: 25, liquidity: 10, volume: 10 });
  assert.equal(Object.values(FUTURES_WEIGHTS).reduce((s, x) => s + x, 0), 100);
  assert.deepEqual(GRADE_CUTS.map((c) => [c.grade, c.min]), [['A++', 95], ['A+', 90], ['A', 85], ['B', 80]]);
  assert.equal(gradeOf(95), 'A++');
  assert.equal(gradeOf(90), 'A+');
  assert.equal(gradeOf(85), 'A');
  assert.equal(gradeOf(80), 'B');
  assert.equal(gradeOf(79.9), 'NO_TRADE');
  assert.equal(gradeOf(null), 'NO_TRADE');
});

test('the daily trend separates a clean advance from a collapse, and says what LONG it permits', () => {
  const up = dailyTrend(candles(240, (i) => 100 * 1.004 ** i));
  assert.equal(up.regime, TREND.STRONG_BULL);
  assert.equal(up.blocksLong, false);
  assert.equal(up.blocksShort, true, 'a strong advance is no place to be short');
  assert.ok(up.score > 70);

  const down = dailyTrend(candles(240, (i) => 100 * 0.995 ** i));
  assert.equal(down.regime, TREND.STRONG_BEAR);
  assert.equal(down.blocksLong, true, 'a collapse removes LONG from the table');
  assert.ok(down.score < 30);

  const flat = dailyTrend(candles(240, (i) => 100 + Math.sin(i / 7) * 2));
  assert.ok([TREND.NEUTRAL, TREND.BULL, TREND.BEAR].includes(flat.regime), flat.regime);
  assert.equal(flat.blocksLong, false);

  assert.equal(dailyTrend(candles(10, () => 100)), null, 'ten candles are not a trend');
});

test('funding thresholds are the published ones, per 8 hours', () => {
  assert.deepEqual(FUNDING, { HEALTHY: 0.001, CROWDED_LONG: 0.015, DANGER_LONG: 0.05, CROWDED_SHORT: -0.03 });
  assert.equal(fundingState(0.0005), FUNDING_STATE.NEUTRAL);
  assert.equal(fundingState(0.001), FUNDING_STATE.HEALTHY);
  assert.equal(fundingState(0.015), FUNDING_STATE.CROWDED_LONGS);
  assert.equal(fundingState(0.05), FUNDING_STATE.DANGER);
  assert.equal(fundingState(-0.03), FUNDING_STATE.CROWDED_SHORTS);
  assert.equal(fundingState(null), FUNDING_STATE.UNKNOWN);

  // Venues publish different intervals; everything is normalised to percent per 8 hours.
  assert.equal(toPct8h(0.0001), 0.01, 'a fractional 8h rate becomes percent');
  assert.equal(toPct8h(0.01, { intervalHours: 1, alreadyPercent: true }), 0.08, 'an hourly rate is scaled to 8 hours');
  assert.equal(toPct8h(null), null);
});

test('the four price/open-interest regimes are classified as described', () => {
  assert.equal(oiRegime(5, 10), OI_REGIME.LONG_BUILDUP);
  assert.equal(oiRegime(-5, 10), OI_REGIME.SHORT_BUILDUP);
  assert.equal(oiRegime(5, -10), OI_REGIME.SHORT_COVERING);
  assert.equal(oiRegime(-5, -10), OI_REGIME.LONG_LIQUIDATION);
  assert.equal(oiRegime(0.2, 0.5), OI_REGIME.UNKNOWN, 'noise is not a regime');
  assert.equal(oiRegime(null, 10), OI_REGIME.UNKNOWN);
});

test('positioning rewards crowded shorts and punishes the danger zone', () => {
  // Hold the open-interest regime fixed so the comparison isolates the funding term.
  const squeeze = positioning({ fundingPct8h: -0.04, oiChangePct24h: 25, pricePct24h: 4, oiToMcap: 0.05, venues: 3 });
  const healthy = positioning({ fundingPct8h: 0.004, oiChangePct24h: 20, pricePct24h: 4, oiToMcap: 0.05, venues: 3 });
  const crowded = positioning({ fundingPct8h: 0.02, oiChangePct24h: 20, pricePct24h: 4, oiToMcap: 0.05, venues: 3 });
  const danger = positioning({ fundingPct8h: 0.06, oiChangePct24h: 40, pricePct24h: 9, oiToMcap: 0.3, venues: 3 });
  assert.equal(squeeze.regime, healthy.regime, 'same regime, so only funding differs');
  assert.ok(squeeze.score > healthy.score, 'shorts paying is better fuel for a long than longs paying');
  assert.ok(healthy.score > crowded.score, 'crowded longs score below healthy funding');
  assert.ok(crowded.score > danger.score, 'the danger zone is worse than merely crowded');
  assert.equal(danger.capsAtB, true, 'extreme funding caps the grade');
  assert.equal(healthy.capsAtB, false);

  // Unknown funding must not be scored as bad.
  const unknown = positioning({ fundingPct8h: null, oiChangePct24h: null, pricePct24h: null, oiToMcap: null, venues: 0 });
  assert.equal(unknown.funding, FUNDING_STATE.UNKNOWN);
  assert.ok(unknown.score >= 45 && unknown.score <= 55, `unknown positioning sits near neutral, got ${unknown.score}`);
  assert.ok(unknown.reasons.some((r) => r.includes('nu penalizat')));

  // Venues disagreeing about funding is itself information.
  const split = positioning({ fundingPct8h: 0.004, fundingByVenue: { binance: 0.002, bybit: 0.06 }, oiToMcap: 0.05, venues: 2 });
  assert.ok(split.fundingSpreadPct > 0.03);
  assert.ok(split.reasons.some((r) => r.includes('date fragile')));
});

test('the invalidation always sits below the entry, so the reward/risk ratio is real', () => {
  // A rising 4H series produces order blocks and swing lows; the levels must be ordered regardless.
  const setup = fourHourSetup(candles(200, (i) => 100 * 1.002 ** i + Math.sin(i / 5) * 1.5, { step: 4 * HOUR }));
  assert.ok(setup, 'the setup is computed');
  const levels = tradeLevels(setup, { blocksLong: false });
  if (levels.stop !== null) {
    assert.ok(levels.stop < levels.entry, `stop ${levels.stop} must be below entry ${levels.entry}`);
    assert.ok(levels.rr1 > 0, 'a positive risk gives a real reward/risk ratio');
    assert.ok(levels.target1 > levels.entry);
    assert.ok(levels.target2 >= levels.target1);
  }
  assert.match(levels.note, /nu execută/);
});

test('the chase limit is 8 % above the entry zone', () => {
  assert.equal(CHASE_LIMIT_PCT, 8);
  const setup = { score: 92, smc: { close: 100, structure: 'BULLISH', lastEvent: null, orderBlocks: [], fvgs: [], sweep: null, dealingRange: null, swingLow: 80, swingHigh: 110, atr14: 3 }, entryZone: { top: 90, bottom: 85, kind: 'OB' }, chasePct: 11.1, chasing: true, reasons: [] };
  const g = futuresGrade({
    trend: { score: 95, regime: TREND.BULL, reasons: [], bars: 240, blocksLong: false },
    setup,
    positioning: { score: 90, funding: FUNDING_STATE.HEALTHY, fundingPct8h: 0.002, regime: OI_REGIME.LONG_BUILDUP, reasons: [], capsAtB: false },
    liquidity: { score: 95, reasons: [] },
    volume: { score: 90, reasons: [] },
    levels: { rr1: 4 },
  });
  assert.ok(['A++', 'A+', 'A'].includes(g.rawGrade), `the arithmetic alone says ${g.rawGrade}`);
  assert.equal(g.grade, 'B', 'but a chased entry is capped at B');
  assert.ok(g.caps.some((c) => c.includes('8%')), g.caps.join('|'));
});

test('a strong daily downtrend removes LONG entirely, whatever the 4H says', () => {
  const g = futuresGrade({
    trend: { score: 10, regime: TREND.STRONG_BEAR, reasons: [], bars: 240, blocksLong: true },
    setup: { score: 99, smc: { close: 100, structure: 'BULLISH', lastEvent: null, orderBlocks: [], fvgs: [], sweep: null, dealingRange: null, swingLow: 95, swingHigh: 110, atr14: 2 }, entryZone: { top: 99, bottom: 97, kind: 'OB' }, chasePct: 1, chasing: false, reasons: [] },
    positioning: { score: 95, funding: FUNDING_STATE.CROWDED_SHORTS, fundingPct8h: -0.04, regime: OI_REGIME.SHORT_BUILDUP, reasons: [], capsAtB: false },
    liquidity: { score: 95, reasons: [] },
    volume: { score: 95, reasons: [] },
    levels: { rr1: 5 },
  });
  assert.equal(g.grade, 'NO_TRADE');
  assert.ok(g.blocked.some((b) => b.includes('LONG')), g.blocked.join('|'));
});

test('a reward/risk ratio below 2 caps the grade at B', () => {
  assert.equal(RR_MIN, 2);
  const parts = {
    trend: { score: 95, regime: TREND.BULL, reasons: [], bars: 240, blocksLong: false },
    setup: { score: 95, smc: { close: 100, structure: 'BULLISH', lastEvent: null, orderBlocks: [], fvgs: [], sweep: null, dealingRange: null, swingLow: 95, swingHigh: 110, atr14: 2 }, entryZone: { top: 99, bottom: 97, kind: 'OB' }, chasePct: 1, chasing: false, reasons: [] },
    positioning: { score: 92, funding: FUNDING_STATE.HEALTHY, fundingPct8h: 0.002, regime: OI_REGIME.LONG_BUILDUP, reasons: [], capsAtB: false },
    liquidity: { score: 95, reasons: [] },
    volume: { score: 92, reasons: [] },
  };
  assert.equal(futuresGrade({ ...parts, levels: { rr1: 1.4 } }).grade, 'B');
  assert.notEqual(futuresGrade({ ...parts, levels: { rr1: 3 } }).grade, 'B');
});

test('too few measurable blocks is NO_TRADE, not a guess', () => {
  const g = futuresGrade({ trend: null, setup: null, positioning: { score: 60, funding: FUNDING_STATE.UNKNOWN, reasons: [], capsAtB: false }, liquidity: null, volume: null, levels: null });
  assert.equal(g.grade, 'NO_TRADE');
  assert.equal(g.score, null);
  assert.ok(g.blocked.some((b) => b.includes('acoperire')), g.blocked.join('|'));
});

test('confidence reflects which blocks were measured and how well', () => {
  const full = futuresGrade({
    trend: { score: 80, regime: TREND.BULL, reasons: [], bars: 240, blocksLong: false },
    setup: { score: 80, smc: { close: 100, structure: 'BULLISH', lastEvent: null, orderBlocks: [], fvgs: [], sweep: null, dealingRange: null, swingLow: 95, swingHigh: 110, atr14: 2 }, entryZone: { top: 99, bottom: 97, kind: 'OB' }, chasePct: 1, chasing: false, reasons: [] },
    positioning: { score: 80, funding: FUNDING_STATE.HEALTHY, fundingPct8h: 0.002, regime: OI_REGIME.LONG_BUILDUP, reasons: [], capsAtB: false },
    liquidity: { score: 80, reasons: [] },
    volume: { score: 80, reasons: [] },
    levels: { rr1: 3 },
  });
  const thin = futuresGrade({
    trend: { score: 80, regime: TREND.BULL, reasons: [], bars: 60, blocksLong: false },
    setup: { score: 80, smc: { close: 100, structure: 'BULLISH', lastEvent: null, orderBlocks: [], fvgs: [], sweep: null, dealingRange: null, swingLow: 95, swingHigh: 110, atr14: 2 }, entryZone: { top: 99, bottom: 97, kind: 'OB' }, chasePct: 1, chasing: false, reasons: [] },
    positioning: { score: 80, funding: FUNDING_STATE.UNKNOWN, fundingPct8h: null, regime: 'UNKNOWN', reasons: [], capsAtB: false },
    liquidity: { score: 80, reasons: [] },
    volume: { score: 80, reasons: [] },
    levels: { rr1: 3 },
  });
  assert.equal(full.score, thin.score, 'the same block scores give the same number');
  assert.ok(thin.confidence < full.confidence, 'but a weaker measurement is less trustworthy');
});

test('liquidity and volume blocks read the facts a position actually depends on', () => {
  const deep = liquidityScore({ volume24hUsd: 150e6, turnover: 0.1, perpVolume24hUsd: 80e6, oiUsd: 40e6, depthUsd: 900_000, venues: 4 });
  const thin = liquidityScore({ volume24hUsd: 300_000, turnover: 0.002, perpVolume24hUsd: 500_000, oiUsd: null, depthUsd: 40_000, venues: 0 });
  assert.ok(deep.score > 80 && thin.score < 30, `${deep.score} vs ${thin.score}`);
  assert.ok(thin.reasons.some((r) => r.includes('sub 1M')));

  const coiled = volumeVolatilityScore({ volAccel: 2.8, compression: 0.55, atrPct: 7, rvol: 3.2, changePct24h: 4 });
  const spent = volumeVolatilityScore({ volAccel: 0.5, compression: 1.9, atrPct: 25, rvol: 0.4, changePct24h: 40 });
  assert.ok(coiled.score > spent.score + 30, `${coiled.score} vs ${spent.score}`);
  assert.ok(coiled.reasons.some((r) => r.includes('comprimată')));
});

test('the liquidation map is a model, says so, and places clusters on the crowded side', () => {
  const h4 = candles(160, (i) => 100 + Math.sin(i / 9) * 6, { step: 4 * HOUR });
  const crowdedLongs = liquidationMap({ candles: h4, oiUsd: 50e6, funding: FUNDING_STATE.DANGER, price: 100 });
  assert.equal(crowdedLongs.modelled, true);
  assert.match(crowdedLongs.note, /nu date de ordine/);
  assert.ok(crowdedLongs.assumptions.length >= 3, 'the assumptions are printed next to the output');
  assert.ok(crowdedLongs.longShare > 0.7, 'danger funding means longs are the crowded side');
  assert.ok(crowdedLongs.clusters.length > 0);
  for (const c of crowdedLongs.clusters) {
    assert.ok(Math.abs(c.distancePct) <= 35, 'clusters far outside the range are not useful');
    if (c.side === 'LONG') assert.ok(c.price < 100, 'long liquidations sit below price');
    if (c.side === 'SHORT') assert.ok(c.price > 100, 'short liquidations sit above price');
  }
  const crowdedShorts = liquidationMap({ candles: h4, oiUsd: 50e6, funding: FUNDING_STATE.CROWDED_SHORTS, price: 100 });
  assert.ok(crowdedShorts.shortShare > crowdedLongs.shortShare, 'the crowded side follows funding');

  // Without open interest the map is relative, and admits it.
  const noOi = liquidationMap({ candles: h4, oiUsd: null, funding: FUNDING_STATE.NEUTRAL, price: 100 });
  assert.equal(noOi.clusters[0].notionalUsd, null);
  assert.ok(noOi.assumptions.some((a) => a.includes('necunoscut')));

  assert.equal(liquidationMap({ candles: candles(5, () => 100), oiUsd: 1, funding: 'NEUTRAL', price: 100 }), null);
});

test('a structural stop inside the noise is widened to one 4H ATR, and says so', () => {
  // The live BIRB case: entry ~0.0508, structural stop 2.7 % lower, 4H ATR ~27 % of price.
  const smc = { close: 0.0508, structure: 'BULLISH', lastEvent: null, orderBlocks: [], fvgs: [], sweep: null, dealingRange: null, swingLow: 0.04941, swingHigh: 0.21208, atr14: 0.0138 };
  const setup = { score: 72, smc, entryZone: { top: 0.05144, bottom: 0.05017, kind: 'SWING_LOW' }, chasePct: 0, chasing: false, invalidation: 0.04941, reasons: [] };
  const levels = tradeLevels(setup, { blocksLong: false });
  assert.equal(levels.stopBasis, 'ATR_FLOOR');
  assert.ok(levels.entry - levels.stop >= 0.0138 - 1e-9, `stop distance ${levels.entry - levels.stop} must be at least one ATR`);
  assert.ok(levels.rr1 < 20, `R:R must describe the opportunity, not a stop inside the noise (got ${levels.rr1})`);
  assert.match(levels.note, /1 ATR/);

  // A structural stop already wider than one ATR is kept exactly where the structure put it.
  const calm = { ...setup, smc: { ...smc, atr14: 0.0005 } };
  const kept = tradeLevels(calm, { blocksLong: false });
  assert.equal(kept.stopBasis, 'STRUCTURE');
  assert.equal(kept.stop, Math.round(0.05017 * 0.985 * 1e8) / 1e8, 'the highest structural candidate: the zone floor');

  // One ATR larger than the price leaves no meaningful long invalidation at all.
  const wild = { ...setup, smc: { ...smc, atr14: 0.09 } };
  const none = tradeLevels(wild, { blocksLong: false });
  assert.equal(none.stop, null);
  assert.equal(none.rr1, null);
});
