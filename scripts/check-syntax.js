#!/usr/bin/env node
/** Parse-check every JavaScript file (backend, frontend, scripts, tests) with `node --check`. */
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'web', 'scripts', 'test'];

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
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    console.error(`✗ ${relative(root, f)}\n${r.stderr}`);
  }
}
console.log(`${files.length - failed}/${files.length} fișiere JS valide sintactic`);
process.exit(failed ? 1 : 0);
