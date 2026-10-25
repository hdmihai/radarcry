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
import { prescreenScore } from '../../domain/discovery/prescreen.js';
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
 * The change engine, run cheaply on one eligible project, with only the facts every scan already
 * holds for the whole universe: price, capitalisation, volume, turnover, open interest and funding
 * from the venues' bulk endpoints, and the listing catalysts from the registry diff. No call is
 * made. Detectors whose facts are absent here (holders, liquidity, development…) return nothing,
 * which is the same "UNKNOWN is not bearish" rule the full read applies.
 *
 * Two things come out of it: the market-level metric row that is stored as this project's point of
 * history, so every eligible project builds its own norm from the first run; and a prescreen score
 * that lets the change engine claim part of the deep-research budget.
 *
 * @param {{asset:any, points?:any[], config:any, nowMs:number}} input
 */
export function prescreenAsset({ asset, points = [], config, nowMs }) {
  // Binance Alpha publishes holders and liquidity for every Alpha token in the same free list the
  // universe comes from, so for those tokens two more families (holders, liquidity) are measurable
  // against the token's own norm on every run, at no extra cost.
  const alpha = alphaFacts(asset);
  const onchain = alpha ? {
    holders: alpha.holders,
    holdersSource: isNum(alpha.holders) ? 'binance_alpha' : null,
    liquidityUsd: alpha.liquidityUsd,
    liquiditySource: isNum(alpha.liquidityUsd) ? 'binance_alpha' : null,
  } : null;
  const view = { ...asset, derivatives: derivativesFacts(asset), onchain };
  const baseline = buildBaseline(points, {
    nowMs,
    windowDays: config.discovery?.baselineWindowDays ?? 30,
    minPoints: config.discovery?.baselineMinPoints ?? 4,
  });
  const current = metricRow(view);
  const changed = whatChanged({ asset: view, cmp: compareToBaseline(current, baseline), windowDays: config.discovery?.changeWindowDays ?? 7 });
  return {
    key: asset.key,
    current,
    changed,
    score: prescreenScore(changed),
    baselinePoints: baseline.points,
    baselineSufficient: baseline.sufficient,
  };
}

/** Holder and liquidity readings Binance Alpha reports for a listed token, or null. */
export function alphaFacts(asset) {
  const a = asset?.venues?.alpha;
  if (!a || a.status !== 'LISTED') return null;
  const holders = isNum(toNum(a.holders)) && toNum(a.holders) > 0 ? toNum(a.holders) : null;
  const liquidityUsd = isNum(toNum(a.liquidity)) && toNum(a.liquidity) > 0 ? toNum(a.liquidity) : null;
  return holders === null && liquidityUsd === null ? null : { holders, liquidityUsd };
}

/**
 * Translate the security port payload (GoPlus vocabulary, as normalised by the adapter) into the
 * facts the risk engine reads. This is the only place where the two vocabularies meet.
 *
 * Getting this wrong fails in the worst possible direction, which is why it is a separate, tested
 * function: if the risk engine receives an object whose fields it does not recognise, every check
 * reads `undefined`, none fires, and — because an object *was* received — the "contract not
 * scanned" invalidator is not raised either. A honeypot would be published as a clean contract.
 *
 * Taxes arrive as fractions (0.1 = 10 %) and leave as percent. A payload in which no security field
 * is known at all is returned as null, so the risk engine reports the scan as missing rather than
 * as passed.
 *
 * @param {any} raw one entry of OnchainPort.security(): {holders, top10Pct, top10EffectivePct,
 *   creatorAddress, ownerAddress, lpLockedPct, security:{honeypot, cannotSell, buyTax, sellTax, ...}}
 */
export function securityFacts(raw) {
  const s = raw?.security;
  if (!s || typeof s !== 'object') return null;
  const asPct = (fraction) => (isNum(toNum(fraction)) ? round(toNum(fraction) * 100, 2) : null);
  const tri = (v) => (v === true ? true : v === false ? false : null);
  // "Cannot sell all" is treated like a honeypot, as the legacy risk model already does: an exit
  // that the contract can restrict is not an exit a researcher can rely on.
  const blocked = s.honeypot === true || s.cannotSell === true;
  const facts = {
    source: 'goplus',
    isHoneypot: blocked ? true : tri(s.honeypot),
    cannotSellAll: tri(s.cannotSell),
    isMintable: tri(s.mintable),
    ownerRenounced: tri(s.ownerRenounced),
    hiddenOwner: tri(s.hiddenOwner),
    canTakeBackOwnership: tri(s.canTakeBackOwnership),
    transferPausable: tri(s.transferPausable),
    blacklist: tri(s.blacklist),
    slippageModifiable: tri(s.slippageModifiable),
    isProxy: tri(s.proxy),
    isOpenSource: tri(s.openSource),
    buyTaxPct: asPct(s.buyTax),
    sellTaxPct: asPct(s.sellTax),
    lpLockedPct: isNum(raw.lpLockedPct) ? raw.lpLockedPct : null,
    creatorAddress: raw.creatorAddress ?? null,
    ownerAddress: raw.ownerAddress ?? null,
  };
  const measured = ['isHoneypot', 'isMintable', 'hiddenOwner', 'canTakeBackOwnership', 'transferPausable', 'isProxy', 'buyTaxPct', 'sellTaxPct']
    .some((k) => facts[k] !== null);
  return measured ? facts : null;
}

