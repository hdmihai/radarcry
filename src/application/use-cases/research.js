/**
 * Use-case: research one asset — features → domain evidence → fusion → stage, hype, analogs,
 * risk, signal and plan. Pure orchestration of domain functions (no I/O), used for both the
 * light pass (whole eligible universe) and the deep pass (shortlist with candles + on-chain).
 */
import { isNum, round, sig } from '../../domain/shared/math.js';
import { CHAINS } from '../../domain/shared/symbols.js';
import { DAY_MS, toMs } from '../../domain/shared/time.js';
import { dailyFeatures } from '../../domain/features/daily.js';
import { smcFeatures } from '../../domain/features/smc.js';
import { stageFromDaily, stageFromListing, stageSequence, STAGE_LABELS } from '../../domain/lifecycle/stage.js';
import { hypeState, HYPE_LABELS } from '../../domain/lifecycle/hype.js';
import {
  activityDomain, attentionDomain, catalystDomain, derivativesDomain, fundamentalsDomain,
  onchainDomain, setupDomain, similarityDomain, structureDomain,
} from '../../domain/scoring/domains.js';
import { criScore, fuse } from '../../domain/scoring/fusion.js';
import { assessRisk } from '../../domain/scoring/risk.js';
import { candidateRaw } from '../../domain/similarity/references.js';
import { toVector } from '../../domain/similarity/vector.js';
import { matchAnalogs } from '../../domain/similarity/engine.js';
import { classifySignal, tradePlan } from '../../domain/signals/signal.js';

/**
 * @param {any} asset canonical asset (with lf, venues, attention, fundamentals)
 * @param {{events:any[], references:any[], deep?:any, history:any[], regime:string, nowMs:number, config:any}} ctx
 */
export function researchAsset(asset, ctx) {
  const { config, nowMs } = ctx;
  const lf = asset.lf;
  const deep = ctx.deep ?? null;
  const d1Candles = deep?.d1 ?? null;
  const d1 = d1Candles?.length >= 30 ? dailyFeatures(d1Candles) : null;
  const h4Closed = deep?.h4?.filter((k) => k.closed !== false) ?? null;
  const h4 = h4Closed?.length >= 40 ? smcFeatures(h4Closed) : null;
  const oc = deep ? onchainFacts(asset, lf, deep, ctx.history, nowMs) : lightOnchain(lf);

  const stageInfo = d1 ? stageFromDaily(d1, { athChangePct: lf.athChangePct }) : stageFromListing(lf);
  const watchlistChangePct = deep?.detail ? changeVsHistory(deep.detail.watchlistUsers, ctx.history, 'watchlist', nowMs) : null;
  const hype = hypeState({
    cgTrending: asset.attention?.cgTrending,
    dexBoost: asset.attention?.dexBoost,
    gtTrending: asset.attention?.gtTrending,
    change7d: lf.change7d,
    watchlistChangePct,
    rankJump: lf.rankGain7d,
    stage: stageInfo.stage,
    attentionKnown: asset.attention?.known,
  });

  const closedDaily = d1Candles?.filter((k) => k.closed !== false) ?? null;
  const sequence = closedDaily?.length >= 35 ? stageSequence(closedDaily, 30) : null;
  const raw = candidateRaw(asset, lf, d1, oc);
  const vector = toVector(raw);
  const analogs = matchAnalogs({ vector, sequence }, ctx.references, config.similarity);

  const fund = asset.fundamentals;
  const domains = [
    similarityDomain(analogs),
    structureDomain(lf, d1, h4),
    setupDomain(lf),
    activityDomain(lf, d1),
    derivativesDomain(lf),
    onchainDomain(lf, oc),
    catalystDomain(ctx.events, nowMs),
    attentionDomain(hype, asset.attention?.known),
    fundamentalsDomain(fund, deep?.detail ?? null),
  ];
  const fusion = fuse(domains, config.weights);
  const { cri, tier } = criScore(fusion);
  const risk = assessRisk(lf, oc, d1, asset.quality?.flags ?? []);
  const setupScore = domains.find((d) => d.id === 'setup')?.score ?? null;
  const signal = classifySignal({
    cri,
    reliability: fusion.reliability,
    stage: stageInfo.stage,
    hype: hype.state,
    bestAnalog: analogs.best?.similarity ?? null,
    setupScore,
    structure4h: h4?.structure ?? null,
    risk,
    hasCandles: Boolean(d1 && h4),
    deep: Boolean(deep),
    regime: ctx.regime,
    conflict: fusion.conflict,
  }, config.signals);
  const plan = tradePlan(signal.type, d1, h4);

  return {
    asset, lf, d1, h4, oc, stageInfo, hype, analogs, raw, vector, sequence, domains, fusion, cri, tier, risk, signal, plan,
    detail: deep?.detail ?? null,
    dex: deep?.dex ?? null,
    depth: deep ? 'deep' : 'light',
    whyNow: whyNow({ stageInfo, analogs, domains, events: ctx.events, hype, lf, h4, oc }),
  };
}

