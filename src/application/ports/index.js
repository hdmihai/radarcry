/**
 * PORTS — the hexagon's boundary. The application layer depends only on these contracts;
 * adapters (HTTP providers, filesystem, fixtures) implement them and are wired in the
 * composition root (src/main.js). Swapping CoinGecko for another aggregator, or the
 * filesystem state for a database, never touches domain or use-case code.
 *
 * Every outbound call returns a ProviderResult and never throws: provider failures are
 * explicit data (status + message), and missing data stays UNKNOWN downstream — never zero,
 * never "bearish". A port that is not configured (no free key present) answers NOT_CONFIGURED,
 * which is a different fact from "measured and bad", and the scoring layer treats it as such.
 *
 * Two implementations satisfy this file: the live HTTP adapters and the fixture providers used by
 * the demo and the tests. The fixtures are what make the whole pipeline runnable with no network
 * and no keys, so any port added here must be added to both.
 */

/**
 * @typedef {'OK'|'NOT_CONFIGURED'|'RATE_LIMITED'|'TIMEOUT'|'HTTP_ERROR'|'NETWORK_ERROR'|'INVALID_PAYLOAD'|'GEO_BLOCKED'|'CIRCUIT_OPEN'|'BUDGET_EXHAUSTED'|'SKIPPED'} ProviderStatus
 */

/**
 * @template T
 * @typedef {Object} ProviderResult
 * @property {boolean} ok
 * @property {ProviderStatus} status
 * @property {T|null} data
 * @property {string} [message]
 * @property {{provider:string, endpoint:string, fetchedAt:string, latencyMs:number, httpStatus:number|null, attempts?:number, sha256?:string, mode?:string, records?:number}} meta
 */

/* ───────────────────────────── market universe and context ───────────────────────────────────── */

/**
 * UniversePort — ranked market listings. Two independent universes are merged (CoinGecko and
 * CoinMarketCap) with CoinPaprika as a keyless fallback, so one aggregator being down or rate
 * limited degrades coverage instead of ending the run.
 * @typedef {Object} UniversePort
 * @property {string} id
 * @property {(topN:number) => Promise<ProviderResult<import('../../domain/asset/universe.js').MarketRow[]>>} listTop
 */

/**
 * MarketContextPort — global metrics, trending and categories (CoinGecko), sentiment (alternative.me).
 * @typedef {Object} MarketContextPort
 * @property {() => Promise<ProviderResult<any>>} [global]
 * @property {() => Promise<ProviderResult<{id:string,symbol:string,name:string}[]>>} [trending]
 * @property {() => Promise<ProviderResult<any[]>>} [categories]
 * @property {() => Promise<ProviderResult<{value:number,label:string,change7d:number|null}>>} [fearGreed]
 */

/**
 * CyclePort — cycle context on BTC/ETH only (CryptoQuant Basic, free account). The free plan
 * exposes market data, not the on-chain flow endpoints, so this port is deliberately narrow.
 * @typedef {Object} CyclePort
 * @property {(metric:string) => Promise<ProviderResult<{t:number,v:number}[]>>} series
 */

/* ───────────────────────────── venues: spot, perpetuals, listings ────────────────────────────── */

/**
 * SpotVenuePort — exchange spot tickers and candles (MEXC, Binance public endpoints).
 * Candles are the only primary price source: aggregator prices are used for ranking, never for
 * structure, because a derived price cannot be trusted to form a 4H swing.
 * @typedef {Object} SpotVenuePort
 * @property {() => Promise<ProviderResult<{symbol:string,base:string,last:number,quoteVolume:number,changePct:number}[]>>} spotTickers
 * @property {(symbol:string, interval:'1d'|'4h', limit:number) => Promise<ProviderResult<{t:number,o:number,h:number,l:number,c:number,v:number,closed:boolean}[]>>} klines
 */

/**
 * DerivativesVenuePort — perpetual contracts with funding and open interest, read per venue
 * (MEXC, Gate, Bitget, OKX, Hyperliquid). Funding is normalised to % per 8h by the domain.
 * @typedef {Object} DerivativesVenuePort
 * @property {string} id
 * @property {() => Promise<ProviderResult<{symbol:string,base:string,multiplier:number,price:number,fundingRate:number|null,oiUsd:number|null,volume24hUsd:number|null}[]>>} perps
 */

