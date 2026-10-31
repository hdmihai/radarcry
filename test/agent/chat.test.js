/**
 * Talking to the agent: the commands a comment or a terminal line names, the documentation search
 * that answers questions, the guard on a model's answer, the patch policy, and the Copilot-like code
 * command end to end with a fake coder and an in-memory workspace — plus every deterministic answer
 * over the report and memory of a real fixture run.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFixtureDays, ROOT } from '../fixture-run.js';
import { createFixturePorts } from '../../agent/adapters/fixtures.js';
import { createKnowledgeFs, createMemoryFs, createStateDir } from '../../agent/adapters/files.js';
import { analyze } from '../../agent/application/monitor.js';
import { chat } from '../../agent/application/chat.js';
import { loadAgentConfig } from '../../agent/main.js';
import { fold, helpText, parseCommand, runIdOf, slugOf } from '../../agent/domain/commands.js';
import { chunkDocs, excerpt, rankFiles, search, tokens } from '../../agent/domain/retrieval.js';
import { applyEdits, parseEdits, pathViolations, validateChange } from '../../agent/domain/patch.js';
import { CHAT_MARKER, guardAnswer, testSummary, wrapReply } from '../../agent/domain/chat.js';

const H = 3_600_000;
const quiet = { info() {}, warn() {}, debug() {} };
let fx;
let dir;
let base;

before(async () => {
  fx = await runFixtureDays({ days: 2 });
  dir = await mkdtemp(join(tmpdir(), 'cri-chat-'));
  const snapAt = Date.parse(fx.snapshots.at(-1).meta.generatedAt);
  const cfg = await loadAgentConfig(ROOT);
  cfg.mode = 'demo';
  const clock = { t: snapAt + H, now() { return this.t; } };
  const ports = createFixturePorts({ anchorMs: snapAt + H, clock, stateDir: fx.stateDir, dataDir: fx.outDir, memoryDir: join(dir, 'mem'), reportDir: join(dir, 'report') });
  await analyze({ ports, cfg, nowMs: clock.t, limits: { scanMaxMinutes: 22, topN: 1000 }, logger: quiet });
  base = { cfg, ports, clock };
});
after(async () => {
  await fx?.cleanup();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const chatPorts = (extra = {}) => ({ memory: createMemoryFs({ dir: join(dir, 'mem'), reportDir: join(dir, 'report') }), state: createStateDir({ dir: fx.stateDir, dataDir: fx.outDir }), knowledge: createKnowledgeFs(), ci: base.ports.ci, ...extra });
const ask = (text, extra = {}, o = {}) => chat({ ports: chatPorts(extra), cfg: base.cfg, nowMs: base.clock.t, text, logger: quiet, ...o });

test('commands: /agent prefix, optional diacritics, arguments over several lines, questions by default', () => {
  assert.equal(fold('Diagnoză Porți ȘȚ'), 'diagnoza porti st');
  assert.deepEqual(parseCommand('/agent diagnoză scan.run'), { id: 'diagnose', word: 'diagnoza', args: 'scan.run', llm: false, coder: false, ok: true, reason: null });
  assert.equal(parseCommand('Salut!\n/agent PORȚI cod').args, 'cod');
  assert.equal(parseCommand('/agent porti cod').id, 'gates');
  const c = parseCommand('/agent cod adaugă un test\npentru pragul de lichiditate');
  assert.equal(c.id, 'code');
  assert.equal(c.coder, true);
  assert.equal(c.args, 'adaugă un test\npentru pragul de lichiditate');
  assert.equal(parseCommand('/agent').id, 'help');
  assert.equal(parseCommand('/agent de ce a eșuat scanarea').id, 'diagnose');
  const q = parseCommand('/agent cum funcționează prognoza?');
  assert.equal(q.id, 'ask', 'a sentence without a command word is a question');
  assert.equal(q.args, 'cum funcționează prognoza?');
  assert.equal(parseCommand('stare').id, 'status', 'on the terminal the prefix is optional');
  assert.equal(parseCommand('nu e pentru agent', { requirePrefix: true }).ok, false, 'a comment without /agent is ignored');
  assert.equal(runIdOf('run 18842123456'), 18842123456);
  assert.equal(runIdOf('https://github.com/o/r/actions/runs/123456789/job/1'), 123456789);
  assert.equal(runIdOf('scan.run'), null);
  assert.equal(slugOf('Adaugă testul pentru Pragul de lichiditate!'), 'adauga-testul-pentru-pragul-de-lichidita');
  assert.match(helpText(), /\/agent cod <sarcina>/);
});

test('retrieval: the README passage that answers, found with folded diacritics and light stemming', async () => {
  const k = createKnowledgeFs();
  const docs = (await k.docs()).data;
  assert.ok(docs.some((d) => d.name === 'README.md'));
  const chunks = chunkDocs(docs);
  assert.ok(chunks.length > 30);
  const hit = search(chunks, 'cum interacționez gratuit cu agentul din Termux', { k: 3 });
  assert.ok(hit.length, 'something answers');
  assert.ok(hit.some((h) => /chat|interac|Termux|\/agent/i.test(`${h.heading} ${h.text}`)), hit.map((h) => h.heading).join(' | '));
  assert.deepEqual(tokens('Porțile de calitate'), tokens('portile de calitate'), 'diacritics are optional');
  assert.deepEqual(search(chunks, ''), []);
  const files = [{ path: 'src/domain/liquidity.js', text: 'export function liquidityGate(x) { return x > 1; }' }, { path: 'test/domain/liquidity.test.js', text: 'liquidityGate test' }, { path: 'web/x.js', text: 'other' }];
  const ranked = rankFiles(files, 'pragul liquidityGate din domeniu', { k: 3 });
  assert.equal(ranked[0].path, 'src/domain/liquidity.js');
  assert.ok(ranked.some((f) => f.path === 'test/domain/liquidity.test.js'), 'a source brings its test');
  const long = Array.from({ length: 2000 }, (_, i) => (i === 1500 ? 'const liquidityGate = 1;' : `const v${i} = ${i};`)).join('\n');
  const ex = excerpt(long, 'liquidityGate', { maxChars: 3000 });
  assert.match(ex, /const liquidityGate = 1;/);
  assert.match(ex, /linii omise/);
});

test('patch policy: SEARCH/REPLACE blocks applied exactly once, protected files and secrets refused', () => {
  const edits = parseEdits('Explicație.\nFILE: src/a.js\n<<<<<<< SEARCH\n  return 1;\n=======\n  return 2;\n>>>>>>> REPLACE\nFILE: src/new.js\n<<<<<<< SEARCH\n=======\nexport const x = 1;\n>>>>>>> REPLACE');
  assert.equal(edits.length, 2);
  const files = new Map([['src/a.js', 'function f() {\n  return 1;\n}\n'], ['src/new.js', null]]);
  const r = applyEdits(files, edits);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.files.get('src/a.js'), 'function f() {\n  return 2;\n}\n');
  assert.deepEqual(r.created, ['src/new.js']);
  assert.equal(validateChange(files, r.files, r.changed).ok, true);
  // A block that does not match, or matches twice, is an error — never a silent damage.
  assert.match(applyEdits(files, [{ path: 'src/a.js', search: 'return 9;', replace: 'x' }]).errors[0], /nu există/);
  assert.match(applyEdits(new Map([['a.js', 'x\nx\n']]), [{ path: 'a.js', search: 'x', replace: 'y' }]).errors[0], /de mai multe ori/);
  // Indentation lost by the model is restored.
  const ind = applyEdits(new Map([['a.js', 'if (a) {\n    call(1);\n}\n']]), [{ path: 'a.js', search: 'call(1);', replace: 'call(2);' }]);
  assert.equal(ind.files.get('a.js'), 'if (a) {\n    call(2);\n}\n');
  for (const p of ['.github/workflows/ci.yml', 'test/architecture.test.js', 'test/agent/architecture.test.js', '../etc/passwd', '/abs.js', 'img.png']) assert.ok(pathViolations([p]).length, `${p} is refused`);
  assert.deepEqual(pathViolations(['src/domain/x.js', 'README.md', 'agent/knowledge/rules.json']), []);
  assert.ok(pathViolations(Array.from({ length: 9 }, (_, i) => `src/f${i}.js`))[0].startsWith('prea multe'));
  // Built at run time, so this file itself never carries a token-shaped literal.
  const fakeToken = ['gh', 'p_', 'x'.repeat(36)].join('');
  const leak = validateChange(new Map([['a.js', '']]), new Map([['a.js', `const k = "${fakeToken}";`]]), ['a.js']);
  assert.equal(leak.ok, false);
  assert.match(leak.problems[0], /github-token/);
});

test('answer guard: numbers only from the context, no links, no trading language', () => {
  const ctx = { passages: ['Prognoza ≥100× are rata de bază 0.21% pe zi.'], facts: { porti: { PASS: 33 } } };
  assert.equal(guardAnswer('Rata de bază ≥100× este 0,21% pe zi; 33 de porți trec.', ctx).ok, true);
  assert.match(guardAnswer('Rata de bază este 0,35% pe zi, după cele 33 de porți.', ctx).reasons.join(' '), /0,35/);
  assert.match(guardAnswer('Vezi https://exemplu.ro pentru detalii despre rata de 0.21%.', ctx).reasons.join(' '), /linkuri/);
  assert.match(guardAnswer('Cumpărați acum, rata de bază este 0.21% pe zi.', ctx).reasons.join(' '), /tranzacționare/);
  const w = wrapReply({ title: 'T', body: 'x'.repeat(70_000) });
  assert.ok(w.startsWith(CHAT_MARKER) && w.length <= 60_000);
  assert.match(testSummary('ℹ tests 10\nnot ok 3 - something broke\nℹ fail 1'), /not ok 3/);
});

test('chat over a real fixture run: status, gates, rules, learning, efficiency, forecast, help — all deterministic', async () => {
  let r = await ask('/agent stare');
  assert.match(r.reply, /Stare generală/);
  assert.ok(r.reply.startsWith(CHAT_MARKER));
  r = await ask('/agent porti cadenta');
  assert.match(r.reply, /cad\.scan/);
  assert.doesNotMatch(r.reply, /ci\.syntax/, 'filtered by group');
  r = await ask('/agent reguli');
  assert.match(r.reply, /Principii/);
  assert.match(r.reply, /ID-1/);
  r = await ask('/agent reguli fc-2');
  assert.match(r.reply, /FC-2 — Fără date din viitor/);
  assert.match(r.reply, /Istoric:/);
  r = await ask('/agent învățare');
  assert.match(r.reply, /Auto-evaluare/);
  assert.match(r.reply, /Ce a învățat din istoric/);
  r = await ask('/agent eficiență');
  assert.match(r.reply, /\+20% în 72 de ore/);
  r = await ask('/agent ajutor');
  assert.match(r.reply, /Comenzi/);
  const rows = JSON.parse(await readFile(join(fx.outDir, 'universe.json'), 'utf8'));
  const k = rows.assets.fields.indexOf('symbol');
  const fcI = rows.assets.fields.indexOf('fc100');
  const sym = rows.assets.rows.find((x) => Number.isFinite(x[fcI]))[k];
  r = await ask(`/agent prognoză ${sym}`);
  assert.match(r.reply, new RegExp(`\\*\\*${sym}\\*\\*`));
  assert.match(r.reply, /≥100×/);
  r = await ask('/agent prognoza NUEXISTA');
  assert.match(r.reply, /nu este în universul cercetat/);
});

test('diagnosis: a gate with its lessons, a named run step by step with its signature and suspect commits', async () => {
  let r = await ask('/agent diagnoză cad.scan');
  assert.match(r.reply, /Cadența scanării complete/);
  assert.match(r.reply, /Ce verifică/);
  // The simulated history has a scan whose push to the state branch was denied.
  const failed = base.ports.inspect.runs('scan-and-deploy.yml').find((x) => x.fail === 'push' && x.createdAt < base.clock.t);
  r = await ask(`/agent diagnoză run ${failed.id}`);
  assert.match(r.reply, /Pași căzuți/);
  assert.match(r.reply, /Save research state/);
  assert.match(r.reply, /PUSH_DENIED/);
  assert.match(r.reply, /Read and write permissions/);
  r = await ask('/agent diagnoză nu-exista');
  assert.match(r.reply, /Nu cunosc poarta/);
  r = await ask('/agent diagnoză');
  assert.match(r.reply, /cea mai gravă întâi|Nicio poartă nu cere atenție/);
});

test('ask: passages quoted without a model; a model answer published only when the guard accepts it', async () => {
  let r = await ask('/agent întreabă ce înseamnă eficiența identificării');
  assert.equal(r.by, 'retrieval');
  assert.match(r.reply, /Pasajele din documentație/);
  const narrator = (text) => ({ model: 'fake-3b', available: async () => true, generate: async () => ({ ok: true, status: 'OK', data: text }) });
  r = await ask('/agent întreabă ce înseamnă lift', { narrator: narrator('Lift-ul este rata de reușită a unui nivel împărțită la rata universului. Surse: README.') });
  assert.equal(r.by, 'llm:fake-3b');
  assert.match(r.reply, /Lift-ul este/);
  r = await ask('/agent întreabă ce înseamnă lift', { narrator: narrator('Lift-ul garantat este 7,77 în fiecare săptămână.') });
  assert.equal(r.by, 'retrieval', 'an invented number sends the answer back to the passages');
  assert.match(r.reply, /respins de gardă/);
});

/** An in-memory repository with a test suite that passes when f() returns 2. */
function fakeWorkspace(initial) {
  const files = new Map(Object.entries(initial));
  const orig = new Map(files);
  return {
    files,
    list: async () => [...files.keys()],
    read: async (p) => files.get(p) ?? null,
    write: async (p, t) => void files.set(p, t),
    test: async () => (/return 2/.test(files.get('src/domain/f.js') ?? '') ? { ok: true, output: 'ℹ tests 3\nℹ pass 3\nℹ fail 0' } : { ok: false, output: 'not ok 1 - f returns 2\n  AssertionError: 1 !== 2\nℹ fail 1' }),
    diff: async () => [...files.keys()].filter((p) => files.get(p) !== orig.get(p)).map((p) => `--- a/${p}\n+++ b/${p}\n+${files.get(p)}`).join('\n'),
    reset: async () => {
      files.clear();
      for (const [k, v] of orig) files.set(k, v);
    },
  };
}
const coderSays = (...answers) => {
  const calls = [];
  return { calls, model: 'fake-coder-7b', available: async () => true, generate: async (p) => (calls.push(p), { ok: true, status: 'OK', data: answers[Math.min(calls.length - 1, answers.length - 1)] }) };
};
const BLOCK = (from, to, path = 'src/domain/f.js') => `FILE: ${path}\n<<<<<<< SEARCH\n${from}\n=======\n${to}\n>>>>>>> REPLACE`;

