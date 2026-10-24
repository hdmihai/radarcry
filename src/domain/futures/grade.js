/**
 * FUTURES RADAR · composition and grading.
 *
 * Weights, grades and hard filters are taken from the technical solution verbatim:
 *   1D Trend          25
 *   4H Structure      30
 *   Futures/Position  25
 *   Liquidity         10
 *   Volume/Volatility 10
 *
 *   A++ ≥ 95 · A+ ≥ 90 · A ≥ 85 · B ≥ 80 · altfel NO_TRADE
 *
 * Hard filters (they override the arithmetic, which is the whole point of having them):
 *   · 1D STRONG BEAR  → no LONG at all, whatever the 4H looks like
 *   · extreme funding → grade capped at B
 *   · chase > 8 %     → grade capped at B
 *   · R:R < 2         → grade capped at B
 */
import { clamp, isNum, round } from '../shared/math.js';
import { QUALITY, weightedScore } from '../quality/data-quality.js';
import { TREND } from './trend.js';

export const FUTURES_WEIGHTS = { trend1d: 25, structure4h: 30, positioning: 25, liquidity: 10, volume: 10 };

export const GRADE_CUTS = [
  { grade: 'A++', min: 95 },
  { grade: 'A+', min: 90 },
  { grade: 'A', min: 85 },
  { grade: 'B', min: 80 },
];

export const GRADE_ORDER = ['NO_TRADE', 'B', 'A', 'A+', 'A++'];

export const RR_MIN = 2;

export function gradeOf(score) {
  if (!isNum(score)) return 'NO_TRADE';
  for (const c of GRADE_CUTS) if (score >= c.min) return c.grade;
  return 'NO_TRADE';
}

const capGrade = (grade, max) => (GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(max) ? max : grade);

/** Liquidity sub-score (10 points): can a position actually be entered and exited here? */
export function liquidityScore({ volume24hUsd, turnover, perpVolume24hUsd, oiUsd, depthUsd, venues }) {
  const reasons = [];
  let points = 50;
  if (isNum(volume24hUsd)) {
    if (volume24hUsd >= 100e6) { points += 22; reasons.push('volum spot peste 100M$/zi'); }
    else if (volume24hUsd >= 25e6) { points += 14; reasons.push('volum spot peste 25M$/zi'); }
    else if (volume24hUsd >= 5e6) { points += 6; reasons.push('volum spot peste 5M$/zi'); }
    else if (volume24hUsd < 1e6) { points -= 20; reasons.push('volum spot sub 1M$/zi — ieșirea e scumpă'); }
  }
  if (isNum(perpVolume24hUsd) && perpVolume24hUsd > 0) {
    if (perpVolume24hUsd >= 50e6) { points += 12; reasons.push('volum perpetual peste 50M$/zi'); }
    else if (perpVolume24hUsd < 2e6) { points -= 10; reasons.push('volum perpetual subțire'); }
  }
  if (isNum(turnover)) {
    if (turnover > 0.03 && turnover < 1.2) { points += 8; reasons.push(`rotație sănătoasă (${round(turnover * 100, 1)}% din capitalizare/zi)`); }
    else if (turnover >= 1.2) { points -= 8; reasons.push('rotație extremă — probabil activitate artificială'); }
  }
  if (isNum(venues)) {
    if (venues >= 3) { points += 6; reasons.push(`${venues} burse cu perpetue`); }
    else if (venues === 0) { points -= 6; reasons.push('nicio bursă cu perpetue'); }
  }
  if (isNum(depthUsd) && depthUsd > 0) {
    if (depthUsd >= 500_000) { points += 6; reasons.push('adâncime DEX peste 500k$'); }
    else if (depthUsd < 100_000) { points -= 10; reasons.push('adâncime DEX sub 100k$'); }
  }
  return { score: clamp(points, 0, 100), reasons };
}

/** Volume / volatility sub-score (10 points): is there fuel, and is the move still coiled? */
export function volumeVolatilityScore({ volAccel, compression, atrPct, rvol, changePct24h }) {
  const reasons = [];
  let points = 50;
  if (isNum(volAccel)) {
    if (volAccel >= 2.5) { points += 22; reasons.push(`volum 7z = ${round(volAccel, 2)}× media de 30z`); }
    else if (volAccel >= 1.5) { points += 14; reasons.push(`volum în accelerare (${round(volAccel, 2)}×)`); }
    else if (volAccel < 0.7) { points -= 12; reasons.push('volum în scădere față de media de 30 zile'); }
  }
  if (isNum(rvol)) {
    if (rvol >= 3) { points += 10; reasons.push(`volum relativ ${round(rvol, 1)}× față de normal`); }
    else if (rvol < 0.6) { points -= 6; reasons.push('volum relativ sub normal'); }
  }
  if (isNum(compression)) {
    if (compression < 0.7) { points += 12; reasons.push(`volatilitate comprimată (${round(compression, 2)}) — energie acumulată`); }
    else if (compression > 1.6) { points -= 8; reasons.push('volatilitate deja în expansiune'); }
  }
  if (isNum(atrPct)) {
    if (atrPct > 18) { points -= 12; reasons.push(`ATR ${round(atrPct, 1)}%/zi — prea volatil pentru un stop rezonabil`); }
    else if (atrPct >= 4 && atrPct <= 12) { points += 6; reasons.push(`ATR ${round(atrPct, 1)}%/zi — interval lucrabil`); }
  }
  if (isNum(changePct24h) && changePct24h > 25) { points -= 10; reasons.push(`deja +${round(changePct24h, 1)}% în 24h`); }
  return { score: clamp(points, 0, 100), reasons };
}

