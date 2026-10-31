/**
 * USE-CASE: FORECAST — keep the learning list of the last year's big winners up to date, and give
 * every project the radar researched its probability of a ≥100× run (and of a ≥20×, LAB / BTW /
 * IRYS-class run) within twelve months.
 *
 * Cost per run: nothing for the candidates (the aggregators' ATL/ATH arrive with the market list the
 * scan reads anyway) and at most `forecast.chartsPerRun` CoinGecko histories to confirm candidates
 * and measure their fingerprint at the low. A confirmation is kept for `refreshDays`, so after the
 * first days the list costs a handful of calls a day.
 */
import { isNum, round } from '../../domain/shared/math.js';
import { DAY_MS, toMs } from '../../domain/shared/time.js';
import { chartToDaily } from '../../domain/similarity/references.js';
import { namesMatch, normSymbol } from '../../domain/shared/symbols.js';
import { judgeWinner, marketCandidate, roundTrip, WINNER_DEFAULTS, WINNER_STATUS, WINNER_STATUS_RO } from '../../domain/forecast/winners.js';
import { baseRate, eventsFor, FORECAST_DEFAULTS, forecastBand, forecastUniverse, positivesFor, separation } from '../../domain/forecast/model.js';

/** Statuses of a provider answer after which no further history is requested this run. */
const STOP = new Set(['RATE_LIMITED', 'QUOTA_EXHAUSTED', 'BUDGET_EXHAUSTED', 'CIRCUIT_OPEN', 'TIMEOUT', 'NETWORK_ERROR']);
const STATUS_ORDER = { CONFIRMED: 0, DOCUMENTED: 1, PENDING: 2, BELOW: 3 };

export function forecastPolicy(config) {
  const f = config.forecast ?? {};
  return {
    ...WINNER_DEFAULTS,
    ...FORECAST_DEFAULTS,
    ...f,
    minLowMcapUsd: f.minLowMcapUsd ?? config.universe?.minMarketCapUsd ?? WINNER_DEFAULTS.minLowMcapUsd,
    chartsPerRun: f.chartsPerRun ?? 8,
    refreshDays: f.refreshDays ?? 30,
    topRows: f.topRows ?? 40,
  };
}

const idOf = (x) => (x.id ? `cg:${x.id}` : `sym:${normSymbol(x.symbol)}`);

/**
 * Candidates from the seed list and from the market's ATL/ATH, merged by CoinGecko id (or symbol).
 * @returns {Map<string, any>}
 */
export function winnerCandidates({ seeds, assets, nowMs, policy }) {
  const out = new Map();
  for (const s of seeds ?? []) {
    out.set(idOf({ id: s.coingeckoId, symbol: s.symbol }), {
      id: s.coingeckoId ?? null,
      symbol: s.symbol,
      name: s.name ?? s.symbol,
      chain: s.chain ?? null,
      listedAt: s.listedAt ?? null,
      static: s.static ?? {},
      documented: s.documented ?? null,
      sources: s.sources ?? [],
      note: s.note ?? null,
      origin: 'seed',
    });
  }
  for (const a of assets ?? []) {
    const c = marketCandidate(a, { nowMs, windowDays: policy.windowDays, minMultiple: policy.minMultiple });
    if (!c) continue;
    const listedAt = a.listing?.dateAdded ?? a.listing?.firstDataAt ?? null;
    const key = idOf(c);
    const seen = out.get(key);
    if (seen) {
      seen.claimed = c.claimed;
      seen.key = c.key;
      seen.chain ??= c.chain;
      seen.listedAt ??= listedAt;
      continue;
    }
    out.set(key, {
      ...c,
      listedAt,
      static: {},
      sources: c.id ? [{ title: `CoinGecko — ${c.symbol}: ATL ${c.claimed.low.price} (${c.claimed.low.at}), ATH ${c.claimed.peak.price} (${c.claimed.peak.at})`, url: `https://www.coingecko.com/en/coins/${c.id}` }] : [],
      origin: 'market',
    });
  }
  return out;
}

/**
 * Keep the learning list: carry recent confirmations, confirm the rest within the per-run budget.
 * @param {{cached:any, seeds:any[], assets:any[], history:any, nowMs:number, policy:any, logger?:any, canSpend?:()=>boolean}} input
 */
