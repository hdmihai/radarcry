#!/usr/bin/env node
/** Parse-check every JavaScript file (backend, frontend, scripts, tests) with `node --check`. */
import { spawnSync } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'web', 'scripts', 'test', 'agent'];
// `--json <file>`: also write the result for the CI gate report (scripts/gates-annotate.js).
const jsonAt = process.argv.indexOf('--json');
const jsonOut = jsonAt >= 0 ? process.argv[jsonAt + 1] : null;

async function walk(dir, out = []) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') await walk(p, out);
    } else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = (await Promise.all(DIRS.map((d) => walk(join(root, d))))).flat();
const failedFiles = [];
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failedFiles.push(relative(root, f));
    console.error(`✗ ${relative(root, f)}\n${r.stderr}`);
  }
}
console.log(`${files.length - failedFiles.length}/${files.length} fișiere JS valide sintactic`);
if (jsonOut) await writeFile(jsonOut, JSON.stringify({ version: 1, total: files.length, pass: files.length - failedFiles.length, failed: failedFiles }));
process.exit(failedFiles.length ? 1 : 0);
