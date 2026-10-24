/**
 * PRE-EXPANSION SCORE — the small-cap opportunity engine, with the technical solution's weights
 * reproduced exactly:
 *
 *   Volum                20
 *   Lichiditate          15
 *   Deținători           15
 *   Whale intelligence   20
 *   Presiune de supply   10
 *   Structură            10
 *   Regim de piață        5
 *   Narațiune             5
 *                       ───
 *                       100
 *
 * A factor that could not be measured is **removed from the denominator and its weight
 * redistributed** over the factors that were measured, and the share of weight that arrived becomes
 * the Confidence. A missing factor therefore lowers confidence, never the score — because UNKNOWN
 * is not bearish.
 */
import { band, clamp, isNum, round } from '../shared/math.js';
import { QUALITY, weightedScore } from '../quality/data-quality.js';

export const PRE_EXPANSION_WEIGHTS = {
  volume: 20,
  liquidity: 15,
  holders: 15,
  whales: 20,
  supply: 10,
  structure: 10,
  regime: 5,
  narrative: 5,
};

/** Factors read off the price/volume series, and therefore only as fresh as the quote behind them. */
const PRICE_DERIVED = new Set(['volume', 'liquidity', 'structure']);

/** Score bands from the attachment. */
export const BANDS = [
  { band: 'HIGH_POTENTIAL', min: 90, label: 'POTENȚIAL RIDICAT' },
  { band: 'CONFIRMED', min: 75, label: 'CONFIRMAT' },
  { band: 'EARLY', min: 60, label: 'TIMPURIU' },
  { band: 'WATCH', min: 40, label: 'DE URMĂRIT' },
  { band: 'IGNORE', min: 0, label: 'IGNORĂ' },
];

export function bandOf(score) {
  if (!isNum(score)) return { band: 'UNKNOWN', label: 'NECUNOSCUT' };
  return BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1];
}

const q = (ok, grade = QUALITY.MEDIUM) => (ok ? grade : QUALITY.UNKNOWN);

/* ── individual factors ──────────────────────────────────────────────────────────────────────── */

/** VOLUME (20) — is money moving, measured against the token's own norm rather than a constant. */
function volumeFactor(a, cmp) {
  const parts = [];
  let s = null;
  const z = cmp?.volume24h?.z;
  const accel = a.features?.daily?.volAccel;
  const rvol = cmp?.volume24h?.percentile;
  if (isNum(z)) { s = clamp(50 + z * 13, 0, 100); parts.push(`volum z=${round(z, 1)} față de mediana proprie`); }
  if (isNum(accel)) {
    const fromAccel = band(accel, 0.7, 2.5);
    s = isNum(s) ? (s * 0.6 + fromAccel * 0.4) : fromAccel;
    parts.push(`volum 7z/30z = ${round(accel, 2)}×`);
  }
  if (isNum(rvol) && isNum(s)) { s = s * 0.85 + rvol * 100 * 0.15; parts.push(`percentila ${Math.round(rvol * 100)} a propriului istoric`); }
  if (!isNum(s) && isNum(a.market?.volume24h) && isNum(a.market?.marketCap)) {
    // No history and no candles yet: fall back to turnover, flagged as the weaker reading it is.
    // The band stops at 12 % a day because beyond that turnover stops meaning "interest" and starts
    // meaning "wash trading" — which the risk engine flags separately.
    const t = a.derived?.turnover;
    if (isNum(t)) { s = band(Math.min(t, 0.12), 0.004, 0.12); parts.push(`rotație ${round(t * 100, 1)}%/zi (fără istoric propriu și fără lumânări)`); }
  }
  return { score: isNum(s) ? round(s, 1) : null, quality: q(isNum(s), isNum(z) ? QUALITY.HIGH : QUALITY.LOW), evidence: parts.join('; ') || 'fără serii de volum' };
}

