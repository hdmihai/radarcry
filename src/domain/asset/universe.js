/**
 * Universe construction: merge CoinGecko + CoinMarketCap (+ CoinPaprika fallback) rows into
 * canonical assets, add the exchange Alpha tokens (Binance Alpha, Gate Alpha) the aggregators' top
 * 1000 does not reach, keep
 * provenance per field family, flag cross-source disagreements and apply research-universe
 * exclusions (stablecoins, wrapped / staked receipts, tokenised assets).
 */
import { isNum, ratio } from '../shared/math.js';
import { ageDays, toMs } from '../shared/time.js';
import { CHAIN_PRIORITY, exclusionReason, namesMatch, normAddress, normChain, normSymbol } from '../shared/symbols.js';

/**
 * @typedef {Object} MarketRow  Normalised row produced by a universe adapter.
 * @property {'coingecko'|'coinmarketcap'|'coinpaprika'|'binance_alpha'|'gate_alpha'} source
 * @property {string} sourceId
 * @property {string} [slug]
 * @property {string} symbol
 * @property {string} name
 * @property {number|null} rank
 * @property {number|null} price
 * @property {number|null} marketCap
 * @property {number|null} fdv
 * @property {number|null} volume24h
 * @property {number|null} circulating
 * @property {number|null} total
 * @property {number|null} max
 * @property {Record<string, number|null>} change  percent changes keyed h1,h24,d7,d14,d30,d60,d90,d200,y1
 * @property {number|null} [mcapChange24h]  market-cap change % over 24h (CoinGecko)
 * @property {number|null} ath
 * @property {number|null} athChangePct
 * @property {string|null} athDate
 * @property {string|null} dateAdded
 * @property {string|null} firstDataAt
 * @property {string[]} tags
 * @property {{chain:string, address:string}|null} platform
 * @property {number|null} numMarketPairs
 * @property {string|null} image
 * @property {string|null} lastUpdated
 */

const pick = (...vals) => vals.find((v) => v !== null && v !== undefined) ?? null;

function emptyAsset(key, row) {
  return {
    key,
    symbol: normSymbol(row.symbol),
    name: row.name ?? row.symbol,
    ids: { coingecko: null, cmc: null, cmcSlug: null, paprika: null, alpha: null, gateAlpha: null },
    rank: { cmc: null, coingecko: null, paprika: null },
    market: {
      price: null, marketCap: null, fdv: null, volume24h: null, circulating: null, total: null, max: null,
      change: {}, mcapChange24h: null, ath: null, athChangePct: null, athDate: null, numMarketPairs: null, lastUpdated: null,
    },
    listing: { dateAdded: null, firstDataAt: null },
    tags: [],
    platforms: [],
    image: null,
    sources: [],
    quality: { flags: [], mcapDisagreementPct: null },
    _raw: {},
  };
}

function addPlatform(asset, chainRaw, addressRaw) {
  const chain = normChain(chainRaw);
  if (!chain) return;
  const address = normAddress(chain, addressRaw);
  if (!address) return;
  if (!asset.platforms.some((p) => p.chain === chain && p.address === address)) asset.platforms.push({ chain, address });
}

function absorb(asset, row) {
  asset._raw[row.source] = row;
  if (!asset.sources.includes(row.source)) asset.sources.push(row.source);
  if (row.source === 'coingecko') { asset.ids.coingecko = row.sourceId; asset.rank.coingecko = row.rank; }
  if (row.source === 'coinmarketcap') { asset.ids.cmc = row.sourceId; asset.ids.cmcSlug = row.slug ?? null; asset.rank.cmc = row.rank; }
  if (row.source === 'coinpaprika') { asset.ids.paprika = row.sourceId; asset.rank.paprika = row.rank; }
  if (row.source === 'binance_alpha') asset.ids.alpha = row.sourceId;
  if (row.source === 'gate_alpha') asset.ids.gateAlpha = row.sourceId;
  if (row.platform?.address) addPlatform(asset, row.platform.chain, row.platform.address);
  if (!asset.image && row.image) asset.image = row.image;
  if (row.tags?.length) asset.tags = [...new Set([...asset.tags, ...row.tags.map((t) => String(t).toLowerCase())])];
}