export async function refreshWinners({ cached, seeds, assets, history, nowMs, policy, logger = null, canSpend = () => true }) {
  const prev = new Map((cached?.items ?? []).map((w) => [w.uid, w]));
  const cands = winnerCandidates({ seeds, assets, nowMs, policy });
  const fresh = (w) => isNum(toMs(w?.checkedAt)) && nowMs - toMs(w.checkedAt) < policy.refreshDays * DAY_MS;
  const measured = (w) => w && (w.status === WINNER_STATUS.CONFIRMED || w.status === WINNER_STATUS.BELOW);

  const items = [];
  const todo = [];
  for (const [uid, c] of cands) {
    const old = prev.get(uid);
    if (measured(old) && fresh(old)) items.push({ ...old, sources: c.sources?.length ? c.sources : old.sources, note: c.note ?? old.note ?? null });
    else todo.push({ uid, c, old });
  }
  // Seeds first (documented, with sources), then the largest claimed runs.
  const claim = (t) => t.c.claimed?.multiple ?? t.c.documented?.multiple ?? 0;
  todo.sort((a, b) => (a.c.origin === 'seed' ? 0 : 1) - (b.c.origin === 'seed' ? 0 : 1) || claim(b) - claim(a));

  let charts = 0;
  let calls = 0;
  let stopped = null;
  for (const t of todo) {
    let candles = null;
    if (history?.marketChart && t.c.id && !stopped && charts < policy.chartsPerRun && canSpend()) {
      let id = t.c.id;
      let r = await history.marketChart(id, policy.windowDays);
      calls += 1;
      // A seed id that CoinGecko does not know is resolved once by symbol and name.
      if (!r?.ok && r?.status === 'HTTP_ERROR' && t.c.origin === 'seed' && history.search) {
        const s = await history.search(t.c.symbol);
        calls += 1;
        const hits = s?.ok ? s.data.filter((x) => normSymbol(x.symbol) === normSymbol(t.c.symbol)) : [];
        // Only a match on both ticker and name: tickers repeat, and a wrong history would teach the
        // model another project's run.
        const pick = hits.find((x) => namesMatch(t.c.name, x.name));
        if (pick?.id && pick.id !== id) {
          id = pick.id;
          r = await history.marketChart(id, policy.windowDays);
          calls += 1;
        }
      }
      if (r?.ok) {
        candles = chartToDaily(r.data);
        t.c.id = id;
        charts += 1;
      } else if (STOP.has(r?.status)) {
        stopped = r.status;
        logger?.warn?.(`prognoză: istoricul ${t.c.symbol} nu a putut fi citit (${r.status}) — restul listei rămâne pe rularea următoare`);
      }
    }
    if (candles?.length) {
      items.push({ ...judgeWinner(t.c, candles, { ...policy, nowMs }), uid: t.uid, origin: t.c.origin, checkedAt: new Date(nowMs).toISOString() });
    } else if (measured(t.old)) {
      // Not re-read this run: the older measurement still stands, with its date.
      items.push({ ...t.old, sources: t.c.sources?.length ? t.c.sources : t.old.sources });
    } else {
      items.push({ ...judgeWinner(t.c, null, policy), uid: t.uid, origin: t.c.origin, checkedAt: null });
    }
  }
  // One entry per project: a seed whose id was resolved by search can meet its own market
  // candidate under another key — the seed (with its sources and documented facts) is kept.
  const byId = new Map();
  for (const w of items) {
    const id = w.id ? `cg:${w.id}` : w.uid;
    const prevItem = byId.get(id);
    if (!prevItem || (prevItem.origin !== 'seed' && w.origin === 'seed')) byId.set(id, w);
  }
  const unique = [...byId.values()];
  unique.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || (b.multiple ?? 0) - (a.multiple ?? 0));
  return {
    items: unique,
    updatedAt: new Date(nowMs).toISOString(),
    stats: {
      candidates: cands.size,
      confirmed: unique.filter((w) => w.status === WINNER_STATUS.CONFIRMED).length,
      documented: unique.filter((w) => w.status === WINNER_STATUS.DOCUMENTED).length,
      pending: unique.filter((w) => w.status === WINNER_STATUS.PENDING).length,
      below: unique.filter((w) => w.status === WINNER_STATUS.BELOW).length,
      charts,
      calls,
      stopped,
    },
  };
}

/** Projects the radar tracked in the small-cap band over the window: today's universe plus history. */
export function trackedPopulation({ eligible, history, nowMs, windowDays }) {
  const from = nowMs - windowDays * DAY_MS;
  const keys = new Set((eligible ?? []).map((a) => a.key));
  for (const [k, h] of Object.entries(history ?? {})) if (toMs(h?.lastSeen) >= from) keys.add(k);
  return keys.size;
}

/**
 * Base rates and forecasts for every researched project.
 * @param {{winners:any[], projects:{key:string, vector:any}[], population:number, policy:any}} input
 */
