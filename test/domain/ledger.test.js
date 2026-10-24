import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, catalystBalance, detectChangeEvents, diffRegistry, makeEvent, manualEvents } from '../../src/domain/catalysts/catalysts.js';
import { updateJournal } from '../../src/domain/signals/journal.js';
import { mergeUniverse, screenUniverse } from '../../src/domain/asset/universe.js';
import { DAY } from '../helpers.js';

const NOW = Date.parse('2026-10-17T09:00:00Z');
const asset = (key, extra = {}) => ({ key, symbol: key.toUpperCase(), rank: { cmc: 400, coingecko: 410 }, venues: { mexcSpot: null, perps: [], krw: null, alpha: null }, ...extra });
const okAll = { mexcSpot: true, upbit: true, bithumb: true, alpha: true, universe: true, perpVenues: ['mexc', 'gate'] };

test('registry: first run is a silent baseline, later runs emit listing catalysts', () => {
  const a = asset('aaa');
  const b = asset('bbb', { venues: { mexcSpot: { symbol: 'BBB_USDT' }, perps: [], krw: null, alpha: null } });
  const byKey = new Map([[a.key, a], [b.key, b]]);
  const first = diffRegistry(null, buildRegistry([a, b], okAll), byKey, NOW, okAll);
  assert.equal(first.events.length, 0, 'baseline run: no fake "new listing" storm');

  const a2 = asset('aaa', { venues: { mexcSpot: { symbol: 'AAA_USDT' }, perps: [{ venue: 'gate' }], krw: null, alpha: null } });
  const second = diffRegistry(first.next, buildRegistry([a2, b], okAll), new Map([[a2.key, a2], [b.key, b]]), NOW + DAY, okAll);
  const types = second.events.map((e) => e.type).sort();
  assert.deepEqual(types, ['NEW_MEXC_SPOT', 'NEW_PERP']);
  assert.ok(second.events.find((e) => e.type === 'NEW_PERP').title.includes('GATE'));
});

test('registry: a failed venue this run never looks like a delisting or relisting', () => {
  const b = asset('bbb', { venues: { mexcSpot: { symbol: 'BBB_USDT' }, perps: [], krw: null, alpha: null } });
  const byKey = new Map([[b.key, b]]);
  const r1 = diffRegistry(null, buildRegistry([b], okAll), byKey, NOW, okAll);
  const down = { ...okAll, mexcSpot: false };
  const r2 = diffRegistry(r1.next, buildRegistry([b], down), byKey, NOW + DAY, down);
  const r3 = diffRegistry(r2.next, buildRegistry([b], okAll), byKey, NOW + 2 * DAY, okAll);
  assert.equal(r3.events.filter((e) => e.type === 'NEW_MEXC_SPOT').length, 0);
});

test('change events: rank jump, OI surge and funding flip from own history', () => {
  const a = asset('ccc', { rank: { cmc: 300, coingecko: 310 }, lf: { oiUsd: 2_000_000, fundingAvg: -0.0005, turnover: 0.1 }, attention: { cgTrending: false } });
  const history = [
    { t: new Date(NOW - 7 * DAY).toISOString(), rank: 520, oiUsd: 900_000, funding: 0.0001, turnover: 0.05 },
    { t: new Date(NOW - DAY).toISOString(), rank: 360, oiUsd: 1_000_000, funding: 0.0001, turnover: 0.05 },
  ];
  const types = detectChangeEvents(a, history, NOW).map((e) => e.type).sort();
  assert.deepEqual(types, ['FUNDING_FLIP_NEGATIVE', 'OI_SURGE', 'RANK_JUMP']);
});

