/**
 * The private repo's skeleton (hosted/radarcry-agent): the workflow is safe by construction, and the
 * script that saves memory survives two runs finishing at once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addMessage, newConversation } from '../../agent/domain/conversations.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const TEMPLATE = join(ROOT, 'hosted', 'radarcry-agent');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

test('the workflow: input only through the environment, secrets only as env, no untrusted trigger, bounded', async () => {
  const yml = await readFile(join(TEMPLATE, '.github', 'workflows', 'assistant.yml'), 'utf8');
  assert.match(yml, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.match(yml, /schedule:/);
  assert.ok(!/pull_request_target|issue_comment|\bissues:|pull_request:/.test(yml), 'nobody but the owner (and the schedule) can start it');
  assert.match(yml, /permissions:\s*\n\s+contents: write/);
  assert.match(yml, /timeout-minutes: 12/);
  assert.match(yml, /concurrency:\s*\n\s+group: assistant-/);
  // No expression is ever expanded inside a script: every ${{ }} sits in env:, with:, group: or a name.
  const lines = yml.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s+run:\s*[|>]/.test(lines[i]) && !/^\s+run:\s+\S/.test(lines[i])) continue;
    const indent = lines[i].match(/^\s*/)[0].length;
    assert.ok(!/\$\{\{/.test(lines[i]), `expresie în run: linia ${i + 1}`);
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].match(/^\s*/)[0].length > indent); j += 1) assert.ok(!/\$\{\{/.test(lines[j]), `expresie în scriptul de la linia ${i + 1}: ${lines[j].trim()}`);
  }
  for (const secret of ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'TAVILY_API_KEY', 'EXA_API_KEY']) assert.match(yml, new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`));
  assert.ok(!/secrets\.\w+/.test(yml.replace(/(GROQ|OPENROUTER|TAVILY|EXA)_API_KEY: \$\{\{ secrets\.\w+ \}\}/g, '')), 'no other secret is read');
  // The code of the public repo is fetched without the private repo's token.
  const code = yml.slice(yml.indexOf('Codul radarcry'), yml.indexOf('setup-node'));
  assert.match(code, /persist-credentials: false/);
  assert.ok(!/token:/.test(code));
  assert.ok((await stat(join(TEMPLATE, 'scripts', 'commit-memory.sh'))).mode & 0o111, 'the save script is executable');
  assert.equal(JSON.parse(await readFile(join(TEMPLATE, 'memory', 'index.json'), 'utf8')).conversations.length, 0, 'the dashboard can read an index before the first message');
});

test('saving memory: two runs that finish at once both keep their work, and the index lists both', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cri-hosted-'));
  try {
    const bare = join(dir, 'origin.git');
    assert.equal(git(dir, 'init', '-q', '--bare', '-b', 'main', bare).status, 0);
    const seed = join(dir, 'seed');
    await cp(TEMPLATE, seed, { recursive: true });
    for (const c of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'seed'], ['remote', 'add', 'origin', bare], ['push', '-q', 'origin', 'main']]) assert.equal(git(seed, ...c).status, 0, c.join(' '));
    const runA = join(dir, 'runA');
    const runB = join(dir, 'runB');
    for (const r of [runA, runB]) assert.equal(git(dir, 'clone', '-q', bare, r).status, 0);

    const idA = 'aaaaaaaa-1111-4222-8333-444444444444';
    const idB = 'bbbbbbbb-1111-4222-8333-444444444444';
    const conv = (id, text) => addMessage(addMessage(newConversation(id, Date.parse('2026-11-03T09:00:00Z')), { role: 'user', text, nowMs: Date.parse('2026-11-03T09:00:01Z') }), { role: 'agent', text: 'ok', nowMs: Date.parse('2026-11-03T09:00:02Z') });
    for (const [run, id, text] of [[runA, idA, 'prima'], [runB, idB, 'a doua']]) {
      await writeFile(join(run, 'memory', 'conversations', `${id}.json`), JSON.stringify(conv(id, text)));
      await writeFile(join(run, 'memory', 'index.json'), JSON.stringify({ version: 1, conversations: [{ id, title: text, pinned: false, createdAt: 'x', updatedAt: 'x', count: 2, preview: text }] }));
    }
    const save = (run, label) => spawnSync('bash', [join(TEMPLATE, 'scripts', 'commit-memory.sh')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, MEM_DIR: run, CODE_DIR: ROOT, LABEL: label, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, timeout: 90_000 });
    const a = save(runA, 'chat A');
    assert.equal(a.status, 0, a.stderr + a.stdout);
    const b = save(runB, 'chat B'); // its push is rejected: A got there first
    assert.equal(b.status, 0, b.stderr + b.stdout);
    assert.match(b.stdout, /reiau/);

    const check = join(dir, 'check');
    assert.equal(git(dir, 'clone', '-q', bare, check).status, 0);
    for (const id of [idA, idB]) assert.ok((await stat(join(check, 'memory', 'conversations', `${id}.json`))).isFile(), `lipsește ${id}`);
    const index = JSON.parse(await readFile(join(check, 'memory', 'index.json'), 'utf8'));
    assert.deepEqual(index.conversations.map((c) => c.id).sort(), [idA, idB].sort());
    // Nothing changed: nothing is committed.
    const none = save(runA, 'nimic');
    assert.equal(none.status, 0);
    assert.match(none.stdout, /Nimic de salvat/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
