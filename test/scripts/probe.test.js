/**
 * The weekly probe's verdicts. It failed on 2026-10-26 because the Solana Foundation node answered
 * HTTP 429 to the one call it got: a shared runner address meeting a public rate limit was reported
 * exactly like a dead endpoint. Now a limit is a warning with what would lift it, every source that
 * is not ok gets a second pass, and only a source that is really broken fails the workflow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountRow, probeGate, probes, probeVerdict, renderProbe, runProbes, VERDICT } from '../../scripts/probe-sources.js';
import { PROVIDER_CATALOG } from '../../src/application/use-cases/snapshot.js';

/** probe id → [provider, method] in the live provider map. */
const SHAPE = {
  coingecko: ['coingecko', 'listTop'], coinmarketcap: ['coinmarketcap', 'listTop'], coinpaprika: ['coinpaprika', 'listTop'],
  mexc: ['mexc', 'spotTickers'], mexc_futures: ['mexc', 'perps'], binance_spot: ['binanceSpot', 'spotTickers'],
  gate: ['gate', 'perps'], bitget: ['bitget', 'perps'], okx: ['okx', 'perps'], hyperliquid: ['hyperliquid', 'perps'],
  coinalyze: ['coinalyze', 'markets'], upbit: ['upbit', 'markets'], bithumb: ['bithumb', 'markets'],
  binance_alpha: ['binanceAlpha', 'markets'], gate_alpha: ['gateAlpha', 'markets'], dexscreener: ['dexscreener', 'boosts'],
  geckoterminal: ['geckoterminal', 'trendingPools'], goplus: ['goplus', 'security'], nodereal: ['nodereal', 'tokenHolders'],
  solana_rpc: ['solanaRpc', 'tokenHolders'], defillama: ['defillama', 'protocols'], alternative_me: ['sentiment', 'fearGreed'],
  cryptoquant: ['cryptoquant', 'series'], github: ['github', 'repo'], youtube: ['youtube', 'mentions'], arkham: ['arkham', 'addresses'],
};

const result = (status, message = '') => ({
  ok: status === 'OK', status, data: status === 'OK' ? [1, 2, 3] : null, message,
  meta: { httpStatus: status === 'OK' ? 200 : status === 'RATE_LIMITED' ? 429 : null, latencyMs: 4 },
});

/** Providers whose answers follow a script: `script[id] = [first pass, second pass]`; default OK. */
function scripted(script, { nodes = [], account = null } = {}) {
  const passes = [];
  const make = (pass) => {
    passes.push(pass);
    const P = {};
    for (const [id, [prov, method]] of Object.entries(SHAPE)) {
      P[prov] ??= {};
      P[prov][method] = async () => {
        const s = script[id];
        return s ? s[Math.min(pass, s.length) - 1] : result('OK');
      };
    }
    // The exchanges' second endpoint (spot list) is scripted under `<id>_spot`.
    for (const id of ['gate', 'bitget', 'okx']) {
      P[id].spotTickers = async () => {
        const s = script[`${id}_spot`];
        return s ? s[Math.min(pass, s.length) - 1] : result('OK');
      };
    }
    P.solanaRpc.diagnose = async () => nodes;
    P.solanaRpc.describe = () => ({ account, endpoints: nodes.map((n) => ({ id: n.id, label: n.label, keyed: n.keyed })) });
    return P;
  };
  return { make, passes };
}

const node = (label, supply, largest, extra = {}) => ({
  id: label, label, keyed: false,
  methods: {
    getTokenSupply: { status: supply, httpStatus: supply === 'OK' ? 200 : 429, latencyMs: 80, records: 1, message: '' },
    getTokenLargestAccounts: { status: largest, httpStatus: largest === 'OK' ? 200 : largest === 'RATE_LIMITED' ? 429 : 200, latencyMs: 90, records: largest === 'OK' ? 20 : null, message: largest === 'OK' ? '' : `${largest} m` },
  },
  ...extra,
});

test('every provider in the catalogue is probed', () => {
  const { make } = scripted({});
  assert.deepEqual(probes(make(1)).map((p) => p.id).sort(), Object.keys(PROVIDER_CATALOG).sort());
});

test('verdicts: a limit is a warning, an absent optional key is expected, the rest is broken', () => {
  assert.equal(probeVerdict('OK'), VERDICT.OK);
  for (const s of ['NOT_CONFIGURED', 'SKIPPED']) assert.equal(probeVerdict(s), VERDICT.BENIGN);
  for (const s of ['RATE_LIMITED', 'QUOTA_EXHAUSTED', 'CIRCUIT_OPEN', 'BUDGET_EXHAUSTED']) assert.equal(probeVerdict(s), VERDICT.LIMITED);
  for (const s of ['HTTP_ERROR', 'INVALID_PAYLOAD', 'NETWORK_ERROR', 'TIMEOUT', 'GEO_BLOCKED']) assert.equal(probeVerdict(s), VERDICT.BROKEN);
});

