/**
 * The validity gate: which projects may appear in a CRI list at all. Every rule is pinned here with
 * the evidence that triggers it, and so is the design rule the gate shares with the rest of the
 * project — a missing piece of evidence holds a project back (PENDING), only evidence rejects it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessValidity, CHECK, DEFAULT_VALIDITY_POLICY, exchangeKey, listingSummary, VALIDITY, VALIDITY_CHECKS, validitySummary,
} from '../../src/domain/validity/validity.js';

/** A small cap that passes everything: aggregator cap, Gate spot, clean GoPlus scan, deep pool. */
const ev = (over = {}) => ({
  symbol: 'TEST',
  name: 'Test Protocol',
  marketCap: 50e6,
  marketCapSource: 'coingecko',
  marketCapBySource: { coingecko: 50e6, coinmarketcap: 52e6 },
  mcapDisagreementPct: 4,
  fdv: 80e6,
  exclusion: null,
  aggregators: ['coingecko', 'coinmarketcap'],
  alphaPrograms: [],
  links: { websites: ['https://test.xyz'], socials: ['https://x.com/test'] },
  linksChecked: true,
  spot: [{ venue: 'gate', quoteVolume: 250_000 }],
  perps: [],
  cexList: null,
  krwWarning: false,
  venuesRead: { spot: true, perps: true },
  chain: 'ethereum',
  hasContract: true,
  scanner: true,
  security: { source: 'goplus', honeypot: false, cannotSell: false, buyTaxPct: 0, sellTaxPct: 0, openSource: true, ownerRenounced: true },
  gt: null,
  liquidityUsd: 400_000,
  liquiditySource: 'dexscreener',
  top10EffectivePct: 30,
  ageDays: 200,
  turnover: 0.1,
  flags: [],
  ...over,
});
const sec = (over = {}) => ({ ...ev().security, ...over });
const check = (res, key) => res.checks.find((c) => c.key === key);
const codes = (res) => [...res.reasons, ...res.missing].flatMap((r) => r.codes);

test('a clean small cap passes every required check and is VALID, with no warning', () => {
  const r = assessValidity(ev());
  assert.equal(r.status, VALIDITY.VALID);
  assert.equal(r.label, 'verificat');
  assert.equal(r.checks.length, VALIDITY_CHECKS.length);
  for (const c of r.checks) assert.equal(c.status, CHECK.PASS, `${c.key}: ${c.detail}`);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.listingTier, 2, 'Gate is a tier-2 exchange');
  assert.match(check(r, 'scope').detail, /50 mil \$ \(CoinGecko\)/);
});

test('scope: above the 300M cap, below the floor, an unconfirmed cap and an excluded asset are rejected', () => {
  const above = assessValidity(ev({ marketCap: 450e6, marketCapBySource: { coingecko: 450e6 } }));
  assert.equal(above.status, VALIDITY.REJECTED);
  assert.deepEqual(codes(above), ['MCAP_ABOVE_CAP']);
  assert.equal(DEFAULT_VALIDITY_POLICY.maxMarketCapUsd, 300e6);

  assert.deepEqual(codes(assessValidity(ev({ marketCap: 400_000 }))), ['MCAP_BELOW_FLOOR']);

  // A capitalisation only Gate Alpha's memebox list reports confirms nothing.
  const gateOnly = assessValidity(ev({ marketCapSource: 'gate_alpha', marketCapBySource: { gate_alpha: 20e6 }, aggregators: [], alphaPrograms: ['gate'] }));
  assert.equal(gateOnly.status, VALIDITY.REJECTED);
  assert.ok(codes(gateOnly).includes('MCAP_UNVERIFIED'));
  assert.ok(codes(gateOnly).includes('ALPHA_ONLY'));

  // Binance Alpha's own figure is accepted: Binance curates that list.
  assert.equal(check(assessValidity(ev({ marketCapSource: 'binance_alpha', aggregators: [], alphaPrograms: ['binance'] })), 'scope').status, CHECK.PASS);

  const stable = assessValidity(ev({ exclusion: 'STABLECOIN' }));
  assert.equal(stable.status, VALIDITY.REJECTED);
  assert.deepEqual(codes(stable), ['EXCLUDED_ASSET']);
  assert.match(stable.reasons[0].text, /stablecoin/);
  assert.match(assessValidity(ev({ exclusion: 'TOKENIZED_ASSET' })).reasons[0].text, /tokenizat/);
});

