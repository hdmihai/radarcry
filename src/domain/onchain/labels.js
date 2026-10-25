/**
 * HOLDER CLASSIFICATION — turning a list of addresses into a list of *actors*.
 *
 * A raw top-holder list is nearly useless for research: the biggest "holder" is usually a liquidity
 * pool, a bridge, a staking contract or the burn address. Concentration computed over that list says
 * nothing about who can actually sell. This module classifies every holder and lets the metrics be
 * recomputed over the *effective* supply — the part that is held by actors who can trade it.
 *
 * Classification precedence, strongest evidence first:
 *   1. canonical burn addresses (a hard fact, not a label)
 *   2. Arkham entity type, when an Arkham key is configured (Level 2 of the platform model)
 *   3. the bundled eth-labels dataset (MIT, 59k EVM addresses: CEX, bridges, LPs, funds, protocols)
 *   4. GoPlus contract flags (locked, LP, creator, owner)
 *   5. the token's own creator / owner / pair addresses discovered this run
 *   6. contract-vs-wallet detection from the chain itself
 */

export const HOLDER_CLASSES = {
  WALLET: 'wallet',
  FUND: 'fund',
  PROJECT: 'project',
  CONTRACT: 'contract',
  BOT: 'bot',
  FLAGGED: 'flagged',
  CEX: 'cex',
  LP: 'lp',
  PROTOCOL: 'protocol',
  STAKING: 'staking',
  BRIDGE: 'bridge',
  BURN: 'burn',
  LOCK: 'lock',
};

/** Compact codes used by the state codec (history must stay small on the state branch). */
export const CLASS_CODE = {
  wallet: 'w', fund: 'f', project: 'p', contract: 'c', bot: 'b', flagged: 'x',
  cex: 'e', lp: 'l', protocol: 'r', staking: 's', bridge: 'g', burn: 'z', lock: 'k',
};
export const CODE_CLASS = Object.fromEntries(Object.entries(CLASS_CODE).map(([k, v]) => [v, k]));

/**
 * Classes removed from the *effective* (tradable, free-float) supply. These balances cannot be sold
 * by a decision-maker: they are pooled, bridged, staked, locked or destroyed.
 */
export const EXCLUDED_FROM_EFFECTIVE = new Set([
  HOLDER_CLASSES.LP,
  HOLDER_CLASSES.BRIDGE,
  HOLDER_CLASSES.STAKING,
  HOLDER_CLASSES.BURN,
  HOLDER_CLASSES.LOCK,
  HOLDER_CLASSES.PROTOCOL,
]);

/** Classes that are "someone who could sell into your thesis". */
export const SELLABLE_ACTORS = new Set([
  HOLDER_CLASSES.WALLET,
  HOLDER_CLASSES.FUND,
  HOLDER_CLASSES.PROJECT,
  HOLDER_CLASSES.BOT,
  HOLDER_CLASSES.FLAGGED,
  HOLDER_CLASSES.CEX,
]);

export const CLASS_LABEL_RO = {
  wallet: 'portofel individual',
  fund: 'fond / instituție',
  project: 'trezoreria proiectului',
  contract: 'contract',
  bot: 'bot / MEV',
  flagged: 'adresă semnalată',
  cex: 'bursă centralizată',
  lp: 'pool de lichiditate',
  protocol: 'contract de protocol',
  staking: 'staking',
  bridge: 'bridge',
  burn: 'adresă de ardere',
  lock: 'vesting / lock',
};

/** Addresses that are burn sinks on every EVM chain, plus common chain-specific ones. */
export const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0x00000000000000000000000000000000000000ff',
  '0xdead000000000000000042069420694206942069',
  '0x0000000000000000000000000000000000001004',
  '11111111111111111111111111111111',
  'so11111111111111111111111111111111111111112'.slice(0, 0) || 'incinerator1111111111111111111111111111111',
  '1nc1nerator11111111111111111111111111111111',
]);

