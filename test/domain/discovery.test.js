/**
 * The discovery engine — the part that answers the project's question.
 *
 * These tests pin the three claims the question makes: that a change is measured against the
 * project's *own* norm, that simultaneity means breadth across families, and that earliness is
 * reported separately from momentum so a finished move is never mistaken for an early one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBaseline, compareToBaseline, metricRow, percentileOf, robustZ } from '../../src/domain/discovery/baseline.js';
import { obviousness, whatChanged } from '../../src/domain/discovery/changes.js';
import { BANDS, PRE_EXPANSION_WEIGHTS, bandOf, preExpansionScore } from '../../src/domain/discovery/pre-expansion.js';
import { EARLY_CANDIDATE, STAGE, classify, momentumScore, rankCandidates, stageOf } from '../../src/domain/discovery/classify.js';
import { weightedScore } from '../../src/domain/quality/data-quality.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-01T00:00:00Z');

/** A history of `n` daily points where every metric sits at `base`, plus an optional final reading. */
function history(base, n = 14) {
  const points = [];
  for (let i = n; i >= 1; i -= 1) {
    points.push({ at: NOW - i * DAY, metrics: { ...base } });
  }
  return points;
}

test('robust z-score: immune to a single spike, and honest about a flat history', () => {
  const quiet = [10, 10.4, 9.8, 10.1, 9.9, 10.2, 10, 9.7];
  // A genuine jump registers.
  assert.ok(robustZ(quiet, 14) > 3, 'a real jump scores above 3 sigma');
  // One historical outlier must not widen the spread enough to hide the next jump.
  const spiked = [...quiet, 95];
  assert.ok(robustZ(spiked, 14) > 2, 'a past spike does not mask a new one');
  // A perfectly flat history has no measurable spread: report direction, not a fabricated size.
  assert.equal(robustZ([5, 5, 5, 5, 5, 5], 5), 0);
  assert.equal(robustZ([5, 5, 5, 5, 5, 5], 9), 3);
  // Too little history is unknown, not zero.
  assert.equal(robustZ([1, 2], 10), null);
});

test('percentile ranks a reading inside the project own history', () => {
  assert.equal(percentileOf([1, 2, 3, 4], 4), 1);
  assert.equal(percentileOf([1, 2, 3, 4], 2), 0.5);
  assert.equal(percentileOf([], 2), null);
});

test('baseline never looks ahead and reports a short history as short', () => {
  const points = [
    ...history({ volume24h: 100 }, 6),
    { at: NOW + DAY, metrics: { volume24h: 9_999 } }, // a future point must be ignored
  ];
  const b = buildBaseline(points, { nowMs: NOW, windowDays: 30, minPoints: 4 });
  assert.equal(b.points, 6, 'only points strictly before the run are used');
  assert.equal(b.metrics.volume24h.median, 100);
  assert.equal(b.sufficient, true);

  const thin = buildBaseline(history({ volume24h: 100 }, 2), { nowMs: NOW, minPoints: 4 });
  assert.equal(thin.sufficient, false, 'two points are not a norm');
});

test('comparison expresses the current reading against the project own median', () => {
  const b = buildBaseline(history({ volume24h: 1_000_000, holders: 1000 }), { nowMs: NOW });
  const cmp = compareToBaseline({ volume24h: 3_000_000, holders: 1200 }, b);
  assert.equal(cmp.volume24h.changePct, 200);
  assert.equal(cmp.holders.changePct, 20);
  assert.ok(cmp.volume24h.z > 2, 'a 3× volume reading is far outside the own norm');
  // A metric with no history is unknown, which is different from zero.
  assert.equal(cmp.tvl.value, null);
  assert.equal(cmp.tvl.z, null);
});

test('metricRow collapses an asset into exactly the tracked metrics', () => {
  const row = metricRow({
    market: { price: 1, marketCap: 2, volume24h: 3 },
    derived: { turnover: 0.1 },
    onchain: { liquidityUsd: 4, holders: 5, top10Pct: 6, cexBalancePct: 7, whaleBalancePct: 8 },
    derivatives: { oiUsd: 9, fundingPct8h: 0.01 },
    fundamentals: { tvl: 10 },
    social: { devCommits30d: 11, mentions7d: 12 },
  });
  assert.equal(row.price, 1);
  assert.equal(row.turnover, 0.1);
  assert.equal(row.holders, 5);
  assert.equal(row.fundingPct8h, 0.01);
  assert.equal(row.tvl, 10);
});

