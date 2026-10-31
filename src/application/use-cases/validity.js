/**
 * USE-CASE: VALIDITY — assemble, from what the run already read, the evidence the domain's validity
 * gate judges, and shape its verdicts for the snapshot, the radar rows and the universe table.
 *
 * No extra call is made for it. Every fact comes from a read the scan does anyway:
 *   capitalisation and its source     aggregators + exchange Alpha lists (universe merge)
 *   identity                          aggregator listing, Binance Alpha, site/socials (CoinGecko
 *                                     detail, DexScreener, GeckoTerminal), GoPlus fake-token flags
 *   listings                          Binance, MEXC, Gate, OKX, Bitget spot; Upbit, Bithumb KRW;
 *                                     perpetuals on five venues; Binance Alpha; GoPlus `is_in_cex`
 *   contract                          GoPlus token security (fresh or carried ≤ 7 days),
 *                                     GeckoTerminal's honeypot flag
 *   liquidity, holders, age           DexScreener / Binance Alpha / GeckoTerminal, GoPlus top 10
 */
import { isNum, toNum } from '../../domain/shared/math.js';
import { CHAINS, exclusionReason } from '../../domain/shared/symbols.js';
import { ageDays as ageOf } from '../../domain/shared/time.js';
import { assessValidity, CHECK, DEFAULT_VALIDITY_POLICY, VALIDITY, VALIDITY_CHECKS, validitySummary } from '../../domain/validity/validity.js';
import { securityFacts } from './discovery.js';

const AGGREGATORS = new Set(['coingecko', 'coinmarketcap', 'coinpaprika']);

/** The policy: the universe's capitalisation band, plus the thresholds of config.validity. */
export function validityPolicy(config) {
  return {
    ...DEFAULT_VALIDITY_POLICY,
    minMarketCapUsd: config.universe?.minMarketCapUsd ?? DEFAULT_VALIDITY_POLICY.minMarketCapUsd,
    maxMarketCapUsd: config.universe?.maxMarketCapUsd ?? DEFAULT_VALIDITY_POLICY.maxMarketCapUsd,
    ...(config.validity ?? {}),
  };
}

/** The security facts in the gate's vocabulary (one translation, from discovery's facts). */
function gateSecurity(f) {
  if (!f) return null;
  return {
    source: f.source, asOf: f.asOf, carried: f.carried,
    honeypot: f.isHoneypot, cannotSell: f.cannotSellAll, cannotBuy: f.cannotBuy, nonTransferable: f.nonTransferable,
    buyTaxPct: f.buyTaxPct, sellTaxPct: f.sellTaxPct,
    ownerChangeBalance: f.ownerChangeBalance, balanceMutable: f.balanceMutable, selfdestruct: f.selfdestruct, defaultFrozen: f.defaultFrozen,
    honeypotSameCreator: f.honeypotSameCreator, maliciousCreator: f.maliciousCreator,
    hiddenOwner: f.hiddenOwner, canTakeBackOwnership: f.canTakeBackOwnership, openSource: f.isOpenSource,
    freezable: f.freezable, closable: f.closable,
    mintable: f.isMintable, ownerRenounced: f.ownerRenounced, transferPausable: f.transferPausable, blacklist: f.blacklist,
    slippageModifiable: f.slippageModifiable, personalSlippageModifiable: f.personalSlippageModifiable, proxy: f.isProxy,
    externalCall: f.externalCall, tradingCooldown: f.tradingCooldown,
    ownerPercentPct: f.ownerPercentPct, creatorPercentPct: f.creatorPercentPct,
    fakeToken: f.fakeToken, airdropScam: f.airdropScam, launchpad: f.launchpad, trusted: f.trusted,
    cexList: f.cexList,
  };
}

/** Site and social accounts, from every source that names them. */
function linksOf(deep) {
  const websites = new Set();
  const socials = new Set();
  const add = (set, x) => { if (typeof x === 'string' && x.trim()) set.add(x.trim()); };
  const d = deep?.detail ?? null;
  if (d) {
    add(websites, d.homepage);
    add(socials, d.twitter);
    add(socials, d.telegram);
  }
  for (const w of deep?.dex?.websites ?? []) add(websites, w);
  for (const s of deep?.dex?.socials ?? []) add(socials, s?.url ?? s);
  for (const w of deep?.holdersInfo?.websites ?? []) add(websites, w?.url ?? w);
  add(socials, deep?.holdersInfo?.twitter);
  return {
    links: { websites: [...websites], socials: [...socials] },
    checked: Boolean(d || deep?.dex || deep?.holdersInfo),
  };
}

