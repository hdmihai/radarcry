/**
 * SELF-EVALUATION — does the agent's memory make it better at anticipating the project than not
 * remembering anything? Measured, not asserted.
 *
 * On every run the agent predicts, for each gate, the probability that the gate will be in WARN or
 * FAIL at the *next* run, from what it has learned so far: a two-state chain per gate (how often the
 * gate stayed in, or left, the state it is in now), whose prior is the same chain pooled over all the
 * gates (hierarchical: a gate with little history borrows the project's behaviour), itself starting
 * from "states are sticky". At the next run the predictions are scored against what happened (Brier
 * score), prequentially: every prediction was made before its outcome was known.
 *
 * Two naive forecasters set the bar:
 *   · persistence — "the next run is like this one" (p = 1 when the gate is not passing now, else 0);
 *   · climatology — the gate's simple past frequency of not passing, no dynamics.
 *
 *   skill = (Brier_persistence − Brier_agent) / max(Brier_persistence, 0.01)
 *
 * Persistence is perfect while nothing changes, and no forecaster can beat it then; the comparison
 * with it is judged only once enough state changes were observed (P-3), and until then the agent is
 * judged against climatology. The learning curve is the agent's Brier per window of runs: it should
 * fall as experience grows — the agent's capacity to learn. A second, independent check scores the
 * learned norms: a new value should fall inside the p10–p90 band of the series before it about 80%
 * of the time.
 *
 * UNKNOWN and LEARNING outcomes are never scored (P-2): "not observed" is not a failure.
 * Pure: time and observations arrive as arguments.
 */
import { isNum, quantile, round } from './stats.js';

export const SELF_DEFAULTS = Object.freeze({
  /** Strength of the pooled prior on a gate's own transition rates (pseudo-transitions). */
  alpha: 4,
  /** The pool's own starting belief: a passing gate fails next time 5% of the time, a failing one stays 80%. */
  priorFlip: 0.05,
  priorStay: 0.8,
  priorWeight: 10,
  /** State changes needed before the agent is compared with persistence (P-3). */
  minChanges: 5,
  /** Codes kept per gate (one per run). */
  keepCodes: 240,
  /** Scored runs kept. */
  keepRuns: 720,
  /** Runs per point of the learning curve. */
  curveWindow: 24,
  /** Runs scored before the skill is judged (P-3). */
  minRuns: 24,
  /** Brier floor of the skill's denominator. */
  floor: 0.01,
  /** Norm band whose coverage is checked. */
  bandLo: 0.1,
  bandHi: 0.9,
  normWindow: 60,
  normMinSamples: 8,
});

/** Gates that are not predicted: derived from the rules and from the self-evaluation itself. */
const SKIP = new Set(['model.identification', 'agent.rules', 'agent.learning']);
const CODE = { PASS: 'P', WARN: 'W', FAIL: 'F', UNKNOWN: 'U', LEARNING: 'L' };
const scored = (c) => c === 'P' || c === 'W' || c === 'F';
const bad = (c) => (c === 'W' || c === 'F' ? 1 : 0);

export function emptySelfEval() {
  return { codes: {}, pending: null, runs: [], bands: [] };
}

/** The status code of every gate in this run. */
export function gateCodes(results) {
  const out = {};
  for (const r of results ?? []) if (r?.id && !SKIP.has(r.id)) out[r.id] = CODE[r.status] ?? 'U';
  return out;
}

function frequencies(codes) {
  let n = 0;
  let k = 0;
  for (const s of Object.values(codes ?? {})) {
    for (const c of s) {
      if (!scored(c)) continue;
      n += 1;
      k += bad(c);
    }
  }
  return { n, k };
}

/**
 * The agent's forecast for the next run, per gate.
 * @param {Record<string,string>} codes  past codes per gate (oldest first), including this run's
 */
