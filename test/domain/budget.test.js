/**
 * The free-plan budget, the risk engine and the parity benchmark — the three places where the
 * project makes a claim about itself that has to be checkable.
 *
 * The quota ledger is what keeps "no subscription of any kind" true in practice: a free plan that
 * runs out mid-month turns a research tool into a broken one, so the gate pauses a provider before
 * its allowance is spent rather than after.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAUSE_AT, createLedgerGate, periodKeys, quotaPlan, recordUsage, rollLedger } from '../../src/domain/budget/quota.js';
import { RISK_CATEGORY, SEVERITY, riskEngine } from '../../src/domain/risk/risk-engine.js';
import { supplyPressure } from '../../src/domain/risk/supply.js';
import { CAPABILITIES, STATUS, parity } from '../../src/domain/benchmark/parity.js';
import { COHORT, HORIZONS, familyPerformance, openEntry, qualifiesForCohort, scoreEntries, trackRecord } from '../../src/domain/backtest/journal.js';
import { altseasonIndex } from '../../src/domain/market/altseason.js';
import { QUALITY, QUALITY_WEIGHT, coverageReport, weightedScore } from '../../src/domain/quality/data-quality.js';

const DAY = 86_400_000;
const JUN15 = Date.parse('2026-06-15T12:00:00Z');

const LIMITS = {
  coingecko: { label: 'CoinGecko Demo', month: 10_000, keyed: true },
  goplus: { label: 'GoPlus Free', month: 150_000, day: 30_000 },
  youtube: { label: 'YouTube', day: 10_000, keyed: true },
};

/* ─────────────────────────── quota ledger ─────────────────────────────────────────────────────── */

test('the ledger resets exactly when the providers do', () => {
  const stored = {
    coingecko: { month: '2026-05', day: '2026-05-31', monthUnits: 9_000, dayUnits: 400, monthCalls: 9_000, dayCalls: 400 },
    goplus: { month: '2026-06', day: '2026-06-14', monthUnits: 50_000, dayUnits: 9_000, monthCalls: 100, dayCalls: 20 },
  };
  const rolled = rollLedger(stored, JUN15);
  const k = periodKeys(JUN15);
  assert.equal(k.month, '2026-06');
  assert.equal(k.day, '2026-06-15');
  assert.equal(rolled.coingecko.monthUnits, 0, 'a new month resets the monthly counter');
  assert.equal(rolled.coingecko.dayUnits, 0);
  assert.equal(rolled.goplus.monthUnits, 50_000, 'the same month keeps its counter');
  assert.equal(rolled.goplus.dayUnits, 0, 'a new day resets the daily counter only');
});

test('usage is recorded in the units each plan actually bills', () => {
  let l = recordUsage({}, 'goplus', 150, JUN15);
  l = recordUsage(l, 'goplus', 150, JUN15);
  assert.equal(l.goplus.monthUnits, 300, 'compute units, not calls');
  assert.equal(l.goplus.monthCalls, 2);
  l = recordUsage(l, 'coingecko', 1, JUN15);
  assert.equal(l.coingecko.monthUnits, 1);
});

test('a provider is paused at 95 % of any of its limits, before the plan is spent', () => {
  assert.equal(PAUSE_AT, 0.95);
  const nearMonthly = { coingecko: { month: '2026-06', day: '2026-06-15', monthUnits: 9_500, dayUnits: 10 } };
  const plan = quotaPlan(nearMonthly, LIMITS, JUN15, { keyed: { coingecko: true, youtube: true } });
  assert.equal(plan.providers.coingecko.paused, true);
  assert.ok(plan.paused.includes('coingecko'));
  assert.match(plan.providers.coingecko.reason, /95%/);
  assert.equal(plan.providers.coingecko.remainingMonth, 500, 'the headroom is reported, not hidden');

  // A daily limit pauses just as hard as a monthly one.
  const nearDaily = { goplus: { month: '2026-06', day: '2026-06-15', monthUnits: 1_000, dayUnits: 28_600 } };
  assert.equal(quotaPlan(nearDaily, LIMITS, JUN15).providers.goplus.paused, true);
});

test('a provider without its key consumes nothing and is never paused', () => {
  const plan = quotaPlan({ youtube: { month: '2026-06', day: '2026-06-15', dayUnits: 9_900 } }, LIMITS, JUN15, { keyed: { youtube: false } });
  assert.equal(plan.providers.youtube.configured, false);
  assert.equal(plan.providers.youtube.paused, false, 'a provider we never call cannot exhaust its plan');
});