test('scope: an unknown capitalisation is pending, a disputed one is a warning', () => {
  const unknown = assessValidity(ev({ marketCap: null, marketCapSource: null, marketCapBySource: {} }));
  assert.equal(unknown.status, VALIDITY.PENDING, 'unknown is not bearish');
  assert.deepEqual(codes(unknown), ['MCAP_UNKNOWN']);

  const disputed = assessValidity(ev({ marketCapBySource: { coingecko: 50e6, coinmarketcap: 340e6 } }));
  assert.equal(disputed.status, VALIDITY.VALID);
  assert.equal(check(disputed, 'scope').status, CHECK.WARN);
  assert.ok(disputed.warnings.some((w) => /CoinMarketCap raportează peste plafon/.test(w.text)));

  const lowFloat = assessValidity(ev({ fdv: 2e9 }));
  assert.equal(lowFloat.status, VALIDITY.VALID);
  assert.ok(check(lowFloat, 'scope').codes.includes('LOW_FLOAT'));
});

test('identity: unconfirmed tokens and GoPlus impostors are rejected; Binance Alpha curation counts', () => {
  const none = assessValidity(ev({ aggregators: [], alphaPrograms: [] }));
  assert.equal(none.status, VALIDITY.REJECTED);
  assert.ok(codes(none).includes('ALPHA_ONLY'));
  assert.match(none.reasons.find((r) => r.check === 'identity').text, /niciun agregator/);

  const curated = assessValidity(ev({ aggregators: [], alphaPrograms: ['binance'] }));
  assert.equal(check(curated, 'identity').status, CHECK.PASS);
  assert.match(check(curated, 'identity').detail, /Binance Alpha/);

  assert.ok(codes(assessValidity(ev({ security: sec({ fakeToken: true }) }))).includes('FAKE_TOKEN'));
  assert.ok(codes(assessValidity(ev({ security: sec({ airdropScam: true }) }))).includes('AIRDROP_SCAM'));

  // The policy switch exists for a researcher who wants Gate Alpha's launchpad list back.
  const gate = ev({ aggregators: [], alphaPrograms: ['gate'], marketCapSource: 'gate_alpha', marketCapBySource: { gate_alpha: 20e6 } });
  assert.equal(assessValidity(gate, { acceptGateAlphaOnly: true }).status, VALIDITY.VALID);

  const bare = assessValidity(ev({ links: { websites: [], socials: [] } }));
  assert.equal(bare.status, VALIDITY.VALID, 'a missing site is worth knowing, not disqualifying');
  assert.ok(check(bare, 'identity').codes.includes('NO_LINKS'));
});

test('listing: no market anywhere is rejected; exchanges that did not answer leave the project pending', () => {
  const unlisted = ev({ spot: [], perps: [], alphaPrograms: [] });
  const r = assessValidity(unlisted);
  assert.equal(r.status, VALIDITY.REJECTED);
  assert.deepEqual(codes(r), ['NOT_LISTED']);

  const unread = assessValidity({ ...unlisted, venuesRead: { spot: false, perps: false } });
  assert.equal(unread.status, VALIDITY.PENDING);
  assert.deepEqual(codes(unread), ['VENUES_UNREAD']);

  // A pair that does not trade is not a listing.
  const idle = assessValidity(ev({ spot: [{ venue: 'mexc', quoteVolume: 900 }] }));
  assert.equal(idle.status, VALIDITY.REJECTED);
  assert.ok(check(idle, 'listing').codes.includes('NOT_LISTED'));
  assert.ok(check(idle, 'listing').warnings.some((w) => /fără volum pe MEXC/.test(w)));

  // A Korean listing has no volume in the public market list: it counts.
  assert.equal(assessValidity(ev({ spot: [{ venue: 'upbit', quoteVolume: null }] })).status, VALIDITY.VALID);
});

test('listing: perpetuals only, Binance Alpha only and GoPlus\'s exchange list all count, with their caveat', () => {
  const perps = assessValidity(ev({ spot: [], perps: ['bitget', 'gate'] }));
  assert.equal(check(perps, 'listing').status, CHECK.WARN);
  assert.ok(check(perps, 'listing').codes.includes('PERPS_ONLY'));

  const alpha = assessValidity(ev({ spot: [], alphaPrograms: ['binance'] }));
  assert.equal(alpha.status, VALIDITY.VALID);
  assert.ok(check(alpha, 'listing').codes.includes('ALPHA_NO_CEX'));

  const goplus = assessValidity(ev({ spot: [], cexList: ['Gate.io', 'MEXC'] }));
  assert.equal(check(goplus, 'listing').status, CHECK.PASS);
  assert.match(check(goplus, 'listing').detail, /GoPlus: Gate\.io și MEXC/);
  assert.equal(goplus.listingTier, 2);

  const L = listingSummary(ev({ spot: [{ venue: 'mexc', quoteVolume: 50_000 }], cexList: ['Huobi'] }));
  assert.equal(L.bestTier, 2, 'HTX (Huobi) is tier 2');
  assert.equal(L.vetted, true);
  assert.equal(listingSummary(ev({ spot: [{ venue: 'mexc', quoteVolume: 50_000 }] })).vetted, false, 'MEXC alone is not a vetted listing');
});