export function predictNext(codes, o = {}) {
  const { alpha, priorFlip, priorStay, priorWeight } = { ...SELF_DEFAULTS, ...o };
  const g = frequencies(codes);
  const global = (g.k + 1) / (g.n + 2);
  const pool = { P: { n: 0, k: 0 }, B: { n: 0, k: 0 } };
  const per = [];
  for (const [id, s] of Object.entries(codes ?? {})) {
    let n = 0;
    let k = 0;
    const tr = { P: { n: 0, k: 0 }, B: { n: 0, k: 0 } };
    let prev = null;
    for (const c of s) {
      if (!scored(c)) {
        prev = null;
        continue;
      }
      n += 1;
      k += bad(c);
      if (prev) {
        const from = bad(prev) ? 'B' : 'P';
        tr[from].n += 1;
        tr[from].k += bad(c);
        pool[from].n += 1;
        pool[from].k += bad(c);
      }
      prev = c;
    }
    per.push({ id, cur: s.at(-1), n, k, tr });
  }
  // The project's own chain, from every gate, starting from "sticky".
  const rate = { P: (pool.P.k + priorWeight * priorFlip) / (pool.P.n + priorWeight), B: (pool.B.k + priorWeight * priorStay) / (pool.B.n + priorWeight) };
  const preds = {};
  for (const x of per) {
    if (!scored(x.cur)) continue;
    const st = bad(x.cur) ? 'B' : 'P';
    const t = x.tr[st];
    preds[x.id] = { p: (t.k + alpha * rate[st]) / (t.n + alpha), clim: (x.k + global) / (x.n + 1), now: x.cur };
  }
  return preds;
}

/**
 * Score the predictions made at the previous run against this run's codes.
 * @returns {{n:number, model:number, persistence:number, climatology:number}|null}  sums of squared errors
 */
export function scorePending(pending, codesNow) {
  if (!pending?.preds) return null;
  let n = 0;
  let model = 0;
  let persistence = 0;
  let climatology = 0;
  for (const [id, pr] of Object.entries(pending.preds)) {
    const c = codesNow?.[id];
    if (!scored(c) || !scored(pr.now)) continue;
    const y = bad(c);
    n += 1;
    model += (pr.p - y) ** 2;
    persistence += (bad(pr.now) - y) ** 2;
    climatology += (pr.clim - y) ** 2;
  }
  return n ? { n, model, persistence, climatology } : null;
}

/**
 * Coverage of the learned norms: of the points that arrived in this run, how many fell inside the
 * p10–p90 band of the series as it was before them.
 * @param {Record<string,[number,number][]>} before  memory.series before ingesting this run
 * @param {Record<string,[number,number][]>} after   memory.series after
 */
export function bandCoverage(before, after, o = {}) {
  const c = { ...SELF_DEFAULTS, ...o };
  let n = 0;
  let inside = 0;
  for (const [metric, pts] of Object.entries(after ?? {})) {
    const old = before?.[metric] ?? [];
    if (old.length < c.normMinSamples) continue;
    const lastT = old.at(-1)[0];
    const win = old.slice(-c.normWindow).map(([, v]) => v);
    const lo = quantile(win, c.bandLo);
    const hi = quantile(win, c.bandHi);
    for (const [t, v] of pts) {
      if (t <= lastT || !isNum(v)) continue;
      n += 1;
      if (v >= lo && v <= hi) inside += 1;
    }
  }
  return { n, inside };
}

/**
 * One self-evaluation step: score what was predicted last run, remember this run, predict the next.
 * @param {any} state  memory.selfEval
 * @param {{results:any[], nowMs:number, seriesBefore?:any, seriesAfter?:any}} o
 */
export function stepSelfEval(state, { results, nowMs, seriesBefore = null, seriesAfter = null }, o = {}) {
  const c = { ...SELF_DEFAULTS, ...o };
  const s = { ...emptySelfEval(), ...(state ?? {}) };
  const now = gateCodes(results);
  const sc = scorePending(s.pending, now);
  const runs = sc ? [...s.runs, [nowMs, sc.n, round(sc.model, 6), round(sc.persistence, 6), round(sc.climatology, 6)]] : [...s.runs];
  const codes = { ...s.codes };
  for (const [id, code] of Object.entries(now)) codes[id] = `${codes[id] ?? ''}${code}`.slice(-c.keepCodes);
  const cov = seriesBefore && seriesAfter ? bandCoverage(seriesBefore, seriesAfter, c) : { n: 0, inside: 0 };
  const bands = cov.n ? [...s.bands, [nowMs, cov.n, cov.inside]] : [...s.bands];
  const preds = predictNext(codes, c);
  return {
    state: { codes, pending: { at: nowMs, preds: Object.fromEntries(Object.entries(preds).map(([id, p]) => [id, { p: round(p.p, 5), clim: round(p.clim, 5), now: p.now }])) }, runs: runs.slice(-c.keepRuns), bands: bands.slice(-c.keepRuns) },
    scoredNow: sc,
    predictions: preds,
  };
}