/** LIQUIDITY (15) — could a real position be built and unwound without moving the market? */
function liquidityFactor(a, cmp) {
  const parts = [];
  const liq = a.onchain?.liquidityUsd;
  const mc = a.market?.marketCap;
  let s = null;
  if (isNum(liq)) {
    s = band(liq, 50_000, 3_000_000);
    parts.push(`lichiditate DEX ${Math.round(liq).toLocaleString('ro-RO')}$`);
    if (isNum(mc) && mc > 0) {
      const depthRatio = liq / mc;
      const fromRatio = band(depthRatio, 0.002, 0.06);
      s = s * 0.65 + fromRatio * 0.35;
      parts.push(`${round(depthRatio * 100, 2)}% din capitalizare în pool-uri`);
    }
  }
  const growth = cmp?.liquidityUsd?.changePct;
  if (isNum(growth) && isNum(s)) {
    s = clamp(s + clamp(growth / 4, -15, 20), 0, 100);
    parts.push(`lichiditate ${growth > 0 ? '+' : ''}${round(growth, 1)}% față de mediana de 30 zile`);
  }
  if (!isNum(s) && isNum(a.venues?.mexcSpot?.quoteVolume)) {
    s = band(a.venues.mexcSpot.quoteVolume, 100_000, 20_000_000);
    parts.push('fără pool-uri DEX citite — folosesc volumul spot ca proxy');
  }
  return { score: isNum(s) ? round(s, 1) : null, quality: q(isNum(s), isNum(liq) ? QUALITY.HIGH : QUALITY.LOW), evidence: parts.join('; ') || 'fără date de lichiditate' };
}

/** HOLDERS (15) — is the base widening, and is the effective concentration falling? */
function holdersFactor(a, cmp) {
  const parts = [];
  let s = null;
  const h = a.onchain?.holders;
  const growth = cmp?.holders?.changePct;
  const top10 = a.onchain?.top10Pct;
  const top10Eff = a.onchain?.top10EffectivePct;

  if (isNum(h)) { s = band(Math.log10(Math.max(h, 1)), 2, 4.7); parts.push(`${Math.round(h).toLocaleString('ro-RO')} deținători`); }
  if (isNum(growth)) {
    const fromGrowth = band(growth, -5, 35);
    s = isNum(s) ? s * 0.45 + fromGrowth * 0.55 : fromGrowth;
    parts.push(`deținători ${growth > 0 ? '+' : ''}${round(growth, 1)}% față de normă`);
  }
  const conc = isNum(top10Eff) ? top10Eff : top10;
  if (isNum(conc)) {
    // Lower effective concentration is better; 20 % is excellent, 80 % is a red flag.
    const fromConc = band(100 - conc, 20, 80);
    s = isNum(s) ? s * 0.7 + fromConc * 0.3 : fromConc;
    parts.push(`top 10 efectiv ${round(conc, 1)}%${isNum(top10Eff) && isNum(top10) && Math.abs(top10 - top10Eff) > 1 ? ` (brut ${round(top10, 1)}%)` : ''}`);
  }
  return { score: isNum(s) ? round(s, 1) : null, quality: q(isNum(s), isNum(h) && isNum(conc) ? QUALITY.HIGH : QUALITY.MEDIUM), evidence: parts.join('; ') || 'fără date de deținători' };
}

