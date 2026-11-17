/**
 * Snapshot loading + read-model indexes. The dashboard never recomputes research — it renders the
 * contract published by the engine (data/latest.json) and only derives presentation helpers.
 */
export class SnapshotError extends Error {
  constructor(kind, detail) {
    super(detail || kind);
    this.kind = kind;
  }
}

export async function loadSnapshot(url = 'data/latest.json') {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    throw new SnapshotError('NETWORK', String(err?.message ?? err));
  }
  if (res.status === 404) throw new SnapshotError('MISSING', 'data/latest.json nu există încă');
  if (!res.ok) throw new SnapshotError('HTTP', `HTTP ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new SnapshotError('INVALID', 'data/latest.json nu este JSON valid');
  }
  if (!data || !Array.isArray(data.candidates) || !data.meta) throw new SnapshotError('INVALID', 'contract neașteptat (lipsesc meta/candidates)');
  return indexSnapshot(data);
}

export function indexSnapshot(s) {
  const byKey = new Map(s.candidates.map((c) => [c.key, c]));
  const refs = s.references ?? [];
  const refBySymbol = new Map(refs.map((r) => [r.symbol, r]));
  // The similarity engine's own feature list and sigma live under methodology.similarity in v4.
  const features = s.methodology?.similarity?.features ?? s.methodology?.features ?? [];
  const sigma = s.methodology?.thresholds?.similarity?.sigma ?? 22;
  const generatedMs = Date.parse(s.meta.generatedAt);
  // Discovery rows are indexed too, so a project found by the v4 engine can be opened from any list
  // even when the legacy candidate list no longer carries it.
  const discoveryByKey = new Map((s.discovery?.rows ?? []).map((r) => [r.key, r]));
  const futuresByKey = new Map((s.futures?.rows ?? []).map((r) => [r.key, r]));
  return { ...s, byKey, discoveryByKey, futuresByKey, refBySymbol, features, sigma, generatedMs };
}

/** Per-feature agreement between a candidate fingerprint and a reference vector (0..1 or null). */
export function agreement(candVec, refVec, key, sigma) {
  const a = candVec?.[key];
  const b = refVec?.[key];
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  const d = a - b;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

export const ui = {
  filters: {
    q: '',
    signal: 'ALL',
    stage: 'ALL',
    analog: 'ALL',
    chain: 'ALL',
    grade: 'ALL',
    deepOnly: false,
    hideLate: false,
  },
  sort: { key: 'rank', dir: 'desc' },
  catalystFilter: { polarity: 'ALL', type: 'ALL' },
};
