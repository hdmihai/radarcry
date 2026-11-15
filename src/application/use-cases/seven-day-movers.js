/**
 * Seven-day movers (Faza 5) — a separate ranking of the significant 7-day moves, filtered on
 * quality (turnover, up-volume share, validity) and weighted by health (isMoveHealthy, Faza 3)
 * and liquidity (volume24h). Purely additive: it reads what discovery already computed and never
 * touches the existing pipeline.
 *
 * Layer: application (selection and ordering are a business policy, not a domain computation —
 * same reasoning as discovery-view.js). No I/O: data in, array out.
 *
 * Field mapping, confirmed setter → reader on origin/main a162482:
 *   change7d    asset.market.change.d7     universe.js:119 (set) — PERCENT, e.g. 35 = +35 %
 *   volume24h   asset.market.volume24h     universe.js:112 (set) — USD
 *   marketCap   asset.market.marketCap     universe.js:111 (set) — USD
 *   turnover    asset.derived.turnover     universe.js:291 (set) — FRACTION, volume24h / marketCap
 *   upVolRatio  asset.features.daily.upVolRatio  discovery.js:338 → daily.js:50 — FRACTION 0..1
 *   validity    validity Map in run-scan.js:364 → { status ∈ VALID | PENDING | REJECTED }
 *               (it is NOT on the asset and the field is `status`, not `verdict`)
 *   health      r.thesis.isMoveHealthy.verdict (Faza 3) — `thesis` is a sibling of `asset` in the
 *               discoverAsset() result (discovery.js:396), not asset.thesis. Missing → UNKNOWN.
 *
 * Explicit decisions (briefing §6 Pas 1):
 *   · log = natural logarithm (Math.log). Only the ordering matters and ln/log10 differ by a
 *     constant factor, so the ranking is identical; ln keeps the score magnitude readable.
 *   · UNKNOWN is not bearish (Regula #6): boost 0.8, below FRAGILE's neutral 1.0 only because
 *     the move is unconfirmed, far above DISTRIBUTION's 0.5.
 *   · "top N după change7d" = after the quality filters, only the `topByChange` largest 7-day
 *     gains are scored (default 100); then the top `limit` by score are published.
 *   · PENDING validity passes (only REJECTED is excluded, as specified); a missing validity
 *     result is treated as PENDING, never as REJECTED.
 */
import { isNum, round } from '../../domain/shared/math.js';

export const HEALTH_BOOST = Object.freeze({
  HEALTHY: 1.3,
  FRAGILE: 1.0,
  DISTRIBUTION: 0.5,
  UNKNOWN: 0.8,
});

export const SEVEN_DAY_DEFAULTS = Object.freeze({
  limit: 30,
  minVolume24h: 500_000,
  minMarketCap: 1_000_000,
  maxMarketCap: 300_000_000,
  minTurnover: 0.05,
  minUpVolRatio: 0.55,
  topByChange: 100,
});

const healthOf = (r) => {
  const v = r?.thesis?.isMoveHealthy?.verdict;
  return Object.hasOwn(HEALTH_BOOST, v) ? v : 'UNKNOWN';
};

/** The facts one row is judged on, read from where the pipeline sets them. */
export function moverFacts(r, validityOf) {
  const a = r?.asset ?? {};
  const m = a.market ?? {};
  return {
    key: a.key ?? null,
    symbol: a.symbol ?? null,
    name: a.name ?? null,
    chain: a.primary?.chain ?? null,
    change7d: m.change?.d7 ?? null,
    volume24h: m.volume24h ?? null,
    marketCap: m.marketCap ?? null,
    turnover: a.derived?.turnover ?? null,
    upVolRatio: a.features?.daily?.upVolRatio ?? null,
    validity: validityOf(a.key)?.status ?? 'PENDING',
    healthVerdict: healthOf(r),
  };
}

/** Why a row is left out, or null when it qualifies. Missing numbers never qualify. */
export function exclusionOf(f, o) {
  if (f.validity === 'REJECTED') return 'REJECTED';
  if (!isNum(f.change7d) || f.change7d <= 0) return 'CHANGE7D';
  if (!isNum(f.volume24h) || f.volume24h < o.minVolume24h) return 'VOLUME';
  if (!isNum(f.marketCap) || f.marketCap < o.minMarketCap || f.marketCap > o.maxMarketCap) return 'MARKET_CAP';
  if (!isNum(f.turnover) || f.turnover < o.minTurnover) return 'TURNOVER';
  if (!isNum(f.upVolRatio) || f.upVolRatio < o.minUpVolRatio) return 'UP_VOL_RATIO';
  return null;
}

/**
 * @param {Array<{asset: object, thesis?: object}>} ranked discoverAsset() results
 * @param {object} [options]
 * @param {(key: string) => ({status: string} | undefined)} [options.validityOf]
 * @returns {Array<object>} top `limit` movers, rank 1..N
 */
export function sevenDayMovers(ranked, options = {}) {
  const { validityOf = () => undefined, ...rest } = options;
  const o = { ...SEVEN_DAY_DEFAULTS, ...rest };
  const qualified = [];
  for (const r of ranked ?? []) {
    const f = moverFacts(r, validityOf);
    if (exclusionOf(f, o) === null) qualified.push(f);
  }
  const byKey = (x, y) => String(x.key).localeCompare(String(y.key));
  return qualified
    .sort((x, y) => y.change7d - x.change7d || byKey(x, y))
    .slice(0, o.topByChange)
    .map((f) => {
      const healthBoost = HEALTH_BOOST[f.healthVerdict];
      return { ...f, healthBoost, score: f.change7d * Math.log(f.volume24h) * healthBoost };
    })
    .sort((x, y) => y.score - x.score || y.volume24h - x.volume24h || byKey(x, y))
    .slice(0, o.limit)
    .map(({ validity, ...f }, i) => ({
      symbol: f.symbol,
      key: f.key,
      name: f.name,
      chain: f.chain,
      change7d: round(f.change7d, 2),
      volume24h: f.volume24h,
      marketCap: f.marketCap,
      turnover: round(f.turnover, 4),
      upVolRatio: round(f.upVolRatio, 3),
      validity,
      healthVerdict: f.healthVerdict,
      healthBoost: f.healthBoost,
      score: round(f.score, 2),
      rank: i + 1,
    }));
}