/**
 * Compose the five blocks into the final Futures Radar verdict.
 *
 * @param {{trend:any, setup:any, positioning:any, liquidity:any, volume:any, levels:any}} parts
 * @returns {{score:number|null, grade:string, rawGrade:string, confidence:number, blocks:any[],
 *   caps:string[], blocked:string[], verdict:string, reasons:string[], missing:any[]}}
 */
export function futuresGrade({ trend, setup, positioning, liquidity, volume, levels }) {
  /*
   * Data quality per block, stated rather than assumed: exchange candles are a primary source, while
   * a positioning block built without a funding reading, or a liquidity block with no on-chain depth,
   * is a weaker measurement and must lower Confidence accordingly.
   */
  const factors = [
    {
      key: 'trend1d',
      label: 'Trend 1D',
      weight: FUTURES_WEIGHTS.trend1d,
      score: trend?.score ?? null,
      quality: trend ? (trend.bars >= 200 ? QUALITY.HIGH : QUALITY.MEDIUM) : QUALITY.UNKNOWN,
      evidence: trend ? trend.reasons.slice(0, 3).join('; ') : 'fără lumânări 1D suficiente',
    },
    {
      key: 'structure4h',
      label: 'Structură 4H',
      weight: FUTURES_WEIGHTS.structure4h,
      score: setup?.score ?? null,
      quality: setup ? QUALITY.HIGH : QUALITY.UNKNOWN,
      evidence: setup ? setup.reasons.slice(0, 3).join('; ') : 'fără lumânări 4H suficiente',
    },
    {
      key: 'positioning',
      label: 'Futures / poziționare',
      weight: FUTURES_WEIGHTS.positioning,
      score: positioning?.score ?? null,
      quality: !positioning ? QUALITY.UNKNOWN
        : isNum(positioning.fundingPct8h) && positioning.regime !== 'UNKNOWN' ? QUALITY.HIGH
          : isNum(positioning.fundingPct8h) ? QUALITY.MEDIUM : QUALITY.LOW,
      evidence: positioning ? positioning.reasons.slice(0, 3).join('; ') : 'fără date de derivate',
    },
    {
      key: 'liquidity',
      label: 'Lichiditate',
      weight: FUTURES_WEIGHTS.liquidity,
      score: liquidity?.score ?? null,
      quality: liquidity ? QUALITY.HIGH : QUALITY.UNKNOWN,
      evidence: liquidity ? liquidity.reasons.slice(0, 2).join('; ') : 'fără date de lichiditate',
    },
    {
      key: 'volume',
      label: 'Volum / volatilitate',
      weight: FUTURES_WEIGHTS.volume,
      score: volume?.score ?? null,
      quality: volume ? QUALITY.MEDIUM : QUALITY.UNKNOWN,
      evidence: volume ? volume.reasons.slice(0, 2).join('; ') : 'fără serii de volum',
    },
  ];
  const w = weightedScore(factors, { minCoverage: 0.5 });
  const rawGrade = gradeOf(w.score);
  let grade = rawGrade;
  const caps = [];
  const blocked = [];

  if (trend?.regime === TREND.STRONG_BEAR) {
    blocked.push('Trend 1D puternic descendent — direcția LONG este exclusă, oricât de bun ar fi 4H');
    grade = 'NO_TRADE';
  }

  /*
   * A cap is only reported when it actually lowered the grade. A setup already below the 80-point
   * threshold has nothing to cap, and announcing "plafonată la B" next to a NO_TRADE badge would say
   * two contradictory things at once. The condition that *would* have capped it is still visible in
   * the positioning and structure reasons — it just is not presented as the thing that decided the
   * note, because it was not.
   */
  const applyCap = (condition, message) => {
    if (!condition) return;
    const before = grade;
    grade = capGrade(grade, 'B');
    if (grade !== before) caps.push(message);
  };
  applyCap(positioning?.capsAtB, 'funding extrem — nota este plafonată la B');
  applyCap(setup?.chasing, `preț la ${round(setup?.chasePct, 1)}% peste zona de intrare (>8%) — nota este plafonată la B`);
  applyCap(isNum(levels?.rr1) && levels.rr1 < RR_MIN, `raport câștig/risc ${round(levels?.rr1, 2)} < ${RR_MIN} — nota este plafonată la B`);

  if (w.score === null) {
    blocked.push('prea puține blocuri măsurabile pentru o notă (acoperire sub 50%)');
    grade = 'NO_TRADE';
  }

  const reasons = [
    ...(trend?.reasons ?? []).slice(0, 2),
    ...(setup?.reasons ?? []).slice(0, 3),
    ...(positioning?.reasons ?? []).slice(0, 2),
    ...(liquidity?.reasons ?? []).slice(0, 1),
    ...(volume?.reasons ?? []).slice(0, 2),
  ];

  const verdict = grade === 'NO_TRADE'
    ? (blocked[0] ?? 'nu întrunește pragul de 80 de puncte')
    : `${grade} — ${round(w.score, 1)}/100, încredere ${w.confidence}%`;

  return {
    score: w.score,
    grade,
    rawGrade,
    confidence: w.confidence,
    coverage: w.coverage,
    blocks: w.factors,
    missing: w.missing,
    caps,
    blocked,
    verdict,
    reasons,
  };
}
