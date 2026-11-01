/**
 * CHAT — the owner talks to the agent in plain language and gets plain text back, free: a comment
 * on GitHub (in an issue whose title starts with „Agent”, or any comment that starts with /agent),
 * the terminal (`npm run agent:chat`, Termux included), or the dashboard's link to a new question.
 *
 * The message is understood without a model (agent/domain/intent.js): what is asked (state, what
 * changed, a failure, the radar's signals, the identification efficiency, a project's forecast, the
 * rules, what the agent learned, an explanation, code) and what it is about (a run, a workflow, a
 * gate, a rule, a symbol, a time window). A short follow-up („de ce?”, „detalii”) takes its topic from
 * the context: the issue it is written in, or the previous line on the terminal. When the cues are
 * unsure and a local model is available, the model classifies — within the same vocabulary.
 *
 *   state · changes · failures · signals · efficiency · forecast · rules · learning   deterministic,
 *       from the report, the memory and the research state (and, for a run, from GitHub's own record
 *       of its steps)
 *   a free question   the documentation's passages that answer (BM25), phrased by the local model when
 *       it is available, only if every number in its answer comes from the context
 *   code   Copilot-like: the local coder model writes SEARCH/REPLACE edits, the agent applies them
 *       under the patch policy, runs the test suite, gives the model one round to repair a failure,
 *       and hands back a diff — which agent-chat.yml turns into a pull request on an agent/… branch.
 *       The agent never merges and never writes to main.
 *
 * Every port is optional; a missing one makes its answer say what it needs.
 */
import { slugOf } from '../domain/commands.js';
import { conclusionRo, answerChanges, answerEfficiency, answerForecast, answerGates, answerGreet, answerHelp, answerLearning, answerRules, answerRun, answerSignals, answerStatus, askPrompt, codePrompt, diagnoseAll, diagnoseGate, diagnoseRun, guardAnswer, prBody, retrievalAnswer, testSummary, wrapReply } from '../domain/chat.js';
import { classifyPrompt, parseClassification, understand, windowOf } from '../domain/intent.js';
import { buildFacts } from '../domain/narrative.js';
import { applyEdits, parseEdits, pathViolations, validateChange } from '../domain/patch.js';
import { DEFAULT_TZ, cut, isoText, list, n, plain, ro, roText, when } from '../domain/plain.js';
import { chunkDocs, excerpt, rankFiles, search } from '../domain/retrieval.js';
import { classify } from '../domain/signatures.js';
import { decodeTable } from './observe.js';

const TEXT_FILE = /\.(js|mjs|json|md|css|html|yml|yaml)$/i;
const SKIP_DIRS = /^(data|dist|node_modules|\.agent|\.state|\.cri-state|config\/labels|docs\/img)\b/;

/* ───────────────────────────── diagnosis ───────────────────────────── */

async function runDiagnosis(ci, runId, memory, tz) {
  const rR = await ci.run(runId);
  if (!rR.ok) return `Nu am putut citi rularea ${runId} (${rR.status}${rR.message ? `: ${rR.message}` : ''}).`;
  const run = rR.data;
  const jR = await ci.jobs(runId);
  const jobs = jR.ok ? jR.data : [];
  const annotations = [];
  for (const j of jobs.slice(0, 4)) {
    const aR = await ci.annotations(j.id);
    if (aR.ok) annotations.push(...aR.data);
  }
  const failedSteps = jobs.flatMap((j) => (j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => s.name));
  const signature = classify([...failedSteps, ...annotations.map((a) => `${a.title ?? ''} ${a.message ?? ''}`)]);
  let lastSuccess = null;
  let commits = [];
  if (run.file) {
    const runs = await ci.runs(run.file, 100);
    if (runs.ok) {
      const t = Date.parse(run.createdAt);
      lastSuccess = runs.data.filter((x) => x.conclusion === 'success' && Date.parse(x.createdAt) < t).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
      if (lastSuccess) {
        const ciRuns = run.file === 'ci.yml' ? runs : await ci.runs('ci.yml', 100);
        const from = Date.parse(lastSuccess.createdAt);
        const seen = new Set();
        commits = (ciRuns.ok ? ciRuns.data : [])
          .filter((x) => x.event === 'push' && Date.parse(x.createdAt) > from && Date.parse(x.createdAt) <= t && !seen.has(x.headSha) && seen.add(x.headSha))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .map((x) => ({ sha: x.headSha, message: x.message, at: x.createdAt }));
      }
    }
  }
  return diagnoseRun({ run, jobs, annotations, signature, memory, commits, lastSuccess, tz });
}