/* ─────────────────────────── what changed, and whether it is simultaneous ─────────────────────── */

const quietAsset = () => ({
  symbol: 'TEST',
  market: { marketCap: 40e6, volume24h: 2e6, change: { h24: 1, d7: 3, d30: 6 }, athChangePct: -70 },
  derived: { turnover: 0.05 },
  onchain: {},
  features: { daily: {} },
  derivatives: {},
  attention: {},
  catalysts: [],
  risk: {},
});

test('a change only counts when it clears the project own norm', () => {
  const asset = quietAsset();
  const flat = compareToBaseline({ volume24h: 1_010_000 }, buildBaseline(history({ volume24h: 1_000_000 }), { nowMs: NOW }));
  assert.equal(whatChanged({ asset, cmp: flat }).count, 0, 'a 1% move against a quiet norm is not a change');

  const jump = compareToBaseline({ volume24h: 4_000_000 }, buildBaseline(history({ volume24h: 1_000_000 }), { nowMs: NOW }));
  const r = whatChanged({ asset, cmp: jump });
  assert.ok(r.changes.some((c) => c.key === 'VOLUME_EXPANSION'), 'a 4× volume reading is a change');
});

test('simultaneity requires breadth across families, not repetition inside one', () => {
  // Three readings, all from the FLOW family: that is one thing happening, not three.
  const oneFamily = whatChanged({
    asset: { ...quietAsset(), derived: { turnover: 0.09 } },
    cmp: compareToBaseline(
      { volume24h: 5_000_000, turnover: 0.09 },
      buildBaseline(history({ volume24h: 1_000_000, turnover: 0.03 }), { nowMs: NOW }),
    ),
  });
  assert.ok(oneFamily.familyCount <= 1, 'volume and turnover are the same family');
  assert.equal(oneFamily.simultaneous, false, 'one family is never simultaneity');

  // Now spread the same number of changes over distinct families.
  const broad = whatChanged({
    asset: {
      ...quietAsset(),
      onchain: { flows: { verdict: 'ACCUMULATION', accumulating: 6, distributing: 0, flags: [] } },
      futures: { setup: { smc: { lastEvent: { type: 'CHOCH', dir: 'UP', barsAgo: 4 } } } },
    },
    cmp: compareToBaseline(
      { volume24h: 5_000_000, liquidityUsd: 900_000, holders: 1400 },
      buildBaseline(history({ volume24h: 1_000_000, liquidityUsd: 500_000, holders: 1000 }), { nowMs: NOW }),
    ),
  });
  assert.ok(broad.familyCount >= 2, `expected several families, got ${broad.families.join(',')}`);
  assert.ok(broad.count >= 3, `expected at least three changes, got ${broad.count}`);
  assert.equal(broad.simultaneous, true);
  assert.ok(broad.confluence > oneFamily.confluence, 'breadth raises the confluence score');
});

test('earliness falls as the move becomes public — the LAB case', () => {
  const early = { ...quietAsset(), market: { ...quietAsset().market, change: { h24: 1, d7: 4, d30: 9 } } };
  const late = {
    ...quietAsset(),
    market: { marketCap: 40e6, volume24h: 2e6, change: { h24: 12, d7: 120, d30: 400 }, athChangePct: -3 },
    features: { daily: { rangePos30: 0.98, expansionGainPct: 300, volAccel: 9 } },
    attention: { cgTrending: true, gtTrending: true, dexBoost: 500 },
    derivatives: { fundingPct8h: 0.04 },
  };
  assert.ok(obviousness(early) < 25, 'a quiet token is not obvious');
  assert.equal(obviousness(late), 100, 'a token up 400% with trending and crowded funding is fully obvious');

  const cmp = compareToBaseline({}, buildBaseline([], { nowMs: NOW }));
  assert.ok(whatChanged({ asset: early, cmp }).earliness > 70);
  assert.equal(whatChanged({ asset: late, cmp }).earliness, 0);
  // Momentum and earliness must disagree on the same token: that is the point of reporting both.
  assert.ok(momentumScore(late) > 85, 'the finished move still has excellent momentum');
});

/* ─────────────────────────── the score and its redistribution ─────────────────────────────────── */

