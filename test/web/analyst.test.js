/**
 * The optional API section of the dashboard: off by default on GitHub Pages, on when configured,
 * and its markup never leaks undefined/null/NaN — the same rule as every other screen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalystClient, resolveApiBase } from '../../frontend/assets/js/core/analyst.js';
import { analystMarkup } from '../../frontend/assets/js/views/analyst.js';

const memStore = (init = {}) => {
  const m = { ...init };
  return { get: (k, d = null) => (k in m ? m[k] : d), set: (k, v) => (m[k] = v), m };
};
const loc = (href) => ({ href, hostname: new URL(href).hostname });
const leaks = (s) => /undefined|NaN|\bnull\b|\[object/.test(String(s));

test('resolveApiBase: Pages is off, localhost is same-origin, param/storage/meta win', () => {
  assert.equal(resolveApiBase(loc('https://hdmihai.github.io/radarcry/'), memStore()), null);
  assert.equal(resolveApiBase(loc('http://localhost:3000/'), memStore()), '');
  const st = memStore();
  assert.equal(resolveApiBase(loc('https://hdmihai.github.io/radarcry/?api=https://api.example.org/'), st), 'https://api.example.org');
  assert.equal(st.m['cri.api.base'], 'https://api.example.org', 'remembered');
  assert.equal(resolveApiBase(loc('https://hdmihai.github.io/radarcry/'), st), 'https://api.example.org');
  assert.equal(resolveApiBase(loc('https://hdmihai.github.io/radarcry/?api=off'), st), null);
  assert.equal(resolveApiBase(loc('https://hdmihai.github.io/radarcry/'), memStore(), 'https://meta.example.org'), 'https://meta.example.org');
  assert.equal(resolveApiBase(loc('https://hdmihai.github.io/radarcry/?api=javascript:alert(1)'), memStore()), null, 'only http(s)');
});

test('client: no base → never fetches; health decides availability', async () => {
  let calls = 0;
  const off = createAnalystClient(null, async () => (calls++, new Response('{}')));
  assert.equal(await off.available(), false);
  assert.equal(calls, 0);
  const on = createAnalystClient('', async (url) => (calls++, new Response(JSON.stringify(url.endsWith('/api/health') ? { analyst: { ok: true } } : { key: 'k' }), { status: 200 })));
  assert.equal(await on.available(), true);
  assert.equal(await on.available(), true);
  assert.equal(calls, 1, 'health is probed once');
  assert.deepEqual(await on.asset('cg:x'), { key: 'k' });
  const down = createAnalystClient('', async () => new Response('{}', { status: 503 }));
  assert.equal(await down.available(), false);
});

test('analystMarkup: off, loading, error, ready, sparse — no leaks', () => {
  assert.equal(analystMarkup({ status: 'off' }), '');
  assert.equal(analystMarkup(null), '');
  assert.ok(String(analystMarkup({ status: 'loading' })).includes('Analiză cantitativă'));
  assert.ok(String(analystMarkup({ status: 'error', error: '<b>x</b>' })).includes('&lt;b&gt;'), 'escaped');
  const full = {
    cached: true,
    analysis: {
      seriesUsed: 'd1',
      metrics: { returnPct: { p7: 6.8, p30: 3.9 }, volatilityAnnPct: 55.3, sharpe: 0.25, sortino: 0.44, var95Pct: -4.2, cvar95Pct: -5.4, maxDrawdownPct: -19.6, currentDrawdownPct: -7.9, slopePctPerPeriod: 0.04, r2: 0.01, rsi14: 63.1, hurst: 0.37, bandwidthPercentile: 36.6, volumeZ: 0.96, volumeSource: 'h4', obvSlope: 0.037, atrPct14: 1.88 },
      verdict: { quantScore: 58.3, band: 'NEUTRU', confidence: 1, components: { trend: 0.24, structure: 0.45, participation: 0.8, risk: 1 }, signals: ['volum peste normă'], flags: [], note: 'Cercetare, nu sfat financiar.' },
      scoreAlignment: { spearman: 0.55, reading: 'scorul și prețul se mișcă împreună' },
    },
  };
  const ready = String(analystMarkup({ status: 'ready', data: full }));
  assert.ok(ready.includes('NEUTRU · scor cantitativ 58.3'));
  assert.ok(ready.includes('ρ 0.55'));
  assert.ok(!leaks(ready), ready);
  const sparse = String(analystMarkup({ status: 'ready', data: { analysis: { metrics: { volumeZ: null, rsi14: null }, verdict: {} } } }));
  assert.ok(!leaks(sparse), sparse);
});
