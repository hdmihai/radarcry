/** Shared test doubles: a deterministic snapshot and a fake analyst that implements AnalystPort. */
import { createApp } from '../src/app.js';
import { createUseCases } from '../src/application/use-cases.js';
import { MemoryCache } from '../src/services/MemoryCache.js';

export function candidate(i, over = {}) {
  const t0 = 1_780_000_000;
  const d1 = Array.from({ length: 40 }, (_, k) => [t0 + k * 86400, 1 + i * 0.1 + k * 0.01]);
  return {
    key: `cg:coin-${i}`,
    symbol: `C${i}`,
    name: `Coin ${i}`,
    depth: i % 2 ? 'deep' : 'quick',
    chain: i % 3 ? 'bsc' : 'ethereum',
    contract: `0x${String(i).padStart(40, '0')}`,
    rank: { coingecko: 100 + i, cmc: null },
    market: { price: 1 + i, marketCap: 1e7 * (i + 1), fdv: 2e7 * (i + 1), volume24h: 1e6 * (10 - i), change: { h24: i, d7: i * 2 - 5, d30: null } },
    score: { cri: 40 + i * 5, tier: 'C', confidence: 0.8 },
    stage: i < 3 ? 'BASE' : 'BUILDING',
    signal: { type: i % 2 ? 'WATCH' : 'NONE' },
    risk: { score: 10 + i * 3, grade: 'B', critical: false },
    validity: { status: i === 0 ? 'PENDING' : 'VALID' },
    forecast: { targets: { 20: { pct: 0.1 * i }, 100: { pct: 0.01 * i } } },
    chart: { d1, h4: [] },
    sparkline: d1.slice(-30).map((r) => r[1]),
    history: [['2026-11-01T00:00:00.000Z', 50, 'BASE', 1.1], ['2026-11-02T00:00:00.000Z', 55, 'BASE', 1.2]],
    ...over,
  };
}

export function snapshot(n = 8) {
  return {
    schemaVersion: '4.0.0',
    meta: { runId: '20261117T170000', generatedAt: '2026-11-17T17:00:00.000Z', mode: 'fixture', disclaimer: 'Cercetare, nu sfat financiar.' },
    health: { overall: 'HEALTHY' },
    market: { regime: { label: 'neutru' } },
    candidates: [...Array.from({ length: n }, (_, i) => candidate(i)), candidate(99, { key: 'cg:no-chart', symbol: 'NOC', chart: null, sparkline: [], score: { cri: null } })],
  };
}

export function fakeSnapshots(snap = snapshot()) {
  return { load: async () => snap, info: () => ({ source: 'memory', loadedAt: 0 }) };
}

export function fakeAnalyst(over = {}) {
  const calls = [];
  return {
    calls,
    health: async () => ({ ok: true, version: 'fake' }),
    analyzeAsset: async (p) => (calls.push(['asset', p]), { verdict: { quantScore: 61, band: 'NEUTRU' }, key: p.key }),
    analyzeUniverse: async (ps) => (calls.push(['universe', ps]), { assets: ps.length, ranking: ps.map((p) => ({ key: p.key })) }),
    analyzeSeries: async (s) => (calls.push(['series', s]), { metrics: { points: s.closes.length } }),
    onchain: async (chain, address) => (calls.push(['onchain', chain, address]), { isContract: true }),
    ...over,
  };
}

export function runnersDoc() {
  const c = (i, tier, stage) => ({ key: `cg:coin-${i}`, symbol: `C${i}`, probability: 0.4 - i * 0.05, lift: 4 - i * 0.5, tier, stage, rank: i + 1, factors: [{ key: 'vol_z30', contribution: 0.3 }], drivers: [], rulesMatched: ['R1'] });
  return { generatedAt: '2026-11-18T08:00:00Z', horizonDays: 7, target: { fwdMaxReturn: 0.5 }, metrics: { auc: 0.8 }, rules: [{ id: 'R1', text: 'x' }], factors: [], references: [], events: [], candidates: [c(0, 'A', 'PRE'), c(1, 'B', 'APRINDERE'), c(2, 'C', 'PRE')] };
}

export async function startApp({ snapshots = fakeSnapshots(), analyst = fakeAnalyst(), config = {}, runners = { load: async () => runnersDoc(), info: () => ({ source: 'memory' }) } } = {}) {
  const useCases = createUseCases({ snapshots, analyst, runners, cache: new MemoryCache(), clock: { now: () => Date.parse('2026-11-17T18:00:00Z') } });
  const app = createApp({ useCases, config: { version: 'test', corsOrigins: ['https://hdmihai.github.io'], ...config }, logger: { error() {} } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, analyst, close: () => new Promise((r) => server.close(r)) };
}
