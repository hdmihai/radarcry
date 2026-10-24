#!/usr/bin/env node
/**
 * Verify the committed on-chain label dataset.
 *
 * Holder classification is the difference between "the biggest holder owns 40 %" and "the biggest
 * holder is a liquidity pool, and the biggest actor owns 8 %". The dataset that makes that
 * distinction is committed to the repository, so CI checks that it is present, large enough to be
 * useful, and still resolving the addresses the classifier depends on.
 */
import { readFile } from 'node:fs/promises';
import { createLabelIndex, HOLDER_CLASSES } from '../src/domain/onchain/labels.js';

const MIN_ADDRESSES = 10_000;

const raw = JSON.parse(await readFile(new URL('../config/labels/evm-labels.json', import.meta.url), 'utf8'));
const idx = createLabelIndex(raw);

const problems = [];
if (idx.size < MIN_ADDRESSES) problems.push(`indexul are doar ${idx.size} adrese (minimum ${MIN_ADDRESSES})`);
if (!idx.license) problems.push('licența setului de date lipsește din fișier');

const burn = idx.get('0x000000000000000000000000000000000000dead');
if (burn?.class !== HOLDER_CLASSES.BURN) problems.push('adresa canonică de ardere nu este clasificată ca burn');

// The classes the effective-concentration calculation depends on must all be represented.
for (const cls of ['cex', 'lp', 'bridge', 'staking']) {
  const present = (raw.classes ?? []).includes(cls) || (raw.accounts ?? []).some((a) => a.class === cls);
  if (!present) problems.push(`clasa "${cls}" lipsește din set — concentrarea efectivă ar fi greșită`);
}

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exitCode = 1;
} else {
  const counts = Object.entries(raw.counts ?? {}).map(([k, v]) => `${k} ${v.toLocaleString('ro-RO')}`).join(' · ');
  console.log(`${idx.size.toLocaleString('ro-RO')} adrese etichetate · licență ${idx.license} · sursă ${idx.source}`);
  console.log(counts);
}
