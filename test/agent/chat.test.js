/**
 * Talking to the agent in plain language: the short forms that still work, the documentation search
 * that answers questions, the guard on a model's answer, the patch policy, the Copilot-like code
 * request end to end with a fake coder and an in-memory workspace — and every deterministic answer,
 * in plain text, over the report and memory of a real fixture run, a conversation's follow-ups
 * included.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
import { CHAT_MARKER, ISSUE_MARKER, guardAnswer, testSummary, wrapReply } from '../../agent/domain/chat.js';
import { hasMarkup } from '../../agent/domain/plain.js';

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
/** Every answer is plain text: the invisible marker, sentences, one signature line — no Markdown. */
const isPlain = (r) => {
  assert.ok(r.reply.startsWith(`${CHAT_MARKER}\n`), 'the invisible marker first');
  assert.equal(hasMarkup(r.reply), false, `fără Markdown:\n${r.reply}`);
  assert.match(r.reply, /\n— Agentul AI al CRI Radar — .+\. Cercetare, nu sfat financiar\.$/, 'one signature line');
  return r.reply;
};

test('short forms: /agent prefix, optional diacritics, arguments over several lines, the help in plain text', () => {
  assert.equal(fold('Diagnoză Porți ȘȚ'), 'diagnoza porti st');
  assert.deepEqual(parseCommand('/agent diagnoză scan.run'), { id: 'diagnose', word: 'diagnoza', args: 'scan.run', llm: false, coder: false, ok: true, reason: null });
  assert.equal(parseCommand('Salut!\n/agent PORȚI cod').args, 'cod');
  assert.equal(parseCommand('/agent porti cod').id, 'gates');
  assert.equal(parseCommand('/agent stare?').id, 'status', 'punctuation after the word');
  assert.equal(parseCommand('/agent ?').id, 'help');
  const c = parseCommand('/agent cod adaugă un test\npentru pragul de lichiditate');
  assert.equal(c.id, 'code');
  assert.equal(c.args, 'adaugă un test\npentru pragul de lichiditate');
  assert.equal(parseCommand('/agent').id, 'help');
  assert.equal(parseCommand('/agent cum funcționează prognoza?').id, 'ask', 'a sentence without a command word is a question');
  assert.equal(parseCommand('nu e pentru agent', { requirePrefix: true }).ok, false, 'a comment without /agent is ignored');
  assert.equal(runIdOf('run 18842123456'), 18842123456);
  assert.equal(runIdOf('https://github.com/o/r/actions/runs/123456789/job/1'), 123456789);
  assert.equal(runIdOf('scan.run'), null);
  assert.equal(slugOf('Adaugă testul pentru Pragul de lichiditate!'), 'adauga-testul-pentru-pragul-de-lichidita');
  const h = helpText();
  assert.match(h, /^- \/agent cod <sarcina> — /m);
  assert.match(h, /^- \/agent schimbări \[interval\] — /m);
  assert.match(h, /^- \/agent semnale — /m);
  assert.equal(hasMarkup(h), false);
});