test('contract traps reject whatever the listings say', () => {
  const vetted = { spot: [{ venue: 'binance', quoteVolume: 5e6 }] };
  for (const [flags, code] of [
    [{ honeypot: true }, 'HONEYPOT'],
    [{ cannotSell: true }, 'CANNOT_SELL'],
    [{ sellTaxPct: 12 }, 'HIGH_TAX'],
    [{ ownerChangeBalance: true }, 'OWNER_CHANGE_BALANCE'],
    [{ balanceMutable: true }, 'BALANCE_MUTABLE'],
    [{ selfdestruct: true }, 'SELFDESTRUCT'],
    [{ defaultFrozen: true }, 'DEFAULT_FROZEN'],
    [{ honeypotSameCreator: true }, 'HONEYPOT_CREATOR'],
    [{ nonTransferable: true }, 'NON_TRANSFERABLE'],
  ]) {
    const r = assessValidity(ev({ ...vetted, security: sec(flags) }));
    assert.equal(r.status, VALIDITY.REJECTED, `${code} rejects even on Binance`);
    assert.ok(codes(r).includes(code), `${code} is the reason`);
  }
  // GeckoTerminal's honeypot flag is evidence even before GoPlus answered.
  const gt = assessValidity(ev({ security: null, gt: { honeypot: true } }));
  assert.equal(gt.status, VALIDITY.REJECTED);
  assert.deepEqual(codes(gt), ['HONEYPOT']);
});

test('contract controls reject an unvetted token and only warn on one a tier 1–2 exchange lists', () => {
  const mexcOnly = { spot: [{ venue: 'mexc', quoteVolume: 80_000 }] };
  for (const [flags, code] of [
    [{ hiddenOwner: true }, 'HIDDEN_OWNER'],
    [{ canTakeBackOwnership: true }, 'TAKE_BACK_OWNERSHIP'],
    [{ openSource: false }, 'CLOSED_SOURCE'],
    [{ freezable: true }, 'FREEZE_AUTHORITY'],
    [{ closable: true }, 'CLOSABLE'],
  ]) {
    const raw = assessValidity(ev({ ...mexcOnly, security: sec(flags) }));
    assert.equal(raw.status, VALIDITY.REJECTED, `${code} rejects a MEXC-only token`);
    assert.ok(codes(raw).includes(code));
    const listed = assessValidity(ev({ spot: [{ venue: 'okx', quoteVolume: 3e6 }], security: sec(flags) }));
    assert.equal(listed.status, VALIDITY.VALID, `${code} is accepted on OKX`);
    assert.ok(listed.warnings.some((w) => /acceptat: listat pe o bursă care verifică proiectele/.test(w.text)));
  }
  // GoPlus's trust list vouches for a token the same way.
  assert.equal(assessValidity(ev({ ...mexcOnly, security: sec({ hiddenOwner: true, trusted: true }) })).status, VALIDITY.VALID);
});

test('contract warnings never reject: a small tax, mint, pause, blacklist, proxy, insiders', () => {
  const r = assessValidity(ev({
    security: sec({ sellTaxPct: 7, mintable: true, ownerRenounced: false, transferPausable: true, blacklist: true, proxy: true, slippageModifiable: true, ownerPercentPct: 35 }),
  }));
  assert.equal(r.status, VALIDITY.VALID);
  const c = check(r, 'contract');
  assert.equal(c.status, CHECK.WARN);
  for (const code of ['TAX', 'MINTABLE', 'PAUSABLE', 'BLACKLIST', 'PROXY', 'TAX_MODIFIABLE', 'OWNER_HOLDS']) assert.ok(c.codes.includes(code), code);
});

test('contract: not scanned yet is pending, a chain without a free scanner is a warning, a native coin does not apply', () => {
  const pending = assessValidity(ev({ security: null }));
  assert.equal(pending.status, VALIDITY.PENDING);
  assert.deepEqual(codes(pending), ['NOT_SCANNED']);
  assert.match(pending.missing[0].text, /rotația următoarei rulări/);

  const noScanner = assessValidity(ev({ security: null, scanner: false, chain: 'sui' }));
  assert.equal(noScanner.status, VALIDITY.VALID, 'validated by its listings');
  assert.equal(check(noScanner, 'contract').status, CHECK.WARN);
  assert.ok(check(noScanner, 'contract').codes.includes('NO_SCANNER'));

  const native = assessValidity(ev({ hasContract: false, security: null, chain: null }));
  assert.equal(native.status, VALIDITY.VALID);
  assert.equal(check(native, 'contract').status, CHECK.NA);
});

