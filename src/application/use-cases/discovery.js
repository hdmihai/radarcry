/**
 * USE-CASE: DISCOVERY — the engine that answers the project's question for one asset at a time.
 *
 *   deep data ─→ on-chain facts (classified holders, flows, smart money)
 *             ─→ baseline (the asset's own 30-day norm from our point-in-time history)
 *             ─→ what changed (which important factors moved, in how many families, how obvious)
 *             ─→ pre-expansion score (8 weighted factors, missing ones redistributed)
 *             ─→ risk engine (named invalidators, aggregated)
 *             ─→ classify (Stage 0–4, Early Research Candidate test)
 *             ─→ thesis (the readable paragraph a researcher acts on)
 *
 * Pure orchestration of domain functions: no I/O, no provider knowledge, no formatting.
 */
import { isNum, round, toNum } from '../../domain/shared/math.js';
import { buildBaseline, compareToBaseline, metricRow } from '../../domain/discovery/baseline.js';
import { whatChanged } from '../../domain/discovery/changes.js';
import { preExpansionScore } from '../../domain/discovery/pre-expansion.js';
import { classify } from '../../domain/discovery/classify.js';
import { classifyHolders, createLabelIndex, emptyLabelIndex } from '../../domain/onchain/labels.js';
import { flowSnapshot, holderFlows } from '../../domain/onchain/holder-flows.js';
import { smartMoneyScore } from '../../domain/onchain/smart-money.js';
import { supplyPressure } from '../../domain/risk/supply.js';
import { riskEngine } from '../../domain/risk/risk-engine.js';
import { assetNarrative } from '../../domain/narrative/narrative.js';
import { buildThesis } from '../../domain/thesis/thesis.js';
import { dailyFeatures } from '../../domain/features/daily.js';
import { dailyTrend } from '../../domain/futures/trend.js';
import { fourHourSetup, tradeLevels } from '../../domain/futures/setup.js';
import { toPct8h } from '../../domain/futures/positioning.js';
import { derivativesSummary } from '../../domain/asset/venues.js';

/** Build the label index once per run (the bundled dataset is ~61k addresses). */
export function labelIndexFrom(labels) {
  if (!labels) return emptyLabelIndex();
  try {
    return createLabelIndex(labels);
  } catch {
    return emptyLabelIndex();
  }
}

/**
 * Normalise every derivatives reading of one asset into the shape the domain expects, including the
 * conversion of each venue's funding rate to percent per 8 hours.
 */
export function derivativesFacts(asset, { coinalyze = null, baselineCmp = null } = {}) {
  const base = derivativesSummary(asset);
  const byVenue = {};
  for (const p of asset.venues?.perps ?? []) {
    const pct = toPct8h(p.fundingRate, { intervalHours: p.fundingIntervalHours ?? 8, alreadyPercent: false });
    if (isNum(pct)) byVenue[p.venue] = round(pct, 5);
  }
  // Coinalyze rates arrive already in percent, for Binance / Bybit / OKX.
  for (const [venue, row] of Object.entries(coinalyze?.funding ?? {})) {
    const pct = toPct8h(row.value, { intervalHours: 8, alreadyPercent: true });
    if (isNum(pct)) byVenue[venue] = round(pct, 5);
  }
  const vals = Object.values(byVenue).filter(isNum);
  const oiUsd = isNum(coinalyze?.oiUsd) ? coinalyze.oiUsd : base.oiUsd;
  const mcap = asset.market?.marketCap;
  return {
    venues: Object.keys(byVenue).length || base.venues,
    venueNames: [...new Set([...(asset.venues?.perps ?? []).map((p) => p.venue), ...Object.keys(coinalyze?.funding ?? {})])],
    fundingPct8h: vals.length ? round(vals.reduce((s, x) => s + x, 0) / vals.length, 5) : null,
    fundingByVenue: byVenue,
    oiUsd,
    oiToMcap: isNum(oiUsd) && isNum(mcap) && mcap > 0 ? round(oiUsd / mcap, 4) : null,
    oiChangePct24h: isNum(coinalyze?.oiChangePct24h) ? coinalyze.oiChangePct24h : (baselineCmp?.oiUsd?.changePct ?? null),
    pricePct24h: asset.market?.change?.h24 ?? null,
    perpVolume24hUsd: (asset.venues?.perps ?? []).reduce((s, p) => s + (toNum(p.volume24hUsd) ?? 0), 0) || null,
    liqLong24hUsd: coinalyze?.liqLong24hUsd ?? null,
    liqShort24hUsd: coinalyze?.liqShort24hUsd ?? null,
    source: Object.keys(coinalyze?.funding ?? {}).length ? 'coinalyze + burse publice' : 'burse publice',
  };
}

