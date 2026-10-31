/**
 * File adapters of the agent: the research state the scanner published (StatePort) and the agent's
 * own memory and report (MemoryPort). Local files only — in Actions the workflow checks the
 * `cri-state` and `cri-agent` branches out into directories before the agent runs.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

async function readJson(path) {
  if (!existsSync(path)) return { ok: false, status: 'NOT_FOUND', data: null, message: `${path} lipsește` };
  try {
    return { ok: true, status: 'OK', data: JSON.parse(await readFile(path, 'utf8')) };
  } catch (err) {
    return { ok: false, status: 'INVALID_PAYLOAD', data: null, message: `${path}: ${String(err?.message ?? err).slice(0, 120)}` };
  }
}

/**
 * StatePort over a directory. Accepts the state branch layout (snapshot/latest.json, meta.json,
 * telemetry.json), a plain data directory (latest.json, universe.json), or both (`dataDir`).
 */
export function createStateDir({ dir, dataDir = null }) {
  // The published files live under snapshot/ on the state branch; a local run may keep them in a
  // separate data directory (the demo: state in .cri-state-demo, snapshot in data/).
  const roots = [dir, dataDir].filter(Boolean);
  const first = (...names) => roots.flatMap((r) => names.map((n) => join(r, n))).find((p) => existsSync(p)) ?? join(dir, names[0]);
  const latest = () => first('snapshot/latest.json', 'latest.json');
  const universe = () => first('snapshot/universe.json', 'universe.json');
  const summary = () => first('snapshot/summary.json', 'summary.json');
  return {
    snapshot: () => readJson(latest()),
    universe: () => readJson(universe()),
    meta: () => readJson(join(dir, 'meta.json')),
    telemetry: () => readJson(join(dir, 'telemetry.json')),
    async published() {
      const files = [];
      for (const [name, path] of [['latest.json', latest()], ['summary.json', summary()], ['universe.json', universe()]]) {
        if (existsSync(path)) files.push({ name, text: await readFile(path, 'utf8') });
      }
      return files.length ? { ok: true, status: 'OK', data: files } : { ok: false, status: 'NOT_FOUND', data: null, message: `niciun fișier publicat în ${dir}` };
    },
  };
}

/** Write atomically: a crash mid-write must never leave a truncated memory behind. */
async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

/**
 * MemoryPort: `dir/memory.json` is the memory, `reportDir/agent.json` + `agent.md` the report.
 */
export function createMemoryFs({ dir, reportDir = join(dir, 'report') }) {
  const memPath = join(dir, 'memory.json');
  const reportPath = join(reportDir, 'agent.json');
  return {
    async load() {
      const r = await readJson(memPath);
      return r.ok && r.data?.version ? r.data : null;
    },
    async save(memory) {
      await writeAtomic(memPath, JSON.stringify(memory));
    },
    async publish(report, markdown) {
      await writeAtomic(reportPath, JSON.stringify(report));
      await writeAtomic(join(reportDir, 'agent.md'), markdown);
      return { path: reportPath };
    },
    async lastReport() {
      const r = await readJson(reportPath);
      return r.ok ? r.data : null;
    },
  };
}
