/**
 * Plain language: what the owner means when he writes in his own words — with or without
 * diacritics, without command words, in a thread („de ce?” after a question), in Romanian or English.
 * Every case here is a sentence the owner could type on a phone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE_MARKER } from '../../agent/domain/chat.js';
import { INTENTS, classifyPrompt, gatesIn, isFollowUp, parseClassification, symbolIn, threadContext, understand, windowOf } from '../../agent/domain/intent.js';

const symbols = new Set(['LAB', 'BTW', 'HEL', 'TAH', 'AKE', 'PIPPIN', 'IRYS', 'BANK', 'AI', 'EAT', 'TSI']);
const say = (text, o = {}) => understand(text, { symbols, commandWords: false, ...o });

const CASES = {
  status: ['cum stă radarul azi?', 'cum merge proiectul', 'e totul ok?', 'ce mai face radarul', 'how is the radar doing?', 'salut, cum stă radarul azi?', 'Totul e în regulă?', 'cum stă radarul?', 'cum stă proiectul cu prognoza?', 'stare'],
  changes: ['ce s-a schimbat de ieri?', 'ce s-a schimbat?', 'ce e nou?', 'ce noutăți sunt?', 'ce s-a întâmplat azi?', 'ce s-a întâmplat peste noapte?', 'what changed since yesterday?', 'ce s-a schimbat săptămâna asta?', 'ce ai făcut azi?'],
  diagnose: [
    'de ce a picat scanarea?', 'de ce a eșuat scanarea de azi', 'ce nu merge la site?', 'de ce e roșu CI-ul?', 'nu se mai actualizează datele', 'repară scanarea', 'why did the scan fail?', 'ce probleme sunt?', 'de ce sare GitHub scanările?',
    'diagnoza run 18842123456', 'cod de eroare la scanare', 'ce s-a întâmplat cu scanarea?', 'ajutor, nu merge site-ul', 'Întrebare: de ce a picat scanarea?', 'poarta de validitate?', 'și pulsul?', 'scanarea?', 'De ce nu s-a actualizat dashboard-ul?', 'De ce e pulsul galben?',
    'sunt probleme?', 'e ceva grav?', 'cum stă CI-ul?', 'cum stă scanarea?', 'când a fost ultima scanare?', 'nu pornește scanarea', 'pulsul rulează?',
  ],
  gates: ['ce porți nu trec?', 'arată toate porțile', 'porti grupul cadenta', 'porți cadența', 'porțile de cadență'],
  efficiency: ['cât de bine prinde radarul proiectele bune?', 'care e eficiența identificării', 'bate radarul piața?', 'ce lift are banda timpuriu'],
  forecast: ['ce șanse are LAB?', 'ce sanse are lab', 'prognoza pentru HEL', 'care au cele mai mari probabilități de 100x?', 'poate face BTW 20x?', 'LAB?', '$TAH', 'care proiecte au cele mai mari șanse de 100x?', 'prognoza LAB', 'Merită LAB?', 'Ce părere ai despre LAB?', 'Spune-mi ceva despre BTW', 'LAB e scam?'],
  signals: ['ce proiecte semnalează radarul?', 'ce proiecte sunt interesante acum?', 'ce oportunități vezi azi?', 'ce a găsit radarul azi?', 'ce merită cercetat?', 'care sunt candidații de research timpuriu?', 'ce să urmăresc?', 'semnale', 'Care e cel mai bun proiect acum?'],
  rules: ['ce reguli nu trec?', 'ce spune regula ID-5?', 'FC-4', 'care sunt pragurile de evaluare', 'reguli fc-2'],
  learning: ['ce ai învățat?', 'cum te autoevaluezi', 'cât de bine anticipezi?'],
  run: ['pornește o scanare', 'te rog pornește scanarea', 'poți porni pulsul?', 'rulează CI-ul pe ramura mea'],
  code: ['scrie un test pentru pragul de lichiditate', 'adaugă în cod o funcție care rotunjește prețul', 'fă un pull request care repară mesajul de eroare', 'repară bug-ul din src/domain/forecast/model.js', 'write a test for slugOf', '/agent cod adaugă un test'],
  help: ['ce poți face?', 'ajutor', '/agent', 'Cine ești?'],
  greet: ['Salut', 'mulțumesc!', 'ok', 'bine, mersi', 'am înțeles', 'Salut, ce mai faci?', 'Ce faci?', 'Ești acolo?'],
  ask: ['cum se calculează prognoza?', 'ce înseamnă lift?', 'explică-mi poarta de validitate', 'de ce nu se schimbă pragul de 75?', 'cum funcționează agentul?', 'ce surse gratuite folosește proiectul', 'ceva fără legătură despre vreme', 'întreabă cum se calculează prognoza', 'ce înseamnă oportunitate?', 'cum se calculează oportunitatea?', 'ce surse de date folosești?', 'cât de des rulezi?'],
};

test('plain language: every intent from sentences the owner could type, with or without diacritics', () => {
  const wrong = [];
  let total = 0;
  for (const [want, texts] of Object.entries(CASES)) {
    for (const t of texts) {
      total += 1;
      const u = say(t);
      if (u.intent !== want) wrong.push(`„${t}” → ${u.intent}, nu ${want}`);
      // Without diacritics the same sentence means the same thing.
      const bare = t.normalize('NFD').replace(/\p{M}/gu, '');
      if (bare !== t && say(bare).intent !== u.intent) wrong.push(`„${bare}” (fără diacritice) → ${say(bare).intent}, nu ${u.intent}`);
    }
  }
  assert.deepEqual(wrong, [], `${wrong.length} din ${total}`);
  assert.ok(total >= 110, `${total} de propoziții`);
  for (const k of Object.keys(CASES)) assert.ok(INTENTS.includes(k), k);
});

test('plain language: the entities a sentence names — a run, a workflow, a gate, a rule, a symbol, a group', () => {
  let u = say('de ce a picat rularea https://github.com/o/r/actions/runs/123456789/job/1?');
  assert.equal(u.intent, 'diagnose');
  assert.equal(u.entities.runId, 123456789);
  u = say('de ce a picat scanarea?');
  assert.equal(u.entities.workflow, 'scan');
  assert.ok(u.entities.gates.includes('scan.run'));
  assert.equal(say('ce spune regula id 5?').entities.ruleId, null, 'a rule id needs its dash');
  assert.equal(say('ce spune regula ID-5?').entities.ruleId, 'ID-5');
  assert.equal(say('porțile de cadență').entities.group, 'cadenta');
  assert.equal(say('porțile agentului').entities.group, 'agent');
  assert.equal(say('arată toate porțile').entities.all, true);
  // Symbols: capitals or $, or a known symbol in any case — never a common word.
  assert.equal(symbolIn('ce șanse are LAB?'), 'LAB');
  assert.equal(symbolIn('ce sanse are lab', symbols), 'LAB');
  assert.equal(symbolIn('$tah merită?'), 'TAH');
  assert.equal(symbolIn('ce face BANK', symbols), 'BANK');
  assert.equal(symbolIn('ce face bank azi', symbols), null, '„bank” written small is a word');
  assert.equal(symbolIn('CE AI FĂCUT AZI'), null, 'Romanian words in capitals are not symbols');
  assert.equal(symbolIn('ce sanse are XYZ?', symbols), null, 'an unknown capital word is not a symbol when the universe is known');
  const aia = new Set(['AIA']);
  assert.equal(say('chestia aia de care vorbeam', { symbols: aia }).entities.symbol, null, 'a word that is also a ticker stays a word in an ordinary sentence');
  assert.equal(say('ce șanse are aia?', { symbols: aia }).entities.symbol, 'AIA', 'but not in a sentence about a project');
  assert.equal(symbolIn('aia', aia, { lower: false }), null);
  // A project the radar does not know is named as such („XYZ nu este în univers”), never a word or a workflow.
  assert.equal(say('ce șanse are XYZQ?').entities.unknownSymbol, 'XYZQ');
  assert.equal(say('ce șanse are BTC?').entities.unknownSymbol, 'BTC', 'a giant is not in the small-cap universe');
  assert.equal(say('ce șanse are LAB?').entities.unknownSymbol, null);
  assert.equal(say('DE CE A PICAT CI-UL?').entities.unknownSymbol, null);
  assert.equal(say('cum stă LAB?').intent, 'forecast', 'the state of a project is its forecast');
  assert.deepEqual(gatesIn('poarta scan.validity și cad.pulse', [{ id: 'scan.validity' }, { id: 'cad.pulse' }]), ['scan.validity', 'cad.pulse']);
  assert.ok(gatesIn('cadența pulsului').includes('cad.pulse'));
});

test('plain language: the short forms decide only after /agent; elsewhere they are hints', () => {
  // After /agent the command word decides, as before.
  let u = say('/agent porti cadenta');
  assert.equal(u.explicit, true);
  assert.equal(u.intent, 'gates');
  assert.equal(u.entities.group, 'cadenta');
  u = say('/agent cod adaugă un test\npentru pragul de lichiditate');
  assert.equal(u.intent, 'code');
  assert.equal(u.coder, true);
  assert.equal(u.args, 'adaugă un test\npentru pragul de lichiditate');
  assert.equal(say('Salut!\n/agent stare').intent, 'status');
  // „întreabă” only introduces the question: the rest is understood.
  u = say('/agent întreabă de ce a picat scanarea?');
  assert.equal(u.intent, 'diagnose');
  assert.equal(u.text, 'de ce a picat scanarea?');
  // In a conversation „cod” is not an order; on the terminal it is.
  assert.notEqual(say('cod de eroare la scanare').intent, 'code');
  assert.equal(understand('cod adaugă un test', { commandWords: true }).intent, 'code');
  assert.equal(understand('cod adaugă un test', { commandWords: true }).explicit, true);
  // „ajutor” alone is the help; „ajutor, …” is a call for help with something.
  assert.equal(say('ajutor').intent, 'help');
  assert.equal(say('/agent ajutor, nu merge site-ul').intent, 'diagnose');
  // Outside a conversation a comment must start with /agent (the workflow's check, repeated here).
  assert.equal(understand('nu e pentru agent', { requirePrefix: true }).ok, false);
  assert.equal(understand('/agent cum stă radarul?', { requirePrefix: true }).intent, 'status');
  // An empty message is a request for help; code is asked for explicitly or not at all.
  assert.equal(say('').intent, 'help');
  for (const t of ['repară scanarea', 'schimbă-ți părerea despre LAB', 'ce cod de eroare are scanarea?']) assert.notEqual(say(t).intent, 'code', t);
  assert.equal(say('scrie un test pentru pragul de lichiditate').llm, true, 'code needs the local model');
  assert.equal(say('cum stă radarul?').llm, false, 'a deterministic answer needs no model');
});

test('plain language: a short follow-up takes its topic and its subject from the thread', () => {
  const after = (t, context) => say(t, { context });
  let u = after('de ce?', 'cum stă radarul azi?');
  assert.equal(u.intent, 'diagnose');
  assert.equal(u.followUp, true);
  assert.equal(u.topic, 'status');
  u = after('cum repar?', 'de ce a picat scanarea?');
  assert.equal(u.intent, 'diagnose');
  assert.equal(u.entities.workflow, 'scan', 'the subject comes from the question before');
  assert.equal(after('și acum?', 'de ce a picat scanarea?').entities.workflow, 'scan');
  u = after('detalii', 'cum stă radarul?');
  assert.equal(u.intent, 'gates');
  assert.equal(u.entities.all, true, '„detalii” asks for the whole list');
  u = after('de ce?', 'ce șanse are LAB?');
  assert.equal(u.intent, 'forecast');
  assert.equal(u.entities.symbol, 'LAB');
  u = after('de ce?', 'cum se calculează prognoza?');
  assert.equal(u.intent, 'ask');
  assert.match(u.args, /cum se calculează prognoza\? — de ce\?/, 'an explanation goes on with the same question');
  assert.equal(after('detalii', 'ce proiecte semnalează radarul?').intent, 'signals');
  assert.equal(after('de ce?', 'ce s-a schimbat de ieri?').intent, 'diagnose');
  assert.equal(after('detalii', 'ce s-a schimbat săptămâna asta?').intent, 'changes');
  // The agent's findings issue: the thread is about the findings.
  const findings = `${ISSUE_MARKER}\nStarea porților de calitate: atenționare.\nCadența pulsului (atenționare): 49 de rulări în 7 zile.`;
  u = after('de ce?', findings);
  assert.equal(u.intent, 'diagnose');
  assert.deepEqual(u.entities.gates, [], 'about every finding, not one');
  assert.equal(after('detalii', findings).entities.all, true);
  // Not a follow-up: a question of its own, a new subject, or a thread that had no topic.
  assert.equal(after('de ce contează lift-ul?', 'cât de bine prinde radarul?').followUp, false);
  assert.equal(after('și LAB?', 'ce șanse are BTW?').entities.symbol, 'LAB');
  assert.equal(after('de ce?', 'salut').followUp, false);
  assert.equal(say('de ce?').followUp, false, 'without a thread there is nothing to continue');
  assert.equal(say('de ce?').orphan, true, '… and the agent says so instead of guessing');
  assert.equal(say('detalii').intent, 'help');
  // A follow-up never writes code.
  assert.notEqual(after('și acum?', 'scrie un test pentru pragul de lichiditate').intent, 'code');
});

test('plain language: in a GitHub thread a follow-up continues the owner\'s previous question', () => {
  for (const t of ['de ce?', 'De ce?!', 'cum repar?', 'detalii', 'și acum?', 'ok, și?', '/agent de ce?']) assert.equal(isFollowUp(t), true, t);
  for (const t of ['de ce a picat scanarea?', 'cum stă radarul?', 'ce șanse are LAB?', '']) assert.equal(isFollowUp(t), false, t);
  // The latest earlier message that is not itself a follow-up, else the issue.
  assert.equal(threadContext(['cum stă radarul?', 'ce șanse are LAB?', 'de ce?'], 'Agent AI — întrebare\nsalut'), 'ce șanse are LAB?');
  assert.equal(threadContext(['/agent de ce a picat scanarea?'], null), 'de ce a picat scanarea?');
  assert.equal(threadContext([], 'Agent AI — întrebare\ncum stă radarul?'), 'Agent AI — întrebare\ncum stă radarul?');
  assert.equal(threadContext(['de ce?', 'detalii'], '  '), null);
  const ctx = threadContext(['ce șanse are LAB?', 'de ce?'], null);
  assert.equal(say('de ce?', { context: ctx }).entities.symbol, 'LAB');
});

test('plain language: the time window of „what changed”', () => {
  assert.deepEqual(windowOf('ce s-a schimbat de ieri?'), { hours: 24, named: true });
  assert.deepEqual(windowOf('ce s-a schimbat?'), { hours: 24, named: false });
  assert.equal(windowOf('în ultimele 6 ore').hours, 6);
  assert.equal(windowOf('în ultimele 3 zile').hours, 72);
  assert.equal(windowOf('ce s-a schimbat săptămâna asta?').hours, 168);
  assert.equal(windowOf('în ultima oră').hours, 1);
  assert.equal(windowOf('luna asta').hours, 720);
  assert.equal(windowOf('last 2 days').hours, 48);
  assert.equal(windowOf('în ultimele 999 de zile').hours, 24 * 90, 'capped at 90 days');
});

test('plain language: a local model may classify an unclear message, only within the vocabulary', () => {
  const p = classifyPrompt('chestia aia cu graficul');
  assert.match(p.system, /JSON/);
  for (const k of ['status', 'changes', 'signals', 'run', 'code', 'ask']) assert.match(p.prompt, new RegExp(`^${k} = `, 'm'));
  const catalogue = [{ id: 'scan.run' }, { id: 'cad.pulse' }];
  assert.deepEqual(parseClassification('Sigur: {"intent": "diagnose", "symbol": null, "gate": "cad.pulse", "rule": null}', { catalogue }), { intent: 'diagnose', symbol: null, gate: 'cad.pulse', rule: null });
  assert.equal(parseClassification('{"intent": "forecast", "symbol": "$lab"}', { symbols }).symbol, 'LAB');
  assert.equal(parseClassification('{"intent": "forecast", "symbol": "NOPE"}', { symbols }).symbol, null, 'an unknown symbol is dropped');
  assert.equal(parseClassification('{"intent": "diagnose", "gate": "rm -rf"}', { catalogue }).gate, null, 'an unknown gate is dropped');
  assert.equal(parseClassification('{"intent": "delete_everything"}'), null, 'an intent outside the vocabulary is ignored');
  assert.equal(parseClassification('{"intent": "greet"}'), null);
  assert.equal(parseClassification('nu știu'), null);
  assert.equal(parseClassification('{intent: diagnose'), null);
});
