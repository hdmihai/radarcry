/**
 * The sources the validity gate reads: three more centralised spot lists (Gate, OKX, Bitget — one
 * public call each), GoPlus's traps and exchange list on EVM and Solana, the coins whose contract
 * lives on a chain the pipeline cannot read, and Gate Alpha rows whose id is a hash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBitget, createGate, createOkx, gateAlphaTicker } from '../../src/adapters/outbound/providers/exchanges.js';
import { normalizeEvm, normalizeSolana } from '../../src/adapters/outbound/providers/onchain.js';
import { createCoinGecko } from '../../src/adapters/outbound/providers/coingecko.js';

const cfg = { enabled: true, minIntervalMs: 0, timeoutMs: 1000, retries: 0, maxCalls: 10 };

/** An HTTP port that serves one payload per URL pattern and records the options of each call. */
function stubHttp(routes) {
  const calls = [];
  return {
    calls,
    async getJson(url, o) {
      calls.push({ url, o });
      const hit = routes.find(([re]) => re.test(url));
      if (!hit) return { ok: false, status: 'HTTP_ERROR', data: null, message: 'no route', meta: { provider: o.provider } };
      if (o.validate && !o.validate(hit[1])) return { ok: false, status: 'INVALID_PAYLOAD', data: null, message: 'invalid', meta: { provider: o.provider } };
      return { ok: true, status: 'OK', data: hit[1], message: '', meta: { provider: o.provider, endpoint: o.endpoint, latencyMs: 1 } };
    },
  };
}

test('Gate spot: every USDT pair in one public call, other quotes and dead pairs dropped', async () => {
  const http = stubHttp([[/api\.gateio\.ws\/api\/v4\/spot\/tickers$/, [
    { currency_pair: 'ABC_USDT', last: '0.5', quote_volume: '123456.7', change_percentage: '-3.2' },
    { currency_pair: 'ABC_BTC', last: '0.00001', quote_volume: '10' },
    { currency_pair: 'DEAD_USDT', last: '0', quote_volume: '0' },
    { currency_pair: '_USDT', last: '1' },
  ]]]);
  const r = await createGate({ http, cfg }).spotTickers();
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, [{ symbol: 'ABC_USDT', base: 'ABC', last: 0.5, quoteVolume: 123456.7, changePct: -3.2 }]);
  assert.equal(http.calls[0].o.provider, 'gate', 'paced and budgeted with the Gate provider');
  assert.equal((await createGate({ http, cfg: { ...cfg, enabled: false } }).spotTickers()).ok, false);
});

test('OKX spot: instId BASE-USDT, volCcy24h is already in USDT, change from the 24 h open', async () => {
  const http = stubHttp([[/okx\.com\/api\/v5\/market\/tickers\?instType=SPOT/, { code: '0', data: [
    { instId: 'XYZ-USDT', last: '2.2', open24h: '2', volCcy24h: '880000' },
    { instId: 'XYZ-USDC', last: '2.2', open24h: '2', volCcy24h: '1' },
  ] }]]);
  const r = await createOkx({ http, cfg }).spotTickers();
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].base, 'XYZ');
  assert.equal(r.data[0].quoteVolume, 880000);
  assert.ok(Math.abs(r.data[0].changePct - 10) < 1e-9);
});

test('Bitget spot: v2 tickers, quote volume with the usdtVolume fallback', async () => {
  const http = stubHttp([[/api\.bitget\.com\/api\/v2\/spot\/market\/tickers/, { code: '00000', data: [
    { symbol: 'QQQUSDT', lastPr: '0.03', open: '0.04', quoteVolume: '55000' },
    { symbol: 'RRRUSDT', lastPr: '1', open: '1', usdtVolume: '7000' },
    { symbol: 'QQQBTC', lastPr: '0.0000003', open: '0.0000003', quoteVolume: '1' },
  ] }]]);
  const r = await createBitget({ http, cfg }).spotTickers();
  assert.deepEqual(r.data.map((t) => [t.base, t.quoteVolume]), [['QQQ', 55000], ['RRR', 7000]]);
  assert.ok(Math.abs(r.data[0].changePct + 25) < 1e-9);
});