const skillOf = (model, persistence, floor) => round((persistence - model) / Math.max(persistence, floor), 3);

/**
 * What the report and the rules read: the scores so far, the learning curve, the norms' coverage and
 * the gates the agent expects to need attention at the next run.
 */
export function selfEvalSummary(state, o = {}) {
  const c = { ...SELF_DEFAULTS, ...o };
  const runs = state?.runs ?? [];
  const sum = (i) => runs.reduce((a, r) => a + r[i], 0);
  const n = sum(1);
  const brier = n ? sum(2) / n : null;
  const brierP = n ? sum(3) / n : null;
  const brierC = n ? sum(4) / n : null;
  const curve = [];
  // Windows end at the latest run, so the last point is always current.
  for (let end = runs.length; end - c.curveWindow >= 0; end -= c.curveWindow) {
    const w = runs.slice(end - c.curveWindow, end);
    const wn = w.reduce((a, r) => a + r[1], 0);
    const m = w.reduce((a, r) => a + r[2], 0) / wn;
    const p = w.reduce((a, r) => a + r[3], 0) / wn;
    const cl = w.reduce((a, r) => a + r[4], 0) / wn;
    curve.unshift({ from: new Date(w[0][0]).toISOString(), to: new Date(w.at(-1)[0]).toISOString(), runs: w.length, predictions: wn, brier: round(m, 6), brierPersistence: round(p, 6), brierClimatology: round(cl, 6), changes: Math.round(w.reduce((a, r) => a + r[3], 0)), skill: skillOf(m, p, c.floor) });
  }
  const changes = Math.round(sum(3));
  const bn = (state?.bands ?? []).reduce((a, b) => a + b[1], 0);
  const bi = (state?.bands ?? []).reduce((a, b) => a + b[2], 0);
  const preds = state?.pending?.preds ?? {};
  const watch = Object.entries(preds)
    .filter(([, p]) => p.now === 'P' && p.p >= 0.15)
    .sort((a, b) => b[1].p - a[1].p)
    .slice(0, 6)
    .map(([id, p]) => ({ id, pct: round(p.p * 100, 1) }));
  const stay = Object.entries(preds)
    .filter(([, p]) => p.now !== 'P')
    .sort((a, b) => b[1].p - a[1].p)
    .map(([id, p]) => ({ id, pct: round(p.p * 100, 1) }));
  return {
    runsScored: runs.length,
    predictions: n,
    minRuns: c.minRuns,
    ready: runs.length >= c.minRuns,
    brier: round(brier, 6),
    brierPersistence: round(brierP, 6),
    brierClimatology: round(brierC, 6),
    skill: n ? skillOf(brier, brierP, c.floor) : null,
    skillVsClimatology: n && brierC > 0 ? round(1 - brier / brierC, 3) : null,
    // State changes seen (each one is an error of persistence): the comparison with it needs some.
    changes,
    minChanges: c.minChanges,
    comparable: changes >= c.minChanges,
    curve: curve.slice(-12),
    brierTrend: curve.length >= 2 ? round(curve.at(-1).brier - curve[0].brier, 6) : null,
    coverage: { n: bn, insidePct: bn ? round((bi / bn) * 100, 1) : null, targetPct: round((c.bandHi - c.bandLo) * 100, 0) },
    nextRun: { watch, stay },
    method: 'predicție pentru rularea următoare, per poartă, din lanțul de stări învățat; notată Brier față de „ca data trecută” și de frecvența simplă',
  };
}

/**
 * The track record of the agent's code proposals: how many of its pull requests the owner accepted.
 * The one measure of the code-writing capability that no test can fake.
 */
export function coderRecord(pulls) {
  if (!Array.isArray(pulls)) return null;
  const merged = pulls.filter((p) => p.merged).length;
  const closed = pulls.filter((p) => p.state === 'closed' && !p.merged).length;
  const open = pulls.filter((p) => p.state === 'open').length;
  const decided = merged + closed;
  return { proposals: pulls.length, merged, closed, open, acceptancePct: decided ? round((merged / decided) * 100, 1) : null, recent: pulls.slice(0, 5).map((p) => ({ number: p.number, title: p.title, state: p.merged ? 'merged' : p.state, url: p.url ?? null })) };
}
