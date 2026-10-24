/**
 * On-chain adapters (free tiers):
 *  - DexScreener: DEX liquidity, volume, buys/sells, pair age, paid boosts (keyless)
 *  - GeckoTerminal: holder count + distribution, GT score, trending pools (keyless public API)
 *  - GoPlus: contract security (honeypot, taxes, owner privileges, holder concentration) (keyless)
 *  - Arkham: wallet / entity flows — OPTIONAL, only with ARKHAM_API_KEY (UNKNOWN otherwise)
 */
import { isNum, toNum } from '../../../domain/shared/math.js';
import { CHAINS, normAddress } from '../../../domain/shared/symbols.js';
import { flag01, disabled, mapResult, notConfigured } from './common.js';

const opt = (provider, cfg, endpoint, extra = {}) => ({ provider, endpoint, timeoutMs: cfg.timeoutMs, retries: cfg.retries, minIntervalMs: cfg.minIntervalMs, maxCalls: cfg.maxCalls, breakerThreshold: 4, ...extra });

/* ----------------------------------------------------------------------------- DexScreener */
export function createDexScreener({ http, cfg }) {
  const boosts = async () => {
    if (!cfg.enabled) return disabled('dexscreener', '/token-boosts/top/v1');
    return mapResult(
      await http.getJson('https://api.dexscreener.com/token-boosts/top/v1', opt('dexscreener', cfg, '/token-boosts/top/v1', { validate: Array.isArray, minIntervalMs: Math.max(cfg.minIntervalMs, 1100) })),
      (rows) => rows.map((b) => ({ chainId: b.chainId, tokenAddress: b.tokenAddress, amount: toNum(b.amount), totalAmount: toNum(b.totalAmount) })),
    );
  };

  /** Up to 30 addresses per call on one chain; aggregates all pairs per token. */
  const tokens = async (chain, addresses) => {
    if (!cfg.enabled) return disabled('dexscreener', '/tokens/v1');
    const dsChain = CHAINS[chain]?.dexscreener;
    if (!dsChain) return notConfigured('dexscreener', '/tokens/v1', `lanț nesuportat: ${chain}`);
    const out = {};
    let last = null;
    for (let i = 0; i < addresses.length; i += 30) {
      const batch = addresses.slice(i, i + 30);
      const r = await http.getJson(`https://api.dexscreener.com/tokens/v1/${dsChain}/${batch.join(',')}`, opt('dexscreener', cfg, '/tokens/v1/{chain}/{addresses}', { validate: Array.isArray }));
      last = r;
      if (!r.ok) continue;
      for (const pair of r.data) {
        const addr = normAddress(chain, pair.baseToken?.address);
        if (!addr || !batch.map((a) => normAddress(chain, a)).includes(addr)) continue;
        const agg = out[addr] ?? { pairs: 0, liquidityUsd: 0, volume24h: 0, buys24h: 0, sells24h: 0, buys6h: 0, sells6h: 0, oldestPairAt: null, topPair: null, websites: [], socials: [] };
        agg.pairs += 1;
        const liq = toNum(pair.liquidity?.usd) ?? 0;
        agg.liquidityUsd += liq;
        agg.volume24h += toNum(pair.volume?.h24) ?? 0;
        agg.buys24h += toNum(pair.txns?.h24?.buys) ?? 0;
        agg.sells24h += toNum(pair.txns?.h24?.sells) ?? 0;
        agg.buys6h += toNum(pair.txns?.h6?.buys) ?? 0;
        agg.sells6h += toNum(pair.txns?.h6?.sells) ?? 0;
        const created = toNum(pair.pairCreatedAt);
        if (created && (!agg.oldestPairAt || created < agg.oldestPairAt)) agg.oldestPairAt = created;
        if (!agg.topPair || liq > agg.topPair.liquidityUsd) agg.topPair = { url: pair.url, dexId: pair.dexId, pairAddress: pair.pairAddress, liquidityUsd: liq, priceUsd: toNum(pair.priceUsd) };
        for (const w of pair.info?.websites ?? []) if (w?.url && !agg.websites.includes(w.url)) agg.websites.push(w.url);
        for (const s of pair.info?.socials ?? []) if (s?.url && !agg.socials.some((x) => x.url === s.url)) agg.socials.push({ type: s.type, url: s.url });
        out[addr] = agg;
      }
    }
    if (!last) return notConfigured('dexscreener', '/tokens/v1', 'fără adrese');
    return { ...last, ok: Object.keys(out).length > 0 || last.ok, data: out };
  };
  return { id: 'dexscreener', boosts, tokens };
}