test('the burn rate is projected to the end of the month and warned about early', () => {
  // Half the month gone, 70 % of the allowance used: at this pace the month ends over the limit.
  const plan = quotaPlan(
    { coingecko: { month: '2026-06', day: '2026-06-15', monthUnits: 7_000, dayUnits: 100, since: '2026-06-01' } },
    LIMITS, JUN15, { keyed: { coingecko: true } },
  );
  assert.ok(plan.providers.coingecko.projectedShare > 1, 'the projection exceeds the limit');
  assert.ok(plan.warnings.some((w) => w.includes('CoinGecko')), plan.warnings.join('|'));
});

test('the live gate refuses the call that would cross the threshold, mid-run', () => {
  const ledger = { coingecko: { month: '2026-06', day: '2026-06-15', monthUnits: 9_400, dayUnits: 0 } };
  const plan = quotaPlan(ledger, LIMITS, JUN15, { keyed: { coingecko: true } });
  const gate = createLedgerGate(plan, { limits: LIMITS, ledger, nowMs: JUN15 });

  assert.equal(gate.check('coingecko', 1).allow, true, 'below the threshold the call goes ahead');
  // Burn through the remaining headroom inside this run.
  for (let i = 0; i < 120; i += 1) gate.charge('coingecko', 1);
  const verdict = gate.check('coingecko', 1);
  assert.equal(verdict.allow, false, 'the gate stops the provider during the run, not after it');
  assert.match(verdict.reason, /pauză/);
  assert.ok(gate.paused().includes('coingecko'));
  assert.equal(gate.runUnits().coingecko, 120, 'what this run consumed is reported separately');
  assert.ok(gate.ledger().coingecko.monthUnits >= 9_520, 'the ledger carries the new total forward');

  // A provider with no declared limit is never gated: public endpoints have no plan to exhaust.
  assert.equal(gate.check('dexscreener', 99).allow, true);
});

/* ─────────────────────────── data quality ────────────────────────────────────────────────────── */

test('a stale reading keeps its score but loses confidence, while a missing one is redistributed', () => {
  // The two halves of "UNKNOWN is not bearish", checked against each other. A STALE factor is real
  // data measured late: it still contributes its score. An UNKNOWN factor contributes nothing and
  // leaves the denominator, so the remaining factors keep their relative weight.
  const base = [
    { key: 'a', label: 'A', weight: 50, score: 80, quality: QUALITY.HIGH },
    { key: 'b', label: 'B', weight: 50, score: 80, quality: QUALITY.HIGH },
  ];
  const allFresh = weightedScore(base);
  assert.equal(allFresh.score, 80);
  assert.equal(allFresh.confidence, 100);

  const oneStale = weightedScore([base[0], { ...base[1], quality: QUALITY.STALE }]);
  assert.equal(oneStale.score, 80, 'a late reading is still a reading — the score does not move');
  assert.ok(oneStale.confidence < allFresh.confidence, 'but it is trusted less');
  assert.equal(oneStale.confidence, Math.round((1 + QUALITY_WEIGHT.STALE) / 2 * 100));

  const oneMissing = weightedScore([base[0], { ...base[1], score: null, quality: QUALITY.UNKNOWN }]);
  assert.equal(oneMissing.score, 80, 'the measured half is not dragged down by the unmeasured half');
  assert.equal(oneMissing.coverage, 0.5);
  assert.equal(oneMissing.confidence, 50, 'half the evidence arrived, so half the confidence');
  assert.deepEqual(oneMissing.missing.map((m) => m.key), ['b']);
  assert.equal(oneMissing.redistributed, true);
});

test('the quota gate refuses to build without an explicit clock', () => {
  // A gate that silently read Date.now() would roll the ledger's day and month buckets against a
  // different moment than the rest of the run, which is exactly the bug a replay cannot reproduce.
  assert.throws(() => createLedgerGate({}, { limits: {}, ledger: {} }), /nowMs/);
});

test('source coverage names what is missing instead of degrading quietly', () => {
  const r = coverageReport([
    { key: 'a', label: 'A', required: true, ok: true },
    { key: 'b', label: 'B', required: true, ok: false, status: 'TIMEOUT' },
    { key: 'c', label: 'C', required: false, ok: false, status: 'NOT_CONFIGURED' },
  ]);
  assert.equal(r.okCount, 1);
  assert.equal(r.degraded, true);
  assert.deepEqual(r.requiredMissing.map((x) => x.key), ['b']);
});

