/**
 * QUOTA LEDGER — keeps every free plan inside its published limits.
 *
 * The project is built only on public APIs and free accounts (no subscription of any kind), so the
 * binding constraint is not money but the monthly / daily allowance of each free plan. This module
 * is the pure-domain accounting of those allowances: it rolls the ledger over period boundaries,
 * records consumed units, projects the burn rate to the end of the period and decides when to pause
 * a provider *before* the free plan is exhausted (at 95 % of the limit), so a run never degrades
 * into paid territory or into a hard block mid-scan.
 *
 * Units are provider-specific and come from the published pricing of the free tier:
 *   · CoinGecko Demo  — 1 unit = 1 call   (10 000 calls / month)
 *   · CoinMarketCap   — 1 unit = 1 credit (10 000 credits / month, 1 credit per 200 coins)
 *   · CryptoQuant     — 1 unit = 1 credit (10 000 credits / month)
 *   · NodeReal        — 1 unit = 1 CU     (10 000 000 CU / month, nr_getTokenHolders = 300 CU)
 *   · GoPlus          — 1 unit = 1 CU     (150 000 CU / month and 30 000 CU / day)
 *   · YouTube Data    — 1 unit = 1 quota unit (10 000 / day, a search costs 100)
 */
import { isNum } from '../shared/math.js';
import { isoDay } from '../shared/time.js';

/** Pause a provider once it has consumed this share of any of its limits. */
export const PAUSE_AT = 0.95;

/** Keys that identify the current month and day of a timestamp (UTC, like every provider's reset). */
export function periodKeys(nowMs) {
  const day = isoDay(nowMs);
  return { month: day.slice(0, 7), day };
}

const emptyBucket = () => ({ month: null, day: null, monthUnits: 0, dayUnits: 0, monthCalls: 0, dayCalls: 0 });

/**
 * Roll a stored ledger onto the current period: counters of an expired month / day reset to zero,
 * which is exactly how the providers themselves reset. Pure — returns a new ledger.
 * @param {Record<string, any>|null|undefined} ledger
 * @param {number} nowMs
 */
export function rollLedger(ledger, nowMs) {
  const { month, day } = periodKeys(nowMs);
  const out = {};
  for (const [provider, raw] of Object.entries(ledger ?? {})) {
    const b = { ...emptyBucket(), ...raw };
    const sameMonth = b.month === month;
    const sameDay = b.day === day;
    out[provider] = {
      month,
      day,
      monthUnits: sameMonth ? b.monthUnits ?? 0 : 0,
      monthCalls: sameMonth ? b.monthCalls ?? 0 : 0,
      dayUnits: sameDay ? b.dayUnits ?? 0 : 0,
      dayCalls: sameDay ? b.dayCalls ?? 0 : 0,
      // First day of the month that this ledger has been observing (for honest burn-rate maths).
      since: sameMonth ? (b.since ?? day) : day,
    };
  }
  return out;
}

/** Record consumed units for a provider. Pure — returns a new ledger. */
export function recordUsage(ledger, provider, units, nowMs, calls = 1) {
  const rolled = rollLedger(ledger, nowMs);
  const { month, day } = periodKeys(nowMs);
  const b = rolled[provider] ?? { ...emptyBucket(), month, day, since: day };
  rolled[provider] = {
    ...b,
    month,
    day,
    monthUnits: (b.monthUnits ?? 0) + (isNum(units) ? units : 0),
    dayUnits: (b.dayUnits ?? 0) + (isNum(units) ? units : 0),
    monthCalls: (b.monthCalls ?? 0) + calls,
    dayCalls: (b.dayCalls ?? 0) + calls,
    since: b.since ?? day,
  };
  return rolled;
}

const daysInMonth = (nowMs) => {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};

/**
 * Decide, per provider, whether the next call is allowed and how much headroom is left.
 *
 * @param {Record<string, any>} ledger  rolled ledger
 * @param {Record<string, {month?:number, day?:number, perMinute?:number, label?:string, keyed?:boolean}>} limits
 * @param {number} nowMs
 * @param {{keyed?: Record<string, boolean>}} [opts]  which providers actually have a key this run
 * @returns {{providers:Record<string, any>, paused:string[], warnings:string[]}}
 */
