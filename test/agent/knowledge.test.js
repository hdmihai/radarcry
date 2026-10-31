/**
 * The agent's written knowledge and its self-evaluation: how identification efficiency is measured on
 * the radar's own history (forward, point in time, against the universe of the same scans), how the
 * fundamental rules judge it and the forecast, how the rulebook lives in memory, and how the agent
 * scores its own predictions against naive forecasters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../fixture-run.js';
import { bestTier, decodeDiscovery, identificationEfficiency, wilson } from '../../agent/domain/identification.js';
import { evaluateRules, recordRuleHistory, rememberRulebook, ruleTrends, rulebookHash, validateRulebook } from '../../agent/domain/rules.js';
import { bandCoverage, coderRecord, predictNext, scorePending, selfEvalSummary, stepSelfEval } from '../../agent/domain/selfeval.js';
import { GATES, DERIVED_GATES, evaluateGates } from '../../agent/domain/gates.js';

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.parse('2026-10-01T00:00:00Z');

/**
 * A synthetic radar history: 60 projects scanned every 6 hours for 20 days. A third of them are in
 * the early band (opportunity 65, Stage 2) and rise 30% two days after each scan; the rest drift.
 */
function syntheticDiscovery({ early = 20, rest = 40, lateRunners = false } = {}) {
  const assets = {};
  const scans = Array.from({ length: 80 }, (_, i) => T0 + i * 6 * H);
  for (let a = 0; a < early + rest; a += 1) {
    const isEarly = a < early;
    const p = [];
    scans.forEach((t, i) => {
      // Early projects: a 25% step every 12 scans (3 days) — a +20% hit within 72 h of most scans.
      const price = isEarly ? 1 * 1.25 ** Math.floor(i / 12) : 1 + 0.01 * Math.sin(i + a);
      const stage = isEarly ? 2 : a % 3 === 0 ? 3 : a % 2;
      const opp = isEarly ? 65 : 30 + (a % 20);
      p.push([Math.floor(t / 1000), [price, 1e7], [stage, opp, 40, 80, 70, 2, isEarly ? 2 : 1]]);
    });
    if (lateRunners && a >= early && a % 3 === 0) p.forEach((x, i) => (x[1][0] = 1.3 ** Math.floor(i / 8)));
    assets[`cg:p${a}`] = { l: p.at(-1)[0], p };
  }
  return { metrics: ['price', 'marketCap'], verdict: ['stage', 'opportunity', 'risk', 'earliness', 'confidence', 'changes', 'families'], assets };
}

test('identification: forward hit rates per tier against the universe of the same scans, point in time', () => {
  const series = decodeDiscovery(syntheticDiscovery());
  assert.equal(series.size, 60);
  const nowMs = T0 + 80 * 6 * H;
  const e = identificationEfficiency(series, { nowMs, horizonH: 72, threshold: 0.2, windowDays: 30 });
  assert.ok(e.observations > 2000 && e.scans > 50, `${e.observations} observations, ${e.scans} scans`);
  const t = Object.fromEntries(e.tiers.map((x) => [x.id, x]));
  assert.ok(t.EARLY.ready && t.EARLY.lift > 2.5, `the early band beats the universe (lift ${t.EARLY.lift})`);
  assert.ok(t.EARLY.loPct <= t.EARLY.ratePct && t.EARLY.ratePct <= t.EARLY.hiPct, 'Wilson interval around the rate');
  assert.equal(t.IGNORE.hits, 0, 'drifting projects never hit');
  assert.equal(t.EARLY.recallPct, 100, 'every move came from the early band');
  assert.equal(t.EARLY.episodes, 20, 'an episode per project, however many scans repeat it');
  // No look-ahead: the last 72 h of scans have no completed horizon and are not observations.
  const lastObs = Date.parse(e.to);
  assert.ok(lastObs <= nowMs - 72 * H, 'observations end one horizon before now');
  // Recommendations never pick a late or an ignored tier.
  assert.equal(bestTier(e)?.id === 'STAGE3', false);
  const w = wilson(0, 10);
  assert.equal(w.lo, 0);
  assert.ok(w.hi > 0.1 && w.hi < 0.3);
  assert.deepEqual(wilson(1, 0), { lo: null, hi: null });
});

