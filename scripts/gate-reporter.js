/**
 * node:test reporter that turns the suite into the project's quality gates.
 *
 * Every test is assigned to a gate group — by its file (domain, application, adapters, web, scripts,
 * agent) or, for the architecture fitness file, by the rule it checks (layers, free sources only,
 * research only, determinism, fixture parity, workflow concurrency). The reporter writes one JSON
 * document with pass/fail counts per group and the failing tests; scripts/gates-annotate.js turns it
 * into GitHub annotations, which is how the AI agent reads the result of each gate without
 * downloading logs.
 *
 *   node --test --test-reporter=spec --test-reporter-destination=stdout \
 *        --test-reporter=./scripts/gate-reporter.js --test-reporter-destination=.gates.json "test/**\/*.test.js"
 */
import { relative, sep } from 'node:path';

/** The rule an architecture test checks, from its name. */
const ARCH = [
  [/subscription|approved free-source|free-only|paid/i, 'arch.free'],
  [/order or withdrawal|research-only|trading/i, 'arch.research'],
  [/deterministic|clock|randomness/i, 'arch.deterministic'],
  [/fixture adapters|same port surface/i, 'arch.parity'],
  [/concurrency group|workflows never share/i, 'arch.workflows'],
  [/agent/i, 'agent'],
  [/pure|depends only|never import|self-contained|layer/i, 'arch.layers'],
];

export function groupOf(file, name) {
  const rel = relative(process.cwd(), file ?? '').split(sep).join('/');
  if (/(^|\/)test\/architecture\.test\.js$/.test(rel)) return (ARCH.find(([re]) => re.test(name ?? '')) ?? [null, 'arch.other'])[1];
  const m = /(^|\/)test\/([a-z]+)\//.exec(rel);
  if (m) return m[2];
  return 'other';
}

export default async function* gateReporter(source) {
  const groups = {};
  const failures = [];
  const bump = (g, key) => {
    groups[g] ??= { pass: 0, fail: 0 };
    groups[g][key] += 1;
  };
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const d = event.data ?? {};
    // Suites and the per-file wrappers are containers, not checks.
    if (d.details?.type === 'suite' || !d.name || /\.test\.js$/.test(d.name) || d.skip || d.todo) continue;
    const g = groupOf(d.file, d.name);
    if (event.type === 'test:pass') bump(g, 'pass');
    else {
      bump(g, 'fail');
      const err = d.details?.error;
      const message = String(err?.cause?.message ?? err?.message ?? err ?? '').split('\n').slice(0, 6).join('\n').slice(0, 600);
      failures.push({ group: g, name: d.name, file: relative(process.cwd(), d.file ?? '').split(sep).join('/'), message });
    }
  }
  yield `${JSON.stringify({ version: 1, groups, failures })}\n`;
}