/**
 * Turn the raw deep payload into the on-chain facts block, with holders classified into actors.
 */
export function onchainFacts({ asset, deep, labelIndex, flowHistory, nowMs }) {
  const dex = deep?.dex ?? null;
  const info = deep?.holdersInfo ?? null;
  const holderList = deep?.holders?.holders ?? null;

  const liquidityUsd = toNum(dex?.liquidityUsd) ?? toNum(info?.liquidityUsd) ?? null;
  // `dex.pairs` is a *count* in the DexScreener adapter; the addresses live on topPair / pairList.
  const pairAddresses = [
    dex?.topPair?.pairAddress,
    ...(Array.isArray(dex?.pairAddresses) ? dex.pairAddresses : []),
    ...(Array.isArray(dex?.pairList) ? dex.pairList.map((p) => p?.pairAddress) : []),
  ];
  const pairs = new Set(pairAddresses.filter(Boolean).map((p) => String(p).toLowerCase()));

  let classified = null;
  if (Array.isArray(holderList) && holderList.length) {
    const arkham = deep?.arkhamEntities instanceof Map ? deep.arkhamEntities : null;
    classified = classifyHolders(holderList, {
      labelIndex,
      arkham,
      creator: deep?.security?.creatorAddress ?? null,
      owner: deep?.security?.ownerAddress ?? null,
      pairs,
      chain: asset.primary?.chain ?? null,
    });
  }

  const snapshot = classified ? flowSnapshot(classified, nowMs) : null;
  const flows = classified
    ? holderFlows({ current: classified, history: flowHistory ?? [], nowMs })
    : null;

  const holders = isNum(deep?.holders?.holderCount) ? deep.holders.holderCount
    : isNum(info?.holders) ? info.holders
      : Array.isArray(holderList) ? null : null;

  return {
    liquidityUsd,
    liquidityChange: null,
    pools: dex?.pairs ?? null,
    volume24hDex: toNum(dex?.volume24h) ?? null,
    txns24h: toNum(dex?.txns24h) ?? null,
    holders: holders ?? (isNum(info?.holders) ? info.holders : null),
    holdersSource: deep?.holdersSource ?? (info ? 'geckoterminal' : null),
    holderListSize: Array.isArray(holderList) ? holderList.length : null,
    classified,
    top10Pct: classified?.top10Pct ?? (isNum(info?.top10Pct) ? info.top10Pct : null),
    top10EffectivePct: classified?.top10EffectivePct ?? null,
    top20EffectivePct: classified?.top20EffectivePct ?? null,
    effectiveSharePct: classified?.effectiveSharePct ?? null,
    cexBalancePct: classified?.cexSharePct ?? null,
    whaleBalancePct: classified?.whaleSharePct ?? null,
    lpSharePct: classified?.lpSharePct ?? null,
    lockedSharePct: classified?.lockedSharePct ?? null,
    projectSharePct: classified?.projectSharePct ?? null,
    flaggedSharePct: classified?.flaggedSharePct ?? null,
    flows,
    arkhamFlows: deep?.arkhamFlows ?? null,
    security: deep?.security ?? null,
    snapshot,
    note: classified
      ? `${classified.holders.length} dețineri clasificate în actori; concentrarea efectivă exclude pool-uri, bridge-uri, staking, lock-uri și adrese de ardere`
      : 'lista de deținători nu a fost disponibilă pe lanțul acestui proiect în această rulare',
  };
}