function lightOnchain(lf) {
  if (lf.alphaStatus !== 'LISTED') return null;
  return { holders: lf.alphaHolders, holdersChangePct: null, sources: ['binance_alpha'] };
}

/** Merge DexScreener + GoPlus + GeckoTerminal + Binance Alpha + Arkham into on-chain facts. */
export function onchainFacts(asset, lf, deep, history, nowMs) {
  const sources = [];
  const sec = deep.security ?? null;
  const gt = deep.holdersInfo ?? null;
  const dex = deep.dex ?? null;
  if (sec) sources.push('goplus');
  if (gt) sources.push('geckoterminal');
  if (dex) sources.push('dexscreener');
  if (lf.alphaStatus === 'LISTED') sources.push('binance_alpha');
  if (deep.arkhamFlows) sources.push('arkham');
  const flows = deep.arkhamFlows ?? null;
  const holders = sec?.holders ?? gt?.holders ?? lf.alphaHolders ?? null;
  const holdersChangePct = changeVsHistory(holders, history, 'holders', nowMs);
  const buys = dex?.buys24h ?? null;
  const sells = dex?.sells24h ?? null;
  return {
    holders,
    holdersChangePct,
    top10Pct: sec?.top10Pct ?? gt?.top10Pct ?? null,
    top10EffectivePct: sec?.top10EffectivePct ?? null,
    dexLiquidityUsd: dex?.liquidityUsd ?? null,
    liqToMcap: isNum(dex?.liquidityUsd) && isNum(lf.mcap) && lf.mcap > 0 ? dex.liquidityUsd / lf.mcap : null,
    buySellRatio: isNum(buys) && isNum(sells) && sells > 0 && buys + sells >= 30 ? buys / sells : null,
    dexVolume24h: dex?.volume24h ?? null,
    pairAgeDays: isNum(dex?.oldestPairAt) ? (nowMs - dex.oldestPairAt) / DAY_MS : null,
    topPairUrl: dex?.topPair?.url ?? null,
    security: sec?.security ?? (gt && isNum(gt.gtScore) ? { honeypot: gt.honeypot ?? null } : null),
    gtScore: gt?.gtScore ?? null,
    arkhamNetflowRatio: flows?.netflowRatio ?? null,
    walletFlows: flows ? { ...flows, persistence: flowPersistence(flows.netflowRatio, history) } : null,
    exchangeNetToMcap: flows && isNum(flows.exchangeNetUsd) && isNum(lf.mcap) && lf.mcap > 0 ? flows.exchangeNetUsd / lf.mcap : null,
    socials: dex?.socials ?? [],
    websites: dex?.websites ?? [],
    sources,
  };
}

/**
 * Accumulation persistence (CRI wallet intelligence): how many of the recent Arkham observations
 * (own history, newest first, up to 6) plus the current one show wallets net-accumulating.
 * Needs at least two observations; otherwise UNKNOWN.
 */
export function flowPersistence(current, history, { take = 6, threshold = 0.05 } = {}) {
  const past = (history ?? []).map((p) => p.walletNet).filter(isNum).slice(-(take - 1));
  const values = isNum(current) ? [...past, current] : past;
  if (values.length < 2) return null;
  const positive = values.filter((v) => v > threshold).length;
  return { positive, total: values.length, share: round(positive / values.length, 3) };
}