test('the eight pre-expansion weights are exactly the ones from the technical solution', () => {
  assert.deepEqual(PRE_EXPANSION_WEIGHTS, {
    volume: 20, liquidity: 15, holders: 15, whales: 20, supply: 10, structure: 10, regime: 5, narrative: 5,
  });
  assert.equal(Object.values(PRE_EXPANSION_WEIGHTS).reduce((s, x) => s + x, 0), 100);
});

test('the published bands are the ones from the technical solution', () => {
  assert.equal(bandOf(95).band, 'HIGH_POTENTIAL');
  assert.equal(bandOf(90).band, 'HIGH_POTENTIAL');
  assert.equal(bandOf(89).band, 'CONFIRMED');
  assert.equal(bandOf(75).band, 'CONFIRMED');
  assert.equal(bandOf(74).band, 'EARLY');
  assert.equal(bandOf(60).band, 'EARLY');
  assert.equal(bandOf(59).band, 'WATCH');
  assert.equal(bandOf(40).band, 'WATCH');
  assert.equal(bandOf(39).band, 'IGNORE');
  assert.equal(bandOf(null).band, 'UNKNOWN');
  assert.equal(BANDS.length, 5);
});

test('a missing factor is redistributed and lowers confidence — it never scores as zero', () => {
  const both = weightedScore([
    { key: 'a', label: 'A', weight: 50, score: 80 },
    { key: 'b', label: 'B', weight: 50, score: 80 },
  ]);
  const one = weightedScore([
    { key: 'a', label: 'A', weight: 50, score: 80 },
    { key: 'b', label: 'B', weight: 50, score: null },
  ]);
  assert.equal(both.score, one.score, 'the surviving factor keeps its own level, undiluted');
  assert.ok(one.confidence < both.confidence, 'the missing factor costs confidence, not score');
  assert.equal(one.missing.length, 1);
  assert.equal(one.coverage, 0.5);

  // A factor measured at a weaker grade counts, but counts for less.
  const weak = weightedScore([{ key: 'a', label: 'A', weight: 100, score: 80, quality: 'LOW' }]);
  const strong = weightedScore([{ key: 'a', label: 'A', weight: 100, score: 80, quality: 'HIGH' }]);
  assert.equal(weak.score, strong.score);
  assert.ok(weak.confidence < strong.confidence);
});