/** Resolve market fields with an explicit precedence per field family. */
function resolve(asset) {
  const cg = asset._raw.coingecko ?? {};
  const cmc = asset._raw.coinmarketcap ?? {};
  const cp = asset._raw.coinpaprika ?? {};
  // The exchange Alpha lists are the last resort for every field: the aggregators are cross-checked
  // against each other, an Alpha list is one venue's view. For tokens below the aggregators' top
  // 1000 it is the only view there is. Binance Alpha comes before Gate Alpha because it is complete
  // (price, supply, volume, holders, liquidity); Gate reports price, market cap and its own volume.
  const ba = asset._raw.binance_alpha ?? {};
  const ga = asset._raw.gate_alpha ?? {};
  const m = asset.market;
  // Prices / caps / volumes: CoinGecko first (also provides 14d/200d), then CMC, then Paprika.
  m.price = pick(cg.price, cmc.price, cp.price, ba.price, ga.price);
  m.marketCap = pick(positive(cg.marketCap), positive(cmc.marketCap), positive(cp.marketCap), positive(ba.marketCap), positive(ga.marketCap));
  m.volume24h = pick(cg.volume24h, cmc.volume24h, cp.volume24h, ba.volume24h, ga.volume24h);
  // Supply: CMC tends to be more complete; fall back to CoinGecko / Paprika.
  m.circulating = pick(positive(cmc.circulating), positive(cg.circulating), positive(cp.circulating), positive(ba.circulating));
  m.total = pick(positive(cmc.total), positive(cg.total), positive(cp.total), positive(ba.total));
  m.max = pick(positive(cmc.max), positive(cg.max), positive(cp.max));
  m.fdv = pick(positive(cg.fdv), positive(cmc.fdv), positive(cp.fdv), positive(ba.fdv));
  if (m.fdv === null && isNum(m.price) && isNum(m.max ?? m.total)) m.fdv = m.price * (m.max ?? m.total);
  const keys = ['h1', 'h24', 'd7', 'd14', 'd30', 'd60', 'd90', 'd200', 'y1'];
  for (const k of keys) m.change[k] = pick(cg.change?.[k], cmc.change?.[k], cp.change?.[k], ba.change?.[k], ga.change?.[k]);
  m.mcapChange24h = pick(cg.mcapChange24h);
  m.ath = pick(cg.ath, cmc.ath, cp.ath);
  m.athChangePct = pick(cg.athChangePct, cmc.athChangePct, cp.athChangePct);
  m.athDate = pick(cg.athDate, cp.athDate);
  m.numMarketPairs = pick(cmc.numMarketPairs);
  m.lastUpdated = pick(cg.lastUpdated, cmc.lastUpdated, cp.lastUpdated);
  asset.listing.dateAdded = pick(cmc.dateAdded, ba.dateAdded);
  asset.listing.firstDataAt = pick(cp.firstDataAt);
  asset.name = pick(cg.name, cmc.name, cp.name, ba.name, ga.name, asset.name);

  const a = positive(cg.marketCap);
  const b = positive(cmc.marketCap);
  if (isNum(a) && isNum(b)) {
    const diff = (Math.max(a, b) / Math.min(a, b) - 1) * 100;
    asset.quality.mcapDisagreementPct = diff;
    if (diff > 50) asset.quality.flags.push('MCAP_DISAGREEMENT');
  }
}

const positive = (x) => (isNum(x) && x > 0 ? x : null);

function logDistance(a, b) {
  if (!isNum(a) || !isNum(b) || a <= 0 || b <= 0) return Infinity;
  return Math.abs(Math.log10(a) - Math.log10(b));
}

/**
 * @param {{coingecko?:MarketRow[]|null, coinmarketcap?:MarketRow[]|null, coinpaprika?:MarketRow[]|null,
 *          binanceAlpha?:MarketRow[]|null, gateAlpha?:MarketRow[]|null,
 *          cgPlatforms?:Map<string, {chain:string,address:string}[]>|null, nowMs:number}} input
 */
