/**
 * SMART MONEY SCORE — §6 of the technical solution, reproduced component by component.
 *
 * Positive components (max +100):
 *   +15  acumulare de whale-uri
 *   +15  acumulare de smart money (entități identificate: fonduri, adrese cu istoric)
 *   +10  retrageri de pe burse centralizate
 *   +10  creșterea numărului de deținători
 *   +10  creșterea lichidității
 *   +10  creșterea volumului
 *   +10  creșterea TVL / veniturilor
 *   +10  momentum de narațiune
 *    +5  extindere pe burse (listări noi)
 *    +5  activitate de dezvoltare
 *
 * Penalties (max −85):
 *   −15  concentrare de insideri
 *   −15  deblocare iminentă
 *   −15  depozite către burse centralizate
 *   −10  deteriorarea lichidității
 *   −10  FDV extrem
 *   −20  flux suspect de portofele
 *
 * The raw sum lives on a −85…+100 axis; the reported score maps it onto 0..100 with 0 raw at 46,
 * so "nothing detected" sits just under neutral rather than at the bottom — again because UNKNOWN
 * is not bearish. Every component that fired is listed with its evidence, so the number is readable.
 */
import { clamp, isNum, round } from '../shared/math.js';
import { HOLDER_CLASSES } from './labels.js';
import { VERDICT } from './holder-flows.js';

export const POSITIVE = {
  WHALE_ACCUMULATION: { points: 15, label: 'Acumulare de whale-uri' },
  SMART_MONEY_ACCUMULATION: { points: 15, label: 'Acumulare de smart money' },
  CEX_WITHDRAWALS: { points: 10, label: 'Retrageri de pe burse centralizate' },
  HOLDER_GROWTH: { points: 10, label: 'Creșterea numărului de deținători' },
  LIQUIDITY_GROWTH: { points: 10, label: 'Creșterea lichidității' },
  VOLUME_GROWTH: { points: 10, label: 'Creșterea volumului' },
  TVL_GROWTH: { points: 10, label: 'Creșterea TVL / veniturilor' },
  NARRATIVE_MOMENTUM: { points: 10, label: 'Momentum de narațiune' },
  EXCHANGE_EXPANSION: { points: 5, label: 'Extindere pe burse' },
  DEVELOPER_ACTIVITY: { points: 5, label: 'Activitate de dezvoltare' },
};

export const PENALTIES = {
  INSIDER_CONCENTRATION: { points: -15, label: 'Concentrare de insideri' },
  UNLOCK_IMMINENT: { points: -15, label: 'Deblocare iminentă' },
  CEX_DEPOSITS: { points: -15, label: 'Depozite către burse centralizate' },
  LIQUIDITY_DETERIORATION: { points: -10, label: 'Deteriorarea lichidității' },
  EXTREME_FDV: { points: -10, label: 'FDV extrem' },
  SUSPICIOUS_FLOW: { points: -20, label: 'Flux suspect de portofele' },
};

const MAX_POSITIVE = Object.values(POSITIVE).reduce((s, c) => s + c.points, 0);
const MAX_PENALTY = Object.values(PENALTIES).reduce((s, c) => s + c.points, 0);

/**
 * @param {{asset:any, cmp:any}} input
 * @returns {{score:number|null, raw:number, components:any[], penalties:any[], measured:number,
 *   coverage:number, note:string}}
 */
