/**
 * PARITY BENCHMARK — how much of a commercial research desk this project reproduces, and at what
 * cost (zero).
 *
 * The requirement was explicit: efficiency comparable to commercial solutions, at a minimum of 90 %
 * of their performance. That claim is only meaningful if it is computed, so this module holds the
 * capability matrix: every capability a paid desk (Nansen / Arkham Pro / CoinGlass / Messari /
 * Kaito / Token Metrics class) offers, its weight in a *research* workflow, and the honest status of
 * our coverage. The operational side — how often the data is actually refreshed, how reliably — is
 * measured by the AI agent (agent/domain/efficiency.js) on top of these figures.
 *
 * Status values:
 *   FREE_API      — reproduced in code, from a public or free-account API
 *   FREE_DERIVED  — reproduced in code, modelled from free inputs instead of bought (marked as a model)
 *   FREE_LINK     — the free web interface of that platform, linked per asset with the context pre-filled
 *   OPTIONAL_KEY  — reproduced when the operator supplies a free/trial key (Level 2 of the platform model)
 *   NOT_COVERED   — not reproducible without a subscription; stated plainly rather than hidden
 *
 * Two parity figures are always reported, never one:
 *   · `permanent`  — what works forever, with no key that can expire
 *   · `withKeys`   — what works while the optional free/trial keys are configured
 */
import { round } from '../shared/math.js';

export const STATUS = {
  FREE_API: 'FREE_API',
  FREE_DERIVED: 'FREE_DERIVED',
  FREE_LINK: 'FREE_LINK',
  OPTIONAL_KEY: 'OPTIONAL_KEY',
  NOT_COVERED: 'NOT_COVERED',
};

/** Credit given per status. A link the researcher must click is real coverage, but not automatic. */
export const STATUS_CREDIT = {
  FREE_API: 1,
  FREE_DERIVED: 0.85,
  FREE_LINK: 0.5,
  OPTIONAL_KEY: 0,
  NOT_COVERED: 0,
};

export const STATUS_CREDIT_WITH_KEYS = {
  ...STATUS_CREDIT,
  OPTIONAL_KEY: 0.9,
};

export const STATUS_LABEL_RO = {
  FREE_API: 'API gratuit, automat',
  FREE_DERIVED: 'reconstruit din surse gratuite (model, marcat ca estimare)',
  FREE_LINK: 'interfața gratuită a platformei, link cu context precompletat',
  OPTIONAL_KEY: 'disponibil cu o cheie gratuită opțională',
  NOT_COVERED: 'nu se poate reproduce fără abonament',
};

/**
 * The matrix. `weight` is the capability's importance to the question this project answers, not to a
 * trading terminal in general.
 */