test('the score spans the full range: an ideal project reaches HIGH_POTENTIAL, a broken one IGNORE', () => {
  const market = { regime: { label: 'RISK_ON', state: 'RISK_ON', score: 78 }, altseason: { value: 72 }, fearGreed: { value: 62 } };
  const ideal = {
    symbol: 'IDEAL',
    market: { price: 0.1, marketCap: 40e6, volume24h: 6e6, change: { h24: 3, d7: 9, d30: 22 }, circulating: 8e8, total: 1e9, max: 1e9, fdv: 5e7 },
    derived: { turnover: 0.15 },
    venues: { perps: [] },
    onchain: {
      liquidityUsd: 2.4e6, holders: 42_000, top10EffectivePct: 24, cexBalancePct: 5,
      flows: { verdict: 'ACCUMULATION', accumulating: 7, distributing: 0, flags: [] },
      smartMoney: { score: 88, coverage: 0.9, measured: 14 },
    },
    features: { daily: { compression: 0.55, rangePos30: 0.32, higherLows: 3, dd30: -12, volAccel: 2.6 } },
    futures: { setup: { score: 84, smc: { structure: 'BULLISH' } } },
    risk: { supply: { floatRatio: 0.8, fdvToMcap: 1.25, unlockWithin30d: false, inflationPctYear: 3 } },
    narrative: { label: 'AI', score: 82, coverage: 0.9 },
  };
  const idealCmp = {
    volume24h: { z: 3.4, changePct: 210, percentile: 0.97, n: 14 },
    turnover: { z: 3, n: 14 },
    liquidityUsd: { changePct: 85, n: 14 },
    holders: { changePct: 31, n: 14 },
    top10Pct: { value: 24, median: 31, n: 14 },
  };
  const hi = preExpansionScore({ asset: ideal, cmp: idealCmp, market });
  assert.equal(hi.band, 'HIGH_POTENTIAL', `ideal project scored ${hi.score}`);
  assert.ok(hi.score >= 90);
  assert.ok(hi.confidence >= 90, 'everything measurable was measured');

  const broken = JSON.parse(JSON.stringify(ideal));
  broken.onchain = {
    liquidityUsd: 40_000, holders: 400, top10EffectivePct: 82, cexBalancePct: 40,
    flows: { verdict: 'DISTRIBUTION', accumulating: 0, distributing: 8, flags: ['TEAM_TO_CEX'] },
    smartMoney: { score: 14, coverage: 0.9, measured: 14 },
  };
  broken.risk = { supply: { floatRatio: 0.12, fdvToMcap: 9, unlockWithin30d: true, inflationPctYear: 70 } };
  broken.features = { daily: { compression: 1.9, rangePos30: 0.95, higherLows: 0, dd30: -60, volAccel: 0.5 } };
  broken.futures = { setup: { score: 18, smc: { structure: 'BEARISH' } } };
  broken.narrative = { label: 'Meme', score: 28, coverage: 0.9 };
  const lo = preExpansionScore({
    asset: broken,
    cmp: {
      volume24h: { z: -1.2, changePct: -40, percentile: 0.1, n: 14 },
      turnover: { z: -1, n: 14 },
      liquidityUsd: { changePct: -55, n: 14 },
      holders: { changePct: -9, n: 14 },
      top10Pct: { value: 82, median: 70, n: 14 },
    },
    market: { regime: { label: 'RISK_OFF', state: 'RISK_OFF', score: 22 }, altseason: { value: 18 }, fearGreed: { value: 16 } },
  });
  assert.equal(lo.band, 'IGNORE', `broken project scored ${lo.score}`);
  assert.ok(lo.score < 40);

  // A stale quote on the very same ideal project: the score must not move (the numbers are real,
  // just measured late), but the price-derived factors drop to the STALE grade and Confidence falls.
  const stale = JSON.parse(JSON.stringify(ideal));
  stale.quality = { flags: ['STALE_QUOTE'] };
  const st = preExpansionScore({ asset: stale, cmp: idealCmp, market });
  assert.equal(st.score, hi.score, 'a late reading is still a reading');
  assert.ok(st.confidence < hi.confidence, `stale quote must lower confidence (${st.confidence} vs ${hi.confidence})`);
  const staleFactors = st.factors.filter((f) => f.quality === 'STALE').map((f) => f.key).sort();
  assert.deepEqual(staleFactors, ['liquidity', 'structure', 'volume']);
});

/* ─────────────────────────── stage and the Early Research Candidate ───────────────────────────── */

test('stage follows breadth of change and public obviousness', () => {
  const asset = quietAsset();
  assert.equal(stageOf({ changed: { count: 0, familyCount: 0, obviousness: 0 }, momentum: 50, asset }), STAGE.DORMANT);
  assert.equal(stageOf({ changed: { count: 1, familyCount: 1, obviousness: 0 }, momentum: 50, asset }), STAGE.EARLY_ACTIVITY);
  assert.equal(stageOf({ changed: { count: 3, familyCount: 2, obviousness: 10 }, momentum: 55, asset }), STAGE.MULTI_FACTOR);
  assert.equal(stageOf({ changed: { count: 5, familyCount: 3, obviousness: 50 }, momentum: 70, asset }), STAGE.EXPANSION);
  assert.equal(stageOf({ changed: { count: 5, familyCount: 3, obviousness: 80 }, momentum: 90, asset }), STAGE.CROWDED);
  // Crowded funding pulls a half-public move into the crowded stage.
  assert.equal(
    stageOf({ changed: { count: 4, familyCount: 3, obviousness: 58 }, momentum: 70, asset: { ...asset, derivatives: { fundingPct8h: 0.02 } } }),
    STAGE.CROWDED,
  );
});

