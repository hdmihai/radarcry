/**
 * The agent's domain: what a schedule promises, what was delivered, how norms are learned and
 * judged, how incidents teach their fixes, how the forecast ledger is scored, how efficiency against
 * a professional desk is measured, when the agent may start a workflow, and the guard that keeps the
 * language model's summary bound to the facts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadenceOf, fireTimes, lastFireBefore, parseCron } from '../../agent/domain/cron.js';
import { flakiness, observedCadence, reliability } from '../../agent/domain/cadence.js';
import { appendPoint, assess, describe } from '../../agent/domain/norms.js';
import { poissonInterval, robustZ } from '../../agent/domain/stats.js';
import { efficiency, freshnessValue } from '../../agent/domain/efficiency.js';
import { healPlan } from '../../agent/domain/heal.js';
import { classify } from '../../agent/domain/signatures.js';
import { buildFindings, failureStreaks, knownStreak, lessonsFor, mergeReplay, updateIncidents } from '../../agent/domain/incidents.js';
import { calibrationSummary, makeCohort, observePrices, pruneCohorts, weekId } from '../../agent/domain/calibration.js';
import { allowedNumbers, guardNarrative, nr, numbersIn, templateNarrative } from '../../agent/domain/narrative.js';
import { GATES, STATUS, evaluateGates, summarize } from '../../agent/domain/gates.js';

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.parse('2026-10-31T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

test('cron: the promise is computed exactly, for every shape this project uses', () => {
  assert.equal(cadenceOf('17 */4 * * *').perDay, 6);
  assert.equal(cadenceOf('7,22,37,52 * * * *').perDay, 96);
  assert.ok(Math.abs(cadenceOf('41 6 * * 1').perDay - 52 / 365) < 1e-9, 'weekly');
  assert.ok(Math.abs(cadenceOf('23 4 1 * *').perDay - 12 / 365) < 1e-9, 'monthly');
  assert.equal(cadenceOf('0 9-17/2 * * 1-5').perYear, 5 * 261, 'ranges with steps, weekdays (2026 has 261 weekdays)');
  assert.throws(() => parseCron('* * * *'), /5 câmpuri/);
  assert.throws(() => parseCron('61 * * * *'), /invalid/);
  const times = fireTimes('17 */4 * * *', Date.parse('2026-10-31T00:00:00Z'), Date.parse('2026-11-01T00:00:00Z'));
  assert.deepEqual(times.map((t) => iso(t).slice(11, 16)), ['00:17', '04:17', '08:17', '12:17', '16:17', '20:17']);
  assert.equal(iso(lastFireBefore('41 6 * * 1', NOW)), '2026-10-26T06:41:00.000Z', 'last Monday 06:41');
});

const run = (t, extra = {}) => ({ id: t, createdAt: iso(t), updatedAt: iso(t + 10 * 60_000), status: 'completed', conclusion: 'success', event: 'schedule', headSha: 'a', ...extra });

test('cadence: delivered runs per day against the promise, gaps, reliability, transient failures', () => {
  // Three runs a day for a week against a 4-hourly cron.
  const runs = [];
  for (let d = 0; d < 7; d += 1) for (const h of [6, 15, 21]) runs.push(run(NOW - d * D - (24 - h) * H));
  const c = observedCadence(runs, { nowMs: NOW, windowDays: 7, cron: '17 */4 * * *' });
  assert.equal(c.expectedPerDay, 6);
  assert.ok(c.perDay > 2.9 && c.perDay < 3.2, `perDay ${c.perDay}`);
  assert.ok(c.ratio > 0.48 && c.ratio < 0.54);
  assert.ok(c.maxGapHours >= 9 - 1e-9, 'the night gap');
  const two = observedCadence(runs, { nowMs: NOW, cron: ['17 */4 * * *', '47 2 * * *'] });
  assert.equal(two.expectedPerDay, 7, 'several schedules add up');
  // A young workflow is measured over its own life.
  const young = observedCadence([run(NOW - 2 * H), run(NOW - 6 * H)], { nowMs: NOW, windowDays: 7, cron: '17 */4 * * *' });
  assert.ok(young.spanDays < 0.3 && young.perDay > 6, 'not penalised for days it did not exist');

  const rel = reliability([run(NOW - H), run(NOW - 2 * H, { conclusion: 'failure' }), run(NOW - 3 * H, { conclusion: 'cancelled' })], { nowMs: NOW });
  assert.deepEqual([rel.n, rel.ok, rel.rate], [2, 1, 0.5], 'cancelled runs say nothing');
  const fl = flakiness([run(NOW - 3 * H, { conclusion: 'failure', headSha: 'x' }), run(NOW - 2 * H, { headSha: 'x' }), run(NOW - H, { headSha: 'y', attempt: 2 })]);
  assert.deepEqual([fl.transient, fl.reruns], [1, 1]);
});