test('manual notebook events and decayed catalyst balance', () => {
  const bySym = new Map([['LAB', asset('lab')]]);
  const ev = manualEvents([{ symbol: 'LAB', type: 'UNLOCK', date: '2026-10-25', polarity: 'NEGATIVE', confidence: 0.7, title: 'Unlock 5%' }], bySym, NOW);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].polarity, 'NEGATIVE');
  const pos = makeEvent({ type: 'NEW_PERP', assetKey: 'x', symbol: 'X', observedAt: new Date(NOW).toISOString(), source: 'gate' });
  const bal = catalystBalance([pos], NOW);
  assert.ok(bal.score > 50);
  assert.equal(catalystBalance([], NOW), null, 'no catalysts = unknown, not neutral evidence');
});

test('journal: forward tracking, frozen horizons, Wilson-backed summary, cooldown', () => {
  const cfg = { horizonsDays: [7, 14, 30], hitThresholdPct: 25, cooldownDays: 14, retentionDays: 180 };
  const cand = { key: 'k', symbol: 'K', price: 1, signal: { type: 'BUY_SETUP' }, cri: 70, analog: { ref: 'LAB', similarity: 66 }, stage: 'PRE_EXPANSION' };
  let j = updateJournal({ entries: [] }, [cand], NOW, cfg, new Map([['k', 1]]));
  assert.equal(j.entries.length, 1);
  j = updateJournal(j, [cand], NOW + 3 * DAY, cfg, new Map([['k', 1.4]]));
  assert.equal(j.entries.length, 1, 'cooldown: no duplicate entry');
  j = updateJournal(j, [], NOW + 8 * DAY, cfg, new Map([['k', 1.1]]));
  const e = j.entries[0];
  assert.equal(e.outcomes.d7.hit, true, 'MFE +40 % within 7 days counts as a hit even if price faded');
  assert.equal(e.outcomes.d7.returnPct, 10);
  assert.equal(e.status, 'OPEN');
  const h7 = j.summary.byType.BUY_SETUP.horizons.find((h) => h.days === 7);
  assert.equal(h7.n, 1);
  assert.equal(h7.hits, 1);
  assert.ok(h7.ciLow < 100 && h7.ciHigh === 100);
});

test('universe: CMC rows merge into CoinGecko assets by contract, exclusions are documented', () => {
  const row = (source, id, symbol, name, mc, extra = {}) => ({ source, sourceId: id, slug: id, symbol, name, rank: 1, price: 1, marketCap: mc, fdv: mc * 2, volume24h: mc / 5, circulating: 50, total: 100, max: 100, change: { h24: 1, d7: 2, d30: 3 }, ath: 2, athChangePct: -50, athDate: null, dateAdded: '2025-10-01T00:00:00Z', firstDataAt: null, tags: [], platform: null, numMarketPairs: 10, image: null, lastUpdated: new Date(NOW).toISOString(), ...extra });
  const cg = [row('coingecko', 'lab-token', 'LAB', 'LAB', 2e7), row('coingecko', 'tether', 'USDT', 'Tether', 1.5e11)];
  const cmc = [row('coinmarketcap', 'lab', 'LAB', 'LAB', 2.1e7, { platform: { chain: 'BNB Smart Chain (BEP20)', address: '0xAbC' } })];
  const platforms = new Map([['lab-token', [{ chain: 'binance-smart-chain', address: '0xabc' }]]]);
  const merged = mergeUniverse({ coingecko: cg, coinmarketcap: cmc, cgPlatforms: platforms, nowMs: NOW });
  assert.equal(merged.length, 2, 'LAB rows from both aggregators become one asset');
  const lab = merged.find((a) => a.symbol === 'LAB');
  assert.equal(lab.primary.chain, 'bsc');
  assert.ok(lab.ids.cmc, 'CMC identity attached');
  const { eligible, excluded } = screenUniverse(merged, { minMarketCapUsd: 3e6, maxMarketCapUsd: 8e8, minVolume24hUsd: 1e5 });
  assert.deepEqual(eligible.map((a) => a.symbol), ['LAB']);
  assert.equal(excluded[0].reason, 'STABLECOIN');
});
