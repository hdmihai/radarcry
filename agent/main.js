#!/usr/bin/env node
/**
 * CRI Radar — the AI quality agent. Composition root.
 *
 * A separate module: it never imports the scanner (src/). It reads what the scanner publishes (the
 * state branch), what GitHub records (workflow runs, jobs, annotations), what the site serves and
 * what the public market says, evaluates every quality gate, learns its norms from the project's own
 * history, keeps a ledger of the ≥100× forecasts to measure their calibration, writes a summary with
 * a local open model (guarded), and may start a workflow GitHub's scheduler skipped.
 *
 *   node agent/main.js analyze [--memory .agent] [--state .state] [--data dir] [--out .agent/report]
 *   node agent/main.js narrate [--memory .agent] [--out .agent/report]
 *   node agent/main.js act     [--memory .agent] [--out .agent/report] [--dry-run]
 *   node agent/main.js run     (all three)                 --fixtures for the offline simulator,
 *                              --replay N [--step 10] runs it N times, N×step minutes forward
 *   node agent/main.js chat    [text…] [--text-env VAR] [--reply-dir dir] [--write] [--issue N]
 *                              talk to the agent (no text on a terminal: an interactive session)
 *   node agent/main.js chat-parse --text-env VAR   the command a comment asks for (GITHUB_OUTPUT)
 *   node agent/main.js serve   [--port 8787] [--host 127.0.0.1] [--dist dist] [--origin url,…]
 *                              the dashboard's chat: conversations API + the built dashboard
 *
 * Environment: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/name), CRI_AGENT_NARRATE (auto|always|never),
 * CRI_AGENT_MODEL (default from agent/config.json), CRI_AGENT_CODE_MODEL, CRI_AGENT_OLLAMA_URL
 * (default 127.0.0.1:11434), CRI_AGENT_HEAL=off, CRI_AGENT_ISSUES=off, CRI_AGENT_PAGES_URL. Every one
 * is optional and free.
 */
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCasesFs } from './adapters/cases-fs.js';
import { createConversationsFs } from './adapters/conversations-fs.js';
import { createConsult, createLlmChain, createOpenAiCompat } from './adapters/llm-openai.js';
import { createNotesFs } from './adapters/notes-fs.js';
import { createExa, createJinaReader, createTavily, createWeb } from './adapters/web-search.js';
import { createKnowledgeFs, createMemoryFs, createStateDir } from './adapters/files.js';
import { createAgentServer } from './adapters/http.js';
import { createFixturePorts } from './adapters/fixtures.js';
import { createGitHub, createIssueNotifier } from './adapters/github.js';
import { createOllama, createPublicPrices, createSite, pagesUrlOf } from './adapters/web.js';
import { createWorkspace } from './adapters/workspace.js';
import { approveOp, assist, deleteOp, feedbackOp, learnOp, patchOp } from './application/assistant.js';
import { chat } from './application/chat.js';
import { deleteConversation, exportConversation, listConversations, openConversation, sendMessage, updateConversation } from './application/conversation.js';
import { act, analyze, narrate, runAll } from './application/monitor.js';
import { consultMessages } from './domain/assistant.js';
import { CHAT_MARKER } from './domain/chat.js';
import { isFollowUp, threadContext, understand } from './domain/intent.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { cmd: argv[0] ?? 'run', flags: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out.flags[key] = true;
    else {
      out.flags[key] = next;
      i += 1;
    }
  }
  return out;
}

/** The schedules, read from the workflow files themselves — one source of truth. */
export async function cronsOf(file, root = ROOT) {
  const p = join(root, '.github', 'workflows', file);
  if (!existsSync(p)) return [];
  const text = await readFile(p, 'utf8');
  return [...text.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}

/** The scanner's limits the gates compare against, read from its config file (not imported). */
async function scannerLimits(root = ROOT) {
  try {
    const c = JSON.parse(await readFile(join(root, 'config', 'default.json'), 'utf8'));
    return { scanMaxMinutes: c.runtime?.maxMinutes ?? null, topN: c.universe?.topN ?? null };
  } catch {
    return {};
  }
}

export async function loadAgentConfig(root = ROOT) {
  const cfg = JSON.parse(await readFile(join(root, 'agent', 'config.json'), 'utf8'));
  for (const w of cfg.workflows) w.cron = (await cronsOf(w.file, root)) ?? [];
  return cfg;
}

const logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  debug: () => {},
};