test('code: the coder edits, the tests run, one repair round after a failure, a patch for the pull request', async () => {
  const ws = fakeWorkspace({ 'src/domain/f.js': 'export function f() {\n  return 1;\n}\n', 'test/domain/f.test.js': "test('f', () => assert.equal(f(), 2));\n" });
  // First answer breaks nothing but does not fix the test; the repair round fixes it.
  const coder = coderSays(BLOCK('  return 1;', '  return 3;'), BLOCK('  return 3;', '  return 2;'));
  const r = await ask('/agent cod fă ca f() din src/domain/f.js să întoarcă 2', { workspace: ws, coder }, { issue: 12, author: 'owner' });
  assert.equal(coder.calls.length, 2, 'one repair round');
  assert.match(coder.calls[1].prompt, /Testele au eșuat/);
  assert.match(coder.calls[0].system, /hexagonal/i, 'the architecture rules are in the prompt');
  assert.match(coder.calls[0].prompt, /FILE: src\/domain\/f\.js/, 'the file named in the task is in context');
  assert.ok(r.patch, r.reply);
  assert.equal(r.patch.draft, false, 'tests pass → a ready pull request');
  assert.match(r.patch.branch, /^agent\/12-fa-ca-f/);
  assert.match(r.patch.body, /cerută de @owner/);
  assert.match(r.patch.body, /agentul nu face merge/);
  assert.match(r.reply, /Testele trec/);
  assert.equal(ws.files.get('src/domain/f.js'), 'export function f() {\n  return 2;\n}\n');
});

