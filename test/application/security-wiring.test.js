/**
 * Contract security, wired end to end: live adapter normaliser → on-chain facts → risk engine.
 *
 * Each of those three pieces had its own tests, and each passed. What none of them checked was the
 * seam between them: the risk engine was tested against hand-built facts in its own vocabulary
 * (`isHoneypot`), while the GoPlus adapter produces the provider's vocabulary (`security.honeypot`).
 * In the first live run every security check therefore read `undefined`, no contract invalidator
 * could fire, and — because a security object *was* present — the "not scanned" warning was not
 * raised either. A honeypot would have been published as a clean contract.
 *
 * These tests start from a payload shaped exactly like the public GoPlus response, so a vocabulary
 * drift on either side of the seam fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvm, lpLockedPct } from '../../src/adapters/outbound/providers/onchain.js';
import { onchainFacts, securityFacts } from '../../src/application/use-cases/discovery.js';
import { emptyLabelIndex } from '../../src/domain/onchain/labels.js';
import { riskEngine } from '../../src/domain/risk/risk-engine.js';

const NOW = Date.parse('2026-10-24T21:15:00Z');

/** One record of `result` from GET /api/v1/token_security/56?contract_addresses=… (strings, as served). */
function goplusRecord(overrides = {}) {
  return {
    is_honeypot: '0',
    cannot_sell_all: '0',
    buy_tax: '0',
    sell_tax: '0',
    is_mintable: '0',
    owner_address: '0x0000000000000000000000000000000000000000',
    creator_address: '0xAbC0000000000000000000000000000000000001',
    hidden_owner: '0',
    can_take_back_ownership: '0',
    transfer_pausable: '0',
    is_blacklisted: '0',
    slippage_modifiable: '0',
    is_proxy: '0',
    is_open_source: '1',
    trust_list: '0',
    holder_count: '18342',
    total_supply: '1000000000',
    holders: [
      { address: '0x1111111111111111111111111111111111111111', tag: 'PancakeSwap V2 Pool', percent: '0.18', is_locked: 0, is_contract: 1 },
      { address: '0x2222222222222222222222222222222222222222', tag: '', percent: '0.06', is_locked: 0, is_contract: 0 },
      { address: '0x3333333333333333333333333333333333333333', tag: '', percent: '0.04', is_locked: 0, is_contract: 0 },
    ],
    lp_holders: [
      { address: '0x000000000000000000000000000000000000dEaD', tag: '', percent: '0.70', is_locked: 0 },
      { address: '0x4444444444444444444444444444444444444444', tag: 'PinkLock', percent: '0.25', is_locked: 1 },
      { address: '0x5555555555555555555555555555555555555555', tag: '', percent: '0.05', is_locked: 0 },
    ],
    ...overrides,
  };
}

const asset = { key: 'cg:demo', symbol: 'DEMO', primary: { chain: 'bsc', address: '0xdemo' }, market: { marketCap: 25e6, price: 0.1, change: {} }, quality: { flags: [] } };

function factsFor(record) {
  return onchainFacts({ asset, deep: { security: normalizeEvm(record) }, labelIndex: emptyLabelIndex(), flowHistory: [], nowMs: NOW });
}

function invalidatorKeys(onchain) {
  const r = riskEngine({ asset: { ...asset, onchain, risk: {}, derivatives: null }, market: { regime: { state: 'NEUTRAL' } }, changed: { count: 0, familyCount: 0 } });
  return { keys: r.invalidators.map((i) => i.key), score: r.score, risk: r };
}

test('a honeypot reported by GoPlus reaches the risk engine as a critical invalidator', () => {
  const oc = factsFor(goplusRecord({ is_honeypot: '1', sell_tax: '0.35' }));
  assert.equal(oc.security.isHoneypot, true);
  assert.equal(oc.security.sellTaxPct, 35, 'GoPlus taxes are fractions; the domain reads percent');
  const { keys, score } = invalidatorKeys(oc);
  assert.ok(keys.includes('HONEYPOT'), `invalidators: ${keys.join(', ')}`);
  assert.ok(keys.includes('SELL_TAX'));
  assert.ok(!keys.includes('NO_SECURITY_SCAN'));
  assert.ok(score >= 80, `a critical contract finding must dominate the risk score (got ${score})`);
});

test('"cannot sell all" is treated as a blocked exit, like the legacy model does', () => {
  const oc = factsFor(goplusRecord({ cannot_sell_all: '1' }));
  assert.equal(oc.security.isHoneypot, true);
  assert.equal(oc.security.cannotSellAll, true);
  assert.ok(invalidatorKeys(oc).keys.includes('HONEYPOT'));
});

test('owner privileges, pausable transfers and proxies each raise their own invalidator', () => {
  const oc = factsFor(goplusRecord({ can_take_back_ownership: '1', transfer_pausable: '1', is_proxy: '1', owner_address: '0x9999999999999999999999999999999999999999' }));
  const { keys } = invalidatorKeys(oc);
  for (const k of ['OWNER_CONTROL', 'PAUSABLE', 'PROXY']) assert.ok(keys.includes(k), `${k} missing from ${keys.join(', ')}`);
});

test('a mint function with renounced ownership is not a supply risk; with a live owner it is', () => {
  const renounced = factsFor(goplusRecord({ is_mintable: '1' }));
  assert.equal(renounced.security.ownerRenounced, true);
  assert.ok(!invalidatorKeys(renounced).keys.includes('MINTABLE'));

  const owned = factsFor(goplusRecord({ is_mintable: '1', owner_address: '0x9999999999999999999999999999999999999999' }));
  assert.equal(owned.security.ownerRenounced, false);
  assert.ok(invalidatorKeys(owned).keys.includes('MINTABLE'));
});

