/**
 * IDENTIFICATION EFFICIENCY — does the radar point at the right projects, measured forward on its
 * own published history?
 *
 * Every full scan stores, per project, the price and the verdict it published (stage, opportunity,
 * risk, families). For every such observation whose horizon has passed, the forward outcome is the
 * highest later price within the horizon against the price at the scan — what an investor reading
 * the radar at that moment could have reached. A *tier* (an opportunity band, a stage, the
 * Early-Research-Candidate verdict) is useful only if its hit rate beats the hit rate of the whole
 * universe over the same scans:
 *
 *   lift = P(hit | tier) / P(hit | universe)          hit = max forward price ≥ (1 + threshold) × price
 *
 * Reported with Wilson intervals and per *episode* (the first flag of a project) as well as per
 * observation, because consecutive scans of the same project are not independent. Recall is the
 * other side: of the moves that happened, how many had the tier flagged before them.
 *
 * Point-in-time by construction: the forward window starts strictly after the scan that emitted the
 * verdict; nothing the verdict did not know can enter it.
 *
 * Pure: no clock (`nowMs` is an argument), no I/O.
 */
import { DAY_MS, HOUR_MS, isNum, median, round } from './stats.js';

export const ID_DEFAULTS = Object.freeze({
  horizonH: 72,
  threshold: 0.2,
  windowDays: 30,
  /** Observations a tier needs before its lift is judged. */
  minObs: 30,
  /** Distinct projects a tier needs (consecutive scans of one project are one story). */
  minAssets: 10,
  /** Moves (hits in the universe) needed before recall is judged. */
  minMovers: 20,
});

/** The business definition of the answer (README → Verdictul): Stage 1–2, opportunity > 75, risk < 60. */
const erc = (v) => (v.stage === 1 || v.stage === 2) && v.opp > 75 && v.risk < 60;

export const TIERS = Object.freeze([
  { id: 'IGNORE', label: 'Bandă IGNORĂ (oportunitate < 40)', test: (v) => v.opp < 40 },
  { id: 'WATCH', label: 'Bandă DE URMĂRIT (40–60)', test: (v) => v.opp >= 40 && v.opp < 60 },
  { id: 'EARLY', label: 'Bandă TIMPURIU (60–75)', test: (v) => v.opp >= 60 && v.opp < 75 },
  { id: 'CONFIRMED', label: 'Bandă CONFIRMAT și peste (≥ 75)', test: (v) => v.opp >= 75 },
  { id: 'STAGE0', label: 'Stage 0 (neconfirmat)', test: (v) => v.stage === 0 },
  { id: 'STAGE1', label: 'Stage 1 (acumulare)', test: (v) => v.stage === 1 },
  { id: 'STAGE2', label: 'Stage 2 (confirmare multi-factor)', test: (v) => v.stage === 2 },
  { id: 'STAGE3', label: 'Stage 3 (expansiune — târziu)', test: (v) => v.stage === 3 },
  { id: 'ERC', label: 'Candidat de research timpuriu (definiția de business)', test: erc },
  { id: 'ANSWER', label: 'Răspunde la întrebare (ERC + schimbări în ≥ 2 familii)', test: (v) => erc(v) && (v.families ?? 0) >= 2 },
  { id: 'EARLY_STAGE12', label: 'Stage 1–2, oportunitate ≥ 60, risc < 60 (variantă măsurată, nu definiția)', test: (v) => (v.stage === 1 || v.stage === 2) && v.opp >= 60 && v.risk < 60 },
]);