/* ─────────────────────────── risk engine ─────────────────────────────────────────────────────── */

const bareAsset = () => ({
  symbol: 'T',
  market: { marketCap: 30e6, volume24h: 2e6, change: { h24: 1, d7: 2 } },
  derived: { turnover: 0.06 },
  onchain: {},
  quality: { flags: [] },
  baseline: { points: 20 },
  risk: {},
});

test('every invalidator says what it would falsify and where to watch it', () => {
  const r = riskEngine({ asset: bareAsset(), market: { regime: { state: 'NEUTRAL' } }, changed: {} });
  assert.ok(r.invalidators.length > 0);
  for (const i of r.invalidators) {
    assert.ok(i.label && i.label.length > 5, 'an invalidator is named');
    assert.ok(i.invalidates && i.invalidates.length > 5, `${i.key} says what it falsifies`);
    assert.ok(i.watch && i.watch.length > 3, `${i.key} says where it is watched`);
    assert.ok(Object.values(RISK_CATEGORY).includes(i.category), `${i.key} has a known category`);
    assert.ok(Object.values(SEVERITY).includes(i.severity));
  }
  assert.match(r.note, /nu o opinie/);
});

test('contract-level dangers dominate the risk score, and the thesis-killer is critical', () => {
  const honeypot = riskEngine({
    asset: { ...bareAsset(), onchain: { security: { isHoneypot: true, lpLockedPct: 90 } } },
    market: {}, changed: {},
  });
  assert.ok(honeypot.score >= 60, `honeypot risk ${honeypot.score}`);
  assert.equal(honeypot.invalidators[0].severity, SEVERITY.CRITICAL);
  assert.equal(honeypot.level, honeypot.score >= 75 ? 'CRITIC' : 'RIDICAT');

  // A treasury selling into the very signal we detected is the single most invalidating event.
  const selling = riskEngine({
    asset: { ...bareAsset(), onchain: { flows: { flags: ['TEAM_TO_CEX'] }, security: { isHoneypot: false } } },
    market: {},
    changed: { simultaneous: true },
  });
  assert.ok(selling.invalidators.some((i) => i.key === 'TEAM_SELLING_INTO_STRENGTH' && i.severity === SEVERITY.CRITICAL));
});

test('a missing measurement is a data risk, never a verdict on the asset', () => {
  const r = riskEngine({ asset: bareAsset(), market: {}, changed: {} });
  const noScan = r.invalidators.find((i) => i.key === 'NO_SECURITY_SCAN');
  assert.ok(noScan, 'an unscanned contract is reported');
  assert.equal(noScan.category, RISK_CATEGORY.DATA);
  assert.match(noScan.invalidates, /nu înseamnă că nu există/);

  // Data risks are discounted relative to real ones: an unscanned clean token must not look worse
  // than a scanned dangerous one.
  const dangerous = riskEngine({
    asset: { ...bareAsset(), onchain: { security: { isHoneypot: false, isMintable: true, canTakeBackOwnership: true, lpLockedPct: 10 } } },
    market: {}, changed: {},
  });
  assert.ok(dangerous.score > r.score, `${dangerous.score} (scanned, dangerous) vs ${r.score} (unscanned)`);
});

test('supply pressure is derived honestly when the unlock calendar is not free', () => {
  const asset = { market: { circulating: 2e8, total: 1e9, max: 1e9, marketCap: 2e7, fdv: 1e8 }, listing: {} };
  const s = supplyPressure({ asset, points: [], unlocks: [], nowMs: JUN15 });
  assert.equal(s.floatRatio, 0.2);
  assert.equal(s.fdvToMcap, 5);
  assert.ok(s.warnings.some((w) => w.includes('nu este disponibil gratuit')), 'the gap is stated, not papered over');
  assert.ok(s.inflationPctYear >= 0, 'emission is never reported as a negative rate');

  // An operator-entered unlock inside 30 days is a dated fact and is treated as one.
  const dated = supplyPressure({
    asset,
    points: [],
    unlocks: [{ at: new Date(JUN15 + 9 * DAY).toISOString(), pctOfSupply: 6, note: 'team' }],
    nowMs: JUN15,
  });
  assert.equal(dated.unlockWithin30d, true);
  assert.equal(dated.unlockPct30d, 6);
  assert.ok(dated.nextUnlock.inDays > 8 && dated.nextUnlock.inDays < 10);

  // A shrinking circulating supply is burn or re-locking, not negative inflation.
  const shrinking = supplyPressure({
    asset,
    points: [
      { at: JUN15 - 30 * DAY, metrics: { circulating: 2.2e8 } },
      { at: JUN15, metrics: { circulating: 2e8 } },
    ],
    unlocks: [],
    nowMs: JUN15,
  });
  assert.equal(shrinking.inflationPctYear, 0);
  assert.match(shrinking.inflationBasis, /ardere sau re-blocare/);
});

