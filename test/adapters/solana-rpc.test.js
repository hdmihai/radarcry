/**
 * The Solana holder list from GitHub's runners.
 *
 * In production the Solana Foundation endpoint answered `getTokenLargestAccounts` with HTTP 429 on
 * every call of every run (its `getTokenSupply` passed), so no Solana project ever had a holder list
 * and the weekly probe failed on it. The adapter is now a pool: a free-account endpoint first when
 * SOLANA_RPC_URL is set, then public nodes, with per-run memory of which node serves which method.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient, STATUS } from '../../src/adapters/outbound/http/http-client.js';
import { classifySolanaRpc, createSolanaRpc, solanaAccountEndpoint, SOLANA_PUBLIC_ENDPOINTS } from '../../src/adapters/outbound/providers/holders.js';

const MINT = 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE';
const cfg = { enabled: true, timeoutMs: 5000, retries: 1, minIntervalMs: 1200, accountMinIntervalMs: 150, maxCalls: 90, rateLimitCooldownMs: 10_000, rateLimitStrikes: 2, failoverWaitMs: 3000 };

const LARGEST = { context: { slot: 1 }, value: [
  { address: 'TokAcc1', amount: '600', decimals: 0, uiAmount: 600 },
  { address: 'TokAcc2', amount: '300', decimals: 0, uiAmount: 300 },
  { address: 'TokAcc3', amount: '100', decimals: 0, uiAmount: 100 },
] };
const SUPPLY = { context: { slot: 1 }, value: { amount: '2000', decimals: 0, uiAmount: 2000 } };
const ACCOUNTS = { context: { slot: 1 }, value: [
  { executable: false, data: { parsed: { info: { owner: 'WalletA' } } } },
  { executable: false, data: { parsed: { info: { owner: 'WalletB' } } } },
  { executable: false, data: { parsed: { info: { owner: 'WalletA' } } } },
] };
const RESULT = { getTokenLargestAccounts: LARGEST, getTokenSupply: SUPPLY, getMultipleAccounts: ACCOUNTS };

const rpcOk = (method) => ({ status: 200, body: { jsonrpc: '2.0', id: 1, result: RESULT[method] } });
const rpcErr = (code, message) => ({ status: 200, body: { jsonrpc: '2.0', id: 1, error: { code, message } } });

/**
 * A fetch that answers per host and per JSON-RPC method. `plan[host][method]` is a response, or a
 * list of responses consumed in order (the last one repeats). Unplanned calls answer normally.
 */
function network(plan = {}) {
  const calls = [];
  const clock = { t: 5_000_000 };
  const impl = async (url, init) => {
    const host = new URL(url).hostname;
    const { method } = JSON.parse(init.body);
    calls.push({ host, method, at: clock.t, url });
    let r = plan[host]?.[method];
    if (Array.isArray(r)) r = r.length > 1 ? r.shift() : r[0];
    r ??= rpcOk(method);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  return { impl, calls, clock };
}

function pool(plan, { accountUrl = null, events = [] } = {}) {
  const net = network(plan);
  const http = createHttpClient({
    fetchImpl: net.impl,
    now: () => net.clock.t,
    sleepFn: async (ms) => { net.clock.t += ms; },
    telemetry: { record: (e) => events.push(e) },
  });
  return { rpc: createSolanaRpc({ http, cfg, accountUrl }), net, events };
}

const [FOUNDATION, PUBLICNODE, DRPC, ONFINALITY] = SOLANA_PUBLIC_ENDPOINTS.map((e) => new URL(e.url).hostname);

test('a node that rate-limits the holder list is passed over; the next one serves it and keeps serving it', async () => {
  const { rpc, net } = pool({
    [FOUNDATION]: { getTokenLargestAccounts: { status: 429, body: 'Too many requests' } },
    [PUBLICNODE]: { getTokenLargestAccounts: rpcErr(-32601, 'Method not found') },
  });
  const r = await rpc.tokenHolders(MINT);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.source, 'solana_rpc');
  assert.deepEqual(r.data.holders.map((h) => [h.address, h.balance]), [['WalletA', 700], ['WalletB', 300]], 'token accounts merged by owner');
  assert.equal(r.data.holders[0].share, 35, 'shares against the supply');
  assert.match(r.meta.endpoint, /solana\.drpc\.org/, 'the health row says which node answered');
  const largest = net.calls.filter((c) => c.method === 'getTokenLargestAccounts').map((c) => c.host);
  assert.deepEqual(largest, [FOUNDATION, PUBLICNODE, DRPC]);

  net.calls.length = 0;
  net.clock.t += 60_000;
  const again = await rpc.tokenHolders(MINT);
  assert.equal(again.ok, true);
  assert.deepEqual(net.calls.filter((c) => c.method === 'getTokenLargestAccounts').map((c) => c.host), [DRPC], 'the node that served it is asked first');
  assert.ok(!net.calls.some((c) => c.host === PUBLICNODE && c.method === 'getTokenLargestAccounts'), 'a refusal is remembered for the run');
});

