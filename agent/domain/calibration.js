/**
 * CALIBRATION — the agent keeps the forecast honest by writing its predictions down and checking
 * them against what happened.
 *
 * Once a week (ISO week), every verified project's published probability of a ≥100× and a ≥20× run
 * within twelve months is recorded with its price at that moment: one *cohort*. On every later run
 * the cohort's highest price is updated from the market — the 24-hour high, so a spike between two
 * runs is not missed as long as the agent runs at least daily. A project whose ratio to its recorded
 * price crosses 20× or 100× is a *hit*, dated.
 *
 * Two readings:
 *  · interim, while cohorts are young: observed hits against the hits the forecast implied so far
 *    (Σ p × elapsed share of the horizon — a uniform-hazard approximation, stated as such), with an
 *    exact Poisson interval, because these are rare events;
 *  · at maturity (horizon passed): the Brier score of the forecast against the Brier score of the
 *    base rate alone, and the skill 1 − B/B₀ — the only number that says whether the fingerprint
 *    adjustment adds information.
 *
 * Pure: time arrives as `nowMs`; prices arrive as a map.
 */
import { DAY_MS, isNum, poissonInterval, round, toMs } from './stats.js';

export const TARGETS = Object.freeze([100, 20]);

/** ISO-8601 week id ('2026-W44') of a timestamp. */
export function weekId(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3);
  const year = new Date(thursday).getUTCFullYear();
  const firstThursday = Date.UTC(year, 0, 4) - (((new Date(Date.UTC(year, 0, 4)).getUTCDay() + 6) % 7) - 3) * DAY_MS;
  const week = 1 + Math.round((thursday - firstThursday) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * A cohort from the published forecast. Rows: [key, symbol, p100, p20, price0, maxPrice, lastAt, hit20At, hit100At].
 * Probabilities arrive in percent (the contract's unit) and are stored as fractions.
 *
 * @param {{at:string, horizonDays?:number, base?:{p100?:number|null, p20?:number|null}, rows:{key:string, symbol:string, fc100:number, fc20:number|null, price:number}[], maxRows?:number}} o
 */
export function makeCohort({ at, horizonDays = 365, base = {}, rows, maxRows = 600 }) {
  const usable = (rows ?? []).filter((r) => r?.key && isNum(r.fc100) && isNum(r.price) && r.price > 0);
  // Highest probabilities first: if the cohort must be cut, the informative tail is what is kept.
  usable.sort((a, b) => b.fc100 - a.fc100);
  return {
    id: weekId(toMs(at)),
    at,
    horizonDays,
    base: { p100: isNum(base.p100) ? base.p100 / 100 : null, p20: isNum(base.p20) ? base.p20 / 100 : null },
    rows: usable.slice(0, maxRows).map((r) => [r.key, r.symbol, round(r.fc100 / 100, 6), isNum(r.fc20) ? round(r.fc20 / 100, 6) : null, r.price, r.price, at, null, null]),
  };
}

const R = { key: 0, symbol: 1, p100: 2, p20: 3, price0: 4, max: 5, lastAt: 6, hit20: 7, hit100: 8 };

/**
 * Update the cohort's highest prices. `prices`: Map key → {price, high24h?}. Observations after the
 * cohort's horizon are ignored (the label is "within twelve months").
 */
export function observePrices(cohort, prices, nowMs) {
  const endMs = toMs(cohort.at) + cohort.horizonDays * DAY_MS;
  if (nowMs > endMs) return { cohort, updated: 0 };
  const iso = new Date(nowMs).toISOString();
  let updated = 0;
  const rows = cohort.rows.map((row) => {
    const p = prices.get(row[R.key]);
    if (!p) return row;
    const seen = Math.max(...[p.price, p.high24h].filter(isNum));
    if (!isNum(seen)) return row;
    const next = [...row];
    next[R.max] = Math.max(row[R.max], seen);
    next[R.lastAt] = iso;
    const mult = next[R.max] / row[R.price0];
    if (!next[R.hit20] && mult >= 20) next[R.hit20] = iso;
    if (!next[R.hit100] && mult >= 100) next[R.hit100] = iso;
    updated += 1;
    return next;
  });
  return { cohort: { ...cohort, rows }, updated };
}

/** Is a cohort past its horizon? */
export const matured = (cohort, nowMs) => nowMs >= toMs(cohort.at) + cohort.horizonDays * DAY_MS;

/**
 * Pooled calibration over every cohort.
 * @returns {{cohorts:number, predictions:number, tracked:number, matured:number,
 *   interim:Record<string,{observed:number, expected:number, ratio:number|null, lower:number|null, upper:number|null}>,
 *   brier:Record<string,number|null>, brierBase:Record<string,number|null>, skill:Record<string,number|null>,
 *   discrimination:{topDecileHitRate:number|null, restHitRate:number|null, target:number}, hits:any[]}}
 */
export function calibrationSummary(cohorts, nowMs, archive = null) {
  const list = cohorts ?? [];
  const out = { cohorts: list.length, predictions: 0, tracked: 0, matured: 0, archived: archive?.cohorts ?? 0, interim: {}, brier: {}, brierBase: {}, skill: {}, discrimination: { target: 20, topDecileHitRate: null, restHitRate: null }, hits: [] };
  // Matured cohorts that were pruned from memory still count at maturity, through their stored sums.
  const acc = Object.fromEntries(TARGETS.map((t) => [t, { o: 0, e: 0, bs: archive?.[t]?.bs ?? 0, bs0: archive?.[t]?.bs0 ?? 0, n: archive?.[t]?.n ?? 0 }]));
  const ranked = [];
  for (const c of list) {
    const elapsed = Math.min(1, Math.max(0, (nowMs - toMs(c.at)) / (c.horizonDays * DAY_MS)));
    const isMature = matured(c, nowMs);
    if (isMature) out.matured += 1;
    for (const row of c.rows) {
      out.predictions += 1;
      const tracked = row[R.lastAt] !== c.at;
      if (tracked) out.tracked += 1;
      for (const t of TARGETS) {
        const p = t === 100 ? row[R.p100] : row[R.p20];
        if (!isNum(p)) continue;
        const hit = Boolean(t === 100 ? row[R.hit100] : row[R.hit20]);
        acc[t].o += hit ? 1 : 0;
        acc[t].e += p * elapsed;
        if (isMature) {
          const p0 = t === 100 ? c.base.p100 : c.base.p20;
          acc[t].bs += (p - (hit ? 1 : 0)) ** 2;
          if (isNum(p0)) acc[t].bs0 += (p0 - (hit ? 1 : 0)) ** 2;
          acc[t].n += 1;
        }
      }
      if (isNum(row[R.p20])) ranked.push({ p: row[R.p20], hit: Boolean(row[R.hit20]) });
      if (row[R.hit20] || row[R.hit100]) out.hits.push({ cohort: c.id, key: row[R.key], symbol: row[R.symbol], multiple: round(row[R.max] / row[R.price0], 1), p100: round(row[R.p100] * 100, 3), p20: isNum(row[R.p20]) ? round(row[R.p20] * 100, 3) : null, hit20At: row[R.hit20], hit100At: row[R.hit100] });
    }
  }
  for (const t of TARGETS) {
    const a = acc[t];
    const ci = poissonInterval(a.o, 0.9);
    out.interim[t] = { observed: a.o, expected: round(a.e, 3), ratio: a.e > 0 ? round(a.o / a.e, 3) : null, lower: a.e > 0 ? round(ci.lower / a.e, 3) : null, upper: a.e > 0 ? round(ci.upper / a.e, 3) : null };
    out.brier[t] = a.n ? round(a.bs / a.n, 6) : null;
    out.brierBase[t] = a.n ? round(a.bs0 / a.n, 6) : null;
    out.skill[t] = a.n && a.bs0 > 0 ? round(1 - a.bs / a.bs0, 3) : null;
  }
  if (ranked.length >= 20) {
    ranked.sort((a, b) => b.p - a.p);
    const k = Math.max(1, Math.floor(ranked.length / 10));
    const top = ranked.slice(0, k);
    const rest = ranked.slice(k);
    out.discrimination.topDecileHitRate = round(top.filter((x) => x.hit).length / top.length, 4);
    out.discrimination.restHitRate = rest.length ? round(rest.filter((x) => x.hit).length / rest.length, 4) : null;
  }
  out.hits.sort((a, b) => b.multiple - a.multiple);
  out.hits = out.hits.slice(0, 20);
  return out;
}

/**
 * Drop cohorts older than `keepDays`; the matured ones leave their Brier sums in `archive`, so the
 * verdict at maturity keeps every cohort ever recorded while memory stays bounded.
 * @returns {{cohorts:any[], archive:any}}
 */
export function pruneCohorts(cohorts, nowMs, keepDays = 430, archive = null) {
  const keep = [];
  const arch = archive ? JSON.parse(JSON.stringify(archive)) : { cohorts: 0 };
  for (const c of cohorts ?? []) {
    if (nowMs - toMs(c.at) <= keepDays * DAY_MS) {
      keep.push(c);
      continue;
    }
    arch.cohorts = (arch.cohorts ?? 0) + 1;
    for (const t of TARGETS) {
      const a = (arch[t] ??= { bs: 0, bs0: 0, n: 0 });
      for (const row of c.rows) {
        const p = t === 100 ? row[R.p100] : row[R.p20];
        if (!isNum(p)) continue;
        const o = (t === 100 ? row[R.hit100] : row[R.hit20]) ? 1 : 0;
        const p0 = t === 100 ? c.base.p100 : c.base.p20;
        a.bs += (p - o) ** 2;
        if (isNum(p0)) a.bs0 += (p0 - o) ** 2;
        a.n += 1;
      }
    }
  }
  return { cohorts: keep, archive: arch };
}