/**
 * Index the bundled dataset for O(1) lookups.
 *
 * Accepts both shapes: the compact columnar encoding written by scripts/update-labels.js
 * (`{ format:'columnar-v1', classes, entities, rows:["<addr-no-0x>|<classIdx>|<entityIdx>"] }`),
 * and a plain array of `{ address, class, entity }` rows, which is what tests and fixtures use.
 *
 * @param {any} dataset
 */
export function createLabelIndex(dataset) {
  const map = new Map();
  const put = (address, cls, entity) => {
    const a = String(address ?? '').toLowerCase();
    if (!a || !cls) return;
    if (!map.has(a)) map.set(a, { class: cls, entity: entity ?? null, label: entity ?? null, source: 'eth-labels' });
  };

  if (dataset && dataset.format === 'columnar-v1' && Array.isArray(dataset.rows)) {
    const classes = dataset.classes ?? [];
    const entities = dataset.entities ?? [];
    for (const row of dataset.rows) {
      const parts = String(row).split('|');
      if (parts.length < 2) continue;
      const cls = classes[Number(parts[1])];
      const ei = parts[2] === '' || parts[2] === undefined ? -1 : Number(parts[2]);
      put(`0x${parts[0]}`, cls, ei >= 0 ? entities[ei] ?? null : null);
    }
  } else {
    const rows = Array.isArray(dataset) ? dataset : dataset?.accounts ?? [];
    for (const row of rows) put(row.address, row.class, row.entity ?? row.label ?? null);
  }

  return {
    size: map.size,
    counts: dataset?.counts ?? null,
    source: dataset?.source ?? null,
    license: dataset?.license ?? null,
    builtAt: dataset?.builtAt ?? null,
    get: (address) => (address ? map.get(String(address).toLowerCase()) ?? null : null),
  };
}

export const emptyLabelIndex = () => ({ size: 0, get: () => null });

/** Map an Arkham entity type onto our holder classes. */
export function arkhamTypeClass(type) {
  const t = String(type ?? '').toLowerCase();
  if (!t) return null;
  if (/cex|exchange/.test(t)) return HOLDER_CLASSES.CEX;
  if (/fund|institution|vc|venture|whale|individual_hnw/.test(t)) return HOLDER_CLASSES.FUND;
  if (/bridge/.test(t)) return HOLDER_CLASSES.BRIDGE;
  if (/defi|protocol|dex|lending|amm/.test(t)) return HOLDER_CLASSES.PROTOCOL;
  if (/stake|validator/.test(t)) return HOLDER_CLASSES.STAKING;
  if (/treasury|team|foundation|project|issuer|dao/.test(t)) return HOLDER_CLASSES.PROJECT;
  if (/mev|bot|arbitrage/.test(t)) return HOLDER_CLASSES.BOT;
  if (/hack|exploit|scam|sanction|phish|mixer|ransom/.test(t)) return HOLDER_CLASSES.FLAGGED;
  if (/individual|wallet|personal/.test(t)) return HOLDER_CLASSES.WALLET;
  return null;
}

const LABEL_PATTERNS = [
  [/burn|incinerat|null address|dead address/i, HOLDER_CLASSES.BURN],
  [/vesting|timelock|time lock|unlock contract|lockup/i, HOLDER_CLASSES.LOCK],
  [/liquidity pool|pancake|uniswap|sushiswap|raydium|orca|curve|balancer|\blp\b|pair|amm/i, HOLDER_CLASSES.LP],
  [/bridge|wormhole|portal|layerzero|stargate|across|hop protocol|celer|synapse/i, HOLDER_CLASSES.BRIDGE],
  [/staking|stake pool|validator|masterchef|gauge|rewards? (pool|distributor)/i, HOLDER_CLASSES.STAKING],
  [/binance|coinbase|kraken|okx|bybit|kucoin|gate\.io|mexc|bitget|huobi|htx|upbit|bithumb|crypto\.com|bitfinex|gemini|bitstamp|exchange/i, HOLDER_CLASSES.CEX],
  [/hack|exploit|scam|phish|sanction|tornado|mixer|ransom|stolen|fake/i, HOLDER_CLASSES.FLAGGED],
  [/treasury|foundation|team|dao\b|multisig|ecosystem fund|reserve/i, HOLDER_CLASSES.PROJECT],
  [/capital|ventures|fund|labs\b|partners|asset management|arca|jump|wintermute|alameda|gsr|dwf/i, HOLDER_CLASSES.FUND],
  [/mev|bot\b|arbitrage|sandwich|jaredfromsubway|banana gun|maestro|trojan/i, HOLDER_CLASSES.BOT],
  [/router|factory|proxy|vault|controller|oracle|registry|aggregator|protocol/i, HOLDER_CLASSES.PROTOCOL],
];

