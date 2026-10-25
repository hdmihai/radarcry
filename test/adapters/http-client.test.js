import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient, STATUS } from '../../src/adapters/outbound/http/http-client.js';

/** Scripted fetch: each call shifts the next response; records requested URLs. */
function scriptedFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error('no more scripted responses');
    if (r.throw) throw r.throw;
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  return { impl, calls };
}

const fastClient = (fetchImpl, extra = {}) => {
  const sleeps = [];
  const client = createHttpClient({ fetchImpl, sleepFn: async (ms) => { sleeps.push(ms); }, ...extra });
  return { client, sleeps };
};

test('retries transient 5xx and returns OK with provenance hash', async () => {
  const f = scriptedFetch([{ status: 502, body: 'bad gateway' }, { status: 200, body: [1, 2, 3] }]);
  const { client, sleeps } = fastClient(f.impl);
  const r = await client.getJson('https://api.example.com/x', { provider: 'p', retries: 2, hash: true, validate: Array.isArray });
  assert.equal(r.ok, true);
  assert.equal(r.status, STATUS.OK);
  assert.deepEqual(r.data, [1, 2, 3]);
  assert.equal(r.meta.attempts, 2);
  assert.match(r.meta.sha256, /^[0-9a-f]{64}$/);
  assert.equal(sleeps.length, 1, 'one backoff between attempts');
});

test('429 honours Retry-After before retrying', async () => {
  const f = scriptedFetch([{ status: 429, body: 'slow down', headers: { 'retry-after': '3' } }, { status: 200, body: { ok: 1 } }]);
  const { client, sleeps } = fastClient(f.impl);
  const r = await client.getJson('https://api.example.com/y', { provider: 'p', retries: 1 });
  assert.equal(r.ok, true);
  assert.ok(sleeps.includes(3000), `slept ${sleeps}`);
});

test('451 is GEO_BLOCKED and opens the circuit for the rest of the run', async () => {
  const f = scriptedFetch([{ status: 451, body: 'Unavailable For Legal Reasons' }]);
  const { client } = fastClient(f.impl);
  const r1 = await client.getJson('https://api.example.com/geo', { provider: 'g', retries: 2 });
  assert.equal(r1.status, STATUS.GEO_BLOCKED);
  const r2 = await client.getJson('https://api.example.com/geo2', { provider: 'g' });
  assert.equal(r2.status, STATUS.CIRCUIT_OPEN);
  assert.equal(f.calls.length, 1, 'no request is sent while the circuit is open');
});

test('a plain 403 is an auth error, not a geo block', async () => {
  const f = scriptedFetch([{ status: 403, body: '{"error":"Forbidden"}' }]);
  const { client } = fastClient(f.impl);
  const r = await client.getJson('https://api.example.com/auth', { provider: 'a' });
  assert.equal(r.status, STATUS.HTTP_ERROR);
});

test('budget, validation and invalid JSON are explicit statuses', async () => {
  const f = scriptedFetch([{ status: 200, body: { a: 1 } }, { status: 200, body: 'not json' }, { status: 200, body: { b: 2 } }]);
  const { client } = fastClient(f.impl);
  const v = await client.getJson('https://api.example.com/v', { provider: 'b', validate: Array.isArray, maxCalls: 2 });
  assert.equal(v.status, STATUS.INVALID_PAYLOAD);
  const j = await client.getJson('https://api.example.com/j', { provider: 'b', maxCalls: 2 });
  assert.equal(j.status, STATUS.INVALID_PAYLOAD);
  const b = await client.getJson('https://api.example.com/b', { provider: 'b', maxCalls: 2 });
  assert.equal(b.status, STATUS.BUDGET_EXHAUSTED);
});

test('network errors after retries surface as NETWORK_ERROR; telemetry records every outcome', async () => {
  const events = [];
  const err = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  const f = scriptedFetch([{ throw: err }, { throw: err }]);
  const { client } = fastClient(f.impl, { telemetry: { record: (e) => events.push(e) } });
  const r = await client.getJson('https://api.example.com/n', { provider: 'n', retries: 1 });
  assert.equal(r.status, STATUS.NETWORK_ERROR);
  assert.match(r.message, /ECONNRESET/);
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, 'n');
});

test('an error envelope in an HTTP 200 body keeps the provider\'s reason, and a rate-limit verdict is retried', async () => {
  const { classifyGoPlus } = await import('../../src/adapters/outbound/providers/onchain.js');
  const f = scriptedFetch([
    { status: 200, body: { code: 4029, message: 'too many requests' } },
    { status: 200, body: { code: 1, message: 'OK', result: { '0xabc': { is_honeypot: '0' } } } },
  ]);
  const { client, sleeps } = fastClient(f.impl);
  const ok = await client.getJson('https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=0xabc', { provider: 'goplus', retries: 1, classify: classifyGoPlus });
  assert.equal(ok.ok, true, 'the second attempt succeeds');
  assert.equal(sleeps.length, 1, 'with one backoff in between');

  const g = scriptedFetch([{ status: 200, body: { code: 2022, message: 'The main chain is not supported' } }]);
  const { client: c2 } = fastClient(g.impl);
  const refused = await c2.getJson('https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=0xdef', { provider: 'goplus', retries: 1, classify: classifyGoPlus });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, STATUS.INVALID_PAYLOAD);
  assert.match(refused.message, /2022/, 'the provider code reaches the health panel');
  assert.match(refused.message, /main chain is not supported/);
});
