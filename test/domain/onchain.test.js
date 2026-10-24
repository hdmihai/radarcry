/**
 * The on-chain engine: turning a list of addresses into a list of *actors*, and two snapshots of
 * that list into a verdict about accumulation.
 *
 * The single most important property tested here is that concentration is computed over the supply
 * that can actually be sold. A top-holder list whose largest entry is a liquidity pool says nothing
 * about who can dump; counting it would make every token look dangerous and every comparison
 * meaningless.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BURN_ADDRESSES, EXCLUDED_FROM_EFFECTIVE, HOLDER_CLASSES,
  arkhamTypeClass, classifyHolder, classifyHolders, createLabelIndex,
} from '../../src/domain/onchain/labels.js';
import { LARGE_HOLDER_PCT, MIN_ACCUMULATING, VERDICT, appendFlowSnapshot, flowSnapshot, holderFlows } from '../../src/domain/onchain/holder-flows.js';
import { PENALTIES, POSITIVE, smartMoneyScore } from '../../src/domain/onchain/smart-money.js';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-06-01T00:00:00Z');

const idx = createLabelIndex([
  { address: '0xcex0000000000000000000000000000000000001', class: 'cex', entity: 'Binance' },
  { address: '0xfund000000000000000000000000000000000001', class: 'fund', entity: 'Fund Alpha' },
  { address: '0xbridge00000000000000000000000000000000001', class: 'bridge', entity: 'Wormhole' },
  { address: '0xflag000000000000000000000000000000000001', class: 'flagged', entity: 'Exploiter' },
]);

test('the label index decodes both the committed columnar format and a plain row list', () => {
  const columnar = createLabelIndex({
    format: 'columnar-v1',
    classes: ['cex', 'lp'],
    entities: ['Binance', 'PancakeSwap'],
    rows: ['cex0000000000000000000000000000000000001|0|0', 'lp00000000000000000000000000000000000001|1|1'],
    counts: { cex: 1, lp: 1 },
    license: 'MIT',
  });
  assert.equal(columnar.size, 2);
  assert.equal(columnar.get('0xCEX0000000000000000000000000000000000001').class, 'cex');
  assert.equal(columnar.get('0xcex0000000000000000000000000000000000001').entity, 'Binance');
  assert.equal(columnar.license, 'MIT');
  assert.equal(columnar.get('0xnothing'), null);
  assert.equal(createLabelIndex(null).size, 0, 'a missing dataset degrades to structural detection');
});

test('classification precedence: burn beats everything, then Arkham, then the bundled dataset', () => {
  const burn = classifyHolder({ address: '0x000000000000000000000000000000000000dead', share: 10 }, { labelIndex: idx });
  assert.equal(burn.class, HOLDER_CLASSES.BURN);
  assert.equal(burn.source, 'canonical');
  assert.ok(BURN_ADDRESSES.has('0x000000000000000000000000000000000000dead'));

  // Arkham outranks the bundled dataset when a key is configured.
  const arkham = new Map([['0xcex0000000000000000000000000000000000001', { name: 'Fund Beta', type: 'fund' }]]);
  const viaArkham = classifyHolder({ address: '0xcex0000000000000000000000000000000000001', share: 5 }, { labelIndex: idx, arkham });
  assert.equal(viaArkham.class, HOLDER_CLASSES.FUND);
  assert.equal(viaArkham.source, 'arkham');

  // Without a key, the same address falls back to the bundled dataset — nothing breaks.
  const viaLabels = classifyHolder({ address: '0xcex0000000000000000000000000000000000001', share: 5 }, { labelIndex: idx });
  assert.equal(viaLabels.class, HOLDER_CLASSES.CEX);
  assert.equal(viaLabels.source, 'eth-labels');

  // A token's own pool, discovered this run, is a pool whatever any dataset says.
  const pair = classifyHolder({ address: '0xpair000000000000000000000000000000000001', share: 9 }, { labelIndex: idx, pairs: ['0xPAIR000000000000000000000000000000000001'] });
  assert.equal(pair.class, HOLDER_CLASSES.LP);

  // An unlabelled contract is still not a person.
  assert.equal(classifyHolder({ address: '0xunknown', share: 1, isContract: true }, { labelIndex: idx }).class, HOLDER_CLASSES.CONTRACT);
  // An unlabelled address is treated as an individual wallet, and says so.
  const plain = classifyHolder({ address: '0xunknown2', share: 1 }, { labelIndex: idx });
  assert.equal(plain.class, HOLDER_CLASSES.WALLET);
  assert.equal(plain.source, 'default');
});

test('Arkham entity types map onto actor classes, and an unknown type is not guessed', () => {
  assert.equal(arkhamTypeClass('cex'), HOLDER_CLASSES.CEX);
  assert.equal(arkhamTypeClass('fund'), HOLDER_CLASSES.FUND);
  assert.equal(arkhamTypeClass('bridge'), HOLDER_CLASSES.BRIDGE);
  assert.equal(arkhamTypeClass('treasury'), HOLDER_CLASSES.PROJECT);
  assert.equal(arkhamTypeClass('mev'), HOLDER_CLASSES.BOT);
  assert.equal(arkhamTypeClass('hack'), HOLDER_CLASSES.FLAGGED);
  assert.equal(arkhamTypeClass('something-new'), null);
  assert.equal(arkhamTypeClass(null), null);
});

test('effective concentration excludes the supply nobody can decide to sell', () => {
  const holders = [
    { address: '0xpool000000000000000000000000000000000001', share: 40, tag: 'PancakeSwap LP' },
    { address: '0x000000000000000000000000000000000000dead', share: 20 },
    { address: '0xcex0000000000000000000000000000000000001', share: 10 },
    { address: '0xwhale00000000000000000000000000000000001', share: 8 },
    { address: '0xwhale00000000000000000000000000000000002', share: 7 },
    { address: '0xtail000000000000000000000000000000000001', share: 5 },
  ];
  const c = classifyHolders(holders, { labelIndex: idx });

  assert.equal(c.top10Pct, 90, 'the raw figure counts the pool and the burn address');
  // 40 (pool) + 20 (burn) = 60 excluded, so the tradable base is 40 points of supply.
  assert.equal(c.effectiveSharePct, 40);
  // The tradable holders sum to 30 points, which is 75 % of the 40-point tradable base.
  assert.equal(c.top10EffectivePct, 75);
  assert.ok(c.top10EffectivePct > c.top10Pct - 20, 'the effective figure tells a different, truer story');

  assert.equal(c.lpSharePct, 40);
  assert.equal(c.burnSharePct, 20);
  assert.equal(c.cexSharePct, 10);
  assert.equal(c.whaleSharePct, 20, 'unlabelled wallets above 1 % of supply count as whales');
  for (const cls of ['lp', 'bridge', 'staking', 'burn', 'lock', 'protocol']) {
    assert.ok(EXCLUDED_FROM_EFFECTIVE.has(cls), `${cls} must be out of the tradable base`);
  }
});

/* ─────────────────────────── accumulation versus distribution ─────────────────────────────────── */