/** % change of a metric versus the point closest to 7 days ago in the asset history. */
export function changeVsHistory(current, history, field, nowMs, days = 7) {
  if (!isNum(current) || !history?.length) return null;
  const target = nowMs - days * DAY_MS;
  let best = null;
  let gap = Infinity;
  for (const p of history) {
    if (!isNum(p[field])) continue;
    const g = Math.abs(toMs(p.t) - target);
    if (g < gap) { gap = g; best = p; }
  }
  if (!best || gap > 3 * DAY_MS || best[field] <= 0) return null;
  return round((current / best[field] - 1) * 100, 2);
}

function whyNow({ stageInfo, analogs, domains, events, hype, lf, h4, oc }) {
  const out = [];
  if (['PRE_EXPANSION', 'ACCELERATION', 'BUILDING'].includes(stageInfo.stage)) out.push(`${STAGE_LABELS[stageInfo.stage]}: ${stageInfo.reasons.slice(0, 3).join(', ')}`);
  if (analogs.best && isNum(analogs.best.similarity) && analogs.best.similarity >= 55) {
    out.push(`Seamănă ${analogs.best.similarity.toFixed(0)}% cu ${analogs.best.ref} înainte de pump (potriviri: ${analogs.best.topMatches.slice(0, 3).join(', ')})`);
  }
  // Wallet intelligence ranks right after the pattern match: who is accumulating is the core "why now".
  const wf = oc?.walletFlows;
  if (isNum(wf?.netflowRatio) && wf.netflowRatio >= 0.2) {
    const lead = wf.topEntities?.find((e) => e.cls !== 'cex' && e.netUsd > 0);
    const exits = isNum(wf.exchangeBias) && wf.exchangeBias >= 0.25 && wf.exchangeOutUsd >= 50_000 ? `, retrageri nete de pe exchange-uri ${usdShort(-wf.exchangeNetUsd)}` : '';
    out.push(`Arkham: portofelele acumulează net ${(wf.netflowRatio * 100).toFixed(0)}% din fluxuri în ${windowLabel(wf.window)}${lead ? ` (${lead.name})` : ''}${exits}`);
  } else if (isNum(wf?.exchangeBias) && wf.exchangeBias >= 0.25 && wf.exchangeOutUsd >= 50_000) {
    out.push(`Arkham: retrageri nete de pe exchange-uri ${usdShort(-wf.exchangeNetUsd)} în ${windowLabel(wf.window)}`);
  }
  // One line per catalyst type (newest first), at most two.
  const seen = new Set();
  const positives = [...(events ?? [])].filter((x) => x.polarity === 'POSITIVE').sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
  for (const e of positives) {
    if (seen.has(e.type) || seen.size >= 2) continue;
    seen.add(e.type);
    out.push(`Catalizator: ${e.title}`);
  }
  if (h4?.lastEvent?.dir === 'UP' && h4.lastEvent.barsAgo <= 24) out.push(`4H: ${h4.lastEvent.type} bullish acum ${h4.lastEvent.barsAgo} lumânări`);
  if (h4?.sweep && h4.sweep.barsAgo <= 12) out.push('4H: sweep de lichiditate sell-side recuperat');
  const deriv = domains.find((d) => d.id === 'derivatives');
  const sq = deriv?.facts?.find((f) => f.key === 'squeeze');
  if (sq?.score === 88) out.push('Derivate: OI în creștere cu funding ≤ 0, combustibil de short squeeze');
  if (isNum(lf.floatRatio) && lf.floatRatio < 0.25) out.push(`Low float: doar ${(lf.floatRatio * 100).toFixed(0)}% în circulație`);
  if (hype.state === 'STEALTH') out.push('Încă fără hype: nu e în trending și nu are promovare plătită');
  return out.slice(0, 6);
}

const windowLabel = (w) => String(w ?? '').replace(/^(\d+)d$/, '$1 zile').replace(/^(\d+)h$/, '$1 h');