/** Wilson interval (90%) of a proportion. */
export function wilson(k, n, z = 1.645) {
  if (!(n > 0)) return { lo: null, hi: null };
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/**
 * Decode the scanner's discovery state (cri-state/discovery.json): per project, the scans with their
 * price and published verdict. Metrics and verdict fields are named by the file's own header.
 * @returns {Map<string, {t:number, price:number, v:{stage:number, opp:number, risk:number, families:number}|null}[]>}
 */
export function decodeDiscovery(state) {
  const out = new Map();
  if (!state?.assets) return out;
  const mi = (name) => (state.metrics ?? []).indexOf(name);
  const vi = (name) => (state.verdict ?? []).indexOf(name);
  const iPrice = mi('price') >= 0 ? mi('price') : 0;
  const [iStage, iOpp, iRisk, iFam] = ['stage', 'opportunity', 'risk', 'families'].map(vi);
  for (const [key, a] of Object.entries(state.assets)) {
    const pts = [];
    for (const p of a?.p ?? []) {
      const t = isNum(p?.[0]) ? (p[0] < 1e12 ? p[0] * 1000 : p[0]) : null;
      const price = p?.[1]?.[iPrice];
      if (!isNum(t) || !isNum(price) || price <= 0) continue;
      const v = Array.isArray(p[2]) && iStage >= 0 && iOpp >= 0 ? { stage: p[2][iStage], opp: p[2][iOpp], risk: iRisk >= 0 ? p[2][iRisk] : null, families: iFam >= 0 ? p[2][iFam] : null } : null;
      pts.push({ t, price, v: v && isNum(v.stage) && isNum(v.opp) ? v : null });
    }
    pts.sort((x, y) => x.t - y.t);
    if (pts.length) out.set(key, pts);
  }
  return out;
}

/**
 * @param {Map<string, {t:number, price:number, v:any}[]>} series
 * @param {{nowMs:number, horizonH?:number, threshold?:number, windowDays?:number, minObs?:number, minAssets?:number, minMovers?:number}} o
 */
export function identificationEfficiency(series, opts) {
  const o = { ...ID_DEFAULTS, ...opts };
  const from = o.nowMs - o.windowDays * DAY_MS;
  const h = o.horizonH * HOUR_MS;
  const rows = [];
  const scans = new Set();
  for (const [key, pts] of series ?? []) {
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      if (!p.v || p.t < from || p.t > o.nowMs - h) continue;
      let best = null;
      let last = null;
      for (let j = i + 1; j < pts.length && pts[j].t <= p.t + h; j += 1) {
        best = best === null ? pts[j].price : Math.max(best, pts[j].price);
        last = pts[j].price;
      }
      if (best === null) continue;
      scans.add(p.t);
      rows.push({ key, t: p.t, v: p.v, ret: best / p.price - 1, end: last / p.price - 1 });
    }
  }
  const hits = rows.filter((r) => r.ret >= o.threshold);
  const base = rows.length ? hits.length / rows.length : null;
  const tiers = TIERS.map((tier) => {
    const sel = rows.filter((r) => tier.test(r.v));
    const k = sel.filter((r) => r.ret >= o.threshold).length;
    const ci = wilson(k, sel.length);
    const firsts = new Map();
    for (const r of sel) if (!firsts.has(r.key)) firsts.set(r.key, r);
    const ke = [...firsts.values()].filter((r) => r.ret >= o.threshold).length;
    const rate = sel.length ? k / sel.length : null;
    return {
      id: tier.id,
      label: tier.label,
      n: sel.length,
      assets: firsts.size,
      hits: k,
      ratePct: rate === null ? null : round(rate * 100, 1),
      loPct: ci.lo === null ? null : round(ci.lo * 100, 1),
      hiPct: ci.hi === null ? null : round(ci.hi * 100, 1),
      lift: rate !== null && base ? round(rate / base, 2) : null,
      liftLo: ci.lo !== null && base ? round(ci.lo / base, 2) : null,
      liftHi: ci.hi !== null && base ? round(ci.hi / base, 2) : null,
      episodes: firsts.size,
      episodeRatePct: firsts.size ? round((ke / firsts.size) * 100, 1) : null,
      medianEndPct: sel.length ? round(median(sel.map((r) => r.end)) * 100, 1) : null,
      recallPct: hits.length ? round((hits.filter((r) => tier.test(r.v)).length / hits.length) * 100, 1) : null,
      ready: sel.length >= o.minObs && firsts.size >= o.minAssets,
    };
  });
  return {
    horizonH: o.horizonH,
    thresholdPct: round(o.threshold * 100, 0),
    windowDays: o.windowDays,
    observations: rows.length,
    assets: new Set(rows.map((r) => r.key)).size,
    scans: scans.size,
    movers: hits.length,
    moverProjects: new Set(hits.map((r) => r.key)).size,
    baseRatePct: base === null ? null : round(base * 100, 1),
    medianEndPct: rows.length ? round(median(rows.map((r) => r.end)) * 100, 1) : null,
    from: rows.length ? new Date(Math.min(...rows.map((r) => r.t))).toISOString() : null,
    to: rows.length ? new Date(Math.max(...rows.map((r) => r.t))).toISOString() : null,
    tiers,
    ready: rows.length >= 300 && scans.size >= 10,
    minObs: o.minObs,
    minMovers: o.minMovers,
  };
}

/**
 * A recommendation, never an action: the measured tier a short list of candidates would do best to
 * follow — a real edge (the lift's lower bound above 1), catching at least `minRecallPct` of the
 * moves, and then the most precise (highest lift; recall breaks ties). A broad tier that catches
 * half the moves at a small edge is a watch list, not a candidate list. The verdict's thresholds are
 * business requirements; the agent says what the data shows and leaves the decision to the owner.
 */
export function bestTier(eff, { exclude = ['IGNORE', 'WATCH', 'STAGE0'], minRecallPct = 5 } = {}) {
  const ok = (eff?.tiers ?? []).filter((t) => t.ready && !exclude.includes(t.id) && isNum(t.liftLo) && t.liftLo > 1 && isNum(t.recallPct) && t.recallPct >= minRecallPct);
  ok.sort((a, b) => b.lift - a.lift || b.recallPct - a.recallPct);
  return ok[0] ?? null;
}
