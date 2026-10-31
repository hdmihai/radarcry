/**
 * Symbol / name normalisation and asset-class exclusion rules.
 * Exclusions keep the research universe on tradable project tokens:
 * no stablecoins, wrapped/bridged assets, liquid-staking receipts or tokenised RWAs.
 */

export function normSymbol(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(token|coin|protocol|network|finance|the|governance|ai)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/** Loose name equality used to disambiguate symbol collisions. */
export function namesMatch(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y));
}

/**
 * Derivative / exchange symbols sometimes carry a size prefix (1000PEPE, 1MBABYDOGE).
 * Returns the base symbol and the multiplier to convert the contract price into a token price.
 */
export function splitMultiplier(rawBase) {
  const base = normSymbol(rawBase);
  const m = base.match(/^(1000000|100000|10000|1000|100|1M|1K)(?=[A-Z])/);
  if (!m) return { base, multiplier: 1 };
  const prefix = m[1];
  const multiplier = prefix === '1M' ? 1_000_000 : prefix === '1K' ? 1000 : Number(prefix);
  return { base: base.slice(prefix.length), multiplier };
}

const STABLE_SYMBOLS = new Set([
  'USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDP', 'PYUSD', 'USDE', 'USDS', 'USDD', 'USD1', 'RLUSD',
  'GUSD', 'LUSD', 'FRAX', 'CRVUSD', 'GHO', 'SUSD', 'EURC', 'EURS', 'EURT', 'USDB', 'USDJ', 'USTC',
  'USD0', 'USDX', 'DOLA', 'MIM', 'BUSD', 'USDG', 'USDF', 'USDA', 'USR', 'AUSD', 'USDY', 'USDTB',
  'BFUSD', 'SUSDE', 'SUSDS', 'FXUSD', 'DEUSD', 'XUSD', 'ZUSD', 'USDO', 'USDM', 'CUSD', 'USDZ',
  'LISUSD', 'USDL', 'U', 'USDQ', 'XAUT', 'PAXG', 'KAU', 'KAG', 'XAUM',
]);

const STABLE_TAGS = ['stablecoin', 'stablecoins', 'fiat-stablecoin', 'usd-stablecoin', 'eur-stablecoin', 'asset-backed-stablecoin', 'algorithmic-stablecoin', 'tokenized-gold', 'gold-backed', 'commodity-backed'];
const WRAPPED_TAGS = ['wrapped-tokens', 'wrapped', 'bridged-tokens', 'liquid-staking-derivatives', 'liquid-staking-tokens', 'liquid-restaking-tokens', 'restaking', 'tokenized-stock', 'tokenized-stocks', 'xstocks', 'tokenized-treasury-bills', 'tokenized-treasuries', 'rwa-treasury'];

const WRAPPED_PATTERNS = [
  /^W(BTC|ETH|BNB|SOL|AVAX|MATIC|POL|FTM|TRX|HBAR|ROSE|CRO|KCS|EGLD|ONE|BETH|STETH|EETH)$/,
  /^(ST|WST|R|CB|M|JITO|B|BN|SFRX|FRX|OS|LS|SAVAX|ANKR|SW|EZ|RS|PU|WE|BB|LB|SOLV|UNI|PZ|EBTC|LBTC|TBTC|CBBTC|BTCB|SOLVBTC|FBTC|UNIBTC|PUMPBTC|ENZOBTC|XSOLVBTC|STBTC)(ETH|SOL|BTC|BNB|MATIC|AVAX|USD|XRP)$/,
  /^(BTCB|CBBTC|LBTC|TBTC|FBTC|SOLVBTC|EBTC|UNIBTC|PUMPBTC|ENZOBTC|STBTC|BBTC|WEETH|EETH|RSETH|EZETH|PUFETH|RSWETH|METH|CMETH|OSETH|ANKRETH|SFRXETH|RETH|CBETH|WSTETH|STETH|BNSOL|JITOSOL|MSOL|BSOL|JUPSOL|INF|HSOL|SSOL|VSOL|STSOL|BBSOL|SLISBNB|WBETH|ASBNB|CLISBNB|STKBNB|SNBNB|STX4|SAVAX|GGAVAX|STHYPE|KHYPE|WHYPE|STS|STAPT|AMAPT|THAPT|WSTUSR|SYRUPUSDC|SYRUPUSDT)$/,
];

const WRAPPED_NAME = /\b(wrapped|bridged|staked|restaked|liquid staking|pegged|tokenized|tokenised|xstock)\b/i;