test('code: a protected file is refused, a model without blocks gets no patch, nothing works without a workspace or a model', async () => {
  const ws = fakeWorkspace({ 'src/domain/f.js': 'export function f() {\n  return 1;\n}\n' });
  let r = await ask('/agent cod slăbește testul de arhitectură', { workspace: ws, coder: coderSays(BLOCK('x', 'y', 'test/architecture.test.js')) });
  assert.equal(r.patch, null);
  assert.match(r.reply, /fișier protejat/);
  r = await ask('/agent cod ceva', { workspace: ws, coder: coderSays('Nu pot.') });
  assert.equal(r.patch, null);
  assert.match(r.reply, /nu conține blocuri de editare/);
  assert.equal(ws.files.get('src/domain/f.js'), 'export function f() {\n  return 1;\n}\n', 'the workspace is unchanged');
  r = await ask('/agent cod ceva');
  assert.match(r.reply, /workflow-ul „Agent AI — chat”/);
  r = await ask('/agent cod ceva', { workspace: ws, coder: { model: 'x', available: async () => false } });
  assert.match(r.reply, /nu este disponibil/);
  // Failing tests after every round: still a patch, but a draft, with the failure quoted.
  r = await ask('/agent cod încearcă', { workspace: ws, coder: coderSays(BLOCK('  return 1;', '  return 5;'), BLOCK('  return 5;', '  return 6;')) });
  assert.equal(r.patch.draft, true);
  assert.match(r.reply, /Testele nu trec încă/);
});
