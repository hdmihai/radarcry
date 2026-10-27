/**
 * PLATFORM REGISTRY — the three-layer model that keeps every platform named in the technical
 * solution inside the project without a single subscription.
 *
 *   Layer A — AUTO:     the platform's free or public API is called in code; results feed the scores.
 *   Layer B — LINK:     the platform's free web interface, linked per asset with the context already
 *                       filled in (chain, contract, symbol). This is how Arkham, CoinGlass, Dune,
 *                       Etherscan and the Korean venues enter the project: as one-click research
 *                       surfaces, exactly the way a researcher uses them, at zero cost.
 *   Layer C — KEY_SLOT: an adapter exists and switches on if the operator adds a free or trial key.
 *                       Nothing breaks when the key is absent or expires; the capability simply
 *                       reports OPTIONAL_KEY and parity drops to its permanent value.
 *
 * Nothing here requires a paid plan. Where a platform's API is paid, the platform is still present
 * through Layer B, and the project says so instead of pretending the API is free.
 */
import { CHAINS } from '../shared/symbols.js';

export const LAYER = { AUTO: 'AUTO', LINK: 'LINK', KEY_SLOT: 'KEY_SLOT' };

export const LAYER_LABEL_RO = {
  AUTO: 'API gratuit, apelat automat',
  LINK: 'interfață web gratuită, link cu context precompletat',
  KEY_SLOT: 'slot de cheie gratuită/trial — opțional, nimic nu se rupe fără ea',
};

const enc = encodeURIComponent;

/**
 * Every platform from the technical solution, with how it is used and how a per-asset link is built.
 * `build(ctx)` receives { symbol, name, chain, address, coingeckoId, cmcSlug, perpSymbol, chainMeta }.
 */