/* ─────────────────────────── parity benchmark ─────────────────────────────────────────────────── */

test('parity is computed from a weighted matrix and reports permanent and keyed separately', () => {
  const none = parity({ keys: {} });
  const withKeys = parity({ keys: { arkham: true, cryptoquant: true, nodereal: true, youtube: true, github: true, coinalyze: true, coingecko: true, coinmarketcap: true } });
  assert.ok(none.permanent > 80, `permanent parity ${none.permanent}%`);
  assert.ok(withKeys.withKeys >= none.permanent, 'optional keys can only add');
  assert.ok(withKeys.achieved >= none.achieved);
  assert.equal(none.permanent, withKeys.permanent, 'the permanent figure does not depend on keys');
  assert.ok(none.capabilities.length >= 25);
  assert.equal(none.totalWeight, CAPABILITIES.reduce((s, c) => s + c.weight, 0));
  assert.match(none.note, /nu estimată/);

  // Every capability states how it is covered, and the gaps are listed rather than hidden.
  for (const c of none.capabilities) {
    assert.ok(c.how && c.how.length > 5, `${c.key} says how it is covered`);
    assert.ok(Object.values(STATUS).includes(c.resolvedStatus));
  }
  assert.ok(none.gaps.length > 0, 'the uncovered capabilities are named');
  assert.ok(none.gaps.some((g) => g.status === STATUS.NOT_COVERED), 'what cannot be reproduced is admitted');
  assert.ok(none.gaps[0].weight >= none.gaps[none.gaps.length - 1].weight, 'gaps are ordered by what they cost');
});

test('a source that failed this run lowers the achieved parity, not the headline claims', () => {
  const healthy = parity({ keys: {}, liveStatus: { coingecko: true, nodereal: true, dexscreener: true, goplus: true, coinalyze: true } });
  const broken = parity({ keys: {}, liveStatus: { coingecko: false, nodereal: false, dexscreener: false, goplus: false, coinalyze: false } });
  assert.ok(broken.achieved < healthy.achieved, `${broken.achieved} vs ${healthy.achieved}`);
  assert.equal(broken.permanent, healthy.permanent, 'an outage is not a change in what the project can do');
});

/* ─────────────────────────── track record ─────────────────────────────────────────────────────── */

test('the cohort rule is the published one and is applied strictly', () => {
  assert.deepEqual(COHORT, { minStage: 2, minOpportunity: 80, maxRisk: 60 });
  assert.equal(qualifiesForCohort({ stage: 2, opportunity: 85, risk: 40 }), true);
  assert.equal(qualifiesForCohort({ stage: 2, opportunity: 80, risk: 40 }), false, 'strictly greater than 80');
  assert.equal(qualifiesForCohort({ stage: 2, opportunity: 85, risk: 60 }), false, 'strictly less than 60');
  assert.equal(qualifiesForCohort({ stage: 3, opportunity: 95, risk: 10 }), false, 'an expanded move is out of cohort');
  assert.equal(qualifiesForCohort(null), false);
});