/**
 * DerivativesAggregatorPort — cross-venue funding and open-interest history (Coinalyze, free
 * account). This is the free replacement for CoinGlass, whose API is subscription-only.
 * @typedef {Object} DerivativesAggregatorPort
 * @property {() => Promise<ProviderResult<{symbol:string,base:string,venue:string}[]>>} markets
 * @property {(symbols:string[]) => Promise<ProviderResult<Record<string,{funding:number|null,oiUsd:number|null}>>>} current
 * @property {(symbols:string[], interval:string, from:number, to:number) => Promise<ProviderResult<Record<string,{t:number,funding:number|null,oi:number|null}[]>>>} history
 */

/**
 * ListingRegistryPort — venues whose listings are catalysts in themselves (Upbit, Bithumb,
 * Binance Alpha). The registry is diffed against the stored state, so a listing is observed
 * at the run that first sees it and never back-dated.
 * @typedef {Object} ListingRegistryPort
 * @property {string} id
 * @property {() => Promise<ProviderResult<any[]>>} markets
 */

/* ───────────────────────────── on-chain ──────────────────────────────────────────────────────── */

/**
 * OnchainPort — DEX pairs and liquidity (DexScreener), pool/holder detail (GeckoTerminal),
 * contract security (GoPlus). All three are keyless and public.
 *
 * An input the provider cannot answer (a chain it does not cover, an empty address list) comes back
 * as SKIPPED, never NOT_CONFIGURED: use cases switch a provider off for the rest of the run on
 * NOT_CONFIGURED, which must only mean "no key".
 *
 * @typedef {Object} OnchainPort
 * @property {(chain:string, addresses:string[]) => Promise<ProviderResult<Record<string, any>>>} [tokens]
 * @property {() => Promise<ProviderResult<any[]>>} [boosts]
 * @property {(chain:string, address:string) => Promise<ProviderResult<any>>} [tokenInfo]
 * @property {(chain:string, addresses:string[]) => Promise<ProviderResult<Record<string, SecurityPayload>>>} [security]
 */

/**
 * SecurityPayload — one token's entry from OnchainPort.security(), keyed by normalised address.
 * This is the provider's vocabulary; the application translates it into the risk engine's facts in
 * exactly one place, `securityFacts()` in use-cases/discovery.js, and a test pins that seam.
 * Taxes are fractions (0.1 = 10 %); booleans are true / false / null (unknown).
 *
 * @typedef {Object} SecurityPayload
 * @property {number|null} holders              holder count reported by the provider
 * @property {number|null} top10Pct             share of supply in the top 10 holders, percent
 * @property {number|null} top10EffectivePct    same, excluding locked / burned / LP / exchange holders
 * @property {string|null} creatorAddress
 * @property {string|null} ownerAddress
 * @property {number|null} lpLockedPct          share of the main pool's LP that is locked or burned, percent
 * @property {{honeypot:boolean|null, cannotSell:boolean|null, buyTax:number|null, sellTax:number|null,
 *   mintable:boolean|null, ownerRenounced:boolean|null, hiddenOwner:boolean|null,
 *   canTakeBackOwnership:boolean|null, transferPausable:boolean|null, blacklist:boolean|null,
 *   slippageModifiable:boolean|null, proxy:boolean|null, openSource:boolean|null,
 *   trustList:boolean|null}} security
 */

/**
 * HoldersPort — the holder list behind concentration and cohort flows: NodeReal Free on EVM
 * chains (10M compute units a month, metered by the quota gate) and the public Solana RPC.
 * Without a key this port answers NOT_CONFIGURED and concentration stays UNKNOWN.
 * @typedef {Object} HoldersPort
 * @property {(chain:string, address:string, limit:number) => Promise<ProviderResult<{address:string,balance:number,share:number}[]>>} topHolders
 * @property {(chain:string, address:string) => Promise<ProviderResult<{holders:number|null}>>} [holderCount]
 */

/**
 * EntityPort — wallet and entity intelligence (Arkham). Optional free key; when absent, the
 * same classification is done locally from the bundled eth-labels dataset, so the capability
 * degrades in accuracy rather than disappearing.
 * @typedef {Object} EntityPort
 * @property {(chain:string, address:string) => Promise<ProviderResult<{entity:string|null,type:string|null,label:string|null}>>} [entity]
 * @property {(chain:string, addresses:string[]) => Promise<ProviderResult<Record<string, any>>>} [addresses]
 * @property {(chain:string, address:string) => Promise<ProviderResult<any>>} [tokenFlows]
 */

