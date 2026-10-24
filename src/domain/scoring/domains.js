/**
 * Domain evidence builders. Each domain turns raw facts into an explainable 0..100 score with
 * its own confidence. Missing facts reduce completeness/confidence — they never lower the score
 * ("UNKNOWN is not bearish", the founding CRI rule).
 */
import { band, bell, clamp, isNum, log10, round } from '../shared/math.js';
import { smcScore } from '../features/smc.js';
import { catalystBalance } from '../catalysts/catalysts.js';

export const DOMAIN_LABELS = {
  similarity: 'Similaritate LAB/BTW/AGT',
  structure: 'Structură 1D/4H (SMC)',
  setup: 'Setup tokenomics & bază',
  activity: 'Activitate & flux volum',
  derivatives: 'Poziționare derivate',
  onchain: 'On-chain & holderi',
  catalyst: 'Catalizatori',
  attention: 'Atenție / hype',
  fundamentals: 'Fundamente (TVL, fees, dev)',
};

/**
 * @param {string} id
 * @param {{key:string,label:string,value:any,display?:string,score:number|null,weight:number}[]} facts
 * @param {{sourceQuality?:number, sources?:string[], minCompleteness?:number, notes?:string[], proxy?:boolean}} opts
 */
export function composeDomain(id, facts, { sourceQuality = 0.85, sources = [], minCompleteness = 0.25, notes = [], proxy = false } = {}) {
  const all = facts.reduce((s, f) => s + f.weight, 0);
  const avail = facts.filter((f) => isNum(f.score));
  const availW = avail.reduce((s, f) => s + f.weight, 0);
  const completeness = all > 0 ? availW / all : 0;
  if (!avail.length || completeness < minCompleteness) {
    return { id, label: DOMAIN_LABELS[id], state: 'UNKNOWN', score: null, confidence: 0, completeness, facts: facts.map(packFact), sources, notes, proxy };
  }
  const score = avail.reduce((s, f) => s + f.score * f.weight, 0) / availW;
  const confidence = clamp(completeness * sourceQuality * (proxy ? 0.55 : 1), 0, 1);
  return {
    id,
    label: DOMAIN_LABELS[id],
    state: 'AVAILABLE',
    score: round(score, 1),
    confidence: round(confidence, 3),
    completeness: round(completeness, 3),
    direction: score >= 62 ? 'BULLISH' : score <= 38 ? 'BEARISH' : 'NEUTRAL',
    facts: facts.map(packFact),
    sources,
    notes,
    proxy,
  };
}

function packFact(f) {
  return { key: f.key, label: f.label, display: f.display ?? (isNum(f.value) ? String(round(f.value, 4)) : f.value ?? null), score: isNum(f.score) ? round(f.score, 1) : null, weight: f.weight };
}