test('a Gate Alpha id that is a hash is not a ticker: the name stands in for it', () => {
  assert.equal(gateAlphaTicker({ currency: 'ac56db07f86cd2b4', name: 'Pippin' }), 'PIPPIN');
  assert.equal(gateAlphaTicker({ currency: 'memeboxtrump', name: 'Official Trump' }), 'TRUMP');
  assert.equal(gateAlphaTicker({ currency: 'ac56db07f86cd2b4', name: 'two words' }), 'AC56DB07F86CD2B4', 'a name that is a sentence is not a ticker either');
});

test('GoPlus EVM: the traps, the impostor flag and the exchanges that list the token', () => {
  const s = normalizeEvm({
    is_honeypot: '0', buy_tax: '0', sell_tax: '0', owner_change_balance: '1', selfdestruct: '0', cannot_buy: '0',
    external_call: '1', trading_cooldown: '0', personal_slippage_modifiable: '0', honeypot_with_same_creator: '0',
    is_airdrop_scam: '0', fake_token: { true_token_address: '0xreal', value: 1 },
    is_in_cex: { listed: '1', cex_list: ['Binance', 'Gate.io'] }, launchpad_token: { is_launchpad_token: '1', launchpad_name: 'four.meme' },
    owner_percent: '0.25', creator_percent: '0.01', holders: [],
  }).security;
  assert.equal(s.ownerChangeBalance, true);
  assert.equal(s.selfdestruct, false);
  assert.equal(s.externalCall, true);
  assert.equal(s.fakeToken, true);
  assert.equal(s.airdropScam, false);
  assert.deepEqual(s.cexList, ['Binance', 'Gate.io']);
  assert.equal(s.launchpad, 'four.meme');
  assert.equal(s.ownerPercent, 0.25);

  // Fields GoPlus omits stay unknown: no evidence is not "clean" and not "unlisted".
  const bare = normalizeEvm({ is_honeypot: '0', holders: [] }).security;
  assert.equal(bare.fakeToken, null);
  assert.equal(bare.cexList, null);
  assert.equal(bare.ownerChangeBalance, null);
});

test('GoPlus Solana: fees in basis points, freeze, default-frozen accounts, mutable balances, flagged creators', () => {
  const s = normalizeSolana({
    holder_count: '1200', total_supply: '1000000', holders: [],
    transfer_fee: { current_fee_rate: { fee_rate: '200' } },
    transfer_fee_upgradable: { status: '1' },
    freezable: { status: '1' }, closable: { status: '0' }, balance_mutable_authority: { status: '1' },
    non_transferable: '0', default_account_state: '2', mintable: { status: '0' },
    creators: [{ address: 'Creat0r', malicious_address: 1 }], trusted_token: 0,
  });
  assert.equal(s.security.sellTax, 0.02, '200 bps = 2 %');
  assert.equal(s.security.slippageModifiable, true);
  assert.equal(s.security.freezable, true);
  assert.equal(s.security.closable, false);
  assert.equal(s.security.balanceMutable, true);
  assert.equal(s.security.nonTransferable, false);
  assert.equal(s.security.defaultFrozen, true);
  assert.equal(s.security.maliciousCreator, true);
  assert.equal(s.creatorAddress, 'Creat0r');
  assert.equal(normalizeSolana({ holders: [], default_account_state: '1' }).security.defaultFrozen, false);
  assert.equal(normalizeSolana({ holders: [] }).security.defaultFrozen, null);
});

test('CoinGecko platforms keep the chains the pipeline cannot read, marked unsupported', async () => {
  const http = stubHttp([[/coins\/list\?include_platform=true/, [
    { id: 'multi', platforms: { 'binance-smart-chain': '0xAbC', 'near-protocol': 'token.near', '': '' } },
    { id: 'native', platforms: {} },
  ]]]);
  const cg = createCoinGecko({ http, cfg: { ...cfg, minIntervalMs: 0 } });
  const r = await cg.platforms();
  assert.deepEqual(r.data.get('multi'), [{ chain: 'binance-smart-chain', address: '0xAbC' }, { chain: 'near-protocol', address: 'token.near', unsupported: true }]);
  assert.equal(r.data.has('native'), false);
});
