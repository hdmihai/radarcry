/**
 * Offline simulator of everything the agent watches: a repository whose workflows ran for three
 * weeks the way this project's really did — the 4-hour scan delivered about half the time and late,
 * the 15-minute pulse a handful of times a day, CI on every push — with two incidents and the
 * commits that fixed them, a weekly probe, the Pages site and public prices.
 *
 * Deterministic (seeded), and time-aware: every port answers as of `clock.now()`, so a test can run
 * the agent day after day over the same simulated history and watch it learn. The research state
 * and the memory are real files (the demo scan's output), read through the live file adapters.
 */
import { fireTimes } from '../domain/cron.js';
import { createMemoryFs, createStateDir } from './files.js';

const DAY = 86_400_000;
const MIN = 60_000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);

export const FIXTURE_WORKFLOWS = Object.freeze([
  { file: 'ci.yml', name: 'CI', cron: null },
  { file: 'scan-and-deploy.yml', name: 'Scan & deploy', cron: '17 */4 * * *', delivered: 0.55, delayMin: [30, 110], durMin: [13.5, 16.5] },
  { file: 'pulse.yml', name: 'Pulse', cron: '7,22,37,52 * * * *', delivered: 0.055, delayMin: [0, 40], durMin: [0.3, 0.8] },
  { file: 'probe.yml', name: 'Probe surse', cron: '41 6 * * 1', delivered: 1, delayMin: [5, 40], durMin: [1.2, 2] },
  { file: 'labels.yml', name: 'Actualizare etichete on-chain', cron: '23 4 1 * *', delivered: 1, delayMin: [5, 30], durMin: [3, 5] },
]);

const CI_STEPS = ['Set up job', 'Run actions/checkout@v7', 'Run actions/setup-node@v7', 'Syntax + tests (architecture rules, domain engines, contract, end to end)', 'Quality gates summary (read by the AI agent)', 'Offline DEMO scan, contract validation and site build', 'The pulse runs on top of the published snapshot without breaking the contract', 'Run summary', 'The committed label dataset is present and classifies'];
const SCAN_STEPS = ['Set up job', 'Run actions/checkout@v7', 'Syntax check + tests (zero dependencies, no install step, no network)', 'Restore research state from the cri-state branch', 'Full scan (live)', 'Scan (demo, simulated market)', 'Validate the published contract', 'Save research state (single-commit orphan branch)', 'Build static site', 'Run summary', 'Check that GitHub Pages publishes from Actions'];
const GATE_COUNTS = { syntax: [181, 181], 'arch.layers': [4, 4], 'arch.free': [2, 2], 'arch.research': [1, 1], 'arch.deterministic': [1, 1], 'arch.parity': [1, 1], 'arch.workflows': [1, 1], domain: [143, 143], application: [62, 62], adapters: [50, 50], scripts: [9, 9], web: [18, 18], agent: [30, 30] };

/** The commits of the simulated three weeks (days relative to the anchor), with the two incidents. */
const COMMITS = [
  { d: -20.2, msg: 'Încărcare proiect radarcry' },
  { d: -16.5, msg: 'Aplică fixes din audit: separă concurrency pulse/scan' },
  { d: -12.25, msg: 'Adaugă funding agregat din CoinGlass', ciFails: 'arch.free' },
  { d: -12.15, msg: 'Scoate apelul CoinGlass API: funding din Coinalyze (cont gratuit)' },
  { d: -9.6, msg: 'Aplică updates din orizont-1000: deep horizon 1000' },
  { d: -8.9, msg: 'ci: permisiuni contents: write pentru ramura de stare' },
  { d: -5.5, msg: 'Aplică probe fix: verdicturi ok/benign/limited/broken' },
  { d: -2.1, msg: 'Aplică validity gate: domeniu validity cu 5 checks' },
  { d: -0.4, msg: 'Aplică prognoza ≥100× și agentul AI' },
];

