/**
 * EFFICIENCY — how much of a professional research desk this project delivers, measured, not claimed.
 *
 * Three factors, each with its own evidence:
 *
 *  1. Capability parity — the engine's weighted matrix of what paid desks (Nansen, Arkham Pro,
 *     CoinGlass, Messari, Kaito, Token Metrics class) offer and what this project reproduces from
 *     free sources: `permanent` (no key that can expire), `withKeys` (the optional free keys set),
 *     `achieved` (what the last run actually delivered, sources that failed counted down).
 *
 *  2. Freshness — a professional desk is real-time; this one refreshes research on a schedule and
 *     market facts on a pulse. The value of a research fact is modelled as decaying with a half-life
 *     H (24 h for research signals built for multi-day horizons, 2 h for funding / open interest); a
 *     refresh every I hours leaves facts uniformly aged in [0, I], so the average value kept is
 *       F(I, H) = H / (I · ln 2) · (1 − 2^(−I/H))
 *     — 1.0 for real time, 0.94 for a 4-hour research cadence. It is computed twice: for the cadence
 *     the schedule promises and for the cadence GitHub actually delivered.
 *
 *  3. Reliability — the share of completed scans that succeeded in the window.
 *
 *     effective = achieved × freshness(observed) × reliability
 *     design    = withKeys × freshness(promised)
 *
 * Pure.
 */
import { isNum, round } from './stats.js';

export const EFFICIENCY_DEFAULTS = Object.freeze({
  halfLifeHours: { research: 24, market: 2 },
  /** Share of the parity matrix refreshed by the pulse (funding, open interest, liquidation map, depth ≈ 17/140). */
  marketShare: 0.12,
});

/** Average value kept by facts refreshed every `intervalHours`, decaying with half-life `halfLifeHours`. */
export function freshnessValue(intervalHours, halfLifeHours) {
  if (!isNum(intervalHours) || !isNum(halfLifeHours) || halfLifeHours <= 0) return null;
  if (intervalHours <= 0) return 1;
  const x = intervalHours / halfLifeHours;
  return (1 - 2 ** -x) / (x * Math.LN2);
}

/**
 * @param {{parity:{permanent:number, withKeys:number, achieved:number}|null,
 *          scan:{expectedPerDay:number|null, perDay:number|null}|null,
 *          pulse:{expectedPerDay:number|null, perDay:number|null}|null,
 *          reliability:{rate:number|null, n:number}|null}} o
 */
export function efficiency({ parity, scan, pulse, reliability }, opts = {}) {
  const o = { ...EFFICIENCY_DEFAULTS, ...opts, halfLifeHours: { ...EFFICIENCY_DEFAULTS.halfLifeHours, ...(opts.halfLifeHours ?? {}) } };
  const interval = (perDay) => (isNum(perDay) && perDay > 0 ? 24 / perDay : null);
  const fr = (perDayScan, perDayPulse) => {
    const fs = freshnessValue(interval(perDayScan), o.halfLifeHours.research);
    const fp = freshnessValue(interval(perDayPulse), o.halfLifeHours.market);
    if (!isNum(fs)) return null;
    return (1 - o.marketShare) * fs + o.marketShare * (isNum(fp) ? fp : 0);
  };
  const promised = fr(scan?.expectedPerDay, pulse?.expectedPerDay);
  const observed = fr(scan?.perDay, pulse?.perDay);
  const rel = isNum(reliability?.rate) ? reliability.rate : null;
  const effective = isNum(parity?.achieved) && isNum(observed) ? parity.achieved * observed * (rel ?? 1) : null;
  const design = isNum(parity?.withKeys) && isNum(promised) ? parity.withKeys * promised : null;
  // The levers, largest first: what each factor costs against the design target.
  const levers = [];
  if (isNum(parity?.withKeys) && isNum(parity?.achieved) && parity.withKeys > parity.achieved) levers.push({ id: 'keys', label: 'chei gratuite neconfigurate și surse căzute în ultima rulare', points: round(parity.withKeys - parity.achieved, 1) });
  if (isNum(promised) && isNum(observed) && isNum(parity?.achieved) && promised > observed) levers.push({ id: 'cadence', label: 'programări sărite de GitHub (cadență sub cron)', points: round(parity.achieved * (promised - observed), 1) });
  if (isNum(rel) && rel < 1 && isNum(parity?.achieved) && isNum(observed)) levers.push({ id: 'reliability', label: 'scanări eșuate', points: round(parity.achieved * observed * (1 - rel), 1) });
  levers.sort((a, b) => b.points - a.points);
  return {
    capability: parity ? { permanent: parity.permanent, withKeys: parity.withKeys, achieved: parity.achieved } : null,
    freshness: { promised: round(isNum(promised) ? promised * 100 : null, 1), observed: round(isNum(observed) ? observed * 100 : null, 1), halfLifeHours: o.halfLifeHours, marketShare: o.marketShare },
    cadence: { scanPerDay: scan?.perDay ?? null, scanPromised: scan?.expectedPerDay ?? null, pulsePerDay: pulse?.perDay ?? null, pulsePromised: pulse?.expectedPerDay ?? null },
    reliability: rel === null ? null : round(rel * 100, 1),
    effective: round(effective, 1),
    design: round(design, 1),
    levers,
    note: 'Eficiența efectivă = paritatea realizată în ultima rulare × prospețimea livrată (valoarea medie păstrată de date, cu timp de înjumătățire de 24 h pentru cercetare și 2 h pentru funding/OI) × fiabilitatea scanărilor. Un desk profesional în timp real are 100% prospețime; acesta nu are abonamente.',
  };
}