test('a clean contract is reported as scanned and clean, with LP lock and holders from GoPlus', () => {
  const oc = factsFor(goplusRecord());
  assert.equal(oc.security.isHoneypot, false);
  assert.equal(oc.security.lpLockedPct, 95, '70 % burned + 25 % in a locker');
  assert.equal(oc.holders, 18342, 'GoPlus holder count is the keyless fallback');
  assert.equal(oc.holdersSource, 'goplus');
  assert.ok(Number.isFinite(oc.top10Pct));
  const { keys } = invalidatorKeys(oc);
  for (const k of ['HONEYPOT', 'OWNER_CONTROL', 'MINTABLE', 'PAUSABLE', 'SELL_TAX', 'PROXY', 'LP_UNLOCKED', 'NO_SECURITY_SCAN']) {
    assert.ok(!keys.includes(k), `${k} should not fire on a clean contract`);
  }
});

test('an unlocked LP is flagged, and an absent LP list stays unknown rather than "0 % locked"', () => {
  const unlocked = factsFor(goplusRecord({ lp_holders: [{ address: '0x6666666666666666666666666666666666666666', percent: '0.9', is_locked: 0 }, { address: '0x7777777777777777777777777777777777777777', percent: '0.1', is_locked: 1 }] }));
  assert.equal(unlocked.security.lpLockedPct, 10);
  assert.ok(invalidatorKeys(unlocked).keys.includes('LP_UNLOCKED'));

  assert.equal(lpLockedPct(undefined), null);
  assert.equal(lpLockedPct([]), null);
  const noList = factsFor(goplusRecord({ lp_holders: undefined }));
  assert.equal(noList.security.lpLockedPct, null);
  assert.ok(!invalidatorKeys(noList).keys.includes('LP_UNLOCKED'), 'UNKNOWN is not bearish');
});

test('an empty GoPlus record is reported as "not scanned", never as "scanned and clean"', () => {
  const empty = { holders: null, top10Pct: null, security: { honeypot: null, cannotSell: null, buyTax: null, sellTax: null, mintable: null, hiddenOwner: null, canTakeBackOwnership: null, transferPausable: null, proxy: null } };
  assert.equal(securityFacts(empty), null);
  assert.equal(securityFacts(null), null);
  const oc = onchainFacts({ asset, deep: { security: empty }, labelIndex: emptyLabelIndex(), flowHistory: [], nowMs: NOW });
  assert.equal(oc.security, null);
  assert.ok(invalidatorKeys(oc).keys.includes('NO_SECURITY_SCAN'));

  const none = onchainFacts({ asset, deep: {}, labelIndex: emptyLabelIndex(), flowHistory: [], nowMs: NOW });
  assert.ok(invalidatorKeys(none).keys.includes('NO_SECURITY_SCAN'));
});

test('without a full holder list, GoPlus\'s top 10 is classified with the label index for concentration', async () => {
  const { createLabelIndex } = await import('../../src/domain/onchain/labels.js');
  const BINANCE = '0x8894e0a0c962cb723c1976a4421c95949be2d4e3';
  const labels = createLabelIndex([{ address: BINANCE, class: 'cex', entity: 'Binance' }]);
  const record = goplusRecord({
    holders: [
      { address: BINANCE, tag: '', percent: '0.40', is_locked: 0, is_contract: 0 },                       // exchange custody
      { address: '0x1111111111111111111111111111111111111111', tag: 'PancakeSwap V2 Pool', percent: '0.20', is_locked: 0, is_contract: 1 },
      { address: '0x000000000000000000000000000000000000dead', tag: '', percent: '0.10', is_locked: 0, is_contract: 0 },
      { address: '0x2222222222222222222222222222222222222222', tag: '', percent: '0.08', is_locked: 0, is_contract: 0 },
      { address: '0x3333333333333333333333333333333333333333', tag: '', percent: '0.05', is_locked: 0, is_contract: 0 },
      { address: '0x4444444444444444444444444444444444444444', tag: '', percent: '0.03', is_locked: 0, is_contract: 0 },
    ],
  });
  const oc = onchainFacts({ asset, deep: { security: normalizeEvm(record) }, labelIndex: labels, flowHistory: [], nowMs: NOW });
  assert.equal(oc.concentrationBasis, 'top10_labelled');
  assert.ok(oc.top10Pct >= 85, `raw top 10 is ${oc.top10Pct}% — pool, burn and exchange included`);
  // Float = 100 − pool 20 − burn 10 = 70; independent actors = 8 + 5 + 3 = 16 → ~22.9 % of the float.
  assert.ok(Math.abs(oc.top10ActorsPct - (16 / 70) * 100) < 0.01, String(oc.top10ActorsPct));
  assert.equal(oc.snapshot, null, 'ten addresses are never used to follow flows');

  const keys = riskEngine({ asset: { ...asset, onchain: oc, risk: {}, derivatives: null }, market: { regime: { state: 'NEUTRAL' } }, changed: { count: 0 } }).invalidators.map((i) => i.key);
  assert.ok(!keys.includes('CONCENTRATION_CRITICAL'), 'an exchange wallet and an LP pool are not one sell decision');
  assert.ok(!keys.includes('CONCENTRATION_HIGH'));
});

test('a raw top-10 figure alone is labelled as raw and never raised to critical', () => {
  const oc = { top10Pct: 92, security: null };
  const r = riskEngine({ asset: { ...asset, onchain: oc, risk: {}, derivatives: null }, market: { regime: { state: 'NEUTRAL' } }, changed: { count: 0 } });
  const c = r.invalidators.find((i) => i.key === 'CONCENTRATION_CRITICAL');
  assert.ok(c, 'the reading is still reported');
  assert.equal(c.severity, 'HIGH');
  assert.match(c.label, /brută/);
});