/** Classify by free-text label as a last resort before structural detection. */
export function classifyByLabel(text) {
  if (!text) return null;
  for (const [re, cls] of LABEL_PATTERNS) if (re.test(text)) return cls;
  return null;
}

/**
 * Classify one holder.
 *
 * @param {{address:string, balance?:number|null, share?:number|null, isContract?:boolean|null,
 *          tag?:string|null, label?:string|null, locked?:boolean|null, isLp?:boolean|null}} h
 * @param {{labelIndex?:{get:(a:string)=>any}, arkham?:Map<string, any>|null, goplus?:any,
 *          creator?:string|null, owner?:string|null, pairs?:Set<string>|string[]|null, chain?:string}} ctx
 * @returns {{class:string, label:string, source:string, entity:string|null, excluded:boolean,
 *   sellable:boolean, reasons:string[]}}
 */
export function classifyHolder(h, ctx = {}) {
  const addr = String(h.address ?? '').toLowerCase();
  const reasons = [];
  const settle = (cls, source, entity = null) => ({
    class: cls,
    label: CLASS_LABEL_RO[cls] ?? cls,
    source,
    entity,
    excluded: EXCLUDED_FROM_EFFECTIVE.has(cls),
    sellable: SELLABLE_ACTORS.has(cls),
    reasons,
  });

  // 1 · burn addresses are a fact, never a guess.
  if (BURN_ADDRESSES.has(addr) || /^0x0{30,}/.test(addr) || /dead$/.test(addr)) {
    reasons.push('adresă canonică de ardere');
    return settle(HOLDER_CLASSES.BURN, 'canonical');
  }

  // 2 · Arkham entity (only present when a key is configured).
  const ark = ctx.arkham?.get?.(addr) ?? null;
  if (ark) {
    const cls = arkhamTypeClass(ark.type) ?? classifyByLabel(ark.name ?? ark.entity ?? '');
    if (cls) {
      reasons.push(`Arkham: ${ark.name ?? ark.entity ?? ark.type}`);
      return settle(cls, 'arkham', ark.name ?? ark.entity ?? null);
    }
  }

  // 3 · bundled eth-labels dataset.
  const known = ctx.labelIndex?.get?.(addr) ?? null;
  if (known?.class) {
    reasons.push(`eth-labels: ${known.entity ?? known.label ?? known.class}`);
    return settle(known.class, 'eth-labels', known.entity ?? known.label ?? null);
  }

  // 4 · explicit flags carried on the holder row (GoPlus / GeckoTerminal / Solana RPC).
  if (h.isLp === true) { reasons.push('marcat ca pool de lichiditate de către furnizor'); return settle(HOLDER_CLASSES.LP, 'provider'); }
  if (h.locked === true) { reasons.push('balanță blocată'); return settle(HOLDER_CLASSES.LOCK, 'provider'); }
  const fromTag = classifyByLabel(h.tag) ?? classifyByLabel(h.label);
  if (fromTag) { reasons.push(`etichetă furnizor: ${h.tag ?? h.label}`); return settle(fromTag, 'provider', h.tag ?? h.label ?? null); }

  // 5 · the token's own addresses, discovered this run.
  const pairs = ctx.pairs instanceof Set ? ctx.pairs : new Set((ctx.pairs ?? []).map((x) => String(x).toLowerCase()));
  if (pairs.has(addr)) { reasons.push('pool-ul principal al token-ului'); return settle(HOLDER_CLASSES.LP, 'derived'); }
  if (ctx.creator && addr === String(ctx.creator).toLowerCase()) { reasons.push('adresa care a creat contractul'); return settle(HOLDER_CLASSES.PROJECT, 'derived'); }
  if (ctx.owner && addr === String(ctx.owner).toLowerCase()) { reasons.push('owner-ul contractului'); return settle(HOLDER_CLASSES.PROJECT, 'derived'); }

  // 6 · structural: a contract that nothing identified is still not a person.
  if (h.isContract === true) { reasons.push('este contract, neidentificat'); return settle(HOLDER_CLASSES.CONTRACT, 'structural'); }

  reasons.push('neetichetat — tratat ca portofel individual');
  return settle(HOLDER_CLASSES.WALLET, 'default');
}