test('the run of 2026-10-26: Solana rate-limited on a shared runner is a warning, not a failed workflow', async () => {
  const { make, passes } = scripted({ solana_rpc: [result('RATE_LIMITED', 'getTokenLargestAccounts: api.mainnet-beta.solana.com 429'), result('RATE_LIMITED', 'getTokenLargestAccounts: api.mainnet-beta.solana.com 429 — SOLANA_RPC_URL (cont gratuit, ex. Helius Free) o deblochează')] },
    { nodes: [node('api.mainnet-beta.solana.com', 'OK', 'RATE_LIMITED'), node('solana-rpc.publicnode.com', 'OK', 'UNSUPPORTED')] });
  const report = await runProbes({ makeProviders: make, settleMs: 0 });
  const sol = report.rows.find((r) => r.id === 'solana_rpc');
  assert.equal(sol.verdict, VERDICT.LIMITED);
  assert.equal(sol.attempts, 2, 'a second pass was made');
  assert.deepEqual(passes, [1, 2]);
  assert.equal(sol.needsKey, false, 'SOLANA_RPC_URL is an upgrade, not a required key');
  assert.equal(report.rows.find((r) => r.id === 'nodereal').needsKey, true);
  const gate = probeGate(report);
  assert.equal(gate.code, 0);
  assert.ok(gate.lines.some((l) => l.startsWith('::warning title=Solana JSON-RPC::RATE_LIMITED')), gate.lines.join('\n'));
  assert.ok(!gate.lines.some((l) => l.startsWith('::error')));
  const text = renderProbe(report);
  assert.match(text, /Solana JSON-RPC — ce servește fiecare nod/);
  assert.match(text, /Helius Free/, 'and says what would lift the limit');
});

test('the second pass rescues a transient failure and keeps the first status for the record', async () => {
  const { make } = scripted({ geckoterminal: [result('TIMEOUT', 'The operation was aborted due to timeout'), result('OK')] });
  const report = await runProbes({ makeProviders: make, settleMs: 0 });
  const gt = report.rows.find((r) => r.id === 'geckoterminal');
  assert.equal(gt.verdict, VERDICT.OK);
  assert.equal(gt.firstStatus, 'TIMEOUT');
  assert.match(renderProbe(report), /a 2-a încercare; prima: TIMEOUT/);
  assert.equal(probeGate(report).code, 0);
});

test('a source broken on both passes fails the workflow, with an error annotation', async () => {
  const { make } = scripted({ upbit: [result('HTTP_ERROR', 'HTTP 404: gone'), result('HTTP_ERROR', 'HTTP 404: gone')] });
  const report = await runProbes({ makeProviders: make, settleMs: 0 });
  assert.equal(report.summary.broken, 1);
  const gate = probeGate(report);
  assert.equal(gate.code, 1);
  assert.ok(gate.lines.includes('::error title=Upbit::HTTP_ERROR HTTP 404: gone'), gate.lines.join('\n'));
});

test('an exchange is probed on both endpoints: a broken spot list fails it even when the perpetuals answer', async () => {
  const { make } = scripted({ okx_spot: [result('HTTP_ERROR', 'HTTP 403: forbidden'), result('HTTP_ERROR', 'HTTP 403: forbidden')] });
  const report = await runProbes({ makeProviders: make, settleMs: 0 });
  const okx = report.rows.find((r) => r.id === 'okx');
  assert.equal(okx.verdict, VERDICT.BROKEN);
  assert.equal(okx.message, 'spot: HTTP 403: forbidden', 'the failing endpoint is named');
  const gate = report.rows.find((r) => r.id === 'gate');
  assert.equal(gate.verdict, VERDICT.OK);
  assert.equal(gate.records, 6, 'both endpoints counted');
});

test('a worse second answer never replaces a better first one', async () => {
  const { make } = scripted({ goplus: [result('RATE_LIMITED'), result('NETWORK_ERROR', 'ECONNRESET')] });
  const report = await runProbes({ makeProviders: make, settleMs: 0 });
  assert.equal(report.rows.find((r) => r.id === 'goplus').verdict, VERDICT.LIMITED);
});

test('a configured SOLANA_RPC_URL that is refused is an error even when public nodes covered for it', () => {
  const ok = accountRow({ account: { label: 'Helius · cont gratuit' }, nodes: [{ ...node('Helius · cont gratuit', 'OK', 'OK'), keyed: true }] });
  assert.equal(ok.verdict, VERDICT.OK);
  const refused = accountRow({ account: { label: 'Helius · cont gratuit' }, nodes: [{ ...node('Helius · cont gratuit', 'HTTP_ERROR', 'HTTP_ERROR'), keyed: true }] });
  assert.equal(refused.verdict, VERDICT.BROKEN);
  const invalid = accountRow({ account: { invalid: 'SOLANA_RPC_URL trebuie să înceapă cu https://' }, nodes: [] });
  assert.equal(invalid.verdict, VERDICT.BROKEN);
  assert.match(invalid.message, /https/);
  assert.equal(accountRow({ account: null, nodes: [] }), null, 'no secret, no row');
});

test('annotations are escaped for GitHub workflow commands, one line per source', () => {
  // A provider's pretty-printed error body (GitHub's 401 is four lines) must not split an annotation.
  const gate = probeGate({ rows: [{ label: 'X: y, z', verdict: VERDICT.BROKEN, status: 'HTTP_ERROR', message: '100% down\r\n  "line": two' }], summary: { total: 1, working: 0, limited: 0, broken: 1 } });
  assert.equal(gate.lines[0], '::error title=X%3A y%2C z::HTTP_ERROR 100%25 down "line": two');
  const text = renderProbe({ at: 'now', summary: { total: 1, working: 0, unconfigured: 0, limited: 0, broken: 1 }, rows: [{ label: 'GitHub', verdict: VERDICT.BROKEN, status: 'HTTP_ERROR', httpStatus: 401, latencyMs: 1, records: null, message: 'HTTP 401: {\n  "message": "Bad credentials"\n}', attempts: 1 }] });
  assert.ok(text.split('\n').some((l) => l.startsWith('✗ GitHub') && l.includes('HTTP 401: { "message": "Bad credentials" }'.slice(0, 40))), text);
});
