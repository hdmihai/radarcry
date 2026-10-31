/**
 * The forecast use-case: the learning list kept within a per-run budget of free history calls,
 * seeds resolved only on a ticker-and-name match, one entry per project, and the snapshot block
 * that publishes base rates, the list and the top forecasts of verified projects only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastPolicy, forecastReport, forecastView, pastRunsByKey, refreshWinners, runForecast, trackedPopulation, winnerCandidates } from '../../src/application/use-cases/forecast.js';
import { WINNER_STATUS } from '../../src/domain/forecast/winners.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-31T00:00:00Z');
const policy = forecastPolicy({ universe: { minMarketCapUsd: 1e6 }, forecast: { chartsPerRun: 2 } });

/** A CoinGecko market_chart payload with a ≥100× run (or a flat line). */
function chart({ run = true } = {}) {
  const prices = [];
  const caps = [];
  const vols = [];
  for (let d = 365; d >= 0; d -= 1) {
    const t = NOW - d * DAY;
    const p = !run ? 1 : d > 250 ? 0.08 : d > 200 ? 0.05 : d > 120 ? 0.05 * 150 ** ((200 - d) / 80) : 7.5 * 0.2;
    prices.push([t, p]);
    caps.push([t, p * 1e8]);
    vols.push([t, p * 1e8 * 0.2]);
  }
  return { prices, market_caps: caps, total_volumes: vols };
}

function historyPort({ charts = {}, search = [] } = {}) {
  const calls = [];
  return {
    calls,
    async marketChart(id) {
      calls.push(['chart', id]);
      if (charts[id] === 'LIMIT') return { ok: false, status: 'RATE_LIMITED', data: null };
      return charts[id] ? { ok: true, status: 'OK', data: charts[id] } : { ok: false, status: 'HTTP_ERROR', data: null, message: 'HTTP 404' };
    },
    async search(q) {
      calls.push(['search', q]);
      return { ok: true, status: 'OK', data: search };
    },
  };
}

const marketAsset = (key, id, symbol, atl, ath) => ({
  key, symbol, name: symbol, ids: { coingecko: id }, primary: { chain: 'bsc' }, listing: {},
  market: { atl, atlDate: '2026-03-01T00:00:00Z', ath, athDate: '2026-08-01T00:00:00Z' },
});

test('candidates: documented seeds and the market\'s ATL/ATH, merged by CoinGecko id', () => {
  const seeds = [{ symbol: 'LAB', name: 'LAB', coingeckoId: 'lab', documented: { multiple: 274 }, sources: [{ title: 's', url: 'https://x' }] }];
  const assets = [marketAsset('cg:lab', 'lab', 'LAB', 0.1, 27), marketAsset('cg:new', 'new', 'NEW', 0.01, 3), marketAsset('cg:small', 'small', 'SML', 1, 4)];
  const c = winnerCandidates({ seeds, assets, nowMs: NOW, policy });
  assert.deepEqual([...c.keys()].sort(), ['cg:lab', 'cg:new'], 'the 4× rally is not a candidate');
  assert.equal(c.get('cg:lab').origin, 'seed');
  assert.equal(c.get('cg:lab').claimed.multiple, 270, 'the seed also carries the market claim');
  assert.equal(c.get('cg:lab').sources.length, 1, 'and keeps its documented sources');
});

test('the learning list is confirmed within the per-run budget, the rest waits, nothing is invented', async () => {
  const seeds = [
    { symbol: 'AAA', name: 'Alpha A', coingeckoId: 'aaa', documented: { multiple: 300 } },
    { symbol: 'BBB', name: 'Beta B', coingeckoId: 'bbb', documented: { multiple: 150 } },
    { symbol: 'CCC', name: 'Gamma C', coingeckoId: 'ccc' },
  ];
  const history = historyPort({ charts: { aaa: chart(), bbb: chart({ run: false }), ccc: chart() } });
  const r = await refreshWinners({ cached: null, seeds, assets: [], history, nowMs: NOW, policy });
  assert.equal(r.stats.charts, 2, 'two histories per run');
  const by = Object.fromEntries(r.items.map((w) => [w.symbol, w]));
  assert.equal(by.AAA.status, WINNER_STATUS.CONFIRMED);
  assert.ok(by.AAA.multiple >= 100 && by.AAA.vector);
  assert.equal(by.BBB.status, WINNER_STATUS.BELOW, 'a documented 150× that the history does not show is contradicted');
  assert.equal(by.CCC.status, WINNER_STATUS.PENDING, 'no budget left this run: pending, not assumed');

  // Next run: the confirmations are carried, only the pending one is read.
  const next = await refreshWinners({ cached: { items: r.items }, seeds, assets: [], history, nowMs: NOW + DAY, policy });
  assert.equal(next.stats.charts, 1);
  assert.equal(Object.fromEntries(next.items.map((w) => [w.symbol, w])).CCC.status, WINNER_STATUS.CONFIRMED);
  assert.deepEqual(history.calls.filter(([k]) => k === 'chart').map(([, id]) => id), ['aaa', 'bbb', 'ccc']);
});

