/**
 * TRACK RECORD — the honesty mechanism.
 *
 * Any dashboard can claim a hit rate. This one records every candidate that met the cohort rule at
 * the moment it was found, then scores it forward at +7, +14 and +30 days using prices we read
 * later — never re-deciding what the signal was with hindsight. Results come with Wilson 95 %
 * intervals, so a 3-for-4 start reads as "too few samples" rather than "75 % win rate".
 *
 * Cohort rule (from the technical solution): Stage 2 AND Opportunity > 80 AND Risk < 60.
 */
import { isNum, pctChange, round, wilson } from '../shared/math.js';
import { DAY_MS } from '../shared/time.js';

export const COHORT = { minStage: 2, minOpportunity: 80, maxRisk: 60 };
export const HORIZONS = [7, 14, 30];
/** A horizon counts as a win above this forward return. */
export const WIN_THRESHOLD_PCT = 10;

export function qualifiesForCohort(verdict, cohort = COHORT) {
  return Boolean(verdict)
    && isNum(verdict.opportunity) && verdict.opportunity > cohort.minOpportunity
    && isNum(verdict.risk) && verdict.risk < cohort.maxRisk
    && isNum(verdict.stage) && verdict.stage >= cohort.minStage
    && verdict.stage <= 2;
}

/**
 * Open a journal entry for a new candidate. Everything needed to score it later is frozen now.
 */
export function openEntry({ asset, verdict, changed, risk, nowMs }) {
  return {
    id: `${asset.key}@${new Date(nowMs).toISOString().slice(0, 13)}`,
    key: asset.key,
    symbol: asset.symbol,
    name: asset.name,
    openedAt: new Date(nowMs).toISOString(),
    openedAtMs: nowMs,
    entryPrice: asset.market?.price ?? null,
    entryMarketCap: asset.market?.marketCap ?? null,
    stage: verdict.stage,
    opportunity: verdict.opportunity,
    risk: risk?.score ?? verdict.risk ?? null,
    confidence: verdict.confidence,
    earliness: changed?.earliness ?? null,
    changes: (changed?.changes ?? []).map((c) => c.key),
    families: changed?.families ?? [],
    topRisk: risk?.top?.[0]?.key ?? null,
    outcomes: {},
    closed: false,
  };
}

/**
 * Score every open entry against the current price. Only horizons that have actually elapsed are
 * filled in, and an entry is closed once its longest horizon is scored.
 *
 * @param {{entries:any[], priceByKey:Map<string, number|null>, btcChangePct?:Record<number, number|null>, nowMs:number}} input
 */
export function scoreEntries({ entries, priceByKey, nowMs, btcChangePct = {} }) {
  const out = [];
  for (const e of entries ?? []) {
    const next = { ...e, outcomes: { ...(e.outcomes ?? {}) } };
    const price = priceByKey?.get?.(e.key) ?? null;
    const elapsedDays = (nowMs - e.openedAtMs) / DAY_MS;
    for (const h of HORIZONS) {
      if (next.outcomes[h]) continue;
      if (elapsedDays < h) continue;
      // Score with whatever price we have at the first run past the horizon.
      if (!isNum(price) || !isNum(e.entryPrice) || e.entryPrice <= 0) {
        next.outcomes[h] = { at: new Date(nowMs).toISOString(), returnPct: null, win: null, note: 'preț indisponibil la scadență' };
        continue;
      }
      const ret = pctChange(e.entryPrice, price);
      const bench = isNum(btcChangePct[h]) ? btcChangePct[h] : null;
      next.outcomes[h] = {
        at: new Date(nowMs).toISOString(),
        priceAt: price,
        returnPct: round(ret, 2),
        benchmarkPct: isNum(bench) ? round(bench, 2) : null,
        alphaPct: isNum(bench) ? round(ret - bench, 2) : null,
        win: ret >= WIN_THRESHOLD_PCT,
        daysLate: round(elapsedDays - h, 1),
      };
    }
    if (HORIZONS.every((h) => next.outcomes[h])) next.closed = true;
    out.push(next);
  }
  return out;
}

/**
 * Aggregate the journal into the track-record block of the snapshot.
 */
export function trackRecord(entries, { nowMs } = {}) {
  const horizons = {};
  for (const h of HORIZONS) {
    const scored = (entries ?? []).map((e) => e.outcomes?.[h]).filter((o) => o && isNum(o.returnPct));
    const wins = scored.filter((o) => o.win).length;
    const n = scored.length;
    const w = wilson(wins, n);
    const rets = scored.map((o) => o.returnPct).sort((a, b) => a - b);
    const alphas = scored.map((o) => o.alphaPct).filter(isNum);
    horizons[h] = {
      horizonDays: h,
      n,
      wins,
      winRate: n ? round((wins / n) * 100, 1) : null,
      ci95: n ? { low: round(w.low * 100, 1), high: round(w.high * 100, 1) } : null,
      medianReturnPct: n ? round(rets[Math.floor(rets.length / 2)], 2) : null,
      bestPct: n ? round(rets[rets.length - 1], 2) : null,
      worstPct: n ? round(rets[0], 2) : null,
      medianAlphaPct: alphas.length ? round(alphas.sort((a, b) => a - b)[Math.floor(alphas.length / 2)], 2) : null,
      sufficient: n >= 20,
      note: n === 0
        ? 'nicio intrare nu a ajuns încă la această scadență'
        : n < 20
          ? `doar ${n} ${n === 1 ? 'intrare' : 'intrări'} — intervalul de încredere este prea larg pentru o concluzie`
          : null,
    };
  }
  const open = (entries ?? []).filter((e) => !e.closed).length;
  return {
    cohort: `Stage ${COHORT.minStage} + Oportunitate > ${COHORT.minOpportunity} + Risc < ${COHORT.maxRisk}`,
    winThresholdPct: WIN_THRESHOLD_PCT,
    total: (entries ?? []).length,
    open,
    closed: (entries ?? []).length - open,
    horizons,
    updatedAt: isNum(nowMs) ? new Date(nowMs).toISOString() : null,
    note: 'Fiecare intrare este înregistrată la momentul descoperirii și evaluată ulterior cu prețuri citite mai târziu. Nicio decizie nu este reluată cu informație din viitor. Intervalele sunt Wilson 95%.',
  };
}

/** Which change families have actually preceded a win? Pure bookkeeping, no claim of causality. */
export function familyPerformance(entries, horizon = 14) {
  const byFamily = new Map();
  for (const e of entries ?? []) {
    const o = e.outcomes?.[horizon];
    if (!o || !isNum(o.returnPct)) continue;
    for (const f of e.families ?? []) {
      const b = byFamily.get(f) ?? { family: f, n: 0, wins: 0, returns: [] };
      b.n += 1;
      if (o.win) b.wins += 1;
      b.returns.push(o.returnPct);
      byFamily.set(f, b);
    }
  }
  return [...byFamily.values()].map((b) => {
    const w = wilson(b.wins, b.n);
    const sorted = [...b.returns].sort((a, b2) => a - b2);
    return {
      family: b.family,
      n: b.n,
      winRate: b.n ? round((b.wins / b.n) * 100, 1) : null,
      ci95: b.n ? { low: round(w.low * 100, 1), high: round(w.high * 100, 1) } : null,
      medianReturnPct: b.n ? round(sorted[Math.floor(sorted.length / 2)], 2) : null,
      sufficient: b.n >= 12,
    };
  }).sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));
}