const classifiedWith = (rows) => classifyHolders(rows, { labelIndex: idx });

/** Build a holder list of `n` large wallets at `share` each, plus an exchange wallet. */
function book({ whaleShare, cexShare, whales = 6 }) {
  const rows = [{ address: '0xcex0000000000000000000000000000000000001', share: cexShare }];
  for (let i = 0; i < whales; i += 1) rows.push({ address: `0xwhale0000000000000000000000000000000000${i}`, share: whaleShare });
  return classifiedWith(rows);
}

test('two snapshots are required before any flow verdict is given', () => {
  const current = book({ whaleShare: 2, cexShare: 10 });
  const first = holderFlows({ current, history: [], nowMs: NOW });
  assert.equal(first.verdict, VERDICT.UNKNOWN);
  assert.equal(first.accumulating, null, 'unknown is not zero');
  assert.match(first.note, /două instantanee/);
});

test('ACCUMULATION needs several large wallets growing AND no net deposits to exchanges', () => {
  const before = flowSnapshot(book({ whaleShare: 2, cexShare: 10 }), NOW - 24 * HOUR);

  // Six large wallets each up a full point, exchange balance down: that is accumulation.
  const good = holderFlows({ current: book({ whaleShare: 3, cexShare: 8 }), history: [before], nowMs: NOW });
  assert.equal(good.verdict, VERDICT.ACCUMULATION);
  assert.ok(good.accumulating >= MIN_ACCUMULATING, `${good.accumulating} wallets accumulating`);
  assert.ok(good.cexDeltaPct < 0, 'coins left the exchange');

  // The same wallet growth, but the exchange balance grew: not accumulation.
  const depositing = holderFlows({ current: book({ whaleShare: 3, cexShare: 13 }), history: [before], nowMs: NOW });
  assert.notEqual(depositing.verdict, VERDICT.ACCUMULATION, 'growth into exchange deposits is positioning to sell');
  assert.ok(depositing.flags.includes('CEX_INFLOW'));

  // Large wallets shrinking is distribution.
  const bad = holderFlows({ current: book({ whaleShare: 1, cexShare: 13 }), history: [before], nowMs: NOW });
  assert.equal(bad.verdict, VERDICT.DISTRIBUTION);
  assert.ok(bad.distributing >= MIN_ACCUMULATING);
});