test('retrieval: the README passage that answers, found with folded diacritics and light stemming', async () => {
  const k = createKnowledgeFs();
  const docs = (await k.docs()).data;
  assert.ok(docs.some((d) => d.name === 'README.md'));
  const chunks = chunkDocs(docs);
  assert.ok(chunks.length > 30);
  const hit = search(chunks, 'cum vorbesc gratuit cu agentul din Termux', { k: 3 });
  assert.ok(hit.length, 'something answers');
  assert.ok(hit.some((h) => /vorbe|chat|Termux|conversa/i.test(`${h.heading} ${h.text}`)), hit.map((h) => h.heading).join(' | '));
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

test('answer guard: numbers only from the context, no links, no trading language; the reply is plain text', () => {
  const ctx = { passages: ['Prognoza ≥100× are rata de bază 0.21% pe zi.'], facts: { porti: { PASS: 33 } } };
  assert.equal(guardAnswer('Rata de bază ≥100× este 0,21% pe zi; 33 de porți trec.', ctx).ok, true);
  assert.match(guardAnswer('Rata de bază este 0,35% pe zi, după cele 33 de porți.', ctx).reasons.join(' '), /0,35/);
  assert.match(guardAnswer('Vezi https://exemplu.ro pentru detalii despre rata de 0.21%.', ctx).reasons.join(' '), /linkuri/);
  assert.match(guardAnswer('Cumpărați acum, rata de bază este 0.21% pe zi.', ctx).reasons.join(' '), /tranzacționare/);
  const w = wrapReply({ body: 'x'.repeat(70_000) });
  assert.ok(w.startsWith(CHAT_MARKER) && w.length <= 60_000);
  const md = wrapReply({ body: '## Titlu\n\n**Gras** și `cod`.', footer: 'Semnătura.' });
  assert.equal(hasMarkup(md), false, 'whatever reaches the reply loses its markup');
  assert.match(md, /^Titlu$/m);
  assert.match(md, /— Semnătura\.$/);
  assert.match(testSummary('ℹ tests 10\nnot ok 3 - something broke\nℹ fail 1'), /not ok 3/);
});

test('plain language over a real fixture run: state, gates, rules, learning, efficiency, forecast, signals, help', async () => {
  let r = await ask('cum stă radarul azi?');
  assert.equal(r.intent.intent, 'status');
  let t = isPlain(r);
  assert.match(t, /^(Totul e în regulă|Merge, dar \d+ (lucru cere|lucruri cer) atenție|Ceva nu merge)/m);
  assert.match(t, /Trec \d+ din \d+ (de )?porți/);
  assert.match(t, /Raportul este din \d{1,2} [a-z]+, \d{2}:\d{2}/, 'a local time, not an ISO stamp');
  assert.doesNotMatch(t, /\d{4}-\d{2}-\d{2}T/, 'no ISO time anywhere');
  r = await ask('ce porți de cadență nu trec?');
  t = isPlain(r);
  assert.match(t, /Cadență și programare/);
  assert.match(t, /cad\.scan/);
  assert.doesNotMatch(t, /ci\.syntax/, 'filtered by group');
  r = await ask('arată toate porțile');
  assert.match(isPlain(r), /^Trec:$/m);
  r = await ask('ce reguli nu trec?');
  t = isPlain(r);
  assert.match(t, /^Am \d+ (de )?reguli fundamentale \(versiunea /m);
  r = await ask('ce spune regula fc-2?');
  t = isPlain(r);
  assert.match(t, /^Regula FC-2, „Fără date din viitor[^”]*”: /m);
  assert.match(t, /^Acum (trece|este )/m);
  assert.match(t, /^(La singura rulare de până acum|În ultimele \d+ (de )?rulări)/m);
  r = await ask('toate regulile');
  assert.match(isPlain(r), /^- ID-1 /m);
  r = await ask('ce ai învățat?');
  t = isPlain(r);
  assert.match(t, /Din istoric am învățat \d+ (de )?norme/);
  assert.match(t, /Rulez din \d{1,2} [a-z]+, \d{2}:\d{2}/);
  r = await ask('cât de bine prinde radarul proiectele bune?');
  assert.equal(r.intent.intent, 'efficiency');
  isPlain(r);
  r = await ask('ce poți face?');
  t = isPlain(r);
  assert.match(t, /Îmi poți scrie în cuvintele tale/);
  assert.match(t, /„ce s-a schimbat de ieri\?”/);
  assert.match(t, /titlu începe cu „Agent”/);
  r = await ask('salut');
  assert.match(isPlain(r), /^Salut! Sunt agentul AI al CRI Radar\. La ultima verificare/m);
  r = await ask('mersi!');
  assert.match(isPlain(r), /^Cu plăcere!/m);
  // A project's forecast, by its symbol in any case, and the list of the highest probabilities.
  const rows = JSON.parse(await readFile(join(fx.outDir, 'universe.json'), 'utf8'));
  const k = rows.assets.fields.indexOf('symbol');
  const fcI = rows.assets.fields.indexOf('fc100');
  const sym = rows.assets.rows.find((x) => Number.isFinite(x[fcI]) && /^[A-Z]{3,}$/.test(x[k]))[k];
  r = await ask(`ce șanse are ${sym.toLowerCase()}?`);
  assert.equal(r.intent.intent, 'forecast');
  t = isPlain(r);
  assert.match(t, new RegExp(`^${sym} \\(`, 'm'));
  assert.match(t, /cel puțin 100 de ori prețul de azi în următoarele 12 luni este \d+(,\d+)?%/);
  r = await ask('care au cele mai mari probabilități de 100x?');
  assert.match(isPlain(r), /^1\. /m);
  r = await ask('ce șanse are NUEXISTA?');
  assert.match(isPlain(r), /NUEXISTA nu este în universul cercetat/);
  // The radar's signals: the research list, never a buy list.
  r = await ask('ce proiecte semnalează radarul?');
  assert.equal(r.intent.intent, 'signals');
  t = isPlain(r);
  assert.match(t, /^- [A-Z0-9]+ .*stadiul [12], oportunitate \d+(,\d)?, risc \d+/m);
  assert.match(t, /E o listă de cercetat, nu de cumpărat/);
});

test('what changed, and the follow-ups of a conversation', async () => {
  let r = await ask('ce s-a schimbat de ieri?');
  assert.equal(r.intent.intent, 'changes');
  let t = isPlain(r);
  assert.match(t, /^În ultimele 24 de ore \(de la \d{1,2} [a-z]+, \d{2}:\d{2}\):$/m);
  assert.match(t, /^- (Porțile sunt ca la început|Porțile: la început)/m);
  assert.match(t, /^- A apărut „[^”]+” \(în atenționare\), pe /m, 'the findings of the run are new');
  assert.match(t, /^Am făcut \d+ (verificare|verificări|de verificări) în acest interval/m);
  r = await ask('ce s-a schimbat în ultima oră?');
  assert.match(isPlain(r), /^În ultima oră /m);
  // „de ce?” after „cum stă radarul?” asks for the causes.
  r = await ask('de ce?', {}, { context: 'cum stă radarul azi?' });
  assert.equal(r.intent.followUp, true);
  assert.equal(r.intent.intent, 'diagnose');
  t = isPlain(r);
  assert.match(t, /^Am găsit \d+ probleme, cea mai gravă prima:$/m);
  assert.match(t, /^Ce verifică: /m);
  assert.match(t, /^Ce ajută: /m);
  // In the findings issue every follow-up is about the findings; „detalii” lists all of them.
  const issue = `Agent AI: porți de calitate care cer atenție\n${ISSUE_MARKER}\nStarea porților de calitate: atenționare.`;
  r = await ask('detalii', {}, { context: issue });
  assert.equal(r.intent.intent, 'diagnose');
  assert.doesNotMatch(isPlain(r), /Și încă \d+/, 'all of them');
  // „cum repar?” after a question about the scan is about the scan.
  r = await ask('cum repar?', {}, { context: 'de ce a picat scanarea?' });
  assert.equal(r.intent.entities.workflow, 'scan');
  assert.match(isPlain(r), /scan-and-deploy\.yml/);
  // „De ce?” after a forecast says where the number comes from, then the number.
  const rows = JSON.parse(await readFile(join(fx.outDir, 'universe.json'), 'utf8'));
  const k = rows.assets.fields.indexOf('symbol');
  const fcI = rows.assets.fields.indexOf('fc100');
  const sym = rows.assets.rows.find((x) => Number.isFinite(x[fcI]) && /^[A-Z]{3,}$/.test(x[k]))[k];
  r = await ask('de ce?', {}, { context: `ce șanse are ${sym}?` });
  assert.equal(r.intent.why, true);
  assert.match(isPlain(r), /^De unde vine cifra: pornesc de la rata de bază/m);
  r = await ask('de ce?', {}, { context: 'cât de bine prinde radarul proiectele bune?' });
  assert.match(isPlain(r), /^Cum măsor: /m);
  // A follow-up with nothing before it: the agent says what it would continue.
  r = await ask('detalii');
  assert.match(isPlain(r), /^Nu știu încă la ce se referă „detalii”/m);
  // A follow-up of an explanation goes on with the same question.
  r = await ask('de ce?', {}, { context: 'cum se calculează prognoza?' });
  assert.equal(r.intent.intent, 'ask');
  isPlain(r);
  // A request to start something: what the agent starts by itself and how to start it by hand.
  r = await ask('pornește o scanare');
  assert.equal(r.intent.intent, 'run');
  t = isPlain(r);
  assert.match(t, /^Din conversație nu pornesc workflow-uri/m);
  assert.match(t, /cel mult 4 ori pe zi, la cel puțin 4,5 ore/, 'the limits of agent/config.json');
  assert.match(t, /gh workflow run scan-and-deploy\.yml/);
});

/** The agent's command line, as agent-chat.yml and Termux run it (no network, no model). */
const cli = (args, env = {}) =>
  new Promise((done) => execFile(process.execPath, ['agent/main.js', ...args], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, CRI_AGENT_LLM: 'off', ...env }, timeout: 60_000 }, (err, stdout, stderr) => done({ code: err ? err.code ?? 1 : 0, stdout, stderr })));
const parsed = (out) => Object.fromEntries(out.trim().split('\n').map((l) => l.split('=')));

test('the workflow\'s first step: what a message asks, whether it needs the local model, whether it writes code', async () => {
  const parse = async (BODY, extra = {}) => parsed((await cli(['chat-parse', '--text-env', 'BODY'], { BODY, ...extra })).stdout);
  const conv = { CRI_AGENT_CONVERSATION: 'true' };
  assert.deepEqual(await parse('cum stă radarul?', conv), { cmd: 'status', ok: 'true', llm: 'false', coder: 'false' });
  assert.equal((await parse('cum stă radarul?')).ok, 'false', 'outside a conversation a comment needs /agent');
  assert.equal((await parse('/agent cum stă radarul?')).cmd, 'status');
  assert.deepEqual(await parse('scrie un test pentru pragul de lichiditate', conv), { cmd: 'code', ok: 'true', llm: 'true', coder: 'true' });
  assert.equal((await parse('cod de eroare la scanare', conv)).coder, 'false');
  assert.equal((await parse('cum se calculează prognoza?', conv)).llm, 'true', 'an explanation is phrased by the local model');
  // A follow-up is read in its thread (here the issue's first message, as the workflow passes it).
  assert.deepEqual(await parse('de ce?', { ...conv, CRI_AGENT_CONTEXT: 'Agent AI — întrebare\ncum stă radarul?' }), { cmd: 'diagnose', ok: 'true', llm: 'false', coder: 'false' });
  assert.equal((await parse('de ce?', { ...conv, CRI_AGENT_CONTEXT: 'cum se calculează prognoza?' })).cmd, 'ask');
});

test('the terminal: one question in plain language, the answer written where the workflow reads it', async () => {
  const out = join(dir, 'cli-chat');
  const now = new Date(base.clock.t + 60_000).toISOString();
  const r = await cli(['chat', '--text-env', 'BODY', '--memory', join(dir, 'mem'), '--report', join(dir, 'report'), '--state', fx.stateDir, '--data', fx.outDir, '--reply-dir', out, '--now', now], { BODY: 'ce s-a schimbat de ieri?' });
  assert.equal(r.code, 0, r.stderr);
  const reply = await readFile(join(out, 'reply.md'), 'utf8');
  assert.ok(reply.startsWith(CHAT_MARKER));
  assert.equal(hasMarkup(reply), false, reply);
  assert.match(reply, /^În ultimele 24 de ore \(de la /m);
  const r2 = await cli(['chat', '--memory', join(dir, 'mem'), '--report', join(dir, 'report'), '--state', fx.stateDir, '--data', fx.outDir, '--now', now, 'pornește', 'o', 'scanare']);
  assert.equal(r2.code, 0, r2.stderr);
  assert.match(r2.stdout, /^Din conversație nu pornesc workflow-uri/m, 'the words of a question need no quotes');
  assert.doesNotMatch(r2.stdout, /<!--/, 'the terminal shows no marker');
});

test('diagnosis in plain language: a gate with its lessons, a run step by step, a workflow by name', async () => {
  let r = await ask('de ce e cadența scanării în atenționare?');
  let t = isPlain(r);
  assert.match(t, /^„Cadența scanării complete” \(cad\.scan\) este acum în atenționare/m);
  assert.match(t, /^Ce verifică: /m);
  assert.match(t, /„17 \*\/4 \* \* \*”/, 'the cron expression survives the plain text');
  // The simulated history has a scan whose push to the state branch was denied.
  const failed = base.ports.inspect.runs('scan-and-deploy.yml').find((x) => x.fail === 'push' && x.createdAt < base.clock.t);
  r = await ask(`de ce a picat rularea ${failed.id}?`);
  assert.equal(r.intent.entities.runId, failed.id);
  t = isPlain(r);
  assert.match(t, /^Rularea \d+ a workflow-ului Scan & deploy \(programată, .+\) a eșuat\.$/m);
  assert.match(t, /^A căzut la pasul „Save research state/m);
  assert.match(t, /\(PUSH_DENIED\)/);
  assert.match(t, /Read and write permissions/);
  assert.match(t, /Data trecută aceeași problemă s-a rezolvat prin commitul [0-9a-f]{7}/);
  r = await ask(`/agent diagnoză run ${failed.id}`);
  assert.match(isPlain(r), /^A căzut la pasul/m, 'the short form still works');
  r = await ask('de ce a picat scanarea?');
  t = isPlain(r);
  assert.match(t, /^(Ultima rulare a scan-and-deploy\.yml|Rularea \d+)/m);
  r = await ask('ce probleme sunt?');
  assert.match(isPlain(r), /^Am găsit \d+ probleme|^Nu văd nicio problemă/m);
});

test('a free question: passages quoted without a model; a model answer published only when the guard accepts it', async () => {
  let r = await ask('ce înseamnă eficiența identificării?');
  assert.equal(r.intent.intent, 'ask');
  assert.equal(r.by, 'retrieval');
  let t = isPlain(r);
  assert.match(t, /^Iată ce scrie în documentația proiectului despre asta:$/m);
  assert.match(t, /^\(din (README\.md|docs\/ARCHITECTURE\.md|agent\/knowledge\/rules\.json), „[^”]+”\)$/m);
  const narrator = (text) => ({ model: 'fake-3b', available: async () => true, generate: async () => ({ ok: true, status: 'OK', data: text }) });
  r = await ask('ce înseamnă lift?', { narrator: narrator('**Lift-ul** este rata de reușită a unui nivel împărțită la rata universului.\n\n- se citește ca „de câte ori”') });
  assert.equal(r.by, 'llm:fake-3b');
  t = isPlain(r);
  assert.match(t, /^Lift-ul este rata/m, 'the model markup is removed');
  assert.match(t, /\(Din documentație: „[^”]+”/);
  r = await ask('ce înseamnă lift?', { narrator: narrator('Lift-ul garantat este 7,77 în fiecare săptămână.') });
  assert.equal(r.by, 'retrieval', 'an invented number sends the answer back to the passages');
  assert.match(isPlain(r), /garda l-a respins/);
});

test('an unclear message: the local model classifies it within the vocabulary, or the answer stays a question', async () => {
  const classifier = (json) => ({ model: 'fake-3b', available: async () => true, generate: async (p) => ({ ok: true, status: 'OK', data: /Intenții posibile/.test(p.prompt) ? json : 'Un răspuns oarecare fără cifre inventate, doar despre documentație.' }) });
  let r = await ask('chestia aia de care îți spuneam, cu ceasul', { narrator: classifier('{"intent": "diagnose", "gate": "cad.scan"}') });
  assert.equal(r.intent.intent, 'diagnose');
  assert.match(r.intent.reason, /încadrat de modelul local/);
  assert.match(isPlain(r), /cad\.scan/);
  r = await ask('mă gândeam la ceva', { narrator: classifier('{"intent": "drop_database"}') });
  assert.equal(r.intent.intent, 'ask', 'outside the vocabulary the model is ignored');
  isPlain(r);
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

test('code in plain language: the coder edits, the tests run, one repair round after a failure, a patch for the pull request', async () => {
  const ws = fakeWorkspace({ 'src/domain/f.js': 'export function f() {\n  return 1;\n}\n', 'test/domain/f.test.js': "test('f', () => assert.equal(f(), 2));\n" });
  // First answer breaks nothing but does not fix the test; the repair round fixes it.
  const coder = coderSays(BLOCK('  return 1;', '  return 3;'), BLOCK('  return 3;', '  return 2;'));
  const r = await ask('modifică funcția f() din src/domain/f.js să întoarcă 2', { workspace: ws, coder }, { issue: 12, author: 'owner' });
  assert.equal(r.intent.intent, 'code', 'a verb of making and a thing of code');
  assert.equal(coder.calls.length, 2, 'one repair round');
  assert.match(coder.calls[1].prompt, /Testele au eșuat/);
  assert.match(coder.calls[0].system, /hexagonal/i, 'the architecture rules are in the prompt');
  assert.match(coder.calls[0].prompt, /FILE: src\/domain\/f\.js/, 'the file named in the task is in context');
  assert.ok(r.patch, r.reply);
  assert.equal(r.patch.draft, false, 'tests pass → a ready pull request');
  assert.match(r.patch.branch, /^agent\/12-modifica-functia-f/);
  assert.match(r.patch.body, /cerută de @owner/);
  assert.match(r.patch.body, /eu nu fac merge și nu scriu niciodată în main/);
  assert.equal(hasMarkup(r.patch.body.replace(CHAT_MARKER, '')), false, 'the pull request is plain text too');
  const t = isPlain(r);
  assert.match(t, /^Am scris codul și testele trec \(2 runde, cu modelul local fake-coder-7b\)\.$/m);
  assert.match(t, /^Deschid pull requestul pe ramura agent\/12-/m);
  assert.equal(ws.files.get('src/domain/f.js'), 'export function f() {\n  return 2;\n}\n');
});

test('code: a protected file is refused, a model without blocks gets no patch, nothing works without a workspace or a model', async () => {
  const ws = fakeWorkspace({ 'src/domain/f.js': 'export function f() {\n  return 1;\n}\n' });
  let r = await ask('/agent cod slăbește testul de arhitectură', { workspace: ws, coder: coderSays(BLOCK('x', 'y', 'test/architecture.test.js')) });
  assert.equal(r.patch, null);
  assert.match(isPlain(r), /fișier protejat/);
  r = await ask('/agent cod ceva', { workspace: ws, coder: coderSays('Nu pot.') });
  assert.equal(r.patch, null);
  assert.match(r.reply, /nu conține blocuri de editare/);
  assert.equal(ws.files.get('src/domain/f.js'), 'export function f() {\n  return 1;\n}\n', 'the workspace is unchanged');
  r = await ask('/agent cod ceva');
  assert.match(isPlain(r), /workflow-ul „Agent AI — chat”/);
  r = await ask('/agent cod ceva', { workspace: ws, coder: { model: 'x', available: async () => false } });
  assert.match(r.reply, /nu este disponibil/);
  // Failing tests after every round: still a patch, but a draft, with the failure quoted.
  r = await ask('/agent cod încearcă', { workspace: ws, coder: coderSays(BLOCK('  return 1;', '  return 5;'), BLOCK('  return 5;', '  return 6;')) });
  assert.equal(r.patch.draft, true);
  const t = isPlain(r);
  assert.match(t, /^Am scris codul, dar testele încă nu trec/m);
  assert.match(t, /^Ce pică:$/m);
  // In a conversation, a sentence that only mentions code is not a request to write it.
  r = await ask('cod de eroare la scanare', { workspace: ws, coder: coderSays('nimic') }, { commandWords: false });
  assert.notEqual(r.intent.intent, 'code');
  assert.equal(r.patch, null);
});
