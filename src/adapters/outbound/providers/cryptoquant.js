/**
 * CRYPTOQUANT adapter — free Basic key, with its limits stated instead of assumed.
 *
 * What the free Basic plan actually gives (verified against CryptoQuant's own plan page): market
 * data endpoints, **daily** window only, 30 days of history, 10 requests per minute, 10 000 credits
 * per month. On-chain exchange netflows — the metric this project would most like — are on the
 * Professional plan, which is a subscription, so they are **not** called here. Instead, exchange
 * flow is derived on-chain from the classified holder list (see src/domain/onchain/holder-flows.js),
 * which is free and auditable.
 *
 * This adapter therefore supplies market-regime context for the majors only (BTC/ETH), which is
 * exactly what the Basic plan covers, and reports NOT_CONFIGURED cleanly when no key is present.
 */
import { toNum } from '../../../domain/shared/math.js';
import { DAY_MS } from '../../../domain/shared/time.js';
import { disabled, mapResult, notConfigured } from './common.js';

const BASE = 'https://api.cryptoquant.com/v1';

/** Endpoints confirmed to be inside the Basic (free) plan: market data, daily window. */
export const FREE_ENDPOINTS = {
  btcPriceUsd: { path: '/btc/market-data/price-usd', window: 'day', asset: 'BTC' },
  btcOpenInterest: { path: '/btc/market-data/open-interest', window: 'day', asset: 'BTC' },
  btcFunding: { path: '/btc/market-data/funding-rates', window: 'day', asset: 'BTC' },
  ethPriceUsd: { path: '/eth/market-data/price-usd', window: 'day', asset: 'ETH' },
};

export function normalizeSeries(payload) {
  const rows = payload?.result?.data ?? payload?.data ?? [];
  const points = rows.map((r) => {
    const at = r.date ? Date.parse(r.date) : toNum(r.datetime) ?? null;
    const value = toNum(r.value ?? r.price_usd ?? r.open_interest ?? r.funding_rates ?? null);
    return { at: Number.isFinite(at) ? at : null, value };
  }).filter((p) => p.at !== null && p.value !== null).sort((a, b) => a.at - b.at);
  if (!points.length) throw new Error('serie goală');
  const last = points[points.length - 1];
  const ago = (days) => {
    const target = last.at - days * DAY_MS;
    let best = null;
    for (const p of points) if (p.at <= target && (!best || p.at > best.at)) best = p;
    return best;
  };
  const d7 = ago(7);
  const d30 = ago(30);
  return {
    latest: last.value,
    at: new Date(last.at).toISOString(),
    change7dPct: d7 && d7.value !== 0 ? ((last.value / d7.value) - 1) * 100 : null,
    change30dPct: d30 && d30.value !== 0 ? ((last.value / d30.value) - 1) * 100 : null,
    points: points.slice(-30).map((p) => ({ at: new Date(p.at).toISOString(), value: p.value })),
    window: 'day',
  };
}

export function createCryptoQuant({ http, cfg, apiKey = null }) {
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const opt = (endpoint, extra = {}) => ({
    provider: 'cryptoquant',
    endpoint,
    headers,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    minIntervalMs: cfg.minIntervalMs ?? 6500, // 10 requests/minute on the free plan
    maxCalls: cfg.maxCalls,
    breakerThreshold: 3,
    ...extra,
  });

  /**
   * @param {keyof typeof FREE_ENDPOINTS} key
   */
  const series = async (key, { days = 30 } = {}) => {
    const def = FREE_ENDPOINTS[key];
    if (!def) return notConfigured('cryptoquant', key, `endpoint necunoscut sau în afara planului gratuit: ${key}`);
    if (!cfg.enabled) return disabled('cryptoquant', def.path);
    if (!apiKey) {
      return notConfigured('cryptoquant', def.path,
        'lipsește CRYPTOQUANT_API_KEY — cheia Basic este gratuită (10 000 credite/lună, fereastră zilnică, 30 de zile de istoric). '
        + 'Netflow-urile on-chain cer planul Professional, deci nu sunt folosite: fluxurile către burse sunt derivate din lista clasificată de deținători.');
    }
    const url = `${BASE}${def.path}?window=${def.window}&limit=${Math.min(days, 30)}`;
    return mapResult(
      await http.getJson(url, opt(def.path, { units: 1, retries: 1, validate: (d) => d && (d.result || d.data) })),
      normalizeSeries,
    );
  };

  return {
    id: 'cryptoquant',
    keyed: Boolean(apiKey),
    series,
    freeEndpoints: Object.keys(FREE_ENDPOINTS),
    limits: { plan: 'Basic (gratuit)', creditsMonth: 10_000, requestsPerMinute: 10, historyDays: 30, window: 'zilnic' },
  };
}