export const PLATFORMS = [
  /* ── aggregators ─────────────────────────────────────────────────────────────────────────── */
  {
    key: 'coingecko', label: 'CoinGecko', layer: LAYER.AUTO, group: 'Agregatori',
    role: 'universul de bază, variații multi-fereastră, categorii, trending',
    plan: 'cheie Demo gratuită — 10 000 apeluri/lună, 100/minut',
    build: ({ coingeckoId, symbol }) => (coingeckoId ? `https://www.coingecko.com/en/coins/${enc(coingeckoId)}` : `https://www.coingecko.com/en/search?query=${enc(symbol)}`),
  },
  {
    key: 'coinmarketcap', label: 'CoinMarketCap', layer: LAYER.AUTO, group: 'Agregatori',
    role: 'al doilea univers independent, supply, date de listare',
    plan: 'cheie Basic gratuită — 10 000 credite/lună, 1 credit per 200 monede (top 1000 = 5 credite)',
    build: ({ cmcSlug, symbol }) => (cmcSlug ? `https://coinmarketcap.com/currencies/${enc(cmcSlug)}/` : `https://coinmarketcap.com/search/?q=${enc(symbol)}`),
  },
  {
    key: 'coinpaprika', label: 'CoinPaprika', layer: LAYER.AUTO, group: 'Agregatori',
    role: 'plasă de siguranță când ambii agregatori principali cad',
    plan: 'API public fără cheie',
    build: ({ symbol }) => `https://coinpaprika.com/search/?query=${enc(symbol)}`,
  },

  /* ── on-chain ────────────────────────────────────────────────────────────────────────────── */
  {
    key: 'arkham', label: 'Arkham Intelligence', layer: LAYER.LINK, group: 'On-chain intelligence',
    role: 'identitatea entităților din spatele portofelelor, fluxuri între entități, explorare manuală',
    plan: 'platforma web este gratuită cu cont; Intel API are un slot de cheie separat (trial)',
    build: ({ address, symbol }) => (address ? `https://intel.arkm.com/explorer/address/${enc(address)}` : `https://intel.arkm.com/explorer/search?q=${enc(symbol)}`),
  },
  {
    key: 'arkham_api', label: 'Arkham Intel API', layer: LAYER.KEY_SLOT, group: 'On-chain intelligence',
    role: 'etichetarea automată a deținătorilor cu tipul entității, în clasificare și în Smart Money Score',
    plan: 'cheie de trial gratuit la cerere; fără ea, etichetele vin din setul eth-labels inclus în repo',
    secret: 'ARKHAM_API_KEY',
    build: () => 'https://info.arkm.com/arkham-intel-api',
  },
  {
    key: 'eth_labels', label: 'eth-labels (set de date)', layer: LAYER.AUTO, group: 'On-chain intelligence',
    role: 'etichetarea deținătorilor EVM: burse, bridge-uri, pool-uri, fonduri, protocoale, adrese semnalate',
    plan: 'set de date MIT, descărcat la build și inclus în repo — nicio dependență la rulare',
    build: () => 'https://github.com/dawsbot/eth-labels',
  },
  {
    key: 'nodereal', label: 'NodeReal', layer: LAYER.KEY_SLOT, group: 'On-chain intelligence',
    role: 'lista de deținători pe lanțuri EVM (nr_getTokenHolders)',
    plan: 'plan Free — 10 mil. unități de calcul/lună, fără abonament',
    secret: 'NODEREAL_API_KEY',
    build: () => 'https://nodereal.io/',
  },
  {
    key: 'solana_rpc', label: 'Solana JSON-RPC', layer: LAYER.AUTO, group: 'On-chain intelligence',
    role: 'cele mai mari conturi de token și supply-ul pe Solana',
    plan: 'noduri publice fără cheie; opțional SOLANA_RPC_URL dintr-un cont gratuit (Helius Free) pentru getTokenLargestAccounts',
    // Only a Solana token has a Solscan page: an EVM contract here would open an empty search.
    build: ({ address, chain }) => (address && chain === 'solana' ? `https://solscan.io/token/${enc(address)}#holders` : null),
  },
  {
    key: 'goplus', label: 'GoPlus Security', layer: LAYER.AUTO, group: 'On-chain intelligence',
    role: 'securitatea contractului: honeypot, mint, taxe, LP blocat, owner ascuns',
    plan: 'plan gratuit — 150 000 unități/lună, 30 000/zi; atribuirea este obligatorie',
    build: ({ address, chainMeta }) => (address && chainMeta?.goplus ? `https://gopluslabs.io/token-security/${chainMeta.goplus}/${enc(address)}` : 'https://gopluslabs.io/token-security'),
  },
  {
    key: 'dexscreener', label: 'DexScreener', layer: LAYER.AUTO, group: 'On-chain intelligence',
    role: 'lichiditate, pool-uri, tranzacții și boost-uri plătite ca semnal de atenție',
    plan: 'API public fără cheie',
    build: ({ address, chainMeta }) => (address && chainMeta?.dexscreener ? `https://dexscreener.com/${chainMeta.dexscreener}/${enc(address)}` : 'https://dexscreener.com/'),
  },
  {
    key: 'geckoterminal', label: 'GeckoTerminal', layer: LAYER.AUTO, group: 'On-chain intelligence',
    role: 'informații de token on-chain, pool-uri în trending, serii OHLCV pe DEX',
    plan: 'API public, 30 apeluri/minut (oficial), fără cheie',
    build: ({ address, chainMeta }) => (address && chainMeta?.geckoterminal ? `https://www.geckoterminal.com/${chainMeta.geckoterminal}/tokens/${enc(address)}` : 'https://www.geckoterminal.com/'),
  },
  {
    key: 'explorer', label: 'Explorer de lanț', layer: LAYER.LINK, group: 'On-chain intelligence',
    role: 'verificarea manuală a contractului, a deținătorilor și a transferurilor',
    plan: 'interfață web gratuită',
    build: ({ address, chainMeta }) => (address && chainMeta?.explorer ? `${chainMeta.explorer}${enc(address)}` : null),
  },
  {
    key: 'dune', label: 'Dune Analytics', layer: LAYER.LINK, group: 'On-chain intelligence',
    role: 'interogări comunitare pe date on-chain, pentru verificarea manuală a unei ipoteze',
    plan: 'planul gratuit permite vizualizarea și crearea de interogări în interfață; API-ul este plătit',
    build: ({ symbol }) => `https://dune.com/search?q=${enc(symbol)}`,
  },

  /* ── derivatives ─────────────────────────────────────────────────────────────────────────── */
  {
    key: 'coinalyze', label: 'Coinalyze', layer: LAYER.KEY_SLOT, group: 'Derivate',
    role: 'funding, open interest și istoricul lor pe Binance, Bybit și OKX',
    plan: 'cont gratuit cu cheie API — 40 apeluri/minut',
    secret: 'COINALYZE_API_KEY',
    build: ({ symbol }) => `https://coinalyze.net/${enc(String(symbol).toLowerCase())}/usd/`,
  },
  {
    key: 'mexc', label: 'MEXC', layer: LAYER.AUTO, group: 'Derivate',
    role: 'tickere spot, lumânări 1D/4H, contracte perpetue cu funding și OI',
    plan: 'endpoint-uri publice, 20 cereri/2 secunde',
    build: ({ symbol }) => `https://www.mexc.com/exchange/${enc(symbol)}_USDT`,
  },
  {
    key: 'gate', label: 'Gate', layer: LAYER.AUTO, group: 'Derivate',
    role: 'contracte perpetue, funding și open interest',
    plan: 'endpoint-uri publice fără cheie',
    build: ({ symbol }) => `https://www.gate.com/futures/USDT/${enc(symbol)}_USDT`,
  },
  {
    key: 'bitget', label: 'Bitget', layer: LAYER.AUTO, group: 'Derivate',
    role: 'contracte perpetue, funding și open interest',
    plan: 'endpoint-uri publice fără cheie',
    build: ({ symbol }) => `https://www.bitget.com/futures/usdt/${enc(symbol)}USDT`,
  },
  {
    key: 'okx', label: 'OKX', layer: LAYER.AUTO, group: 'Derivate',
    role: 'contracte perpetue, funding, open interest și adâncime',
    plan: 'endpoint-uri publice fără cheie',
    build: ({ symbol }) => `https://www.okx.com/trade-swap/${enc(String(symbol).toLowerCase())}-usdt-swap`,
  },
  {
    key: 'binance_spot', label: 'Binance (oglinda publică de date)', layer: LAYER.AUTO, group: 'Derivate',
    role: 'tickere spot și lumânări de referință de pe cea mai lichidă piață',
    plan: 'data-api.binance.vision, endpoint public de date fără cheie',
    build: ({ symbol }) => `https://www.binance.com/en/trade/${enc(symbol)}_USDT`,
  },
  {
    key: 'hyperliquid', label: 'Hyperliquid', layer: LAYER.AUTO, group: 'Derivate',
    role: 'perpetue on-chain: funding, OI și context de lichidări',
    plan: 'API public fără cheie',
    build: ({ symbol }) => `https://app.hyperliquid.xyz/trade/${enc(symbol)}`,
  },
  {
    key: 'coinglass', label: 'CoinGlass', layer: LAYER.LINK, group: 'Derivate',
    role: 'hartă de lichidări și agregări de derivate, pentru verificarea vizuală a modelului propriu',
    plan: 'interfața web este gratuită; API-ul este plătit, deci nu este folosit în cod',
    build: ({ symbol }) => `https://www.coinglass.com/currencies/${enc(symbol)}`,
  },

  /* ── listing venues ──────────────────────────────────────────────────────────────────────── */
  {
    key: 'upbit', label: 'Upbit', layer: LAYER.AUTO, group: 'Listări',
    role: 'detectarea listărilor KRW, istoric catalizator puternic pentru small-cap',
    plan: 'endpoint public de piețe, fără cheie',
    build: ({ symbol }) => `https://upbit.com/exchange?code=CRIX.UPBIT.KRW-${enc(symbol)}`,
  },
  {
    key: 'bithumb', label: 'Bithumb', layer: LAYER.AUTO, group: 'Listări',
    role: 'a doua bursă coreeană urmărită pentru listări noi',
    plan: 'endpoint public fără cheie',
    build: ({ symbol }) => `https://www.bithumb.com/react/trade/order/${enc(symbol)}-KRW`,
  },
  {
    key: 'binance_alpha', label: 'Binance Alpha', layer: LAYER.AUTO, group: 'Listări',
    role: 'locul unde proiectele de tip LAB/BTW/AGT apar înainte de listarea principală',
    plan: 'endpoint-uri publice documentate, fără cheie (listă de tokenuri, lumânări)',
    build: () => 'https://www.binance.com/en/alpha',
  },
  {
    key: 'gate_alpha', label: 'Gate Alpha', layer: LAYER.AUTO, group: 'Listări',
    role: 'al doilea program Alpha cu listă publică: tokenuri on-chain tranzacționabile din contul Gate',
    plan: 'API v4 public, fără cheie (/alpha/currencies, /alpha/tickers)',
    build: () => 'https://www.gate.com/alpha',
  },

  /* ── fundamentals and context ────────────────────────────────────────────────────────────── */
  {
    key: 'defillama', label: 'DefiLlama', layer: LAYER.AUTO, group: 'Fundamente',
    role: 'TVL, taxe și venituri de protocol',
    plan: 'Open API fără cheie (endpoint-ul de deblocări este Pro, deci nu este folosit)',
    build: ({ name }) => `https://defillama.com/protocols?search=${enc(name)}`,
  },
  {
    key: 'cryptoquant', label: 'CryptoQuant', layer: LAYER.KEY_SLOT, group: 'Fundamente',
    role: 'metrici de ciclu; planul gratuit acoperă date de piață cu fereastră zilnică',
    plan: 'cheie Basic gratuită — 10 000 credite/lună, fereastră zilnică, 30 de zile de istoric',
    secret: 'CRYPTOQUANT_API_KEY',
    build: ({ symbol }) => `https://cryptoquant.com/asset/${enc(String(symbol).toLowerCase())}`,
  },
  {
    key: 'alternative_me', label: 'alternative.me Fear & Greed', layer: LAYER.AUTO, group: 'Fundamente',
    role: 'indicele de sentiment al pieței, cu istoric',
    plan: 'API public fără cheie',
    build: () => 'https://alternative.me/crypto/fear-and-greed-index/',
  },
  {
    key: 'github', label: 'GitHub', layer: LAYER.KEY_SLOT, group: 'Fundamente',
    role: 'activitatea de dezvoltare: commit-uri, contribuitori, ritm',
    plan: 'token gratuit — 5 000 cereri/oră (60/oră fără token)',
    secret: 'GITHUB_TOKEN',
    build: ({ name }) => `https://github.com/search?q=${enc(name)}&type=repositories`,
  },
  {
    key: 'youtube', label: 'YouTube Data API', layer: LAYER.KEY_SLOT, group: 'Atenție',
    role: 'mențiuni și atenție video, în locul API-ului X care nu are nivel gratuit de citire',
    plan: 'cheie gratuită — 10 000 unități/zi (o căutare costă 100)',
    secret: 'YOUTUBE_API_KEY',
    build: ({ symbol, name }) => `https://www.youtube.com/results?search_query=${enc(`${name} ${symbol} crypto`)}`,
  },
];