/**
 * The evidence for one asset.
 * @param {{asset:any, deep?:any, nowMs:number}} input  `asset` after universe merge and venues (and,
 *   when the discovery engine read it, with its `onchain` block); `deep` the deep-research slot.
 */
export function validityEvidence({ asset, deep = {}, nowMs }) {
  const m = asset.market ?? {};
  const v = asset.venues ?? {};
  const facts = asset.onchain?.security ?? securityFacts(deep?.security ?? null);
  const security = gateSecurity(facts);

  const spot = [];
  if (v.binanceSpot) spot.push({ venue: 'binance', quoteVolume: toNum(v.binanceSpot.quoteVolume) });
  if (v.mexcSpot) spot.push({ venue: 'mexc', quoteVolume: toNum(v.mexcSpot.quoteVolume) });
  for (const [venue, x] of Object.entries(v.spot ?? {})) spot.push({ venue, quoteVolume: toNum(x?.quoteVolume) });
  // The Korean markets are listings without a volume in the public market list.
  if (v.krw?.upbit === true) spot.push({ venue: 'upbit', quoteVolume: null });
  if (v.krw?.bithumb === true) spot.push({ venue: 'bithumb', quoteVolume: null });

  const chain = asset.primary?.chain ?? asset.foreignChains?.[0] ?? null;
  const hasContract = Boolean(asset.primary?.address) || (asset.foreignChains ?? []).length > 0;
  const { links, checked } = linksOf(deep);

  const oc = asset.onchain ?? null;
  const alphaLiq = toNum(v.alpha?.liquidity);
  const dexLiq = toNum(deep?.dex?.liquidityUsd);
  const liquidityUsd = oc?.liquidityUsd ?? (isNum(alphaLiq) && alphaLiq > 0 ? alphaLiq : isNum(dexLiq) && dexLiq > 0 ? dexLiq : null);
  const liquiditySource = oc?.liquiditySource ?? (isNum(alphaLiq) && alphaLiq > 0 ? 'binance_alpha' : isNum(dexLiq) && dexLiq > 0 ? 'dexscreener' : null);

  // Age: the listing date when an aggregator or Binance gives one, else the oldest DEX pool.
  const poolAge = isNum(toNum(deep?.dex?.oldestPairAt)) ? ageOf(toNum(deep.dex.oldestPairAt), nowMs) : null;
  const alphaAge = isNum(toNum(v.alpha?.listingTime)) ? ageOf(toNum(v.alpha.listingTime), nowMs) : null;
  const age = [asset.derived?.ageDays, poolAge, alphaAge].find(isNum) ?? null;

  return {
    symbol: asset.symbol,
    name: asset.name,
    marketCap: m.marketCap ?? null,
    marketCapSource: m.marketCapSource ?? null,
    marketCapBySource: m.marketCapBySource ?? {},
    mcapDisagreementPct: asset.quality?.mcapDisagreementPct ?? null,
    fdv: m.fdv ?? null,
    exclusion: exclusionReason({ symbol: asset.symbol, name: asset.name, tags: asset.tags, price: m.price, change7d: m.change?.d7, change30d: m.change?.d30, id: asset.ids?.coingecko ?? asset.key }),
    aggregators: (asset.sources ?? []).filter((s) => AGGREGATORS.has(s)),
    alphaPrograms: v.alphaPrograms ?? [],
    links,
    linksChecked: checked,
    spot,
    perps: (v.perps ?? []).map((p) => p.venue),
    cexList: security?.cexList ?? null,
    krwWarning: Boolean(v.krw?.warning),
    venuesRead: { spot: (v.spotKnown ?? []).length > 0, perps: Boolean(v.perpsKnown) },
    chain,
    hasContract,
    scanner: Boolean(asset.primary?.chain && CHAINS[asset.primary.chain]?.goplus),
    security,
    gt: deep?.holdersInfo ? { honeypot: deep.holdersInfo.honeypot ?? null } : null,
    liquidityUsd,
    liquiditySource,
    top10EffectivePct: oc?.top10EffectivePct ?? null,
    ageDays: age,
    turnover: asset.derived?.turnover ?? null,
    flags: asset.quality?.flags ?? [],
  };
}