export function quotaPlan(ledger, limits, nowMs, { keyed = {} } = {}) {
  const rolled = rollLedger(ledger, nowMs);
  const dim = daysInMonth(nowMs);
  const dayOfMonth = new Date(nowMs).getUTCDate();
  const providers = {};
  const paused = [];
  const warnings = [];

  for (const [provider, lim] of Object.entries(limits ?? {})) {
    const b = rolled[provider] ?? { ...emptyBucket(), since: isoDay(nowMs) };
    // A provider that needs a key but has none consumes nothing: it is simply not called.
    const configured = lim.keyed ? keyed[provider] === true : true;
    const monthShare = isNum(lim.month) && lim.month > 0 ? (b.monthUnits ?? 0) / lim.month : null;
    const dayShare = isNum(lim.day) && lim.day > 0 ? (b.dayUnits ?? 0) / lim.day : null;
    const share = Math.max(monthShare ?? 0, dayShare ?? 0);

    // Honest burn rate: units per elapsed day this month, projected to the whole month.
    const elapsed = Math.max(1, dayOfMonth);
    const perDay = (b.monthUnits ?? 0) / elapsed;
    const projected = isNum(lim.month) ? perDay * dim : null;
    const projectedShare = isNum(projected) && isNum(lim.month) && lim.month > 0 ? projected / lim.month : null;

    const pause = configured && share >= PAUSE_AT;
    const entry = {
      provider,
      label: lim.label ?? provider,
      configured,
      limitMonth: lim.month ?? null,
      limitDay: lim.day ?? null,
      usedMonth: b.monthUnits ?? 0,
      usedDay: b.dayUnits ?? 0,
      callsMonth: b.monthCalls ?? 0,
      callsDay: b.dayCalls ?? 0,
      shareMonth: monthShare,
      shareDay: dayShare,
      remainingMonth: isNum(lim.month) ? Math.max(0, lim.month - (b.monthUnits ?? 0)) : null,
      remainingDay: isNum(lim.day) ? Math.max(0, lim.day - (b.dayUnits ?? 0)) : null,
      projectedMonth: isNum(projected) ? Math.round(projected) : null,
      projectedShare,
      paused: pause,
      reason: pause
        ? `${lim.label ?? provider}: ${Math.round(share * 100)}% din cuota gratuită consumată — pauză preventivă până la resetare`
        : null,
    };
    providers[provider] = entry;
    if (pause) paused.push(provider);
    else if (configured && share >= 0.8) warnings.push(`${entry.label}: ${Math.round(share * 100)}% din cuota gratuită consumată`);
    else if (configured && isNum(projectedShare) && projectedShare > 1.1 && (b.monthUnits ?? 0) > 0) {
      warnings.push(`${entry.label}: ritmul actual ar depăși cuota lunară (~${Math.round(projectedShare * 100)}%) — reduc cadența`);
    }
  }
  return { providers, paused, warnings };
}

/**
 * Build the mutable gate handed to the HTTP client: it refuses a call that would push a provider
 * past PAUSE_AT and keeps a live tally of this run's consumption so the snapshot can report it.
 */
export function createLedgerGate(plan, { limits = {}, ledger = {}, nowMs } = {}) {
  // nowMs is required rather than defaulted: the ledger rolls day and month buckets against it, and
  // a gate that silently read the wall clock would make the same stored ledger produce different
  // results on a replay. The composition root passes clock.now(); nothing else builds a gate.
  if (!isNum(nowMs)) throw new TypeError('createLedgerGate: nowMs este obligatoriu (domeniul nu citește ceasul)');
  const live = rollLedger(ledger, nowMs);
  const paused = new Set(plan?.paused ?? []);
  const reasons = new Map(Object.values(plan?.providers ?? {}).filter((p) => p.reason).map((p) => [p.provider, p.reason]));
  const runUnits = {};

  const share = (provider) => {
    const lim = limits[provider];
    const b = live[provider];
    if (!lim || !b) return 0;
    const m = isNum(lim.month) && lim.month > 0 ? (b.monthUnits ?? 0) / lim.month : 0;
    const d = isNum(lim.day) && lim.day > 0 ? (b.dayUnits ?? 0) / lim.day : 0;
    return Math.max(m, d);
  };

  return {
    check(provider, units) {
      if (!limits[provider]) return { allow: true };
      if (paused.has(provider)) return { allow: false, reason: reasons.get(provider) ?? 'cuotă epuizată' };
      if (share(provider) >= PAUSE_AT) {
        paused.add(provider);
        const reason = `${limits[provider].label ?? provider}: cuota gratuită a atins ${Math.round(PAUSE_AT * 100)}% în timpul rulării — pauză`;
        reasons.set(provider, reason);
        return { allow: false, reason };
      }
      void units;
      return { allow: true };
    },
    charge(provider, units) {
      if (!limits[provider]) return;
      const u = isNum(units) ? units : 0;
      runUnits[provider] = (runUnits[provider] ?? 0) + u;
      const b = live[provider] ?? { ...emptyBucket(), ...periodKeys(nowMs), since: isoDay(nowMs) };
      live[provider] = { ...b, monthUnits: (b.monthUnits ?? 0) + u, dayUnits: (b.dayUnits ?? 0) + u, monthCalls: (b.monthCalls ?? 0) + 1, dayCalls: (b.dayCalls ?? 0) + 1 };
    },
    ledger: () => ({ ...live }),
    runUnits: () => ({ ...runUnits }),
    paused: () => [...paused],
    reasons: () => Object.fromEntries(reasons),
  };
}
