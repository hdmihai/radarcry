import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PythonBridge } from '../src/services/PythonBridge.js';
import { assertPort } from '../src/ports/index.js';

async function fakePython(handler) {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const out = await handler(req, body ? JSON.parse(body) : null);
    res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.body ?? {}));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const noSleep = async () => {};

test('PythonBridge implements AnalystPort', () => {
  assert.doesNotThrow(() => assertPort('AnalystPort', new PythonBridge()));
  assert.throws(() => new PythonBridge({ mode: 'grpc' }));
  assert.throws(() => new PythonBridge({ mode: 'spawn' }), /cliPath/);
});

test('http: routes, payloads and health', async () => {
  const seen = [];
  const py = await fakePython((req, body) => {
    seen.push([req.method, req.url, body]);
    if (req.url === '/health') return { body: { status: 'ok', version: '1.0.0' } };
    return { body: { echoed: body } };
  });
  try {
    const b = new PythonBridge({ baseUrl: `${py.url}/`, sleep: noSleep });
    assert.equal((await b.health()).ok, true);
    assert.deepEqual((await b.analyzeAsset({ key: 'k' })).echoed, { key: 'k' });
    assert.deepEqual((await b.analyzeUniverse([{ key: 'a' }])).echoed, { assets: [{ key: 'a' }] });
    await b.onchain('bsc', '0xabc');
    assert.deepEqual(seen.map((s) => `${s[0]} ${s[1]}`), ['GET /health', 'POST /v1/analyze/asset', 'POST /v1/analyze/universe', 'GET /v1/onchain/bsc/0xabc']);
  } finally {
    await py.close();
  }
});

test('http: retries transient 503 then succeeds; 422 maps to INVALID_INPUT without retry', async () => {
  let n = 0;
  const py = await fakePython((req) => {
    if (req.url === '/v1/analyze/series') return { status: 422, body: { detail: 'prea puține puncte' } };
    n += 1;
    return n < 3 ? { status: 503, body: {} } : { body: { ok: 1 } };
  });
  try {
    const b = new PythonBridge({ baseUrl: py.url, retries: 2, sleep: noSleep });
    assert.deepEqual(await b.analyzeAsset({}), { ok: 1 });
    assert.equal(n, 3);
    await assert.rejects(b.analyzeSeries({}), (e) => e.kind === 'INVALID_INPUT' && /prea puține/.test(e.message));
  } finally {
    await py.close();
  }
});

test('http: circuit breaker opens after repeated transient failures', async () => {
  let t = 1000;
  let hits = 0;
  const b = new PythonBridge({
    baseUrl: 'http://127.0.0.1:9',
    retries: 0,
    breakerThreshold: 2,
    breakerCooldownMs: 5000,
    now: () => t,
    sleep: noSleep,
    fetchImpl: async () => {
      hits += 1;
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(b.analyzeAsset({}), (e) => e.kind === 'UPSTREAM');
  await assert.rejects(b.analyzeAsset({}), (e) => e.kind === 'UPSTREAM');
  await assert.rejects(b.analyzeAsset({}), (e) => e.kind === 'UNAVAILABLE' && /circuit/.test(e.message));
  assert.equal(hits, 2, 'open circuit does not call python');
  assert.equal((await b.health()).ok, false);
  t += 6000;
  await assert.rejects(b.analyzeAsset({}), (e) => e.kind === 'UPSTREAM');
  assert.equal(hits, 3, 'half-open after the cooldown');
});

test('http: timeout is transient', async () => {
  const b = new PythonBridge({
    baseUrl: 'http://x',
    retries: 1,
    timeoutMs: 20,
    sleep: noSleep,
    // AbortSignal.timeout() is unref'd; a ref'd timer stands in for the open socket a real fetch holds.
    fetchImpl: (url, { signal }) =>
      new Promise((_, rej) => {
        const keep = setTimeout(() => {}, 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(keep);
          rej(Object.assign(new Error('t'), { name: 'TimeoutError' }));
        });
      }),
  });
  await assert.rejects(b.analyzeAsset({}), /timeout după 20 ms/);
});

test('spawn: JSON over stdin/stdout, exit 2 = rejected input', async () => {
  // A stand-in for cli.py written in JS, run with the current node: same protocol, no Python needed.
  const dir = await mkdtemp(join(tmpdir(), 'bridge-'));
  const cli = join(dir, 'cli.mjs');
  await writeFile(
    cli,
    `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const cmd=process.argv[2];const b=JSON.parse(s||'{}');
     if(cmd==='health'){process.stdout.write(JSON.stringify({status:'ok'}));return;}
     if(cmd==='series'&&!(b.closes||[]).length){process.stdout.write(JSON.stringify({detail:'closes lipsă'}));process.exit(2);}
     if(cmd==='asset'&&b.crash){process.stderr.write('boom');process.exit(1);}
     process.stdout.write(JSON.stringify({cmd,b}));});`,
  );
  const b = new PythonBridge({ mode: 'spawn', python: process.execPath, cliPath: cli, sleep: noSleep });
  assert.equal((await b.health()).ok, true);
  assert.deepEqual(await b.analyzeAsset({ key: 'k' }), { cmd: 'asset', b: { key: 'k' } });
  assert.deepEqual(await b.onchain('bsc', '0x1'), { cmd: 'onchain', b: { chain: 'bsc', address: '0x1' } });
  await assert.rejects(b.analyzeSeries({}), (e) => e.kind === 'INVALID_INPUT' && /closes lipsă/.test(e.message));
  await assert.rejects(b.analyzeAsset({ crash: true }), (e) => e.kind === 'UPSTREAM' && e.details.stderr === 'boom');
});

test('spawn: missing interpreter is reported, not thrown raw', async () => {
  const b = new PythonBridge({ mode: 'spawn', python: '/nonexistent/python', cliPath: 'cli.py', retries: 0, sleep: noSleep });
  await assert.rejects(b.analyzeAsset({}), (e) => e.kind === 'UPSTREAM');
});
