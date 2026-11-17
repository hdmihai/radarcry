/**
 * Architecture fitness test for api-node — the same idea as the scanner's test/architecture.test.js:
 *   domain       → only domain (pure: no node:*, no express, no clock)
 *   ports        → nothing
 *   application  → domain + ports
 *   routes       → nothing but express (they receive use-cases; never import adapters)
 *   services     → domain (errors) + node:* (they are the outbound adapters)
 *   server.js    → the only file allowed to import everything (composition root)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function jsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await jsFiles(p)));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

async function importsOf(file) {
  const src = await readFile(file, 'utf8');
  const specs = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm), ...src.matchAll(/^\s*export\s[^'"]*from\s+['"]([^'"]+)['"]/gm), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  return specs.map((s) => (s.startsWith('.') ? { spec: s, path: relative(ROOT, resolve(dirname(file), s)) } : { spec: s, path: null }));
}

const rule = (dir, allow) =>
  test(`${dir} respects the dependency rule`, async () => {
    for (const f of await jsFiles(join(ROOT, dir))) {
      for (const i of await importsOf(f)) {
        assert.ok(allow(i), `${relative(ROOT, f)} imports ${i.spec}`);
      }
    }
  });

rule('src/domain', (i) => i.path?.startsWith('src/domain/'));
rule('src/ports', () => false);
rule('src/application', (i) => i.path?.startsWith('src/domain/') || i.path?.startsWith('src/ports/'));
rule('src/routes', (i) => i.spec === 'express');
rule('src/middleware', (i) => i.spec.startsWith('node:'));
rule('src/services', (i) => i.spec.startsWith('node:') || i.path?.startsWith('src/domain/'));

test('the domain is deterministic: no clock, no randomness', async () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of await jsFiles(join(ROOT, 'src/domain'))) {
    const code = strip(await readFile(f, 'utf8'));
    for (const re of [/\bDate\.now\s*\(/, /\bMath\.random\s*\(/, /\bnew\s+Date\s*\(\s*\)/, /process\.env/]) {
      assert.ok(!re.test(code), `${relative(ROOT, f)} contains ${re}`);
    }
  }
});

test('process.env is read only by config.js (and the spawn adapter passing it through)', async () => {
  for (const f of await jsFiles(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f);
    if (rel === 'src/config.js' || rel === 'src/services/PythonBridge.js') continue;
    assert.ok(!/process\.env/.test(await readFile(f, 'utf8')), `${rel} reads process.env`);
  }
});

test('research only: no trading endpoint anywhere in the API', async () => {
  for (const f of await jsFiles(join(ROOT, 'src'))) {
    const src = await readFile(f, 'utf8');
    for (const re of [/createOrder/i, /placeOrder/i, /\bwithdraw\b/i, /privateKey/i, /sendTransaction/i]) {
      assert.ok(!re.test(src), `${relative(ROOT, f)} contains ${re}`);
    }
  }
});
