#!/usr/bin/env node
/**
 * Validate a published snapshot against schema/latest.schema.json and print a short summary; the
 * horizon table next to it (universe.json) is validated against schema/universe.schema.json when
 * the snapshot points to one and the file exists. Exit code 1 when a file is missing, not JSON, or
 * violates its contract.
 *
 *   node scripts/validate-snapshot.js data/latest.json
 */
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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

  const uFile = join(dirname(file), 'universe.json');
  const exists = await stat(uFile).then(() => true, () => false);
  if (snap.meta?.universe && exists) {
    const uSchema = JSON.parse(await readFile(resolve(root, 'schema/universe.schema.json'), 'utf8'));
    const universe = JSON.parse(await readFile(uFile, 'utf8'));
    const uErrors = validateSchema(universe, uSchema);
    const widths = [universe.assets, universe.futures].every((t) => t.rows.every((r) => r.length === t.fields.length));
    if (uErrors.length || !widths) {
      console.error(`INVALID ${uFile}: ${uErrors.length} erori${widths ? '' : ' (rânduri cu alt număr de coloane decât lista de câmpuri)'}`);
      for (const e of uErrors.slice(0, 25)) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log(`OK ${uFile}`);
    console.log(`  rulare ${universe.runId}, ${universe.assets.rows.length} proiecte, ${universe.futures.rows.length} piețe perpetue`);
  } else if (snap.meta?.universe) {
    console.log(`  (fără ${uFile} lângă snapshot — dashboard-ul afișează ecranul Univers ca „în așteptare”)`);
  }
} catch (err) {
  console.error(`INVALID ${file}: ${err.message}`);
  process.exit(1);
}