export function mergeUniverse({ coingecko = null, coinmarketcap = null, coinpaprika = null, binanceAlpha = null, gateAlpha = null, cgPlatforms = null, nowMs }) {
  /** @type {Map<string, any>} */
  const assets = new Map();
  const bySymbol = new Map();
  const byAddress = new Map();
  const index = (asset) => {
    const list = bySymbol.get(asset.symbol) ?? [];
    if (!list.includes(asset)) list.push(asset);
    bySymbol.set(asset.symbol, list);
    for (const p of asset.platforms) byAddress.set(p.address, asset);
  };

  for (const row of coingecko ?? []) {
    const key = `cg:${row.sourceId}`;
    if (assets.has(key)) continue;
    const asset = emptyAsset(key, row);
    absorb(asset, row);
    for (const p of cgPlatforms?.get(row.sourceId) ?? []) addPlatform(asset, p.chain, p.address);
    assets.set(key, asset);
    index(asset);
  }

  const matchRow = (row, allowed) => {
    const addr = row.platform?.address ? normAddress(normChain(row.platform.chain) ?? 'evm', row.platform.address) : null;
    if (addr && byAddress.has(addr)) {
      const hit = byAddress.get(addr);
      if (allowed(hit)) return hit;
    }
    const sym = normSymbol(row.symbol);
    const candidates = (bySymbol.get(sym) ?? []).filter(allowed);
    let best = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const capRow = row.marketCap;
      const capAsset = c.market.marketCap ?? c._raw.coingecko?.marketCap ?? c._raw.coinmarketcap?.marketCap;
      const d = logDistance(capRow, capAsset);
      const nameOk = namesMatch(row.name, c.name);
      let score = 0;
      if (nameOk) score += 2;
      if (d < 0.15) score += 2; else if (d < 0.35) score += 1; else if (d !== Infinity && d > 0.8) score -= 2;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best && bestScore >= 2 ? best : null;
  };

  for (const row of coinmarketcap ?? []) {
    const hit = matchRow(row, (a) => !a.ids.cmc);
    if (hit) {
      absorb(hit, row);
      index(hit);
      continue;
    }
    const key = `cmc:${row.slug ?? row.sourceId}`;
    if (assets.has(key)) continue;
    const asset = emptyAsset(key, row);
    absorb(asset, row);
    assets.set(key, asset);
    index(asset);
  }

  const haveMainSources = (coingecko?.length ?? 0) + (coinmarketcap?.length ?? 0) > 0;
  for (const row of coinpaprika ?? []) {
    const hit = matchRow(row, (a) => !a.ids.paprika);
    if (hit) { absorb(hit, row); continue; }
    if (haveMainSources) continue; // Paprika only enriches unless both primary sources failed.
    const key = `cp:${row.sourceId}`;
    if (assets.has(key)) continue;
    const asset = emptyAsset(key, row);
    absorb(asset, row);
    assets.set(key, asset);
    index(asset);
  }

  /*
   * Exchange Alpha lists (Binance Alpha, then Gate Alpha). Unlike Paprika, an Alpha list *adds* the
   * tokens the aggregators' top 1000 does not reach, because that is where this radar's targets set
   * up: LAB, BTW and AGT were all Binance Alpha tokens, and LAB was a $12M project before its move —
   * under the ~$15M floor of the top 1000. A token already in the universe is matched by contract
   * first, then by symbol + name + capitalisation, and only enriched. A new one takes its CoinGecko
   * identity when CoinGecko's contract map knows it (so the key stays the same if it later enters
   * the top 1000, and its history follows it), else the stable id of the list it came from. A token
   * on both lists becomes one asset: the second list finds the first one's contract in the index.
   */
  let cgByContract = null;
  const contractMap = () => {
    if (cgByContract) return cgByContract;
    cgByContract = new Map();
    for (const [cgId, list] of cgPlatforms ?? []) {
      for (const p of list ?? []) {
        const chain = normChain(p.chain);
        const address = chain ? normAddress(chain, p.address) : null;
        if (address) cgByContract.set(`${chain}:${address}`, cgId);
      }
    }
    return cgByContract;
  };
  const ALPHA_LISTS = [
    { rows: binanceAlpha, idField: 'alpha', keyPrefix: 'alpha' },
    { rows: gateAlpha, idField: 'gateAlpha', keyPrefix: 'gatealpha' },
  ];
  for (const { rows, idField, keyPrefix } of ALPHA_LISTS) {
    for (const row of rows ?? []) {
      const hit = matchRow(row, (a) => !a.ids[idField]);
      if (hit) { absorb(hit, row); index(hit); continue; }
      const chain = normChain(row.platform?.chain);
      // A token on a chain the research pipeline cannot read (no DEX, holder or security source for
      // it) would enter as a price and nothing else; it stays out rather than in half-blind.
      if (!chain) continue;
      const address = normAddress(chain, row.platform?.address);
      const cgId = address ? contractMap().get(`${chain}:${address}`) ?? null : null;
      const key = cgId ? `cg:${cgId}` : `${keyPrefix}:${row.sourceId}`;
      const existing = assets.get(key);
      if (existing) { absorb(existing, row); index(existing); continue; }
      const asset = emptyAsset(key, row);
      absorb(asset, row);
      if (cgId) asset.ids.coingecko = cgId;
      assets.set(key, asset);
      index(asset);
    }
  }

  const out = [];
  for (const asset of assets.values()) {
    resolve(asset);
    asset.platforms.sort((a, b) => rankChain(a.chain) - rankChain(b.chain));
    asset.primary = asset.platforms[0] ?? null;
    const m = asset.market;
    asset.derived = {
      turnover: ratio(m.volume24h, m.marketCap),
      floatRatio: floatRatio(m),
      fdvToMcap: ratio(m.fdv, m.marketCap),
      ageDays: minAge([asset.listing.dateAdded, asset.listing.firstDataAt], nowMs),
    };
    if (isNum(toMs(m.lastUpdated)) && nowMs - toMs(m.lastUpdated) > 6 * 3_600_000) asset.quality.flags.push('STALE_QUOTE');
    delete asset._raw;
    out.push(asset);
  }
  return out;
}