test('identification: an empty or missing history is learning, never a verdict', () => {
  const e = identificationEfficiency(new Map(), { nowMs: T0 });
  assert.equal(e.observations, 0);
  assert.equal(e.baseRatePct, null);
  assert.ok(e.tiers.every((t) => !t.ready && t.lift === null));
  assert.equal(decodeDiscovery(null).size, 0);
});

async function book() {
  return JSON.parse(await readFile(join(ROOT, 'agent', 'knowledge', 'rules.json'), 'utf8'));
}

test('the rulebook: every rule well-formed with a known check, versioned, fingerprinted', async () => {
  const b = await book();
  assert.deepEqual(validateRulebook(b), []);
  assert.ok(b.rules.length >= 20);
  for (const area of ['principiu', 'identificare', 'prognoză', 'monitorizare']) assert.ok(b.rules.some((r) => r.area === area), area);
  assert.match(rulebookHash(b), /^[0-9a-f]{8}$/);
  const edited = { ...b, rules: b.rules.map((r) => (r.id === 'ID-1' ? { ...r, check: { ...r.check, min: 1.4 } } : r)) };
  assert.notEqual(rulebookHash(edited), rulebookHash(b), 'a changed threshold changes the fingerprint');
  assert.deepEqual(validateRulebook({ rules: [{ id: 'X', area: 'principiu', title: 't', rule: 'r', check: { type: 'nope' } }] }), ['X: verificare necunoscută „nope”']);
  // In memory: loaded once, every change of the rules recorded with its time.
  let k = rememberRulebook(null, b, '2026-10-01T00:00:00Z');
  assert.equal(k.changes.length, 1);
  k = rememberRulebook(k, b, '2026-10-02T00:00:00Z');
  assert.equal(k.changes.length, 1, 'the same rules are not a change');
  k = rememberRulebook(k, { ...edited, version: '1.0.1' }, '2026-10-03T00:00:00Z');
  assert.equal(k.changes.length, 2);
  assert.equal(k.changes.at(-1).from, b.version);
  assert.equal(k.version, '1.0.1');
});

test('rules: identification judged with intervals; the business definition is never changed, only recommended', async () => {
  const b = await book();
  const series = decodeDiscovery(syntheticDiscovery({ lateRunners: true }));
  const nowMs = T0 + 80 * 6 * H;
  const identification = { short: identificationEfficiency(series, { nowMs, horizonH: 72, threshold: 0.2 }), medium: identificationEfficiency(series, { nowMs, horizonH: 168, threshold: 0.3 }) };
  const r = evaluateRules(b, { identification, gates: [] });
  const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
  assert.equal(by['ID-1'].status, 'PASS', by['ID-1'].evidence);
  assert.equal(by['ID-2'].status, 'PASS', 'Stage 2 is the early band here');
  assert.equal(by['ID-4'].status, 'FAIL', 'late projects that keep running make the "late" label wrong');
  assert.match(by['ID-4'].recommendation, /stadiul 3/);
  // The verdict (opportunity > 75) never fires here: recall 0, and the recommendation names the
  // measured variant, without changing the definition.
  assert.equal(by['ID-5'].status, 'WARN');
  assert.match(by['ID-5'].recommendation, /decizia rămâne a proprietarului \(P-5\)/);
  assert.doesNotMatch(by['ID-5'].recommendation, /Stage 3/, 'the late stage is never recommended as the answer');
  assert.ok(r.recommendations.some((x) => x.id === 'ID-5'));
  // Without any history, nothing is judged: learning, never a failure.
  const empty = evaluateRules(b, { identification: { short: identificationEfficiency(new Map(), { nowMs }), medium: identificationEfficiency(new Map(), { nowMs }) } });
  for (const id of ['ID-1', 'ID-2', 'ID-3', 'ID-4', 'ID-5']) assert.equal(empty.results.find((x) => x.id === id).status, 'LEARNING', id);
  for (const id of ['FC-1', 'FC-2', 'FC-3', 'FC-7']) assert.equal(empty.results.find((x) => x.id === id).status, 'UNKNOWN', `${id}: no forecast → unknown`);
});