/* ----------------------------------------------------------------------------- GeckoTerminal */
export function createGeckoTerminal({ http, cfg }) {
  const headers = { accept: 'application/json;version=20230302' };
  const trendingPools = async () => {
    if (!cfg.enabled) return disabled('geckoterminal', '/networks/trending_pools');
    return mapResult(
      await http.getJson('https://api.geckoterminal.com/api/v2/networks/trending_pools?page=1', opt('geckoterminal', cfg, '/networks/trending_pools', { headers, validate: (d) => Array.isArray(d?.data) })),
      (d) => d.data.map((p) => {
        const id = p.relationships?.base_token?.data?.id ?? '';
        const cut = id.indexOf('_');
        return { network: cut > 0 ? id.slice(0, cut) : null, baseTokenAddress: cut > 0 ? id.slice(cut + 1) : null, name: p.attributes?.name ?? null };
      }).filter((x) => x.baseTokenAddress),
    );
  };

  const tokenInfo = async (chain, address) => {
    if (!cfg.enabled) return disabled('geckoterminal', '/tokens/{address}/info');
    const net = CHAINS[chain]?.geckoterminal;
    if (!net) return notConfigured('geckoterminal', '/tokens/{address}/info', `lanț nesuportat: ${chain}`);
    return mapResult(
      await http.getJson(`https://api.geckoterminal.com/api/v2/networks/${net}/tokens/${address}/info`, opt('geckoterminal', cfg, '/networks/{net}/tokens/{address}/info', { headers, validate: (d) => d?.data?.attributes, retries: 1 })),
      (d) => {
        const a = d.data.attributes;
        const dist = a.holders?.distribution_percentage ?? {};
        return {
          holders: toNum(a.holders?.count),
          top10Pct: toNum(dist.top_10),
          distribution: dist,
          gtScore: toNum(a.gt_score),
          honeypot: a.is_honeypot === true ? true : a.is_honeypot === false ? false : null,
          mintAuthority: a.mint_authority ?? null,
          freezeAuthority: a.freeze_authority ?? null,
          categories: a.categories ?? [],
          twitter: a.twitter_handle ?? null,
          websites: a.websites ?? [],
        };
      },
    );
  };
  return { id: 'geckoterminal', trendingPools, tokenInfo };
}

/* ----------------------------------------------------------------------------- GoPlus */
const BURN = /^(0x0{40}|0x0{36}dead|0x000000000000000000000000000000000000dead)$/i;

export function createGoPlus({ http, cfg }) {
  const security = async (chain, addresses) => {
    if (!cfg.enabled) return disabled('goplus', '/token_security');
    const id = CHAINS[chain]?.goplus;
    if (!id) return notConfigured('goplus', '/token_security', `lanț nesuportat: ${chain}`);
    const out = {};
    let last = null;
    const batchSize = Math.max(1, cfg.batchSize ?? 1);
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      const url = id === 'solana'
        ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${batch.join(',')}`
        : `https://api.gopluslabs.io/api/v1/token_security/${id}?contract_addresses=${batch.join(',')}`;
      const r = await http.getJson(url, opt('goplus', cfg, id === 'solana' ? '/solana/token_security' : '/token_security/{chain}', { validate: (d) => d && typeof d.result === 'object' }));
      last = r;
      if (!r.ok || !r.data.result) continue;
      for (const [addr, info] of Object.entries(r.data.result)) {
        out[normAddress(chain, addr)] = id === 'solana' ? normalizeSolana(info) : normalizeEvm(info);
      }
    }
    if (!last) return notConfigured('goplus', '/token_security', 'fără adrese');
    return { ...last, ok: Object.keys(out).length > 0 || last.ok, data: out };
  };
  return { id: 'goplus', security };
}