const signedUsd = (x) => (isNum(x) ? `${x >= 0 ? '+' : '−'}${usd(Math.abs(x))}` : null);
const pct = (x, d = 0) => (isNum(x) ? `${x > 0 ? '+' : ''}${x.toFixed(d)}%` : null);
const usd = (x) => {
  if (!isNum(x)) return null;
  const a = Math.abs(x);
  if (a >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(x / 1e3).toFixed(0)}K`;
  return `$${x.toFixed(0)}`;
};

/** Setup: size, float, reset from ATH, age — the structural preconditions LAB/BTW/AGT shared. */
export function setupDomain(lf) {
  return composeDomain('setup', [
    { key: 'size', label: 'Market cap (zona $10M–$150M)', value: lf.mcap, display: usd(lf.mcap), score: bell(log10(lf.mcap), 7.6, 0.55), weight: 0.3 },
    { key: 'float', label: 'Float circulant (low float = squeeze)', value: lf.floatRatio, display: isNum(lf.floatRatio) ? `${(lf.floatRatio * 100).toFixed(0)}%` : null, score: band(lf.floatRatio, 0.85, 0.08), weight: 0.3 },
    { key: 'reset', label: 'Distanță de ATH (bază resetată)', value: lf.athChangePct, display: pct(lf.athChangePct), score: bell(lf.athChangePct, -78, 20), weight: 0.2 },
    { key: 'age', label: 'Vechime listare', value: lf.ageDays, display: isNum(lf.ageDays) ? `${lf.ageDays.toFixed(0)} zile` : null, score: bell(log10(lf.ageDays), Math.log10(240), 0.38), weight: 0.2 },
  ], { sourceQuality: 0.85, sources: lf.sources });
}

/** Structure: 1D trend/readiness + 4H Smart Money Concepts. Falls back to a % change proxy. */
export function structureDomain(lf, d1, h4) {
  if (d1) {
    const ema = d1.aboveEma20 && d1.emaAligned ? 85 : d1.aboveEma50 ? 62 : d1.aboveEma20 ? 55 : 25;
    const quality = isNum(d1.slope30) && isNum(d1.r2_30) ? (d1.slope30 > 0 ? d1.r2_30 * 100 : (1 - d1.r2_30) * 50) : null;
    return composeDomain('structure', [
      { key: 'ema', label: 'Aliniere EMA20/EMA50 (1D)', value: ema, display: d1.aboveEma20 ? 'peste EMA20' : 'sub EMA20', score: ema, weight: 0.18 },
      { key: 'slope', label: 'Pantă 30z (%/zi)', value: d1.slope30, display: isNum(d1.slope30) ? `${d1.slope30.toFixed(2)}%/zi` : null, score: band(d1.slope30, -1.2, 1.8), weight: 0.14 },
      { key: 'quality', label: 'Calitate trend (R²)', value: d1.r2_30, display: isNum(d1.r2_30) ? d1.r2_30.toFixed(2) : null, score: quality, weight: 0.08 },
      { key: 'range', label: 'Poziție în range-ul 30z', value: d1.rangePos30, display: isNum(d1.rangePos30) ? `${(d1.rangePos30 * 100).toFixed(0)}%` : null, score: band(d1.rangePos30, 0.35, 0.95), weight: 0.14 },
      { key: 'compression', label: 'Compresie volatilitate (7z/30z)', value: d1.compression, display: isNum(d1.compression) ? d1.compression.toFixed(2) : null, score: band(d1.compression, 1.4, 0.6), weight: 0.12 },
      { key: 'rsi', label: 'RSI 1D (zonă sănătoasă 50–70)', value: d1.rsi14, display: isNum(d1.rsi14) ? d1.rsi14.toFixed(0) : null, score: bell(d1.rsi14, 60, 13), weight: 0.1 },
      { key: 'smc', label: 'Structură SMC 4H (BOS/CHoCH, OB, FVG, sweep)', value: h4?.structure ?? null, display: h4 ? `${h4.structure}${h4.lastEvent ? `, ${h4.lastEvent.type} ${h4.lastEvent.dir}` : ''}` : null, score: smcScore(h4), weight: 0.24 },
    ], { sourceQuality: 0.9, sources: ['mexc'] });
  }
  return composeDomain('structure', [
    { key: 'c7', label: 'Variație 7z (proxy)', value: lf.change7d, display: pct(lf.change7d), score: bell(lf.change7d, 12, 25), weight: 0.4 },
    { key: 'c30', label: 'Variație 30z (proxy)', value: lf.change30d, display: pct(lf.change30d), score: bell(lf.change30d, 20, 45), weight: 0.4 },
    { key: 'c24', label: 'Variație 24h (proxy)', value: lf.change24h, display: pct(lf.change24h), score: bell(lf.change24h, 4, 10), weight: 0.2 },
  ], { sourceQuality: 0.8, sources: lf.sources, proxy: true, notes: ['fără lumânări: estimare din variații procentuale'] });
}

/** Activity: turnover, volume acceleration, up-volume share, rank velocity. */
export function activityDomain(lf, d1) {
  return composeDomain('activity', [
    { key: 'turnover', label: 'Turnover volum/market cap', value: lf.turnover, display: isNum(lf.turnover) ? `${(lf.turnover * 100).toFixed(1)}%` : null, score: band(log10(lf.turnover), Math.log10(0.03), Math.log10(0.5)), weight: 0.32 },
    { key: 'volAccel', label: 'Accelerare volum 7z vs 30z', value: d1?.volAccel ?? lf.turnoverAccel, display: isNum(d1?.volAccel ?? lf.turnoverAccel) ? `x${(d1?.volAccel ?? lf.turnoverAccel).toFixed(2)}` : null, score: band(d1?.volAccel ?? lf.turnoverAccel, 0.9, 2.8), weight: 0.28 },
    { key: 'upVol', label: 'Volum pe zile verzi (14z)', value: d1?.upVolRatio, display: isNum(d1?.upVolRatio) ? `${(d1.upVolRatio * 100).toFixed(0)}%` : null, score: band(d1?.upVolRatio, 0.42, 0.7), weight: 0.2 },
    { key: 'rankVelocity', label: 'Urcare în clasament (~7z)', value: lf.rankGain7d, display: isNum(lf.rankGain7d) ? `${lf.rankGain7d > 0 ? '+' : ''}${lf.rankGain7d} poziții` : null, score: band(lf.rankGain7d, -40, 150), weight: 0.2 },
  ], { sourceQuality: 0.85, sources: lf.sources });
}

function fundingScore(f) {
  if (!isNum(f)) return null;
  if (f <= -0.0003) return 85;
  if (f <= 0.0001) return 85 - ((f + 0.0003) / 0.0004) * 25; // 85 → 60
  if (f <= 0.0005) return 60 - ((f - 0.0001) / 0.0004) * 25; // 60 → 35
  if (f <= 0.001) return 35 - ((f - 0.0005) / 0.0005) * 20; // 35 → 15
  return 10;
}

/** Derivatives: venues, OI relative to market cap, funding sign, OI momentum, squeeze fuel. */
export function derivativesDomain(lf) {
  if (!lf.perpsKnown) return composeDomain('derivatives', [], { sources: [] });
  if (!lf.perpVenues) {
    return { id: 'derivatives', label: DOMAIN_LABELS.derivatives, state: 'UNKNOWN', score: null, confidence: 0, completeness: 0, facts: [], sources: lf.perpSources, notes: ['fără contracte perpetual listate'], proxy: false };
  }
  const squeeze = isNum(lf.oiChangePct) && isNum(lf.fundingAvg) ? (lf.oiChangePct >= 15 && lf.fundingAvg <= 0 && (lf.change7d ?? 0) > -5 ? 88 : lf.oiChangePct >= 15 && lf.fundingAvg >= 0.0006 ? 25 : 55) : null;
  return composeDomain('derivatives', [
    { key: 'venues', label: 'Venue-uri cu perpetual', value: lf.perpVenues, display: `${lf.perpVenues}`, score: band(lf.perpVenues, 0, 3), weight: 0.18 },
    { key: 'oiToMcap', label: 'Open interest / market cap', value: lf.oiToMcap, display: isNum(lf.oiToMcap) ? `${(lf.oiToMcap * 100).toFixed(1)}%` : null, score: bell(log10(lf.oiToMcap), Math.log10(0.15), 0.45), weight: 0.24 },
    { key: 'funding', label: 'Funding mediu (negativ = shorts plătesc)', value: lf.fundingAvg, display: isNum(lf.fundingAvg) ? `${(lf.fundingAvg * 100).toFixed(4)}%` : null, score: fundingScore(lf.fundingAvg), weight: 0.24 },
    { key: 'oiChange', label: 'Variație OI (~24h)', value: lf.oiChangePct, display: pct(lf.oiChangePct), score: band(lf.oiChangePct, -15, 60), weight: 0.16 },
    { key: 'squeeze', label: 'Combustibil short-squeeze (OI↑ + funding≤0)', value: squeeze, display: squeeze === 88 ? 'DA' : squeeze === 25 ? 'long-uri înghesuite' : squeeze === null ? null : 'neutru', score: squeeze, weight: 0.18 },
  ], { sourceQuality: 0.85, sources: lf.perpSources });
}

/**
 * On-chain: holders, holder growth, DEX liquidity depth, DEX buy pressure, Binance Alpha, and the
 * Arkham wallet-intelligence facts (net wallet flow, exchange withdrawals vs deposits, persistence
 * of accumulation). Without Arkham those facts are UNKNOWN and simply drop out of the average.
 */
export function onchainDomain(lf, oc) {
  const alphaScore = lf.alphaStatus === 'LISTED' ? (lf.alphaListingCex ? 85 : 72) : null;
  const wf = oc?.walletFlows ?? null;
  const per = wf?.persistence ?? null;
  return composeDomain('onchain', [
    { key: 'holders', label: 'Număr holderi', value: oc?.holders, display: isNum(oc?.holders) ? oc.holders.toLocaleString('en-US') : null, score: band(log10(oc?.holders), 3, 5.3), weight: 0.13 },
    { key: 'holdersGrowth', label: 'Creștere holderi (~7z)', value: oc?.holdersChangePct, display: pct(oc?.holdersChangePct, 1), score: band(oc?.holdersChangePct, -2, 15), weight: 0.17 },
    { key: 'dexLiquidity', label: 'Lichiditate DEX / market cap', value: oc?.liqToMcap, display: isNum(oc?.liqToMcap) ? `${(oc.liqToMcap * 100).toFixed(2)}% (${usd(oc.dexLiquidityUsd)})` : null, score: band(log10(oc?.liqToMcap), Math.log10(0.004), Math.log10(0.08)), weight: 0.14 },
    { key: 'buyPressure', label: 'Presiune cumpărare DEX (buys/sells 24h)', value: oc?.buySellRatio, display: isNum(oc?.buySellRatio) ? oc.buySellRatio.toFixed(2) : null, score: band(oc?.buySellRatio, 0.85, 1.5), weight: 0.17 },
    { key: 'alpha', label: 'Binance Alpha (canal de descoperire)', value: lf.alphaStatus, display: lf.alphaStatus === 'LISTED' ? (lf.alphaListingCex ? 'Alpha + CEX' : 'listat') : lf.alphaStatus === 'NOT_LISTED' ? 'nelistat' : null, score: alphaScore, weight: 0.13 },
    { key: 'walletFlow', label: 'Flux net portofele, 7z (Arkham)', value: wf?.netflowRatio ?? null, display: isNum(wf?.netflowRatio) ? `${pct(wf.netflowRatio * 100)} (${signedUsd(wf.walletNetUsd)})` : null, score: band(wf?.netflowRatio, -0.3, 0.35), weight: 0.12 },
    { key: 'exchangeFlow', label: 'Exchange-uri: retrageri vs depuneri, 7z (Arkham)', value: wf?.exchangeBias ?? null, display: isNum(wf?.exchangeBias) ? `${wf.exchangeBias >= 0 ? `retrageri nete ${usd(-wf.exchangeNetUsd)}` : `depuneri nete ${usd(wf.exchangeNetUsd)}`} (${Math.abs(wf.exchangeBias * 100).toFixed(0)}% din fluxul CEX)` : null, score: band(wf?.exchangeBias, -0.4, 0.5), weight: 0.08 },
    { key: 'flowPersistence', label: 'Persistența acumulării (Arkham, observații recente)', value: per?.share ?? null, display: per ? `${per.positive}/${per.total} pozitive` : null, score: band(per?.share, 0.2, 0.9), weight: 0.06 },
  ], { sourceQuality: 0.92, sources: oc?.sources ?? (lf.alphaStatus === 'LISTED' ? ['binance_alpha'] : []), minCompleteness: 0.14 });
}

export function catalystDomain(events, nowMs) {
  const bal = catalystBalance(events, nowMs);
  if (!bal) return { id: 'catalyst', label: DOMAIN_LABELS.catalyst, state: 'UNKNOWN', score: null, confidence: 0, completeness: 0, facts: [], sources: [], notes: ['niciun catalizator detectat în fereastră (neutru)'], proxy: false };
  const sources = [...new Set(events.map((e) => e.source))];
  return composeDomain('catalyst', [
    { key: 'balance', label: 'Balanța catalizatorilor (decay 7z)', value: bal.score, display: `+${bal.positive.toFixed(2)} / −${bal.negative.toFixed(2)}`, score: bal.score, weight: 1 },
  ], { sourceQuality: clamp(0.55 + 0.1 * events.length, 0.55, 0.9), sources });
}

export function attentionDomain(hype, attentionKnown) {
  const map = { STEALTH: 62, EMERGING: 78, HYPED: 30, EXHAUSTED: 22 };
  const s = map[hype.state] ?? null;
  return composeDomain('attention', [
    { key: 'hype', label: 'Ciclu de atenție (înainte de hype = bine)', value: hype.state, display: hype.state, score: attentionKnown ? s : null, weight: 1 },
  ], { sourceQuality: hype.state === 'STEALTH' ? 0.5 : 0.8, sources: ['coingecko', 'dexscreener', 'geckoterminal'] });
}

export function fundamentalsDomain(fund, dev) {
  return composeDomain('fundamentals', [
    { key: 'tvlChange7d', label: 'TVL 7z (DefiLlama)', value: fund?.tvlChange7d, display: pct(fund?.tvlChange7d, 1), score: band(fund?.tvlChange7d, -15, 40), weight: 0.3 },
    { key: 'mcapToTvl', label: 'Market cap / TVL', value: fund?.mcapToTvl, display: isNum(fund?.mcapToTvl) ? fund.mcapToTvl.toFixed(2) : null, score: band(log10(fund?.mcapToTvl), Math.log10(20), Math.log10(0.5)), weight: 0.2 },
    { key: 'fees', label: 'Fees 30z, trend lunar', value: fund?.feesChange1m, display: pct(fund?.feesChange1m), score: band(fund?.feesChange1m, -20, 60), weight: 0.25 },
    { key: 'dev', label: 'Commit-uri 4 săpt. (GitHub via CoinGecko)', value: dev?.commits4w, display: isNum(dev?.commits4w) ? `${dev.commits4w}` : null, score: band(dev?.commits4w, 0, 50), weight: 0.25 },
  ], { sourceQuality: 0.9, sources: ['defillama', 'coingecko'] });
}

export function similarityDomain(analogs) {
  const best = analogs?.best;
  if (!best || !isNum(best.similarity)) {
    return { id: 'similarity', label: DOMAIN_LABELS.similarity, state: 'UNKNOWN', score: null, confidence: 0, completeness: 0, facts: [], sources: [], notes: ['acoperire insuficientă pentru comparație'], proxy: false };
  }
  const consensusBoost = (analogs.supporting ?? 0) >= 2 ? 1 : 0.88;
  const seqFactor = isNum(best.sequenceSim) ? 1 : 0.9;
  return composeDomain('similarity', [
    { key: 'best', label: `Cel mai apropiat analog: ${best.ref}`, value: best.similarity, display: `${best.similarity.toFixed(0)}%`, score: best.similarity, weight: 0.7 },
    { key: 'consensus', label: 'Consens analogi (media top-2)', value: analogs.consensus, display: isNum(analogs.consensus) ? `${analogs.consensus.toFixed(0)}%` : null, score: analogs.consensus, weight: 0.3 },
  ], { sourceQuality: clamp((best.coverage ?? 0.6) * consensusBoost * seqFactor, 0.3, 1), sources: ['reference_library'] });
}