/**
 * Classify a whole holder list and recompute concentration over the effective supply.
 *
 * @param {{address:string, balance:number|null, share:number|null}[]} holders  descending by balance
 * @param {object} ctx  as for classifyHolder
 * @returns {{holders:any[], byClass:Record<string, {count:number, share:number}>,
 *   top10Pct:number|null, top20Pct:number|null, top50Pct:number|null,
 *   top10EffectivePct:number|null, effectiveSharePct:number|null,
 *   cexSharePct:number|null, lpSharePct:number|null, lockedSharePct:number|null,
 *   projectSharePct:number|null, flaggedSharePct:number|null, whaleSharePct:number|null}}
 */
export function classifyHolders(holders, ctx = {}) {
  const rows = (holders ?? []).map((h) => {
    const cls = classifyHolder(h, ctx);
    return { ...h, ...cls };
  });
  const byClass = {};
  for (const r of rows) {
    const b = (byClass[r.class] ??= { count: 0, share: 0 });
    b.count += 1;
    b.share += Number.isFinite(r.share) ? r.share : 0;
  }

  const shareSum = (list) => {
    const vals = list.map((r) => r.share).filter((x) => Number.isFinite(x));
    return vals.length ? vals.reduce((s, x) => s + x, 0) : null;
  };

  const sorted = [...rows].sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
  const tradable = sorted.filter((r) => !r.excluded);
  const excludedShare = shareSum(sorted.filter((r) => r.excluded)) ?? 0;
  const effectiveBase = Math.max(0, 100 - excludedShare);

  const topN = (list, n) => shareSum(list.slice(0, n));
  const rescale = (x) => (Number.isFinite(x) && effectiveBase > 0 ? Math.min(100, (x / effectiveBase) * 100) : null);

  return {
    holders: rows,
    byClass,
    top10Pct: topN(sorted, 10),
    top20Pct: topN(sorted, 20),
    top50Pct: topN(sorted, 50),
    top10EffectivePct: rescale(topN(tradable, 10)),
    top20EffectivePct: rescale(topN(tradable, 20)),
    /*
     * Share of the tradable float held by the ten largest *independent actors*: exchange wallets are
     * left out of the numerator (they pool thousands of users' balances, so they are not one sell
     * decision) but stay in the base (their balances are tradable supply). This is the measure the
     * concentration invalidator means when it warns that "one decision can undo the move".
     */
    top10ActorsPct: rescale(topN(tradable.filter((r) => r.class !== HOLDER_CLASSES.CEX), 10)),
    effectiveSharePct: effectiveBase > 0 ? effectiveBase : null,
    cexSharePct: byClass.cex?.share ?? null,
    lpSharePct: byClass.lp?.share ?? null,
    lockedSharePct: (byClass.lock?.share ?? 0) + (byClass.staking?.share ?? 0) || null,
    projectSharePct: byClass.project?.share ?? null,
    flaggedSharePct: byClass.flagged?.share ?? null,
    burnSharePct: byClass.burn?.share ?? null,
    // "Whales" = identified funds plus unlabelled wallets above 1 % of supply.
    whaleSharePct: shareSum(rows.filter((r) => r.class === HOLDER_CLASSES.FUND || (r.class === HOLDER_CLASSES.WALLET && (r.share ?? 0) >= 1))),
  };
}
