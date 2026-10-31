/**
 * CHAT — the owner talks to the agent, free: a GitHub issue comment that starts with `/agent`, the
 * terminal (`npm run agent:chat`, Termux included), or the dashboard's link to a new issue.
 *
 *   stare · porți · diagnoză · eficiență · prognoză · reguli · învățare   deterministic, from the
 *       report and the memory (and, for a run, from GitHub's own record of its steps)
 *   întreabă   the documentation's passages that answer (BM25), phrased by the local model when it is
 *       available and only if every number in its answer comes from the context
 *   cod        Copilot-like: the local coder model writes SEARCH/REPLACE edits, the agent applies them
 *       under the patch policy, runs the test suite, gives the model one round to repair a failure,
 *       and hands back a diff — which agent-chat.yml turns into a pull request on an agent/… branch.
 *       The agent never merges and never writes to main.
 *
 * Every port is optional; a missing one makes its command say what it needs.
 */
import { COMMANDS, helpText, parseCommand, runIdOf, slugOf } from '../domain/commands.js';
import { answerEfficiency, answerForecast, answerGates, answerLearning, answerRules, answerStatus, askPrompt, codePrompt, diagnoseAll, diagnoseGate, diagnoseRun, guardAnswer, prBody, retrievalAnswer, testSummary, wrapReply } from '../domain/chat.js';
import { buildFacts } from '../domain/narrative.js';
import { applyEdits, parseEdits, pathViolations, validateChange } from '../domain/patch.js';
import { chunkDocs, excerpt, rankFiles, search } from '../domain/retrieval.js';
import { classify } from '../domain/signatures.js';
import { decodeTable } from './observe.js';

const TEXT_FILE = /\.(js|mjs|json|md|css|html|yml|yaml)$/i;
const SKIP_DIRS = /^(data|dist|node_modules|\.agent|\.state|\.cri-state|config\/labels|docs\/img)\b/;

/* ───────────────────────────── diagnosis ───────────────────────────── */

async function runDiagnosis(ci, runId, memory) {
  const rR = await ci.run(runId);
  if (!rR.ok) return `Rularea ${runId} nu a putut fi citită (${rR.status}${rR.message ? `: ${rR.message}` : ''}).`;
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
    const list = await ci.runs(run.file, 100);
    if (list.ok) {
      const t = Date.parse(run.createdAt);
      lastSuccess = list.data.filter((x) => x.conclusion === 'success' && Date.parse(x.createdAt) < t).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
      if (lastSuccess) {
        const ciRuns = run.file === 'ci.yml' ? list : await ci.runs('ci.yml', 100);
        const from = Date.parse(lastSuccess.createdAt);
        const seen = new Set();
        commits = (ciRuns.ok ? ciRuns.data : [])
          .filter((x) => x.event === 'push' && Date.parse(x.createdAt) > from && Date.parse(x.createdAt) <= t && !seen.has(x.headSha) && seen.add(x.headSha))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .map((x) => ({ sha: x.headSha, message: x.message, at: x.createdAt }));
      }
    }
  }
  return diagnoseRun({ run, jobs, annotations, signature, memory, commits, lastSuccess });
}

/** The workflow a word names (ci, scan, pulse, probe, labels). */
const WORKFLOW_WORD = { ci: 'ci.yml', scan: 'scan-and-deploy.yml', scanare: 'scan-and-deploy.yml', puls: 'pulse.yml', pulse: 'pulse.yml', sonda: 'probe.yml', probe: 'probe.yml', etichete: 'labels.yml', labels: 'labels.yml', agent: 'agent.yml' };