function floatRatio(m) {
  const denom = m.total ?? m.max;
  if (!isNum(m.circulating) || !isNum(denom) || denom <= 0) return null;
  return Math.min(1, m.circulating / denom);
}

function minAge(values, nowMs) {
  const ages = values.map((v) => ageDays(v, nowMs)).filter(isNum);
  return ages.length ? Math.max(...ages) : null; // earliest known listing date = oldest age
}

const rankChain = (c) => {
  const i = CHAIN_PRIORITY.indexOf(c);
  return i === -1 ? 99 : i;
};

/** Split the merged universe into research-eligible assets and documented exclusions. */
export function screenUniverse(assets, cfg) {
  const eligible = [];
  const excluded = [];
  for (const a of assets) {
    const reason = exclusionReason({ symbol: a.symbol, name: a.name, tags: a.tags, price: a.market.price, change7d: a.market.change.d7 });
    if (reason) { excluded.push({ key: a.key, symbol: a.symbol, reason }); continue; }
    const mc = a.market.marketCap;
    const vol = a.market.volume24h;
    if (!isNum(mc)) { excluded.push({ key: a.key, symbol: a.symbol, reason: 'NO_MARKET_CAP' }); continue; }
    if (mc < cfg.minMarketCapUsd) { excluded.push({ key: a.key, symbol: a.symbol, reason: 'BELOW_MIN_MCAP' }); continue; }
    if (mc > cfg.maxMarketCapUsd) { excluded.push({ key: a.key, symbol: a.symbol, reason: 'ABOVE_MAX_MCAP' }); continue; }
    if (isNum(vol) && vol < cfg.minVolume24hUsd) { excluded.push({ key: a.key, symbol: a.symbol, reason: 'LOW_VOLUME' }); continue; }
    eligible.push(a);
  }
  return { eligible, excluded };
}