test('entries are frozen at discovery and scored later with prices read later', () => {
  const asset = { key: 'k1', symbol: 'AAA', name: 'Alpha', market: { price: 1, marketCap: 10e6 } };
  const verdict = { stage: 2, opportunity: 88, risk: 30, confidence: 80 };
  const entry = openEntry({ asset, verdict, changed: { earliness: 80, changes: [{ key: 'VOLUME_EXPANSION' }], families: ['FLOW', 'HOLDERS'] }, risk: { score: 30, top: [{ key: 'LOW_FLOAT' }] }, nowMs: JUN15 });
  assert.equal(entry.entryPrice, 1);
  assert.deepEqual(entry.families, ['FLOW', 'HOLDERS']);

  // Before the first horizon elapses, nothing is scored.
  const early = scoreEntries({ entries: [entry], priceByKey: new Map([['k1', 1.4]]), nowMs: JUN15 + 3 * DAY });
  assert.deepEqual(early[0].outcomes, {});

  // At +7 days the entry is scored against the price we read then — never re-decided.
  const scored = scoreEntries({ entries: [entry], priceByKey: new Map([['k1', 1.4]]), nowMs: JUN15 + 7 * DAY, btcChangePct: { 7: 5 } });
  assert.equal(scored[0].outcomes[7].returnPct, 40);
  assert.equal(scored[0].outcomes[7].win, true);
  assert.equal(scored[0].outcomes[7].alphaPct, 35, 'the benchmark is subtracted, so the number is alpha');
  assert.equal(scored[0].closed, false, 'later horizons are still open');

  // A missing price at maturity is recorded as missing, not as a loss.
  const noPrice = scoreEntries({ entries: [entry], priceByKey: new Map(), nowMs: JUN15 + 7 * DAY });
  assert.equal(noPrice[0].outcomes[7].returnPct, null);
  assert.equal(noPrice[0].outcomes[7].win, null);
});

test('a small sample reports as a small sample, with Wilson intervals', () => {
  const base = { key: 'k', symbol: 'A', openedAtMs: JUN15 - 40 * DAY, entryPrice: 1, families: ['FLOW'], outcomes: {} };
  const entries = [
    { ...base, key: 'a', outcomes: { 7: { returnPct: 30, win: true }, 14: { returnPct: 40, win: true }, 30: { returnPct: 60, win: true } } },
    { ...base, key: 'b', outcomes: { 7: { returnPct: -5, win: false }, 14: { returnPct: 12, win: true }, 30: { returnPct: -20, win: false } } },
    { ...base, key: 'c', outcomes: { 7: { returnPct: 15, win: true }, 14: { returnPct: 2, win: false }, 30: { returnPct: 5, win: false } } },
  ];
  const r = trackRecord(entries, { nowMs: JUN15 });
  assert.deepEqual(Object.keys(r.horizons).map(Number), HORIZONS);
  const h7 = r.horizons[7];
  assert.equal(h7.n, 3);
  assert.equal(h7.wins, 2);
  assert.ok(h7.ci95.low < h7.winRate && h7.winRate < h7.ci95.high, 'the interval brackets the point estimate');
  assert.ok(h7.ci95.high - h7.ci95.low > 50, 'three samples give a very wide interval');
  assert.equal(h7.sufficient, false);
  assert.match(h7.note, /prea larg/);
  assert.match(r.note, /Nicio decizie nu este reluată/);

  const perFamily = familyPerformance(entries, 14);
  assert.equal(perFamily[0].family, 'FLOW');
  assert.equal(perFamily[0].sufficient, false, 'three samples never justify a claim about a family');
});

/* ─────────────────────────── altseason, computed locally ──────────────────────────────────────── */

test('the altseason index is recomputed from the own top 100 instead of bought', () => {
  const assets = [
    { symbol: 'BTC', name: 'Bitcoin', tags: [], market: { marketCap: 1e12, price: 60000, change: { d90: 10, d7: 1 } } },
    ...Array.from({ length: 80 }, (_, i) => ({
      symbol: `A${i}`, name: `Alt ${i}`, tags: [],
      market: { marketCap: 1e9 - i * 1e6, price: 1, change: { d90: i < 60 ? 40 : -10, d7: 1 } },
    })),
  ];
  const r = altseasonIndex(assets, { topN: 100 });
  assert.equal(r.compared, 80);
  assert.equal(r.beatingBtc, 60);
  assert.equal(r.value, 75);
  assert.equal(r.key, 'ALTSEASON', 'the public definition puts 75 % at altcoin season');
  assert.equal(r.btcChangePct, 10);
  assert.match(r.note, /calculat local/);

  // Stablecoins and wrapped assets must not be counted as outperforming alts.
  const polluted = altseasonIndex([
    ...assets,
    { symbol: 'USDT', name: 'Tether', tags: ['stablecoin'], market: { marketCap: 9e11, price: 1, change: { d90: 0, d7: 0 } } },
  ], { topN: 100 });
  assert.equal(polluted.compared, 80, 'a stablecoin is excluded from the comparison');

  // Without BTC there is nothing to compare against, and the index says so.
  const noBtc = altseasonIndex(assets.slice(1), { topN: 100 });
  assert.equal(noBtc.value, null);
  assert.equal(noBtc.key, 'UNKNOWN');
  assert.match(noBtc.note, /nu a putut fi calculat/);
});