/**
 * LabelsPort — the offline address-label dataset (eth-labels, MIT), loaded once per run and
 * read as a pure lookup by the domain. It is what keeps exchange, bridge and contract addresses
 * out of the "whale" count when no entity key is configured.
 * @typedef {Object} LabelsPort
 * @property {(chain:string, address:string) => {label:string|null, class:string|null}} lookup
 * @property {number} size
 */

/**
 * FundamentalsPort — protocol TVL and fees (DefiLlama, keyless).
 * @typedef {Object} FundamentalsPort
 * @property {() => Promise<ProviderResult<any[]>>} protocols
 * @property {() => Promise<ProviderResult<any[]>>} fees
 */

/* ───────────────────────────── development and attention ─────────────────────────────────────── */

/**
 * DevelopmentPort — repository commit cadence (GitHub; the token Actions already provides is
 * enough). `repo` resolves an asset's declared links to an owner/name pair, `parse` is the pure
 * URL parser shared with the domain, and `commitActivity` returns the weekly series the change
 * engine compares against this asset's own norm.
 * @typedef {Object} DevelopmentPort
 * @property {string} id
 * @property {(asset:any) => {owner:string, repo:string}|null} repo
 * @property {(url:string) => {owner:string, repo:string}|null} parse
 * @property {(owner:string, name:string) => Promise<ProviderResult<{commits30d:number|null,commits7d:number|null,weeks:number[],trend:number|null}>>} commitActivity
 */

/**
 * AttentionPort — public attention without a paid social API: YouTube Data API search counts,
 * plus CoinGecko trending and watchlist figures carried on the market rows. X has no free read
 * tier and is therefore a free web link in the platform registry, never a call.
 * @typedef {Object} AttentionPort
 * @property {(query:string, sinceIso:string) => Promise<ProviderResult<{results:number,items:any[]}>>} search
 */

/* ───────────────────────────── infrastructure seams ──────────────────────────────────────────── */

/**
 * HttpPort — the single outbound HTTP seam. Every provider adapter is built on it, which is what
 * makes the quota gate, the circuit breaker, the deadline and the telemetry universal rather than
 * per-adapter. `get` and `postJson` are the only two verbs: nothing in this project writes to a
 * third-party service, and no adapter may implement an order or withdrawal endpoint.
 * @typedef {Object} HttpPort
 * @property {(url:string, o?:{provider?:string, endpoint?:string, headers?:Record<string,string>, units?:number, timeoutMs?:number, parse?:(r:Response)=>any}) => Promise<ProviderResult<any>>} get
 * @property {(url:string, body:any, o?:{provider?:string, endpoint?:string, headers?:Record<string,string>, units?:number, timeoutMs?:number}) => Promise<ProviderResult<any>>} postJson
 */

/**
 * QuotaGatePort — the free-plan budget, consulted before every metered call and updated after it.
 * `units` is counted in each plan's own unit (credits, compute units, requests), because a shared
 * abstract unit would make one provider's allowance unreadable in terms of another's.
 * @typedef {Object} QuotaGatePort
 * @property {(provider:string, units:number) => {allow:boolean, reason?:string}} check
 * @property {(provider:string, units:number) => void} record
 * @property {() => string[]} paused
 * @property {() => Record<string, number>} runUnits
 * @property {() => Record<string, any>} ledger
 */

/**
 * StateRepositoryPort — point-in-time research memory between runs. This is what makes
 * "something changed" a measurable statement rather than a guess: the baseline a change is
 * measured against was written by an earlier run and never recomputed from today's data.
 * @typedef {Object} StateRepositoryPort
 * @property {() => Promise<ResearchState>} load
 * @property {(state: ResearchState) => Promise<void>} save
 */