/** Judge one asset. */
export function validateAsset({ asset, deep, nowMs, policy }) {
  return assessValidity(validityEvidence({ asset, deep, nowMs }), policy);
}

/**
 * Before deep research: which projects can already never pass, whatever the contract scan says?
 * Scope (capitalisation, asset type) and identity (aggregator or Binance curation) need no deep
 * data. Their free-plan research budget goes to projects that can still be valid. Listing is *not*
 * decided here: GoPlus's exchange list, read in deep research, can still show a listing on an
 * exchange this scan does not read.
 */
export function preRejected({ asset, nowMs, policy }) {
  const r = assessValidity(validityEvidence({ asset, deep: {}, nowMs }), policy);
  return r.reasons.some((x) => x.check === 'scope' || x.check === 'identity') ? r : null;
}

const clip = (s, n = 180) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? '');

/** The verdict as published with a radar row or a candidate. */
export function validityView(res) {
  if (!res) return null;
  return {
    status: res.status,
    label: res.label,
    tier: res.listingTier ?? null,
    checks: res.checks.map((c) => ({ key: c.key, label: c.label, status: c.status, detail: clip(c.detail) })),
    warnings: res.warnings.map((w) => clip(w.text, 140)),
  };
}

/** One rejected or pending project, as listed in the snapshot's validity block. */
function listed(asset, res) {
  const items = res.status === VALIDITY.REJECTED ? res.reasons : res.missing;
  return {
    key: asset.key,
    symbol: asset.symbol,
    name: asset.name,
    chain: asset.primary?.chain ?? null,
    marketCap: isNum(asset.market?.marketCap) ? Math.round(asset.market.marketCap) : null,
    sources: asset.sources ?? [],
    status: res.status,
    checks: items.map((x) => x.check),
    codes: [...new Set(items.flatMap((x) => x.codes))],
    why: clip(items.map((x) => x.text).join('; '), 260),
  };
}

/**
 * The snapshot's validity block: the policy, the counts, and the projects held back — rejected with
 * their reasons, pending with what is missing — in the engine's order, so the first rows are the
 * ones the radar would have ranked highest.
 * @param {{ordered:any[], results:Map<string, any>, policy:any, limit?:number}} input
 */
export function validityReport({ ordered, results, policy, limit = 150 }) {
  const rows = ordered.map((a) => ({ asset: a, res: results.get(a.key) })).filter((x) => x.res);
  const summary = validitySummary(rows.map((x) => x.res));
  const rejected = rows.filter((x) => x.res.status === VALIDITY.REJECTED);
  const pending = rows.filter((x) => x.res.status === VALIDITY.PENDING);
  return {
    policy,
    checks: VALIDITY_CHECKS.map((c) => ({ key: c.key, label: c.label, required: c.required })),
    summary,
    rejected: rejected.slice(0, limit).map((x) => listed(x.asset, x.res)),
    pending: pending.slice(0, limit).map((x) => listed(x.asset, x.res)),
    note: 'Un proiect intră în listele CRI doar dacă trece toate cele cinci verificări obligatorii. „În verificare” înseamnă că lipsește o dovadă (de obicei scanarea contractului) — nu că proiectul ar fi suspect; „respins” înseamnă că o dovadă îl descalifică.',
  };
}

/** Short codes for the universe table. */
export const VALIDITY_CODE = Object.freeze({ VALID: 'V', PENDING: 'P', REJECTED: 'R' });

/** The single sentence the universe table shows for a non-valid row. */
export function validityWhy(res) {
  if (!res || res.status === VALIDITY.VALID) return null;
  const items = res.status === VALIDITY.REJECTED ? res.reasons : res.missing;
  return clip(items.map((x) => x.text).join('; '), 160);
}

export { CHECK, VALIDITY };