export function smartMoneyScore({ asset, cmp }) {
  const oc = asset.onchain ?? {};
  const flows = oc.flows ?? null;
  const classified = oc.classified ?? null;
  const components = [];
  const penalties = [];
  /** How many of the 16 components could be evaluated at all (coverage, not score). */
  let measurable = 0;

  /**
   * A component that fires earns at least FIRE_FLOOR of its points; the rest scales with how far
   * past the threshold the reading is. Without the floor, a reading exactly at the attachment's
   * threshold would score near zero, which would quietly move the thresholds themselves.
   */
  const FIRE_FLOOR = 0.6;
  const add = (key, fired, evidence, strength = 1) => {
    const def = POSITIVE[key];
    if (!def) return;
    measurable += 1;
    if (!fired) return;
    const scale = FIRE_FLOOR + (1 - FIRE_FLOOR) * clamp(strength, 0, 1);
    components.push({ key, label: def.label, points: round(def.points * scale, 2), evidence });
  };
  const pen = (key, fired, evidence) => {
    const def = PENALTIES[key];
    if (!def) return;
    measurable += 1;
    if (!fired) return;
    penalties.push({ key, label: def.label, points: def.points, evidence });
  };
  const skip = () => {};

  /* ── positive components ───────────────────────────────────────────────────────────────────── */

  if (flows && flows.verdict !== VERDICT.UNKNOWN) {
    add('WHALE_ACCUMULATION',
      [VERDICT.ACCUMULATION, VERDICT.ACCUMULATING].includes(flows.verdict),
      `${flows.accumulating} portofele mari în creștere, ${flows.distributing} în scădere (${flows.verdictLabel})`,
      flows.verdict === VERDICT.ACCUMULATION ? 1 : 0.6);
  } else skip();

  // Smart money = identified funds / institutions increasing, which needs a label source.
  const fundMovers = (flows?.movers ?? []).filter((m) => m.class === HOLDER_CLASSES.FUND && isNum(m.delta) && m.delta > 0);
  if (flows && flows.verdict !== VERDICT.UNKNOWN && (classified?.byClass?.fund || fundMovers.length)) {
    add('SMART_MONEY_ACCUMULATION', fundMovers.length > 0,
      fundMovers.length ? `${fundMovers.length} entități identificate în acumulare: ${fundMovers.slice(0, 3).map((m) => m.entity ?? m.address.slice(0, 10)).join(', ')}` : 'nicio entitate identificată în acumulare');
  }

  const cexDelta = flows?.cexDeltaPct;
  if (isNum(cexDelta)) {
    add('CEX_WITHDRAWALS', cexDelta < -0.3, `soldul pe burse ${cexDelta > 0 ? '+' : ''}${round(cexDelta, 2)} puncte din supply`, Math.min(1, Math.abs(cexDelta) / 1.5));
  }

  const holderGrowth = cmp?.holders?.changePct;
  if (isNum(holderGrowth)) {
    add('HOLDER_GROWTH', holderGrowth >= 8, `deținători ${holderGrowth > 0 ? '+' : ''}${round(holderGrowth, 1)}% față de mediana proprie`, Math.min(1, holderGrowth / 25));
  }

  const liqGrowth = cmp?.liquidityUsd?.changePct;
  if (isNum(liqGrowth)) {
    add('LIQUIDITY_GROWTH', liqGrowth >= 20, `lichiditate ${liqGrowth > 0 ? '+' : ''}${round(liqGrowth, 1)}%`, Math.min(1, liqGrowth / 60));
  }

  const volZ = cmp?.volume24h?.z;
  if (isNum(volZ)) {
    add('VOLUME_GROWTH', volZ >= 2, `volum la z=${round(volZ, 1)} față de propria normă`, Math.min(1, volZ / 4));
  } else if (isNum(asset.features?.daily?.volAccel)) {
    const acc = asset.features.daily.volAccel;
    add('VOLUME_GROWTH', acc >= 1.6, `volum 7z/30z = ${round(acc, 2)}×`, Math.min(1, (acc - 1) / 2));
  }

  const tvlGrowth = isNum(cmp?.tvl?.changePct) ? cmp.tvl.changePct : asset.fundamentals?.tvlChange7d;
  const feesGrowth = asset.fundamentals?.feesChange1m;
  if (isNum(tvlGrowth) || isNum(feesGrowth)) {
    const byTvl = isNum(tvlGrowth) ? tvlGrowth : -Infinity;
    const byFees = isNum(feesGrowth) ? feesGrowth : -Infinity;
    const best = Math.max(byTvl, byFees);
    // Name the reading that actually fired the component, so the evidence cannot contradict it.
    const evidence = best === byTvl
      ? `TVL ${tvlGrowth > 0 ? '+' : ''}${round(tvlGrowth, 1)}%`
      : `venituri de protocol ${feesGrowth > 0 ? '+' : ''}${round(feesGrowth, 1)}% pe lună`;
    add('TVL_GROWTH', best >= 15, evidence, Math.min(1, best / 50));
  }

  if (isNum(asset.narrative?.score)) {
    add('NARRATIVE_MOMENTUM', asset.narrative.score >= 65, `${asset.narrative.label ?? 'sector'} la ${round(asset.narrative.score, 0)}/100`, (asset.narrative.score - 55) / 35);
  }

  const freshListings = (asset.catalysts ?? []).filter((c) => c.fresh && ['NEW_PERP', 'NEW_KRW_LISTING', 'NEW_BINANCE_SPOT', 'ALPHA_LISTED', 'NEW_SPOT_LISTING'].includes(c.type));
  if (asset.catalysts) {
    add('EXCHANGE_EXPANSION', freshListings.length > 0, freshListings.length ? freshListings.map((c) => c.label).join('; ') : 'nicio listare nouă în fereastra urmărită');
  }

  const commits = asset.social?.devCommits30d;
  if (isNum(commits)) {
    add('DEVELOPER_ACTIVITY', commits >= 15, `${commits} commit-uri în 30 de zile${isNum(asset.social?.devContributors) ? `, ${asset.social.devContributors} contribuitori` : ''}`, Math.min(1, commits / 60));
  }

  /* ── penalties ─────────────────────────────────────────────────────────────────────────────── */

  const insider = isNum(classified?.top10EffectivePct) ? classified.top10EffectivePct : isNum(oc.top10EffectivePct) ? oc.top10EffectivePct : oc.top10Pct;
  if (isNum(insider)) {
    pen('INSIDER_CONCENTRATION', insider >= 60, `top 10 efectiv deține ${round(insider, 1)}% din supply tranzacționabil`);
  }

  const supply = asset.risk?.supply;
  if (supply) {
    pen('UNLOCK_IMMINENT', supply.unlockWithin30d === true, supply.unlockNote ?? 'deblocare semnificativă în 30 de zile');
    pen('EXTREME_FDV', isNum(supply.fdvToMcap) && supply.fdvToMcap >= 4, isNum(supply.fdvToMcap) ? `FDV = ${round(supply.fdvToMcap, 1)}× capitalizarea` : '');
  }

  if (isNum(cexDelta)) {
    pen('CEX_DEPOSITS', cexDelta > 0.5, `soldul pe burse a crescut cu ${round(cexDelta, 2)} puncte din supply`);
  }

  if (isNum(liqGrowth)) {
    pen('LIQUIDITY_DETERIORATION', liqGrowth <= -20, `lichiditate ${round(liqGrowth, 1)}% față de mediana proprie`);
  }

  const suspicious = (flows?.flags ?? []).filter((f) => ['TEAM_TO_CEX', 'REPEATED_DISTRIBUTION', 'FLAGGED_INFLOW'].includes(f));
  const flaggedShare = classified?.flaggedSharePct;
  if (flows || isNum(flaggedShare)) {
    pen('SUSPICIOUS_FLOW', suspicious.length > 0 || (isNum(flaggedShare) && flaggedShare > 1),
      suspicious.length ? suspicious.join(', ') : `adrese semnalate dețin ${round(flaggedShare, 2)}% din supply`);
  }

  /* ── composition ──────────────────────────────────────────────────────────────────────────── */

  const totalComponents = Object.keys(POSITIVE).length + Object.keys(PENALTIES).length;
  const coverage = measurable / totalComponents;
  if (measurable < 5) {
    return {
      score: null,
      raw: 0,
      components,
      penalties,
      measured: measurable,
      coverage: round(coverage, 2),
      note: `doar ${measurable} din ${totalComponents} componente au putut fi evaluate — scorul nu este raportat (necunoscut nu înseamnă negativ)`,
    };
  }

  const raw = components.reduce((s, c) => s + c.points, 0) + penalties.reduce((s, c) => s + c.points, 0);
  // Map −85…+100 onto 0..100 with raw 0 landing at 46.
  const score = raw >= 0 ? 46 + (raw / MAX_POSITIVE) * 54 : 46 + (raw / Math.abs(MAX_PENALTY)) * 46;

  return {
    score: round(clamp(score, 0, 100), 1),
    raw: round(raw, 1),
    components: components.sort((a, b) => b.points - a.points),
    penalties: penalties.sort((a, b) => a.points - b.points),
    measured: measurable,
    coverage: round(coverage, 2),
    note: `${measurable}/${totalComponents} componente evaluabile; componentele nemăsurate nu scad scorul, doar acoperirea`,
  };
}
