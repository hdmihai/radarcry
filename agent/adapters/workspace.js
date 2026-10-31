/**
 * WorkspacePort over a git checkout: the repository as files, for the chat's code command.
 *
 * Used only where it is safe to run proposed code: the `think` job of agent-chat.yml (its token can
 * only read; the job that writes never executes the proposal) or a local clone with `--write` and a
 * clean working tree. Every write stays inside the repository, every file the agent touched is
 * remembered so `reset()` restores exactly those, and the test suite runs with the tokens removed
 * from its environment.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Environment variables a proposed test run must never see. */
const SECRET_ENV = /TOKEN|SECRET|KEY|PASSWORD|_RPC_URL|ACTIONS_RUNTIME|ACTIONS_ID_TOKEN|ACTIONS_CACHE/i;

function run(cmd, args, { cwd, timeoutMs = 600_000, env = process.env, input = null } = {}) {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const keep = (b) => {
      out += b.toString();
      if (out.length > 400_000) out = out.slice(-300_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ code: -1, output: `${out}\n${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, output: out });
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * @param {{root:string, testCommand?:string[], timeoutMs?:number}} o
 */
export function createWorkspace({ root, testCommand = ['npm', 'test', '--silent'], timeoutMs = 900_000 }) {
  const base = resolve(root);
  const originals = new Map();
  const created = new Set();
  const inside = (p) => {
    const abs = resolve(base, p);
    if (abs !== base && !abs.startsWith(`${base}${sep}`)) throw new Error(`agent: calea ${p} iese din repository`);
    return abs;
  };
  return {
    root: base,
    async clean() {
      const r = await run('git', ['status', '--porcelain'], { cwd: base, timeoutMs: 30_000 });
      return r.code === 0 && !r.output.trim();
    },
    async list() {
      const r = await run('git', ['ls-files', '-z'], { cwd: base, timeoutMs: 30_000 });
      if (r.code !== 0) return [];
      return r.output.split('\0').filter(Boolean);
    },
    async read(p) {
      const abs = inside(p);
      if (!existsSync(abs)) return null;
      const st = await stat(abs);
      if (!st.isFile() || st.size > 1_500_000) return null;
      return readFile(abs, 'utf8');
    },
    async write(p, text) {
      const abs = inside(p);
      if (!originals.has(p) && !created.has(p)) {
        if (existsSync(abs)) originals.set(p, await readFile(abs, 'utf8'));
        else created.add(p);
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, text);
    },
    async test() {
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET_ENV.test(k)));
      const [cmd, ...args] = testCommand;
      const r = await run(cmd, args, { cwd: base, timeoutMs, env: { ...env, CI: 'true', NO_COLOR: '1' } });
      return { ok: r.code === 0, output: r.output };
    },
    async diff() {
      if (created.size) await run('git', ['add', '-N', '--', ...created], { cwd: base, timeoutMs: 30_000 });
      const r = await run('git', ['diff', '--no-color', '--no-ext-diff', '--', ...new Set([...originals.keys(), ...created])], { cwd: base, timeoutMs: 30_000 });
      return r.code === 0 ? r.output : '';
    },
    async reset() {
      for (const [p, text] of originals) await writeFile(inside(p), text);
      if (created.size) await run('git', ['reset', '-q', '--', ...created], { cwd: base, timeoutMs: 30_000 });
      for (const p of created) await rm(inside(p), { force: true });
      originals.clear();
      created.clear();
    },
    touched: () => [...new Set([...originals.keys(), ...created])].map((p) => relative(base, inside(p)).split(sep).join('/')),
  };
}
