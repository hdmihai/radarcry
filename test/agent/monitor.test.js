/**
 * The agent end to end, offline: the simulated repository (three weeks of runs with two incidents
 * and the commits that fixed them) over the research state of a real fixture scan. The agent learns
 * from that history on its first pass, starts a scan GitHub skipped, quotes the fix that worked last
 * time, resolves the incident with the commit that ended it, scores its forecast ledger, keeps its
 * summary bound to the facts, and never publishes a key.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFixtureDays, ROOT } from '../fixture-run.js';
import { createFixturePorts } from '../../agent/adapters/fixtures.js';
import { analyze, act, narrate, runAll } from '../../agent/application/monitor.js';
import { loadAgentConfig } from '../../agent/main.js';
import { GATES } from '../../agent/domain/gates.js';
import { validateSchema } from '../../src/adapters/outbound/publishing/schema-validator.js';

const H = 3_600_000;
const D = 24 * H;
let fx;
let schema;
let snapAt;
const temps = [];

before(async () => {
  fx = await runFixtureDays({ days: 2 });
  schema = JSON.parse(await readFile(join(ROOT, 'schema', 'agent.schema.json'), 'utf8'));
  snapAt = Date.parse(fx.snapshots.at(-1).meta.generatedAt);
});
after(async () => {
  await fx?.cleanup();
  for (const d of temps) await rm(d, { recursive: true, force: true });
});

async function setup({ scenario = {}, nowMs = snapAt + H, cfgPatch = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cri-agent-'));
  temps.push(dir);
  const cfg = await loadAgentConfig(ROOT);
  cfg.mode = 'demo';
  cfgPatch?.(cfg);
  const clock = { t: nowMs, now() { return this.t; } };
  const ports = createFixturePorts({ anchorMs: snapAt + H, clock, stateDir: fx.stateDir, dataDir: fx.outDir, memoryDir: join(dir, 'mem'), reportDir: join(dir, 'report'), scenario });
  return { dir, cfg, clock, ports, limits: { scanMaxMinutes: 22, topN: 1000 }, logger: { info() {}, warn() {}, debug() {} } };
}

test('first pass: every gate evaluated, the contract holds, and the visible history is learned at once', async () => {
  const s = await setup();
  const { report, narrate: should } = await analyze({ ports: s.ports, cfg: s.cfg, nowMs: s.clock.t, limits: s.limits, logger: s.logger });
  assert.deepEqual(validateSchema(report, schema), [], 'agent.json respects schema/agent.schema.json');
  assert.equal(report.gates.length, GATES.length);
  assert.equal(report.mode, 'demo');
  assert.ok(report.learning.learnedThisRun.runs > 100, `runs imported from the history: ${report.learning.learnedThisRun.runs}`);
  assert.ok(report.learning.learnedThisRun.incidentsFromHistory >= 3, 'the two incidents of the simulated weeks are reconstructed');
  const lessons = report.incidents.resolved.filter((i) => i.resolvedBy?.sha);
  assert.ok(lessons.some((i) => /permisiuni contents: write/.test(i.resolvedBy.message)), 'the state-branch failure is known to be fixed by the permissions commit');
  assert.ok(lessons.some((i) => /CoinGlass/.test(i.resolvedBy.message)), 'the paid-host failure is known to be fixed by removing the CoinGlass call');
  assert.ok(report.norms.some((n) => n.metric === 'wf.scan.durationMin' && n.status !== 'LEARNING'), 'scan durations already have a norm');
  const by = Object.fromEntries(report.gates.map((g) => [g.id, g]));
  assert.equal(by['ci.free'].status, 'PASS');
  assert.equal(by['scan.validity'].status, 'PASS');
  assert.equal(by['scan.forecast'].status, 'PASS', by['scan.forecast'].evidence);
  assert.equal(by['scan.secrets'].status, 'PASS');
  assert.equal(by['cad.scan'].status, 'WARN', 'the simulated scheduler delivers about half the scans');
  assert.ok(report.efficiency.effective > 0 && report.efficiency.effective < report.efficiency.design);
  assert.equal(should, true, 'a first report is narrated');
  assert.equal(report.narrative.by, 'template');
  assert.ok(report.calibration.created?.rows > 0, 'the first weekly cohort of forecasts is recorded');
});

test('self-heal: a skipped scan is started once, seen running, and the daily limit holds', async () => {
  const s = await setup({ scenario: { silentAfter: snapAt + H } });
  let started = 0;
  for (let h = 0; h <= 30; h += 1) {
    s.clock.t = snapAt + H + h * H;
    await runAll({ ports: s.ports, cfg: s.cfg, nowMs: s.clock.t, limits: s.limits, logger: s.logger });
    started = s.ports.inspect.dispatched.filter((d) => d.file === 'scan-and-deploy.yml').length;
  }
  assert.ok(started >= 3, `the quiet scheduler is filled in (${started} scans started in 30 h)`);
  const dispatched = s.ports.inspect.dispatched.filter((d) => d.file === 'scan-and-deploy.yml').map((d) => Date.parse(d.at));
  for (let i = 1; i < dispatched.length; i += 1) assert.ok(dispatched[i] - dispatched[i - 1] >= 4.5 * H - 1, 'never two scans closer than the gap');
  const inADay = dispatched.filter((t) => t > s.clock.t - D).length;
  assert.ok(inADay <= s.cfg.heal.scan.maxPerDay, `daily limit (${inADay})`);
  const mem = JSON.parse(await readFile(join(s.dir, 'mem', 'memory.json'), 'utf8'));
  assert.ok(mem.actions.every((a) => a.kind === 'dispatch' && ['scan-and-deploy.yml', 'pulse.yml'].includes(a.workflow)), 'dispatch is the only action');
});

test('an incident: quoted with the fix that worked last time, healing stops after two failures, resolved by the next fix', async () => {
  const downFrom = snapAt + 2 * H;
  const fixAt = snapAt + 30 * H;
  const s = await setup({ scenario: { silentAfter: snapAt + H, scanDownFrom: downFrom, scanDownUntil: fixAt, extraCommits: [{ t: fixAt, msg: 'ci: redă permisiunea de scriere pe cri-state' }] } });
  let failing = null;
  for (let h = 0; h <= 28; h += 1) {
    s.clock.t = snapAt + H + h * H;
    const { report } = await runAll({ ports: s.ports, cfg: s.cfg, nowMs: s.clock.t, limits: s.limits, logger: s.logger });
    const f = report.findings.find((x) => x.id === 'scan.run');
    if (f) failing = f;
  }
  assert.ok(failing, 'the failed scan is a finding');
  assert.equal(failing.signature, 'PUSH_DENIED');
  assert.match(failing.lesson?.lastFix?.message ?? '', /permisiuni contents: write/, 'the remedy that worked last time is quoted');
  const scansAfterDown = s.ports.inspect.dispatched.filter((d) => d.file === 'scan-and-deploy.yml' && Date.parse(d.at) > downFrom);
  assert.ok(scansAfterDown.length <= 2, `no third scan into a known failure (${scansAfterDown.length})`);
  // The fix lands; the next scan passes; the incident is resolved with that commit.
  s.clock.t = fixAt + 40 * 60_000;
  const { report } = await runAll({ ports: s.ports, cfg: s.cfg, nowMs: s.clock.t, limits: s.limits, logger: s.logger });
  const resolved = report.incidents.resolved.find((i) => i.gate === 'scan.run' && /redă permisiunea/.test(i.resolvedBy?.message ?? ''));
  assert.ok(resolved, 'resolved by the commit that landed while it was open');
  assert.equal(report.gates.find((g) => g.id === 'scan.run').status, 'PASS');
});

test('the summary: a local model guarded number by number, or the template with the reason', async () => {
  const s = await setup();
  await analyze({ ports: s.ports, cfg: s.cfg, nowMs: s.clock.t, limits: s.limits, logger: s.logger });
  // A model that writes only from the facts it is given (the prompt carries them as JSON).
  const factsOf = (prompt) => JSON.parse(prompt.slice(prompt.indexOf('\n') + 1, prompt.indexOf('\n\n')));
  const good = { id: 'fake', model: 'model-test', available: async () => true, generate: async ({ prompt }) => { const f = factsOf(prompt); return { ok: true, status: 'OK', data: `- Stare: atenționare, ${f.porti.PASS} porți trecute și ${f.porti.WARN} atenționări.\n- Eficiența efectivă este ${f.eficienta.efectiva}%.` }; } };
  const n1 = await narrate({ ports: { ...s.ports, narrator: good }, nowMs: s.clock.t, cfg: s.cfg, logger: s.logger });
  assert.equal(n1.narrative.by, 'llm');
  assert.equal(n1.report.gates.find((g) => g.id === 'agent.narrator').status, 'PASS');
  assert.match(n1.narrative.text, new RegExp(`${n1.report.summary.counts.PASS} porți trecute`), 'the summary counts what the screen shows');
  const liar = { ...good, generate: async ({ prompt }) => ({ ok: true, status: 'OK', data: `- Stare: perfectă, ${factsOf(prompt).porti.PASS + 7} porți trecute, eficiență 99.9%; cumpărați.` }) };
  const n2 = await narrate({ ports: { ...s.ports, narrator: liar }, nowMs: s.clock.t, cfg: s.cfg, logger: s.logger });
  assert.equal(n2.narrative.by, 'template');
  assert.match(n2.narrative.reason, /garda a respins/);
  assert.equal(n2.report.gates.find((g) => g.id === 'agent.narrator').status, 'WARN');
  assert.ok(n2.report.findings.some((f) => f.id === 'agent.narrator'), 'a rejected summary is a finding');
  assert.match(n2.narrative.text, new RegExp(`${n2.report.summary.counts.PASS} de porți trecute|${n2.report.summary.counts.PASS} porți trecute`), 'the template counts the published state');
  const down = { ...good, available: async () => false };
  const n3 = await narrate({ ports: { ...s.ports, narrator: down }, nowMs: s.clock.t, cfg: s.cfg, logger: s.logger });
  assert.match(n3.narrative.reason, /nu este disponibil/);
});

test('calibration: a project that runs 25× after its forecast is a dated hit in the ledger', async () => {
  const universe = JSON.parse(await readFile(join(fx.outDir, 'universe.json'), 'utf8'));
  const f = universe.assets.fields;
  const row = universe.assets.rows.find((r) => r[f.indexOf('valid')] === 'V' && String(r[f.indexOf('key')]).startsWith('cg:') && Number.isFinite(r[f.indexOf('fc100')]));
  const id = String(row[f.indexOf('key')]).slice(3);
  const s = await setup({ scenario: { pump: { id, multiple: 25, fromMs: snapAt + 3 * D } } });
  await analyze({ ports: s.ports, cfg: s.cfg, nowMs: s.clock.t, limits: s.limits, logger: s.logger });
  s.clock.t = snapAt + 4 * D;
  const { report } = await analyze({ ports: s.ports, cfg: s.cfg, nowMs: s.clock.t, limits: s.limits, logger: s.logger });
  assert.equal(report.calibration.cohorts, 1, 'one cohort a week');
  assert.equal(report.calibration.interim['20'].observed, 1);
  assert.equal(report.calibration.hits[0].key, `cg:${id}`);
  assert.ok(report.calibration.hits[0].multiple >= 25);
});

test('a key in a published file fails the gate, and a report carrying one is never published', async () => {
  const state = await mkdtemp(join(tmpdir(), 'cri-agent-leak-'));
  temps.push(state);
  await cp(fx.outDir, state, { recursive: true });
  const summary = JSON.parse(await readFile(join(state, 'summary.json'), 'utf8'));
  summary.note = 'rpc https://mainnet.helius-rpc.com/?api-key=0123456789abcdef0123456789abcdef';
  await writeFile(join(state, 'summary.json'), JSON.stringify(summary));
  const s = await setup();
  const ports = createFixturePorts({ anchorMs: snapAt + H, clock: s.clock, stateDir: fx.stateDir, dataDir: state, memoryDir: join(s.dir, 'mem2'), reportDir: join(s.dir, 'report2') });
  // The leaked file is the data dir's summary; the snapshot itself is clean.
  const { report } = await analyze({ ports: { ...ports, state: { ...ports.state, published: async () => ({ ok: true, status: 'OK', data: [{ name: 'summary.json', text: JSON.stringify(summary) }] }) } }, cfg: s.cfg, nowMs: s.clock.t, limits: s.limits, logger: s.logger });
  const g = report.gates.find((x) => x.id === 'scan.secrets');
  assert.equal(g.status, 'FAIL');
  assert.equal(JSON.stringify(report).includes('0123456789abcdef0123456789abcdef'), false, 'the report names the file and the pattern, never the key');
  // A report that would carry a key is refused.
  const bad = { ...ports, memory: { ...ports.memory, publish: ports.memory.publish } };
  await assert.rejects(
    act({ ports: { ...bad, memory: { ...bad.memory, lastReport: async () => ({ ...report, findings: [{ id: 'x', title: 't', status: 'FAIL', severity: 'critical', evidence: 'https://x.io/?apikey=AAAAAAAAAAAAAAAAAAAAAAAA' }] }) } }, nowMs: s.clock.t, cfg: s.cfg, logger: s.logger }),
    /tipar de cheie/,
  );
});

test('the rolling issue opens for serious findings and closes when they clear', async () => {
  const s = await setup({ scenario: { disabled: ['scan-and-deploy.yml'] } });
  await runAll({ ports: s.ports, cfg: s.cfg, nowMs: s.clock.t, limits: s.limits, logger: s.logger });
  assert.equal(s.ports.inspect.issues.length, 1);
  assert.equal(s.ports.inspect.issues[0].state, 'open');
  assert.match(s.ports.inspect.issues[0].body, /cri-agent/);
  assert.match(s.ports.inspect.issues[0].body, /dezactivat/i);
  const healthy = await setup();
  healthy.ports.inspect.issues.push({ number: 1, title: 't', body: '<!-- cri-agent -->', state: 'open' });
  healthy.cfg.issues.minSeverity = 'critical';
  await runAll({ ports: healthy.ports, cfg: healthy.cfg, nowMs: healthy.clock.t, limits: healthy.limits, logger: healthy.logger });
  assert.equal(healthy.ports.inspect.issues[0].state, 'closed', 'nothing critical: the issue is closed');
});