export const CAPABILITIES = [
  { key: 'universe', label: 'Universul complet (top 1000 CMC + CoinGecko)', weight: 6, status: STATUS.FREE_API, how: 'CoinGecko Demo + CoinMarketCap Basic, chei gratuite', sources: ['coingecko', 'coinmarketcap'] },
  { key: 'market_data', label: 'Preț, capitalizare, volum, variații multi-fereastră', weight: 5, status: STATUS.FREE_API, how: 'agregatori + verificare încrucișată între surse', sources: ['coingecko', 'coinmarketcap', 'coinpaprika'] },
  { key: 'ohlcv', label: 'Lumânări 1D și 4H pentru structură', weight: 5, status: STATUS.FREE_API, how: 'MEXC / Binance (oglinda data-api) / Binance Alpha (klines publice) / GeckoTerminal, endpoint-uri publice', sources: ['mexc', 'binance_spot', 'binance_alpha', 'geckoterminal'] },
  { key: 'dex_liquidity', label: 'Lichiditate și pool-uri DEX', weight: 5, status: STATUS.FREE_API, how: 'DexScreener fără cheie + GeckoTerminal', sources: ['dexscreener', 'geckoterminal'] },
  { key: 'holders', label: 'Lista de deținători și concentrare', weight: 6, status: STATUS.FREE_API, how: 'NodeReal Free (EVM) + RPC Solana (noduri publice sau cont gratuit Helius) + GeckoTerminal', sources: ['nodereal', 'solana_rpc', 'geckoterminal'] },
  { key: 'holder_labels', label: 'Etichetarea deținătorilor (CEX, LP, bridge, fond, trezorerie)', weight: 6, status: STATUS.FREE_API, how: 'set de date eth-labels (MIT, ~59k adrese) inclus în repo + detecție structurală', sources: ['eth-labels', 'goplus'] },
  { key: 'holder_flows', label: 'Acumulare / distribuție pe portofele mari', weight: 7, status: STATUS.FREE_DERIVED, how: 'comparația a două instantanee clasificate ale aceleiași liste, între rulări', sources: ['nodereal', 'solana_rpc'] },
  { key: 'entity_intel', label: 'Intelligence de entitate (cine este portofelul)', weight: 5, status: STATUS.OPTIONAL_KEY, how: 'Arkham Intel API cu cheie de trial gratuit; fără cheie, etichetele vin din eth-labels', sources: ['arkham'], link: 'arkham' },
  { key: 'entity_browse', label: 'Explorarea manuală a entităților și fluxurilor', weight: 3, status: STATUS.FREE_LINK, how: 'Arkham Intelligence web, gratuit, link direct pe adresa token-ului', sources: ['arkham'], link: 'arkham' },
  { key: 'cex_flows', label: 'Fluxuri nete către / de la burse centralizate', weight: 6, status: STATUS.FREE_DERIVED, how: 'variația cotei deținute de adrese etichetate CEX între instantanee', sources: ['eth-labels', 'nodereal'] },
  { key: 'contract_security', label: 'Securitatea contractului (honeypot, mint, taxe, LP blocat)', weight: 5, status: STATUS.FREE_API, how: 'GoPlus Security API, plan gratuit cu atribuire', sources: ['goplus'] },
  { key: 'funding', label: 'Funding pe burse multiple', weight: 6, status: STATUS.FREE_API, how: 'Coinalyze (cont gratuit) pentru Binance/Bybit/OKX + endpoint-uri publice MEXC/Gate/Bitget/OKX', sources: ['coinalyze', 'mexc', 'gate', 'bitget', 'okx'] },
  { key: 'open_interest', label: 'Open interest agregat și istoric', weight: 5, status: STATUS.FREE_API, how: 'Coinalyze + agregare proprie pe burse publice', sources: ['coinalyze'] },
  { key: 'liquidation_map', label: 'Hartă de lichidări', weight: 4, status: STATUS.FREE_DERIVED, how: 'model din OI + funding + interval de preț, marcat explicit ca estimare', sources: ['coinalyze'] },
  { key: 'liquidation_feed', label: 'Flux de lichidări în timp real, pe ordine', weight: 2, status: STATUS.NOT_COVERED, how: 'necesită abonament (CoinGlass și echivalente)', sources: [], link: 'coinglass' },
  { key: 'orderbook_depth', label: 'Adâncimea registrului de ordine pe niveluri', weight: 2, status: STATUS.FREE_API, how: 'endpoint-uri publice de depth pe bursele spot', sources: ['mexc', 'binance_spot'] },
  { key: 'fundamentals', label: 'TVL, venituri, taxe de protocol', weight: 4, status: STATUS.FREE_API, how: 'DefiLlama Open API (fără cheie)', sources: ['defillama'] },
  { key: 'unlocks', label: 'Calendar de deblocări', weight: 4, status: STATUS.FREE_DERIVED, how: 'presiune derivată din float, FDV și emisiunea observată; datele exacte se introduc manual în config', sources: [], link: 'defillama' },
  { key: 'dev_activity', label: 'Activitate de dezvoltare', weight: 3, status: STATUS.FREE_API, how: 'GitHub REST cu token gratuit', sources: ['github'] },
  { key: 'social_attention', label: 'Atenție socială', weight: 4, status: STATUS.FREE_API, how: 'YouTube Data API (cheie gratuită) + trending CoinGecko + boost-uri DexScreener', sources: ['youtube', 'coingecko', 'dexscreener'] },
  { key: 'social_x', label: 'Analiza fluxului X / Twitter', weight: 2, status: STATUS.NOT_COVERED, how: 'API-ul X nu are nivel gratuit de citire', sources: [] },
  { key: 'narrative', label: 'Rotația narațiunilor / sectoarelor', weight: 4, status: STATUS.FREE_API, how: 'categorii CoinGecko + etichetele proiectelor, agregate local', sources: ['coingecko'] },
  { key: 'market_regime', label: 'Regim de piață, Fear & Greed, altseason', weight: 3, status: STATUS.FREE_API, how: 'alternative.me (fără cheie) + indice altseason calculat local din top 100', sources: ['alternative_me', 'coingecko'] },
  { key: 'cycle_metrics', label: 'Metrici de ciclu on-chain (MVRV, SOPR, netflow agregat)', weight: 3, status: STATUS.OPTIONAL_KEY, how: 'CryptoQuant Basic (cheie gratuită) acoperă date de piață; netflow-urile on-chain cer plan Professional', sources: ['cryptoquant'], link: 'cryptoquant' },
  { key: 'listings', label: 'Detectarea listărilor noi (perp, KRW, spot, Alpha)', weight: 5, status: STATUS.FREE_API, how: 'endpoint-uri publice Upbit / Bithumb / Binance Alpha / Gate Alpha / burse de perpetue, comparate între rulări', sources: ['upbit', 'bithumb', 'binance_alpha', 'gate_alpha'] },
  { key: 'alerts', label: 'Alerte pe condiții', weight: 3, status: STATUS.FREE_API, how: 'reguli evaluate la fiecare rulare, publicate în snapshot și în dashboard', sources: [] },
  { key: 'backtest', label: 'Track record verificabil al semnalelor', weight: 5, status: STATUS.FREE_API, how: 'jurnal point-in-time cu scadențe la 7/14/30 zile și intervale Wilson 95%', sources: [] },
  { key: 'explainability', label: 'Scor explicabil, factor cu factor, cu sursă', weight: 5, status: STATUS.FREE_API, how: 'fiecare factor își raportează ponderea, calitatea datelor și dovada', sources: [] },
  { key: 'pit_history', label: 'Istoric point-in-time propriu (normă per proiect)', weight: 5, status: STATUS.FREE_API, how: 'ramura de stare a repo-ului, un punct per rulare per proiect', sources: [] },
  { key: 'validity_gate', label: 'Verificarea proiectului înainte de listă (scam, proiect real, listare pe burse)', weight: 5, status: STATUS.FREE_API, how: 'poarta de validitate: GoPlus (EVM și Solana), agregatori, burse spot și perpetue, Binance Alpha, DexScreener — cinci verificări obligatorii', sources: ['goplus', 'coingecko', 'dexscreener'] },
  { key: 'predictive', label: 'Prognoză probabilistică (≥100× / ≥20× în 12 luni), învățată din câștigătorii anului', weight: 4, status: STATUS.FREE_DERIVED, how: 'rată de bază + raport de verosimilitate pe amprenta de la minim; istoric zilnic CoinGecko (gratuit), marcat ca estimare', sources: ['coingecko'] },
  { key: 'quality_monitoring', label: 'Monitorizarea calității datelor și a rulărilor (agent AI)', weight: 3, status: STATUS.FREE_API, how: 'agent separat pe GitHub Actions: API GitHub cu tokenul automat + model deschis rulat local (Ollama), fără cont', sources: [] },
];

