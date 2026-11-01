/**
 * The agent's adapters: the GitHub REST surface (reads, one dispatch, one issue — nothing else),
 * the hosts each web adapter may reach, the public prices, the file adapters' layouts, the written
 * knowledge, and the git workspace of the code command (inside the repository only, tokens never
 * passed to the tests, exactly its own changes undone).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitHub, createIssueNotifier, normRun } from '../../agent/adapters/github.js';
import { createOllama, createPublicPrices, createSite, pagesUrlOf } from '../../agent/adapters/web.js';
import { createKnowledgeFs, createMemoryFs, createStateDir } from '../../agent/adapters/files.js';
import { createWorkspace } from '../../agent/adapters/workspace.js';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { cronsOf } from '../../agent/main.js';
import { ROOT } from '../fixture-run.js';

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    const hit = routes.find(([re]) => re.test(`${init.method ?? 'GET'} ${url}`));
    const [, status, body] = hit ?? [null, 404, { message: 'Not Found' }];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  };
  return { impl, calls };
}

test('github: runs normalised, the token sent as a bearer, dispatch posts the ref and inputs', async () => {
  const f = fakeFetch([
    [/GET .*\/actions\/workflows\/scan-and-deploy\.yml\/runs/, 200, { workflow_runs: [{ id: 1, event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-10-31T05:53:27Z', updated_at: '2026-10-31T06:09:38Z', run_started_at: '2026-10-31T05:53:27Z', head_sha: 'abc', head_branch: 'main', head_commit: { message: 'first line\nsecond' }, run_attempt: 1, html_url: 'https://github.com/o/r/actions/runs/1' }] }],
    [/POST .*\/dispatches$/, 204, null],
    [/GET .*\/check-runs\/7\/annotations/, 200, [{ annotation_level: 'notice', title: 'cri-gates', message: 'v1 syntax=1/1' }]],
  ]);
  const gh = createGitHub({ token: 't0k', repo: 'o/r', fetchImpl: f.impl });
  const runs = await gh.runs('scan-and-deploy.yml');
  assert.equal(runs.ok, true);
  assert.equal(runs.data[0].message, 'first line');
  assert.equal(f.calls[0].headers.authorization, 'Bearer t0k');
  assert.match(f.calls[0].url, /^https:\/\/api\.github\.com\/repos\/o\/r\//);
  const d = await gh.dispatch('scan-and-deploy.yml', 'main', { mode: 'live' });
  assert.equal(d.ok, true);
  assert.deepEqual(f.calls.at(-1).body, { ref: 'main', inputs: { mode: 'live' } });
  const a = await gh.annotations(7);
  assert.equal(a.data[0].title, 'cri-gates');
  const missing = await gh.jobs(99);
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'HTTP_ERROR');
  assert.equal(normRun({ id: 2, head_commit: null, display_title: 'Scan & deploy' }).message, 'Scan & deploy');
  // The thread a follow-up continues, read only.
  const t = fakeFetch([[/GET .*\/issues\/12\/comments\?per_page=100$/, 200, [{ id: 5, user: { login: 'owner' }, body: 'cum stă radarul?', created_at: '2026-11-01T08:00:00Z' }, { id: 6, user: null, body: null, created_at: '2026-11-01T08:01:00Z' }]]]);
  const thread = await createGitHub({ token: 't', repo: 'o/r', fetchImpl: t.impl }).issueComments(12);
  assert.deepEqual(thread.data, [{ id: 5, author: 'owner', body: 'cum stă radarul?', createdAt: '2026-11-01T08:00:00Z' }, { id: 6, author: null, body: '', createdAt: '2026-11-01T08:01:00Z' }]);
  assert.equal(t.calls[0].method, 'GET');
  assert.throws(() => createGitHub({ repo: 'not-a-repo' }), /owner\/nume/);
});

test('notifier: one issue found by its marker, updated while needed, closed when clear', async () => {
  const issues = [{ number: 5, title: 'x', body: 'altceva', html_url: 'u5' }, { number: 9, title: 'Agent AI', body: '<!-- cri-agent -->\nvechi', html_url: 'u9' }];
  const f = fakeFetch([
    [/GET .*\/issues\?state=open/, 200, issues],
    [/PATCH .*\/issues\/9$/, 200, { number: 9, html_url: 'u9', state: 'open' }],
    [/POST .*\/issues$/, 201, { number: 10, html_url: 'u10' }],
  ]);
  const n = createIssueNotifier({ gh: createGitHub({ token: 't', repo: 'o/r', fetchImpl: f.impl }) });
  await n.upsert({ title: 'Agent AI', body: '<!-- cri-agent -->\nnou', open: true });
  assert.equal(f.calls.at(-1).method, 'PATCH');
  assert.equal(f.calls.at(-1).body.body, '<!-- cri-agent -->\nnou');
  await n.upsert({ title: 'Agent AI', body: '<!-- cri-agent -->\ngata', open: false });
  assert.equal(f.calls.at(-1).body.state, 'closed');
  issues.splice(1, 1);
  await n.upsert({ title: 'Agent AI', body: '<!-- cri-agent -->\nnou', open: true });
  assert.equal(f.calls.at(-1).method, 'POST', 'no marked issue yet: one is created');
  const before = f.calls.length;
  await n.upsert({ title: 'Agent AI', body: 'x', open: false });
  assert.equal(f.calls.length, before + 1, 'nothing to close: only the lookup');
});

test('web adapters are pinned to their hosts', async () => {
  assert.equal(pagesUrlOf('HdMihai/radarcry'), 'https://hdmihai.github.io/radarcry/');
  assert.throws(() => createSite({ url: 'https://example.com/' }), /github\.io/);
  assert.throws(() => createOllama({ baseUrl: 'http://10.0.0.5:11434', model: 'm' }), /local/);
  const f = fakeFetch([[/data\/summary\.json/, 200, { generatedAt: '2026-10-31T09:04:32.053Z' }], [/api\/version/, 200, { version: '0.12.0' }], [/api\/tags/, 200, { models: [{ name: 'qwen2.5:3b' }] }], [/api\/generate/, 200, { response: '- text' }]]);
  const site = createSite({ url: 'https://o.github.io/r', fetchImpl: f.impl });
  assert.deepEqual((await site.summary()).data, { url: 'https://o.github.io/r/', generatedAt: '2026-10-31T09:04:32.053Z' });
  const llm = createOllama({ model: 'qwen2.5:3b', fetchImpl: f.impl });
  assert.equal(await llm.available(), true);
  assert.equal((await llm.generate({ system: 's', prompt: 'p' })).data, '- text');
  assert.equal(f.calls.at(-1).body.stream, false);
  assert.equal(await createOllama({ model: 'llama3.2:3b', fetchImpl: f.impl }).available(), false, 'a model that was not pulled is not available');
  // The reason travels to the narrator gate: the server, then the model.
  assert.match((await createOllama({ model: 'llama3.2:3b', fetchImpl: f.impl }).status()).reason, /nu este descărcat/);
  const down = fakeFetch([]);
  assert.match((await createOllama({ model: 'qwen2.5:3b', fetchImpl: down.impl }).status()).reason, /serverul Ollama nu răspunde/);
});

test('public prices: chunks of ids, the 24-hour high, one patient retry on a rate limit', async () => {
  let n = 0;
  const impl = async (url) => {
    n += 1;
    if (n === 1) return new Response('{}', { status: 429 });
    const ids = new URL(url).searchParams.get('ids').split(',');
    assert.ok(new URL(url).hostname === 'api.coingecko.com');
    return new Response(JSON.stringify(ids.map((id) => ({ id, current_price: 2, high_24h: 3 }))), { status: 200 });
  };
  const p = createPublicPrices({ fetchImpl: impl, chunk: 2, sleep: async () => {} });
  const r = await p.prices(['a', 'b', 'c']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.c, { price: 2, high24h: 3 });
  assert.equal(n, 3, 'one retry, then the second chunk');
});

test('files: the state branch layout and a data directory both work; memory is written atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cri-agent-files-'));
  try {
    await mkdir(join(dir, 'state', 'snapshot'), { recursive: true });
    await writeFile(join(dir, 'state', 'snapshot', 'latest.json'), JSON.stringify({ meta: { generatedAt: 'a' } }));
    await writeFile(join(dir, 'state', 'meta.json'), JSON.stringify({ runs: 3 }));
    await mkdir(join(dir, 'data'), { recursive: true });
    await writeFile(join(dir, 'data', 'universe.json'), JSON.stringify({ assets: { fields: [], rows: [] } }));
    const st = createStateDir({ dir: join(dir, 'state'), dataDir: join(dir, 'data') });
    assert.equal((await st.snapshot()).data.meta.generatedAt, 'a');
    assert.equal((await st.meta()).data.runs, 3);
    assert.equal((await st.universe()).ok, true, 'found in the data directory');
    assert.equal((await st.telemetry()).ok, false);
    const mem = createMemoryFs({ dir: join(dir, 'mem') });
    assert.equal(await mem.load(), null);
    await mem.save({ version: 1, runs: 2 });
    assert.equal((await mem.load()).runs, 2);
    await mem.publish({ x: 1 }, '# md');
    assert.deepEqual(await mem.lastReport(), { x: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the schedules are read from the workflow files themselves', async () => {
  assert.deepEqual(await cronsOf('scan-and-deploy.yml', ROOT), ['17 */4 * * *']);
  assert.deepEqual(await cronsOf('pulse.yml', ROOT), ['7,22,37,52 * * * *']);
  assert.deepEqual(await cronsOf('ci.yml', ROOT), []);
  assert.deepEqual(await cronsOf('agent.yml', ROOT), ['43 * * * *']);
});