/** WHALE INTELLIGENCE (20) — the heaviest factor: who is accumulating and where it is going. */
function whaleFactor(a) {
  const f = a.onchain?.flows;
  const sm = a.onchain?.smartMoney;
  const parts = [];
  let s = null;
  // A flows verdict of UNKNOWN means we only have one snapshot so far — that is *unmeasured*, not
  // neutral, so it must not contribute a 50 that dilutes the whale block.
  const map = { ACCUMULATION: 88, ACCUMULATING: 72, NEUTRAL: 50, DISTRIBUTING: 28, DISTRIBUTION: 12 };
  if (f?.verdict && map[f.verdict] !== undefined) {
    s = map[f.verdict];
    parts.push(`verdict fluxuri: ${f.verdictLabel ?? f.verdict.toLowerCase()} (${f.accumulating ?? 0} portofele mari în acumulare, ${f.distributing ?? 0} în distribuție)`);
    for (const flag of f.flags ?? []) parts.push(`semnal: ${flag}`);
  } else if (f?.note) {
    parts.push(f.note);
  }
  if (isNum(sm?.score)) {
    // The Smart Money Score is only as informative as the share of its 16 components that could be
    // evaluated. At full coverage it carries half the block; at thin coverage it carries a quarter,
    // so an under-measured sub-score cannot dilute a flows verdict that *was* measured directly.
    const w = isNum(s) ? clamp(sm.coverage ?? 0.5, 0.25, 0.5) : 1;
    s = isNum(s) ? s * (1 - w) + sm.score * w : sm.score;
    parts.push(`Smart Money Score ${round(sm.score, 0)}/100 (${sm.measured ?? '?'}/16 componente evaluabile, pondere ${Math.round(w * 100)}% în acest bloc)`);
  }
  const cex = a.onchain?.cexBalancePct;
  if (isNum(cex)) parts.push(`${round(cex, 1)}% din supply pe burse centralizate`);
  return { score: isNum(s) ? round(s, 1) : null, quality: q(isNum(s), f?.verdict && isNum(sm?.score) ? QUALITY.HIGH : QUALITY.MEDIUM), evidence: parts.join('; ') || 'fără date on-chain de portofele' };
}

/** SUPPLY PRESSURE (10) — how much new supply is waiting to be sold into any strength. */
function supplyFactor(a) {
  const s0 = a.risk?.supply;
  if (!s0) return { score: null, quality: QUALITY.UNKNOWN, evidence: 'fără date de supply' };
  const parts = [];
  let s = 50;
  if (isNum(s0.floatRatio)) {
    s = band(s0.floatRatio, 0.2, 0.95);
    parts.push(`${Math.round(s0.floatRatio * 100)}% din supply în circulație`);
  }
  if (isNum(s0.fdvToMcap)) {
    if (s0.fdvToMcap > 4) { s -= 25; parts.push(`FDV = ${round(s0.fdvToMcap, 1)}× capitalizarea`); }
    else if (s0.fdvToMcap > 2) { s -= 12; parts.push(`FDV = ${round(s0.fdvToMcap, 1)}× capitalizarea`); }
    else if (s0.fdvToMcap <= 1.2) { s += 8; parts.push('FDV apropiat de capitalizare'); }
  }
  if (s0.unlockWithin30d) { s -= 25; parts.push('deblocare semnificativă în următoarele 30 de zile'); }
  if (isNum(s0.inflationPctYear)) {
    if (s0.inflationPctYear > 40) { s -= 15; parts.push(`emisiune ~${round(s0.inflationPctYear, 0)}%/an`); }
    else if (s0.inflationPctYear < 5) { s += 5; parts.push('emisiune mică'); }
  }
  return { score: round(clamp(s, 0, 100), 1), quality: QUALITY.MEDIUM, evidence: parts.join('; ') };
}

/** STRUCTURE (10) — is price coiled under a level, or already extended? */
function structureFactor(a) {
  const d = a.features?.daily;
  const smc = a.futures?.setup;
  const parts = [];
  let s = null;
  if (smc?.score) { s = smc.score; parts.push(`structură 4H: ${smc.smc.structure.toLowerCase()}`); }
  if (d) {
    let t = 50;
    if (isNum(d.compression)) {
      t += d.compression < 0.7 ? 18 : d.compression > 1.6 ? -12 : 0;
      parts.push(`compresie ${round(d.compression, 2)}`);
    }
    if (isNum(d.rangePos30)) {
      t += d.rangePos30 < 0.35 ? 8 : d.rangePos30 > 0.9 ? -14 : 4;
      parts.push(`poziție în interval 30z: ${Math.round(d.rangePos30 * 100)}%`);
    }
    if (d.higherLows >= 2) { t += 10; parts.push(`${d.higherLows} minime crescătoare`); }
    if (isNum(d.dd30) && d.dd30 < -45) { t -= 10; parts.push(`-${Math.round(Math.abs(d.dd30))}% de la maximul de 30 zile`); }
    s = isNum(s) ? s * 0.6 + clamp(t, 0, 100) * 0.4 : clamp(t, 0, 100);
  }
  return { score: isNum(s) ? round(s, 1) : null, quality: q(isNum(s), smc ? QUALITY.HIGH : QUALITY.MEDIUM), evidence: parts.join('; ') || 'fără serii de preț' };
}