/*
 * Tokenised shares and treasuries carry their nature in the aggregator's id or in the name more
 * reliably than in tags (the top-1000 list has no categories). One live run published "NVIDIA •
 * Robinhood Token" as a $18M small cap and matched it to NVDA stock perpetuals.
 */
const TOKENIZED_ID = /(tokenized-stock|xstock|robinhood-token|robinhood-tokenized|ondo-tokenized|backed-|tokenized-equit|stock-token)/i;
const TOKENIZED_NAME = /(\bx ?stocks?\b|robinhood token|\btokeni[sz]ed (stock|share|equity|treasur)|ondo tokeni[sz]ed|\bstock token\b)/i;

/*
 * A stablecoin is recognised by what it *does*, not only by a list of tickers: a token that sits at
 * $1 (or €1) and barely moves for a week and a month is pegged, whatever it is called. The ticker
 * list misses every new dollar token ("JupUSD" reached the published radar that way — its name has
 * no word "USD" for a word-boundary test to find).
 */
function looksPegged(a) {
  const p = a.price;
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return false;
  const d7 = Math.abs(a.change7d ?? Infinity);
  const d30 = a.change30d === null || a.change30d === undefined ? null : Math.abs(a.change30d);
  const quiet = d7 < 1 && (d30 === null || d30 < 2);
  const sym = normSymbol(a.symbol);
  const name = String(a.name ?? '');
  const dollar = sym.includes('USD') || /usd|dollar/i.test(name);
  const euro = /^EUR|EUR$/.test(sym) || /\beuro?\b/i.test(name);
  if (Math.abs(p - 1) < 0.02 && quiet) return true;
  if (dollar && Math.abs(p - 1) < 0.05 && d7 < 2) return true;
  if (euro && p > 0.95 && p < 1.3 && d7 < 1.5 && (d30 === null || d30 < 3)) return true;
  // Other fiat pegs (ZCHF, JPYC, XSGD, GBPT…): a currency code in the ticker and a price that has
  // barely moved for a week and a month, at whatever level that currency trades.
  if (FIAT_CODE.test(sym) && d7 < 1.5 && d30 !== null && d30 < 3) return true;
  return false;
}
// Anchored at either end of the ticker (ZCHF, XSGD, JPYC, GBPT…): "ETHBULL" must not read as THB.
const FIAT_CODE = /^(CHF|GBP|JPY|CNH|CNY|SGD|AUD|CAD|BRL|MXN|TRY|IDR|KRW|HKD|NZD|ZAR|INR|PHP|THB|NGN)|(CHF|GBP|JPY|CNH|CNY|SGD|AUD|CAD|BRL|MXN|TRY|IDR|KRW|HKD|NZD|ZAR|INR|PHP|THB|NGN)$/;

/**
 * @param {{symbol?:string,name?:string,tags?:string[],price?:number|null,change7d?:number|null,
 *          change30d?:number|null,id?:string|null}} a
 * @returns {null | 'STABLECOIN' | 'WRAPPED_OR_STAKED' | 'TOKENIZED_ASSET'}
 */
export function exclusionReason(a) {
  const sym = normSymbol(a.symbol);
  const name = String(a.name ?? '');
  const id = String(a.id ?? '');
  const tags = (a.tags ?? []).map((t) => String(t).toLowerCase());
  if (STABLE_SYMBOLS.has(sym) || tags.some((t) => STABLE_TAGS.includes(t))) return 'STABLECOIN';
  if (/\b(usd|dollar|euro|eur)\b/i.test(name) && typeof a.price === 'number' && Math.abs(a.price - 1) < 0.03 && Math.abs(a.change7d ?? 0) < 2) return 'STABLECOIN';
  if (tags.some((t) => ['tokenized-stock', 'tokenized-stocks', 'xstocks', 'tokenized-treasury-bills', 'tokenized-treasuries', 'rwa-treasury', 'tokenized-gold'].includes(t))) return 'TOKENIZED_ASSET';
  if (TOKENIZED_ID.test(id) || TOKENIZED_NAME.test(name)) return 'TOKENIZED_ASSET';
  if (looksPegged(a)) return 'STABLECOIN';
  if (tags.some((t) => WRAPPED_TAGS.includes(t)) || WRAPPED_PATTERNS.some((re) => re.test(sym)) || WRAPPED_NAME.test(name)) return 'WRAPPED_OR_STAKED';
  return null;
}

