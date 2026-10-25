/**
 * Several exchanges, one research universe.
 *
 * Binance Alpha and Gate Alpha both publish their early-access lists. A token can be on one, the
 * other, both, or neither of them, and on the aggregators' top 1000 or below it. These tests pin
 * that every combination becomes exactly one asset with the right identity, that "listed on two
 * Alpha programmes" is a visible fact, that an entry into Gate Alpha is a catalyst only when Gate's
 * list was read completely, and that access catalysts — Alpha entries, Korean listings, Alpha →
 * Binance spot — count as changes. Before the shared ACCESS_CATALYSTS list, the change engine and
 * the Smart Money score looked for type names the registry never emitted, so none of these did.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeUniverse } from '../../src/domain/asset/universe.js';
import { attachVenues } from '../../src/domain/asset/venues.js';
import { ACCESS_CATALYSTS, CATALYST_TYPES, buildRegistry, diffRegistry } from '../../src/domain/catalysts/catalysts.js';
import { whatChanged } from '../../src/domain/discovery/changes.js';
import { smartMoneyScore } from '../../src/domain/onchain/smart-money.js';
import { riskEngine } from '../../src/domain/risk/risk-engine.js';
import { alphaMarketRow, gateAlphaMarketRow, normalizeAlphaToken, normalizeGateAlpha } from '../../src/adapters/outbound/providers/exchanges.js';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const DAY = 86_400_000;
const A = (n) => `0x${String(n).padStart(40, '0')}`;

const cgRow = (id, symbol, mc, address) => ({
  source: 'coingecko', sourceId: id, symbol: symbol.toLowerCase(), name: id, rank: 600, price: 1, marketCap: mc, fdv: mc, volume24h: mc / 5,
  circulating: mc, total: mc, max: null, change: { h24: 1, d7: 2, d30: 3 }, ath: 2, athChangePct: -50, athDate: null,
  dateAdded: null, firstDataAt: null, tags: [], platform: { chain: 'binance-smart-chain', address }, numMarketPairs: null, image: null,
  lastUpdated: new Date(NOW).toISOString(),
});
const binance = (symbol, address, over = {}) => alphaMarketRow(normalizeAlphaToken({
  alphaId: `ALPHA_${symbol}`, chainId: '56', chainName: 'BSC', contractAddress: address, symbol, name: symbol,
  price: '1', percentChange24h: '2', marketCap: '20000000', volume24h: '4000000', circulatingSupply: '20000000', totalSupply: '50000000',
  holders: '9000', liquidity: '800000', ...over,
}));
const gateToken = (id, chain, address, over = {}) => normalizeGateAlpha(
  { currency: id, name: id, chain, address, status: 1 },
  { currency: id, last: '1', change: '3', volume: '900000', market_cap: '15000000', ...over },
);

test('every combination of Binance Alpha, Gate Alpha and the top 1000 becomes exactly one asset', () => {
  const inTop = A(1);
  const onBothAlpha = A(2);
  const gateKnownToCg = A(3);
  const gateOnly = A(4);
  const merged = mergeUniverse({
    coingecko: [cgRow('in-top', 'TOP', 4e7, inTop)],
    binanceAlpha: [binance('TOP', inTop), binance('BOTH', onBothAlpha)],
    gateAlpha: [
      gateToken('memeboxtop', 'bsc', inTop),
      gateToken('memeboxboth', 'BSC', onBothAlpha),
      gateToken('memeboxcgk', 'bsc', gateKnownToCg),
      gateToken('memeboxsolo', 'bsc', gateOnly),
      gateToken('memeboxworld', 'world', A(5)), // a chain the pipeline cannot read
    ].map(gateAlphaMarketRow),
    cgPlatforms: new Map([['cg-known', [{ chain: 'binance-smart-chain', address: gateKnownToCg }]]]),
    nowMs: NOW,
  });
  const byKey = new Map(merged.map((a) => [a.key, a]));
  assert.equal(merged.length, 4, merged.map((a) => a.key).join(', '));

  const top = byKey.get('cg:in-top');
  assert.deepEqual([...top.sources].sort(), ['binance_alpha', 'coingecko', 'gate_alpha']);
  assert.equal(top.ids.gateAlpha, 'memeboxtop');
  assert.equal(top.market.marketCap, 4e7, 'the aggregator stays the primary source');

  const both = byKey.get('alpha:ALPHA_BOTH');
  assert.ok(both, 'a token on both Alpha lists is one asset: Gate finds Binance\'s contract in the index');
  assert.deepEqual([...both.sources].sort(), ['binance_alpha', 'gate_alpha']);

  const cgKnown = byKey.get('cg:cg-known');
  assert.ok(cgKnown, 'a Gate-only token CoinGecko knows by contract takes its CoinGecko identity');
  assert.equal(cgKnown.symbol, 'CGK');

  const solo = byKey.get('gatealpha:memeboxsolo');
  assert.ok(solo, 'otherwise it keeps a stable Gate identity');
  assert.equal(solo.market.marketCap, 15e6);
  assert.equal(solo.market.circulating, null, 'no supply is invented');
  assert.ok(!merged.some((a) => a.ids.gateAlpha === 'memeboxworld'), 'a token on a chain the pipeline cannot read stays out');
});

test('venues say which Alpha programmes list each asset', () => {
  const both = A(7);
  const assets = mergeUniverse({ coingecko: [cgRow('both', 'BTH', 3e7, both), cgRow('none', 'NON', 3e7, A(8))], nowMs: NOW });
  const stats = attachVenues(assets, {
    alpha: { ok: true, data: [normalizeAlphaToken({ alphaId: 'ALPHA_7', chainId: '56', contractAddress: both, symbol: 'BTH', price: '1', holders: '100' })] },
    gateAlpha: { ok: true, data: [gateToken('memeboxbth', 'bsc', both)] },
  });
  const a = assets.find((x) => x.key === 'cg:both');
  assert.deepEqual(a.venues.alphaPrograms, ['binance', 'gate']);
  assert.equal(a.venues.gateAlpha.status, 'LISTED');
  assert.equal(a.venues.gateAlpha.currency, 'memeboxbth');
  const n = assets.find((x) => x.key === 'cg:none');
  assert.deepEqual(n.venues.alphaPrograms, []);
  assert.equal(n.venues.gateAlpha.status, 'NOT_LISTED', 'Gate answered: not listed is a fact');
  assert.deepEqual(stats.alphaPrograms, { binance: 1, gate: 1, both: 1 });

  const unknown = mergeUniverse({ coingecko: [cgRow('u', 'UUU', 3e7, A(9))], nowMs: NOW });
  attachVenues(unknown, {});
  assert.equal(unknown[0].venues.gateAlpha.status, 'UNKNOWN', 'Gate silent: unknown, never "not listed"');
  attachVenues(unknown, { gateAlpha: { ok: true, data: [], meta: { listComplete: false } } });
  assert.equal(unknown[0].venues.gateAlpha.status, 'UNKNOWN', 'absent from a list read only in part: it may be on an unread page');
});

test('an entry into Gate Alpha is a catalyst — only when Gate\'s list was read completely', () => {
  const addr = A(11);
  const assets = mergeUniverse({ coingecko: [cgRow('new-on-gate', 'NEW', 2e7, addr)], nowMs: NOW });
  const byKey = new Map(assets.map((a) => [a.key, a]));
  const ok = { gateAlpha: true };

  attachVenues(assets, { gateAlpha: { ok: true, data: [] } });
  const first = diffRegistry(null, buildRegistry(assets, ok), byKey, NOW - DAY, ok);
  assert.equal(first.events.length, 0, 'the first read only builds the baseline');

  attachVenues(assets, { gateAlpha: { ok: true, data: [gateToken('memeboxnew', 'bsc', addr)] } });
  const incomplete = diffRegistry(first.next, buildRegistry(assets, { gateAlpha: false }), byKey, NOW, { gateAlpha: false });
  assert.equal(incomplete.events.length, 0, 'a list cut at the page budget says nothing about what is new');

  const complete = diffRegistry(first.next, buildRegistry(assets, ok), byKey, NOW, ok);
  assert.deepEqual(complete.events.map((e) => e.type), ['NEW_GATE_ALPHA']);
  assert.equal(complete.events[0].title, CATALYST_TYPES.NEW_GATE_ALPHA.label);
});

test('"entered the top 1000" is never said of a token that is in the universe only through an Alpha list', () => {
  const alphaOnly = mergeUniverse({ coingecko: [], binanceAlpha: [binance('ONLY', A(12))], nowMs: NOW });
  const reg = buildRegistry(alphaOnly, { universe: true });
  assert.deepEqual(Object.keys(reg.universe), []);
});

test('access catalysts are changes: one list, spelled as the registry emits them', () => {
  for (const t of ACCESS_CATALYSTS) assert.ok(CATALYST_TYPES[t], `${t} is a catalyst type the registry knows`);
  const changeKeys = (types) => whatChanged({
    asset: { market: { change: {} }, derived: {}, catalysts: types.map((type) => ({ type, label: CATALYST_TYPES[type].label, fresh: true })) },
    cmp: {},
  }).changes.map((c) => c.key);
  for (const t of ['NEW_BINANCE_ALPHA', 'NEW_GATE_ALPHA', 'NEW_UPBIT_KRW', 'NEW_BITHUMB_KRW', 'BINANCE_CEX_LISTING', 'NEW_PERP', 'NEW_BINANCE_SPOT', 'NEW_MEXC_SPOT']) {
    assert.ok(changeKeys([t]).includes('NEW_VENUE'), `${t} counts as a new venue`);
  }
  assert.ok(!changeKeys(['KRW_WARNING']).includes('NEW_VENUE'), 'a warning is not access');
  const stale = whatChanged({ asset: { market: { change: {} }, derived: {}, catalysts: [{ type: 'NEW_BINANCE_ALPHA', label: 'x', fresh: false }] }, cmp: {} });
  assert.ok(!stale.changes.some((c) => c.key === 'NEW_VENUE'), 'only inside the change window');

  const sm = smartMoneyScore({ asset: { onchain: {}, catalysts: [{ type: 'NEW_UPBIT_KRW', label: 'Listare Upbit (KRW)', fresh: true }] }, cmp: {} });
  assert.ok(sm.components.some((c) => c.key === 'EXCHANGE_EXPANSION'), 'and the Smart Money score credits the exchange expansion');
});

test('extreme turnover on a Gate Alpha token is named like on a Binance Alpha one', () => {
  const base = { market: {}, onchain: {}, risk: {}, quality: { flags: [] } };
  const run = (venues) => riskEngine({ asset: { ...base, venues, derived: { turnover: 2.4 } }, market: { regime: { state: 'NEUTRAL' } }, changed: { count: 0 } }).invalidators.find((i) => i.key === 'ALPHA_VOLUME');
  assert.match(run({ alpha: { status: 'NOT_LISTED' }, gateAlpha: { status: 'LISTED' } }).label, /240%.*Gate Alpha/);
  assert.match(run({ alpha: { status: 'LISTED', mulPoint: 2 }, gateAlpha: { status: 'LISTED' } }).label, /Binance Alpha \+ Gate Alpha; multiplicator .*×2/);
  assert.equal(run({ alpha: { status: 'NOT_LISTED' }, gateAlpha: { status: 'NOT_LISTED' } }), undefined);
});