test('the list is asked first: no supply or owner calls are spent on a token whose list nobody serves', async () => {
  const refuse = { getTokenLargestAccounts: rpcErr(-32601, 'Method not found') };
  const { rpc, net } = pool({ [FOUNDATION]: refuse, [PUBLICNODE]: refuse, [DRPC]: refuse, [ONFINALITY]: refuse });
  const r = await rpc.tokenHolders(MINT);
  assert.equal(r.ok, false);
  assert.deepEqual([...new Set(net.calls.map((c) => c.method))], ['getTokenLargestAccounts']);
});

test('when every public node refuses, the pool says a free account is needed — and stops asking', async () => {
  const { rpc, net } = pool({
    [FOUNDATION]: { getTokenLargestAccounts: rpcErr(-32010, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA excluded from account secondary indexes; this RPC method unavailable for key') },
    [PUBLICNODE]: { getTokenLargestAccounts: { status: 403, body: '{"error":"forbidden"}' } },
    [DRPC]: { getTokenLargestAccounts: { status: 404, body: 'not found' } },
    [ONFINALITY]: { getTokenLargestAccounts: rpcErr(-32601, 'the method getTokenLargestAccounts does not exist/is not available') },
  });
  const r = await rpc.tokenHolders(MINT);
  assert.equal(r.status, STATUS.NOT_CONFIGURED, `a STOP status: the deep research stops calling Solana for this run — ${r.message}`);
  assert.match(r.message, /SOLANA_RPC_URL/);
  assert.match(r.message, /Helius Free/);
  const n = net.calls.length;
  const again = await rpc.tokenHolders(MINT);
  assert.equal(again.status, STATUS.NOT_CONFIGURED);
  assert.equal(net.calls.length, n, 'nothing is sent to nodes that already refused');
});

test('with every public node rate-limited the pool reports RATE_LIMITED and does not queue behind the cooldowns', async () => {
  const limited = { getTokenLargestAccounts: { status: 429, body: '' } };
  const { rpc, net } = pool({ [FOUNDATION]: limited, [PUBLICNODE]: limited, [DRPC]: limited, [ONFINALITY]: limited });
  const r = await rpc.tokenHolders(MINT);
  assert.equal(r.status, STATUS.RATE_LIMITED);
  assert.equal(net.calls.length, 4, 'one call per node, no retries on a public node');
  const t = net.clock.t;
  const again = await rpc.tokenHolders(MINT);
  assert.equal(again.status, STATUS.RATE_LIMITED);
  assert.equal(net.calls.length, 4, 'every node is cooling: the pool answers at once');
  assert.equal(net.clock.t, t, 'without waiting');
  assert.match(again.message, /în pauză/);

  // Two limited requests in a row close a node's lane for the run.
  net.clock.t += 20_000;
  await rpc.tokenHolders(MINT);
  net.clock.t += 20_000;
  const closed = await rpc.tokenHolders(MINT);
  assert.equal(closed.status, STATUS.CIRCUIT_OPEN, 'a STOP status once every node has refused twice');
  assert.equal(net.calls.length, 8);
});

test('SOLANA_RPC_URL is asked first, and its key never appears in a message or in the telemetry', async () => {
  const KEY = 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff';
  const accountUrl = `https://mainnet.helius-rpc.com/?api-key=${KEY}`;
  const events = [];
  const { rpc, net } = pool({}, { accountUrl, events });
  const r = await rpc.tokenHolders(MINT);
  assert.equal(r.ok, true);
  assert.ok(net.calls.every((c) => c.host === 'mainnet.helius-rpc.com'), 'no public node is needed');
  assert.match(r.meta.endpoint, /Helius · cont gratuit/);
  assert.ok(events.every((e) => !JSON.stringify(e).includes(KEY)));
  assert.equal(rpc.describe().account.label, 'Helius · cont gratuit');
  assert.ok(!JSON.stringify(rpc.describe()).includes(KEY));

  // A rejected key: the message is masked, the account is set aside, the public nodes take over.
  const bad = pool({ 'mainnet.helius-rpc.com': { getTokenLargestAccounts: { status: 401, body: `{"error":"invalid api key ${KEY}"}` } } }, { accountUrl, events: [] });
  const r2 = await bad.rpc.tokenHolders(MINT);
  assert.equal(r2.ok, true, 'served by a public node');
  assert.ok(bad.events.every((e) => !JSON.stringify(e).includes(KEY)), 'the echoed key is masked in the telemetry');
  const r3 = await bad.rpc.tokenHolders(MINT);
  assert.equal(r3.ok, true);
  assert.equal(bad.net.calls.filter((c) => c.host === 'mainnet.helius-rpc.com').length, 1, 'a refused key is not tried again this run');
});

test('an invalid SOLANA_RPC_URL is ignored and reported; the public pool still runs', async () => {
  assert.deepEqual(solanaAccountEndpoint('http://mainnet.helius-rpc.com/?api-key=x'), { invalid: 'SOLANA_RPC_URL trebuie să înceapă cu https://' });
  assert.deepEqual(solanaAccountEndpoint('not a url'), { invalid: 'SOLANA_RPC_URL nu este un URL valid' });
  assert.equal(solanaAccountEndpoint('  '), null);
  const { rpc } = pool({}, { accountUrl: 'http://insecure.example/rpc' });
  assert.match(rpc.describe().account.invalid, /https/);
  assert.equal(rpc.describe().endpoints.length, SOLANA_PUBLIC_ENDPOINTS.length);
  assert.equal((await rpc.tokenHolders(MINT)).ok, true);
  const diag = await rpc.diagnose(MINT);
  assert.equal(diag[0].invalid, 'SOLANA_RPC_URL trebuie să înceapă cu https://', 'the probe shows the bad secret first');
});

test('a node that answers something other than JSON-RPC (a challenge page) is set aside for the run', async () => {
  const net = network({});
  const page = '<!DOCTYPE html><html><body>Just a moment...</body></html>';
  const impl = async (url, init) => {
    if (new URL(url).hostname === FOUNDATION) {
      net.calls.push({ host: FOUNDATION, method: JSON.parse(init.body).method });
      return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return net.impl(url, init);
  };
  const http = createHttpClient({ fetchImpl: impl, now: () => net.clock.t, sleepFn: async (ms) => { net.clock.t += ms; } });
  const rpc = createSolanaRpc({ http, cfg });
  const r = await rpc.tokenHolders(MINT);
  assert.equal(r.ok, true, 'the next node serves it');
  await rpc.tokenHolders(MINT);
  assert.equal(net.calls.filter((c) => c.host === FOUNDATION).length, 1, 'the challenge page is met once, then the node is skipped');
});

test('"not a mint" is about the input: every node would repeat it, so the pool stops at the first', async () => {
  const { rpc, net } = pool({ [FOUNDATION]: { getTokenLargestAccounts: rpcErr(-32602, 'Invalid param: not a Token mint') } });
  const r = await rpc.tokenHolders(MINT);
  assert.equal(r.status, STATUS.INVALID_PAYLOAD);
  assert.equal(net.calls.length, 1);
});

test('the JSON-RPC envelope is classified by whose problem it is', () => {
  assert.equal(classifySolanaRpc({ result: { value: [] } }), null);
  assert.equal(classifySolanaRpc({ result: null }), null, 'null is a valid result');
  assert.equal(classifySolanaRpc({ error: { code: 429, message: 'Too many requests for a specific RPC call' } }).status, STATUS.RATE_LIMITED);
  assert.equal(classifySolanaRpc({ error: { code: -32000, message: 'rate limit exceeded' } }).status, STATUS.RATE_LIMITED);
  assert.equal(classifySolanaRpc({ error: { code: -32601, message: 'Method not found' } }).status, STATUS.UNSUPPORTED);
  assert.equal(classifySolanaRpc({ error: { code: -32010, message: 'excluded from account secondary indexes' } }).status, STATUS.UNSUPPORTED);
  assert.equal(classifySolanaRpc({ error: { code: -32602, message: 'Invalid param: not a Token mint' } }).status, STATUS.INVALID_PAYLOAD);
  assert.equal(classifySolanaRpc({ error: { code: -32005, message: 'Node is behind by 150 slots' } }).status, STATUS.HTTP_ERROR, 'Solana -32005 is an unhealthy node, not a rate limit');
  assert.equal(classifySolanaRpc({ jsonrpc: '2.0', id: 1 }).status, STATUS.INVALID_PAYLOAD);
  assert.equal(classifySolanaRpc([1]).status, STATUS.INVALID_PAYLOAD);
});

test('the probe\'s diagnosis asks every node once per method, outside the pool\'s memory', async () => {
  const { rpc, net } = pool({
    [FOUNDATION]: { getTokenLargestAccounts: { status: 429, body: '' } },
    [PUBLICNODE]: { getTokenLargestAccounts: rpcErr(-32601, 'Method not found') },
  });
  const rows = await rpc.diagnose(MINT);
  assert.deepEqual(rows.map((r) => r.label), SOLANA_PUBLIC_ENDPOINTS.map((e) => e.label));
  assert.equal(rows[0].methods.getTokenSupply.status, STATUS.OK);
  assert.equal(rows[0].methods.getTokenLargestAccounts.status, STATUS.RATE_LIMITED);
  assert.equal(rows[1].methods.getTokenLargestAccounts.status, STATUS.UNSUPPORTED);
  assert.equal(rows[2].methods.getTokenLargestAccounts.records, 3);
  assert.equal(net.calls.length, 8);
  // The pool itself was not taught anything by the diagnosis: its first real call starts from the top.
  net.calls.length = 0;
  await rpc.tokenHolders(MINT);
  assert.equal(net.calls[0].host, FOUNDATION);
});