const TOTAL_WEIGHT = CAPABILITIES.reduce((s, c) => s + c.weight, 0);

/**
 * @param {{keys?:Record<string, boolean>, liveStatus?:Record<string, boolean>}} [o]
 *   `keys` says which optional keys are configured; `liveStatus` lets a failing provider in *this*
 *   run downgrade its capability, so the dashboard reports the parity it actually delivered.
 */
export function parity({ keys = {}, liveStatus = null } = {}) {
  const rows = CAPABILITIES.map((c) => {
    let status = c.status;
    let live = true;
    if (status === STATUS.OPTIONAL_KEY) {
      const needed = c.sources ?? [];
      const have = needed.some((s) => keys[s] === true);
      if (have) status = STATUS.FREE_API;
    }
    if (liveStatus && (c.sources ?? []).length) {
      const any = (c.sources ?? []).some((s) => liveStatus[s] === true);
      const known = (c.sources ?? []).some((s) => s in liveStatus);
      if (known && !any) live = false;
    }
    return {
      ...c,
      resolvedStatus: status,
      statusLabel: STATUS_LABEL_RO[status],
      live,
      creditPermanent: STATUS_CREDIT[c.status] ?? 0,
      creditWithKeys: STATUS_CREDIT_WITH_KEYS[c.status] ?? 0,
      creditNow: (STATUS_CREDIT_WITH_KEYS[status] ?? STATUS_CREDIT[status] ?? 0) * (live ? 1 : 0.4),
    };
  });

  const sum = (field) => rows.reduce((s, r) => s + r.weight * r[field], 0);
  const permanent = round((sum('creditPermanent') / TOTAL_WEIGHT) * 100, 1);
  const withKeys = round((sum('creditWithKeys') / TOTAL_WEIGHT) * 100, 1);
  const achieved = round((sum('creditNow') / TOTAL_WEIGHT) * 100, 1);

  const gaps = rows
    .filter((r) => r.resolvedStatus === STATUS.NOT_COVERED || r.resolvedStatus === STATUS.OPTIONAL_KEY || r.resolvedStatus === STATUS.FREE_LINK)
    .map((r) => ({ key: r.key, label: r.label, weight: r.weight, status: r.resolvedStatus, statusLabel: r.statusLabel, how: r.how }))
    .sort((a, b) => b.weight - a.weight);

  return {
    permanent,
    withKeys,
    achieved,
    totalWeight: TOTAL_WEIGHT,
    capabilities: rows.map(({ match, ...r }) => r),
    gaps,
    byStatus: Object.fromEntries(Object.values(STATUS).map((s) => [s, rows.filter((r) => r.resolvedStatus === s).length])),
    note: `Paritatea este calculată dintr-o matrice de ${CAPABILITIES.length} capabilități ponderate, nu estimată. „Permanent” = doar ce funcționează fără nicio cheie care poate expira; „cu chei opționale” = inclusiv cheile gratuite/de trial configurate de operator. Capabilitățile neacoperite sunt listate explicit, nu ascunse.`,
  };
}