const usdShort = (x) => {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(x / 1e3).toFixed(0)}K`;
  return `$${x.toFixed(0)}`;
};

/** Public, compact representation of one researched asset (the frontend contract). */
export function toCandidateView(r, ctx) {
  const a = r.asset;
  const lf = r.lf;
  const chain = a.primary?.chain ?? null;
  const explorer = chain && a.primary?.address && CHAINS[chain]?.explorer ? `${CHAINS[chain].explorer}${a.primary.address}` : null;
  const view = {
    key: a.key,
    symbol: a.symbol,
    name: a.name,
    image: a.image ?? null,
    depth: r.depth,
    rank: { cmc: a.rank.cmc, coingecko: a.rank.coingecko },
    chain,
    chainLabel: chain ? CHAINS[chain]?.label ?? chain : null,
    contract: a.primary?.address ?? null,
    categories: r.detail?.categories?.slice(0, 6) ?? [],
    links: {
      coingecko: a.ids.coingecko ? `https://www.coingecko.com/en/coins/${a.ids.coingecko}` : null,
      coinmarketcap: a.ids.cmcSlug ? `https://coinmarketcap.com/currencies/${a.ids.cmcSlug}/` : null,
      dexscreener: r.oc?.topPairUrl ?? (chain && a.primary?.address && CHAINS[chain]?.dexscreener ? `https://dexscreener.com/${CHAINS[chain].dexscreener}/${a.primary.address}` : null),
      mexc: a.venues?.mexcSpot ? `https://www.mexc.com/exchange/${a.symbol}_USDT` : null,
      explorer,
      website: r.detail?.homepage ?? r.oc?.websites?.[0] ?? null,
      twitter: r.detail?.twitter ? `https://x.com/${r.detail.twitter}` : r.oc?.socials?.find((s) => s.type === 'twitter')?.url ?? null,
    },
    market: {
      price: sig(lf.price),
      marketCap: round(lf.mcap, 0),
      fdv: round(lf.fdv, 0),
      volume24h: round(lf.volume24h, 0),
      turnover: round(lf.turnover, 4),
      floatRatio: round(lf.floatRatio, 4),
      fdvToMcap: round(lf.fdvToMcap, 2),
      change: { h1: round(lf.change1h, 2), h24: round(lf.change24h, 2), d7: round(lf.change7d, 2), d14: round(lf.change14d, 2), d30: round(lf.change30d, 2) },
      athChangePct: round(lf.athChangePct, 1),
      mcapChange: { h24: round(lf.mcapChange24h, 2), d7: round(lf.mcapChange7d, 2), d30: round(lf.mcapChange30d, 2) },
      rankChange7d: lf.rankGain7d ?? null,
      ageDays: round(lf.ageDays, 0),
      numMarketPairs: a.market.numMarketPairs ?? null,
      sources: a.sources,
    },
    score: {
      cri: r.cri,
      tier: r.tier,
      fused: r.fusion.fused,
      confidence: r.fusion.confidence,
      coverage: r.fusion.coverage,
      reliability: r.fusion.reliability,
      reliabilityBand: r.fusion.reliabilityBand,
      state: r.fusion.state,
      conflict: r.fusion.conflict,
      independentSources: r.fusion.independentSources,
    },
    stage: r.stageInfo.stage,
    stageLabel: STAGE_LABELS[r.stageInfo.stage] ?? r.stageInfo.stage,
    stageReasons: r.stageInfo.reasons,
    stageProxy: Boolean(r.stageInfo.proxy),
    hype: r.hype.state,
    hypeLabel: HYPE_LABELS[r.hype.state] ?? r.hype.state,
    hypeReasons: r.hype.reasons,
    signal: { type: r.signal.type, label: r.signal.label, strength: r.signal.strength, reasons: r.signal.reasons, blockers: r.signal.blockers, plan: r.plan },
    analogs: {
      best: r.analogs.best ? pickAnalog(r.analogs.best) : null,
      consensus: r.analogs.consensus,
      supporting: r.analogs.supporting,
      all: r.analogs.all.map(pickAnalog),
    },
    fingerprint: r.vector,
    domains: r.domains.map((d) => ({ id: d.id, label: d.label, state: d.state, score: d.score, confidence: d.confidence, weight: ctx.config.weights[d.id] ?? 0, contribution: r.fusion.contributions?.[d.id] ?? null, direction: d.direction ?? null, proxy: d.proxy, facts: d.facts, sources: d.sources, notes: d.notes })),
    risk: r.risk,
    whyNow: r.whyNow,
    missing: r.domains.filter((d) => d.state !== 'AVAILABLE').map((d) => d.id),
    derivatives: {
      venues: lf.perpSources,
      oiUsd: round(lf.oiUsd, 0),
      oiToMcap: round(lf.oiToMcap, 4),
      oiChangePct: lf.oiChangePct,
      fundingAvg: lf.fundingAvg,
      byVenue: lf.fundingByVenue,
    },
    onchain: r.oc ? {
      holders: r.oc.holders ?? null,
      holdersChangePct: r.oc.holdersChangePct ?? null,
      top10Pct: round(r.oc.top10Pct, 1),
      top10EffectivePct: round(r.oc.top10EffectivePct, 1),
      dexLiquidityUsd: round(r.oc.dexLiquidityUsd, 0),
      liqToMcap: round(r.oc.liqToMcap, 4),
      buySellRatio: round(r.oc.buySellRatio, 2),
      pairAgeDays: round(r.oc.pairAgeDays, 0),
      security: r.oc.security ?? null,
      gtScore: r.oc.gtScore ?? null,
      walletFlows: walletFlowsView(r.oc.walletFlows),
      exchangeNetToMcap: round(r.oc.exchangeNetToMcap, 4),
      sources: r.oc.sources ?? [],
    } : null,
    venues: {
      mexcSpot: Boolean(a.venues?.mexcSpot),
      krw: a.venues?.krw ?? null,
      alpha: a.venues?.alpha ?? null,
      perps: (a.venues?.perps ?? []).map((p) => p.venue),
    },
    attention: { ...a.attention, watchlistUsers: r.detail?.watchlistUsers ?? null },
    fundamentals: a.fundamentals ?? null,
    technicals: r.d1 || r.h4 ? {
      d1: r.d1 ? pickNums(r.d1, ['close', 'ema20', 'ema50', 'rsi14', 'atrPct14', 'slope30', 'r2_30', 'rangePos30', 'dd30', 'compression', 'volAccel', 'upVolRatio', 'higherLows', 'breakout30', 'change7', 'change30', 'high30', 'low30']) : null,
      h4: r.h4 ? { structure: r.h4.structure, lastEvent: r.h4.lastEvent, events: r.h4.events, orderBlocks: r.h4.orderBlocks, fvgs: r.h4.fvgs, sweep: r.h4.sweep, dealingRange: r.h4.dealingRange, rsi14: round(r.h4.rsi14, 1), swingLow: sig(r.h4.swingLow), swingHigh: sig(r.h4.swingHigh) } : null,
    } : null,
    chart: ctx.chart ?? null,
    catalysts: (ctx.events ?? []).slice(0, 8),
    history: ctx.historyView ?? [],
    sparkline: ctx.sparkline ?? null,
  };
  return view;
}

