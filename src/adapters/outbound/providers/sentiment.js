/**
 * SENTIMENT adapter — alternative.me Fear & Greed Index.
 *
 * Public, keyless, documented, with history. This replaces the sentiment endpoints that live behind
 * paid aggregator plans (CoinMarketCap's Fear & Greed and Altcoin Season endpoints are not on the
 * free Basic plan, so they are not called anywhere in this project; the altseason index is computed
 * locally from our own top-100 instead).
 */
import { toNum } from '../../../domain/shared/math.js';
import { disabled, mapResult } from './common.js';

export const FNG_ATTRIBUTION = 'Fear & Greed Index: alternative.me';

const LABEL_RO = {
  'extreme fear': 'frică extremă',
  fear: 'frică',
  neutral: 'neutru',
  greed: 'lăcomie',
  'extreme greed': 'lăcomie extremă',
};

export function normalizeFng(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const points = rows.map((r) => {
    const ts = toNum(r.timestamp);
    return {
      value: toNum(r.value),
      classification: r.value_classification ?? null,
      label: LABEL_RO[String(r.value_classification ?? '').toLowerCase()] ?? r.value_classification ?? null,
      at: ts !== null ? new Date((ts < 1e11 ? ts * 1000 : ts)) .toISOString() : null,
      atMs: ts !== null ? (ts < 1e11 ? ts * 1000 : ts) : null,
    };
  }).filter((p) => p.value !== null);
  if (!points.length) throw new Error('niciun punct valid în răspuns');
  const latest = points[0];
  const sorted = [...points].sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0));
  const ago = (days) => sorted.find((p) => p.atMs && latest.atMs && latest.atMs - p.atMs >= days * 86_400_000 * 0.9) ?? null;
  const w = ago(7);
  const m = ago(30);
  return {
    value: latest.value,
    classification: latest.classification,
    label: latest.label,
    at: latest.at,
    change7d: w ? latest.value - w.value : null,
    change30d: m ? latest.value - m.value : null,
    history: sorted.slice(0, 90).map((p) => ({ at: p.at, value: p.value })),
    attribution: FNG_ATTRIBUTION,
  };
}

export function createSentiment({ http, cfg }) {
  const opt = (endpoint, extra = {}) => ({
    provider: 'alternative_me',
    endpoint,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    minIntervalMs: cfg.minIntervalMs,
    maxCalls: cfg.maxCalls,
    breakerThreshold: 3,
    ...extra,
  });

  const fearGreed = async (limit = 90) => {
    if (!cfg.enabled) return disabled('alternative_me', '/fng');
    return mapResult(
      await http.getJson(`https://api.alternative.me/fng/?limit=${limit}&format=json`, opt('/fng', { validate: (d) => Array.isArray(d?.data), hash: true })),
      normalizeFng,
    );
  };

  return { id: 'alternative_me', fearGreed, attribution: FNG_ATTRIBUTION };
}