export const PLATFORM_GROUPS = [...new Set(PLATFORMS.map((p) => p.group))];

/**
 * Build the per-asset platform panel: every platform, its layer, and a link that already carries
 * the asset's context. This is the "Level 1" research surface from the attachment.
 */
export function platformLinks(asset, { keys = {} } = {}) {
  const primary = asset.primary ?? asset.platforms?.[0] ?? null;
  const chainMeta = primary ? CHAINS[primary.chain] ?? null : null;
  const ctx = {
    symbol: asset.symbol,
    name: asset.name,
    chain: primary?.chain ?? null,
    address: primary?.address ?? null,
    coingeckoId: asset.ids?.coingecko ?? null,
    cmcSlug: asset.ids?.cmcSlug ?? null,
    chainMeta,
  };
  const out = [];
  for (const p of PLATFORMS) {
    let url = null;
    try {
      url = p.build(ctx);
    } catch {
      url = null;
    }
    if (!url) continue;
    const active = p.layer === LAYER.KEY_SLOT ? keys[p.key] === true || keys[p.secret] === true : true;
    out.push({
      key: p.key,
      label: p.label,
      group: p.group,
      layer: p.layer,
      layerLabel: LAYER_LABEL_RO[p.layer],
      role: p.role,
      plan: p.plan,
      url,
      active,
      secret: p.secret ?? null,
    });
  }
  return out;
}