test('only holders above the large-wallet threshold move the verdict', () => {
  const small = (share) => classifiedWith([
    { address: '0xcex0000000000000000000000000000000000001', share: 10 },
    ...Array.from({ length: 8 }, (_, i) => ({ address: `0xdust000000000000000000000000000000000${i}0`, share })),
  ]);
  const before = flowSnapshot(small(0.2), NOW - 24 * HOUR);
  const after = holderFlows({ current: small(0.4), history: [before], nowMs: NOW });
  assert.ok(LARGE_HOLDER_PCT > 0.4, 'the threshold is above the dust size used here');
  assert.equal(after.accumulating, 0, 'dust wallets doubling is not whale accumulation');
  assert.equal(after.verdict, VERDICT.NEUTRAL);
});

test('a treasury moving to an exchange during the signal is flagged by name', () => {
  const before = flowSnapshot(classifiedWith([
    { address: '0xtreasury000000000000000000000000000001', share: 20, tag: 'Treasury multisig' },
    { address: '0xcex0000000000000000000000000000000000001', share: 5 },
  ]), NOW - 24 * HOUR);
  const now = classifiedWith([
    { address: '0xtreasury000000000000000000000000000001', share: 17, tag: 'Treasury multisig' },
    { address: '0xcex0000000000000000000000000000000000001', share: 8 },
  ]);
  const f = holderFlows({ current: now, history: [before], nowMs: NOW });
  assert.ok(f.flags.includes('TEAM_TO_CEX'), `flags: ${f.flags.join(',')}`);
});

test('the comparison snapshot is old enough to be meaningful', () => {
  const old = flowSnapshot(book({ whaleShare: 2, cexShare: 10 }), NOW - 30 * HOUR);
  const minutesAgo = flowSnapshot(book({ whaleShare: 2.9, cexShare: 8.2 }), NOW - 15 * 60_000);
  // A 15-minute pulse must not be compared against a 15-minute-old snapshot: that is noise.
  const f = holderFlows({ current: book({ whaleShare: 3, cexShare: 8 }), history: [old, minutesAgo], nowMs: NOW });
  assert.equal(f.comparedAgainst, new Date(NOW - 30 * HOUR).toISOString());
  assert.ok(f.spanDays > 1);
});

test('flow snapshots stay bounded at one per hour', () => {
  let series = [];
  for (let i = 0; i < 60; i += 1) {
    series = appendFlowSnapshot(series, flowSnapshot(book({ whaleShare: 2, cexShare: 10 }), NOW - i * 20 * 60_000), { max: 24 });
  }
  assert.ok(series.length <= 24, `${series.length} snapshots retained`);
  const hours = new Set(series.map((s) => Math.floor(s.at / HOUR)));
  assert.equal(hours.size, series.length, 'at most one snapshot per hour');
});

/* ─────────────────────────── Smart Money Score ────────────────────────────────────────────────── */

test('the Smart Money components and penalties are the ones from section 6', () => {
  assert.equal(POSITIVE.WHALE_ACCUMULATION.points, 15);
  assert.equal(POSITIVE.SMART_MONEY_ACCUMULATION.points, 15);
  assert.equal(POSITIVE.CEX_WITHDRAWALS.points, 10);
  assert.equal(POSITIVE.HOLDER_GROWTH.points, 10);
  assert.equal(POSITIVE.LIQUIDITY_GROWTH.points, 10);
  assert.equal(POSITIVE.VOLUME_GROWTH.points, 10);
  assert.equal(POSITIVE.TVL_GROWTH.points, 10);
  assert.equal(POSITIVE.NARRATIVE_MOMENTUM.points, 10);
  assert.equal(POSITIVE.EXCHANGE_EXPANSION.points, 5);
  assert.equal(POSITIVE.DEVELOPER_ACTIVITY.points, 5);
  assert.equal(Object.values(POSITIVE).reduce((s, c) => s + c.points, 0), 100);

  assert.equal(PENALTIES.INSIDER_CONCENTRATION.points, -15);
  assert.equal(PENALTIES.UNLOCK_IMMINENT.points, -15);
  assert.equal(PENALTIES.CEX_DEPOSITS.points, -15);
  assert.equal(PENALTIES.LIQUIDITY_DETERIORATION.points, -10);
  assert.equal(PENALTIES.EXTREME_FDV.points, -10);
  assert.equal(PENALTIES.SUSPICIOUS_FLOW.points, -20);
  assert.equal(Object.values(PENALTIES).reduce((s, c) => s + c.points, 0), -85);
});

