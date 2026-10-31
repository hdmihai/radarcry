/**
 * Architecture fitness of the AI agent — the same mechanical checks the scanner lives under:
 *   · a separate module: the agent never imports the scanner (src/) or the dashboard (web/), and
 *     neither of them imports the agent;
 *   · hexagonal inside: agent/domain pure and deterministic, agent/application only domain + itself;
 *   · free hosts only, each adapter pinned to its own;
 *   · observation only: the GitHub surface is reads, one workflow dispatch and one issue — no delete,
 *     cancel, re-run, merge or content write; the workflow's permissions say the same.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { ROOT } from '../fixture-run.js';

async function jsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await jsFiles(p)));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

async function importsOf(file) {
  const src = await readFile(file, 'utf8');
  const specs = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm), ...src.matchAll(/^\s*export\s[^'"]*from\s+['"]([^'"]+)['"]/gm), ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  return specs.map((s) => (s.startsWith('.') ? { spec: s, path: relative(ROOT, resolve(dirname(file), s)) } : { spec: s, path: null }));
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the agent is a separate module: it never imports the scanner or the dashboard, and they never import it', async () => {
  for (const f of await jsFiles(join(ROOT, 'agent'))) {
    for (const i of await importsOf(f)) {
      if (!i.path) assert.match(i.spec, /^node:/, `${relative(ROOT, f)} importă ${i.spec} — agentul nu are dependențe`);
      else assert.ok(i.path.startsWith('agent/'), `${relative(ROOT, f)} importă ${i.spec} — agentul citește doar ce publică scannerul, nu codul lui`);
    }
  }
  for (const dir of ['src', 'web']) {
    for (const f of await jsFiles(join(ROOT, dir))) {
      for (const i of await importsOf(f)) assert.ok(!i.path?.startsWith('agent/'), `${relative(ROOT, f)} importă agentul (${i.spec})`);
    }
  }
});

test('the agent domain is pure and the application depends only on it', async () => {
  for (const f of await jsFiles(join(ROOT, 'agent', 'domain'))) {
    for (const i of await importsOf(f)) assert.ok(i.path?.startsWith('agent/domain/'), `${relative(ROOT, f)} importă ${i.spec}`);
  }
  for (const f of await jsFiles(join(ROOT, 'agent', 'application'))) {
    for (const i of await importsOf(f)) assert.ok(i.path && ['agent/domain', 'agent/application'].some((p) => i.path.startsWith(`${p}/`)), `${relative(ROOT, f)} importă ${i.spec} — aplicația vorbește cu lumea doar prin porturi`);
  }
});

test('the agent domain and application are deterministic: time arrives as an argument', async () => {
  const FORBIDDEN = [
    [/\bDate\.now\s*\(/, 'Date.now()'],
    [/\bMath\.random\s*\(/, 'Math.random()'],
    [/\bnew\s+Date\s*\(\s*\)/, 'new Date() fără argument'],
    [/\bperformance\.now\s*\(/, 'performance.now()'],
    [/\bsetTimeout\s*\(|\bfetch\s*\(/, 'I/O sau temporizare'],
  ];
  const files = [...(await jsFiles(join(ROOT, 'agent', 'domain'))), ...(await jsFiles(join(ROOT, 'agent', 'application')))];
  assert.ok(files.length >= 12, `prea puține fișiere (${files.length})`);
  for (const f of files) {
    const code = stripComments(await readFile(f, 'utf8'));
    for (const [re, why] of FORBIDDEN) assert.ok(!re.test(code), `${relative(ROOT, f)} conține ${why}`);
  }
});

test('agent adapters reach only free hosts, each pinned to its own', async () => {
  const APPROVED = {
    'api.github.com': 'GitHub REST cu tokenul automat al workflow-ului (gratuit)',
    'api.coingecko.com': 'CoinGecko public, fără cheie (prețuri pentru registrul de calibrare)',
    '127.0.0.1': 'Ollama local, în runner',
  };
  const LINK_ONLY = new Set(['github.com', 'localhost']);
  for (const f of (await jsFiles(join(ROOT, 'agent', 'adapters'))).filter((x) => !x.endsWith('fixtures.js'))) {
    const src = stripComments(await readFile(f, 'utf8'));
    for (const m of src.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      const host = m[1].toLowerCase();
      if (LINK_ONLY.has(host) || host.endsWith('.github.io')) continue;
      assert.ok(Object.prototype.hasOwnProperty.call(APPROVED, host), `${relative(ROOT, f)} apelează ${host}, care nu este pe lista agentului`);
    }
  }
  const web = await readFile(join(ROOT, 'agent', 'adapters', 'web.js'), 'utf8');
  assert.match(web, /endsWith\('\.github\.io'\)/, 'the site adapter refuses any host but *.github.io');
  assert.match(web, /'127\.0\.0\.1', 'localhost'/, 'the narrator refuses any host but the runner itself');
});

test('the agent observes and may only start a workflow or keep one issue: no delete, cancel, re-run or content write', async () => {
  const src = stripComments(await readFile(join(ROOT, 'agent', 'adapters', 'github.js'), 'utf8'));
  const methods = [...src.matchAll(/call\('([A-Z]+)',\s*`([^`]+)`/g)].map((m) => [m[1], m[2]]);
  assert.ok(methods.length >= 8, 'the adapter routes every request through call()');
  for (const [method, path] of methods) {
    if (method === 'GET') continue;
    const allowed = (method === 'POST' && (/\/dispatches$/.test(path) || /\/issues$/.test(path))) || (method === 'PATCH' && /\/issues\/\$\{/.test(path));
    assert.ok(allowed, `${method} ${path} — singurele scrieri permise sunt workflow_dispatch și problema agentului`);
  }
  for (const re of [/'DELETE'/, /\/cancel\b/, /force-cancel/, /\/rerun/, /\/contents\//, /\/git\/refs/, /\/merges\b/, /\/pulls\b/, /\/releases\b/]) assert.ok(!re.test(src), `github.js conține ${re}`);
  const wf = await readFile(join(ROOT, '.github', 'workflows', 'agent.yml'), 'utf8');
  const perms = /^permissions:\n((?:\s+.+\n)+?)\n/m.exec(wf)?.[1] ?? '';
  const granted = [...perms.matchAll(/^\s+([a-z-]+):\s*(\w+)/gm)].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(granted, ['actions:write', 'checks:read', 'contents:write', 'issues:write']);
  assert.deepEqual([...new Set([...wf.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))], ['GITHUB_TOKEN'], 'the agent reads no secret but the workflow token');
  assert.match(wf, /continue-on-error: true # without the model/, 'the local model is optional');
  assert.match(wf, /cancel-in-progress: false/);
});
