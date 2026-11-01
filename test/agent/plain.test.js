/**
 * How the agent writes: plain text a phone or a terminal shows as it is — Romanian numbers, the
 * owner's local time, no Markdown — and a model's or a document's markup cleaned away.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut, day, hasMarkup, isoText, list, n, passage, pct, plain, ro, roText, unwrap, when } from '../../agent/domain/plain.js';

test('plain text: Romanian numbers, plurals with „de” from 20, lists with „și”', () => {
  assert.equal(ro(2362, 0), '2 362');
  assert.equal(ro(10.1), '10,1');
  assert.equal(ro(-11.43), '−11,4');
  assert.equal(ro(1234567.891, 2), '1 234 567,89');
  assert.equal(ro(3.0), '3', 'no trailing zeros');
  assert.equal(ro(null), '—');
  assert.equal(pct(3.21), '3,2%');
  assert.equal(pct(undefined), '—');
  assert.equal(n(1, 'poartă', 'porți'), '1 poartă');
  assert.equal(n(3, 'poartă', 'porți'), '3 porți');
  assert.equal(n(24, 'poartă', 'porți'), '24 de porți');
  assert.equal(n(101, 'poartă', 'porți'), '101 porți');
  assert.equal(n(120, 'poartă', 'porți'), '120 de porți');
  assert.equal(n(0, 'eșec', 'eșecuri'), '0 eșecuri');
  assert.equal(list(['a']), 'a');
  assert.equal(list(['a', 'b', 'c']), 'a, b și c');
  assert.equal(list(['a', null, '', 'b']), 'a și b');
  assert.equal(cut('unu doi trei patru cinci', 12), 'unu doi…');
});

test('plain text: times in the owner time zone, from an ISO time or milliseconds', () => {
  // 31 October 2026, 20:10 UTC is 22:10 in Bucharest (EET, after the October change).
  assert.equal(when('2026-10-31T20:10:00.000Z'), '31 octombrie, 22:10');
  assert.equal(when(Date.parse('2026-07-01T09:05:00Z')), '1 iulie, 12:05', 'summer time (EEST)');
  assert.equal(when('2026-10-31T20:10:00.000Z', 'UTC'), '31 octombrie, 20:10');
  assert.equal(when('2026-12-31T22:30:00Z'), '1 ianuarie, 00:30');
  assert.equal(when('nu e o dată'), '—');
});

test('plain text: Markdown and HTML cleaned away, cron expressions and identifiers kept', () => {
  const md = [
    '## Titlu',
    '',
    '**Important:** vezi `scan.run` și [documentația](https://exemplu.ro/x).',
    '',
    '| Poartă | Stare |',
    '|---|---|',
    '| scan.run | trece |',
    '',
    '* unu',
    '+ doi',
    '> citat',
    '```js',
    'cod();',
    '```',
    '<details><summary>mai mult</summary>ascuns</details>',
    '<!-- marker -->',
  ].join('\n');
  const out = plain(md);
  assert.equal(hasMarkup(md), true);
  assert.equal(hasMarkup(out), false, out);
  assert.match(out, /^Titlu$/m);
  assert.match(out, /Important: vezi scan\.run și documentația\./);
  assert.match(out, /^Poartă — Stare$/m);
  assert.match(out, /^scan\.run — trece$/m);
  assert.doesNotMatch(out, /---/);
  assert.match(out, /^- unu$/m);
  assert.match(out, /^- doi$/m);
  assert.match(out, /^citat$/m);
  assert.match(out, /^cod\(\);$/m);
  assert.doesNotMatch(out, /marker|<|>/);
  // Asterisks that are not emphasis stay: a cron expression is evidence.
  assert.equal(plain('promise de „17 */4 * * *” (57%)'), 'promise de „17 */4 * * *” (57%)');
  assert.equal(plain('„7,22,37,52 * * * *”'), '„7,22,37,52 * * * *”');
  assert.equal(plain('un *cuvânt* subliniat și _altul_'), 'un cuvânt subliniat și altul');
  assert.equal(plain('SOLANA_RPC_URL și GITHUB_TOKEN rămân'), 'SOLANA_RPC_URL și GITHUB_TOKEN rămân');
});

test('plain text: the decimals of a measured text the Romanian way, names and versions untouched', () => {
  assert.equal(roText('24 de rulări = 3.43/zi; interval median 2.2 h; rata 3.2%; ×2.78'), '24 de rulări = 3,43/zi; interval median 2,2 h; rata 3,2%; ×2,78');
  assert.equal(roText('−11.4% și -0.5'), '−11,4% și -0,5');
  for (const keep of ['scan.run', 'v1.2.3', 'qwen2.5:3b', '2026-10-31T15:10:00.000Z', 'agent/config.json', 'Node 22, 24', '1,5 ore']) assert.equal(roText(keep), keep, keep);
});

test('plain text: ISO times in evidence read as local times; quoted passages unwrapped, their lists kept', () => {
  assert.equal(isoText('a pornit la 2026-10-17T09:15:36.478Z, dar starea e din 2026-10-17T09:00:00Z.'), 'a pornit la 17 octombrie, 12:15, dar starea e din 17 octombrie, 12:00.');
  assert.equal(isoText('ziua 2026-10-17 rămâne'), 'ziua 2026-10-17 rămâne', 'a date without a time is not rewritten');
  assert.equal(isoText('Scanarea din 2026-11-01 06:18 UTC (schedule)'), 'Scanarea din 1 noiembrie, 08:18 (schedule)');
  assert.equal(day('2025-12-02'), '2 decembrie 2025');
  assert.equal(day(null), '—');
  const md = ['Un paragraf scris pe', 'două rânduri.', '', '- un element', '  care continuă', '- altul', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '```bash', 'npm run agent:chat', 'npm test', '```', '26. Livrarea', '    aplicată în clone.'].join('\n');
  const u = unwrap(md);
  assert.match(u, /^Un paragraf scris pe două rânduri\.$/m);
  assert.match(u, /^- un element care continuă$/m);
  assert.match(u, /^- altul$/m);
  assert.match(u, /^\| 1 \| 2 \|$/m, 'table rows keep their lines');
  assert.match(u, /^npm run agent:chat\nnpm test$/m, 'a code block keeps its lines');
  assert.match(u, /^26\. Livrarea aplicată în clone\.$/m, 'an item continues on its indented line');
  const p = plain(u);
  assert.equal(hasMarkup(p), false, p);
  assert.match(p, /^1 — 2$/m);
  const long = passage(['primul rând', 'x'.repeat(50), 'al treilea rând care nu mai încape'].join('\n'), 70);
  assert.equal(long.split('\n')[0], 'primul rând');
  assert.ok(long.length <= 90, long);
  assert.equal(passage('  spații   multe  \n\n\n  rând  '), 'spații multe\nrând');
});