test('too few measurable components means no score at all, not a low one', () => {
  const r = smartMoneyScore({ asset: { onchain: {} }, cmp: {} });
  assert.equal(r.score, null);
  assert.match(r.note, /necunoscut nu înseamnă negativ/);
});

test('a strong on-chain picture scores high; penalties pull it down from the same evidence', () => {
  const asset = {
    onchain: {
      classified: { top10EffectivePct: 22, byClass: { fund: { count: 2, share: 9 } }, flaggedSharePct: 0 },
      flows: {
        verdict: VERDICT.ACCUMULATION, verdictLabel: 'acumulare confirmată', accumulating: 7, distributing: 0,
        cexDeltaPct: -1.4, flags: [],
        movers: [{ class: HOLDER_CLASSES.FUND, delta: 0.8, entity: 'Fund Alpha', address: '0xfund' }],
      },
    },
    narrative: { score: 78 },
    social: { devCommits30d: 44 },
    catalysts: [{ type: 'NEW_PERP', label: 'Listare perpetual pe GATE', fresh: true }],
    fundamentals: { tvlChange7d: 40 },
    risk: { supply: { fdvToMcap: 1.2, unlockWithin30d: false } },
    features: { daily: { volAccel: 2.4 } },
  };
  const cmp = { holders: { changePct: 24 }, liquidityUsd: { changePct: 44 }, volume24h: { z: 3 }, tvl: { changePct: 40 } };
  const good = smartMoneyScore({ asset, cmp });
  assert.ok(good.score >= 75, `score ${good.score} raw ${good.raw}`);
  assert.ok(good.components.some((c) => c.key === 'WHALE_ACCUMULATION'));
  assert.ok(good.components.some((c) => c.key === 'CEX_WITHDRAWALS'));
  assert.equal(good.penalties.length, 0);
  // Evidence must never contradict the component that fired.
  const tvl = good.components.find((c) => c.key === 'TVL_GROWTH');
  assert.match(tvl.evidence, /TVL \+40/);

  const risky = JSON.parse(JSON.stringify(asset));
  risky.onchain.classified.top10EffectivePct = 71;
  risky.onchain.flows.cexDeltaPct = 1.2;
  risky.onchain.flows.flags = ['TEAM_TO_CEX'];
  risky.risk.supply = { fdvToMcap: 8, unlockWithin30d: true, unlockNote: 'deblocare în 9 zile' };
  const bad = smartMoneyScore({ asset: risky, cmp: { ...cmp, liquidityUsd: { changePct: -40 } } });
  assert.ok(bad.score < good.score - 20, `${bad.score} vs ${good.score}`);
  const keys = bad.penalties.map((p) => p.key);
  for (const k of ['INSIDER_CONCENTRATION', 'UNLOCK_IMMINENT', 'CEX_DEPOSITS', 'EXTREME_FDV', 'SUSPICIOUS_FLOW', 'LIQUIDITY_DETERIORATION']) {
    assert.ok(keys.includes(k), `missing penalty ${k} (got ${keys.join(',')})`);
  }
});

test('a component that fires exactly at its threshold still earns most of its points', () => {
  // Without a floor on partial credit, a reading at the published threshold would score near zero,
  // which would quietly move the threshold itself.
  const atThreshold = smartMoneyScore({
    asset: {
      onchain: { flows: { verdict: VERDICT.NEUTRAL, accumulating: 1, distributing: 1, cexDeltaPct: 0, flags: [] }, classified: { top10EffectivePct: 30 } },
      risk: { supply: { fdvToMcap: 1, unlockWithin30d: false } },
      narrative: { score: 65 },
      social: { devCommits30d: 15 },
      catalysts: [],
      features: { daily: {} },
    },
    cmp: { holders: { changePct: 8 }, liquidityUsd: { changePct: 20 }, volume24h: { z: 2 } },
  });
  const volume = atThreshold.components.find((c) => c.key === 'VOLUME_GROWTH');
  assert.ok(volume, 'the component fires at its threshold');
  assert.ok(volume.points >= POSITIVE.VOLUME_GROWTH.points * 0.6, `${volume.points} of ${POSITIVE.VOLUME_GROWTH.points}`);
});
