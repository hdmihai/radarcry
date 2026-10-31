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
import { createKnowledgeFs, createMemoryFs, createStateDir } from './adapters/files.js';
import { createFixturePorts } from './adapters/fixtures.js';
import { createGitHub, createIssueNotifier } from './adapters/github.js';
import { createOllama, createPublicPrices, createSite, pagesUrlOf } from './adapters/web.js';
import { createWorkspace } from './adapters/workspace.js';
import { chat } from './application/chat.js';
import { act, analyze, narrate, runAll } from './application/monitor.js';
import { parseCommand } from './domain/commands.js';

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
      if (['--text-env', '--reply-dir', '--memory', '--report', '--state', '--data', '--repo', '--issue', '--author', '--now'].includes(argv[i])) i += 1;
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
    narrator: llmOn && cmd.llm && !cmd.coder ? createOllama({ baseUrl: ollama, model: env.CRI_AGENT_MODEL || cfg.chat?.model || cfg.narrator.model, timeoutMs: cfg.narrator.timeoutMs, numPredict: 600, numCtx: 8192 }) : null,
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

async function runChat({ flags, env, cfg, memoryDir, stateDir, dataDir, argv }) {
  const reportDir = resolve(String(flags.report ?? join(memoryDir, 'report')));
  const text = flags['text-env'] ? String(env[String(flags['text-env'])] ?? '') : positional(argv);
  const issue = flags.issue ? Number(flags.issue) : env.CRI_AGENT_ISSUE ? Number(env.CRI_AGENT_ISSUE) : null;
  const author = flags.author ? String(flags.author) : env.CRI_AGENT_AUTHOR || null;
  const once = async (t) => {
    const cmd = parseCommand(t);
    const ports = await chatPorts({ flags, env, cfg, memoryDir, reportDir, stateDir, dataDir, cmd });
    if (cmd.coder && ports.workspace && !env.GITHUB_ACTIONS && !(await ports.workspace.clean())) {
      return { reply: 'Scrierea de cod locală cere un working tree curat (`git status` fără modificări), ca schimbările agentului să rămână separate de ale dumneavoastră.', patch: null, cmd };
    }
    return chat({ ports, cfg, nowMs: Date.now(), text: t, author, issue, logger });
  };
  if (!text.trim() && process.stdin.isTTY && !flags['reply-dir']) {
    console.log('Agentul AI al CRI Radar — scrieți o comandă („ajutor” pentru listă, „ieșire” pentru final).');
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'agent> ' });
    rl.prompt();
    for await (const line of rl) {
      if (/^\s*(iesire|ieșire|exit|quit)\s*$/i.test(line)) break;
      if (line.trim()) console.log(`\n${(await once(line)).reply.replace(/^<!--.*-->\n/, '')}\n`);
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
    const c = parseCommand(String(env[String(flags['text-env'] ?? 'BODY')] ?? ''), { requirePrefix: true });
    const out = `cmd=${c.id}\nok=${c.ok}\nllm=${c.llm}\ncoder=${c.coder}\n`;
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, out);
    else process.stdout.write(out);
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
    throw new Error(`comandă necunoscută: ${cmd} (analyze | narrate | act | run | chat | chat-parse)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`agent: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