export function runForecast({ winners, projects, population, policy }) {
  const rates = {};
  for (const t of policy.targets) {
    rates[t] = baseRate({ events: eventsFor(winners, t), population, priorRate: policy.priorRate, priorWeight: policy.priorWeight });
  }
  const byKey = forecastUniverse(projects, winners, { rates }, policy);
  const sep = Object.fromEntries(policy.targets.map((t) => [t, separation(winners, projects, t, policy)]));
  return { rates, byKey, separation: sep };
}

const pct = (x, d = 2) => (isNum(x) ? round(x * 100, d) : null);

/** The forecast as published with a radar row or a candidate (percent, not fractions). */
export function forecastView(f, rates, pastRun = null) {
  if (!f) return null;
  const targets = {};
  for (const [t, v] of Object.entries(f.targets ?? {})) {
    targets[t] = {
      pct: pct(v.p, 3),
      lo: pct(v.lo, 3),
      hi: pct(v.hi, 3),
      lift: v.lift ?? null,
      basis: v.basis,
      band: forecastBand(v.p, rates?.[t]?.p).key,
    };
  }
  return { targets, coverage: f.coverage, nearest: f.nearest ?? [], pastRun };
}

/** A project that is itself on the learning list: its run already happened (and usually reversed). */
export function pastRunsByKey(winners) {
  const out = new Map();
  for (const w of winners ?? []) {
    if (!w.key || w.status !== WINNER_STATUS.CONFIRMED) continue;
    out.set(w.key, { multiple: w.multiple, peakAt: w.peak?.at ?? null, drawdownNowPct: w.drawdownNowPct ?? null });
  }
  return out;
}

/**
 * The snapshot's forecast block: the base rates, the model, the learning list and the top forecasts
 * among the projects that passed the validity gate.
 */
export function forecastReport({ winners, rates, separation: sep, byKey, ranked, isValid, policy, excluded = [], projects = 0 }) {
  const past = pastRunsByKey(winners);
  const top = (ranked ?? [])
    .filter((r) => isValid(r.asset.key) && byKey.has(r.asset.key))
    .map((r) => ({ r, f: byKey.get(r.asset.key) }))
    .sort((a, b) => (b.f.targets[policy.targets[0]]?.p ?? 0) - (a.f.targets[policy.targets[0]]?.p ?? 0))
    .slice(0, policy.topRows)
    .map(({ r, f }) => ({
      key: r.asset.key,
      symbol: r.asset.symbol,
      name: r.asset.name,
      marketCap: isNum(r.asset.market?.marketCap) ? Math.round(r.asset.market.marketCap) : null,
      stage: r.verdict?.stage ?? null,
      ...forecastView(f, rates, past.get(r.asset.key) ?? null),
    }));
  return {
    targets: policy.targets,
    horizonDays: policy.horizonDays,
    windowDays: policy.windowDays,
    baseRates: policy.targets.map((t) => ({ multiple: t, pct: pct(rates[t].p, 3), lo: pct(rates[t].lo, 3), hi: pct(rates[t].hi, 3), events: rates[t].events, population: rates[t].population, observedPct: pct(rates[t].observed, 3) })),
    model: {
      method: 'rata de bază × raport de verosimilitate (densitate kernel pe amprenta de la minim)',
      sigma: policy.sigma,
      minCoverage: policy.minCoverage,
      shrinkK: policy.shrinkK,
      lrClamp: policy.lrClamp,
      prior: { pct: pct(policy.priorRate, 2), weight: policy.priorWeight },
      positives: Object.fromEntries(policy.targets.map((t) => [t, positivesFor(winners, t, policy).length])),
      background: projects,
      separation: sep,
    },
    winners: winners.map((w) => ({
      symbol: w.symbol,
      name: w.name,
      chain: w.chain,
      status: w.status,
      statusLabel: WINNER_STATUS_RO[w.status] ?? w.status,
      multiple: w.multiple ?? null,
      low: w.low ?? null,
      peak: w.peak ?? null,
      days: w.days ?? null,
      drawdownNowPct: w.drawdownNowPct ?? null,
      coverage: w.coverage ?? 0,
      origin: w.origin ?? null,
      checkedAt: w.checkedAt ?? null,
      note: w.note ?? null,
      sources: (w.sources ?? []).slice(0, 3),
    })),
    roundTrip: roundTrip(winners.filter((w) => w.status === WINNER_STATUS.CONFIRMED || w.status === WINNER_STATUS.DOCUMENTED)),
    excluded,
    top,
    note: 'Probabilitatea unei creșteri de cel puțin N× în 12 luni, dată de rata de bază a universului și de cât de mult seamănă proiectul azi cu câștigătorii ultimului an la minimul lor. Este o descriere statistică a unui eveniment rar, nu o predicție și nu un sfat financiar; majoritatea câștigătorilor ≥100× au pierdut ulterior peste 90% din vârf.',
  };
}
