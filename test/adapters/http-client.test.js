import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient, STATUS } from '../../src/adapters/outbound/http/http-client.js';

/**
 * A clock that only moves when the client sleeps: waits become exact numbers, and "the second call
 * went out 5 s after the first" is a fact the test can read off the scripted fetch.
 */
function fakeClock(start = 1_000_000) {
  const c = { t: start };
  c.now = () => c.t;
  return c;
}

/** Scripted fetch: each call shifts the next response; records requested URLs and the clock. */
function scriptedFetch(responses, clock = null) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, at: clock ? clock.t : null });
    const r = responses.shift();
    if (!r) throw new Error('no more scripted responses');
    if (r.throw) throw r.throw;
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  return { impl, calls };
}

const fastClient = (fetchImpl, extra = {}, clock = fakeClock()) => {
  const sleeps = [];
  const client = createHttpClient({ fetchImpl, now: clock.now, sleepFn: async (ms) => { sleeps.push(ms); clock.t += ms; }, ...extra });
  return { client, sleeps, clock };
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

/*
 * Rate limits on shared runner addresses. In production GoPlus answered 28 of 55 calls and
 * GeckoTerminal 7 of 12: the retry of a 429 slept on its own while the next queued call went out at
 * once, met the same limit, and four limits within seconds opened the circuit for the whole run.
 */

test('a 429 cools the whole lane: the call queued behind it waits out the same cooldown', async () => {
  const clock = fakeClock();
  const f = scriptedFetch([
    { status: 429, body: 'slow down', headers: { 'retry-after': '5' } },
    { status: 200, body: { ok: 1 } },
  ], clock);
  const { client } = fastClient(f.impl, {}, clock);
  const [a, b] = await Promise.all([
    client.getJson('https://api.example.com/a', { provider: 'r', retries: 0 }),
    client.getJson('https://api.example.com/b', { provider: 'r', retries: 0 }),
  ]);
  assert.equal(a.status, STATUS.RATE_LIMITED);
  assert.equal(b.ok, true);
  assert.ok(f.calls[1].at - f.calls[0].at >= 5000, `the second call went out ${f.calls[1].at - f.calls[0].at} ms after the 429, not after the cooldown`);
});

test('a rate-limited lane slows down, then recovers its pace after successes', async () => {
  const f = scriptedFetch([
    { status: 429, body: '' }, { status: 429, body: '' },
    { status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} },
  ]);
  const { client } = fastClient(f.impl);
  const o = { provider: 's', retries: 0, minIntervalMs: 1000, rateLimitCooldownMs: 2000, maxSlowMs: 8000 };
  await client.getJson('https://api.example.com/1', o);
  assert.equal(client.providerState('s').slowMs, 1000, 'the first limit doubles the interval');
  await client.getJson('https://api.example.com/2', o);
  assert.equal(client.providerState('s').slowMs, 2000);
  for (let i = 0; i < 4; i += 1) await client.getJson(`https://api.example.com/ok${i}`, o);
  const after = client.providerState('s').slowMs;
  assert.ok(after < 2000 && after >= 0, `successes bring the pace back (${after} ms extra)`);
});

test('the circuit opens on rate limits only after consecutive limited requests; a success resets the count', async () => {
  const f = scriptedFetch([
    { status: 429 }, { status: 429 }, { status: 200, body: {} },
    { status: 429 }, { status: 429 }, { status: 429 },
  ]);
  const { client } = fastClient(f.impl);
  const o = { provider: 'k', retries: 0, rateLimitCooldownMs: 1000, rateLimitStrikes: 3 };
  for (let i = 0; i < 2; i += 1) assert.equal((await client.getJson(`https://api.example.com/${i}`, o)).status, STATUS.RATE_LIMITED);
  assert.equal((await client.getJson('https://api.example.com/ok', o)).ok, true);
  assert.equal(client.providerState('k').open, false, 'two limits and a success: still closed');
  for (let i = 0; i < 3; i += 1) await client.getJson(`https://api.example.com/x${i}`, o);
  assert.equal(client.providerState('k').open, true, 'three limited requests in a row open it');
  const n = f.calls.length;
  assert.equal((await client.getJson('https://api.example.com/after', o)).status, STATUS.CIRCUIT_OPEN);
  assert.equal(f.calls.length, n, 'and nothing more is sent');
  assert.equal(client.providerState('k').failures, 0, 'rate limits never count as endpoint failures');
});

test('a cooldown that would outlive the run is not waited out', async () => {
  const clock = fakeClock();
  const f = scriptedFetch([{ status: 429, body: '', headers: { 'retry-after': '30' } }], clock);
  const { client, sleeps } = fastClient(f.impl, { deadlineMs: clock.t + 10_000 }, clock);
  const r = await client.getJson('https://api.example.com/late', { provider: 'd', retries: 2 });
  assert.equal(r.status, STATUS.RATE_LIMITED);
  assert.equal(f.calls.length, 1);
  assert.ok(!sleeps.some((ms) => ms >= 30_000), `no 30 s sleep past the deadline (${sleeps})`);
});

test('lanes are paced and broken independently; budget, units and telemetry stay per provider', async () => {
  const events = [];
  const f = scriptedFetch([
    { status: 429, body: '', headers: { 'retry-after': '20' } },
    { status: 200, body: { v: 1 } },
    { status: 200, body: { v: 2 } },
  ]);
  const { client } = fastClient(f.impl, { telemetry: { record: (e) => events.push(e) } });
  const o = (lane) => ({ provider: 'pool', lane, retries: 0, maxCalls: 2, endpoint: `m · ${lane}` });
  assert.equal((await client.postJson('https://a.example.com/', {}, o('a'))).status, STATUS.RATE_LIMITED);
  assert.ok(client.laneStatus('pool', 'a').waitMs >= 19_000, 'lane a is cooling');
  assert.equal(client.laneStatus('pool', 'b').waitMs, 0, 'lane b is not');
  assert.equal((await client.postJson('https://b.example.com/', {}, o('b'))).ok, true, 'and answers at once');
  assert.equal((await client.postJson('https://b.example.com/', {}, o('b'))).status, STATUS.BUDGET_EXHAUSTED, 'the budget is the provider\'s, across lanes');
  assert.deepEqual(events.map((e) => e.provider), ['pool', 'pool', 'pool']);
  assert.equal(events[0].endpoint, 'm · a');
});

test('a redactor removes secrets from messages before they reach telemetry or the caller', async () => {
  const events = [];
  const f = scriptedFetch([{ status: 401, body: '{"error":"invalid api key SECRETKEY12345"}' }]);
  const { client } = fastClient(f.impl, { telemetry: { record: (e) => events.push(e) } });
  const r = await client.postJson('https://rpc.example.com/?api-key=SECRETKEY12345', {}, { provider: 'x', retries: 0, redact: (m) => m.split('SECRETKEY12345').join('***') });
  assert.equal(r.status, STATUS.HTTP_ERROR);
  assert.doesNotMatch(r.message, /SECRETKEY/);
  assert.doesNotMatch(events[0].message, /SECRETKEY/);
  assert.match(r.message, /invalid api key \*\*\*/);
});
