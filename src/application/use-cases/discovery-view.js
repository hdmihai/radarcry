/**
 * Shapes one discovery row for the published snapshot — the Small-Cap Radar card a researcher reads.
 *
 * The rule for this file: nothing is computed here. Every number already exists in a domain result
 * with its own evidence and quality grade; this only selects and rounds what the dashboard needs,
 * so the contract stays small while remaining fully auditable.
 */
import { isNum, round, sig } from '../../domain/shared/math.js';
import { CLASS_LABEL_RO } from '../../domain/onchain/labels.js';

const pctRound = (x, d = 2) => (isNum(x) ? round(x, d) : null);

function holderTable(classified, { rows: maxRows = 15 } = {}) {
  if (!classified) return null;
  return {
    // The per-holder `reasons` array is dropped from the contract: `source` already says which
    // evidence decided the class, and 60 rows × 20 holders × 3 sentences is a megabyte of payload.
    rows: classified.holders.slice(0, maxRows).map((h) => ({
      address: h.address,
      share: pctRound(h.share, 3),
      balance: isNum(h.balance) ? sig(h.balance, 6) : null,
      class: h.class,
      classLabel: CLASS_LABEL_RO[h.class] ?? h.class,
      entity: h.entity ?? null,
      source: h.source,
      excluded: h.excluded,
      sellable: h.sellable,
    })),
    byClass: Object.entries(classified.byClass).map(([key, v]) => ({
      key,
      label: CLASS_LABEL_RO[key] ?? key,
      count: v.count,
      share: pctRound(v.share, 2),
    })).sort((a, b) => (b.share ?? 0) - (a.share ?? 0)),
    top10Pct: pctRound(classified.top10Pct),
    top20Pct: pctRound(classified.top20Pct),
    top50Pct: pctRound(classified.top50Pct),
    top10EffectivePct: pctRound(classified.top10EffectivePct),
    top20EffectivePct: pctRound(classified.top20EffectivePct),
    effectiveSharePct: pctRound(classified.effectiveSharePct),
  };
}

/**
 * @param {{asset:any, cmp:any, baseline:any, changed:any, pre:any, risk:any, verdict:any, thesis:any}} row
 * @param {{keys?:any, links?:any[], full?:boolean}} ctx
 *   `full` ships the complete evidence (holder table, every invalidator, the whole baseline
 *   comparison). It is reserved for the rows a researcher will actually open; the rest carry the
 *   verdict, the thesis and the changes, which is what a list needs. The dashboard can ask for more
 *   by opening the asset, and the next full run will have published it.
 */