/** The workflow file a workflow word names. */
const WORKFLOW_FILE = { scan: 'scan-and-deploy.yml', pulse: 'pulse.yml', probe: 'probe.yml', labels: 'labels.yml', ci: 'ci.yml' };
const WORKFLOW_GATE = { scan: 'scan.run', pulse: 'cad.pulse', probe: 'per.probe', labels: 'per.labels', ci: 'ci.run' };
const FAILED = ['failure', 'timed_out', 'startup_failure'];

/** The last time a gate failed and what ended it, from the memory. */
function lastLesson(memory, gateId, tz) {
  const inc = (memory?.incidents ?? []).filter((i) => i.gate === gateId && i.resolvedAt).sort((a, b) => Date.parse(b.resolvedAt) - Date.parse(a.resolvedAt))[0];
  if (!inc) return '';
  const fix = inc.resolvedBy?.sha ? `prin commitul ${String(inc.resolvedBy.sha).slice(0, 7)} („${cut(inc.resolvedBy.message, 90)}”)` : 'de la sine';
  return `\n\nUltima dată a picat pe ${when(inc.firstSeen, tz)}: ${cut(roText(isoText(plain(inc.evidence), tz)), 200)} S-a rezolvat ${fix}${Number.isFinite(inc.durationHours) ? `, după ${ro(inc.durationHours, 1)} ore` : ''}.`;
}

async function diagnose({ ports, report, memory, e, tz }) {
  if (e.runId) return ports.ci?.run ? runDiagnosis(ports.ci, e.runId, memory, tz) : 'Ca să citesc o rulare am nevoie de API-ul GitHub: setează GITHUB_REPOSITORY (și opțional GITHUB_TOKEN).';
  const byId = (id) => (report?.gates ?? []).find((g) => g.id === id);
  // A gate named in the message, the failing one first.
  const named = (e.gates ?? []).map(byId).filter(Boolean);
  const gate = named.find((g) => g.status === 'FAIL' || g.status === 'WARN') ?? (e.workflow ? byId(WORKFLOW_GATE[e.workflow]) : null) ?? named[0] ?? null;
  // A workflow named in the message: how its latest run ended, then the latest failure told step by step.
  if (e.workflow && ports.ci?.runs) {
    const file = WORKFLOW_FILE[e.workflow];
    const runs = await ports.ci.runs(file, 30);
    if (runs.ok) {
      const done = runs.data.filter((r) => r.status === 'completed').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const latest = done[0] ?? null;
      const failed = done.find((r) => FAILED.includes(r.conclusion)) ?? null;
      const gateText = gate && gate.status !== 'PASS' ? diagnoseGate(report, memory, gate.id, { tz }) : null;
      if (failed && latest?.id === failed.id) return [await runDiagnosis(ports.ci, failed.id, memory, tz), gateText].filter(Boolean).join('\n\n');
      const last = latest ? `ultima rulare a ${file} ${conclusionRo(latest.conclusion)} pe ${when(latest.createdAt, tz)}` : null;
      const earlier = failed ? ` Ultima eșuată dintre cele ${done.length} recente a fost pe ${when(failed.createdAt, tz)} (rularea ${failed.id}); întreabă-mă de ea dacă vrei pașii.` : '';
      // The runs work, the gate does not (a cadence, a quota, a source): the gate is the answer.
      if (gateText) return [gateText, last ? `${latest.conclusion === 'success' ? 'Rulările în sine merg: ' : ''}${latest.conclusion === 'success' ? last : `${last[0].toUpperCase()}${last.slice(1)}`}.${earlier}` : null].filter(Boolean).join('\n\n');
      const head = last ? `${last[0].toUpperCase()}${last.slice(1)}${latest.conclusion === 'success' ? ', deci acum merge' : ''}.` : `Nu văd rulări încheiate pentru ${file}.`;
      if (failed) return `${head} Ultima rulare eșuată dintre cele ${done.length} recente:\n\n${await runDiagnosis(ports.ci, failed.id, memory, tz)}`;
      return `${head} Nicio rulare eșuată printre ultimele ${done.length}.${lastLesson(memory, WORKFLOW_GATE[e.workflow], tz)}`;
    }
  }
  if (gate && report) {
    const d = diagnoseGate(report, memory, gate.id, { tz });
    const id = /actions\/runs\/(\d+)/.exec(gate.link ?? '')?.[1];
    if (id && gate.status !== 'PASS' && ports.ci?.run) return `${d}\n\n${await runDiagnosis(ports.ci, Number(id), memory, tz)}`;
    return d;
  }
  return diagnoseAll(report, memory, { tz, all: e.all });
}