test('a seed id CoinGecko does not know is resolved only on a ticker-and-name match', async () => {
  const seeds = [{ symbol: 'VVV', name: 'Venice Token', coingeckoId: 'wrong-id', documented: { multiple: 37 } }];
  const wrong = historyPort({ charts: { other: chart() }, search: [{ id: 'other', symbol: 'vvv', name: 'Some Other Project' }] });
  const a = await refreshWinners({ cached: null, seeds, assets: [], history: wrong, nowMs: NOW, policy });
  assert.equal(a.items[0].status, WINNER_STATUS.DOCUMENTED, 'a shared ticker alone is not the project');
  const right = historyPort({ charts: { 'venice-token': chart() }, search: [{ id: 'venice-token', symbol: 'VVV', name: 'Venice Token' }] });
  const b = await refreshWinners({ cached: null, seeds, assets: [], history: right, nowMs: NOW, policy });
  assert.equal(b.items[0].status, WINNER_STATUS.CONFIRMED);
  assert.equal(b.items[0].id, 'venice-token');
});

test('one entry per project, and a rate limit stops the reads for this run', async () => {
  const seeds = [{ symbol: 'LAB', name: 'LAB', coingeckoId: 'lab-wrong' }];
  const assets = [marketAsset('cg:lab', 'lab', 'LAB', 0.01, 3)];
  const history = historyPort({ charts: { lab: chart() }, search: [{ id: 'lab', symbol: 'LAB', name: 'LAB' }] });
  const r = await refreshWinners({ cached: null, seeds, assets, history, nowMs: NOW, policy: { ...policy, chartsPerRun: 5 } });
  assert.equal(r.items.filter((w) => w.symbol === 'LAB').length, 1, 'the resolved seed and its market twin are one project');
  assert.equal(r.items[0].origin, 'seed');

  const limited = historyPort({ charts: { aaa: 'LIMIT', bbb: chart() } });
  const s = await refreshWinners({ cached: null, seeds: [{ symbol: 'AAA', name: 'A', coingeckoId: 'aaa' }, { symbol: 'BBB', name: 'B', coingeckoId: 'bbb' }], assets: [], history: limited, nowMs: NOW, policy: { ...policy, chartsPerRun: 5 } });
  assert.equal(s.stats.stopped, 'RATE_LIMITED');
  assert.equal(limited.calls.length, 1, 'no second call after the limit');
});

test('population: today\'s universe plus every project seen in the window', () => {
  const n = trackedPopulation({ eligible: [{ key: 'a' }, { key: 'b' }], history: { b: { lastSeen: '2026-10-01T00:00:00Z' }, c: { lastSeen: '2026-06-01T00:00:00Z' }, d: { lastSeen: '2025-01-01T00:00:00Z' } }, nowMs: NOW, windowDays: 365 });
  assert.equal(n, 3);
});

test('the snapshot block: base rates, the list, and the top forecasts of verified projects only', async () => {
  const seeds = [{ symbol: 'AAA', name: 'A', coingeckoId: 'aaa' }, { symbol: 'DOC', name: 'D', coingeckoId: 'none', documented: { multiple: 500 } }];
  const { items } = await refreshWinners({ cached: null, seeds, assets: [], history: historyPort({ charts: { aaa: chart() } }), nowMs: NOW, policy });
  const winner = items.find((w) => w.symbol === 'AAA');
  winner.key = 'cg:aaa';
  const projects = [{ key: 'cg:aaa', vector: winner.vector }, { key: 'cg:x', vector: winner.vector }, { key: 'cg:y', vector: { ...winner.vector, size: 100, turnover: 0 } }];
  const fc = runForecast({ winners: items, projects, population: 600, policy });
  assert.equal(fc.rates[100].events, 2, 'confirmed + documented');
  const ranked = projects.map((p) => ({ asset: { key: p.key, symbol: p.key.slice(3).toUpperCase(), name: p.key, market: { marketCap: 1e7 } }, verdict: { stage: 1 } }));
  const report = forecastReport({ winners: items, rates: fc.rates, separation: fc.separation, byKey: fc.byKey, ranked, isValid: (k) => k !== 'cg:y', policy, projects: projects.length });
  assert.deepEqual(report.top.map((t) => t.key).sort(), ['cg:aaa', 'cg:x'], 'a project the gate did not verify is not in the top');
  assert.equal(report.baseRates[0].multiple, 100);
  assert.ok(report.winners.some((w) => w.symbol === 'DOC' && w.status === WINNER_STATUS.DOCUMENTED));
  assert.equal(report.top.find((t) => t.key === 'cg:aaa').pastRun.multiple, winner.multiple, 'a past winner is flagged as such');
  const view = forecastView(fc.byKey.get('cg:x'), fc.rates, pastRunsByKey(items).get('cg:x') ?? null);
  assert.ok(view.targets['100'].pct > 0 && view.targets['100'].pct < 100, 'published in percent');
  assert.equal(view.pastRun, null);
});
