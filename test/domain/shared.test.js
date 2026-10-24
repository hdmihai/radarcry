import { test } from 'node:test';
import assert from 'node:assert/strict';
import { band, bell, clamp, compress, lcsLength, linreg, median, quantile, round, wilson } from '../../src/domain/shared/math.js';
import { ageDays, toMs } from '../../src/domain/shared/time.js';
import { exclusionReason, namesMatch, normAddress, normChain, splitMultiplier } from '../../src/domain/shared/symbols.js';

test('wilson interval: known values and edge cases (fractions 0..1)', () => {
  const w = wilson(5, 10);
  assert.equal(w.p, 0.5);
  assert.ok(Math.abs(w.low - 0.237) < 0.002, `low ${w.low}`);
  assert.ok(Math.abs(w.high - 0.763) < 0.002, `high ${w.high}`);
  const zero = wilson(0, 19);
  assert.equal(zero.low, 0);
  assert.ok(zero.high > 0.15 && zero.high < 0.18, 'upper bound stays informative with 0 successes');
  const none = wilson(0, 0);
  assert.equal(none.p, null);
});

test('linreg recovers slope and r2 of a perfect line', () => {
  const r = linreg([1, 3, 5, 7, 9]);
  assert.ok(Math.abs(r.slope - 2) < 1e-9);
  assert.ok(Math.abs(r.r2 - 1) < 1e-9);
});

test('band / bell / clamp map onto 0..100 with fixed transforms', () => {
  assert.equal(band(5, 0, 10), 50);
  assert.equal(band(-5, 0, 10), 0);
  assert.equal(band(5, 10, 0), 50, 'reversed bands invert direction');
  assert.equal(bell(7, 7, 1), 100);
  assert.ok(bell(9, 7, 1) < 20);
  assert.equal(clamp(140), 100);
  assert.equal(band(null, 0, 1), null, 'unknown stays unknown');
});

test('median / quantile / round', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(quantile([0, 10], 0.5), 5);
  assert.equal(round(1.23456, 2), 1.23);
});

test('LCS on compressed stage sequences', () => {
  assert.deepEqual(compress(['BASE', 'BASE', 'BUILDING', 'BUILDING', 'PRE_EXPANSION']), ['BASE', 'BUILDING', 'PRE_EXPANSION']);
  assert.equal(lcsLength(['BASE', 'BUILDING', 'PRE_EXPANSION'], ['BASE', 'PRE_EXPANSION']), 2);
});

test('time helpers accept seconds, milliseconds and ISO strings', () => {
  assert.equal(toMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(toMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(toMs('2026-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(toMs(''), null);
  assert.equal(Math.round(ageDays('2026-01-01T00:00:00Z', Date.parse('2026-01-11T00:00:00Z'))), 10);
});

test('symbols: multipliers, exclusions and chain normalisation', () => {
  assert.deepEqual(splitMultiplier('1000PEPE'), { base: 'PEPE', multiplier: 1000 });
  assert.deepEqual(splitMultiplier('1MBABYDOGE'), { base: 'BABYDOGE', multiplier: 1_000_000 });
  assert.deepEqual(splitMultiplier('LAB'), { base: 'LAB', multiplier: 1 });
  assert.equal(exclusionReason({ symbol: 'USDT', name: 'Tether' }), 'STABLECOIN');
  assert.equal(exclusionReason({ symbol: 'WBTC', name: 'Wrapped Bitcoin' }), 'WRAPPED_OR_STAKED');
  assert.equal(exclusionReason({ symbol: 'JITOSOL', name: 'Jito Staked SOL' }), 'WRAPPED_OR_STAKED');
  assert.equal(exclusionReason({ symbol: 'LAB', name: 'LAB' }), null);
  assert.equal(normChain('binance-smart-chain'), 'bsc');
  assert.equal(normChain('BNB Smart Chain (BEP20)'), 'bsc');
  assert.equal(normAddress('bsc', '0xABCdef'), '0xabcdef', 'EVM addresses are case-insensitive');
  assert.ok(namesMatch('Alaya AI', 'alaya-ai'));
});