test('knowledge: the rulebook and the documents the chat answers from', async () => {
  const k = createKnowledgeFs();
  const rules = await k.rules();
  assert.equal(rules.ok, true);
  assert.ok(rules.data.rules.length >= 20);
  const docs = await k.docs();
  assert.deepEqual(docs.data.map((d) => d.name), ['README.md', 'docs/ARCHITECTURE.md', 'agent/README.md']);
  const none = createKnowledgeFs({ root: tmpdir() });
  assert.equal((await none.rules()).ok, false, 'a missing rulebook is a result, not a crash');
});

test('workspace: writes stay inside the repository, tests run without tokens, reset undoes exactly its own changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cri-agent-ws-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' }).toString();
    git('init', '-q');
    await writeFile(join(dir, 'a.js'), 'export const a = 1;\n');
    await writeFile(join(dir, 'mine.txt'), 'the owner\'s file\n');
    git('add', 'a.js');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    // The "test suite" prints whether it can see a token.
    const probe = `process.stdout.write(process.env.GITHUB_TOKEN ? 'TOKEN-VISIBLE' : 'no-token'); process.exit(require('fs').readFileSync('a.js','utf8').includes('2') ? 0 : 1)`;
    const ws = createWorkspace({ root: dir, testCommand: [process.execPath, '-e', probe] });
    assert.equal(await ws.clean(), false, 'an untracked file of the owner makes the tree not clean');
    assert.deepEqual(await ws.list(), ['a.js']);
    await assert.rejects(ws.write('../escape.js', 'x'), /iese din repository/);
    await ws.write('a.js', 'export const a = 2;\n');
    await ws.write('src/new.js', 'export const n = 1;\n');
    const saved = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'token-the-test-suite-must-not-see';
    const t = await ws.test();
    if (saved === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = saved;
    assert.equal(t.ok, true);
    assert.equal(t.output, 'no-token', 'the proposed code never sees a token');
    const diff = await ws.diff();
    assert.match(diff, /-export const a = 1;/);
    assert.match(diff, /\+export const n = 1;/, 'a new file is in the diff');
    assert.doesNotMatch(diff, /mine\.txt/, 'only the files the agent touched');
    assert.deepEqual(ws.touched().sort(), ['a.js', 'src/new.js']);
    await ws.reset();
    assert.equal(await readFile(join(dir, 'a.js'), 'utf8'), 'export const a = 1;\n');
    assert.equal(await readFile(join(dir, 'mine.txt'), 'utf8'), "the owner's file\n", 'the owner\'s file is untouched');
    await assert.rejects(readFile(join(dir, 'src', 'new.js')), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
