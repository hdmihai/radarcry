import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyFeatures } from '../../src/domain/features/daily.js';
import { rsi, emaSeries } from '../../src/domain/features/indicators.js';
import { smcFeatures } from '../../src/domain/features/smc.js';
import { stageFromDaily } from '../../src/domain/lifecycle/stage.js';
import { hypeState } from '../../src/domain/lifecycle/hype.js';
import { watchlistChanges } from '../../src/domain/lifecycle/watchlist.js';
import { compareVectors, matchAnalogs, sequenceSimilarity } from '../../src/domain/similarity/engine.js';
import { FEATURES, toVector } from '../../src/domain/similarity/vector.js';
import { detectAnchor } from '../../src/domain/similarity/references.js';
import { H4, candlesFromReturns, flat } from '../helpers.js';

test('indicators: RSI saturates on monotonic series, EMA tracks level', () => {
  const up = Array.from({ length: 40 }, (_, i) => 100 + i);
  assert.equal(rsi(up), 100);
  const ema = emaSeries(Array(30).fill(5), 10);
  assert.ok(Math.abs(ema[ema.length - 1] - 5) < 1e-9);
});

test('stage: a vertical move is EXPANSION, a grinding fall is DECLINE, noise is BASE', () => {
  const expansion = dailyFeatures(candlesFromReturns([...flat(50), ...Array(7).fill(0.11)]));
  assert.equal(stageFromDaily(expansion).stage, 'EXPANSION');
  const decline = dailyFeatures(candlesFromReturns(Array(70).fill(-0.02), { start: 10 }));
  assert.equal(stageFromDaily(decline).stage, 'DECLINE');
  const base = dailyFeatures(candlesFromReturns(flat(70, 0.012)));
  assert.equal(stageFromDaily(base).stage, 'BASE');
});

test('daily features expose the fingerprint inputs used by the analog engine', () => {
  const f = dailyFeatures(candlesFromReturns(flat(80)));
  for (const k of ['slope30', 'r2_30', 'rangePos30', 'compression', 'volAccel', 'change30', 'rsi14']) assert.ok(k in f, `missing ${k}`);
  assert.equal(dailyFeatures(candlesFromReturns(flat(10))), null, 'too short → unknown, not a guess');
});

test('SMC: higher highs + higher lows read as bullish structure', () => {
  const rets = [];
  for (let i = 0; i < 12; i += 1) rets.push(0.03, 0.03, 0.03, -0.02, -0.02);
  const f = smcFeatures(candlesFromReturns(rets, { step: H4, vol: 0.005 }));
  assert.equal(f.structure, 'BULLISH');
  assert.equal(smcFeatures(candlesFromReturns(flat(10), { step: H4 })), null, 'fewer than 40 closed 4H bars → no SMC read');
});

test('hype: paid promotion + trending + vertical week = HYPED; nothing = STEALTH', () => {
  assert.equal(hypeState({ cgTrending: true, dexBoost: 500, gtTrending: true, change7d: 120, attentionKnown: true, stage: 'EXPANSION' }).state, 'HYPED');
  assert.equal(hypeState({ cgTrending: false, dexBoost: 0, gtTrending: false, change7d: 4, attentionKnown: true, stage: 'BUILDING' }).state, 'STEALTH');
  assert.equal(hypeState({ attentionKnown: false }).state, 'UNKNOWN');
});

test('similarity: identical fingerprints score 100, unknown features are excluded not penalised', () => {
  const raw = { mcapUsd: 2e7, floatRatio: 0.1, top10Pct: 85, perpVenues: 2, chain: 'bsc', alphaListed: true, athChangePct: -70, ageDays: 170, turnover: 0.12, volAccel: 1, slope30: 0, r2_30: 0.2, rangePos30: 0.3, compression: 0.9, change30: 0 };
  const v = toVector(raw);
  assert.equal(compareVectors(v, v).similarity, 100);
  const partial = { ...v, concentration: null, alpha: null };
  const r = compareVectors(partial, v);
  assert.equal(r.similarity, 100, 'missing traits do not count as differences');
  assert.ok(r.coverage < 1);
  const totalW = FEATURES.reduce((s, f) => s + f.weight, 0);
  assert.ok(Math.abs(r.coverage - (totalW - 0.9 - 0.8) / totalW) < 0.002);
});

test('analog matching ranks the closer reference first and reports DNA vs phase', () => {
  const refA = { symbol: 'LAB', vector: toVector({ mcapUsd: 2e7, floatRatio: 0.08, top10Pct: 85, perpVenues: 2, chain: 'bsc', alphaListed: true, athChangePct: -70, ageDays: 170, turnover: 0.12 }), sequence: ['BASE', 'BUILDING'] };
  const refB = { symbol: 'AGT', vector: toVector({ mcapUsd: 4e8, floatRatio: 0.9, top10Pct: 20, perpVenues: 0, chain: 'ethereum', alphaListed: false, athChangePct: -5, ageDays: 900, turnover: 0.01 }), sequence: ['DECLINE', 'BASE'] };
  const cand = { vector: toVector({ mcapUsd: 2.5e7, floatRatio: 0.1, top10Pct: 80, perpVenues: 2, chain: 'bsc', alphaListed: true, athChangePct: -65, ageDays: 200, turnover: 0.1 }), sequence: ['BASE', 'BUILDING'] };
  const m = matchAnalogs(cand, [refB, refA], { sigma: 22 });
  assert.equal(m.best.ref, 'LAB');
  assert.ok(m.best.dnaSim > 80);
  assert.equal(sequenceSimilarity(['BASE', 'BUILDING'], ['BASE', 'BUILDING']), 100);
});

test('reference anchor: detected at the base before a +100 % move, never inside it', () => {
  const rets = [...flat(60, 0.01), ...Array(12).fill(0.08), ...flat(30, 0.02)];
  const candles = candlesFromReturns(rets);
  const a = detectAnchor(candles);
  assert.ok(a, 'anchor found');
  assert.ok(a.index >= 55 && a.index <= 61, `anchor index ${a.index} should sit at the end of the base`);
  assert.ok(a.outcome >= 1.0);
});

test('watchlist: important transitions and new signals raise alerts in Romanian', () => {
  const prev = { k1: { stage: 'BUILDING', cri: 50, signal: 'WATCH' } };
  const { transitions, alerts } = watchlistChanges([{ key: 'k1', symbol: 'ABC', stage: 'PRE_EXPANSION', cri: 63, signal: { type: 'ACCUMULATE' } }], prev, '2026-10-17T00:00:00Z');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].direction, 'ADVANCE');
  assert.deepEqual(alerts.map((a) => a.kind).sort(), ['SCORE', 'SIGNAL', 'STAGE']);
  assert.ok(alerts.find((a) => a.kind === 'STAGE').reason.includes('Pre-expansiune'));
  assert.equal(alerts[0].severity, 'HIGH', 'HIGH alerts sort first');
});