async function diagnose({ ports, report, memory, args }) {
  const a = String(args ?? '').trim();
  const runId = runIdOf(a);
  if (runId) return ports.ci?.run ? runDiagnosis(ports.ci, runId, memory) : 'Diagnoza unei rulări citește API-ul GitHub: setați GITHUB_REPOSITORY (și opțional GITHUB_TOKEN).';
  const word = a.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (WORKFLOW_WORD[word] && ports.ci?.runs) {
    const list = await ports.ci.runs(WORKFLOW_WORD[word], 30);
    const failed = list.ok ? list.data.find((r) => ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion)) : null;
    if (!failed) return `Nicio rulare eșuată recentă pentru ${WORKFLOW_WORD[word]}${list.ok ? '' : ` (lista nu a putut fi citită: ${list.status})`}.`;
    return runDiagnosis(ports.ci, failed.id, memory);
  }
  if (a && report) {
    const g = report.gates.find((x) => x.id === a || x.id === a.toLowerCase());
    if (!g) return `Nu cunosc poarta „${a}”. Porțile: ${report.gates.map((x) => `\`${x.id}\``).join(', ')}; sau \`diagnoză run <id>\`, \`diagnoză scan\`.`;
    const d = diagnoseGate(report, memory, g.id);
    const id = runIdOf(g.link ?? '');
    if (id && g.status !== 'PASS' && ports.ci?.run) return `${d}\n\n---\n\n${await runDiagnosis(ports.ci, id, memory)}`;
    return d;
  }
  const all = diagnoseAll(report, memory);
  const top = (report?.findings ?? []).find((f) => runIdOf(f.link ?? ''));
  if (top && ports.ci?.run) return `${all}\n**Rularea celei mai grave probleme:**\n\n${await runDiagnosis(ports.ci, runIdOf(top.link), memory)}`;
  return all;
}

/* ───────────────────────────── ask ───────────────────────────── */

async function ask({ ports, report, question, logger }) {
  if (!question) return { body: 'Scrieți întrebarea: `/agent întreabă cum se calculează prognoza ≥100×?`', by: 'none' };
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
      const g = guardAnswer(r.data, { passages: passages.map((p) => p.text), facts, question });
      if (g.ok) return { body: `${String(r.data).trim()}\n\n<details><summary>Pasajele folosite</summary>\n\n${passages.map((p) => `- ${p.doc} › ${p.path || p.heading}`).join('\n')}\n</details>`, by: 'llm', model: narrator.model };
      logger.warn?.(`agent: răspunsul modelului respins (${g.reasons.join('; ')})`);
      return { body: `${retrievalAnswer(question, passages)}\n\n_Răspunsul modelului local a fost respins de gardă (${g.reasons.join('; ')}); mai sus sunt pasajele exacte._`, by: 'retrieval' };
    }
    return { body: `${retrievalAnswer(question, passages)}\n\n_Modelul local nu a răspuns (${r.status}); mai sus sunt pasajele exacte._`, by: 'retrieval' };
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
  const pick = [...named, ...ranked.filter((r) => !named.some((n) => n.path === r.path))].slice(0, Math.max(k, named.length));
  return pick.map((f) => ({ path: f.path, text: excerpt(files.find((x) => x.path === f.path)?.text ?? '', task, { maxChars }) }));
}

async function code({ ports, cfg, task, issue, author, logger }) {
  const ws = ports.workspace;
  const coder = ports.coder;
  if (!task) return { body: 'Descrieți sarcina: `/agent cod adaugă un test pentru ...`', patch: null };
  if (!ws) return { body: 'Scrierea de cod rulează în workflow-ul „Agent AI — chat” (comentariu `/agent cod …` într-o problemă GitHub) sau local cu `npm run agent:chat -- --write cod …`, pe un clone curat.', patch: null };
  const st = coder ? (coder.status ? await coder.status() : { ok: await coder.available(), reason: null }) : { ok: false, reason: 'modelul local este dezactivat (CRI_AGENT_LLM=off)' };
  if (!st.ok) return { body: `Modelul de cod (${coder?.model ?? 'neconfigurat'}) nu este disponibil în această rulare${st.reason ? ` — ${st.reason}` : ''}. În workflow se instalează singur (Ollama, gratuit); local: \`ollama pull ${cfg.chat?.codeModel ?? 'qwen2.5-coder:7b'}\`.`, patch: null };
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
      return { body: `Schimbarea propusă încalcă politica agentului și a fost renunțată: ${check.problems.join('; ')}.`, patch: null, rounds };
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
    return { body: `Nu am reușit să produc o schimbare aplicabilă:\n${rounds.map((r) => `- runda ${r.round}: ${r.reason}`).join('\n')}`, patch: null, rounds };
  }
  const summary = tests ? { ok: tests.ok, summary: testSummary(tests.output) } : null;
  const slug = slugOf(task);
  const patch = {
    diff,
    branch: `agent/${issue ?? 'local'}-${slug}`,
    title: `agent: ${task.replace(/\s+/g, ' ').slice(0, 72)}`,
    body: prBody({ task, author, model: coder.model, changed: [...touched], created: [...created], tests: summary, rounds: rounds.length, issue }),
    draft: !summary?.ok,
    files: [...touched],
  };
  const preview = diff.split('\n').slice(0, 160).join('\n');
  const body = [
    `**${summary?.ok ? '✅ Testele trec' : '❌ Testele nu trec încă'}** după ${rounds.length} ${rounds.length === 1 ? 'rundă' : 'runde'} (model \`${coder.model}\`).`,
    `**Fișiere:** ${[...touched].map((p) => `\`${p}\``).join(', ')}`,
    summary && !summary.ok ? `\n\`\`\`\n${summary.summary.slice(0, 1500)}\n\`\`\`` : null,
    '',
    '<details><summary>Diferențele</summary>',
    '',
    '```diff',
    preview,
    diff.split('\n').length > 160 ? '… (trunchiat; diferența completă este în pull request)' : '',
    '```',
    '</details>',
  ].filter((x) => x !== null).join('\n');
  logger.info?.(`agent: cod — ${touched.size} fișiere, teste ${summary?.ok ? 'trecute' : 'eșuate'}, ${rounds.length} runde`);
  return { body, patch, rounds };
}