/** The words after the command that are not flags: the chat's text on the command line. */
function positional(argv) {
  const out = [];
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      if (['--text-env', '--reply-dir', '--memory', '--report', '--state', '--data', '--repo', '--issue', '--author', '--now', '--port', '--host', '--dist', '--origin', '--mem-dir'].includes(argv[i])) i += 1;
      continue;
    }
    out.push(argv[i]);
  }
  return out.join(' ');
}

/** The ports of a chat: read-only by default; a workspace and a coder only for the code command. */
async function chatPorts({ flags, env, cfg, memoryDir, reportDir, stateDir, dataDir, cmd }) {
  const repo = String(flags.repo ?? env.GITHUB_REPOSITORY ?? '');
  const llmOn = cfg.narrator.enabled !== false && env.CRI_AGENT_LLM !== 'off';
  const ollama = env.CRI_AGENT_OLLAMA_URL || 'http://127.0.0.1:11434';
  const ports = {
    memory: createMemoryFs({ dir: memoryDir, reportDir }),
    state: createStateDir({ dir: stateDir, dataDir }),
    knowledge: createKnowledgeFs({ root: ROOT }),
    ci: repo.includes('/') ? createGitHub({ token: env.GITHUB_TOKEN || env.GH_TOKEN || null, repo }) : null,
    // The small model answers free questions and classifies unclear ones; absent, the agent still answers.
    narrator: llmOn && !cmd.coder ? createOllama({ baseUrl: ollama, model: env.CRI_AGENT_MODEL || cfg.chat?.model || cfg.narrator.model, timeoutMs: cfg.narrator.timeoutMs, numPredict: 600, numCtx: 8192 }) : null,
    coder: llmOn && cmd.coder ? createOllama({ baseUrl: ollama, model: env.CRI_AGENT_CODE_MODEL || cfg.chat?.codeModel, timeoutMs: cfg.chat?.codeTimeoutMs ?? 1_200_000, numPredict: cfg.chat?.codeNumPredict ?? 2048, numCtx: cfg.chat?.codeNumCtx ?? 16384, temperature: 0.1 }) : null,
    workspace: cmd.coder && flags.write ? createWorkspace({ root: ROOT }) : null,
  };
  if (flags.fixtures) {
    // The offline simulator's GitHub (the demo), anchored like `run --fixtures` so run ids match.
    const snap = await ports.state.snapshot();
    const anchorMs = snap.ok ? Date.parse(snap.data.meta.generatedAt) + 10 * 60_000 : Date.now();
    const fx = createFixturePorts({ anchorMs, clock: { now: () => anchorMs + 6 * 3_600_000 }, stateDir, dataDir, memoryDir, reportDir });
    ports.ci = fx.ci;
  }
  return ports;
}

/** The symbols the radar knows (universe and learning list): they make „ce șanse are lab?” a forecast question. */
async function knownSymbols(stateDir, dataDir) {
  const st = createStateDir({ dir: stateDir, dataDir });
  const out = new Set();
  const u = await st.universe();
  if (u.ok) {
    const f = u.data?.assets?.fields ?? [];
    const k = f.indexOf('symbol');
    for (const row of u.data?.assets?.rows ?? []) if (k >= 0 && row[k]) out.add(String(row[k]).toUpperCase());
  }
  return out;
}

/**
 * What a message continues. On GitHub a follow-up („de ce?”, „detalii”) continues the owner's previous
 * message in the thread (read with the job's read-only token), else the issue's title and first
 * message; on the terminal, the previous line (kept by the conversation loop).
 */
async function threadOf({ env, flags, text }) {
  const issue = String(env[String(flags['context-env'] ?? 'CRI_AGENT_CONTEXT')] ?? '').trim().slice(0, 6000) || null;
  const number = Number(flags.issue ?? env.CRI_AGENT_ISSUE);
  const commentId = Number(env.CRI_AGENT_COMMENT_ID);
  const repo = String(flags.repo ?? env.GITHUB_REPOSITORY ?? '');
  if (!isFollowUp(text) || !(number > 0) || !(commentId > 0) || !repo.includes('/')) return issue;
  const r = await createGitHub({ token: env.GITHUB_TOKEN || env.GH_TOKEN || null, repo }).issueComments(number);
  if (!r.ok) return issue;
  const author = env.CRI_AGENT_AUTHOR || null;
  const previous = r.data.filter((c) => c.id < commentId && (!author || c.author === author) && !String(c.body ?? '').startsWith(CHAT_MARKER)).map((c) => c.body);
  return threadContext(previous, issue);
}

