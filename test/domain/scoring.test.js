import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criScore, fuse } from '../../src/domain/scoring/fusion.js';
import { assessRisk } from '../../src/domain/scoring/risk.js';
import { composeDomain, onchainDomain } from '../../src/domain/scoring/domains.js';
import { classifySignal, tradePlan } from '../../src/domain/signals/signal.js';

const W = { similarity: 0.18, structure: 0.18, setup: 0.14, activity: 0.14, derivatives: 0.12, onchain: 0.1, catalyst: 0.08, attention: 0.03, fundamentals: 0.03 };
const dom = (id, score, confidence = 0.8, sources = [id]) => ({ id, state: 'AVAILABLE', score, confidence, sources });
const unknown = (id) => ({ id, state: 'UNKNOWN', score: null, confidence: 0, sources: [] });

test('UNKNOWN is not bearish: a missing domain never lowers the fused score', () => {
  const known = [dom('similarity', 70), dom('structure', 72), dom('setup', 68), dom('activity', 70)];
  const a = fuse(known, W);
  const b = fuse([...known, unknown('onchain'), unknown('derivatives')], W);
  assert.equal(a.fused, b.fused);
  assert.equal(a.coverage, b.coverage, 'unknown domains do not count as covered');
  assert.ok(b.coverage < 1);
});

test('fusion refuses to score with < 30% weighted coverage', () => {
  const f = fuse([dom('attention', 90), dom('fundamentals', 90)], W);
  assert.equal(f.state, 'INSUFFICIENT_DATA');
  assert.equal(f.fused, null);
  assert.deepEqual(criScore(f), { cri: null, tier: 'E' });
});

test('conflicting strong domains are preserved as a conflict and lower reliability', () => {
  const calm = fuse([dom('similarity', 80), dom('structure', 78), dom('setup', 76), dom('activity', 74)], W);
  const torn = fuse([dom('similarity', 85), dom('structure', 15), dom('setup', 82), dom('activity', 20)], W);
  assert.equal(calm.conflict, false);
  assert.equal(torn.conflict, true);
  assert.ok(torn.reliability < calm.reliability);
});

test('CRI rewards confidence and coverage and maps to tiers', () => {
  const high = criScore({ fused: 80, confidence: 1, coverage: 1, conflict: false });
  const low = criScore({ fused: 80, confidence: 0.2, coverage: 0.4, conflict: false });
  assert.equal(high.cri, 80);
  assert.equal(high.tier, 'A');
  assert.ok(low.cri < high.cri);
});

test('composeDomain: weighted facts, unknown facts reduce completeness not score', () => {
  const d = composeDomain('setup', [
    { key: 'a', label: 'A', value: 1, display: '1', score: 80, weight: 0.5 },
    { key: 'b', label: 'B', value: null, display: null, score: null, weight: 0.5 },
  ]);
  assert.equal(d.state, 'AVAILABLE');
  assert.equal(d.score, 80);
  assert.ok(d.completeness < 1);
});

const cfg = {
  buySetup: { minCri: 66, minAnalog: 60, minReliability: 0.3 },
  accumulate: { minCri: 58, minAnalog: 55, minSetup: 58 },
  watch: { minCri: 52, minAnalog: 62 },
  riskOffPenalty: 5,
};
const base = { stage: 'PRE_EXPANSION', hype: 'STEALTH', cri: 72, bestAnalog: 68, reliability: 0.6, setupScore: 70, structure4h: 'BULLISH', risk: { critical: false, grade: 'B' }, hasCandles: true, deep: true, regime: 'NEUTRAL', conflict: false };

test('signal rules: BUY_SETUP only with the full checklist', () => {
  assert.equal(classifySignal(base, cfg).type, 'BUY_SETUP');
  const noCandles = classifySignal({ ...base, hasCandles: false }, cfg);
  assert.notEqual(noCandles.type, 'BUY_SETUP');
  assert.ok(noCandles.blockers.some((b) => b.includes('lumânările')));
  assert.equal(classifySignal({ ...base, structure4h: 'BEARISH' }, cfg).type === 'BUY_SETUP', false);
  assert.equal(classifySignal({ ...base, cri: 68, regime: 'RISK_OFF' }, cfg).type === 'BUY_SETUP', false, 'risk-off raises the bar');
});