/* ───────────────────────────── a free question ───────────────────────────── */

async function ask({ ports, report, question, logger }) {
  if (!question) return { body: answerHelp(), by: 'deterministic' };
  const docsR = ports.knowledge ? await ports.knowledge.docs() : null;
  const chunks = docsR?.ok ? chunkDocs(docsR.data) : [];
  const rulesR = ports.knowledge ? await ports.knowledge.rules() : null;
  if (rulesR?.ok) for (const r of rulesR.data.rules ?? []) chunks.push({ doc: 'agent/knowledge/rules.json', heading: `${r.id} ${r.title}`, path: `Reguli › ${r.id} ${r.title}`, text: `${r.rule}${r.why ? ` ${r.why}` : ''}` });
  const passages = search(chunks, question, { k: 4 });
  const facts = report ? buildFacts(report) : {};
  const narrator = ports.narrator;
  if (narrator && passages.length && (await narrator.available())) {
    const r = await narrator.generate(askPrompt(question, passages, facts));
    if (r.ok) {
      const text = plain(r.data);
      const g = guardAnswer(text, { passages: passages.map((p) => p.text), facts, question });
      if (g.ok) return { body: `${text}\n\n(Din documentație: ${list(passages.slice(0, 3).map((p) => `„${p.heading}”`))}.)`, by: 'llm', model: narrator.model };
      logger.warn?.(`agent: răspunsul modelului respins (${g.reasons.join('; ')})`);
      return { body: `${retrievalAnswer(question, passages)}\n\n(Modelul local a scris un răspuns pe care garda l-a respins — ${g.reasons.join('; ')} —, așa că îți arăt pasajele exacte.)`, by: 'retrieval' };
    }
    return { body: `${retrievalAnswer(question, passages)}\n\n(Modelul local nu a răspuns: ${r.status}.)`, by: 'retrieval' };
  }
  return { body: retrievalAnswer(question, passages), by: 'retrieval' };
}

/* ───────────────────────────── code ───────────────────────────── */

async function contextFiles(ws, task, { k = 4, maxChars = 9000 } = {}) {
  const paths = (await ws.list()).filter((p) => TEXT_FILE.test(p) && !SKIP_DIRS.test(p) && !/package-lock/.test(p));
  const files = [];
  for (const p of paths) {
    const text = await ws.read(p);
    if (typeof text === 'string' && text.length < 400_000) files.push({ path: p, text });
  }
  // A path named in the task is always in context.
  const named = files.filter((f) => task.includes(f.path));
  const ranked = rankFiles(files, task, { k });
  const pick = [...named, ...ranked.filter((r) => !named.some((x) => x.path === r.path))].slice(0, Math.max(k, named.length));
  return pick.map((f) => ({ path: f.path, text: excerpt(files.find((x) => x.path === f.path)?.text ?? '', task, { maxChars }) }));
}