/**
 * The persisted research state. Every member is bounded: history is compacted to one point a day
 * after 72 hours, flows to one snapshot an hour, and assets unseen for long enough are dropped, so
 * the single-commit state branch stays cheap to fetch at the start of every run.
 *
 * @typedef {Object} ResearchState
 * @property {number} version                                                    STATE_VERSION of the writer
 * @property {Record<string, {points:any[], lastSeen:string}>} history           legacy scoring history
 * @property {Record<string, {points:any[], lastSeen:string}>} discovery         per-asset norm for the change engine
 * @property {Record<string, any[]>} flows                                       classified holder snapshots per asset
 * @property {any} registry                                                      known venue listings, for diffing
 * @property {{entries:any[]}} journal                                           open and scored research entries
 * @property {any} cohort                                                        cohort membership and horizons
 * @property {{items:any[], fetchedAt:string|null, configHash:string|null}} references
 * @property {any[]} catalysts
 * @property {any[]} telemetry
 * @property {Record<string, any>} ledger                                        quota buckets per provider
 * @property {Record<string, {stage:string,cri:number|null,signal:string}>} lastSeen
 * @property {Record<string, any>} lastSeenV4                                    last discovery verdict per asset
 */

/**
 * SnapshotPublisherPort — writes the public contract (data/latest.json) consumed by the dashboard,
 * validating it against schema/latest.schema.json on the way out. A snapshot that does not satisfy
 * the schema is not published, so the dashboard can never be handed a shape it cannot render.
 * @typedef {Object} SnapshotPublisherPort
 * @property {(snapshot:any) => Promise<{path:string, bytes:number}>} publish
 */

/**
 * SnapshotReaderPort — reads the last published snapshot back. Used only by the 15-minute pulse,
 * which refreshes a few fast-moving fields over it instead of running a full scan.
 * @typedef {() => Promise<any|null>} SnapshotReaderPort
 */

/**
 * ClockPort / LoggerPort / TelemetryPort — the seams that keep the core deterministic. Time enters
 * the system here and travels inward as an explicit nowMs argument: no domain module may call
 * Date.now(), and test/architecture.test.js fails the build if one does.
 * @typedef {{ now: () => number }} ClockPort
 * @typedef {{ info:(m:string)=>void, warn:(m:string)=>void, debug:(m:string)=>void, error:(m:string)=>void }} LoggerPort
 * @typedef {{ record:(event:any)=>void, events:()=>any[], summary:()=>any }} TelemetryPort
 */

/**
 * ProvidersPort — the full map handed to the use cases, exactly as the composition root builds it.
 * Each key is optional in the sense that it may answer NOT_CONFIGURED; none may be missing, because
 * the fixture implementation must offer the same surface as the live one.
 *
 * @typedef {Object} ProvidersPort
 * @property {UniversePort & MarketContextPort & HistoryPort} coingecko
 * @property {UniversePort & MarketContextPort} coinmarketcap
 * @property {UniversePort} coinpaprika
 * @property {SpotVenuePort & DerivativesVenuePort} mexc
 * @property {SpotVenuePort} binanceSpot
 * @property {DerivativesVenuePort} gate
 * @property {DerivativesVenuePort} bitget
 * @property {DerivativesVenuePort} okx
 * @property {DerivativesVenuePort} hyperliquid
 * @property {DerivativesAggregatorPort} coinalyze
 * @property {ListingRegistryPort} upbit
 * @property {ListingRegistryPort} bithumb
 * @property {ListingRegistryPort} binanceAlpha
 * @property {OnchainPort} dexscreener
 * @property {OnchainPort} geckoterminal
 * @property {OnchainPort} goplus
 * @property {HoldersPort} nodereal
 * @property {HoldersPort} solanaRpc
 * @property {FundamentalsPort} defillama
 * @property {MarketContextPort} sentiment
 * @property {CyclePort} cryptoquant
 * @property {DevelopmentPort} github
 * @property {AttentionPort} youtube
 * @property {EntityPort} arkham
 */

/**
 * HistoryPort — coin search + daily history for the LAB/BTW/AGT reference windows (CoinGecko).
 * @typedef {Object} HistoryPort
 * @property {(query:string) => Promise<ProviderResult<{id:string,symbol:string,name:string,rank:number|null}[]>>} search
 * @property {(id:string, days:number) => Promise<ProviderResult<{prices:number[][],market_caps:number[][],total_volumes:number[][]}>>} marketChart
 * @property {(id:string) => Promise<ProviderResult<any>>} detail
 * @property {() => Promise<ProviderResult<Map<string, {chain:string,address:string}[]>>>} platforms
 */

export {};