test('Early Research Candidate is exactly Stage 1-2 AND opportunity > 75 AND risk < 60', () => {
  assert.deepEqual(EARLY_CANDIDATE, { stages: [1, 2], minOpportunity: 75, maxRisk: 60 });

  const base = {
    asset: quietAsset(),
    changed: { count: 4, familyCount: 3, obviousness: 10, earliness: 90, simultaneous: true, summary: 's', changes: [] },
  };
  const make = (opportunity, risk, stageChanged) => classify({
    ...base,
    changed: stageChanged ?? base.changed,
    pre: { score: opportunity, band: 'CONFIRMED', bandLabel: 'CONFIRMAT', confidence: 90, factors: [], missing: [] },
    risk: { score: risk, level: 'MINIM', top: [], invalidators: [] },
  });

  assert.equal(make(80, 30).earlyResearchCandidate, true, 'all three conditions met');
  assert.equal(make(75, 30).earlyResearchCandidate, false, 'the threshold is strictly greater than 75');
  assert.equal(make(80, 60).earlyResearchCandidate, false, 'the threshold is strictly less than 60');
  assert.equal(make(80, 59.9).earlyResearchCandidate, true);
  // A move that is already public fails on stage alone, whatever the score says.
  const crowded = { count: 6, familyCount: 4, obviousness: 85, earliness: 15, simultaneous: true, summary: 's', changes: [] };
  const late = make(95, 10, crowded);
  assert.equal(late.stage, STAGE.CROWDED);
  assert.equal(late.earlyResearchCandidate, false, 'a crowded move is never an early candidate');
  assert.ok(late.verdict.includes('DESFĂȘURARE') || late.verdict.includes('desfășurare'), late.verdict);

  // An unmeasurable score is never a candidate, and says so.
  const unknown = make(null, 10);
  assert.equal(unknown.earlyResearchCandidate, false);
  assert.match(unknown.verdict, /DATE INSUFICIENTE/);
});

test('answering the question needs both the candidate test and real simultaneity', () => {
  const pre = { score: 82, band: 'CONFIRMED', bandLabel: 'CONFIRMAT', confidence: 90, factors: [], missing: [] };
  const risk = { score: 20, level: 'MINIM', top: [], invalidators: [] };
  const wide = classify({ asset: quietAsset(), pre, risk, changed: { count: 4, familyCount: 3, obviousness: 10, earliness: 90, simultaneous: true, summary: '', changes: [] } });
  const narrow = classify({ asset: quietAsset(), pre, risk, changed: { count: 2, familyCount: 1, obviousness: 10, earliness: 90, simultaneous: false, summary: '', changes: [] } });
  assert.equal(wide.answersQuestion, true);
  assert.equal(narrow.earlyResearchCandidate, true, 'still a candidate by the three conditions');
  assert.equal(narrow.answersQuestion, false, 'but not an answer to a question that asks for simultaneity');
  assert.match(wide.verdict, /simultan/);
  assert.doesNotMatch(narrow.verdict, /s-au schimbat simultan/, 'a single-family candidate is not described as simultaneous');
  const thin = classify({ asset: quietAsset(), pre: { ...pre, confidence: 50 }, risk, changed: { count: 2, familyCount: 1, obviousness: 10, earliness: 90, simultaneous: false, summary: '', changes: [] } });
  assert.equal(thin.earlyResearchCandidate, true, 'half-measured is still a candidate: UNKNOWN is not bearish');
  assert.match(thin.verdict, /date parțiale/, 'but the verdict says the picture is partial');
});

test('ranking puts candidates first, then prefers the finding nobody has seen yet', () => {
  const row = (symbol, verdict, confluence = 1) => ({ asset: { symbol }, verdict, changed: { confluence } });
  const ranked = rankCandidates([
    row('LOUD', { earlyResearchCandidate: false, opportunity: 92, earliness: 10, confidence: 95 }),
    row('QUIET', { earlyResearchCandidate: false, opportunity: 78, earliness: 95, confidence: 95 }),
    row('CAND', { earlyResearchCandidate: true, opportunity: 76, earliness: 60, confidence: 80 }),
  ]);
  assert.equal(ranked[0].asset.symbol, 'CAND', 'a confirmed candidate outranks everything');
  assert.equal(ranked[1].asset.symbol, 'QUIET', 'a lower score that is still invisible beats a higher one everyone sees');

  const withAnswer = rankCandidates([
    row('SINGLE', { earlyResearchCandidate: true, answersQuestion: false, opportunity: 90, earliness: 100, confidence: 95 }),
    row('ANSWER', { earlyResearchCandidate: true, answersQuestion: true, opportunity: 77, earliness: 70, confidence: 80 }),
  ]);
  assert.equal(withAnswer[0].asset.symbol, 'ANSWER', 'the exact answer to the question comes before a single-family candidate');
});

