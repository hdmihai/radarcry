/**
 * Radar read-model — pure functions over the published contract (data/latest.json, schema 4.x).
 *
 * The API never recomputes the research: the scanner (src/ at the repo root) owns the scores. This
 * module only projects, filters, sorts and paginates what the scanner published, and builds the
 * exact payload the Python analyst needs. Zero I/O, zero clock, zero randomness — the same rule as
 * the scanner's own domain, checked by test/architecture.test.js.
 */
import { invalid } from './errors.js';

export const LIMIT_MAX = 200;
export const LIMIT_DEFAULT = 50;

const SORTS = {
  score: (c) => c.score?.cri,
  risk: (c) => c.risk?.score,
  marketCap: (c) => c.market?.marketCap,
  volume: (c) => c.market?.volume24h,
  change7d: (c) => c.market?.change?.d7,
  rank: (c) => c.rank?.coingecko ?? c.rank?.cmc,
  forecast20: (c) => c.forecast?.targets?.['20']?.pct,
  forecast100: (c) => c.forecast?.targets?.['100']?.pct,
};
export const SORT_FIELDS = Object.freeze(Object.keys(SORTS));

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseNumber(raw, name, { min = -Infinity, max = Infinity } = {}) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw invalid(`parametrul „${name}” trebuie să fie un număr între ${min} și ${max}`, { [name]: raw });
  return n;
}

function parseList(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const items = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean);
  return items.length ? items : null;
}

/**
 * Validate and normalise a raw query object (e.g. Express `req.query`).
 * @returns {{q:string|null,stage:string[]|null,signal:string[]|null,validity:string[]|null,chain:string[]|null,minScore:number|null,maxRisk:number|null,deepOnly:boolean,sort:string,order:'asc'|'desc',limit:number,offset:number}}
 */
export function parseRadarQuery(raw = {}) {
  const sort = raw.sort ? String(raw.sort) : 'score';
  if (!SORTS[sort]) throw invalid(`sortare necunoscută „${sort}”`, { allowed: SORT_FIELDS });
  const order = raw.order ? String(raw.order).toLowerCase() : 'desc';
  if (order !== 'asc' && order !== 'desc') throw invalid('parametrul „order” acceptă doar asc sau desc');
  const limit = parseNumber(raw.limit, 'limit', { min: 1, max: LIMIT_MAX }) ?? LIMIT_DEFAULT;
  const offset = parseNumber(raw.offset, 'offset', { min: 0, max: 1e6 }) ?? 0;
  const q = raw.q ? String(raw.q).trim().toLowerCase().slice(0, 64) : null;
  const chains = parseList(raw.chain);
  return {
    q: q || null,
    stage: parseList(raw.stage),
    signal: parseList(raw.signal),
    validity: parseList(raw.validity),
    chain: chains ? chains.map((c) => c.toLowerCase()) : null,
    minScore: parseNumber(raw.minScore, 'minScore', { min: 0, max: 100 }),
    maxRisk: parseNumber(raw.maxRisk, 'maxRisk', { min: 0, max: 100 }),
    deepOnly: raw.deep === 'true' || raw.deep === '1' || raw.deep === true,
    sort,
    order,
    limit: Math.trunc(limit),
    offset: Math.trunc(offset),
  };
}

/** Compact, stable projection of one candidate: what a list view or a bot needs. */
export function projectCandidate(c) {
  return {
    key: c.key,
    symbol: c.symbol,
    name: c.name,
    image: c.image ?? null,
    depth: c.depth ?? null,
    chain: c.chain ?? null,
    contract: c.contract ?? null,
    rank: c.rank?.coingecko ?? c.rank?.cmc ?? null,
    price: num(c.market?.price),
    marketCap: num(c.market?.marketCap),
    fdv: num(c.market?.fdv),
    volume24h: num(c.market?.volume24h),
    change: {
      h24: num(c.market?.change?.h24),
      d7: num(c.market?.change?.d7),
      d30: num(c.market?.change?.d30),
    },
    score: num(c.score?.cri),
    tier: c.score?.tier ?? null,
    confidence: num(c.score?.confidence),
    stage: c.stage ?? null,
    signal: c.signal?.type ?? null,
    risk: { score: num(c.risk?.score), grade: c.risk?.grade ?? null, critical: Boolean(c.risk?.critical) },
    validity: c.validity?.status ?? null,
    forecast: {
      x20: num(c.forecast?.targets?.['20']?.pct),
      x100: num(c.forecast?.targets?.['100']?.pct),
    },
    analysable: hasSeries(c),
  };
}

const hasSeries = (c) => (Array.isArray(c.chart?.d1) && c.chart.d1.length >= 20) || (Array.isArray(c.chart?.h4) && c.chart.h4.length >= 20) || (Array.isArray(c.sparkline) && c.sparkline.length >= 20);