async function code({ ports, cfg, task, issue, author, logger }) {
  const ws = ports.workspace;
  const coder = ports.coder;
  if (!task) return { body: 'Spune-mi ce cod să scriu, de exemplu „scrie un test pentru pragul de lichiditate”.', patch: null };
  if (!ws) return { body: `Codul îl scriu în workflow-ul „Agent AI — chat”: cere-mi-l într-o problemă GitHub al cărei titlu începe cu „Agent”. Local, pe un clone curat și cu Ollama instalat: npm run agent:chat -- --write "${cut(task, 80)}".`, patch: null };
  const st = coder ? (coder.status ? await coder.status() : { ok: await coder.available(), reason: null }) : { ok: false, reason: 'modelul local este dezactivat (CRI_AGENT_LLM=off)' };
  if (!st.ok) return { body: `Modelul de cod (${coder?.model ?? 'neconfigurat'}) nu este disponibil acum${st.reason ? ` — ${st.reason}` : ''}. În workflow se instalează singur (Ollama, gratuit); local: ollama pull ${cfg.chat?.codeModel ?? 'qwen2.5-coder:7b'}.`, patch: null };
  const maxRounds = cfg.chat?.maxRounds ?? 2;
  const ctx = await contextFiles(ws, task, { k: cfg.chat?.contextFiles ?? 4 });
  const rounds = [];
  let failures = null;
  let previous = null;
  let tests = null;
  const touched = new Set();
  const created = new Set();
  const before = new Map();
  for (let round = 1; round <= maxRounds; round += 1) {
    // From the second round on, the context is the files as they are now (the first edits applied).
    const files = round === 1 ? ctx : await Promise.all([...new Set([...ctx.map((f) => f.path), ...touched])].map(async (p) => ({ path: p, text: excerpt((await ws.read(p)) ?? '', `${task}\n${failures ?? ''}`, { maxChars: 9000 }) })));
    const r = await coder.generate(codePrompt({ task, files, failures, previous }));
    if (!r.ok) {
      rounds.push({ round, ok: false, reason: `modelul nu a răspuns (${r.status})` });
      break;
    }
    const edits = parseEdits(r.data);
    const viol = pathViolations(edits.map((e) => e.path));
    if (!edits.length || viol.length) {
      rounds.push({ round, ok: false, reason: edits.length ? viol.join('; ') : 'răspunsul nu conține blocuri de editare' });
      failures = edits.length ? `Încălcări ale politicii: ${viol.join('; ')}` : 'Răspunsul anterior nu conținea blocuri SEARCH/REPLACE valide.';
      continue;
    }
    const cur = new Map();
    for (const e of edits) {
      if (!cur.has(e.path)) cur.set(e.path, await ws.read(e.path));
      if (!before.has(e.path)) before.set(e.path, cur.get(e.path));
    }
    const applied = applyEdits(cur, edits);
    if (!applied.ok) {
      rounds.push({ round, ok: false, reason: applied.errors.join('; ') });
      failures = `Blocurile nu s-au putut aplica: ${applied.errors.join('; ')}`;
      continue;
    }
    for (const p of applied.changed) {
      await ws.write(p, applied.files.get(p));
      touched.add(p);
    }
    for (const p of applied.created) created.add(p);
    const after = new Map();
    for (const p of touched) after.set(p, await ws.read(p));
    const check = validateChange(before, after, [...touched]);
    if (!check.ok) {
      rounds.push({ round, ok: false, reason: check.problems.join('; ') });
      await ws.reset();
      return { body: `Am renunțat la schimbare: încalcă regulile mele de siguranță (${check.problems.join('; ')}).`, patch: null, rounds };
    }
    tests = await ws.test();
    rounds.push({ round, ok: tests.ok, reason: tests.ok ? 'teste trecute' : 'teste eșuate', changed: applied.changed });
    if (tests.ok) break;
    failures = testSummary(tests.output);
    previous = await ws.diff();
  }
  const diff = touched.size ? await ws.diff() : '';
  if (!diff) {
    await ws.reset();
    return { body: `Nu am reușit să scriu o schimbare care să se aplice:\n${rounds.map((r) => `- runda ${r.round}: ${r.reason}`).join('\n')}`, patch: null, rounds };
  }
  const summary = tests ? { ok: tests.ok, summary: testSummary(tests.output) } : null;
  const patch = {
    diff,
    branch: `agent/${issue ?? 'local'}-${slugOf(task)}`,
    title: `agent: ${task.replace(/\s+/g, ' ').slice(0, 72)}`,
    body: prBody({ task, author, model: coder.model, changed: [...touched], created: [...created], tests: summary, rounds: rounds.length, issue }),
    draft: !summary?.ok,
    files: [...touched],
  };
  const files = list([...touched].map((p) => `${p}${created.has(p) ? ' (nou)' : ''}`));
  const body = [
    `${summary?.ok ? 'Am scris codul și testele trec' : 'Am scris codul, dar testele încă nu trec'} (${n(rounds.length, 'rundă', 'runde')}, cu modelul local ${coder.model}).`,
    `Fișiere schimbate: ${files}.`,
    summary && !summary.ok ? `Ce pică:\n${cut(plain(summary.summary), 900)}` : null,
    issue ? `Deschid pull requestul pe ramura ${patch.branch}${summary?.ok ? '' : ' ca draft'}; îl revizuiești și decizi tu, eu nu fac merge.` : 'Schimbările sunt în directorul de lucru: git diff le arată, git checkout -- . le anulează.',
  ]
    .filter(Boolean)
    .join('\n');
  logger.info?.(`agent: cod — ${touched.size} fișiere, teste ${summary?.ok ? 'trecute' : 'eșuate'}, ${rounds.length} runde`);
  return { body, patch, rounds };
}

