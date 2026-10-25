#!/usr/bin/env node
/**
 * Assemble the static site: dist/ = web/ (frontend) + data/latest.json + data/summary.json +
 * data/universe.json (the whole research horizon, loaded by the dashboard on demand).
 * The frontend has no build step (native ES modules); this only copies and validates inputs.
 *
 *   node scripts/build-site.js [--data data] [--out dist]
 */
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const dataDir = resolve(root, arg('data', 'data'));
const outDir = resolve(root, arg('out', 'dist'));

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(join(root, 'web'), outDir, { recursive: true });
  await mkdir(join(outDir, 'data'), { recursive: true });

  const latest = join(dataDir, 'latest.json');
  if (await exists(latest)) {
    const body = await readFile(latest, 'utf8');
    JSON.parse(body); // refuse to publish a truncated file
    await writeFile(join(outDir, 'data', 'latest.json'), body);
    if (await exists(join(dataDir, 'summary.json'))) await cp(join(dataDir, 'summary.json'), join(outDir, 'data', 'summary.json'));
    let extra = '';
    const universe = join(dataDir, 'universe.json');
    if (await exists(universe)) {
      const ubody = await readFile(universe, 'utf8');
      JSON.parse(ubody); // same rule: never publish a truncated file
      await writeFile(join(outDir, 'data', 'universe.json'), ubody);
      extra = `, univers ${(ubody.length / 1024).toFixed(0)} KB`;
    }
    console.log(`site: ${outDir} (snapshot ${(body.length / 1024).toFixed(0)} KB${extra})`);
  } else {
    console.warn(`site: ${outDir} construit FĂRĂ snapshot (${latest} lipsește) — dashboard-ul va afișa instrucțiunile de pornire.`);
  }
  await writeFile(join(outDir, '.nojekyll'), '');
}

main().catch((err) => {
  console.error(`build-site: ${err.message}`);
  process.exit(1);
});