function matches(c, f) {
  if (f.q) {
    const hay = `${c.symbol ?? ''} ${c.name ?? ''} ${c.key ?? ''} ${c.contract ?? ''}`.toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  if (f.stage && !f.stage.includes(String(c.stage ?? '').toUpperCase())) return false;
  if (f.signal && !f.signal.includes(String(c.signal?.type ?? '').toUpperCase())) return false;
  if (f.validity && !f.validity.includes(String(c.validity?.status ?? '').toUpperCase())) return false;
  if (f.chain && !f.chain.includes(String(c.chain ?? '').toLowerCase())) return false;
  if (f.minScore !== null && !(num(c.score?.cri) >= f.minScore)) return false;
  if (f.maxRisk !== null && !(num(c.risk?.score) !== null && c.risk.score <= f.maxRisk)) return false;
  if (f.deepOnly && c.depth !== 'deep') return false;
  return true;
}

/**
 * Filter + sort + paginate. Missing values always sort last (unknown is not bearish, nor bullish —
 * the project's own rule).
 */
export function queryRadar(snapshot, query) {
  const all = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
  const pick = SORTS[query.sort];
  const dir = query.order === 'asc' ? 1 : -1;
  const filtered = all.filter((c) => matches(c, query));
  const sorted = filtered
    .map((c, i) => ({ c, i, v: num(pick(c)) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      return (a.v - b.v) * dir || a.i - b.i;
    })
    .map((x) => x.c);
  const page = sorted.slice(query.offset, query.offset + query.limit);
  return {
    total: filtered.length,
    offset: query.offset,
    limit: query.limit,
    items: page.map(projectCandidate),
  };
}

/** Snapshot metadata the API exposes on every list response. */
export function snapshotMeta(snapshot) {
  const m = snapshot?.meta ?? {};
  return {
    schemaVersion: snapshot?.schemaVersion ?? null,
    runId: m.runId ?? null,
    generatedAt: m.generatedAt ?? null,
    mode: m.mode ?? null,
    disclaimer: m.disclaimer ?? null,
    candidates: Array.isArray(snapshot?.candidates) ? snapshot.candidates.length : 0,
    health: snapshot?.health?.overall ?? null,
    regime: snapshot?.market?.regime?.label ?? snapshot?.market?.regime?.state ?? null,
  };
}

export function findCandidate(snapshot, key) {
  const k = String(key ?? '');
  const list = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
  return list.find((c) => c.key === k) ?? list.find((c) => String(c.symbol ?? '').toUpperCase() === k.toUpperCase()) ?? null;
}

/**
 * The payload sent to the Python analyst. Only numbers and identifiers cross the boundary — the
 * analyst does not need (and must not depend on) the rest of the contract.
 * Price rows are [tSec, close] or [tSec, open, high, low, close, volume].
 */
export function analystPayload(c) {
  // Two row shapes exist in the contract: [t, close] (d1 from the venue) and [t, o, h, l, c, v] (h4).
  const ok = (x) => typeof x === 'number' && Number.isFinite(x);
  const ohlcv = (rows) => (Array.isArray(rows) ? rows.filter((r) => Array.isArray(r) && (r.length === 2 || r.length >= 5) && r.every(ok)) : []);
  return {
    key: c.key,
    symbol: c.symbol,
    chain: c.chain ?? null,
    contract: c.contract ?? null,
    market: {
      price: num(c.market?.price),
      marketCap: num(c.market?.marketCap),
      fdv: num(c.market?.fdv),
      volume24h: num(c.market?.volume24h),
    },
    series: {
      d1: ohlcv(c.chart?.d1),
      h4: ohlcv(c.chart?.h4),
      sparkline: Array.isArray(c.sparkline) ? c.sparkline.filter((x) => typeof x === 'number' && Number.isFinite(x)) : [],
    },
    scoreHistory: Array.isArray(c.history) ? c.history.filter((h) => Array.isArray(h) && typeof h[1] === 'number').map((h) => ({ at: h[0], score: h[1], stage: h[2] ?? null, price: num(h[3]) })) : [],
  };
}

/** A numeric series for /analysis/series: validated here so the bridge only ever forwards clean data. */
export function parseSeriesInput(body) {
  const closes = body?.closes;
  if (!Array.isArray(closes) || closes.length < 10 || closes.length > 5000) throw invalid('„closes” trebuie să fie o listă de 10…5000 de prețuri');
  if (!closes.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) throw invalid('„closes” acceptă doar prețuri pozitive');
  const volumes = body?.volumes;
  if (volumes !== undefined && (!Array.isArray(volumes) || volumes.length !== closes.length || !volumes.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0))) {
    throw invalid('„volumes” trebuie să aibă aceeași lungime ca „closes” și valori ≥ 0');
  }
  const periodsPerYear = body?.periodsPerYear ?? 365;
  if (typeof periodsPerYear !== 'number' || periodsPerYear < 1 || periodsPerYear > 365 * 24 * 60) throw invalid('„periodsPerYear” invalid');
  return { closes, volumes: volumes ?? null, periodsPerYear, symbol: body?.symbol ? String(body.symbol).slice(0, 32) : null };
}