test('rules: the forecast criteria — event, no look-ahead, plausible rate, out-of-sample skill, calibration', async () => {
  const b = await book();
  const forecast = {
    event: 'prețul atinge cel puțin N× prețul din ziua citirii, în următoarele 365 de zile',
    baseRates: [
      { multiple: 100, pct: 0.21, annualPct: 0.58, annualLo: 0.3, annualHi: 1.1, qualifyingDaysMean: 131, qualifyingMeasured: 4, population: 998, events: 6 },
      { multiple: 20, pct: 0.5, annualPct: 1.6 },
    ],
    winners: [
      { symbol: 'LAB', status: 'CONFIRMED', anchorAt: '2026-04-12', low: { at: '2026-04-12' } },
      { symbol: 'BTW', status: 'CONFIRMED', anchorAt: '2026-07-08', low: { at: '2026-07-08' } },
      { symbol: 'PYXL', status: 'CONFIRMED', anchorAt: '2026-06-11', low: { at: '2026-06-11' } },
    ],
    model: { identification: { 20: { target: 20, n: 13, ready: true, recallTop20: 61.5, medianPercentile: 85 } }, fingerprintOff: {}, minLooWinners: 8 },
  };
  const calibration = { predictions: 900, cohorts: 3, interim: { 20: { observed: 4, expected: 3.6, ratio: 1.1, lower: 0.4, upper: 2.6 } }, matured: false };
  const by = (f) => Object.fromEntries(evaluateRules(b, f).results.map((x) => [x.id, x]));
  let r = by({ forecast, calibration });
  for (const id of ['FC-1', 'FC-2', 'FC-3', 'FC-4', 'FC-5', 'FC-7']) assert.equal(r[id].status, 'PASS', `${id}: ${r[id].evidence}`);
  assert.equal(r['FC-6'].status, 'LEARNING', 'Brier waits for maturity');
  r = by({ forecast: { ...forecast, winners: [{ symbol: 'X', status: 'CONFIRMED', anchorAt: '2026-05-02', low: { at: '2026-05-01' } }] } });
  assert.equal(r['FC-2'].status, 'FAIL', 'a fingerprint after the low is look-ahead');
  r = by({ forecast: { ...forecast, event: undefined } });
  assert.equal(r['FC-1'].status, 'WARN', 'a forecast that does not state its event');
  r = by({ forecast: { ...forecast, baseRates: [{ multiple: 100, pct: 3, annualPct: 9 }] } });
  assert.equal(r['FC-3'].status, 'WARN');
  r = by({ forecast: { ...forecast, model: { ...forecast.model, identification: { 20: { target: 20, n: 13, ready: true, recallTop20: 15 } }, fingerprintOff: { 20: 'x' } } } });
  assert.equal(r['FC-4'].status, 'WARN');
  assert.match(r['FC-4'].evidence, /oprit singur ajustarea/);
  r = by({ forecast, calibration: { ...calibration, interim: { 20: { observed: 0, expected: 6, ratio: 0, lower: 0, upper: 0.5 } } } });
  assert.equal(r['FC-5'].status, 'WARN', 'fewer runs than the forecast implied');
});

test('rule history: one point per run, trends and the last change of verdict', () => {
  let h = {};
  const ev = (status, value) => ({ results: [{ id: 'ID-1', status, value }] });
  h = recordRuleHistory(h, ev('LEARNING', null), 1);
  h = recordRuleHistory(h, ev('PASS', '×2.26'), 2);
  h = recordRuleHistory(h, ev('PASS', '×2.31'), 3);
  assert.deepEqual(h['ID-1'], [[1, 'L', null], [2, 'P', 2.26], [3, 'P', 2.31]]);
  const [t] = ruleTrends(h, ev('PASS'));
  assert.equal(t.runs, 3);
  assert.equal(t.by.PASS, 2);
  assert.deepEqual(t.values, [2.26, 2.31]);
  assert.equal(t.changedAt, new Date(2).toISOString());
});