/** The demo's clock: the simulated history ends ten minutes after the demo snapshot. */
async function demoNow(stateDir, dataDir) {
  const s = await createStateDir({ dir: stateDir, dataDir }).snapshot();
  return s.ok ? Date.parse(s.data.meta.generatedAt) + 10 * 60_000 : Date.now();
}

async function runChat({ flags, env, cfg, memoryDir, stateDir, dataDir, argv }) {
  const reportDir = resolve(String(flags.report ?? join(memoryDir, 'report')));
  const text = flags['text-env'] ? String(env[String(flags['text-env'])] ?? '') : positional(argv);
  const issue = flags.issue ? Number(flags.issue) : env.CRI_AGENT_ISSUE ? Number(env.CRI_AGENT_ISSUE) : null;
  const author = flags.author ? String(flags.author) : env.CRI_AGENT_AUTHOR || null;
  // What the message continues: on GitHub the thread it is written in; on the terminal, the previous line.
  let context = await threadOf({ env, flags, text });
  // On GitHub „cod” is a command only after /agent; on the terminal it is one by itself.
  const commandWords = !env.GITHUB_ACTIONS;
  const fixedNow = flags.now ? Date.parse(String(flags.now)) : flags.fixtures ? await demoNow(stateDir, dataDir) : null;
  const once = async (t) => {
    const cmd = understand(t, { commandWords, context });
    const ports = await chatPorts({ flags, env, cfg, memoryDir, reportDir, stateDir, dataDir, cmd });
    if (cmd.coder && ports.workspace && !env.GITHUB_ACTIONS && !(await ports.workspace.clean())) {
      return { reply: 'Ca să scriu cod local am nevoie de un working tree curat (git status fără modificări), ca schimbările mele să rămână separate de ale tale.', patch: null, intent: cmd };
    }
    return chat({ ports, cfg, nowMs: fixedNow ?? Date.now(), text: t, context, author, issue, logger, commandWords });
  };
  if (!text.trim() && process.stdin.isTTY && !flags['reply-dir']) {
    console.log('Agentul AI al CRI Radar. Scrie-mi în cuvintele tale, de exemplu „cum stă radarul?”, „ce s-a schimbat de ieri?” sau „ce șanse are LAB?”; după un răspuns poți continua cu „de ce?” sau „detalii”. „ieșire” încheie.');
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'agent> ' });
    rl.prompt();
    for await (const line of rl) {
      if (/^\s*(iesire|ieșire|exit|quit)\s*$/i.test(line)) break;
      if (line.trim()) {
        const r = await once(line);
        console.log(`\n${r.reply.replace(/^<!--.*-->\n/, '')}\n`);
        // A follow-up keeps the thread's topic; a new question starts a new one.
        if (!r.intent?.followUp && !['help', 'greet'].includes(r.intent?.intent)) context = line;
      }
      rl.prompt();
    }
    rl.close();
    return;
  }
  const r = await once(text);
  if (flags['reply-dir']) {
    const dir = resolve(String(flags['reply-dir']));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'reply.md'), r.reply);
    if (r.patch) {
      await writeFile(join(dir, 'patch.diff'), r.patch.diff);
      await writeFile(join(dir, 'pr.json'), JSON.stringify({ branch: r.patch.branch, title: r.patch.title, draft: r.patch.draft, files: r.patch.files }));
      await writeFile(join(dir, 'pr.md'), r.patch.body);
    }
    logger.info(`agent: răspuns scris în ${dir}${r.patch ? ' (cu o propunere de cod)' : ''}`);
  } else console.log(r.reply.replace(/^<!--.*-->\n/, ''));
}

/**
 * The dashboard's chat: a local HTTP server (127.0.0.1 by default) with the conversations API, and the
 * built dashboard itself when --dist is given, so one address (http://127.0.0.1:8787/#/chat) is the
 * whole thing — Termux included. History is kept as files in <memory>/conversations.
 */
