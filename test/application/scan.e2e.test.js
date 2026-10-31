/**
 * End-to-end: the real application core + fixture adapters, replayed over several days.
 * Verifies the published contract, the research-only invariants, persistence and point-in-time
 * behaviour of references, catalysts, watchlist and the forward journal.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSchema } from '../../src/adapters/outbound/publishing/schema-validator.js';
import { decodeTable } from '../../src/application/use-cases/universe-view.js';
import { ROOT, runFixtureDays } from '../fixture-run.js';

let run;
let last;
before(async () => {
  run = await runFixtureDays({ days: 9 });
  last = run.snapshots.at(-1);
});
after(async () => run?.cleanup());

test('every published snapshot satisfies the JSON schema contract', async () => {
  const schema = JSON.parse(await readFile(join(ROOT, 'schema/latest.schema.json'), 'utf8'));
  for (const s of run.snapshots) assert.deepEqual(validateSchema(s, schema), []);
  const onDisk = JSON.parse(await readFile(join(run.outDir, 'latest.json'), 'utf8'));
  assert.equal(onDisk.meta.runId, last.meta.runId, 'latest.json is the last run');
  const summary = JSON.parse(await readFile(join(run.outDir, 'summary.json'), 'utf8'));
  assert.ok(summary.signals || summary.stats || summary.runId, 'summary.json published next to latest.json');
});

test('research-only invariants are part of the contract', () => {
  assert.equal(last.meta.scope.researchOnly, true);
  assert.equal(last.meta.scope.tradeExecution, false);
  assert.equal(last.meta.scope.automatedTrading, false);
  assert.equal(last.meta.policy.unknownIsBearish, false);
  assert.match(last.meta.disclaimer, /nu sfat financiar/i);
});

test('universe funnel: top 1000 from both aggregators, exclusions documented, deep research bounded', () => {
  const u = last.health.universe;
  assert.equal(u.coingecko, 1000);
  assert.equal(u.coinmarketcap, 1000);
  assert.ok(u.eligible > 500 && u.eligible <= u.merged);
  assert.ok(Object.keys(last.health.exclusions).includes('STABLECOIN'));
  const deep = last.candidates.filter((c) => c.depth === 'deep');
  // The deep budget is `limit`, plus up to `keepWatchlist` slots of continuity for projects that
  // were building on the previous run (their holder and liquidity norms must keep accumulating).
  assert.ok(deep.length >= run.config.deep.limit, `deep research covers the full budget (${deep.length})`);
  assert.ok(deep.length <= run.config.deep.limit + run.config.deep.keepWatchlist, `deep research stays bounded (${deep.length})`);
  assert.ok(last.candidates.length <= deep.length + run.config.snapshot.maxLight, 'every deep row, plus at most maxLight light rows');
  // Candle payloads are the heaviest part of the contract, so they ship for the first
  // `snapshot.charts` deep rows; the rest keep their sparkline. Within that budget, a token with a
  // spot market must always carry both series.
  const charted = deep.slice(0, run.config.snapshot.charts);
  for (const c of charted.filter((x) => x.venues.mexcSpot || x.venues.binanceSpot)) {
    assert.ok(c.chart?.h4?.length && c.chart?.d1?.length, `${c.symbol} are piață spot dar nu are lumânări`);
  }
  assert.ok(deep.filter((c) => c.chart).length >= Math.min(deep.length, run.config.snapshot.charts) * 0.8, 'majoritatea candidaților din buget au lumânări');
  assert.ok(deep.filter((c) => c.chart).length <= run.config.snapshot.charts, 'bugetul de lumânări este respectat');
});

test('references are measured strictly before their anchor (no look-ahead)', () => {
  assert.deepEqual(last.references.map((r) => r.symbol).sort(), ['AGT', 'BTW', 'LAB']);
  for (const r of last.references) {
    assert.equal(r.status, 'COMPUTED');
    const anchor = Date.parse(`${r.window.to}T23:59:59Z`) / 1000;
    for (const [t] of r.window.closes) assert.ok(t <= anchor, `${r.symbol} pre-window point after anchor`);
    for (const [t] of r.window.after) assert.ok(t > anchor - 86_400, `${r.symbol} outcome window starts at anchor`);
  }
});

test('signals carry plans only when actionable; every plan is geometrically valid', () => {
  for (const c of last.candidates) {
    const p = c.signal.plan;
    if (!['BUY_SETUP', 'ACCUMULATE'].includes(c.signal.type)) assert.equal(p, null, `${c.symbol} ${c.signal.type} has a plan`);
    if (p) {
      assert.ok(p.invalidation < p.entryLow && p.entryLow <= p.entryHigh, `${c.symbol} plan order`);
      assert.ok(p.targets.every((t) => t.price > p.entryHigh), `${c.symbol} targets above entry`);
    }
    if (c.risk.critical) assert.equal(c.signal.type, 'AVOID');
  }
});

test('change-based catalysts, watchlist transitions and the forward journal accumulate over runs', () => {
  assert.equal(run.snapshots[0].catalysts.filter((e) => e.source !== 'manual').length, 0, 'first run = silent baseline');
  assert.ok(last.catalysts.length > 0);
  assert.ok(last.watchlist.transitions.length > 0);
  // The similarity engine keeps its own forward journal under `legacy`; the v4 cohort is separate.
  const recent = last.trackRecord.legacy.recent;
  assert.ok(recent.length > 0);
  for (const e of recent) assert.ok(['BUY_SETUP', 'ACCUMULATE'].includes(e.type));
  const acc = last.trackRecord.legacy.summary.byType.ACCUMULATE;
  for (const h of acc.horizons) if (h.n) assert.ok(h.ciLow <= h.hitRate && h.hitRate <= h.ciHigh, 'intervalul Wilson încadrează rata');
  // The v4 cohort reports honestly that it has too few samples rather than quoting a win rate.
  const cohort = last.trackRecord.cohort;
  assert.match(cohort.cohort, /Stage 2/);
  for (const h of Object.values(cohort.horizons)) {
    if (h.n === 0) assert.equal(h.winRate, null, 'o scadență fără intrări nu raportează o rată');
    if (h.n > 0 && h.n < 20) assert.equal(h.sufficient, false, 'sub 20 de intrări, rezultatul este marcat ca insuficient');
    if (h.ci95) assert.ok(h.ci95.low <= h.winRate && h.winRate <= h.ci95.high, 'intervalul Wilson încadrează rata');
  }
});

test('state persists in compact, bounded files', async () => {
  const files = (await readdir(run.stateDir)).sort();
  const expected = [
    'catalysts.json', 'cohort.json', 'discovery.json', 'flows.json', 'history.json', 'journal.json',
    'last-seen-v4.json', 'last-seen.json', 'meta.json', 'quota-ledger.json', 'references.json',
    'registry.json', 'telemetry.json',
  ];
  for (const f of expected) assert.ok(files.includes(f), `lipsește ${f}`);
  const history = JSON.parse(await readFile(join(run.stateDir, 'history.json'), 'utf8'));
  assert.ok(Array.isArray(history.fields) && history.fields[0] === 't', 'codec columnar pentru istoric');

  // The discovery history is the point-in-time memory the change engine compares against: it must be
  // columnar too, carry its own field list, and hold more than one point after several runs.
  const discovery = JSON.parse(await readFile(join(run.stateDir, 'discovery.json'), 'utf8'));
  assert.ok(Array.isArray(discovery.metrics) && discovery.metrics.includes('volume24h'), 'metricile urmărite călătoresc cu fișierul');
  const series = Object.values(discovery.assets);
  assert.ok(series.length > 0, 'istoricul de descoperire are active');
  assert.ok(series.some((a) => (a.p ?? []).length >= 3), 'un activ are cel puțin trei puncte după mai multe rulări');

  // Holder snapshots are what make accumulation measurable; they must persist between runs.
  const flows = JSON.parse(await readFile(join(run.stateDir, 'flows.json'), 'utf8'));
  assert.ok(Object.keys(flows).length > 0, 'instantaneele de deținători persistă');

  const meta = JSON.parse(await readFile(join(run.stateDir, 'meta.json'), 'utf8'));
  assert.equal(meta.runs, 9);
  assert.equal(meta.stateVersion, 3);
});

test('determinism: the same day on a fresh state reproduces the same ranking', async () => {
  const a = await runFixtureDays({ days: 1 });
  const b = await runFixtureDays({ days: 1 });
  try {
    const key = (s) => s.candidates.slice(0, 40).map((c) => `${c.key}:${c.score.cri}:${c.signal.type}`).join('|');
    assert.equal(key(a.snapshots[0]), key(b.snapshots[0]));
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});

test('Arkham wallet intelligence flows through the pipeline (DEMO simulates a configured key)', async () => {
  const ark = last.health.providers.find((p) => p.id === 'arkham');
  assert.equal(ark.status, 'OK');
  const withFlows = last.candidates.filter((c) => c.onchain?.walletFlows);
  assert.ok(withFlows.length > 0 && withFlows.length <= run.config.deep.arkhamLimit, `${withFlows.length} tokens with flows`);
  for (const c of withFlows) {
    assert.equal(c.depth, 'deep');
    assert.ok(c.onchain.sources.includes('arkham'));
    const fact = c.domains.find((d) => d.id === 'onchain').facts.find((f) => f.key === 'walletFlow');
    assert.ok(Number.isFinite(fact.score), `${c.symbol} wallet-flow fact scored`);
  }
  assert.ok(withFlows.some((c) => c.onchain.walletFlows.persistence?.total >= 2), 'persistence is built from the own history across runs');
  const history = JSON.parse(await readFile(join(run.stateDir, 'history.json'), 'utf8'));
  assert.ok(history.fields.includes('walletNet'));
});

test('market-cap growth: 24h from CoinGecko, 7d from the own history once a week of runs exists', () => {
  assert.ok(last.candidates.some((c) => Number.isFinite(c.market.mcapChange?.h24)));
  assert.ok(last.candidates.some((c) => Number.isFinite(c.market.mcapChange?.d7)));
  assert.ok(last.candidates.some((c) => Number.isFinite(c.market.rankChange7d)));
});

test('every eligible project builds its own norm, not only the ones researched in depth', async () => {
  const cov = last.discovery.coverage;
  assert.ok(cov, 'the snapshot reports how far the per-project norms have got');
  assert.equal(cov.eligible, last.health.universe.eligible);
  assert.equal(cov.minPoints, run.config.discovery.baselineMinPoints);
  // Nine daily runs: every project that stayed eligible has had at least four points of history.
  assert.ok(cov.withBaseline >= cov.eligible * 0.8, `${cov.withBaseline}/${cov.eligible} projects with a sufficient norm`);
  assert.equal(cov.runsToNorms, 0);

  const raw = JSON.parse(await readFile(join(run.stateDir, 'discovery.json'), 'utf8'));
  const tracked = Object.keys(raw.assets ?? raw).length;
  assert.ok(tracked >= cov.eligible * 0.9, `${tracked} projects tracked in discovery history, ${cov.eligible} eligible`);
  assert.ok(tracked > run.config.deep.limit + run.config.deep.keepWatchlist, 'history is no longer limited to the deep shortlist');
});

test('the change engine claims part of the deep budget once norms exist', () => {
  const cov = last.discovery.coverage;
  assert.ok(cov.moving > 0, 'on a market with pre-expansion projects, something moves against its own norm');
  assert.ok(cov.prescreened > 0, 'and the change engine brings some of it into depth');
  assert.ok(cov.prescreened <= Math.round(run.config.deep.limit * run.config.deep.shares.prescreen));
  const first = run.snapshots[0].discovery.coverage;
  assert.equal(first.withBaseline, 0, 'the first run has no history: nothing is measured against a norm yet');
  assert.equal(first.runsToNorms, run.config.discovery.baselineMinPoints);
});

test('discovery-driven projects are researched first: the capped checks reach them', () => {
  // Security and holder checks are capped (45 projects). Projects brought in by the change engine,
  // or kept for continuity, must not lose them to projects selected by the legacy score alone.
  const rows = last.discovery.rows;
  assert.ok(rows.every((r) => ['CHANGE_ENGINE', 'CONTINUITY', 'SCORE', 'HORIZON'].includes(r.selectedBy)), 'every row says why it was researched');
  const driven = rows.filter((r) => ['CHANGE_ENGINE', 'CONTINUITY'].includes(r.selectedBy) && r.contract);
  assert.ok(driven.length > 0);
  const scanned = driven.filter((r) => r.onchain?.security).length;
  assert.ok(scanned >= driven.length * 0.9, `${scanned}/${driven.length} discovery-driven projects have a contract scan`);
});

test('Binance Alpha tokens below the top 1000 are part of the universe and build their own norm', async () => {
  const u = last.health.universe;
  assert.ok(u.binanceAlpha > 0, 'the Alpha list is read');
  assert.ok(u.alphaOnly > 0, 'some Alpha tokens are outside the aggregators\' top 1000');
  assert.ok(u.alphaOnlyEligible > 0, 'and some of those pass the small-cap screen');
  assert.ok(u.merged > u.coingecko, 'they are added, not only used as tags');

  const raw = JSON.parse(await readFile(join(run.stateDir, 'discovery.json'), 'utf8'));
  const alphaSrc = raw.metrics.indexOf('holdersSource');
  const tracked = Object.values(raw.assets).filter((a) => a.p.some((pt) => pt[1]?.[alphaSrc] === 'A'));
  // Every eligible project the universe holds only through Binance Alpha has Alpha holder readings.
  const table = decodeTable(JSON.parse(await readFile(join(run.outDir, 'universe.json'), 'utf8')).assets);
  const binanceOnly = table.filter((r) => r.sources === 'BA').length;
  assert.ok(tracked.length >= binanceOnly, `${tracked.length} projects carry Binance Alpha holder readings in their norm (${binanceOnly} Binance-only)`);
});

test('the research horizon is the whole eligible universe, published as one table next to the contract', async () => {
  const u = last.health.universe;
  assert.ok(u.deep > run.config.deep.limit + run.config.deep.keepWatchlist, `${u.deep} researched — beyond the old shortlist`);
  assert.ok(u.deep >= u.eligible * 0.9, `${u.deep}/${u.eligible} eligible projects researched in depth`);
  assert.ok(u.priority <= run.config.deep.limit + run.config.deep.keepWatchlist, 'the priority stays the shortlist');
  assert.equal(last.discovery.analysed, u.discovered);
  assert.ok(last.discovery.rows.length <= run.config.snapshot.discoveryRows + last.discovery.earlyCandidates, 'the contract carries the top of the ranking');
  assert.ok(new Set(last.discovery.rows.map((r) => r.detail)).size >= 2, 'with graded levels of evidence');

  const uSchema = JSON.parse(await readFile(join(ROOT, 'schema/universe.schema.json'), 'utf8'));
  const universe = JSON.parse(await readFile(join(run.outDir, 'universe.json'), 'utf8'));
  assert.deepEqual(validateSchema(universe, uSchema), []);
  assert.equal(universe.runId, last.meta.runId, 'the table belongs to the same run');
  assert.equal(universe.assets.rows.length, u.eligible, 'one row per eligible project');
  for (const t of [universe.assets, universe.futures]) for (const r of t.rows) assert.equal(r.length, t.fields.length);
  assert.equal(last.meta.universe.projects, u.eligible);

  const rows = decodeTable(universe.assets);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const d of last.discovery.rows) assert.equal(byKey.get(d.key)?.detail, d.detail, `${d.symbol}: the table says where its evidence is`);
  assert.ok(rows.filter((r) => r.detail === 'research').length > 0, 'researched projects beyond the published top are in the table');
  assert.ok(rows.every((r, i) => r.rank === i + 1));
});

test('the Futures Radar covers every perpetual market of the universe', () => {
  const f = last.futures.summary;
  assert.ok(f.scanned > run.config.futures.watchlist.length + run.config.futures.extraFromRadar, `${f.scanned} instruments`);
  assert.ok(last.futures.rows.length <= run.config.snapshot.futuresRows);
  assert.equal(f.published, last.futures.rows.length);
});

test('Gate Alpha is a universe source and a venue, next to Binance Alpha', () => {
  const u = last.health.universe;
  assert.ok(u.gateAlpha > 0, 'Gate\'s list is read');
  assert.ok(u.alphaPrograms.gate > 0 && u.alphaPrograms.both > 0, 'and tagged, including tokens on both programmes');
  assert.ok(last.discovery.rows.some((r) => r.alphaPrograms?.includes('gate')));
  assert.equal(last.health.providers.find((p) => p.id === 'gate_alpha')?.status, 'OK');
  const entries = run.snapshots.flatMap((s) => s.catalysts).filter((e) => e.type === 'NEW_GATE_ALPHA');
  assert.ok(entries.length > 0, 'projects joining Gate Alpha after the baseline are catalysts');
  assert.equal(run.snapshots[0].catalysts.filter((e) => e.type === 'NEW_GATE_ALPHA').length, 0, 'the first read is only the baseline');
});

test('static facts are carried between runs, measurements are not, and coverage accumulates', async () => {
  const roll = last.health.universe.rolling;
  assert.ok(roll.tiers.security.carried > 0, 'contract scans from earlier runs are reused');
  assert.ok(roll.cache.security > run.config.deep.securityLimit, `${roll.cache.security} contracts covered — more than one run's budget`);
  const cache = JSON.parse(await readFile(join(run.stateDir, 'deep-cache.json'), 'utf8'));
  for (const [key, e] of Object.entries(cache)) {
    if (e.security) assert.equal(e.security.data.holders, undefined, `${key}: a holder count is never cached`);
    if (e.detail) assert.equal(e.detail.data.watchlistUsers, undefined, `${key}: a watchlist count is never cached`);
  }
});

test('only projects that pass the validity gate reach the CRI lists; the rest are published with the reason', async () => {
  const v = last.validity;
  assert.ok(v, 'the snapshot carries the gate');
  const u = last.health.universe;
  assert.equal(v.summary.checked, u.eligible, 'every eligible project is judged');
  assert.equal(v.summary.valid + v.summary.pending + v.summary.rejected, v.summary.checked);
  assert.equal(v.policy.maxMarketCapUsd, 300e6);
  assert.ok(v.summary.valid > 0 && v.summary.rejected > 0, `${v.summary.valid} valid, ${v.summary.rejected} rejected`);

  // The CRI lists: Small-Cap Radar, CRI radar (candidates), alerts — VALID only.
  assert.ok(last.discovery.rows.length > 0);
  for (const r of last.discovery.rows) {
    assert.equal(r.validity?.status, 'VALID', `${r.symbol} on the Small-Cap Radar`);
    assert.ok(!(r.market?.marketCap > 300e6), `${r.symbol}: under the $300M cap`);
  }
  for (const c of last.candidates) assert.equal(c.validity?.status, 'VALID', `${c.symbol} on the CRI radar`);
  const held = new Set([...v.rejected, ...v.pending].map((x) => x.key));
  const alertKeys = [...(last.alerts.items ?? []), ...(last.watchlist.alerts ?? []), ...(last.watchlist.transitions ?? [])].map((a) => a.key).filter(Boolean);
  for (const k of alertKeys) assert.ok(!held.has(k), `${k}: no alert for a project held back`);
  assert.equal(last.discovery.validity.valid, v.summary.valid);

  // Every held-back project says why, in the snapshot and in the universe table.
  for (const x of v.rejected) {
    assert.ok(x.codes.length > 0 && x.why.length > 0, `${x.symbol}: a reason`);
    assert.equal(x.status, 'REJECTED');
  }
  for (const x of v.pending) assert.equal(x.status, 'PENDING');
  const universe = JSON.parse(await readFile(join(run.outDir, 'universe.json'), 'utf8'));
  const rows = decodeTable(universe.assets);
  assert.equal(rows.filter((r) => r.valid === 'V').length, v.summary.valid);
  assert.equal(rows.filter((r) => r.valid === 'R').length, v.summary.rejected);
  for (const r of rows.filter((x) => x.valid !== 'V')) assert.ok(r.validWhy, `${r.symbol}: the table says why`);
  const codes = rows.map((r) => r.valid);
  assert.deepEqual(codes, [...codes].sort((a, b) => 'VPR'.indexOf(a) - 'VPR'.indexOf(b)), 'verified rows lead the table');
});

test('every researched project gets a ≥100× forecast; the learning list holds the last year\'s winners', async () => {
  const f = last.forecast;
  assert.ok(f, 'the snapshot carries the forecast');
  assert.deepEqual(f.targets, [100, 20]);
  const r100 = f.baseRates.find((r) => r.multiple === 100);
  assert.ok(r100.pct > 0 && r100.pct < 5 && r100.lo <= r100.pct && r100.pct <= r100.hi, JSON.stringify(r100));
  assert.ok(r100.population >= last.health.universe.eligible, 'the population is at least today\'s universe');
  const confirmed = f.winners.filter((w) => w.status === 'CONFIRMED');
  for (const sym of ['PYXL', 'WNRA', 'VLBT']) assert.ok(confirmed.some((w) => w.symbol === sym && w.multiple >= 100), `${sym}: the planted ≥100× run is confirmed from history`);
  assert.ok(confirmed.some((w) => w.symbol === 'LAB'), 'the LAB seed is resolved by ticker and name, and confirmed');
  assert.ok(f.winners.some((w) => w.symbol === 'AKE' && w.status === 'DOCUMENTED'), 'a seed without history stays documented, with its sources');
  assert.ok(f.model.positives['100'] >= 3 && f.model.positives['20'] >= f.model.positives['100']);
  assert.ok(f.top.length > 0 && f.top.every((t) => t.targets['100'].pct >= 0));
  for (const row of last.discovery.rows) assert.ok(row.forecast?.targets?.['100'], `${row.symbol}: forecast published with the row`);
  for (const c of last.candidates) assert.ok(c.forecast, `${c.symbol}: forecast on the research card`);

  const universe = decodeTable(JSON.parse(await readFile(join(run.outDir, 'universe.json'), 'utf8')).assets);
  assert.ok(universe.filter((r) => r.valid !== 'R').every((r) => Number.isFinite(r.fc100) && Number.isFinite(r.fc20)), 'every non-rejected row carries its forecast');
  assert.ok(universe.filter((r) => r.valid === 'R').every((r) => r.fc100 === null), 'no forecast for a rejected project');
  const state = JSON.parse(await readFile(join(run.stateDir, 'winners.json'), 'utf8'));
  assert.equal(state.items.length, f.winners.length, 'the learning list persists between runs');
});