test('self-evaluation: prequential Brier against persistence and climatology, pooled transitions, a learning curve', () => {
  // Gate A passes always; gate B alternates every run (GitHub's skipped pulse); gate C fails always.
  const results = (i) => [
    { id: 'a', status: 'PASS' },
    { id: 'b', status: i % 2 ? 'WARN' : 'PASS' },
    { id: 'c', status: 'FAIL' },
    { id: 'u', status: 'UNKNOWN' },
    { id: 'agent.learning', status: 'PASS' },
  ];
  let st = null;
  for (let i = 0; i < 60; i += 1) st = stepSelfEval(st, { results: results(i), nowMs: T0 + i * H }, { curveWindow: 20 }).state;
  const s = selfEvalSummary(st, { curveWindow: 20 });
  assert.equal(s.runsScored, 59);
  assert.equal(s.predictions, 59 * 3, 'unknown outcomes and the self-evaluation gate are never scored');
  assert.ok(s.changes >= 50, 'the alternating gate changes state every run');
  assert.equal(s.comparable, true);
  assert.ok(s.skill > 0.5, `learning the alternation beats "like last time" (skill ${s.skill})`);
  assert.ok(s.brier < s.brierClimatology, 'and the plain frequency');
  assert.equal(s.curve.length, 2);
  assert.ok(s.curve.at(-1).brier < s.curve[0].brier, 'the error falls with experience');
  const p = predictNext(st.codes);
  assert.equal(p.b.now, 'W', 'the last run (59) warned');
  assert.ok(p.b.p < 0.2, `after a warning, the alternating gate is expected to pass (${p.b.p})`);
  assert.ok(p.a.p < 0.05 && p.c.p > 0.9);
  // A world where nothing changes: persistence cannot be beaten, so the agent is compared with the
  // frequency instead (never a false alarm).
  let quiet = null;
  for (let i = 0; i < 30; i += 1) quiet = stepSelfEval(quiet, { results: [{ id: 'a', status: 'PASS' }, { id: 'c', status: 'WARN' }], nowMs: T0 + i * H }).state;
  const q = selfEvalSummary(quiet);
  assert.equal(q.changes, 0);
  assert.equal(q.comparable, false);
  assert.ok(q.skillVsClimatology > 0, `the learned chain still beats the plain frequency (${q.skillVsClimatology})`);
  assert.equal(scorePending(null, {}), null);
});

test('self-evaluation: norm bands are checked on new values; the code proposals have a track record', () => {
  const before = { m: Array.from({ length: 20 }, (_, i) => [i, 10 + (i % 5)]) };
  const after = { m: [...before.m, [20, 12], [21, 50]] };
  assert.deepEqual(bandCoverage(before, after), { n: 2, inside: 1 });
  assert.deepEqual(bandCoverage({ m: before.m.slice(0, 3) }, after), { n: 0, inside: 0 }, 'a norm still learning is not checked');
  const rec = coderRecord([{ number: 1, state: 'closed', merged: true }, { number: 2, state: 'closed', merged: false }, { number: 3, state: 'open', merged: false }]);
  assert.equal(rec.proposals, 3);
  assert.equal(rec.acceptancePct, 50);
  assert.equal(coderRecord(null), null);
});

test('derived gates: identification, rules and learning are evaluated in a second pass, after the rules', async () => {
  const b = await book();
  const obs = { nowIso: new Date(T0).toISOString(), workflows: {}, snapshot: null };
  const first = evaluateGates(obs, {});
  for (const id of DERIVED_GATES) assert.equal(first.find((g) => g.id === id).status, 'UNKNOWN', `${id} waits for the rules`);
  const series = decodeDiscovery(syntheticDiscovery());
  const nowMs = T0 + 80 * 6 * H;
  const identification = { short: identificationEfficiency(series, { nowMs, horizonH: 72, threshold: 0.2 }), medium: identificationEfficiency(series, { nowMs, horizonH: 168, threshold: 0.3 }) };
  const rules = evaluateRules(b, { identification, gates: first });
  const second = evaluateGates(obs, { rules, identification, knowledge: rememberRulebook(null, b, obs.nowIso), selfEval: selfEvalSummary(null) }, { only: DERIVED_GATES });
  assert.equal(second.length, DERIVED_GATES.length);
  const by = Object.fromEntries(second.map((g) => [g.id, g]));
  assert.equal(by['agent.rules'].status, 'PASS');
  assert.match(by['agent.rules'].value, /^v1\.\d+\.\d+ · \d+ reguli$/);
  assert.equal(by['agent.learning'].status, 'LEARNING');
  assert.ok(['PASS', 'WARN'].includes(by['model.identification'].status));
  assert.match(by['model.identification'].evidence, /ID-1 trecut/);
  assert.ok(GATES.some((g) => g.id === 'model.identification' && g.group === 'model'));
  // A missing rulebook is a warning of its own, not a crash.
  const none = evaluateGates(obs, { rules: evaluateRules(null, {}) }, { only: ['agent.rules'] });
  assert.equal(none[0].status, 'WARN');
});