/**
 * Turn the raw deep payload into the on-chain facts block, with holders classified into actors.
 */
export function onchainFacts({ asset, deep, labelIndex, flowHistory, nowMs }) {
  const dex = deep?.dex ?? null;
  const info = deep?.holdersInfo ?? null;
  const holderList = deep?.holders?.holders ?? null;
  const goplus = deep?.security ?? null;
  const alpha = alphaFacts(asset);

  /*
   * Liquidity, with its source. For a Binance Alpha token, Binance's own figure comes first: it is
   * available on every run — light or deep — so the token's liquidity norm is one continuous
   * series, and it covers the pools Binance routes Alpha trades through. Otherwise DexScreener,
   * then GeckoTerminal. Every reading carries its source, and the baseline only compares readings
   * from the same one.
   */
  const liquidityPick = [
    { id: 'binance_alpha', v: alpha?.liquidityUsd },
    { id: 'dexscreener', v: toNum(dex?.liquidityUsd) },
    { id: 'geckoterminal', v: toNum(info?.liquidityUsd) },
  ].find((x) => isNum(x.v) && x.v > 0) ?? null;
  const liquidityUsd = liquidityPick?.v ?? null;
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
      creator: goplus?.creatorAddress ?? null,
      owner: goplus?.ownerAddress ?? null,
      pairs,
      chain: asset.primary?.chain ?? null,
    });
  }

  /*
   * Without a full holder list (no NodeReal key), GoPlus's top-10 list is classified against the
   * same label index, for concentration only: ten addresses are enough to tell an exchange hot wallet
   * or an LP pool from a real large holder, but not to follow flows between runs, so they never feed
   * the flow snapshots below.
   */
  const topClassified = !classified && Array.isArray(goplus?.topHolders) && goplus.topHolders.length
    ? classifyHolders(goplus.topHolders, {
      labelIndex,
      arkham: null,
      creator: goplus?.creatorAddress ?? null,
      owner: goplus?.ownerAddress ?? null,
      pairs,
      chain: asset.primary?.chain ?? null,
    })
    : null;

  const snapshot = classified ? flowSnapshot(classified, nowMs) : null;
  const flows = classified
    ? holderFlows({ current: classified, history: flowHistory ?? [], nowMs })
    : null;

  /*
   * Holder count and concentration, best source first: Binance Alpha for Alpha tokens (every run,
   * so the norm is continuous), then a full holder list (NodeReal / Solana RPC), GeckoTerminal's
   * token info, and GoPlus — which already answered in the security pass and reports the holder
   * count plus the top-10 holders on EVM chains with no key at all. The source travels with the
   * reading (see SOURCED in the baseline module).
   */
  const sources = [
    { id: 'binance_alpha', count: alpha?.holders ?? null, top10: null },
    { id: deep?.holdersSource ?? null, count: toNum(deep?.holders?.holderCount), top10: null },
    { id: 'geckoterminal', count: toNum(info?.holders), top10: toNum(info?.top10Pct) },
    { id: 'goplus', count: toNum(goplus?.holders), top10: toNum(goplus?.top10Pct) },
  ];
  const countSource = sources.find((x) => isNum(x.count)) ?? null;
  const top10Source = sources.find((x) => isNum(x.top10)) ?? null;

  return {
    liquidityUsd,
    liquiditySource: liquidityPick?.id ?? null,
    liquidityChange: null,
    pools: dex?.pairs ?? null,
    volume24hDex: toNum(dex?.volume24h) ?? null,
    txns24h: toNum(dex?.txns24h) ?? null,
    holders: countSource?.count ?? null,
    holdersSource: countSource?.id ?? deep?.holdersSource ?? null,
    holderListSize: Array.isArray(holderList) ? holderList.length : null,
    classified,
    top10Pct: classified?.top10Pct ?? top10Source?.top10 ?? null,
    top10Source: classified ? (deep?.holdersSource ?? 'holder_list') : (top10Source?.id ?? null),
    top10EffectivePct: classified?.top10EffectivePct ?? topClassified?.top10EffectivePct ?? (isNum(toNum(goplus?.top10EffectivePct)) ? toNum(goplus.top10EffectivePct) : null),
    top10ActorsPct: classified?.top10ActorsPct ?? topClassified?.top10ActorsPct ?? null,
    concentrationBasis: classified ? 'holder_list' : topClassified ? 'top10_labelled' : isNum(toNum(goplus?.top10EffectivePct)) ? 'provider_tags' : isNum(top10Source?.top10) ? 'raw' : null,
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
    security: securityFacts(goplus),
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