test('liquidity: without a centralised market the DEX pool must be deep enough', () => {
  const alphaOnly = { spot: [], alphaPrograms: ['binance'] };
  const thin = assessValidity(ev({ ...alphaOnly, liquidityUsd: 20_000 }));
  assert.equal(thin.status, VALIDITY.REJECTED);
  assert.deepEqual(codes(thin), ['THIN_LIQUIDITY']);

  const unknown = assessValidity(ev({ ...alphaOnly, liquidityUsd: null }));
  assert.equal(unknown.status, VALIDITY.PENDING);
  assert.deepEqual(codes(unknown), ['LIQUIDITY_UNKNOWN']);

  assert.equal(assessValidity(ev({ ...alphaOnly, liquidityUsd: 120_000 })).status, VALIDITY.VALID);
  // A centralised spot market is an exit on its own; a thin pool beside it is only noted.
  const spot = assessValidity(ev({ liquidityUsd: 3_000 }));
  assert.equal(spot.status, VALIDITY.VALID);
  assert.ok(check(spot, 'liquidity').codes.includes('THIN_DEX'));
});

test('distribution and maturity inform without ever holding a project back', () => {
  const r = assessValidity(ev({ top10EffectivePct: 72, ageDays: 5, turnover: 6, flags: ['STALE_QUOTE'] }));
  assert.equal(r.status, VALIDITY.VALID);
  assert.ok(check(r, 'distribution').codes.includes('CONCENTRATED'));
  for (const code of ['TOO_NEW', 'WASH_SUSPECT', 'STALE_QUOTE']) assert.ok(check(r, 'maturity').codes.includes(code), code);
  assert.equal(r.warnings.length, 4);

  const unmeasured = assessValidity(ev({ top10EffectivePct: null, ageDays: null }));
  assert.equal(unmeasured.status, VALIDITY.VALID, 'informative checks never make a project pending');
  assert.equal(check(unmeasured, 'distribution').status, CHECK.UNKNOWN);
  assert.equal(check(unmeasured, 'maturity').status, CHECK.UNKNOWN);
});

test('evidence beats absence: a failing check rejects even when another is still missing', () => {
  const r = assessValidity(ev({ marketCap: 900e6, security: null }));
  assert.equal(r.status, VALIDITY.REJECTED);
  assert.deepEqual(r.reasons.map((x) => x.check), ['scope']);
  assert.deepEqual(r.missing.map((x) => x.check), ['contract']);
  assert.ok(r.warnings.every((w) => w.check !== 'scope'), 'the warnings of a failed check are not repeated');
});

test('the gate is pure: same evidence, same verdict, evidence untouched', () => {
  const e = ev({ security: sec({ hiddenOwner: true }), spot: [{ venue: 'mexc', quoteVolume: 20_000 }] });
  const copy = structuredClone(e);
  assert.deepEqual(assessValidity(e), assessValidity(e));
  assert.deepEqual(e, copy);
});

test('summary counts verdicts and what held projects back', () => {
  const s = validitySummary([
    assessValidity(ev()),
    assessValidity(ev({ marketCap: 900e6 })),
    assessValidity(ev({ security: sec({ honeypot: true }) })),
    assessValidity(ev({ security: null })),
  ]);
  assert.deepEqual({ checked: s.checked, valid: s.valid, pending: s.pending, rejected: s.rejected }, { checked: 4, valid: 1, pending: 1, rejected: 2 });
  assert.deepEqual(s.byCode, { MCAP_ABOVE_CAP: 1, HONEYPOT: 1, NOT_SCANNED: 1 });
  assert.deepEqual(s.byCheck, { scope: 1, contract: 2 });
});

test('GoPlus exchange names map onto the venue keys', () => {
  assert.equal(exchangeKey('Gate.io'), 'gate');
  assert.equal(exchangeKey('Huobi Global'), 'htx');
  assert.equal(exchangeKey('OKEx'), 'okx');
  assert.equal(exchangeKey('Binance'), 'binance');
  assert.equal(exchangeKey('Coinbase Exchange'), 'coinbase');
  assert.equal(exchangeKey('KuCoin'), 'kucoin');
  assert.equal(exchangeKey('MEXC'), 'mexc');
});