/**
 * @param {{anchorMs:number, clock:{now:()=>number}, stateDir:string, dataDir?:string|null, memoryDir:string, reportDir?:string,
 *          seed?:number, scenario?:{scanPushDeniedAt?:number|null, pump?:{id:string, multiple:number, fromMs:number}|null,
 *          scanDownFrom?:number|null, scanDownUntil?:number|null, silentAfter?:number|null, extraCommits?:{t:number, msg:string}[],
 *          disabled?:string[]}}} o
 */
export function createFixturePorts({ anchorMs, clock, stateDir, dataDir = null, memoryDir, reportDir, seed = 20261031, scenario = {} }) {
  const from = anchorMs - 21 * DAY;
  const to = anchorMs + 30 * DAY;
  const rnd = mulberry32(seed);
  const between = ([a, b]) => a + (b - a) * rnd();
  const runs = new Map(FIXTURE_WORKFLOWS.map((w) => [w.file, []]));
  let nextId = 9_000_000;
  const pushDeniedAt = scenario.scanPushDeniedAt === undefined ? anchorMs - 9.2 * DAY : scenario.scanPushDeniedAt;

  const add = (file, r) => {
    const run = { id: (nextId += 7), attempt: 1, ...r };
    runs.get(file).push(run);
    return run;
  };
  const extra = (scenario.extraCommits ?? []).map((c) => ({ d: (c.t - anchorMs) / DAY, msg: c.msg, ciFails: c.ciFails ?? null }));
  const commits = [...COMMITS, ...extra].sort((a, b) => a.d - b.d).map((c) => ({ ...c, t: anchorMs + c.d * DAY, sha: `${hash(`${seed}:${c.msg}`).toString(16).padStart(8, '0')}${hash(c.msg).toString(16).padStart(8, '0')}`.padEnd(40, '0') }));
  const commitAt = (t) => commits.filter((c) => c.t <= t).pop() ?? null;

  for (const c of commits) {
    add('ci.yml', { event: 'push', createdAt: c.t, durMs: between([1.1, 1.5]) * MIN, headSha: c.sha, message: c.msg, fail: c.ciFails ?? null });
    add('scan-and-deploy.yml', { event: 'push', createdAt: c.t + 2_000, durMs: between([13.5, 16.5]) * MIN, headSha: c.sha, message: c.msg, fail: c.ciFails ? 'tests' : null });
  }
  for (const w of FIXTURE_WORKFLOWS.filter((x) => x.cron)) {
    for (const t of fireTimes(w.cron, from, to, 4000)) {
      if (rnd() > w.delivered) continue;
      const at = t + between(w.delayMin) * MIN;
      // A scheduler that goes quiet (the agent's self-heal tests).
      if (scenario.silentAfter && at > scenario.silentAfter && w.file !== 'probe.yml') continue;
      const commit = commitAt(at);
      add(w.file, { event: 'schedule', createdAt: at, durMs: between(w.durMin) * MIN, headSha: commit?.sha ?? '0'.repeat(40), message: w.name, fail: null });
    }
  }
  // The incident: the state branch push was denied for a day, until the permissions commit.
  if (pushDeniedAt !== null) {
    const fixAt = anchorMs - 8.9 * DAY;
    for (const r of runs.get('scan-and-deploy.yml')) if (r.createdAt >= pushDeniedAt && r.createdAt < fixAt && r.event === 'schedule') r.fail = 'push';
  }
  const down = (t) => scenario.scanDownFrom && t >= scenario.scanDownFrom && (!scenario.scanDownUntil || t < scenario.scanDownUntil);
  for (const r of runs.get('scan-and-deploy.yml')) if (down(r.createdAt)) r.fail = 'push';
  for (const list of runs.values()) list.sort((a, b) => b.createdAt - a.createdAt);

  const iso = (t) => new Date(t).toISOString();
  /** A run as the API shows it at `now`. */
  const view = (file, r, now) => {
    const done = now >= r.createdAt + r.durMs;
    return {
      id: r.id,
      event: r.event,
      status: done ? 'completed' : r.queuedUntil && now < r.queuedUntil ? 'queued' : 'in_progress',
      conclusion: done ? (r.fail ? 'failure' : 'success') : null,
      createdAt: iso(r.createdAt),
      updatedAt: iso(done ? r.createdAt + r.durMs : now),
      startedAt: iso(r.createdAt),
      headSha: r.headSha,
      headBranch: 'main',
      message: r.message,
      attempt: r.attempt,
      url: `https://github.com/demo/cri-radar/actions/runs/${r.id}`,
      file,
    };
  };
  const findRun = (id) => {
    for (const [file, list] of runs) {
      const r = list.find((x) => x.id === id);
      if (r) return { file, r };
    }
    return null;
  };

  const ok = (data) => ({ ok: true, status: 'OK', data });
  const dispatched = [];
  const issues = [];

  const ci = {
    id: 'fixture-github',
    repo: async () => ok({ fullName: 'demo/cri-radar', defaultBranch: 'main', htmlUrl: 'https://github.com/demo/cri-radar', owner: 'demo', name: 'cri-radar' }),
    lastCommit: async () => {
      const c = commitAt(clock.now());
      return ok({ sha: c?.sha ?? null, message: c?.msg ?? '', at: c ? iso(c.t) : null });
    },
    workflows: async () => ok(FIXTURE_WORKFLOWS.map((w, i) => ({ id: 1000 + i, name: w.name, path: `.github/workflows/${w.file}`, state: (scenario.disabled ?? []).includes(w.file) ? 'disabled_inactivity' : 'active', createdAt: iso(from - DAY) }))),
    runs: async (file, perPage = 100) => {
      const now = clock.now();
      return ok((runs.get(file) ?? []).filter((r) => r.createdAt <= now).slice(0, perPage).map((r) => view(file, r, now)));
    },
    jobs: async (runId) => {
      const f = findRun(runId);
      if (!f) return { ok: false, status: 'HTTP_ERROR', data: null, message: 'HTTP 404' };
      const { file, r } = f;
      const now = clock.now();
      const done = now >= r.createdAt + r.durMs;
      const stepsOf = (names, failAt) => names.map((name, i) => ({ name, number: i + 1, conclusion: !done ? null : failAt === null ? (/demo, simulated/i.test(name) ? 'skipped' : 'success') : i < failAt ? 'success' : i === failAt ? 'failure' : 'skipped' }));
      if (file === 'ci.yml') {
        const failAt = r.fail ? CI_STEPS.findIndex((s) => /Syntax \+ tests/.test(s)) : null;
        return ok(['test (22)', 'test (24)'].map((name, j) => ({ id: r.id * 10 + j, name, status: done ? 'completed' : 'in_progress', conclusion: done ? (r.fail ? 'failure' : 'success') : null, steps: stepsOf(CI_STEPS, failAt).map((s) => (r.fail && /Quality gates summary/.test(s.name) && done ? { ...s, conclusion: 'success' } : s)) })));
      }
      if (file === 'scan-and-deploy.yml') {
        const failAt = r.fail === 'push' ? SCAN_STEPS.findIndex((s) => /Save research state/.test(s)) : r.fail === 'tests' ? 2 : null;
        return ok([{ id: r.id * 10, name: 'scan', status: done ? 'completed' : 'in_progress', conclusion: done ? (r.fail ? 'failure' : 'success') : null, steps: stepsOf(SCAN_STEPS, failAt) }, ...(r.fail ? [] : [{ id: r.id * 10 + 1, name: 'deploy', conclusion: done ? 'success' : null, steps: [{ name: 'deploy', number: 1, conclusion: done ? 'success' : null }] }])]);
      }
      return ok([{ id: r.id * 10, name: file.replace('.yml', ''), conclusion: done ? (r.fail ? 'failure' : 'success') : null, steps: [{ name: 'run', number: 1, conclusion: done ? (r.fail ? 'failure' : 'success') : null }] }]);
    },
    annotations: async (jobId) => {
      const f = findRun(Math.floor(jobId / 10));
      if (!f) return ok([]);
      const { file, r } = f;
      if (file === 'ci.yml') {
        const counts = { ...GATE_COUNTS };
        if (r.fail) counts[r.fail] = [counts[r.fail][0] - 1, counts[r.fail][1]];
        const notice = { level: 'notice', title: 'cri-gates', message: `v1 ${Object.entries(counts).map(([k, [p, t]]) => `${k}=${p}/${t}`).join(' ')}`, path: '.github' };
        const errs = r.fail ? [{ level: 'failure', title: `gate:${r.fail}`, message: 'adapters only reach hosts on the approved free-source list\nsrc/adapters/outbound/providers/derivatives.js apelează open-api.coinglass.com, care nu este pe lista de surse aprobate', path: 'test/architecture.test.js' }] : [];
        return ok([notice, ...errs]);
      }
      if (file === 'scan-and-deploy.yml' && r.fail === 'push') return ok([{ level: 'failure', title: null, message: 'remote: Permission to demo/cri-radar.git denied to github-actions[bot].', path: '.github' }]);
      return ok([]);
    },
    pagesDeployment: async () => {
      const s = await state.snapshot();
      const t = Math.min(clock.now(), s.ok ? Date.parse(s.data.meta?.generatedAt) + 6 * MIN : clock.now());
      return ok({ id: 1, sha: commitAt(clock.now())?.sha ?? null, createdAt: iso(t), state: 'success', url: 'https://demo.github.io/cri-radar/', at: iso(t) });
    },
    dispatch: async (file, ref, inputs) => {
      const now = clock.now();
      const w = FIXTURE_WORKFLOWS.find((x) => x.file === file);
      const commit = commitAt(now);
      const r = add(file, { event: 'workflow_dispatch', createdAt: now + MIN, queuedUntil: now + 2 * MIN, durMs: between(w?.durMin ?? [1, 2]) * MIN, headSha: commit?.sha ?? '0'.repeat(40), message: w?.name ?? file, fail: file === 'scan-and-deploy.yml' && down(now) ? 'push' : null });
      runs.get(file).sort((a, b) => b.createdAt - a.createdAt);
      dispatched.push({ file, ref, inputs, at: iso(now), id: r.id });
      return { ok: true, status: 'OK', data: null };
    },
  };

  const state = createStateDir({ dir: stateDir, dataDir });

  const site = {
    async summary() {
      const s = await state.snapshot();
      return s.ok ? ok({ url: 'https://demo.github.io/cri-radar/', generatedAt: s.data.meta?.generatedAt ?? null }) : { ok: false, status: 'HTTP_ERROR', data: { url: 'https://demo.github.io/cri-radar/' }, message: 'HTTP 404' };
    },
  };

  const prices = {
    async prices(ids) {
      const u = await state.universe();
      const fields = u.ok ? u.data.assets.fields : [];
      const k = fields.indexOf('key');
      const p = fields.indexOf('price');
      const base = new Map(u.ok ? u.data.assets.rows.map((row) => [String(row[k]), row[p]]) : []);
      const now = clock.now();
      const out = {};
      for (const id of ids) {
        const p0 = base.get(`cg:${id}`);
        if (!Number.isFinite(p0)) continue;
        const wave = 1 + 0.03 * Math.sin((now / DAY + (hash(id) % 97)) / 3);
        const pump = scenario.pump && scenario.pump.id === id && now >= scenario.pump.fromMs ? scenario.pump.multiple : 1;
        out[id] = { price: p0 * wave * pump, high24h: p0 * wave * pump * 1.04 };
      }
      return ok(out);
    },
  };

  const notifier = {
    async upsert({ title, body, open }) {
      const cur = issues.find((i) => i.state === 'open');
      if (open && cur) {
        cur.body = body;
        return ok({ number: cur.number, url: `https://github.com/demo/cri-radar/issues/${cur.number}` });
      }
      if (open) {
        const i = { number: issues.length + 1, title, body, state: 'open' };
        issues.push(i);
        return ok({ number: i.number, url: `https://github.com/demo/cri-radar/issues/${i.number}` });
      }
      if (cur) cur.state = 'closed';
      return ok(cur ? { number: cur.number, state: 'closed' } : null);
    },
  };

  return {
    ci,
    state,
    site,
    prices,
    notifier,
    memory: createMemoryFs({ dir: memoryDir, reportDir }),
    narrator: null,
    // For tests and the demo: what the simulator did.
    inspect: { dispatched, issues, runs: (file) => runs.get(file) ?? [], commits },
  };
}