test('norms: learning until enough points, then a robust z that one old outlier cannot move', () => {
  let s = [];
  for (let i = 0; i < 6; i += 1) s = appendPoint(s, i * H, 14 + (i % 2) * 0.5);
  assert.equal(assess(s, 30, 7 * H).status, 'LEARNING', 'six points are not a norm');
  for (let i = 6; i < 20; i += 1) s = appendPoint(s, i * H, i === 8 ? 90 : 14 + (i % 2) * 0.5);
  const normal = assess(s, 14.6, 21 * H, { direction: 'high' });
  assert.equal(normal.status, 'NORMAL');
  const high = assess(s, 30, 21 * H, { direction: 'high' });
  assert.equal(high.status, 'ANOMALY', `z = ${high.z}`);
  assert.equal(assess(s, 2, 21 * H, { direction: 'high' }).status, 'NORMAL', 'a low duration is not a problem for a high-side norm');
  // Only points before the value count: a value is never its own norm.
  assert.equal(assess(appendPoint(s, 21 * H, 30), 30, 21 * H, { direction: 'high' }).status, 'ANOMALY');
  // A constant count: a small change is not infinitely surprising.
  const flat = Array.from({ length: 10 }, (_, i) => [i, 1000]);
  assert.equal(assess(flat, 998, 11).status, 'NORMAL');
  assert.equal(assess(flat, 600, 11, { direction: 'low' }).status, 'ANOMALY');
  assert.equal(describe(s).n, 20);
  assert.equal(appendPoint(Array.from({ length: 5 }, (_, i) => [i, i]), 9, 9, 3).length, 3, 'bounded');
  assert.ok(Math.abs(robustZ(3, [1, 2, 3, 4, 5]).z) < 1);
});

test('poisson interval: exact bounds for rare counts', () => {
  const z = poissonInterval(0, 0.9);
  assert.equal(z.lower, 0);
  assert.ok(Math.abs(z.upper - 2.9957) < 0.01, `upper(0) ${z.upper}`);
  const five = poissonInterval(5, 0.9);
  assert.ok(Math.abs(five.lower - 1.9701) < 0.01 && Math.abs(five.upper - 10.5130) < 0.01, JSON.stringify(five));
});

test('signatures: known failures are named with their remedy', () => {
  assert.equal(classify('remote: Permission to a/b.git denied to github-actions[bot].').code, 'PUSH_DENIED');
  assert.equal(classify(['x', 'src/a.js apelează open-api.coinglass.com, care nu este pe lista de surse aprobate']).code, 'UNAPPROVED_HOST');
  assert.equal(classify('HTTP 429 Too Many Requests').code, 'RATE_LIMIT');
  assert.equal(classify('Settings → Pages: GitHub Pages nu este activat').code, 'PAGES_SETTINGS');
  assert.equal(classify('nothing to see'), null);
});

test('incidents: opened, escalated, resolved with the commit that fixed them, and quoted next time', () => {
  const gate = (status, extra = {}) => ({ id: 'scan.run', title: 'Ultima scanare live a reușit', status, severity: status === 'FAIL' ? 'critical' : status === 'WARN' ? 'warning' : null, evidence: 'e', signature: 'PUSH_DENIED', ...extra });
  let mem = { incidents: [], fixes: {} };
  let u = updateIncidents(mem, [gate('WARN')], { nowIso: iso(NOW) });
  assert.equal(u.opened.length, 1);
  mem = u;
  u = updateIncidents(mem, [gate('FAIL')], { nowIso: iso(NOW + H) });
  const inc = u.incidents.find((x) => x.gate === 'scan.run');
  assert.deepEqual([inc.count, inc.severity, inc.worst], [2, 'critical', 'FAIL'], 'same incident, escalated');
  mem = u;
  const commits = [{ sha: 'abc1234def', message: 'ci: permisiuni contents: write\n\ncorp', at: iso(NOW + 1.5 * H) }];
  u = updateIncidents(mem, [gate('PASS')], { nowIso: iso(NOW + 2 * H), commits });
  assert.equal(u.resolved.length, 1);
  assert.equal(u.resolved[0].resolvedBy.sha, 'abc1234def');
  assert.equal(u.resolved[0].resolvedBy.message, 'ci: permisiuni contents: write');
  assert.ok(u.fixes['sig:PUSH_DENIED']?.length, 'filed under the signature too');
  // The same failure kind on another gate later: the lesson is quoted.
  const lesson = lessonsFor(u.fixes, 'scan.contract', 'PUSH_DENIED');
  assert.equal(lesson.lastFix.sha, 'abc1234def');
  const f = buildFindings([gate('FAIL', { id: 'scan.contract', title: 'Contract' })], u);
  assert.equal(f[0].lesson.lastFix.sha, 'abc1234def');
  // UNKNOWN never resolves an incident; a pass with no commit in between is transient.
  mem = updateIncidents({ incidents: [], fixes: {} }, [gate('WARN')], { nowIso: iso(NOW) });
  assert.equal(updateIncidents(mem, [gate('UNKNOWN')], { nowIso: iso(NOW + H) }).resolved.length, 0);
  const t = updateIncidents(mem, [gate('PASS')], { nowIso: iso(NOW + H), commits: [] });
  assert.equal(t.resolved[0].resolvedBy.transient, true);
  assert.equal(lessonsFor(t.fixes, 'scan.run').transient, 1);
});