function holderStats(holders, totalSupply) {
  if (!Array.isArray(holders) || !holders.length) return { top10Pct: null, top10EffectivePct: null };
  const parsed = holders.map((h) => ({
    pct: (toNum(h.percent) ?? (toNum(h.balance) && toNum(totalSupply) ? toNum(h.balance) / toNum(totalSupply) : 0)) * 100,
    address: String(h.address ?? h.account ?? ''),
    tag: String(h.tag ?? ''),
    locked: flag01(h.is_locked) === true,
    contract: flag01(h.is_contract) === true,
  }));
  const top = parsed.slice(0, 10);
  const top10Pct = top.reduce((s, h) => s + h.pct, 0);
  const NON_ENTITY = /\b(burn|dead|null|lock|locked|locker|pancake\w*|uniswap|raydium|orca|meteora|aerodrome|pool|lp|binance|okx|bybit|gate|mexc|bitget|kucoin|htx|exchange)\b/i;
  const effective = parsed.filter((h) => !h.locked && !BURN.test(h.address) && !NON_ENTITY.test(h.tag)).slice(0, 10);
  return { top10Pct: Math.min(100, top10Pct), top10EffectivePct: Math.min(100, effective.reduce((s, h) => s + h.pct, 0)) };
}

export function normalizeEvm(x) {
  const owner = String(x.owner_address ?? '');
  const stats = holderStats(x.holders, x.total_supply);
  return {
    holders: toNum(x.holder_count),
    top10Pct: stats.top10Pct,
    top10EffectivePct: stats.top10EffectivePct,
    security: {
      honeypot: flag01(x.is_honeypot),
      cannotSell: flag01(x.cannot_sell_all),
      buyTax: toNum(x.buy_tax),
      sellTax: toNum(x.sell_tax),
      mintable: flag01(x.is_mintable),
      ownerRenounced: owner === '' || BURN.test(owner),
      hiddenOwner: flag01(x.hidden_owner),
      canTakeBackOwnership: flag01(x.can_take_back_ownership),
      transferPausable: flag01(x.transfer_pausable),
      blacklist: flag01(x.is_blacklisted),
      slippageModifiable: flag01(x.slippage_modifiable),
      proxy: flag01(x.is_proxy),
      openSource: flag01(x.is_open_source),
      trustList: flag01(x.trust_list),
    },
  };
}

export function normalizeSolana(x) {
  const stats = holderStats(x.holders, x.total_supply);
  const status = (v) => flag01(v?.status ?? v);
  return {
    holders: toNum(x.holder_count),
    top10Pct: stats.top10Pct,
    top10EffectivePct: stats.top10EffectivePct,
    security: {
      honeypot: null,
      cannotSell: status(x.non_transferable),
      buyTax: null,
      sellTax: toNum(x.transfer_fee?.fee_rate) ?? null,
      mintable: status(x.mintable),
      ownerRenounced: status(x.mintable) === false,
      hiddenOwner: null,
      canTakeBackOwnership: null,
      transferPausable: status(x.freezable),
      blacklist: null,
      slippageModifiable: null,
      proxy: null,
      openSource: null,
      trustList: flag01(x.trusted_token),
    },
  };
}

/* ----------------------------------------------------------------------------- Arkham (optional) */
/**
 * Arkham Intelligence — the wallet / entity intelligence layer of CRI (v0.5.4): net wallet flow,
 * accumulation vs distribution, exchange inflow/outflow bias, entity context. Persistence across
 * runs is computed from the radar's own history (application layer).
 *
 * Documented endpoint (docs.intel.arkm.com): GET {base}/token/top_flow/{pricingId}?timeLast=7d,
 * header `API-Key`, 1 request/second. Each row is an address intelligence object (with
 * `arkhamEntity` when labelled) plus the USD it received (`inUSD`) and sent (`outUSD`) in the window.
 * Without ARKHAM_API_KEY the provider reports NOT_CONFIGURED and the facts stay UNKNOWN (neutral).
 */
