#!/usr/bin/env node
/**
 * Validate a published snapshot against schema/latest.schema.json and print a short summary.
 * Exit code 1 when the file is missing, not JSON, or violates the contract.
 *
 *   node scripts/validate-snapshot.js data/latest.json
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../src/adapters/outbound/publishing/schema-validator.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(process.cwd(), process.argv[2] ?? 'data/latest.json');

try {
  const schema = JSON.parse(await readFile(resolve(root, 'schema/latest.schema.json'), 'utf8'));
  const snap = JSON.parse(await readFile(file, 'utf8'));
  const errors = validateSchema(snap, schema);
  if (errors.length) {
    console.error(`INVALID ${file}: ${errors.length} erori`);
    for (const e of errors.slice(0, 25)) console.error(`  - ${e}`);
    process.exit(1);
  }
  const deep = snap.candidates.filter((c) => c.depth === 'deep').length;
  console.log(`OK ${file}`);
  console.log(`  schema ${snap.schemaVersion}, rulare ${snap.meta.runId}, mod ${snap.meta.mode}, sănătate ${snap.health.overall}`);
  console.log(`  candidați ${snap.candidates.length} (deep ${deep}), referințe ${snap.references.length}, catalizatori ${snap.catalysts.length}`);
  console.log(`  semnale ${JSON.stringify(snap.stats.signals)}`);
} catch (err) {
  console.error(`INVALID ${file}: ${err.message}`);
  process.exit(1);
}
