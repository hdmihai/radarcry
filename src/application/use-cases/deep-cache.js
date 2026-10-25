/**
 * The rolling research cache — how a free-plan budget reaches the whole top 1000.
 *
 * Some deep facts can be read for every eligible project on every run: candles, DEX liquidity,
 * Alpha holders and liquidity, derivatives. They come from bulk or high-limit endpoints. Others come
 * from free plans that answer a few dozen calls per run at most (GoPlus, CoinGecko's coin detail,
 * GeckoTerminal, GitHub, YouTube). Spending those calls on the same sixty projects every run leaves
 * the other nine hundred permanently unmeasured. This module spreads them instead.
 *
 * Two kinds of fact, two rules — and the difference is what keeps the research point-in-time:
 *
 *  · STATIC facts (contract security flags, owner and creator, LP lock, the coin's categories and
 *    repository) change rarely. They are cached with a TTL and *carried* between refreshes, each
 *    with the time it was read. Carried facts feed the risk engine and the classification only.
 *
 *  · MEASUREMENTS (holder counts, the raw top-10 share, commits, mentions, daily charts) are never
 *    cached. Each run refreshes a rotating slice of the universe — the research priority first, then
 *    the projects measured longest ago — and a project not refreshed this run reports the metric as
 *    unmeasured. Carrying a measurement forward would write the same reading into the project's
 *    history twice, flatten its norm and manufacture changes against it.
 *
 * Pure functions: time arrives as `nowMs`, the cache is a plain object owned by the state branch.
 */

const HOUR = 3_600_000;

export const DEFAULT_TTL_HOURS = Object.freeze({ security: 168, detail: 336 });

/** Static part of a GoPlus security payload: what the contract *is*, not how it is held today. */
export function staticSecurity(raw) {
  if (!raw || typeof raw !== 'object' || !raw.security) return null;
  return {
    security: raw.security,
    creatorAddress: raw.creatorAddress ?? null,
    ownerAddress: raw.ownerAddress ?? null,
    lpLockedPct: raw.lpLockedPct ?? null,
    // The top-10 list stays for the concentration *risk* (who the large holders are); the holder
    // count and the raw top-10 share are measurements and are dropped.
    topHolders: Array.isArray(raw.topHolders) ? raw.topHolders : null,
    top10EffectivePct: raw.top10EffectivePct ?? null,
  };
}

/** Static part of a CoinGecko coin detail: identity, sector and links — not watchlists or commits. */
export function staticDetail(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    id: d.id ?? null,
    categories: Array.isArray(d.categories) ? d.categories : [],
    genesisDate: d.genesisDate ?? null,
    homepage: d.homepage ?? null,
    twitter: d.twitter ?? null,
    telegram: d.telegram ?? null,
    github: d.github ?? null,
    description: d.description ?? null,
  };
}

const STATIC = { security: staticSecurity, detail: staticDetail };

/** A cached static fact if it is still inside its TTL, else null. */
export function cachedFact(cache, key, kind, { nowMs, ttlHours = DEFAULT_TTL_HOURS }) {
  const e = cache?.[key]?.[kind];
  if (!e || !Number.isFinite(e.at) || e.data === null || e.data === undefined) return null;
  const ttl = (ttlHours[kind] ?? DEFAULT_TTL_HOURS[kind] ?? 0) * HOUR;
  if (nowMs - e.at > ttl || e.at > nowMs) return null; // expired, or written by a clock ahead of ours
  return { at: e.at, data: e.data };
}

/** Store the static part of a fact read this run. */
export function storeFact(cache, key, kind, raw, nowMs) {
  const data = STATIC[kind] ? STATIC[kind](raw) : null;
  if (data === null) return;
  cache[key] ??= {};
  cache[key][kind] = { at: nowMs, data };
}

/** When a measurement was last refreshed for this project (ms), or null if never. */
export const lastMeasured = (cache, key, kind) => {
  const t = cache?.[key]?.measured?.[kind];
  return Number.isFinite(t) ? t : null;
};

export function markMeasured(cache, key, kind, nowMs) {
  cache[key] ??= {};
  cache[key].measured ??= {};
  cache[key].measured[kind] = nowMs;
}

/**
 * Order the candidates of a budgeted refresh. The research priority comes first, in its own order —
 * those are the projects the run is about. Everything else follows by staleness: never measured
 * first, then the reading that is oldest. `minRefreshHours` keeps a priority project that was just
 * measured (a re-run an hour later) from taking a slot the rest of the universe needs.
 *
 * @param {any[]} list candidates, already filtered to those the task can serve
 * @param {{priority:Set<string>, last:(asset:any)=>number|null, nowMs:number, minRefreshHours?:number}} o
 */
export function rotationOrder(list, { priority, last, nowMs, minRefreshHours = 3 }) {
  const fresh = (a) => {
    const t = last(a);
    return Number.isFinite(t) && nowMs - t < minRefreshHours * HOUR;
  };
  const first = list.filter((a) => priority.has(a.key) && !fresh(a));
  const rest = list.filter((a) => !priority.has(a.key) && !fresh(a))
    .map((a, i) => ({ a, i, t: last(a) }))
    .sort((x, y) => (x.t ?? -Infinity) - (y.t ?? -Infinity) || x.i - y.i)
    .map((x) => x.a);
  return [...first, ...rest];
}

/**
 * Drop entries of projects that left the universe long ago, so the cache stays bounded by the
 * universe rather than growing with every token that ever passed through it.
 */
export function pruneCache(cache, { keepKeys, nowMs, maxAgeDays = 21 }) {
  const out = {};
  for (const [key, entry] of Object.entries(cache ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    const times = [entry.security?.at, entry.detail?.at, ...Object.values(entry.measured ?? {})].filter(Number.isFinite);
    const newest = times.length ? Math.max(...times) : null;
    if (keepKeys.has(key) || (newest !== null && nowMs - newest <= maxAgeDays * 86_400_000)) out[key] = entry;
  }
  return out;
}

/** Coverage of the rolling layer, for the health block and the dashboard. */
export function cacheCoverage(cache, keys, { nowMs, ttlHours = DEFAULT_TTL_HOURS, windowHours = 72 }) {
  const n = keys.length;
  const count = (fn) => keys.filter(fn).length;
  const within = (kind) => (k) => {
    const t = lastMeasured(cache, k, kind);
    return t !== null && nowMs - t <= windowHours * HOUR;
  };
  return {
    projects: n,
    security: count((k) => cachedFact(cache, k, 'security', { nowMs, ttlHours }) !== null),
    detail: count((k) => cachedFact(cache, k, 'detail', { nowMs, ttlHours }) !== null),
    holdersInfo: count(within('holdersInfo')),
    dev: count(within('dev')),
    mentions: count(within('mentions')),
    windowHours,
    ttlHours: { ...DEFAULT_TTL_HOURS, ...ttlHours },
  };
}