export const ARKHAM_BASE = 'https://api.arkm.com';
const PROTOCOL_TYPE = /(dex|amm|pool|bridge|lending|defi|yield|staking|derivative|perp|router|aggregator|mev|protocol)/;

/** Counterparty class: centralised exchange, DeFi protocol / pool (excluded from wallet bias), or wallet. */
export function arkhamClass(type) {
  const t = String(type ?? '').toLowerCase();
  if (!t) return 'wallet';
  if (t === 'cex' || t.includes('exchange')) return 'cex';
  if (PROTOCOL_TYPE.test(t)) return 'protocol';
  return 'wallet';
}

/**
 * Normalise top-flow rows into wallet-intelligence evidence.
 *  netflowRatio  (in − out) / (in + out) for non-exchange, non-protocol addresses: + = wallets accumulate
 *  exchangeBias  (withdrawals − deposits) / (withdrawals + deposits) on exchanges: + = coins leave exchanges
 */
export function normalizeTopFlows(rows, window = '7d') {
  const acc = { wallet: { in: 0, out: 0 }, cex: { in: 0, out: 0 }, protocol: { in: 0, out: 0 } };
  const entities = new Map();
  let total = 0;
  let labeled = 0;
  let addresses = 0;
  for (const r of rows ?? []) {
    const i = Math.max(0, toNum(r?.inUSD) ?? 0);
    const o = Math.max(0, toNum(r?.outUSD) ?? 0);
    if (!(i + o > 0)) continue;
    addresses += 1;
    const ent = r.address?.arkhamEntity ?? null;
    const label = ent?.name ?? r.address?.arkhamLabel?.name ?? null;
    const cls = arkhamClass(ent?.type);
    acc[cls].in += i;
    acc[cls].out += o;
    total += i + o;
    if (label) {
      labeled += i + o;
      const id = ent?.id ?? label;
      const e = entities.get(id) ?? { name: label, type: ent?.type ?? null, cls, inUsd: 0, outUsd: 0 };
      e.inUsd += i;
      e.outUsd += o;
      entities.set(id, e);
    }
  }
  const bias = (a, b) => (a + b > 0 ? (a - b) / (a + b) : null);
  const topEntities = [...entities.values()]
    .map((e) => ({ ...e, netUsd: e.inUsd - e.outUsd }))
    .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd))
    .slice(0, 6);
  return {
    window,
    addresses,
    walletInUsd: acc.wallet.in,
    walletOutUsd: acc.wallet.out,
    walletNetUsd: acc.wallet.in - acc.wallet.out,
    netflowRatio: bias(acc.wallet.in, acc.wallet.out),
    exchangeInUsd: acc.cex.in,
    exchangeOutUsd: acc.cex.out,
    exchangeNetUsd: acc.cex.in - acc.cex.out,
    exchangeBias: bias(acc.cex.out, acc.cex.in),
    protocolNetUsd: acc.protocol.in - acc.protocol.out,
    entityCount: entities.size,
    labeledShare: total > 0 ? labeled / total : null,
    topEntities,
  };
}