/** The registry rendered for the methodology page: what each platform does and what it costs (nothing). */
export function platformCatalogue({ keys = {} } = {}) {
  return PLATFORM_GROUPS.map((group) => ({
    group,
    platforms: PLATFORMS.filter((p) => p.group === group).map((p) => ({
      key: p.key,
      label: p.label,
      layer: p.layer,
      layerLabel: LAYER_LABEL_RO[p.layer],
      role: p.role,
      plan: p.plan,
      secret: p.secret ?? null,
      configured: p.layer === LAYER.KEY_SLOT ? keys[p.key] === true || keys[p.secret] === true : true,
      home: (() => { try { return p.build({ symbol: 'BTC', name: 'Bitcoin', chainMeta: null }); } catch { return null; } })(),
    })),
  }));
}


/**
 * The optional free keys, with what each unlocks and where to get it. This table lives in the domain
 * because it describes the platform model, not the environment: the config adapter reads
 * `process.env` for these names, the CLI prints them, and the dashboard renders them — all from one
 * declaration, so the published instructions can never drift from the code that reads them.
 *
 * Every entry is free. There is no paid plan anywhere in this project, and no key is required:
 * without one, the capability reports UNKNOWN (which is not "negative") or stays reachable through
 * the platform's own free web interface.
 */