/* ───────────────────────────── router ───────────────────────────── */

/**
 * @param {{ports:any, cfg:any, nowMs:number, text:string, author?:string|null, issue?:number|null, logger?:any}} o
 * @returns {Promise<{cmd:any, title:string, reply:string, patch:any, by:string}>}
 */
export async function chat({ ports, cfg = {}, nowMs, text, author = null, issue = null, logger = console }) {
  const cmd = parseCommand(text);
  const report = ports.memory ? await ports.memory.lastReport() : null;
  const memory = ports.memory ? await ports.memory.load() : null;
  const label = COMMANDS.find((c) => c.id === cmd.id)?.usage ?? cmd.id;
  let title = `/agent ${label}`;
  let body;
  let patch = null;
  let by = 'deterministic';
  switch (cmd.id) {
    case 'status':
      body = answerStatus(report);
      title = 'Starea proiectului';
      break;
    case 'gates':
      body = answerGates(report, cmd.args);
      title = 'Porțile de calitate';
      break;
    case 'diagnose':
      body = await diagnose({ ports, report, memory, args: cmd.args });
      title = `Diagnoză${cmd.args ? `: ${cmd.args.split('\n')[0].slice(0, 60)}` : ''}`;
      break;
    case 'efficiency':
      body = answerEfficiency(report);
      title = 'Eficiența identificării';
      break;
    case 'forecast': {
      const [u, s] = ports.state ? await Promise.all([ports.state.universe(), ports.state.snapshot()]) : [null, null];
      body = answerForecast(u?.ok ? decodeTable(u.data?.assets) : [], s?.ok ? s.data?.forecast : report?.forecast ?? null, cmd.args.split(/\s+/)[0]);
      title = `Prognoză ${cmd.args.split(/\s+/)[0]?.toUpperCase() ?? ''}`.trim();
      break;
    }
    case 'rules':
      body = answerRules(report, cmd.args.split(/\s+/)[0]);
      title = 'Regulile fundamentale';
      break;
    case 'learning':
      body = answerLearning(report);
      title = 'Auto-evaluare și învățare';
      break;
    case 'ask': {
      const r = await ask({ ports, report, question: cmd.args, logger });
      body = r.body;
      by = r.by === 'llm' ? `llm:${r.model}` : r.by;
      title = 'Răspuns';
      break;
    }
    case 'code': {
      const r = await code({ ports, cfg, task: cmd.args, issue, author, logger });
      body = r.body;
      patch = r.patch;
      by = patch ? `coder:${ports.coder?.model ?? '?'}` : 'deterministic';
      title = 'Cod';
      break;
    }
    default:
      body = helpText();
      title = 'Agentul AI — comenzi';
  }
  const footer = `Agentul AI al CRI Radar · ${by.startsWith('llm') ? `scris de ${by.slice(4)} (model local), verificat cifră cu cifră` : by.startsWith('coder') ? `cod scris de ${by.slice(6)} (model local), testat în jobul fără permisiuni de scriere` : 'răspuns determinist din raportul și memoria agentului'}${report?.generatedAt ? ` · raport din ${String(report.generatedAt).slice(0, 16).replace('T', ' ')} UTC` : ''} · cercetare, nu sfat financiar.`;
  return { cmd, title, reply: wrapReply({ title, body, footer }), patch, by, at: new Date(nowMs).toISOString() };
}