/* ─────────────────────────── prescreen: who gets the deep-research budget ────────────────────── */

test('the prescreen ranks events by confluence and earliness, and ignores standing conditions', async () => {
  const { prescreenScore, prescreenPicks, STATE_DETECTORS } = await import('../../src/domain/discovery/prescreen.js');
  const ev = (key, family, weight = 1, magnitude = 2) => ({ key, family, weight, magnitude });

  assert.equal(prescreenScore(null), 0);
  assert.equal(prescreenScore({ changes: [], earliness: 90 }), 0);
  // A standing condition alone is not a reason to spend the budget.
  assert.ok(STATE_DETECTORS.has('SUPPLY_RELIEF'));
  assert.equal(prescreenScore({ changes: [ev('SUPPLY_RELIEF', 'FUNDAMENTALS', 0.5, 1)], earliness: 100 }), 0);

  const one = prescreenScore({ changes: [ev('VOLUME_EXPANSION', 'FLOW')], earliness: 100 });
  const broad = prescreenScore({ changes: [ev('VOLUME_EXPANSION', 'FLOW'), ev('OI_BUILDUP', 'DERIVATIVES', 0.8)], earliness: 100 });
  const obvious = prescreenScore({ changes: [ev('VOLUME_EXPANSION', 'FLOW'), ev('OI_BUILDUP', 'DERIVATIVES', 0.8)], earliness: 20 });
  assert.ok(broad > one, 'two families beat one');
  assert.ok(obvious < broad, 'the same changes, already public, rank lower');
  assert.ok(obvious > 0, 'but an obvious move is damped, not discarded');

  const picks = prescreenPicks([{ key: 'a', score: 0 }, { key: 'b', score: 2 }, { key: 'c', score: 5 }, { key: 'd', score: 1 }], 2);
  assert.deepEqual(picks, ['c', 'b']);
  assert.deepEqual(prescreenPicks([{ key: 'a', score: 3 }], 0), []);
});

test('standing conditions are context, never counted as changes', async () => {
  const { whatChanged, CONDITION_KEYS } = await import('../../src/domain/discovery/changes.js');
  assert.deepEqual([...CONDITION_KEYS].sort(), ['NARRATIVE_MOMENTUM', 'SUPPLY_RELIEF']);
  const n = (value, z = null, changePct = null, extra = {}) => ({ value, z, changePct, n: 8, median: value, ...extra });
  const quietCmp = Object.fromEntries(['volume24h', 'turnover', 'liquidityUsd', 'holders', 'top10Pct', 'oiUsd', 'tvl', 'devCommits30d', 'mentions7d', 'cexBalancePct'].map((k) => [k, n(1, 0, 0)]));
  // Nothing moved; the float is mostly circulating and the sector is hot.
  const asset = { market: { change: { d7: 1, d30: 2 } }, risk: { supply: { floatRatio: 0.8, unlockWithin30d: false } }, narrative: { label: 'AI', score: 80 }, derived: { turnover: 0.05 } };

  const still = whatChanged({ asset, cmp: quietCmp });
  assert.equal(still.count, 0, 'a project in which nothing moved has no changes');
  assert.equal(still.familyCount, 0);
  assert.deepEqual(still.conditions.map((c) => c.key).sort(), ['NARRATIVE_MOMENTUM', 'SUPPLY_RELIEF']);
  assert.equal(still.confluence, 0);

  // Two real changes plus a condition are two changes — not "three things at once".
  const moving = whatChanged({
    asset: { ...asset, derived: { turnover: 0.3 } },
    cmp: { ...quietCmp, volume24h: n(5e6, 3.2, 180), turnover: n(0.3, 2.8, 150), liquidityUsd: n(4e5, null, 40) },
  });
  assert.deepEqual(moving.changes.map((c) => c.key).sort(), ['LIQUIDITY_GROWTH', 'TURNOVER_JUMP', 'VOLUME_EXPANSION']);
  assert.equal(moving.count, 3);
  assert.equal(moving.simultaneous, true, 'three events in two families');
  const twoOnly = whatChanged({ asset, cmp: { ...quietCmp, volume24h: n(5e6, 3.2, 180), liquidityUsd: n(4e5, null, 40) } });
  assert.equal(twoOnly.count, 2);
  assert.equal(twoOnly.simultaneous, false, 'the two conditions do not top two events up to three');
});