export const SECRETS = [
  { env: 'COINGECKO_API_KEY', key: 'coingecko', label: 'CoinGecko Demo', plan: 'cheie Demo gratuită — 10 000 apeluri/lună, 100/minut', unlocks: 'limite mai mari pe universul principal și pe istoricul de referință', signup: 'coingecko.com/en/developers/dashboard' },
  { env: 'CMC_API_KEY', key: 'coinmarketcap', label: 'CoinMarketCap Basic', plan: 'cheie Basic gratuită — 10 000 credite/lună, 30 apeluri/minut', unlocks: 'al doilea univers independent (top 1000) și verificarea încrucișată a capitalizării', signup: 'pro.coinmarketcap.com/signup' },
  { env: 'COINALYZE_API_KEY', key: 'coinalyze', label: 'Coinalyze', plan: 'cont gratuit — 40 apeluri/minut', unlocks: 'funding și open interest pe Binance, Bybit și OKX (înlocuiește CoinGlass, care are API plătit)', signup: 'coinalyze.net/api' },
  { env: 'NODEREAL_API_KEY', key: 'nodereal', label: 'NodeReal Free', plan: 'plan Free, gratuit — 10 mil. unități de calcul/lună', unlocks: 'lista de deținători pe lanțurile EVM (BSC, Ethereum, Base, Arbitrum, Polygon…)', signup: 'nodereal.io' },
  // `fallback`: the capability also runs without the secret (here on public nodes), only less reliably —
  // so its absence is never reported as "not configured", and the probe never asks for it as a key.
  { env: 'SOLANA_RPC_URL', key: 'solana_rpc', label: 'Solana RPC (cont gratuit)', plan: 'URL de RPC dintr-un cont gratuit, fără card — recomandat Helius Free: 1 mil. credite/lună, 10 cereri/s, un credit per apel', unlocks: 'lista celor mai mari deținători pe Solana din GitHub Actions — nodurile publice fără cheie limitează sau refuză getTokenLargestAccounts de pe adresele runner-elor', signup: 'dashboard.helius.dev/signup → copiază URL-ul Mainnet RPC (https://mainnet.helius-rpc.com/?api-key=…) în secretul SOLANA_RPC_URL', fallback: 'noduri publice fără cheie: Solana Foundation, PublicNode, dRPC, OnFinality' },
  { env: 'CRYPTOQUANT_API_KEY', key: 'cryptoquant', label: 'CryptoQuant Basic', plan: 'cheie Basic gratuită — 10 000 credite/lună, fereastră zilnică', unlocks: 'context de ciclu pe BTC/ETH (netflow-urile on-chain cer plan plătit, deci nu sunt folosite)', signup: 'cryptoquant.com/pricing' },
  { env: 'YOUTUBE_API_KEY', key: 'youtube', label: 'YouTube Data API v3', plan: 'cheie gratuită — 10 000 unități/zi (o căutare = 100)', unlocks: 'atenția video, în locul API-ului X care nu are nivel gratuit de citire', signup: 'console.cloud.google.com → YouTube Data API v3' },
  { env: 'GITHUB_TOKEN', key: 'github', label: 'GitHub', plan: 'token gratuit — 5 000 cereri/oră (60/oră fără token)', unlocks: 'activitatea de dezvoltare; în GitHub Actions este deja disponibil', signup: 'github.com/settings/tokens (scope: public_repo)' },
  { env: 'ARKHAM_API_KEY', key: 'arkham', label: 'Arkham Intel API', plan: 'trial gratuit la cerere', unlocks: 'tipul și numele entității pentru deținători; fără cheie se folosește setul eth-labels inclus în repo', signup: 'info.arkm.com/arkham-intel-api' },
];