/** Chain identifiers normalised across CoinGecko, CMC, DexScreener, GoPlus and GeckoTerminal. */
export const CHAINS = {
  bsc: { label: 'BNB Chain', dexscreener: 'bsc', goplus: '56', geckoterminal: 'bsc', explorer: 'https://bscscan.com/token/' },
  ethereum: { label: 'Ethereum', dexscreener: 'ethereum', goplus: '1', geckoterminal: 'eth', explorer: 'https://etherscan.io/token/' },
  solana: { label: 'Solana', dexscreener: 'solana', goplus: 'solana', geckoterminal: 'solana', explorer: 'https://solscan.io/token/' },
  base: { label: 'Base', dexscreener: 'base', goplus: '8453', geckoterminal: 'base', explorer: 'https://basescan.org/token/' },
  arbitrum: { label: 'Arbitrum', dexscreener: 'arbitrum', goplus: '42161', geckoterminal: 'arbitrum', explorer: 'https://arbiscan.io/token/' },
  polygon: { label: 'Polygon', dexscreener: 'polygon', goplus: '137', geckoterminal: 'polygon_pos', explorer: 'https://polygonscan.com/token/' },
  avalanche: { label: 'Avalanche', dexscreener: 'avalanche', goplus: '43114', geckoterminal: 'avax', explorer: 'https://snowtrace.io/token/' },
  optimism: { label: 'Optimism', dexscreener: 'optimism', goplus: '10', geckoterminal: 'optimism', explorer: 'https://optimistic.etherscan.io/token/' },
  sui: { label: 'Sui', dexscreener: 'sui', goplus: null, geckoterminal: 'sui-network', explorer: 'https://suiscan.xyz/mainnet/coin/' },
  ton: { label: 'TON', dexscreener: 'ton', goplus: null, geckoterminal: 'ton', explorer: 'https://tonviewer.com/' },
  tron: { label: 'Tron', dexscreener: 'tron', goplus: null, geckoterminal: 'tron', explorer: 'https://tronscan.org/#/token20/' },
  sonic: { label: 'Sonic', dexscreener: 'sonic', goplus: '146', geckoterminal: 'sonic', explorer: 'https://sonicscan.org/token/' },
  hyperevm: { label: 'HyperEVM', dexscreener: 'hyperevm', goplus: null, geckoterminal: 'hyperevm', explorer: 'https://hyperevmscan.io/token/' },
};

const CHAIN_ALIASES = {
  'binance-smart-chain': 'bsc', bnb: 'bsc', 'bnb-smart-chain': 'bsc', 'bnb smart chain (bep20)': 'bsc', 'bnb smart chain': 'bsc', 'bnb chain': 'bsc', bnbchain: 'bsc', bep20: 'bsc', bsc: 'bsc', '56': 'bsc',
  ethereum: 'ethereum', eth: 'ethereum', erc20: 'ethereum', '1': 'ethereum',
  solana: 'solana', sol: 'solana', ct_501: 'solana',
  base: 'base', '8453': 'base',
  'arbitrum-one': 'arbitrum', arbitrum: 'arbitrum', arb: 'arbitrum', '42161': 'arbitrum',
  'polygon-pos': 'polygon', polygon: 'polygon', matic: 'polygon', '137': 'polygon',
  avalanche: 'avalanche', 'avalanche-c-chain': 'avalanche', avax: 'avalanche', '43114': 'avalanche',
  'optimistic-ethereum': 'optimism', optimism: 'optimism', op: 'optimism', '10': 'optimism',
  sui: 'sui', 'the-open-network': 'ton', ton: 'ton', toncoin: 'ton', tron: 'tron', trx: 'tron', trc20: 'tron',
  sonic: 'sonic', '146': 'sonic', hyperevm: 'hyperevm', 'hyperliquid-evm': 'hyperevm',
};

export function normChain(value) {
  if (value === null || value === undefined) return null;
  const k = String(value).trim().toLowerCase();
  return CHAIN_ALIASES[k] ?? null;
}

/** Order used to pick the primary research chain of a multi-chain token (BNB first: the LAB/BTW/AGT habitat). */
export const CHAIN_PRIORITY = ['bsc', 'solana', 'base', 'ethereum', 'arbitrum', 'sonic', 'hyperevm', 'polygon', 'avalanche', 'optimism', 'sui', 'ton', 'tron'];

export function normAddress(chain, address) {
  if (!address) return null;
  const a = String(address).trim();
  if (!a) return null;
  return chain === 'solana' || chain === 'sui' || chain === 'ton' || chain === 'tron' ? a : a.toLowerCase();
}
