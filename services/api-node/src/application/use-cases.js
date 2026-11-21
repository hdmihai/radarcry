/**
 * Application use-cases. They orchestrate the ports; they hold no I/O of their own and no HTTP.
 * Imports: only ../domain and ../ports (checked by test/architecture.test.js).
 */
import { analystPayload, findCandidate, parseRadarQuery, parseSeriesInput, queryRadar, snapshotMeta, projectCandidate } from '../domain/radar.js';
import { invalid, notFound, unavailable } from '../domain/errors.js';
import { assertPort } from '../ports/index.js';

const CHAINS = new Set(['ethereum', 'bsc', 'base', 'arbitrum', 'polygon', 'optimism', 'avalanche']);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * @param {{snapshots: import('../ports/index.js').SnapshotPort, analyst: import('../ports/index.js').AnalystPort, cache: import('../ports/index.js').CachePort, clock: import('../ports/index.js').ClockPort, universeMax?: number}} deps
 */
export function createUseCases({ snapshots, analyst, cache, clock, universeMax = 150, runners = null, stepMomentum = null }) {
  assertPort('SnapshotPort', snapshots);
  assertPort('AnalystPort', analyst);
  assertPort('CachePort', cache);
  assertPort('ClockPort', clock);

  async function snapshot() {
    try {
      return await snapshots.load();
    } catch (err) {
      throw unavailable('snapshot-ul radarului nu este disponibil', { reason: String(err?.message ?? err) });
    }
  }

  return {
    async health() {
      const started = clock.now();
      let snap = null;
      let snapError = null;
      try {
        snap = await snapshots.load();
      } catch (err) {
        snapError = String(err?.message ?? err);
      }
      let python;
      try {
        python = await analyst.health();
      } catch (err) {
        python = { ok: false, error: String(err?.message ?? err) };
      }
      const ok = Boolean(snap) && Boolean(python?.ok);
      return {
        status: ok ? 'ok' : snap ? 'degraded' : 'down',
        snapshot: snap ? { ...snapshotMeta(snap), source: snapshots.info().source } : { error: snapError, source: snapshots.info().source },
        analyst: python,
        tookMs: clock.now() - started,
      };
    },

    async listRadar(rawQuery) {
      const query = parseRadarQuery(rawQuery);
      const snap = await snapshot();
      return { meta: snapshotMeta(snap), query, ...queryRadar(snap, query) };
    },

    async getAsset(key) {
      const snap = await snapshot();
      const c = findCandidate(snap, key);
      if (!c) throw notFound(`proiectul „${key}” nu este în snapshot-ul curent`);
      return { meta: snapshotMeta(snap), asset: projectCandidate(c), dossier: c };
    },

    /** Quant analysis of one asset by the Python service, cached per snapshot run. */
    async analyzeAsset(key, { refresh = false } = {}) {
      const snap = await snapshot();
      const c = findCandidate(snap, key);
      if (!c) throw notFound(`proiectul „${key}” nu este în snapshot-ul curent`);
      const runId = snap.meta?.runId ?? 'unknown';
      const cacheKey = `asset:${runId}:${c.key}`;
      if (!refresh) {
        const hit = cache.get(cacheKey);
        if (hit) return { ...hit, cached: true };
      }
      const analysis = await analyst.analyzeAsset(analystPayload(c));
      const result = { key: c.key, symbol: c.symbol, runId, analyzedAt: new Date(clock.now()).toISOString(), analysis, cached: false };
      cache.set(cacheKey, result);
      return result;
    },

    /** Cross-sectional analysis over the radar (or a filtered slice of it). */
    async analyzeUniverse(rawQuery = {}) {
      const query = parseRadarQuery({ ...rawQuery, limit: rawQuery.limit ?? universeMax });
      const snap = await snapshot();
      const keys = new Set(queryRadar(snap, { ...query, offset: 0, limit: Math.min(query.limit, universeMax) }).items.filter((x) => x.analysable).map((x) => x.key));
      const payloads = snap.candidates.filter((c) => keys.has(c.key)).map(analystPayload);
      if (payloads.length < 3) throw invalid('analiza transversală cere cel puțin 3 proiecte cu serii de preț', { found: payloads.length });
      const runId = snap.meta?.runId ?? 'unknown';
      const cacheKey = `universe:${runId}:${[...keys].sort().join(',')}`;
      const hit = cache.get(cacheKey);
      if (hit) return { ...hit, cached: true };
      const analysis = await analyst.analyzeUniverse(payloads);
      const result = { runId, assets: payloads.length, analyzedAt: new Date(clock.now()).toISOString(), analysis, cached: false };
      cache.set(cacheKey, result);
      return result;
    },

    /** Potențiali runneri pe 7 zile (data/runners.json, produs de modulul Python), filtrabili. */
    async listRunners(q = {}) {
      if (!runners) throw unavailable('lista de runneri nu este configurată');
      let doc;
      try {
        doc = await runners.load();
      } catch (err) {
        throw unavailable('data/runners.json nu este disponibil încă', { reason: String(err?.message ?? err) });
      }
      const tiers = q.tier ? new Set(String(q.tier).toUpperCase().split(',')) : null;
      const stages = q.stage ? new Set(String(q.stage).toUpperCase().split(',')) : null;
      const minProb = Number.isFinite(Number(q.minProbability)) ? Number(q.minProbability) : 0;
      const limit = Math.max(1, Math.min(100, Number.parseInt(q.limit ?? '40', 10) || 40));
      const full = q.full === '1' || q.full === 'true';
      const items = doc.candidates
        .filter((c) => (!tiers || tiers.has(c.tier)) && (!stages || stages.has(c.stage)) && (c.probability ?? 0) >= minProb)
        .slice(0, limit)
        .map((c) => (full ? c : { ...c, factors: undefined }));
      const meta = { generatedAt: doc.generatedAt, horizonDays: doc.horizonDays, target: doc.target, metrics: doc.metrics, total: doc.candidates.length, returned: items.length };
      return full ? { meta, items, factors: doc.factors, rules: doc.rules, references: doc.references, events: doc.events } : { meta, items, rules: doc.rules };
    },

    /** Momentum în trepte (data/step-momentum.json). Implicit doar semnalele, nu tot universul evaluat. */
    async listStepMomentum(q = {}) {
      if (!stepMomentum) throw unavailable('modulul step-momentum nu este configurat');
      let doc;
      try {
        doc = await stepMomentum.load();
      } catch (err) {
        throw unavailable('data/step-momentum.json nu este disponibil încă', { reason: String(err?.message ?? err) });
      }
      const limit = Math.max(1, Math.min(40, Number.parseInt(q.limit ?? '40', 10) || 40));
      const items = (doc.stepMomentum || []).filter((row) => row && row.isStepMomentum !== false).slice(0, limit);
      return {
        meta: {
          generatedAt: doc.generatedAt,
          method: doc.method ?? 'rules',
          stepMomentumMeta: doc.stepMomentumMeta ?? null,
          total: (doc.stepMomentum || []).length,
          returned: items.length,
        },
        items,
        rules: doc.rules ?? [],
        notes: doc.notes ?? [],
      };
    },

    async analyzeSeries(body) {
      return analyst.analyzeSeries(parseSeriesInput(body));
    },

    async onchain(chain, address) {
      const ch = String(chain ?? '').toLowerCase();
      if (!CHAINS.has(ch)) throw invalid(`lanț nesuportat „${chain}”`, { allowed: [...CHAINS] });
      if (!ADDRESS.test(String(address ?? ''))) throw invalid('adresa trebuie să fie un contract EVM (0x + 40 caractere hex)');
      const cacheKey = `onchain:${ch}:${address.toLowerCase()}`;
      const hit = cache.get(cacheKey);
      if (hit) return { ...hit, cached: true };
      const facts = await analyst.onchain(ch, address);
      const result = { chain: ch, address, facts, cached: false };
      cache.set(cacheKey, result);
      return result;
    },
  };
}