test('signal rules: risk and lateness override opportunity', () => {
  assert.equal(classifySignal({ ...base, risk: { critical: true, grade: 'D' } }, cfg).type, 'AVOID');
  assert.equal(classifySignal({ ...base, stage: 'EXPANSION' }, cfg).type, 'LATE');
  assert.equal(classifySignal({ ...base, hype: 'HYPED' }, cfg).type, 'LATE');
  assert.equal(classifySignal({ ...base, stage: 'DECLINE', structure4h: 'BEARISH' }, cfg).type, 'AVOID');
  assert.equal(classifySignal({ ...base, stage: 'BUILDING', deep: false }, cfg).type === 'ACCUMULATE', false, 'light assets never get ACCUMULATE');
  assert.equal(classifySignal({ ...base, stage: 'BUILDING' }, cfg).type, 'ACCUMULATE');
});

test('trade plan: invalidation below entry, targets above, 2R / 4R geometry', () => {
  const d1 = { close: 1.0, ema20: 0.95, low30: 0.8, high30: 1.2, atrPct14: 5 };
  const h4 = { close: 1.0, atr14: 0.02, orderBlocks: [{ top: 0.98, bottom: 0.95 }], sweep: { low: 0.93 }, swingHigh: 1.6 };
  const p = tradePlan('BUY_SETUP', d1, h4);
  assert.ok(p.invalidation < p.entryLow && p.entryLow <= p.entryHigh);
  assert.ok(p.targets[0].price > p.entryHigh && p.targets[1].price > p.targets[0].price);
  assert.equal(p.rr, 4);
  assert.ok(p.targets.some((t) => t.label.startsWith('T3')), '1D liquidity target when it sits beyond 4R');
  const acc = tradePlan('ACCUMULATE', d1, null);
  assert.equal(acc.entryLow, 0.8);
  assert.ok(acc.invalidation < 0.8);
  assert.equal(tradePlan('WATCH', d1, h4), null, 'no plan without a signal');
});

test('risk: critical contract flags force grade D; overhang is HIGH', () => {
  const crit = assessRisk({}, { security: { honeypot: true } }, null);
  assert.equal(crit.critical, true);
  assert.equal(crit.grade, 'D');
  const overhang = assessRisk({ floatRatio: 0.08, fdvToMcap: 12.5 }, null, null);
  assert.ok(overhang.flags.some((f) => f.code === 'UNLOCK_OVERHANG' && f.severity === 'HIGH'));
  const clean = assessRisk({ floatRatio: 0.6, fdvToMcap: 1.6, ageDays: 300 }, { security: { honeypot: false, buyTax: 0, sellTax: 0 }, top10Pct: 40 }, { rsi14: 60 });
  assert.equal(clean.grade, 'A');
  const taxed = assessRisk({}, { security: { buyTax: 0.3, sellTax: 0.3 } }, null);
  assert.ok(taxed.flags.some((f) => f.code === 'EXTREME_TAX'), 'GoPlus taxes are fractions: 0.3 = 30%');
});

test('on-chain domain: Arkham accumulation lifts the score, missing Arkham changes nothing', () => {
  const lf = { alphaStatus: 'LISTED' };
  const base = { holders: 9000, holdersChangePct: 6, liqToMcap: 0.02, dexLiquidityUsd: 8e5, buySellRatio: 1.1, sources: ['goplus'] };
  const without = onchainDomain(lf, base);
  const withNull = onchainDomain(lf, { ...base, walletFlows: null });
  assert.equal(without.score, withNull.score, 'UNKNOWN wallet flows are not bearish');
  const accumulating = onchainDomain(lf, { ...base, walletFlows: { window: '7d', netflowRatio: 0.45, walletNetUsd: 1e6, exchangeBias: 0.5, exchangeNetUsd: -7e5, persistence: { positive: 5, total: 6, share: 0.833 } } });
  const distributing = onchainDomain(lf, { ...base, walletFlows: { window: '7d', netflowRatio: -0.5, walletNetUsd: -1e6, exchangeBias: -0.6, exchangeNetUsd: 9e5, persistence: { positive: 0, total: 6, share: 0 } } });
  assert.ok(accumulating.score > without.score && without.score > distributing.score);
  assert.ok(accumulating.facts.find((f) => f.key === 'exchangeFlow').display.startsWith('retrageri nete'));
});

test('risk: Arkham exchange deposits and wallet distribution are flagged, never critical', () => {
  const oc = { walletFlows: { window: '7d', netflowRatio: -0.5, walletOutUsd: 400_000, exchangeNetUsd: 300_000 }, exchangeNetToMcap: 0.02 };
  const r = assessRisk({}, oc, null);
  const codes = r.flags.map((f) => f.code);
  assert.ok(codes.includes('EXCHANGE_INFLOW') && codes.includes('WALLET_DISTRIBUTION'));
  assert.equal(r.critical, false);
});