async function runServe({ flags, env, cfg, memoryDir, stateDir, dataDir }) {
  const reportDir = resolve(String(flags.report ?? join(memoryDir, 'report')));
  const port = Number(flags.port ?? env.CRI_AGENT_PORT ?? 8787);
  const host = String(flags.host ?? env.CRI_AGENT_HOST ?? '127.0.0.1');
  const dist = flags.dist && flags.dist !== true ? resolve(String(flags.dist)) : existsSync(resolve('dist')) ? resolve('dist') : null;
  const conversations = createConversationsFs({ dir: join(memoryDir, 'conversations') });
  const repo = String(flags.repo ?? env.GITHUB_REPOSITORY ?? '');
  const pagesUrl = env.CRI_AGENT_PAGES_URL || cfg.pagesUrl || (repo.includes('/') ? pagesUrlOf(repo) : '') || '';
  const extra = String(flags.origin ?? env.CRI_AGENT_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const origins = [...new Set([...(pagesUrl ? [new URL(pagesUrl).origin] : []), `http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extra])];
  const nowOf = async () => (flags.now ? Date.parse(String(flags.now)) : flags.fixtures ? demoNow(stateDir, dataDir) : Date.now());
  // Ports are built per message: the report and the research state are read as they are now.
  const portsNow = async () => ({ ...(await chatPorts({ flags, env, cfg, memoryDir, reportDir, stateDir, dataDir, cmd: { coder: false } })), conversations });
  const app = {
    list: async () => listConversations({ ports: { conversations } }),
    open: async (id) => openConversation({ ports: { conversations }, id }),
    update: async (id, patch) => updateConversation({ ports: { conversations }, id, patch }),
    remove: async (id) => deleteConversation({ ports: { conversations }, id }),
    exportText: async (id) => exportConversation({ ports: { conversations }, id, cfg }),
    send: async (id, text, onStatus) => sendMessage({ ports: await portsNow(), cfg, nowMs: await nowOf(), id, text, logger, onStatus }),
  };
  const { listen } = createAgentServer({ app, port, host, dist, origins, token: env.CRI_AGENT_TOKEN || null });
  await listen();
  logger.info(`agent: chat pornit pe http://${host}:${port}${dist ? '/#/chat (dashboard-ul din ' + dist + ')' : ' (fără dashboard: dă --dist dist)'}; istoricul în ${join(memoryDir, 'conversations')}`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) logger.warn('agent: serverul ascultă în afara buclei locale; accesul cere tokenul din CRI_AGENT_TOKEN.');
}

/**
 * One operation of the hosted assistant, run by the private repo's workflow (hosted/radarcry-agent).
 * Input comes from the environment, never from the command line: ASSIST_OP, ASSIST_CONVERSATION,
 * ASSIST_MESSAGE, ASSIST_TEXT, ASSIST_EXTRA (JSON). The assistant's own memory is in --mem-dir
 * (conversations, cases, lessons); the radar's memory and state are the usual --memory and --state.
 */
async function runAssist({ flags, env, cfg, memoryDir, stateDir, dataDir }) {
  const memRoot = resolve(String(flags['mem-dir'] ?? join(memoryDir, 'assistant')));
  const reportDir = resolve(String(flags.report ?? join(memoryDir, 'report')));
  const key = (name) => env[name] || null;
  const providers = (cfg.assistant?.providers ?? []).map((p) => createOpenAiCompat({ id: p.id, baseUrl: p.baseUrl, apiKey: key(p.envKey), model: p.model, fetchImpl: globalThis.fetch }));
  const llm = createLlmChain({ providers });
  const searchers = { tavily: createTavily({ apiKey: key('TAVILY_API_KEY') }), exa: createExa({ apiKey: key('EXA_API_KEY') }) };
  const web = createWeb({ searchers: (cfg.assistant?.search?.order ?? ['tavily', 'exa']).map((id) => searchers[id]).filter(Boolean), reader: createJinaReader({ apiKey: key('JINA_API_KEY') }) });
  const base = await chatPorts({ flags, env, cfg, memoryDir, reportDir, stateDir, dataDir, cmd: { coder: false } });
  const conversations = createConversationsFs({ dir: join(memRoot, 'conversations') });
  const ports = { ...base, narrator: null, conversations, cases: createCasesFs({ dir: join(memRoot, 'cases') }), notes: createNotesFs({ dir: memRoot }), llm, web, consult: createConsult({ chain: llm, roles: cfg.assistant?.consult ?? {}, build: consultMessages }) };
  const nowMs = flags.now ? Date.parse(String(flags.now)) : flags.fixtures ? await demoNow(stateDir, dataDir) : Date.now();
  const op = String(env.ASSIST_OP ?? 'chat');
  const id = String(env.ASSIST_CONVERSATION ?? '');
  let extra = {};
  try { extra = env.ASSIST_EXTRA ? JSON.parse(env.ASSIST_EXTRA) : {}; } catch { throw new Error('ASSIST_EXTRA nu este JSON'); }
  let r;
  switch (op) {
    case 'chat': r = await assist({ ports, cfg, nowMs, id, messageId: String(env.ASSIST_MESSAGE ?? ''), text: String(env.ASSIST_TEXT ?? ''), logger }); break;
    case 'patch': r = await patchOp({ ports, id, patch: extra }); break;
    case 'delete': r = await deleteOp({ ports, id }); break;
    case 'feedback': r = await feedbackOp({ ports, id, messageId: String(env.ASSIST_MESSAGE ?? ''), value: extra.value ?? null }); break;
    case 'learn': r = await learnOp({ ports, cfg, nowMs, logger }); break;
    case 'approve': r = await approveOp({ ports }); break;
    case 'reindex': await conversations.reindex(); r = { ok: true, data: {} }; break;
    default: r = { ok: false, message: `operație necunoscută: ${op}` };
  }
  if (!r.ok) throw new Error(`asistent: ${op} refuzat — ${r.message ?? r.status}`);
  logger.info(`asistent: ${op} făcut${r.data?.by ? ` (${r.data.by})` : ''}${llm.providers.length ? '' : ' — niciun model configurat, răspunsurile vin din raport'}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const { cmd, flags } = parseArgs(argv);
  const env = process.env;
  const cfg = await loadAgentConfig();
  const limits = await scannerLimits();
  const nowMs = flags.now ? Date.parse(flags.now) : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error(`--now invalid: ${flags.now}`);
  const memoryDir = resolve(String(flags.memory ?? '.agent'));
  const reportDir = resolve(String(flags.out ?? join(memoryDir, 'report')));
  const stateDir = resolve(String(flags.state ?? '.state'));
  const dataDir = flags.data ? resolve(String(flags.data)) : null;
  const narrateMode = ['auto', 'always', 'never'].includes(env.CRI_AGENT_NARRATE) ? env.CRI_AGENT_NARRATE : flags.narrate ?? 'auto';
  if (env.CRI_AGENT_HEAL === 'off') cfg.heal.enabled = false;
  if (env.CRI_AGENT_ISSUES === 'off') cfg.issues.enabled = false;
  if (env.CRI_AGENT_LLM === 'off') cfg.narrator.enabled = false;

  if (cmd === 'chat-parse') {
    // In an agent conversation (an issue titled „Agent…” or labelled „agent”) no prefix is needed.
    const conversation = env.CRI_AGENT_CONVERSATION === 'true';
    const symbols = flags.state ? await knownSymbols(stateDir, dataDir) : null;
    const body = String(env[String(flags['text-env'] ?? 'BODY')] ?? '');
    const context = await threadOf({ env, flags, text: body });
    const c = understand(body, { requirePrefix: !conversation, commandWords: false, symbols, context });
    // The small model is installed for free questions and for unclear ones (it classifies them).
    const llm = c.ok && (c.llm || (c.intent === 'ask' && !c.explicit) || c.confidence < 0.5);
    const out = `cmd=${c.intent}\nok=${c.ok}\nllm=${llm}\ncoder=${c.coder}\n`;
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, out);
    else process.stdout.write(out);
    return;
  }
  if (cmd === 'assist') {
    await runAssist({ flags, env, cfg, memoryDir, stateDir, dataDir });
    return;
  }
  if (cmd === 'serve') {
    await runServe({ flags, env, cfg, memoryDir, stateDir, dataDir });
    return;
  }
  if (cmd === 'chat') {
    await runChat({ flags, env, cfg, memoryDir, stateDir, dataDir, argv });
    return;
  }

  let ports;
  let now = nowMs;
  if (flags.fixtures) {
    cfg.mode = 'demo';
    // A demo that starts over (the replay is then the agent's whole history).
    if (flags.fresh) await rm(join(memoryDir, 'memory.json'), { force: true });
    // The simulated history ends ten minutes after the demo snapshot was generated, unless --now says otherwise.
    const s = await createStateDir({ dir: stateDir, dataDir }).snapshot();
    const anchorMs = s.ok ? Date.parse(s.data.meta.generatedAt) + 10 * 60_000 : nowMs;
    if (!flags.now) now = anchorMs;
    const clock = { now: () => now };
    ports = createFixturePorts({ anchorMs, clock, stateDir, dataDir, memoryDir, reportDir });
  } else {
    const repo = String(flags.repo ?? env.GITHUB_REPOSITORY ?? '');
    if (!repo.includes('/')) throw new Error('agent: setați GITHUB_REPOSITORY=owner/nume sau --repo owner/nume');
    const gh = createGitHub({ token: env.GITHUB_TOKEN || env.GH_TOKEN || null, repo });
    const pagesUrl = env.CRI_AGENT_PAGES_URL || cfg.pagesUrl || pagesUrlOf(repo);
    ports = {
      ci: gh,
      state: createStateDir({ dir: stateDir, dataDir }),
      site: pagesUrl ? createSite({ url: pagesUrl }) : null,
      prices: createPublicPrices({}),
      memory: createMemoryFs({ dir: memoryDir, reportDir }),
      knowledge: createKnowledgeFs({ root: ROOT }),
      narrator: (cmd === 'narrate' || cmd === 'run') && cfg.narrator.enabled !== false ? createOllama({ baseUrl: env.CRI_AGENT_OLLAMA_URL || 'http://127.0.0.1:11434', model: env.CRI_AGENT_MODEL || cfg.narrator.model, timeoutMs: cfg.narrator.timeoutMs, numPredict: cfg.narrator.numPredict }) : null,
      // Writes need the workflow token; a local run without one only reads.
      notifier: env.GITHUB_TOKEN ? createIssueNotifier({ gh }) : null,
    };
    if (!env.GITHUB_TOKEN) ports.ci = { ...gh, dispatch: null };
    cfg.mode = 'live';
  }

  if (cmd === 'analyze') {
    const { report, narrate: should } = await analyze({ ports, cfg, nowMs: now, limits, logger, narrateMode });
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `narrate=${should}\noverall=${report.overall}\n`);
    logger.info(`agent: ${report.overall} — ${report.summary.counts.PASS} trecute, ${report.summary.counts.WARN} atenționări, ${report.summary.counts.FAIL} eșecuri; narațiune ${should ? 'de rescris' : 'actuală'}; plan: ${report.plan.actions.map((a) => a.workflow).join(', ') || 'nimic de pornit'}`);
  } else if (cmd === 'narrate') {
    const { narrative } = await narrate({ ports, nowMs: now, cfg, logger });
    logger.info(`agent: narațiune ${narrative.by === 'llm' ? `scrisă de ${narrative.model}` : `din șablon (${narrative.reason})`}`);
  } else if (cmd === 'act') {
    const { actions, issue } = await act({ ports, nowMs: now, cfg, logger, dryRun: Boolean(flags['dry-run']) });
    logger.info(`agent: ${actions.length ? actions.map((a) => `${a.workflow} ${a.ok ? 'pornit' : a.status}`).join(', ') : 'nicio acțiune'}${issue ? `; problema GitHub ${issue.open ? 'deschisă/actualizată' : 'închisă sau inexistentă'}` : ''}`);
  } else if (cmd === 'run') {
    // The demo can replay the agent's runs that led to this one (10 minutes apart by default, ending
    // at the usual time, so the final report is the one a single run would publish, with a history):
    // memory, rule history and self-evaluation then have something to show.
    const replay = flags.fixtures && flags.replay ? Math.max(0, Math.min(500, Number(flags.replay) || 0)) : 0;
    const stepMs = (Number(flags.step) || 10) * 60_000;
    const quiet = { info() {}, warn() {}, debug() {} };
    const start = now - replay * stepMs;
    for (let i = 0; i < replay; i += 1) {
      now = start + i * stepMs;
      await runAll({ ports, cfg, nowMs: now, limits, logger: quiet, narrateMode, dryRun: Boolean(flags['dry-run']) });
    }
    now = start + replay * stepMs;
    const { report } = await runAll({ ports, cfg, nowMs: now, limits, logger, narrateMode, dryRun: Boolean(flags['dry-run']) });
    logger.info(`agent: ${report.overall} — raport în ${join(reportDir, 'agent.json')}${replay ? ` (după ${replay} rulări reluate)` : ''}`);
  } else {
    throw new Error(`comandă necunoscută: ${cmd} (analyze | narrate | act | run | chat | chat-parse | serve | assist)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`agent: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