function walletFlowsView(w) {
  if (!w) return null;
  const usd0 = (x) => (isNum(x) ? Math.round(x) : null);
  return {
    window: w.window,
    addresses: w.addresses,
    walletInUsd: usd0(w.walletInUsd),
    walletOutUsd: usd0(w.walletOutUsd),
    walletNetUsd: usd0(w.walletNetUsd),
    netflowRatio: round(w.netflowRatio, 3),
    exchangeInUsd: usd0(w.exchangeInUsd),
    exchangeOutUsd: usd0(w.exchangeOutUsd),
    exchangeNetUsd: usd0(w.exchangeNetUsd),
    exchangeBias: round(w.exchangeBias, 3),
    protocolNetUsd: usd0(w.protocolNetUsd),
    entityCount: w.entityCount,
    labeledShare: round(w.labeledShare, 3),
    topEntities: (w.topEntities ?? []).map((e) => ({ name: e.name, type: e.type, cls: e.cls, inUsd: usd0(e.inUsd), outUsd: usd0(e.outUsd), netUsd: usd0(e.netUsd) })),
    persistence: w.persistence ?? null,
  };
}

function pickAnalog(x) {
  return { ref: x.ref, similarity: x.similarity, featureSim: x.featureSim, dnaSim: x.dnaSim, phaseSim: x.phaseSim, sequenceSim: x.sequenceSim, coverage: x.coverage, topMatches: x.topMatches, weakest: x.weakest };
}

function pickNums(obj, keys) {
  const out = {};
  for (const k of keys) {
    const v = obj[k];
    out[k] = typeof v === 'number' ? sig(v, 6) : v ?? null;
  }
  return out;
}