/* ───────────────────────────── understanding ───────────────────────────── */

async function symbolsOf(ports) {
  const out = new Set();
  if (!ports.state?.universe) return { set: out, rows: [], forecast: null };
  const [u, s] = await Promise.all([ports.state.universe(), ports.state.snapshot ? ports.state.snapshot() : null]);
  const rows = u?.ok ? decodeTable(u.data?.assets) : [];
  for (const r of rows) if (r.symbol) out.add(String(r.symbol).toUpperCase());
  const forecast = s?.ok ? s.data?.forecast ?? null : null;
  for (const w of forecast?.winners ?? []) if (w.symbol) out.add(String(w.symbol).toUpperCase());
  return { set: out, rows, forecast };
}

/** When the cues are unsure, a local model classifies — within the same vocabulary. */
async function refine(u, { ports, catalogue, symbols, logger }) {
  if (u.explicit || u.intent !== 'ask' || u.confidence >= 0.5) return u;
  const narrator = ports.narrator;
  if (!narrator || !(await narrator.available())) return u;
  const r = await narrator.generate(classifyPrompt(u.text));
  const c = r.ok ? parseClassification(r.data, { catalogue, symbols }) : null;
  if (!c || c.intent === 'ask') return u;
  logger.info?.(`agent: modelul local a încadrat întrebarea ca „${c.intent}”`);
  return { ...u, intent: c.intent, confidence: 0.6, coder: c.intent === 'code', reason: `încadrat de modelul local (${narrator.model})`, entities: { ...u.entities, symbol: c.symbol ?? u.entities.symbol, gates: c.gate ? [c.gate, ...u.entities.gates] : u.entities.gates, ruleId: c.rule ?? u.entities.ruleId } };
}

/* ───────────────────────────── router ───────────────────────────── */

/**
 * @param {{ports:any, cfg:any, nowMs:number, text:string, context?:string|null, author?:string|null, issue?:number|null, logger?:any, requirePrefix?:boolean, commandWords?:boolean}} o
 *   context: what the message continues (the issue's title and first message, or the previous line)
 * @returns {Promise<{intent:any, title:string, reply:string, patch:any, by:string, at:string}>}
 */