test('history replay: past failure streaks become resolved incidents with the commit that ended them', () => {
  const runs = [
    run(NOW - 10 * H, { headSha: 'a', message: 'A' }),
    run(NOW - 9 * H, { headSha: 'a', conclusion: 'failure', id: 'f1' }),
    run(NOW - 8 * H, { headSha: 'a', conclusion: 'failure', id: 'f2' }),
    run(NOW - 7 * H, { headSha: 'b', message: 'fix: B\nbody' }),
    run(NOW - 5 * H, { headSha: 'b', conclusion: 'failure' }),
    run(NOW - 4 * H, { headSha: 'b' }),
    run(NOW - H, { headSha: 'b', conclusion: 'failure' }),
  ];
  const s = failureStreaks(runs);
  assert.equal(s.length, 3);
  assert.deepEqual([s[0].count, s[0].resolvedBy.sha, s[0].resolvedBy.message], [2, 'b', 'fix: B']);
  assert.equal(s[1].resolvedBy.transient, true, 'same commit: transient');
  assert.equal(s[2].open, true, 'still failing: left to the live check');
  const m = mergeReplay({ incidents: [], fixes: {} }, [{ gate: 'scan.run', title: 'S', streak: s[0], signature: 'PUSH_DENIED' }]);
  assert.equal(m.incidents[0].status, 'resolved');
  assert.equal(m.fixes['sig:PUSH_DENIED'][0].sha, 'b');
  assert.equal(knownStreak(m.incidents, 'scan.run', s[0]), true, 'never replayed twice');
  assert.equal(knownStreak(m.incidents, 'ci.run', s[0]), false);
});

test('calibration: weekly cohorts, highest price tracked, hits dated, Brier against the base rate at maturity', () => {
  assert.equal(weekId(Date.parse('2026-10-31T12:00:00Z')), '2026-W44');
  assert.equal(weekId(Date.parse('2026-01-01T00:00:00Z')), '2026-W01');
  assert.equal(weekId(Date.parse('2027-01-01T00:00:00Z')), '2026-W53');
  const rows = [
    { key: 'cg:a', symbol: 'A', fc100: 2, fc20: 10, price: 1 },
    { key: 'cg:b', symbol: 'B', fc100: 0.5, fc20: 2, price: 1 },
    { key: 'cg:c', symbol: 'C', fc100: 0.4, fc20: 1.5, price: 1 },
    { key: 'cg:x', symbol: 'X', fc100: null, fc20: 1, price: 1 },
  ];
  let c = makeCohort({ at: iso(NOW), horizonDays: 365, base: { p100: 0.6, p20: 2 }, rows });
  assert.equal(c.rows.length, 3, 'a project without a forecast is not recorded');
  assert.equal(c.rows[0][2], 0.02, 'percent stored as a fraction');
  c = observePrices(c, new Map([['cg:a', { price: 18, high24h: 25 }], ['cg:b', { price: 1.2 }]]), NOW + 30 * D).cohort;
  c = observePrices(c, new Map([['cg:a', { price: 9 }]]), NOW + 40 * D).cohort;
  assert.equal(c.rows.find((r) => r[0] === 'cg:a')[5], 25, 'the 24-hour high counts, and the maximum never falls');
  const mid = calibrationSummary([c], NOW + 40 * D);
  assert.equal(mid.interim['20'].observed, 1);
  assert.ok(mid.interim['20'].expected > 0 && mid.interim['20'].expected < 0.2);
  assert.equal(mid.hits[0].symbol, 'A');
  // After the horizon: prices no longer count, Brier is computed against the base rate.
  const late = observePrices(c, new Map([['cg:b', { price: 500 }]]), NOW + 400 * D);
  assert.equal(late.updated, 0);
  const mature = calibrationSummary([c], NOW + 366 * D);
  assert.equal(mature.matured, 1);
  assert.ok(Number.isFinite(mature.brier['20']) && Number.isFinite(mature.brierBase['20']) && Number.isFinite(mature.skill['20']));
  // Pruned cohorts keep their sums.
  const p = pruneCohorts([c], NOW + 500 * D, 430, null);
  assert.equal(p.cohorts.length, 0);
  assert.equal(calibrationSummary(p.cohorts, NOW + 500 * D, p.archive).brier['20'], mature.brier['20']);
});

