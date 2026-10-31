#!/usr/bin/env node
/**
 * Publish the quality-gate report of a CI run as GitHub annotations and a job-summary table.
 *
 *   node scripts/gates-annotate.js .gates.json .gates-syntax.json
 *
 * One notice annotation `cri-gates` carries every group's count (`syntax=262/262 arch.free=2/2 …`);
 * each failing test becomes an error annotation titled `gate:<group>`. The AI agent reads them
 * through the Checks API (api.github.com), so it knows which gate failed without downloading logs.
 * Exit code 1 when a report is missing — a CI that cannot say what it checked has not checked it.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const LABELS = {
  syntax: 'Sintaxă JS',
  'arch.layers': 'Arhitectură: straturi',
  'arch.free': 'Doar surse gratuite',
  'arch.research': 'Exclusiv research',
  'arch.deterministic': 'Domeniu determinist',
  'arch.parity': 'Simulator = adaptoare reale',
  'arch.workflows': 'Workflow-uri fără concurență comună',
  'arch.other': 'Arhitectură: alte reguli',
  domain: 'Domeniu',
  application: 'Aplicație și end-to-end',
  adapters: 'Adaptoare',
  scripts: 'Scripturi',
  web: 'Interfață',
  agent: 'Agentul AI',
  other: 'Altele',
};

const escData = (s) => String(s ?? '').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

async function readJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse((await readFile(path, 'utf8')).trim().split('\n').pop());
  } catch {
    return null;
  }
}

const [testsPath = '.gates.json', syntaxPath = '.gates-syntax.json'] = process.argv.slice(2);
const tests = await readJson(testsPath);
const syntax = await readJson(syntaxPath);
if (!tests && !syntax) {
  console.log('::error title=cri-gates::raportul porților lipsește — suita nu a rulat');
  process.exit(1);
}
const groups = { ...(syntax ? { syntax: { pass: syntax.pass, fail: syntax.total - syntax.pass } } : {}), ...(tests?.groups ?? {}) };
const failures = [...(syntax?.failed ?? []).map((f) => ({ group: 'syntax', name: f, message: 'node --check a eșuat' })), ...(tests?.failures ?? [])];
const line = `v1 ${Object.entries(groups).map(([k, v]) => `${k}=${v.pass}/${v.pass + v.fail}`).join(' ')}`;
console.log(`::notice title=cri-gates::${escData(line)}`);
for (const f of failures.slice(0, 9)) console.log(`::error title=${escProp(`gate:${f.group}`)}${f.file ? `,file=${escProp(f.file)}` : ''}::${escData(`${f.name}\n${f.message}`)}`);

const rows = Object.entries(groups).map(([k, v]) => `| ${v.fail ? '❌' : '✅'} | ${LABELS[k] ?? k} | ${v.pass}/${v.pass + v.fail} |`);
const md = ['### Porți de calitate (cod)', '', '| | Grup | Trecute |', '|---|---|---|', ...rows, '', failures.length ? `**${failures.length} verificări eșuate**: ${failures.slice(0, 5).map((f) => f.name).join('; ')}` : 'Toate verificările au trecut.', ''].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
else console.log(md);
process.exit(failures.length ? 1 : 0);
