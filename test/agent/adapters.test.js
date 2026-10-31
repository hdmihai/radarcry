/**
 * The agent's adapters: the GitHub REST surface (reads, one dispatch, one issue — nothing else),
 * the hosts each web adapter may reach, the public prices, and the file adapters' layouts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitHub, createIssueNotifier, normRun } from '../../agent/adapters/github.js';
import { createOllama, createPublicPrices, createSite, pagesUrlOf } from '../../agent/adapters/web.js';
import { createMemoryFs, createStateDir } from '../../agent/adapters/files.js';
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
  const f = fakeFetch([[/data\/summary\.json/, 200, { generatedAt: '2026-10-31T09:04:32.053Z' }], [/api\/tags/, 200, { models: [{ name: 'qwen2.5:3b' }] }], [/api\/generate/, 200, { response: '- text' }]]);
  const site = createSite({ url: 'https://o.github.io/r', fetchImpl: f.impl });
  assert.deepEqual((await site.summary()).data, { url: 'https://o.github.io/r/', generatedAt: '2026-10-31T09:04:32.053Z' });
  const llm = createOllama({ model: 'qwen2.5:3b', fetchImpl: f.impl });
  assert.equal(await llm.available(), true);
  assert.equal((await llm.generate({ system: 's', prompt: 'p' })).data, '- text');
  assert.equal(f.calls.at(-1).body.stream, false);
  assert.equal(await createOllama({ model: 'llama3.2:3b', fetchImpl: f.impl }).available(), false, 'a model that was not pulled is not available');
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
