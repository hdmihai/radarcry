#!/usr/bin/env node
/**
 * Local development: start the Python analyst (uvicorn) and the Node API (Express) together, with
 * the static dashboard served by the API on the same origin.
 *
 *   npm run services:dev            → http://localhost:3000 (dashboard + /api), analyst on :8000
 *   PYTHON_BIN=.venv/bin/python npm run services:dev
 *
 * Zero dependencies (the scanner's rule): node:child_process only. Ctrl+C stops both.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON_BIN ?? (existsSync(join(root, '.venv', 'bin', 'python')) ? join(root, '.venv', 'bin', 'python') : 'python3');
const apiPort = process.env.PORT ?? '3000';
const analystPort = process.env.ANALYST_PORT ?? '8000';

if (!existsSync(join(root, 'services', 'api-node', 'node_modules'))) {
  console.error('lipsesc dependențele api-node: rulează întâi  npm run services:install');
  process.exit(1);
}
if (!existsSync(join(root, 'data', 'latest.json'))) {
  console.warn('data/latest.json lipsește: API-ul va citi snapshot-ul publicat pe GitHub Pages (sau rulează npm run scan:demo).');
}

const children = [];
function run(name, cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts, env: { ...process.env, ...opts.env } });
  const tag = `[${name}]`.padEnd(10);
  const pipe = (stream, out) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(`${tag}${l}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, sig) => {
    console.log(`${tag}s-a oprit (${sig ?? code})`);
    shutdown(code ?? 1);
  });
  child.on('error', (err) => {
    console.error(`${tag}nu pornește: ${err.message}`);
    shutdown(1);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('analyst', python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', analystPort], { cwd: join(root, 'services', 'analyst-python'), env: {} });
run('api', process.execPath, ['src/server.js'], {
  cwd: join(root, 'services', 'api-node'),
  env: { PORT: apiPort, HOST: '127.0.0.1', SERVE_FRONTEND: '1', ANALYST_URL: `http://127.0.0.1:${analystPort}`, CORS_ORIGINS: process.env.CORS_ORIGINS ?? `http://localhost:${apiPort},http://127.0.0.1:${apiPort},https://hdmihai.github.io` },
});
console.log(`dashboard + API: http://localhost:${apiPort}  ·  analist: http://127.0.0.1:${analystPort}/docs`);