export function createArkham({ http, cfg, apiKey = null, baseUrl = ARKHAM_BASE }) {
  const window = cfg.window ?? '7d';
  const tokenFlows = async (pricingId) => {
    if (!apiKey) return notConfigured('arkham', '/token/top_flow/{id}', 'ARKHAM_API_KEY nesetat: fluxurile de portofele rămân necunoscute (neutru)');
    if (!cfg.enabled) return disabled('arkham', '/token/top_flow/{id}');
    const url = `${baseUrl.replace(/\/+$/, '')}/token/top_flow/${encodeURIComponent(pricingId)}?timeLast=${encodeURIComponent(window)}`;
    return mapResult(
      await http.getJson(url, opt('arkham', cfg, '/token/top_flow/{id}', {
        headers: { 'API-Key': apiKey },
        retries: 1,
        validate: (d) => Array.isArray(d) || Array.isArray(d?.flows) || Array.isArray(d?.data),
      })),
      (d) => normalizeTopFlows(Array.isArray(d) ? d : d.flows ?? d.data, window),
    );
  };
  /**
   * Address intelligence for holder labelling — the Level 2 slot of the platform model.
   * Documented: GET {base}/intelligence/address/{address}, header `API-Key`, 1 req/s. Each address
   * is one call, so the caller budgets: only the top holders of a deep-research asset are resolved,
   * and the result is merged into the classifier *above* the bundled eth-labels dataset.
   * Without a key this returns NOT_CONFIGURED and classification falls back to eth-labels, which is
   * why nothing in the project breaks when the trial expires.
   */
  const addresses = async (list, { max = 25 } = {}) => {
    const endpoint = '/intelligence/address/{address}';
    if (!apiKey) {
      return notConfigured('arkham', endpoint,
        'ARKHAM_API_KEY nesetat — etichetarea entităților se face din setul eth-labels inclus în repo; cheia Arkham (trial gratuit la cerere) adaugă tipul entității și numele');
    }
    if (!cfg.enabled) return disabled('arkham', endpoint);
    const base = baseUrl.replace(/\/+$/, '');
    const targets = [...new Set((list ?? []).filter(Boolean))].slice(0, max);
    if (!targets.length) return disabled('arkham', endpoint);
    const out = new Map();
    let okCount = 0;
    let last = null;
    for (const address of targets) {
      const r = await http.getJson(`${base}${endpoint.replace('{address}', encodeURIComponent(address))}`, opt('arkham', cfg, endpoint, {
        headers: { 'API-Key': apiKey },
        retries: 1,
        validate: (d) => d && typeof d === 'object',
      }));
      last = r;
      if (!r.ok) continue;
      okCount += 1;
      const d = r.data ?? {};
      const ent = d.arkhamEntity ?? d.entity ?? null;
      const lbl = d.arkhamLabel ?? d.label ?? null;
      if (!ent && !lbl) continue;
      out.set(String(address).toLowerCase(), {
        name: ent?.name ?? lbl?.name ?? null,
        entity: ent?.name ?? null,
        type: ent?.type ?? lbl?.type ?? null,
        id: ent?.id ?? null,
        cls: arkhamClass(ent?.type),
      });
    }
    if (!okCount) return last ?? notConfigured('arkham', endpoint, 'niciun răspuns valid');
    return {
      ok: true,
      status: 'OK',
      data: out,
      message: okCount < targets.length ? `parțial: ${okCount}/${targets.length} adrese rezolvate` : '',
      meta: { ...(last?.meta ?? {}), endpoint, records: out.size, requested: targets.length },
    };
  };

  return { id: 'arkham', keyed: Boolean(apiKey), tokenFlows, addresses };
}

/* ----------------------------------------------------------------------------- DefiLlama */
export function createDefiLlama({ http, cfg }) {
  const protocols = async () => {
    if (!cfg.enabled) return disabled('defillama', '/protocols');
    return mapResult(
      await http.getJson('https://api.llama.fi/protocols', opt('defillama', cfg, '/protocols', { validate: Array.isArray, timeoutMs: Math.max(cfg.timeoutMs, 40_000) })),
      (rows) => rows
        .filter((p) => p.gecko_id && isNum(toNum(p.tvl)))
        .map((p) => ({ id: String(p.id), name: p.name, slug: p.slug, geckoId: p.gecko_id, category: p.category, tvl: toNum(p.tvl), change1d: toNum(p.change_1d), change7d: toNum(p.change_7d), parentProtocol: p.parentProtocol ?? null })),
    );
  };
  const fees = async () => {
    if (!cfg.enabled) return disabled('defillama', '/overview/fees');
    return mapResult(
      await http.getJson('https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', opt('defillama', cfg, '/overview/fees', { validate: (d) => Array.isArray(d?.protocols), timeoutMs: Math.max(cfg.timeoutMs, 40_000) })),
      (d) => d.protocols.map((p) => ({ defillamaId: p.defillamaId ? String(p.defillamaId) : null, parentProtocol: p.parentProtocol ?? null, slug: p.slug ?? null, name: p.name, total24h: toNum(p.total24h), total30d: toNum(p.total30d), change1m: toNum(p.change_1m) })),
    );
  };
  return { id: 'defillama', protocols, fees };
}
