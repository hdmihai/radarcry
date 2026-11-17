import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeAnalyst, fakeSnapshots, snapshot, startApp } from './helpers.js';

test('GET /api/health ok, degraded, down', async () => {
  let app = await startApp();
  try {
    const r = await fetch(`${app.base}/api/health`);
    assert.equal(r.status, 200);
    const h = await r.json();
    assert.equal(h.status, 'ok');
    assert.equal(h.snapshot.runId, '20261117T170000');
  } finally {
    await app.close();
  }
  app = await startApp({ analyst: fakeAnalyst({ health: async () => ({ ok: false }) }) });
  try {
    assert.equal((await (await fetch(`${app.base}/api/health`)).json()).status, 'degraded');
  } finally {
    await app.close();
  }
  app = await startApp({ snapshots: { load: async () => { throw new Error('ENOENT'); }, info: () => ({ source: 'x' }) } });
  try {
    const r = await fetch(`${app.base}/api/health`);
    assert.equal(r.status, 503);
  } finally {
    await app.close();
  }
});

test('GET /api/radar list, filters, errors', async () => {
  const app = await startApp();
  try {
    const r = await fetch(`${app.base}/api/radar?limit=3&chain=bsc`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.items.length, 3);
    assert.ok(body.items.every((x) => x.chain === 'bsc'));
    assert.equal(body.meta.runId, '20261117T170000');
    assert.ok(r.headers.get('x-request-id'));
    const bad = await fetch(`${app.base}/api/radar?sort=nope`);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'INVALID_INPUT');
    const meta = await (await fetch(`${app.base}/api/radar/meta`)).json();
    assert.equal(meta.candidates, 9);
  } finally {
    await app.close();
  }
});

test('GET /api/radar/:key compact and full; 404', async () => {
  const app = await startApp();
  try {
    const compact = await (await fetch(`${app.base}/api/radar/${encodeURIComponent('cg:coin-2')}`)).json();
    assert.equal(compact.asset.symbol, 'C2');
    assert.equal(compact.dossier, undefined);
    const full = await (await fetch(`${app.base}/api/radar/C2?full=1`)).json();
    assert.ok(full.dossier.chart);
    const miss = await fetch(`${app.base}/api/radar/zzz`);
    assert.equal(miss.status, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/analysis/:key goes through the bridge once per run (cache), refresh bypasses', async () => {
  const app = await startApp();
  try {
    const a = await (await fetch(`${app.base}/api/analysis/cg:coin-3`)).json();
    assert.equal(a.cached, false);
    assert.equal(a.analysis.verdict.quantScore, 61);
    assert.equal(a.runId, '20261117T170000');
    const b = await (await fetch(`${app.base}/api/analysis/cg:coin-3`)).json();
    assert.equal(b.cached, true);
    await fetch(`${app.base}/api/analysis/cg:coin-3?refresh=1`);
    assert.equal(app.analyst.calls.filter((c) => c[0] === 'asset').length, 2);
    const sent = app.analyst.calls[0][1];
    assert.equal(sent.series.d1.length, 40, 'the python payload carries the series');
  } finally {
    await app.close();
  }
});

test('GET /api/analysis/universe sends only analysable assets; filters apply', async () => {
  const app = await startApp();
  try {
    const r = await (await fetch(`${app.base}/api/analysis/universe?chain=bsc`)).json();
    const sent = app.analyst.calls.find((c) => c[0] === 'universe')[1];
    assert.ok(sent.every((p) => p.chain === 'bsc'));
    assert.ok(!sent.some((p) => p.key === 'cg:no-chart'));
    assert.equal(r.assets, sent.length);
    const few = await fetch(`${app.base}/api/analysis/universe?q=coin%201`);
    assert.equal(few.status, 400);
  } finally {
    await app.close();
  }
});

test('POST /api/analysis/series validates before calling python', async () => {
  const app = await startApp();
  try {
    const ok = await fetch(`${app.base}/api/analysis/series`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ closes: Array.from({ length: 12 }, (_, i) => i + 1) }) });
    assert.equal(ok.status, 200);
    const bad = await fetch(`${app.base}/api/analysis/series`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ closes: [1] }) });
    assert.equal(bad.status, 400);
    const broken = await fetch(`${app.base}/api/analysis/series`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(broken.status, 400);
    assert.equal(app.analyst.calls.filter((c) => c[0] === 'series').length, 1);
  } finally {
    await app.close();
  }
});

test('GET /api/analysis/onchain validates chain and address', async () => {
  const app = await startApp();
  try {
    const ok = await fetch(`${app.base}/api/analysis/onchain/bsc/0x${'a'.repeat(40)}`);
    assert.equal(ok.status, 200);
    assert.equal((await fetch(`${app.base}/api/analysis/onchain/solana/0x${'a'.repeat(40)}`)).status, 400);
    assert.equal((await fetch(`${app.base}/api/analysis/onchain/bsc/0x123`)).status, 400);
  } finally {
    await app.close();
  }
});

test('python failures map to 502/503 with the request id', async () => {
  const { upstream, unavailable } = await import('../src/domain/errors.js');
  const app = await startApp({
    analyst: fakeAnalyst({
      analyzeAsset: async () => {
        throw upstream('analistul Python: HTTP 500');
      },
      analyzeSeries: async () => {
        throw unavailable('circuit deschis');
      },
    }),
  });
  try {
    const r = await fetch(`${app.base}/api/analysis/cg:coin-1`, { headers: { 'x-request-id': 'abc-123' } });
    assert.equal(r.status, 502);
    assert.equal((await r.json()).requestId, 'abc-123');
    const s = await fetch(`${app.base}/api/analysis/series`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ closes: Array.from({ length: 12 }, (_, i) => i + 1) }) });
    assert.equal(s.status, 503);
  } finally {
    await app.close();
  }
});

test('CORS allow-list, unknown route, security headers', async () => {
  const app = await startApp();
  try {
    const ok = await fetch(`${app.base}/api/radar/meta`, { headers: { origin: 'https://hdmihai.github.io' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://hdmihai.github.io');
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(ok.headers.get('x-powered-by'), null);
    const other = await fetch(`${app.base}/api/radar/meta`, { headers: { origin: 'https://evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(`${app.base}/api/radar`, { method: 'OPTIONS', headers: { origin: 'https://hdmihai.github.io' } });
    assert.equal(pre.status, 204);
    assert.equal((await fetch(`${app.base}/api/nope`)).status, 404);
  } finally {
    await app.close();
  }
});

test('rate limit returns 429', async () => {
  const app = await startApp({ config: { rateLimitPerMinute: 2 } });
  try {
    await fetch(`${app.base}/api/radar/meta`);
    await fetch(`${app.base}/api/radar/meta`);
    const r = await fetch(`${app.base}/api/radar/meta`);
    assert.equal(r.status, 429);
    assert.ok(r.headers.get('retry-after'));
    assert.equal((await fetch(`${app.base}/api/health`)).status, 200, 'health is not rate limited');
  } finally {
    await app.close();
  }
});

test('the real snapshot shape works end to end (fake analyst)', async () => {
  const snap = snapshot(30);
  const app = await startApp({ snapshots: fakeSnapshots(snap) });
  try {
    const r = await (await fetch(`${app.base}/api/radar?sort=marketCap&order=asc&limit=5`)).json();
    const caps = r.items.map((x) => x.marketCap);
    assert.deepEqual(caps, [...caps].sort((a, b) => a - b));
  } finally {
    await app.close();
  }
});