test('efficiency: capability × delivered freshness × reliability, with the levers ranked', () => {
  assert.equal(freshnessValue(0, 24), 1);
  assert.ok(Math.abs(freshnessValue(4, 24) - 0.944) < 0.001);
  assert.ok(freshnessValue(8, 24) < freshnessValue(4, 24));
  const e = efficiency({ parity: { permanent: 87, withKeys: 92.6, achieved: 81.8 }, scan: { expectedPerDay: 6, perDay: 3 }, pulse: { expectedPerDay: 96, perDay: 5 }, reliability: { rate: 0.96, n: 25 } });
  assert.ok(e.design > e.effective);
  assert.ok(e.freshness.promised > e.freshness.observed);
  assert.equal(e.levers[0].id, 'keys', 'the biggest loss first');
  assert.ok(e.effective > 50 && e.effective < 81.8);
  assert.equal(efficiency({ parity: null, scan: null, pulse: null, reliability: null }).effective, null, 'nothing measured, nothing claimed');
});

test('heal: start a skipped scan only when it is overdue, idle, within limits, not failing, not over quota', () => {
  const scanRuns = [run(NOW - 6 * H)];
  const base = { nowMs: NOW, scan: { file: 'scan.yml', runs: scanRuns }, pulse: { file: 'pulse.yml', runs: [run(NOW - 3 * H)] } };
  const p = healPlan(base);
  assert.deepEqual(p.actions.map((a) => a.workflow), ['scan.yml'], 'a starting scan holds the pulse back');
  assert.match(p.skipped.find((s) => s.workflow === 'pulse.yml').reason, /scanare/);
  assert.equal(healPlan({ ...base, scan: { file: 'scan.yml', runs: [run(NOW - 2 * H)] } }).actions.filter((a) => a.workflow === 'scan.yml').length, 0, 'not overdue');
  assert.equal(healPlan({ ...base, scan: { file: 'scan.yml', runs: [run(NOW - 6 * H), { ...run(NOW - H), status: 'queued', conclusion: null }] } }).actions.length, 0, 'one is queued');
  assert.equal(healPlan({ ...base, scan: { file: 'scan.yml', runs: [run(NOW - 6 * H, { conclusion: 'failure' }), run(NOW - 7 * H, { conclusion: 'failure' })] } }).actions.filter((a) => a.workflow === 'scan.yml').length, 0, 'two failures in a row: a person must look');
  const used = Array.from({ length: 4 }, (_, i) => ({ kind: 'dispatch', workflow: 'scan.yml', ok: true, at: iso(NOW - i * H) }));
  assert.equal(healPlan({ ...base, actions: used }).actions.filter((a) => a.workflow === 'scan.yml').length, 0, 'daily limit');
  assert.equal(healPlan({ ...base, quota: [{ projectedShare: 92 }] }).actions.filter((a) => a.workflow === 'scan.yml').length, 0, 'quota pressure');
  assert.equal(healPlan({ ...base, cfg: { enabled: false } }).actions.length, 0);
  const pulseOnly = healPlan({ ...base, scan: { file: 'scan.yml', runs: [run(NOW - 2 * H)] } });
  assert.deepEqual(pulseOnly.actions.map((a) => a.workflow), ['pulse.yml']);
});

