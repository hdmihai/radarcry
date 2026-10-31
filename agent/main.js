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
 *   node agent/main.js run     (all three)                 --fixtures for the offline simulator
 *
 * Environment: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/name), CRI_AGENT_NARRATE (auto|always|never),
 * CRI_AGENT_MODEL (default from agent/config.json), CRI_AGENT_OLLAMA_URL (default 127.0.0.1:11434),
 * CRI_AGENT_HEAL=off, CRI_AGENT_ISSUES=off, CRI_AGENT_PAGES_URL. Every one is optional and free.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryFs, createStateDir } from './adapters/files.js';
import { createFixturePorts } from './adapters/fixtures.js';
import { createGitHub, createIssueNotifier } from './adapters/github.js';
import { createOllama, createPublicPrices, createSite, pagesUrlOf } from './adapters/web.js';
import { act, analyze, narrate, runAll } from './application/monitor.js';

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

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
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

  let ports;
  let now = nowMs;
  if (flags.fixtures) {
    cfg.mode = 'demo';
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
    const { report } = await runAll({ ports, cfg, nowMs: now, limits, logger, narrateMode, dryRun: Boolean(flags['dry-run']) });
    logger.info(`agent: ${report.overall} — raport în ${join(reportDir, 'agent.json')}`);
  } else {
    throw new Error(`comandă necunoscută: ${cmd} (analyze | narrate | act | run)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`agent: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