export function discoveryView(row, ctx = {}) {
  const full = ctx.full !== false;
  const a = row.asset;
  const m = a.market ?? {};
  const oc = a.onchain ?? {};
  const d = a.derivatives ?? {};
  const v = row.verdict;

  return {
    key: a.key,
    symbol: a.symbol,
    name: a.name,
    rank: a.rank?.cmc ?? a.rank?.coingecko ?? null,
    chain: a.primary?.chain ?? null,
    contract: a.primary?.address ?? null,
    image: a.image ?? null,

    /* ── headline verdict ────────────────────────────────────────────────────────────────────── */
    verdict: {
      answersQuestion: v.answersQuestion,
      earlyResearchCandidate: v.earlyResearchCandidate,
      stage: v.stage,
      stageLabel: v.stageLabel,
      stageMeaning: v.stageMeaning,
      band: v.band,
      bandLabel: v.bandLabel,
      opportunity: pctRound(v.opportunity, 1),
      momentum: pctRound(v.momentum, 1),
      earliness: v.earliness,
      risk: v.risk,
      riskLevel: row.risk?.level ?? null,
      confidence: v.confidence,
      verdict: v.verdict,
      tests: v.tests,
      why: v.why,
    },

    /* ── the thesis a researcher reads ───────────────────────────────────────────────────────── */
    thesis: {
      headline: row.thesis.headline,
      paragraph: row.thesis.paragraph,
      timing: row.thesis.timing,
      confidenceLabel: row.thesis.confidenceLabel,
      oneLiner: row.thesis.oneLiner,
      confirms: row.thesis.confirms,
      questionAnswer: row.thesis.questionAnswer,
    },

    /* ── what changed ────────────────────────────────────────────────────────────────────────── */
    changed: {
      count: row.changed.count,
      familyCount: row.changed.familyCount,
      families: row.changed.families,
      confluence: row.changed.confluence,
      simultaneous: row.changed.simultaneous,
      obviousness: row.changed.obviousness,
      earliness: row.changed.earliness,
      windowDays: row.changed.windowDays,
      summary: row.changed.summary,
      changes: full ? row.changed.changes : row.changed.changes.slice(0, 5),
      conditions: row.changed.conditions ?? [],
    },

    /* ── the score, factor by factor ─────────────────────────────────────────────────────────── */
    score: {
      value: pctRound(row.pre.score, 1),
      band: row.pre.band,
      bandLabel: row.pre.bandLabel,
      confidence: row.pre.confidence,
      coverage: row.pre.coverage,
      redistributed: row.pre.redistributed,
      factors: row.pre.factors,
      missing: row.pre.missing,
    },

    /* ── risk: the named invalidators ────────────────────────────────────────────────────────── */
    risk: {
      score: row.risk.score,
      level: row.risk.level,
      counts: row.risk.counts,
      invalidators: full ? row.risk.invalidators : row.risk.invalidators.slice(0, 4),
      note: row.risk.note,
    },

    /* ── market facts ────────────────────────────────────────────────────────────────────────── */
    market: {
      price: isNum(m.price) ? sig(m.price, 7) : null,
      marketCap: isNum(m.marketCap) ? Math.round(m.marketCap) : null,
      fdv: isNum(m.fdv) ? Math.round(m.fdv) : null,
      volume24h: isNum(m.volume24h) ? Math.round(m.volume24h) : null,
      turnover: pctRound(a.derived?.turnover, 5),
      change: {
        h24: pctRound(m.change?.h24, 2),
        d7: pctRound(m.change?.d7, 2),
        d30: pctRound(m.change?.d30, 2),
        d90: pctRound(m.change?.d90, 2),
      },
      athChangePct: pctRound(m.athChangePct, 1),
      ageDays: pctRound(a.derived?.ageDays, 0),
      floatRatio: pctRound(a.derived?.floatRatio, 3),
      fdvToMcap: pctRound(a.derived?.fdvToMcap, 2),
    },

    /* ── on-chain ────────────────────────────────────────────────────────────────────────────── */
    onchain: {
      liquidityUsd: isNum(oc.liquidityUsd) ? Math.round(oc.liquidityUsd) : null,
      volume24hDex: isNum(oc.volume24hDex) ? Math.round(oc.volume24hDex) : null,
      holders: oc.holders ?? null,
      holdersSource: oc.holdersSource ?? null,
      holderListSize: oc.holderListSize ?? null,
      top10Pct: pctRound(oc.top10Pct),
      top10EffectivePct: pctRound(oc.top10EffectivePct),
      effectiveSharePct: pctRound(oc.effectiveSharePct),
      cexBalancePct: pctRound(oc.cexBalancePct),
      whaleBalancePct: pctRound(oc.whaleBalancePct),
      lpSharePct: pctRound(oc.lpSharePct),
      lockedSharePct: pctRound(oc.lockedSharePct),
      projectSharePct: pctRound(oc.projectSharePct),
      flaggedSharePct: pctRound(oc.flaggedSharePct),
      holderTable: full ? holderTable(oc.classified) : null,
      flows: full ? oc.flows : compactFlows(oc.flows),
      smartMoney: full ? oc.smartMoney : compactSmartMoney(oc.smartMoney),
      security: oc.security ? {
        source: oc.security.source ?? null,
        isHoneypot: oc.security.isHoneypot ?? null,
        cannotSellAll: oc.security.cannotSellAll ?? null,
        isMintable: oc.security.isMintable ?? null,
        ownerRenounced: oc.security.ownerRenounced ?? null,
        isOpenSource: oc.security.isOpenSource ?? null,
        isProxy: oc.security.isProxy ?? null,
        canTakeBackOwnership: oc.security.canTakeBackOwnership ?? null,
        hiddenOwner: oc.security.hiddenOwner ?? null,
        transferPausable: oc.security.transferPausable ?? null,
        buyTaxPct: pctRound(oc.security.buyTaxPct, 2),
        sellTaxPct: pctRound(oc.security.sellTaxPct, 2),
        lpLockedPct: pctRound(oc.security.lpLockedPct, 1),
      } : null,
      note: oc.note,
    },

    /* ── derivatives ─────────────────────────────────────────────────────────────────────────── */
    derivatives: {
      venues: d.venues ?? 0,
      venueNames: d.venueNames ?? [],
      fundingPct8h: d.fundingPct8h ?? null,
      fundingByVenue: d.fundingByVenue ?? {},
      oiUsd: isNum(d.oiUsd) ? Math.round(d.oiUsd) : null,
      oiToMcap: d.oiToMcap ?? null,
      oiChangePct24h: d.oiChangePct24h ?? null,
      source: d.source ?? null,
    },

    /* ── supply, narrative, development, structure ───────────────────────────────────────────── */
    supply: a.risk?.supply ? {
      floatRatio: pctRound(a.risk.supply.floatRatio, 3),
      fdvToMcap: pctRound(a.risk.supply.fdvToMcap, 2),
      inflationPctYear: a.risk.supply.inflationPctYear,
      inflationBasis: a.risk.supply.inflationBasis,
      nextUnlock: a.risk.supply.nextUnlock,
      unlockWithin30d: a.risk.supply.unlockWithin30d,
      warnings: a.risk.supply.warnings,
    } : null,
    narrative: a.narrative ?? null,
    social: a.social ?? null,
    features: a.features?.daily ? {
      source: a.features.d1Source,
      bars: a.features.daily.bars,
      rsi14: pctRound(a.features.daily.rsi14, 1),
      atrPct14: pctRound(a.features.daily.atrPct14, 2),
      compression: pctRound(a.features.daily.compression, 3),
      volAccel: pctRound(a.features.daily.volAccel, 2),
      upVolRatio: pctRound(a.features.daily.upVolRatio, 3),
      rangePos30: pctRound(a.features.daily.rangePos30, 3),
      higherLows: a.features.daily.higherLows,
      breakout30: a.features.daily.breakout30,
      dd30: pctRound(a.features.daily.dd30, 1),
    } : null,
    futures: a.futures?.grade ? {
      grade: a.futures.grade.grade,
      score: a.futures.grade.score,
      verdict: a.futures.grade.verdict,
      trendRegime: a.futures.trend?.regime ?? null,
      levels: a.futures.levels,
    } : null,

    /* ── provenance ──────────────────────────────────────────────────────────────────────────── */
    baseline: {
      points: row.baseline.points,
      spanDays: row.baseline.spanDays,
      sufficient: row.baseline.sufficient,
      windowDays: row.baseline.windowDays,
    },
    comparison: full
      ? Object.fromEntries(Object.entries(row.cmp ?? {})
        .filter(([, c]) => c && isNum(c.value) && isNum(c.median))
        .map(([k, c]) => [k, { value: sig(c.value, 6), median: sig(c.median, 6), changePct: c.changePct, z: c.z, percentile: c.percentile, n: c.n }]))
      : null,
    quality: a.quality ?? null,
    // The platform catalogue (labels, roles, plans, layers) ships once in `methodology.platforms`;
    // each row only carries the URLs, which is what differs per asset.
    platformUrls: Object.fromEntries((ctx.links ?? []).map((l) => [l.key, l.url])),
    platforms: full ? (ctx.links ?? []) : [],
    catalysts: (a.catalysts ?? []).slice(0, 6),
  };
}

/** Flow view for a list row: the verdict and the counts, without the per-wallet movers. */
function compactFlows(f) {
  if (!f) return null;
  return {
    verdict: f.verdict,
    verdictLabel: f.verdictLabel,
    accumulating: f.accumulating,
    distributing: f.distributing,
    cexDeltaPct: f.cexDeltaPct,
    flags: f.flags,
    spanDays: f.spanDays,
  };
}

/** Smart Money view for a list row: the score and which components fired, without the evidence text. */
function compactSmartMoney(sm) {
  if (!sm) return null;
  return {
    score: sm.score,
    raw: sm.raw,
    measured: sm.measured,
    coverage: sm.coverage,
    components: (sm.components ?? []).map((c) => ({ key: c.key, label: c.label, points: c.points })),
    penalties: (sm.penalties ?? []).map((c) => ({ key: c.key, label: c.label, points: c.points })),
  };
}