test('narrative guard: every number must come from the facts; trading language and links are refused', () => {
  const facts = { stare: 'WARN', porti: { PASS: 28, WARN: 3 }, eficienta: { efectiva: 68.6, design: 87.6 }, probleme: [{ dovada: '27 rulări în 6.54 zile = 4.13/zi față de 6/zi' }] };
  assert.ok(allowedNumbers(facts).has(4.13));
  assert.deepEqual(numbersIn('- 1) Stare: 28 de porți, 68,6%, rulat la 2026-10-31T09:04Z, commit abc1234').map((n) => n.token), ['28', '68,6']);
  assert.equal(guardNarrative('- Stare: atenționare, 28 de porți trecute și 3 atenționări.\n- Eficiență efectivă 68,6% față de 87.6% (design); scanarea rulează 4.13/zi din 6/zi.', facts).ok, true);
  const invented = guardNarrative('- Stare: atenționare, 28 de porți trecute și 5 atenționări; eficiența va crește la 95% în 3 zile.', facts);
  assert.equal(invented.ok, false);
  assert.match(invented.reasons.join(' '), /5|95/);
  assert.equal(guardNarrative('- Stare: atenționare cu 28 de porți trecute. Cumpărați acum, profitul este garantat pentru operator.', facts).ok, false);
  assert.equal(guardNarrative('- Stare: atenționare; detalii la https://exemplu.ro pentru cele 28 de porți ale proiectului.', facts).ok, false);
  assert.equal(nr(3, 'porți'), '3 porți');
  assert.equal(nr(28, 'porți'), '28 de porți');
  assert.equal(nr(101, 'porți'), '101 porți');
  assert.equal(nr(200, 'porți'), '200 de porți');
});

test('gates: the catalogue evaluates from observations, unknown is never bad, and the template states the verdict', () => {
  const obs = {
    nowMs: NOW,
    nowIso: iso(NOW),
    repo: { defaultBranch: 'main', lastCommitAt: iso(NOW - 2 * D) },
    workflows: {
      ci: { runs: [run(NOW - D)], runsOk: true, latest: run(NOW - D, { message: 'm' }), jobs: [{ name: 'test (22)', steps: [{ name: 'Syntax + tests (x)', conclusion: 'success' }, { name: 'Offline DEMO scan, contract', conclusion: 'success' }] }], annotations: [], gateReport: { groups: { syntax: { pass: 10, fail: 0 }, 'arch.free': { pass: 1, fail: 1 } }, failures: [{ group: 'arch.free', name: 'adapters only reach hosts on the approved free-source list', message: 'x.js apelează api.coinglass.com, care nu este pe lista de surse aprobate' }] }, state: 'active', name: 'CI' },
      // Every 8 hours for a week: half of what the 4-hourly cron promises.
      scan: { runs: Array.from({ length: 21 }, (_, i) => run(NOW - 3 * H - i * 8 * H)), runsOk: true, latest: run(NOW - 3 * H), lastSuccess: run(NOW - 3 * H), jobs: [], annotations: [], cron: '17 */4 * * *', cadence: { warnBelow: 0.75, failBelow: 0.4 }, state: 'active', name: 'Scan & deploy' },
    },
    snapshot: { generatedAt: iso(NOW - 3 * H), durationMs: 14 * 60_000, coverage: [{ key: 'coingecko', label: 'CG', required: true, ok: true }], providers: [{ id: 'cg', status: 'OK', failures: 0 }], quota: [{ label: 'CG', projectedShare: 81 }], validity: { valid: 10, pending: 1, rejected: 2 }, eligible: 13, rejectedInLists: 0, universe: { coingecko: 1000, eligible: 13 } },
    stateMeta: { lastRunAt: iso(NOW - 3 * H), runs: 5 },
    pages: null,
    secrets: { files: 3, leaks: [] },
  };
  const results = evaluateGates(obs, { limits: { scanMaxMinutes: 22, topN: 1000 }, expectedIntervalHours: { scan: 4 } });
  assert.equal(results.length, GATES.length);
  const by = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(by['ci.syntax'].status, STATUS.PASS);
  assert.equal(by['ci.free'].status, STATUS.FAIL);
  assert.equal(by['ci.free'].signature, 'UNAPPROVED_HOST');
  assert.equal(by['scan.quota'].status, STATUS.WARN, '81% of a free plan, projected');
  assert.equal(by['scan.validity'].status, STATUS.PASS);
  assert.equal(by['scan.pages'].status, STATUS.UNKNOWN, 'not checked is not failed');
  assert.equal(by['scan.forecast'].status, STATUS.UNKNOWN);
  assert.equal(by['cad.scan'].status, STATUS.WARN);
  const leak = evaluateGates({ ...obs, secrets: { files: 1, leaks: [{ file: 'latest.json', pattern: 'url-key' }] } }, {});
  assert.equal(leak.find((r) => r.id === 'scan.secrets').status, STATUS.FAIL);
  const s = summarize(results);
  assert.equal(s.overall, STATUS.FAIL);
  const text = templateNarrative({ overall: s.overall, summary: s, findings: buildFindings(results, { incidents: [], fixes: {} }), efficiency: null, learning: null, calibration: null, actions: [] });
  assert.match(text, /eșuat/);
  assert.match(text, /Prioritatea 1 \(critic\)/);
});