/**
 * Run the full discovery pipeline for one asset.
 *
 * @param {{asset:any, deep:any, state:any, labelIndex:any, market:any, landscape:any,
 *          unlocks?:any[], config:any, nowMs:number}} input
 */
export function discoverAsset({ asset, deep, state, labelIndex, market, landscape, unlocks = [], config, nowMs }) {
  const points = state?.history?.[asset.key]?.points ?? [];
  const flowHistory = state?.flows?.[asset.key] ?? [];

  // 1 · on-chain facts
  asset.onchain = onchainFacts({ asset, deep, labelIndex, flowHistory, nowMs });

  // 2 · price structure, from whichever candle source answered.
  //
  // The 1D trend and the 4H setup are computed *here*, before the scores, because two engines need
  // them: the structure factor of the pre-expansion score and the STRUCTURE_SHIFT change detector.
  // The Futures Radar later recomputes the full five-block grade for its own watchlist and overwrites
  // this block — but discovery must never depend on that having happened first.
  asset.features = { daily: deep?.d1?.length ? dailyFeatures(deep.d1) : null, d1Source: deep?.d1Source ?? null };
  asset.futures = {
    trend: deep?.d1?.length ? dailyTrend(deep.d1) : null,
    setup: deep?.h4?.length ? fourHourSetup(deep.h4) : null,
    grade: null,
    levels: null,
  };

  // 3 · derivatives
  asset.derivatives = derivativesFacts(asset, { coinalyze: deep?.coinalyze ?? null });

  // 4 · narrative and supply. The coin detail endpoint carries the authoritative category list,
  //      which is a better sector signal than the listing tags alone.
  if (Array.isArray(deep?.detail?.categories) && deep.detail.categories.length) {
    asset.categories = deep.detail.categories;
    asset.tags = [...new Set([...(asset.tags ?? []), ...deep.detail.categories.map((c) => String(c).toLowerCase())])];
  }
  asset.narrative = assetNarrative(asset, landscape);
  asset.risk = { supply: supplyPressure({ asset, points, unlocks, nowMs }) };

  // 5 · development and attention facts used by the change detector
  asset.social = {
    devCommits30d: deep?.dev?.activity?.commits30d ?? null,
    devContributors: deep?.dev?.meta ? null : null,
    devStars: deep?.dev?.meta?.stars ?? null,
    devRepo: deep?.dev?.repo ? `${deep.dev.repo.owner}/${deep.dev.repo.repo}` : null,
    devStale: deep?.dev?.activity?.stale ?? null,
    mentions7d: deep?.mentions?.mentions7d ?? null,
    mentions30d: deep?.mentions?.mentions30d ?? null,
    mentionChannels: deep?.mentions?.channels ?? null,
  };

  // 6 · baseline from our own history, then the comparison
  const baseline = buildBaseline(points, {
    nowMs,
    windowDays: config.discovery?.baselineWindowDays ?? 30,
    minPoints: config.discovery?.baselineMinPoints ?? 4,
  });
  const current = metricRow(asset);
  const cmp = compareToBaseline(current, baseline);
  asset.baseline = { points: baseline.points, spanDays: baseline.spanDays, sufficient: baseline.sufficient, windowDays: baseline.windowDays };

  // 7 · smart money (needs flows + baseline comparison)
  asset.onchain.smartMoney = smartMoneyScore({ asset, cmp });

  // 8 · what changed, then the score, then the risk, then the verdict
  const changed = whatChanged({ asset, cmp, windowDays: config.discovery?.changeWindowDays ?? 7 });
  const pre = preExpansionScore({ asset, cmp, market });
  asset.pre = pre;
  const risk = riskEngine({ asset, market, changed });
  asset.risk = { ...asset.risk, ...risk };
  const verdict = classify({ asset, pre, risk, changed });
  asset.verdict = verdict;

  // 9 · research levels (entry zone, invalidation, targets) and the readable thesis
  if (asset.futures?.setup) asset.futures.levels = tradeLevels(asset.futures.setup, asset.futures.trend);
  const thesis = buildThesis({ asset, verdict, changed, pre, risk, market, levels: asset.futures?.levels ?? null });

  return { asset, cmp, baseline, changed, pre, risk, verdict, thesis, current };
}