/** MARKET REGIME (5) — is the tide helping or fighting this thesis? */
function regimeFactor(market) {
  if (!market?.regime) return { score: null, quality: QUALITY.UNKNOWN, evidence: 'regimul de piață nu a putut fi calculat' };
  const parts = [`regim: ${market.regime.label ?? market.regime.state}`];
  let s = isNum(market.regime.score) ? market.regime.score : 50;
  if (isNum(market.altseason?.value)) {
    parts.push(`indice altseason ${Math.round(market.altseason.value)}/100 (calculat local)`);
    s = s * 0.75 + market.altseason.value * 0.25;
  }
  if (isNum(market.fearGreed?.value)) parts.push(`fear & greed ${market.fearGreed.value} (${market.fearGreed.label})`);
  return { score: round(clamp(s, 0, 100), 1), quality: QUALITY.MEDIUM, evidence: parts.join('; ') };
}

/** NARRATIVE (5) — is the sector this token belongs to being bid? */
function narrativeFactor(a) {
  const n = a.narrative;
  if (!n || !isNum(n.score)) return { score: null, quality: QUALITY.UNKNOWN, evidence: 'fără clasificare de narațiune' };
  return {
    score: round(n.score, 1),
    quality: n.coverage > 0.5 ? QUALITY.MEDIUM : QUALITY.LOW,
    evidence: `${n.label ?? 'sector necunoscut'}: ${round(n.score, 0)}/100${isNum(n.change7d) ? `, ${n.change7d > 0 ? '+' : ''}${round(n.change7d, 1)}% pe 7 zile` : ''}`,
  };
}

/* ── composition ─────────────────────────────────────────────────────────────────────────────── */

/**
 * @param {{asset:any, cmp:any, market:any}} input
 * @returns {{score:number|null, band:string, bandLabel:string, confidence:number, coverage:number,
 *   factors:any[], missing:any[], redistributed:boolean}}
 */
export function preExpansionScore({ asset, cmp, market }) {
  const f = {
    volume: volumeFactor(asset, cmp),
    liquidity: liquidityFactor(asset, cmp),
    holders: holdersFactor(asset, cmp),
    whales: whaleFactor(asset),
    supply: supplyFactor(asset),
    structure: structureFactor(asset),
    regime: regimeFactor(market),
    narrative: narrativeFactor(asset),
  };
  const labels = {
    volume: 'Volum',
    liquidity: 'Lichiditate',
    holders: 'Deținători',
    whales: 'Whale intelligence',
    supply: 'Presiune de supply',
    structure: 'Structură',
    regime: 'Regim de piață',
    narrative: 'Narațiune',
  };
  /*
   * A quote flagged STALE_QUOTE upstream (universe.js, > 6h old against the run clock) is real data
   * measured at the wrong moment. The reading is kept — dropping it would be the "UNKNOWN is bearish"
   * mistake in reverse — but every factor derived from that price is graded STALE, so it contributes
   * at 0.4 instead of full weight to Confidence. This is the only producer of the STALE grade.
   */
  const staleQuote = (asset.quality?.flags ?? []).includes('STALE_QUOTE');
  const gradeOfFactor = (key, quality) =>
    (staleQuote && PRICE_DERIVED.has(key) && quality !== QUALITY.UNKNOWN ? QUALITY.STALE : quality);

  const factors = Object.entries(PRE_EXPANSION_WEIGHTS).map(([key, weight]) => ({
    key,
    label: labels[key],
    weight,
    score: f[key].score,
    quality: gradeOfFactor(key, f[key].quality),
    evidence: f[key].evidence,
  }));
  const w = weightedScore(factors, { minCoverage: 0.45 });
  const b = bandOf(w.score);
  return {
    score: w.score,
    band: b.band,
    bandLabel: b.label,
    confidence: w.confidence,
    coverage: w.coverage,
    factors: w.factors,
    missing: w.missing,
    redistributed: w.redistributed,
  };
}