export async function chat({ ports, cfg = {}, nowMs, text, context = null, author = null, issue = null, logger = console, requirePrefix = false, commandWords = true }) {
  const tz = cfg.chat?.timeZone ?? DEFAULT_TZ;
  const report = ports.memory ? await ports.memory.lastReport() : null;
  const memory = ports.memory ? await ports.memory.load() : null;
  const catalogue = report?.gateCatalogue ?? report?.gates ?? [];
  const sym = await symbolsOf(ports);
  let u = understand(text, { symbols: sym.set, catalogue, requirePrefix, commandWords, context });
  u = await refine(u, { ports, catalogue, symbols: sym.set, logger });
  const e = u.entities;
  let title;
  let body;
  let patch = null;
  let by = 'deterministic';
  switch (u.intent) {
    case 'status':
      title = 'Starea proiectului';
      body = answerStatus(report, { tz });
      break;
    case 'changes':
      title = 'Ce s-a schimbat';
      body = answerChanges(report, memory, { nowMs, hours: windowOf(u.args || u.text).hours, tz });
      break;
    case 'gates':
      title = 'Porțile de calitate';
      body = answerGates(report, { group: e.group, all: e.all, tz });
      break;
    case 'diagnose':
      title = 'Diagnoză';
      body = await diagnose({ ports, report, memory, e, tz });
      break;
    case 'efficiency':
      title = 'Eficiența identificării';
      body = answerEfficiency(report, { why: Boolean(u.why) });
      break;
    case 'forecast':
      title = `Prognoză${e.symbol ? ` ${e.symbol}` : ''}`;
      // A project the radar does not know is answered as such, not with the list of the others.
      body = answerForecast(sym.rows, sym.forecast, e.symbol ?? e.unknownSymbol, { all: e.all, why: Boolean(u.why) });
      break;
    case 'signals':
      title = 'Semnalele radarului';
      body = answerSignals(sym.rows, { all: e.all });
      break;
    case 'rules':
      title = 'Regulile fundamentale';
      body = answerRules(report, { ruleId: e.ruleId, all: e.all, tz });
      break;
    case 'learning':
      title = 'Auto-evaluare și învățare';
      body = answerLearning(report, { tz });
      break;
    case 'run': {
      title = 'Pornirea unui workflow';
      const file = WORKFLOW_FILE[e.workflow] ?? null;
      body = answerRun({ file, name: (cfg.workflows ?? []).find((w) => w.file === file)?.name ?? null, heal: cfg.heal, gate: (report?.gates ?? []).find((g) => g.id === WORKFLOW_GATE[e.workflow]) ?? null });
      break;
    }
    case 'code': {
      title = 'Cod';
      const r = await code({ ports, cfg, task: u.args, issue, author, logger });
      body = r.body;
      patch = r.patch;
      if (patch) by = `coder:${ports.coder?.model ?? '?'}`;
      break;
    }
    case 'greet':
      title = 'Salut';
      body = answerGreet(u.text, report, { tz });
      break;
    case 'ask': {
      title = 'Răspuns';
      const r = await ask({ ports, report, question: u.args || u.text, logger });
      body = r.body;
      by = r.by === 'llm' ? `llm:${r.model}` : r.by;
      break;
    }
    default:
      title = 'Ce pot face';
      body = answerHelp({ orphan: u.orphan ? u.text : null });
  }
  const source = by.startsWith('llm') ? `răspuns scris de modelul local ${by.slice(4)}, verificat cifră cu cifră` : by.startsWith('coder') ? `cod scris de modelul local ${by.slice(6)}, testat în jobul fără permisiuni de scriere` : by === 'retrieval' ? 'răspuns din documentația proiectului' : `răspuns din raportul meu${report?.generatedAt ? ` de la ${when(report.generatedAt, tz)}` : ''}`;
  const footer = `Agentul AI al CRI Radar — ${source}. Cercetare, nu sfat financiar.`;
  return { intent: u, title, reply: wrapReply({ body, footer }), patch, by, at: new Date(nowMs).toISOString() };
}
