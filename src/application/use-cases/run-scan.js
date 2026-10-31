/**
 * USE-CASE: RunResearchScan — the CRI pipeline end to end.
 *
 *  providers ─┬─ universe (CoinGecko + CoinMarketCap top N, CoinPaprika as a safety net)
 *             ├─ venues (MEXC spot/futures, Binance public mirror, Gate, Bitget, OKX, Hyperliquid,
 *             │          Upbit, Bithumb, Binance Alpha)
 *             ├─ context (global, trending, categories, Fear & Greed, DefiLlama, DEX attention)
 *             └─ references (LAB/BTW/AGT pre-pump windows, refreshed weekly)
 *  → merge + screen (small/mid-cap filter: 1M–300M market cap, ≥ 500k$/day volume)
 *  → catalysts (listing-registry diff + change detection + manual notebook)
 *  → light research on every eligible asset (legacy CRI + LAB/BTW/AGT similarity)
 *  → shortlist → deep research (candles, DEX, security, HOLDER LISTS, entities, dev, attention)
 *  → DISCOVERY: baseline → what changed → pre-expansion → risk → stage → thesis
 *  → VALIDITY: only verified projects (capitalisation, identity, listings, contract, liquidity)
 *              reach the CRI lists; the rest are published with the reason they were held back
 *  → FORECAST: the last year's big winners (confirmed from daily history) as the learning list;
 *              every project's probability of a ≥100× (and ≥20×) run within twelve months
 *  → FUTURES RADAR: 1D trend + 4H structure + positioning + liquidity + volume → grade
 *  → alerts, track record, parity benchmark, quota report
 *  → snapshot (the only contract with the dashboard) → publish → persist state
 *
 * Depends only on ports (see ../ports/index.js); all I/O is injected.
 */
import { isNum, round, sig } from '../../domain/shared/math.js';
import { toMs } from '../../domain/shared/time.js';
import { mergeUniverse, screenUniverse } from '../../domain/asset/universe.js';
import { attachVenues } from '../../domain/asset/venues.js';
import { buildRegistry, detectChangeEvents, diffRegistry, manualEvents } from '../../domain/catalysts/catalysts.js';
import { listingFeatures } from '../../domain/features/listing.js';
import { marketRegime, narrativeBoard, universeBreadth } from '../../domain/market/regime.js';
import { altseasonIndex } from '../../domain/market/altseason.js';
import { narrativeLandscape } from '../../domain/narrative/narrative.js';
import { watchlistChanges } from '../../domain/lifecycle/watchlist.js';
import { updateJournal } from '../../domain/signals/journal.js';
import { coverageReport } from '../../domain/quality/data-quality.js';
import { rankCandidates } from '../../domain/discovery/classify.js';
import { prescreenPicks } from '../../domain/discovery/prescreen.js';
import { buildAlerts, lastSeenRecord } from '../../domain/alerts/alerts.js';
import { familyPerformance, openEntry, qualifiesForCohort, scoreEntries, trackRecord } from '../../domain/backtest/journal.js';
import { parity } from '../../domain/benchmark/parity.js';
import { platformLinks } from '../../domain/platforms/registry.js';
import { quotaPlan } from '../../domain/budget/quota.js';
import { ensureReferences, referencesView } from './references.js';
import { researchAsset, toCandidateView } from './research.js';
import { collectDeepData } from './deep-research.js';
import { discoverAsset, labelIndexFrom, prescreenAsset } from './discovery.js';
import { futuresView, pickWatchlist, runFuturesRadar } from './futures-radar.js';
import { appendCatalysts, appendDiscoveryHistory, appendFlows, appendHistory, appendTelemetry, discoveryPoint, historyPoint, providerSuccessRates } from './state-update.js';
import { buildProviderHealth, chartPayload, methodology, overallHealth, quotaView, SCHEMA_VERSION } from './snapshot.js';
import { discoveryView } from './discovery-view.js';
import { universeTable } from './universe-view.js';
import { cacheCoverage, pruneCache } from './deep-cache.js';
import { preRejected, validateAsset, validityPolicy, validityReport, validityView, VALIDITY } from './validity.js';
import { forecastPolicy, forecastReport, forecastView, pastRunsByKey, refreshWinners, runForecast, trackedPopulation } from './forecast.js';

export class UniverseUnavailableError extends Error {}

const DEFAULT_PROVIDER = { ok: false, status: 'SKIPPED', data: null, message: 'neconfigurat', meta: { provider: 'n/a', endpoint: '', fetchedAt: null, latencyMs: 0, httpStatus: null } };
const safe = async (fn) => {
  try { return (await fn()) ?? DEFAULT_PROVIDER; } catch (err) { return { ...DEFAULT_PROVIDER, status: 'NETWORK_ERROR', message: String(err?.message ?? err) }; }
};

/**
 * @param {{clock:any, logger:any, telemetry:any, providers:any, stateRepo:any, publisher:any,
 *          referencesConfig:any[], manualCatalysts:any[], labels:any, keys:any, keyed:any,
 *          quotaGate:any, mode:'live'|'fixture'}} deps
 * @param {any} config
 */
export async function runScan(deps, config) {
  const { clock, logger, telemetry, providers: P, stateRepo, publisher } = deps;
  const startedMs = clock.now();
  const nowMs = startedMs;
  const t0 = globalThis.performance?.now?.() ?? Date.now(); // wall-clock duration (domain time may be fixed in replays)
  const deadline = startedMs + config.runtime.maxMinutes * 60_000;
  const timeLeft = () => deadline - clock.now();
  const runId = new Date(nowMs).toISOString().replace(/[-:.]/g, '').slice(0, 15);
  logger.info(`CRI scan ${runId} — mod ${deps.mode}, top ${config.universe.topN}, deep ${config.deep.limit}`);

  const state = await stateRepo.load();
  const topN = config.universe.topN;
  const labelIndex = labelIndexFrom(deps.labels);
  if (labelIndex.size) logger.info(`etichete on-chain: ${labelIndex.size.toLocaleString('ro-RO')} adrese (${labelIndex.license ?? 'MIT'}, ${labelIndex.source ?? 'eth-labels'})`);
  else logger.warn('setul de etichete EVM lipsește — clasificarea deținătorilor va folosi doar detecția structurală (rulează "npm run labels")');

  // 1) Universe + venues + context + references, concurrently (each provider paced by its adapter).
  const [universe, venues, context, refs] = await Promise.all([
    (async () => {
      const [cg, cmc, cp, alpha, gateAlpha, platforms] = await Promise.all([
        safe(() => P.coingecko.listTop(topN)),
        safe(() => P.coinmarketcap.listTop(topN)),
        safe(() => P.coinpaprika.listTop(topN)),
        // The exchange Alpha lists join the universe in full — see mergeUniverse for why. Same reads
        // that also tag venues below (the adapters memoise them).
        safe(() => P.binanceAlpha.listTop()),
        safe(() => P.gateAlpha.listTop()),
        safe(() => P.coingecko.platforms()),
      ]);
      return { cg, cmc, cp, alpha, gateAlpha, platforms };
    })(),
    (async () => {
      const [mexcSpot, binanceSpot, gateSpot, okxSpot, bitgetSpot, mexcPerps, gate, bitget, okx, hyperliquid, upbit, bithumb, alpha, gateAlpha] = await Promise.all([
        safe(() => P.mexc.spotTickers()),
        safe(() => P.binanceSpot.spotTickers()),
        // More centralised spot markets, one call each: the validity gate's listing check.
        safe(() => P.gate.spotTickers()),
        safe(() => P.okx.spotTickers()),
        safe(() => P.bitget.spotTickers()),
        safe(() => P.mexc.perps()),
        safe(() => P.gate.perps()),
        safe(() => P.bitget.perps()),
        safe(() => P.okx.perps()),
        safe(() => P.hyperliquid.perps()),
        safe(() => P.upbit.markets()),
        safe(() => P.bithumb.markets()),
        safe(() => P.binanceAlpha.markets()),
        safe(() => P.gateAlpha.markets()),
      ]);
      return { mexcSpot, binanceSpot, gateSpot, okxSpot, bitgetSpot, mexcPerps, gate, bitget, okx, hyperliquid, upbit, bithumb, alpha, gateAlpha };
    })(),
    (async () => {
      const [global, trending, categories, fearGreed, boosts, gtTrending, llamaProtocols, llamaFees] = await Promise.all([
        safe(() => P.coingecko.global()),
        safe(() => P.coingecko.trending()),
        safe(() => P.coingecko.categories()),
        safe(() => P.sentiment.fearGreed(90)),
        safe(() => P.dexscreener.boosts()),
        safe(() => P.geckoterminal.trendingPools()),
        safe(() => P.defillama.protocols()),
        safe(() => P.defillama.fees()),
      ]);
      return { global, trending, categories, fearGreed, boosts, gtTrending, llamaProtocols, llamaFees };
    })(),
    ensureReferences(state.references, deps.referencesConfig, P.coingecko, nowMs, config.similarity, logger).catch((err) => {
      logger.warn(`referințe: ${err.message}`);
      return { items: state.references?.items ?? [], fetchedAt: state.references?.fetchedAt ?? null, configHash: null, reused: true };
    }),
  ]);

  // 2) Merge + screen.
  const merged = mergeUniverse({
    coingecko: universe.cg.ok ? universe.cg.data : null,
    coinmarketcap: universe.cmc.ok ? universe.cmc.data : null,
    coinpaprika: universe.cp.ok ? universe.cp.data : null,
    binanceAlpha: universe.alpha.ok ? universe.alpha.data : null,
    gateAlpha: universe.gateAlpha.ok ? universe.gateAlpha.data : null,
    cgPlatforms: universe.platforms.ok ? universe.platforms.data : null,
    nowMs,
  });
  if (!merged.length) throw new UniverseUnavailableError('Nicio sursă de univers (CoinGecko / CoinMarketCap / CoinPaprika) nu a răspuns — snapshot-ul anterior rămâne publicat.');
  const { eligible, excluded } = screenUniverse(merged, config.universe);
  // Assets the universe holds only because an exchange Alpha list carries them (no aggregator row).
  const ALPHA_SOURCES = new Set(['binance_alpha', 'gate_alpha']);
  const isAlphaOnly = (a) => a.sources.length > 0 && a.sources.every((src) => ALPHA_SOURCES.has(src));
  const alphaOnly = merged.filter(isAlphaOnly);
  const onlyFrom = (src) => (a) => a.sources.length === 1 && a.sources[0] === src;
  logger.info(`univers: CG ${universe.cg.data?.length ?? 0} · CMC ${universe.cmc.data?.length ?? 0} · Binance Alpha ${universe.alpha.data?.length ?? 0} · Gate Alpha ${universe.gateAlpha.data?.length ?? 0} (${alphaOnly.length} tokenuri Alpha în afara top 1000) · fuzionat ${merged.length} · eligibil ${eligible.length}`);

  // 3) Venues, attention, fundamentals.
  const perpResults = [
    ['mexc', venues.mexcPerps], ['gate', venues.gate], ['bitget', venues.bitget],
    ['okx', venues.okx], ['hyperliquid', venues.hyperliquid],
  ];
  const venueStats = attachVenues(merged, {
    mexcSpot: venues.mexcSpot,
    binanceSpot: venues.binanceSpot,
    spot: [['gate', venues.gateSpot], ['okx', venues.okxSpot], ['bitget', venues.bitgetSpot]].map(([venue, r]) => ({ venue, ok: r.ok, data: r.data ?? [] })),
    perps: perpResults.map(([venue, r]) => ({ venue, ok: r.ok, data: r.data ?? [] })),
    upbit: venues.upbit,
    bithumb: venues.bithumb,
    alpha: venues.alpha,
    gateAlpha: venues.gateAlpha,
    cgTrending: context.trending,
    dexBoosts: context.boosts,
    gtTrending: context.gtTrending,
    llamaProtocols: context.llamaProtocols,
    llamaFees: context.llamaFees,
  });

  // 4) Catalysts: listing registry diff (whole universe) + change detection + manual notebook.
  const okVenues = {
    mexcSpot: venues.mexcSpot.ok,
    binanceSpot: venues.binanceSpot.ok,
    perpVenues: perpResults.filter(([, r]) => r.ok).map(([v]) => v),
    upbit: venues.upbit.ok,
    bithumb: venues.bithumb.ok,
    alpha: venues.alpha.ok,
    // Only a complete read of Gate's paginated token list may produce "new on Gate Alpha" events.
    gateAlpha: venues.gateAlpha.ok && venues.gateAlpha.meta?.listComplete !== false,
    universe: universe.cg.ok && universe.cmc.ok,
  };
  const byKey = new Map(merged.map((a) => [a.key, a]));
  const registryNow = buildRegistry(merged, okVenues);
  const { events: listingEvents, next: registryNext } = diffRegistry(state.registry, registryNow, byKey, nowMs, okVenues);
  const bySymbol = new Map();
  for (const a of [...eligible].sort((x, y) => (y.market.marketCap ?? 0) - (x.market.marketCap ?? 0))) if (!bySymbol.has(a.symbol)) bySymbol.set(a.symbol, a);
  const manual = manualEvents(deps.manualCatalysts, bySymbol, nowMs);

  // 5) Market context: regime, locally computed altseason index, narrative landscape.
  const breadth = universeBreadth(merged);
  const altseason = altseasonIndex(merged, { topN: 100 });
  const fearGreed = context.fearGreed.ok ? context.fearGreed.data : null;
  const regime = marketRegime({ global: context.global.data, fearGreed, altseason, breadth });
  const landscape = narrativeLandscape({ assets: merged, categories: context.categories.ok ? context.categories.data : null, nowMs });
  const marketCtx = { regime, altseason, fearGreed, breadth, landscape };

  // 6) Light research on every eligible asset (legacy CRI + similarity to LAB/BTW/AGT).
  const references = refs.items ?? [];
  const recentLogged = (state.catalysts ?? []).filter((e) => nowMs - toMs(e.observedAt) <= 14 * 86_400_000);
  const eventsByKey = new Map();
  const pushEvent = (e) => { const list = eventsByKey.get(e.assetKey) ?? []; if (!list.some((x) => x.id === e.id)) list.push(e); eventsByKey.set(e.assetKey, list); };
  [...recentLogged, ...listingEvents, ...manual].forEach(pushEvent);

  const platformsKnown = universe.platforms.ok;
  const light = [];
  const newEvents = [...listingEvents, ...manual];
  for (const a of eligible) {
    const points = state.history?.[a.key]?.points ?? [];
    a.lf = listingFeatures(a, points, nowMs, { platformsKnown });
    a.catalysts = (eventsByKey.get(a.key) ?? []).map((e) => ({ type: e.type, label: e.title, detail: e.detail ?? null, fresh: nowMs - toMs(e.observedAt) <= 7 * 86_400_000 }));
    for (const e of detectChangeEvents(a, points, nowMs)) { pushEvent(e); newEvents.push(e); }
    light.push(researchAsset(a, { events: eventsByKey.get(a.key) ?? [], references, history: points, regime: regime.label, nowMs, config }));
  }
  light.sort((x, y) => (y.cri ?? -1) - (x.cri ?? -1));

  // 7) Shortlist = best light CRI ∪ strongest structural (DNA) LAB/BTW/AGT matches not yet expanding
  //    ∪ continuity (open signals, previous setups, the reference tokens themselves).
  const openKeys = new Set((state.journal?.entries ?? []).filter((e) => e.status === 'OPEN').map((e) => e.key));
  const prevSetups = new Set(Object.entries(state.lastSeen ?? {}).filter(([, v]) => ['BUY_SETUP', 'ACCUMULATE'].includes(v.signal) || v.earlyResearchCandidate).map(([k]) => k));
  // Discovery continuity: a project the change engine rated as building last run (multi-factor stage,
  // early candidate, or simultaneous changes — but not one already in public expansion) stays in
  // depth, so its holder, liquidity and development norms accumulate instead of restarting every
  // time it drops out of the shortlist and comes back.
  const prevBuilding = new Set(Object.entries(state.lastSeenV4 ?? {})
    .filter(([, v]) => (v.stage ?? 0) <= 2 && ((v.stage ?? 0) === 2 || v.earlyResearchCandidate || v.simultaneous))
    .map(([k]) => k));
  const refSymbols = new Set(references.map((r) => r.symbol));
  const limit = config.deep.limit;

  // VALIDITY, first pass. A project that can never pass the gate this run, whatever its contract
  // scan says — a capitalisation only Gate Alpha reports, a token no aggregator and no Binance
  // curation confirms, an asset type outside the research universe — takes no priority slot and no
  // free-plan rotation: those budgets go to projects that can still be valid. It still gets the bulk
  // facts (candles, DEX liquidity) and its row in the universe table.
  const policy = validityPolicy(config);
  const preRejectedKeys = new Set(eligible.filter((a) => preRejected({ asset: a, nowMs, policy })).map((a) => a.key));
  if (preRejectedKeys.size) logger.info(`validare (prima trecere): ${preRejectedKeys.size} proiecte nu pot fi validate în această rulare (capitalizare neconfirmată sau neidentificate) — fără prioritate și fără rotația surselor gratuite`);
  const canBeValid = (key) => !preRejectedKeys.has(key);
  const shares = { prescreen: config.deep.shares?.prescreen ?? 0.4, legacy: config.deep.shares?.legacy ?? 0.35 };

  // 7a) PRESCREEN — the change engine, run on every eligible project against its own norm, with
  //     the facts this run already holds for the whole universe (no extra call). It claims the first
  //     share of the deep budget: the projects where something is moving right now.
  const prescreen = new Map(eligible.map((a) => [a.key, prescreenAsset({ asset: a, points: state.discovery?.[a.key]?.points ?? [], config, nowMs })]));
  const prescreenKeys = prescreenPicks([...prescreen.values()].filter((p) => canBeValid(p.key)), Math.round(limit * shares.prescreen));
  const shortKeys = new Set(prescreenKeys);
  // 7b) the legacy score, then 7c) the strongest structural (DNA) matches, as before.
  for (const r of light) {
    if (shortKeys.size >= Math.round(limit * (shares.prescreen + shares.legacy))) break;
    if (canBeValid(r.asset.key)) shortKeys.add(r.asset.key);
  }
  const dnaOf = (r) => Math.max(0, ...r.analogs.all.map((x) => x.dnaSim ?? 0));
  for (const r of [...light].filter((x) => !['EXPANSION', 'POST_EXPANSION'].includes(x.stageInfo.stage) && x.hype.state !== 'HYPED').sort((a, b) => dnaOf(b) - dnaOf(a))) {
    if (shortKeys.size >= limit) break;
    if (canBeValid(r.asset.key)) shortKeys.add(r.asset.key);
  }
  for (const r of light) {
    if (shortKeys.size >= limit + config.deep.keepWatchlist) break;
    if (!canBeValid(r.asset.key)) continue;
    if (openKeys.has(r.asset.key) || prevSetups.has(r.asset.key) || prevBuilding.has(r.asset.key) || refSymbols.has(r.asset.symbol)) shortKeys.add(r.asset.key);
  }
  /*
   * Research priority inside the shortlist. Several deep tasks are capped (contract security and
   * holders at 45 projects, coin details at 25, GitHub at 24), and they take the shortlist from the
   * top. Ordered by the legacy score, the projects the change engine brought in — chosen precisely
   * because the legacy score does not rank them — would sit at the bottom and miss exactly the
   * checks they were brought in for. So the two discovery-driven groups go first, interleaved —
   * projects that were building last run (strongest first) and projects moving now (strongest
   * change first) — and everything else follows in legacy order.
   */
  const prescreenRank = new Map(prescreenKeys.map((k, i) => [k, i]));
  const lightRank = new Map(light.map((r, i) => [r.asset.key, i]));
  const continuityList = [...prevBuilding].filter((k) => shortKeys.has(k) && canBeValid(k))
    .sort((a, b) => (state.lastSeenV4?.[b]?.opportunity ?? 0) - (state.lastSeenV4?.[a]?.opportunity ?? 0));
  const movingList = prescreenKeys.filter((k) => shortKeys.has(k));
  const priority = new Map();
  for (let i = 0; i < Math.max(continuityList.length, movingList.length); i += 1) {
    for (const k of [continuityList[i], movingList[i]]) if (k && !priority.has(k)) priority.set(k, priority.size);
  }
  const shortlist = light.filter((r) => shortKeys.has(r.asset.key)).map((r) => r.asset)
    .sort((a, b) => (priority.get(a.key) ?? 1e9) - (priority.get(b.key) ?? 1e9) || lightRank.get(a.key) - lightRank.get(b.key));
  /** Why a project was researched in depth this run — published with its row. */
  // HORIZON: outside the priority, researched because the horizon covers every eligible project.
  const selectedBy = (key) => (prevBuilding.has(key) ? 'CONTINUITY' : prescreenRank.has(key) ? 'CHANGE_ENGINE' : shortKeys.has(key) ? 'SCORE' : 'HORIZON');

  /*
   * 8) Deep research on the whole horizon. The shortlist above is the research *priority*: it goes
   *    first everywhere, and it alone gets the full holder lists that need the same wallets on
   *    consecutive runs. Every other eligible project — up to `deep.horizon` (1000) — is researched
   *    too: candles and DEX liquidity on every run, and a rotating slice of the free-plan sources
   *    (security, coin detail, holder counts, development, attention), carried or measured as
   *    deep-cache.js explains. After the priority, the change engine's order decides who is next.
   */
  const horizon = Math.max(shortlist.length, Math.min(config.deep.horizon ?? shortlist.length, eligible.length));
  const priorityKeys = new Set(shortlist.map((a) => a.key));
  const prescreenScoreOf = (key) => prescreen.get(key)?.score ?? 0;
  const rest = light.map((r) => r.asset).filter((a) => !priorityKeys.has(a.key))
    .sort((a, b) => prescreenScoreOf(b.key) - prescreenScoreOf(a.key) || lightRank.get(a.key) - lightRank.get(b.key));
  const targets = [...shortlist, ...rest].slice(0, horizon);
  logger.info(`deep research pe ${targets.length} proiecte (prioritate ${shortlist.length}, orizont ${horizon}; timp rămas ${Math.round(timeLeft() / 1000)}s)`);
  const { byKey: deepData, usage: deepUsage, cache: deepCache, tiers: deepTiers } = await collectDeepData(targets, P, config.deep, { timeLeft, logger }, {
    priorityKeys,
    cache: structuredClone(state.deepCache ?? {}),
    nowMs,
    skipRotation: preRejectedKeys,
  });
  const hasDeep = (key) => {
    const d = deepData.get(key);
    return Boolean(d && Object.keys(d).length);
  };
  const researchedKeys = targets.filter((a) => hasDeep(a.key) || priorityKeys.has(a.key)).map((a) => a.key);
  const full = new Map(light.map((r) => [r.asset.key, r]));
  for (const key of researchedKeys) {
    const a = byKey.get(key);
    const points = state.history?.[a.key]?.points ?? [];
    full.set(a.key, researchAsset(a, { events: eventsByKey.get(a.key) ?? [], references, history: points, regime: regime.label, nowMs, config, deep: deepData.get(a.key) ?? {} }));
  }
  const researched = [...full.values()].sort((x, y) => rankKey(y) - rankKey(x));
  logger.info(`deep research: lumânări ${deepTiers.candles} · DEX ${deepTiers.dex} · securitate ${deepTiers.security.fresh} citite + ${deepTiers.security.carried} purtate · detalii ${deepTiers.detail.fresh} + ${deepTiers.detail.carried} · deținători ${deepTiers.holdersInfo} · dezvoltare ${deepTiers.dev}`);

  // 9) DISCOVERY — the v4 engine, on every researched project of the horizon.
  logger.info('discovery: norme proprii, ce s-a schimbat, scor de pre-expansiune, invalidatori');
  const unlocksBySymbol = new Map();
  for (const e of deps.manualCatalysts ?? []) {
    if (e.type !== 'UNLOCK' || !e.symbol) continue;
    const list = unlocksBySymbol.get(e.symbol) ?? [];
    list.push({ at: e.at, pctOfSupply: e.pctOfSupply ?? null, note: e.note ?? null });
    unlocksBySymbol.set(e.symbol, list);
  }
  const discovery = [];
  for (const key of researchedKeys) {
    const a = byKey.get(key);
    try {
      discovery.push(discoverAsset({
        asset: a,
        deep: deepData.get(a.key) ?? {},
        state: { history: state.discovery ?? {}, flows: state.flows ?? {} },
        labelIndex,
        market: marketCtx,
        landscape,
        unlocks: unlocksBySymbol.get(a.symbol) ?? [],
        config,
        nowMs,
      }));
    } catch (err) {
      logger.warn(`discovery ${a.symbol}: ${err.message}`);
    }
  }
  const ranked = rankCandidates(discovery);

  // 9b) VALIDITY — the gate. Every eligible project is judged on the evidence the run gathered:
  //     capitalisation under the cap and confirmed, a real and identified project, listed on an
  //     exchange, a contract without traps, real liquidity. Only VALID projects reach the CRI lists
  //     below (radar, candidates, alerts, cohort); the rest are published with their reason.
  const validity = new Map();
  for (const a of eligible) validity.set(a.key, validateAsset({ asset: a, deep: deepData.get(a.key) ?? {}, nowMs, policy }));
  const isValid = (key) => validity.get(key)?.status === VALIDITY.VALID;
  const rankedValid = ranked.filter((r) => isValid(r.asset.key));
  const deepKeysRanked = new Set(ranked.map((r) => r.asset.key));
  const vCount = (st) => [...validity.values()].filter((x) => x.status === st).length;
  const validityCounts = { valid: vCount(VALIDITY.VALID), pending: vCount(VALIDITY.PENDING), rejected: vCount(VALIDITY.REJECTED) };
  const earlyCandidates = rankedValid.filter((r) => r.verdict.earlyResearchCandidate);
  const answering = rankedValid.filter((r) => r.verdict.answersQuestion);
  logger.info(`validare: ${validityCounts.valid} verificate · ${validityCounts.pending} în verificare · ${validityCounts.rejected} respinse (din ${eligible.length} eligibile)`);
  logger.info(`discovery: ${ranked.length} analizați · ${rankedValid.length} verificați · ${earlyCandidates.length} candidați timpurii · ${answering.length} răspund exact la întrebarea proiectului`);

  // 9c) FORECAST — the learning list of the last year's big runs (seeds + every ATL/ATH of the
  //     market, confirmed from daily history within a small per-run budget), then each researched
  //     project's probability of a ≥100× / ≥20× run within twelve months.
  const fPolicy = forecastPolicy(config);
  const winnersState = await refreshWinners({
    cached: state.winners,
    seeds: deps.winnersSeed?.items ?? [],
    assets: merged,
    history: P.coingecko,
    nowMs,
    policy: fPolicy,
    logger,
    canSpend: () => timeLeft() > 120_000,
  });
  const fProjects = researched.map((r) => ({ key: r.asset.key, vector: r.vector ?? null }));
  const population = trackedPopulation({ eligible, history: state.history, nowMs, windowDays: fPolicy.windowDays });
  const fc = runForecast({ winners: winnersState.items, projects: fProjects, population, policy: fPolicy });
  const pastRuns = pastRunsByKey(winnersState.items);
  const fcOf = (key) => (validity.get(key)?.status === VALIDITY.REJECTED ? null : forecastView(fc.byKey.get(key), fc.rates, pastRuns.get(key) ?? null));
  logger.info(`prognoză: ${winnersState.stats.confirmed} câștigători confirmați din istoric · ${winnersState.stats.documented} documentați · ${winnersState.stats.pending} în verificare (${winnersState.stats.charts} istorice citite) · rata de bază ≥${fPolicy.targets[0]}×: ${(fc.rates[fPolicy.targets[0]].p * 100).toFixed(2)}% din ${population} proiecte`);

  // How far the per-project norms have got. On the first runs the honest answer to the project's
  // question is usually "nothing yet", and this block is what lets the dashboard say *why*: a change
  // can only be measured against a norm, and a norm needs several runs of the project's own history.
  const minPoints = config.discovery?.baselineMinPoints ?? 4;
  const pre = [...prescreen.values()];
  const missingPoints = pre.map((p) => Math.max(0, minPoints - (p.baselinePoints ?? 0))).sort((a, b) => a - b);
  const discoveryCoverage = {
    eligible: eligible.length,
    normsTracked: pre.filter((p) => (p.baselinePoints ?? 0) > 0).length,
    withBaseline: pre.filter((p) => p.baselineSufficient).length,
    minPoints,
    windowDays: config.discovery?.baselineWindowDays ?? 30,
    moving: pre.filter((p) => p.score > 0).length,
    prescreened: prescreenKeys.length,
    // The research horizon: how many projects the full engine read this run, and how many of
    // them were the priority (full holder lists, first call on every budget).
    analysed: ranked.length,
    priority: shortlist.length,
    horizon,
    runsToNorms: missingPoints.length ? missingPoints[Math.floor(missingPoints.length / 2)] : minPoints,
  };
  logger.info(`norme proprii: ${discoveryCoverage.withBaseline}/${discoveryCoverage.eligible} proiecte cu istoric suficient · ${discoveryCoverage.moving} cu schimbări față de propria normă · ${discoveryCoverage.prescreened} aduse în profunzime de motorul de schimbări`);

  // 10) FUTURES RADAR — every perpetual market of the universe, reusing the candles read above.
  const watchlist = pickWatchlist({ assets: merged, radarRows: rankedValid, cfg: config.futures });
  logger.info(`futures radar: ${watchlist.length} instrumente (timp rămas ${Math.round(timeLeft() / 1000)}s)`);
  const futures = await runFuturesRadar({ watchlist, providers: P, cfg: config.futures, timeLeft, logger, nowMs, candles: deepData });

  // 11) Track record: score what is due, open what qualifies now.
  const priceByKey = new Map(merged.filter((a) => isNum(a.market.price)).map((a) => [a.key, a.market.price]));
  const btc = merged.find((a) => a.symbol === 'BTC');
  const btcChangePct = { 7: btc?.market?.change?.d7 ?? null, 14: null, 30: btc?.market?.change?.d30 ?? null };
  let cohortEntries = scoreEntries({ entries: state.cohort ?? [], priceByKey, nowMs, btcChangePct });
  const openIds = new Set(cohortEntries.filter((e) => !e.closed).map((e) => e.key));
  for (const r of rankedValid) {
    if (!qualifiesForCohort(r.verdict, config.trackRecord?.cohort)) continue;
    if (openIds.has(r.asset.key)) continue;
    cohortEntries.push(openEntry({ asset: r.asset, verdict: r.verdict, changed: r.changed, risk: r.risk, nowMs }));
    openIds.add(r.asset.key);
  }
  cohortEntries = cohortEntries.filter((e) => nowMs - e.openedAtMs <= (config.trackRecord?.retentionDays ?? 180) * 86_400_000);
  const record = trackRecord(cohortEntries, { nowMs });

  // 12) Alerts (transitions against the previous run).
  const { alerts, counts: alertCounts } = buildAlerts({ rows: rankedValid, lastSeen: state.lastSeenV4 ?? {}, market: marketCtx, nowMs });

  // 13) Legacy watchlist + journal (kept: the LAB/BTW/AGT similarity track record).
  const nowIso = new Date(nowMs).toISOString();
  const compactForJournal = researched.filter((r) => isValid(r.asset.key)).map((r) => ({ key: r.asset.key, symbol: r.asset.symbol, price: r.lf.price, signal: r.signal, cri: r.cri, analog: r.analogs.best, stage: r.stageInfo.stage }));
  const watch = watchlistChanges(compactForJournal, state.lastSeen, nowIso);
  const journal = updateJournal(state.journal, compactForJournal.filter((c) => full.get(c.key)?.depth === 'deep'), nowMs, { horizonsDays: [7, 14, 30], hitThresholdPct: 25, cooldownDays: 14, retentionDays: 180 }, priceByKey);

  // 14) Health, quota, parity.
  const telemetrySummary = telemetry.summary();
  const results = {
    coingecko: universe.cg, coinmarketcap: universe.cmc, coinpaprika: universe.cp,
    mexc: venues.mexcSpot, mexc_futures: venues.mexcPerps, binance_spot: venues.binanceSpot,
    gate: venues.gate, bitget: venues.bitget, okx: venues.okx, hyperliquid: venues.hyperliquid,
    upbit: venues.upbit, bithumb: venues.bithumb, binance_alpha: venues.alpha, gate_alpha: venues.gateAlpha,
    dexscreener: context.boosts, geckoterminal: context.gtTrending, defillama: context.llamaProtocols,
    alternative_me: context.fearGreed,
  };
  const CORE = new Set(['coingecko', 'coinmarketcap', 'coinpaprika', 'mexc', 'binance_spot']);
  for (const [id, u] of Object.entries({ ...deepUsage, ...futures.usage })) {
    if (results[id] && !CORE.has(id) && results[id].status !== 'OK' && u.ok > 0) results[id] = { ...results[id], status: 'OK', message: `${u.ok}/${u.calls} apeluri reușite` };
    if (results[id]) continue;
    results[id] = {
      status: u.ok > 0 ? 'OK' : u.lastStatus ?? 'SKIPPED',
      message: u.ok > 0 ? `${u.ok}/${u.calls} apeluri reușite` : u.lastMessage,
      meta: { records: u.ok, units: u.units ?? null },
    };
  }
  const runTelemetry = { at: nowIso, providers: Object.fromEntries(Object.entries(telemetrySummary).map(([k, v]) => [k, { calls: v.calls, ok: v.ok, units: v.units ?? 0 }])) };
  const telemetryLog = appendTelemetry(state.telemetry, runTelemetry);
  const keyed = deps.keyed ?? {};
  const ledger = deps.quotaGate?.ledger ? deps.quotaGate.ledger() : (state.ledger ?? {});
  const plan = quotaPlan(ledger, config.quotas ?? {}, nowMs, { keyed });
  const providerHealth = buildProviderHealth(results, telemetrySummary, providerSuccessRates(telemetryLog), keyed, plan);
  // PARTIAL still delivers the capability, on part of the list; its coverage gap is in the health row.
  const liveStatus = Object.fromEntries(providerHealth.map((p) => [p.id, p.status === 'OK' || p.status === 'PARTIAL']));
  liveStatus['eth-labels'] = labelIndex.size > 0;
  const parityReport = parity({ keys: keyed, liveStatus });

  // 15) Snapshot. The dashboard contract carries the top of each ranking with its evidence; the
  //     whole horizon — every researched project — ships as one compact table (data/universe.json).
  const deepViews = [];
  const lightViews = [];
  const chartBudget = config.snapshot?.charts ?? 30;
  const maxDeepViews = config.snapshot?.maxDeep ?? 60;
  for (const r of researched) {
    if (!isValid(r.asset.key)) continue; // the CRI list carries verified projects only
    const goesDeep = r.depth === 'deep' && deepViews.length < maxDeepViews;
    if (!goesDeep && lightViews.length >= config.snapshot.maxLight) continue;
    const deep = deepData.get(r.asset.key);
    const points = state.history?.[r.asset.key]?.points ?? [];
    const ctx = {
      config,
      events: (eventsByKey.get(r.asset.key) ?? []).sort((a, b) => toMs(b.observedAt) - toMs(a.observedAt)),
      // Candle payloads are the heaviest part of the contract, so they ship for the rows at the top
      // of the ranking; everything else keeps its sparkline, which is what a list renders anyway.
      chart: goesDeep && deepViews.length < chartBudget ? chartPayload(deep) : null,
      historyView: goesDeep ? points.slice(-40).map((p) => [p.t, p.cri, p.stage, p.price]) : [],
      sparkline: sparkFrom(deep, points, r.lf.price),
    };
    const view = { ...toCandidateView(r, ctx), validity: validityView(validity.get(r.asset.key)), forecast: fcOf(r.asset.key) };
    if (goesDeep) deepViews.push(view);
    else lightViews.push({ ...trimLight(view), validity: view.validity, forecast: view.forecast });
  }
  const candidates = [...deepViews, ...lightViews].sort((x, y) => (y.score.cri ?? -1) - (x.score.cri ?? -1));
  const signalCounts = {};
  const stageCounts = {};
  for (const c of candidates) {
    signalCounts[c.signal.type] = (signalCounts[c.signal.type] ?? 0) + 1;
    stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1;
  }
  const assetsByCg = new Map(merged.filter((a) => a.ids.coingecko).map((a) => [a.ids.coingecko, a]));
  // The dashboard contract carries the top of the ranking with graded evidence (full / card /
  // list — see discoveryView). Every early candidate ships with its full file wherever it ranks;
  // simultaneous changes inside the cap ship at least as cards; the rest of the horizon is a row of
  // data/universe.json.
  const discoveryCap = config.snapshot?.discoveryRows ?? 120;
  const fullRows = config.snapshot?.fullDetail ?? 24;
  const cardRows = config.snapshot?.cardRows ?? 48;
  const levelOf = (r, i) => (r.verdict.earlyResearchCandidate || r.verdict.answersQuestion || i < fullRows ? 'full'
    : i < cardRows || r.changed.simultaneous ? 'card' : 'list');
  const publishedDiscovery = rankedValid
    .map((r, i) => ({ r, i, level: levelOf(r, i) }))
    .filter(({ r, i }) => i < discoveryCap || r.verdict.earlyResearchCandidate || r.verdict.answersQuestion)
    .map((x) => ({ ...x, full: x.level === 'full' }));
  const publishedFutures = futures.rows.slice(0, config.snapshot?.futuresRows ?? 60);
  // Events of projects the gate rejected stay out of the feed (a pending one keeps its events).
  const recentEvents = appendCatalysts([], [...eventsByKey.values()].flat().filter((e) => validity.get(e.assetKey)?.status !== VALIDITY.REJECTED), nowMs, 7).slice(0, 120);
  const finishedMs = clock.now();

  const sourceCoverage = coverageReport([
    { key: 'coingecko', label: 'CoinGecko (univers)', required: true, ok: universe.cg.ok, status: universe.cg.status, message: universe.cg.message },
    { key: 'coinmarketcap', label: 'CoinMarketCap (univers)', required: false, ok: universe.cmc.ok, status: universe.cmc.status, message: universe.cmc.message },
    { key: 'candles', label: 'Lumânări 1D/4H', required: true, ok: venues.mexcSpot.ok || venues.binanceSpot.ok, status: venues.mexcSpot.status, message: venues.mexcSpot.message },
    { key: 'derivatives', label: 'Derivate (funding + OI)', required: false, ok: perpResults.some(([, r]) => r.ok), status: perpResults.find(([, r]) => !r.ok)?.[1]?.status ?? 'OK' },
    { key: 'coinalyze', label: 'Coinalyze (funding agregat)', required: false, ok: Boolean(futures.usage.coinalyze?.ok), status: futures.usage.coinalyze?.lastStatus ?? 'OK', message: futures.usage.coinalyze?.lastMessage },
    { key: 'liquidity', label: 'Lichiditate DEX', required: false, ok: Boolean(deepUsage.dexscreener?.ok), status: deepUsage.dexscreener?.lastStatus ?? 'OK' },
    { key: 'holders', label: 'Liste de deținători', required: false, ok: Boolean(deepUsage.nodereal?.ok || deepUsage.solana_rpc?.ok), status: deepUsage.nodereal?.lastStatus ?? deepUsage.solana_rpc?.lastStatus ?? 'OK', message: deepUsage.nodereal?.lastMessage ?? deepUsage.solana_rpc?.lastMessage },
    { key: 'labels', label: 'Etichete on-chain (eth-labels)', required: false, ok: labelIndex.size > 0, status: labelIndex.size ? 'OK' : 'SKIPPED', message: labelIndex.size ? `${labelIndex.size} adrese` : 'rulează "npm run labels"' },
    { key: 'security', label: 'Securitate contract (GoPlus)', required: false, ok: Boolean(deepUsage.goplus?.ok), status: deepUsage.goplus?.lastStatus ?? 'OK' },
    { key: 'fundamentals', label: 'TVL / venituri (DefiLlama)', required: false, ok: context.llamaProtocols.ok, status: context.llamaProtocols.status },
    { key: 'sentiment', label: 'Fear & Greed (alternative.me)', required: false, ok: context.fearGreed.ok, status: context.fearGreed.status },
    { key: 'dev', label: 'Activitate de dezvoltare (GitHub)', required: false, ok: Boolean(deepUsage.github?.ok), status: deepUsage.github?.lastStatus ?? 'SKIPPED', message: deepUsage.github?.lastMessage },
    { key: 'attention', label: 'Atenție video (YouTube)', required: false, ok: Boolean(deepUsage.youtube?.ok), status: deepUsage.youtube?.lastStatus ?? 'SKIPPED', message: deepUsage.youtube?.lastMessage },
    { key: 'entities', label: 'Entități (Arkham, opțional)', required: false, ok: Boolean(deepUsage.arkham?.ok), status: deepUsage.arkham?.lastStatus ?? 'NOT_CONFIGURED', message: deepUsage.arkham?.lastMessage },
  ]);

  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      app: 'CRI Radar',
      version: config.version,
      generatedAt: nowIso,
      runId,
      mode: deps.mode,
      durationMs: Math.max(finishedMs - startedMs, Math.round((globalThis.performance?.now?.() ?? Date.now()) - t0)),
      scope: { researchOnly: true, automatedTrading: false, tradeExecution: false },
      policy: { unknownIsBearish: false, subscriptionsUsed: false, freeOnly: true },
      question: 'Arată-mi proiectele mici unde se schimbă simultan mai multe lucruri importante, înainte ca mișcarea să devină evidentă, și spune-mi ce riscuri pot invalida această ipoteză.',
      disclaimer: 'Cercetare, nu sfat financiar. Scorurile sunt priorități de analiză cu invalidatori expliciți; nicio componentă nu execută și nu transmite ordine.',
      config: { topN, minMarketCapUsd: config.universe.minMarketCapUsd, maxMarketCapUsd: config.universe.maxMarketCapUsd, minVolume24hUsd: config.universe.minVolume24hUsd, deepLimit: config.deep.limit, deepHorizon: config.deep.horizon ?? config.deep.limit, futuresMax: config.futures.maxInstruments ?? null },
      // The whole horizon, one compact row per project: loaded by the dashboard on demand.
      universe: { file: 'data/universe.json', projects: eligible.length, researched: ranked.length, futures: futures.rows.length },
    },
    health: {
      overall: overallHealth(providerHealth),
      providers: providerHealth,
      coverage: sourceCoverage,
      universe: {
        coingecko: universe.cg.data?.length ?? 0,
        coinmarketcap: universe.cmc.data?.length ?? 0,
        coinpaprika: universe.cp.data?.length ?? 0,
        binanceAlpha: universe.alpha.data?.length ?? 0,
        gateAlpha: universe.gateAlpha.data?.length ?? 0,
        // Alpha tokens the aggregators' top 1000 does not reach, and how many of them pass the
        // small-cap screen: the part of the universe that exists only because an Alpha list is a source.
        alphaOnly: alphaOnly.length,
        alphaOnlyEligible: eligible.filter(isAlphaOnly).length,
        binanceAlphaOnly: merged.filter(onlyFrom('binance_alpha')).length,
        gateAlphaOnly: merged.filter(onlyFrom('gate_alpha')).length,
        alphaPrograms: venueStats.alphaPrograms,
        merged: merged.length,
        excluded: excluded.length,
        eligible: eligible.length,
        deep: researchedKeys.length,
        priority: shortlist.length,
        horizon,
        discovered: ranked.length,
        published: candidates.length,
        // The validity gate over every eligible project: only `valid` ones reach the CRI lists.
        validity: validityCounts,
        futures: futures.rows.length,
        rolling: { tiers: deepTiers, cache: cacheCoverage(deepCache, targets.map((a) => a.key), { nowMs, ttlHours: config.deep.cacheHours ?? undefined }) },
        crossListed: merged.filter((a) => a.sources.includes('coingecko') && a.sources.includes('coinmarketcap')).length,
      },
      venues: venueStats,
      exclusions: countBy(excluded, 'reason'),
      referencesReused: Boolean(refs.reused),
      labels: { size: labelIndex.size, source: labelIndex.source, license: labelIndex.license, builtAt: labelIndex.builtAt, counts: labelIndex.counts },
    },
    quota: quotaView(plan, deps.quotaGate?.runUnits ? deps.quotaGate.runUnits() : {}),
    parity: parityReport,
    market: {
      regime,
      global: context.global.data ?? null,
      fearGreed,
      altseason,
      breadth,
      narratives: narrativeBoard(context.categories.data ?? [], candidates, assetsByCg),
      landscape: { ranked: landscape.ranked.slice(0, 12), coverage: landscape.coverage, note: landscape.note },
    },
    // ② Small-Cap Radar — the section that answers the project's question.
    discovery: {
      answering: answering.length,
      earlyCandidates: earlyCandidates.length,
      analysed: ranked.length,
      // Of the analysed projects, how many passed the validity gate (only those are published here).
      validated: rankedValid.length,
      validity: validityCounts,
      // Full evidence for the rows that matter (every early candidate, plus the top of the ranking);
      // the next rows ship as cards, then as list rows; each row says which in `detail`.
      published: publishedDiscovery.length,
      // Totals over the whole horizon: the published rows are its top, the rest is in universe.json.
      totals: {
        simultaneous: rankedValid.filter((r) => r.changed.simultaneous).length,
        moving: rankedValid.filter((r) => r.changed.count > 0).length,
      },
      rows: publishedDiscovery.map(({ r, level }) => ({
        ...discoveryView(r, {
          keys: keyed,
          links: platformLinks(r.asset, { keys: keyed }),
          level,
        }),
        validity: validityView(validity.get(r.asset.key)),
        forecast: fcOf(r.asset.key),
        selectedBy: selectedBy(r.asset.key),
      })),
      note: 'Rândurile sunt ordonate punând candidații timpurii primii, apoi după produsul dintre oportunitate, precocitate și încredere — un scor puțin mai mic, dar încă invizibil, trece înaintea unuia mai mare pe care îl vede toată lumea.',
      coverage: discoveryCoverage,
    },
    // ① Futures Radar.
    futures: {
      summary: { ...futures.summary, published: publishedFutures.length },
      rows: publishedFutures.map(futuresView),
    },
    // The forecast: base rates, the learning list of the last year's winners, the top forecasts.
    forecast: {
      ...forecastReport({
        winners: winnersState.items,
        rates: fc.rates,
        separation: fc.separation,
        byKey: fc.byKey,
        ranked,
        isValid,
        policy: fPolicy,
        excluded: deps.winnersSeed?.excluded ?? [],
        projects: fProjects.length,
      }),
      learning: winnersState.stats,
    },
    // The gate: its policy, its counts, and every project it held back, with the reason.
    validity: validityReport({
      ordered: [...ranked.map((r) => r.asset), ...eligible.filter((a) => !deepKeysRanked.has(a.key))],
      results: validity,
      policy,
    }),
    references: referencesView(references, config.similarity).map((ref) => ({ ...ref, live: liveRef(ref, merged, researched) })),
    candidates,
    catalysts: recentEvents,
    alerts: { items: alerts, counts: alertCounts },
    watchlist: { transitions: watch.transitions.slice(0, 80), alerts: watch.alerts.slice(0, 60) },
    derivatives: { squeezeWatch: squeezeWatch(candidates) },
    trackRecord: {
      cohort: record,
      families: familyPerformance(cohortEntries, 14),
      recent: cohortEntries.slice(-40).reverse().map(trimCohort),
      legacy: { summary: journal.summary, recent: journal.entries.slice(-20).reverse().map(trimEntry) },
    },
    stats: { signals: signalCounts, stages: stageCounts, discovery: countBy(ranked.map((r) => ({ band: r.verdict.band })), 'band') },
    methodology: methodology(config, { keys: keyed }),
  };

  const universeDoc = universeTable({
    eligible,
    researched,
    ranked,
    futuresRows: futures.rows,
    published: {
      discovery: new Map(publishedDiscovery.map(({ r, level }) => [r.asset.key, level])),
      futures: new Set(publishedFutures.map((f) => f.key)),
    },
    selectedBy,
    validity,
    forecast: { byKey: fc.byKey, targets: fPolicy.targets, isRejected: (key) => validity.get(key)?.status === VALIDITY.REJECTED },
    meta: { generatedAt: nowIso, runId, mode: deps.mode },
  });
  const published = await publisher.publish(snapshot, { universe: universeDoc });
  logger.info(`snapshot publicat: ${published.path} (${Math.round(published.bytes / 1024)} KB)${published.universe ? ` + univers ${universeDoc.assets.rows.length} proiecte, ${universeDoc.futures.rows.length} perpetue (${Math.round(published.universe.bytes / 1024)} KB)` : ''}`);

  // 16) Persist research memory.
  const keepKeys = new Set([...openKeys, ...researched.filter((r) => r.depth === 'deep').map((r) => r.asset.key), ...researched.slice(0, config.history.trackTopLight).map((r) => r.asset.key)]);
  const historyRows = researched.filter((r) => keepKeys.has(r.asset.key)).map((r) => ({ key: r.asset.key, point: historyPoint(r) }));
  // Every eligible project gets a point, not only the sixty researched in depth: a project's norm
  // must already exist on the run where it starts to move, because that is the run that matters.
  // Researched projects store their full row; the rest store the market-level metrics of the
  // prescreen, with deep metrics and verdict left null (unmeasured, not zero).
  const deepKeys = new Set(discovery.map((r) => r.asset.key));
  const discoveryRows = [
    ...discovery.map((r) => ({ key: r.asset.key, point: discoveryPoint(r, nowMs) })),
    ...eligible.filter((a) => !deepKeys.has(a.key) && prescreen.has(a.key))
      .map((a) => ({ key: a.key, point: discoveryPoint({ asset: a, current: prescreen.get(a.key).current, verdict: null, changed: null }, nowMs) })),
  ];
  const flowRows = discovery.map((r) => ({ key: r.asset.key, snapshot: r.asset.onchain?.snapshot ?? null }));
  const nextState = {
    ...state,
    history: appendHistory(state.history, historyRows, nowMs, config.history),
    // The baseline reads only the last `baselineWindowDays`; older points would be dead weight on a
    // state branch that every run fetches, so discovery history keeps that window plus one day.
    discovery: appendDiscoveryHistory(state.discovery, discoveryRows, nowMs, {
      ...config.history,
      maxDays: Math.min(config.history.maxDays, (config.discovery?.baselineWindowDays ?? 30) + 1),
    }),
    flows: appendFlows(state.flows, flowRows, nowMs, config.history),
    registry: registryNext,
    journal: { entries: journal.entries },
    cohort: cohortEntries,
    references: { items: references, fetchedAt: refs.fetchedAt, configHash: refs.configHash },
    catalysts: appendCatalysts(state.catalysts, newEvents, nowMs, config.history.catalystRetentionDays).slice(0, config.history.maxCatalysts),
    telemetry: telemetryLog,
    ledger,
    lastSeen: Object.fromEntries(researched.map((r) => [r.asset.key, { stage: r.stageInfo.stage, cri: r.cri, signal: r.signal.type, at: nowIso }])),
    lastSeenV4: Object.fromEntries(ranked.map((r) => [r.asset.key, lastSeenRecord(r)])),
    deepCache: pruneCache(deepCache, { keepKeys: new Set(eligible.map((a) => a.key)), nowMs }),
    winners: { items: winnersState.items, updatedAt: winnersState.updatedAt },
    meta: { runs: (state.meta?.runs ?? 0) + 1, firstRunAt: state.meta?.firstRunAt ?? nowIso, lastRunAt: nowIso, lastRunId: runId },
  };
  await stateRepo.save(nextState);
  return {
    snapshot,
    published,
    summary: {
      runId,
      eligible: eligible.length,
      deep: researchedKeys.length,
      priority: shortlist.length,
      discovered: ranked.length,
      earlyCandidates: earlyCandidates.length,
      answering: answering.length,
      validity: validityCounts,
      futures: futures.summary,
      parity: { permanent: parityReport.permanent, withKeys: parityReport.withKeys, achieved: parityReport.achieved },
      signals: signalCounts,
      overall: snapshot.health.overall,
      durationMs: snapshot.meta.durationMs,
    },
  };
}

function rankKey(r) {
  return (r.cri ?? -1) + (r.depth === 'deep' ? 0.001 : 0);
}

function sparkFrom(deep, points, price) {
  if (deep?.d1?.length) return deep.d1.slice(-30).map((k) => sig(k.c, 5));
  const xs = points.map((p) => p.price).filter(isNum).slice(-30);
  if (isNum(price)) xs.push(sig(price, 5));
  return xs.length >= 3 ? xs : null;
}

/** Light candidates carry scores and headline facts only — the full evidence ships for deep ones. */
function trimLight(v) {
  const m = v.market;
  const best = v.analogs.best;
  return {
    key: v.key,
    symbol: v.symbol,
    name: v.name,
    depth: 'light',
    rank: v.rank,
    chain: v.chain,
    chainLabel: v.chainLabel,
    contract: v.contract,
    categories: [],
    links: { coingecko: v.links.coingecko, coinmarketcap: v.links.coinmarketcap, dexscreener: v.links.dexscreener, mexc: v.links.mexc },
    market: { price: m.price, marketCap: m.marketCap, fdv: m.fdv, volume24h: m.volume24h, turnover: m.turnover, floatRatio: m.floatRatio, fdvToMcap: m.fdvToMcap, change: { h24: m.change.h24, d7: m.change.d7, d30: m.change.d30 }, mcapChange: m.mcapChange, rankChange7d: m.rankChange7d, athChangePct: m.athChangePct, ageDays: m.ageDays },
    score: v.score,
    stage: v.stage,
    stageLabel: v.stageLabel,
    stageReasons: v.stageReasons.slice(0, 2),
    stageProxy: v.stageProxy,
    hype: v.hype,
    hypeLabel: v.hypeLabel,
    hypeReasons: v.hypeReasons.slice(0, 1),
    signal: { type: v.signal.type, label: v.signal.label, strength: v.signal.strength, reasons: v.signal.reasons.slice(0, 2), blockers: v.signal.blockers.slice(0, 2), plan: null },
    analogs: {
      best: best ? { ref: best.ref, similarity: best.similarity, dnaSim: best.dnaSim, phaseSim: best.phaseSim, coverage: best.coverage, topMatches: best.topMatches.slice(0, 3), weakest: best.weakest.slice(0, 2) } : null,
      consensus: v.analogs.consensus,
      supporting: v.analogs.supporting,
      all: v.analogs.all.map((a) => ({ ref: a.ref, similarity: a.similarity, dnaSim: a.dnaSim, phaseSim: a.phaseSim })),
    },
    fingerprint: v.fingerprint,
    domains: v.domains.map((d) => ({ id: d.id, state: d.state, score: d.score, confidence: d.confidence, weight: d.weight, contribution: d.contribution, proxy: d.proxy })),
    risk: { score: v.risk.score, grade: v.risk.grade, critical: v.risk.critical, sizing: v.risk.sizing, flags: v.risk.flags.slice(0, 4) },
    whyNow: v.whyNow.slice(0, 3),
    missing: v.missing,
    derivatives: { venues: v.derivatives.venues, oiUsd: v.derivatives.oiUsd, oiToMcap: v.derivatives.oiToMcap, oiChangePct: v.derivatives.oiChangePct, fundingAvg: v.derivatives.fundingAvg },
    onchain: v.onchain ? { holders: v.onchain.holders, holdersChangePct: v.onchain.holdersChangePct } : null,
    venues: v.venues,
    attention: { cgTrending: v.attention.cgTrending, dexBoost: v.attention.dexBoost, gtTrending: v.attention.gtTrending },
    fundamentals: v.fundamentals ? { tvl: v.fundamentals.tvl, mcapToTvl: v.fundamentals.mcapToTvl } : null,
    technicals: null,
    chart: null,
    catalysts: v.catalysts.slice(0, 3).map((e) => ({ type: e.type, title: e.title, polarity: e.polarity, confidence: e.confidence, observedAt: e.observedAt, eventTime: e.eventTime ?? null, source: e.source })),
    history: [],
    sparkline: v.sparkline,
  };
}

function trimEntry(e) {
  return { symbol: e.symbol, key: e.key, type: e.type, at: e.at, entryPrice: e.entryPrice, lastPrice: e.lastPrice, returnPct: isNum(e.lastPrice) && isNum(e.entryPrice) ? round((e.lastPrice / e.entryPrice - 1) * 100, 1) : null, maxPct: isNum(e.maxPrice) ? round((e.maxPrice / e.entryPrice - 1) * 100, 1) : null, minPct: isNum(e.minPrice) ? round((e.minPrice / e.entryPrice - 1) * 100, 1) : null, analog: e.analog, cri: e.cri, status: e.status, outcomes: e.outcomes };
}

function trimCohort(e) {
  return {
    symbol: e.symbol,
    key: e.key,
    openedAt: e.openedAt,
    entryPrice: e.entryPrice,
    stage: e.stage,
    opportunity: e.opportunity,
    risk: e.risk,
    earliness: e.earliness,
    confidence: e.confidence,
    changes: e.changes,
    families: e.families,
    outcomes: e.outcomes,
    closed: e.closed,
  };
}

function squeezeWatch(candidates) {
  return candidates
    .filter((c) => c.derivatives.venues.length && isNum(c.derivatives.fundingAvg))
    .map((c) => ({
      key: c.key,
      symbol: c.symbol,
      oiUsd: c.derivatives.oiUsd,
      oiToMcap: c.derivatives.oiToMcap,
      oiChangePct: c.derivatives.oiChangePct,
      fundingAvg: c.derivatives.fundingAvg,
      venues: c.derivatives.venues,
      change7d: c.market.change.d7,
      cri: c.score.cri,
      fuel: (c.derivatives.fundingAvg <= 0 ? 1 : 0) + (isNum(c.derivatives.oiChangePct) && c.derivatives.oiChangePct > 15 ? 1 : 0) + (isNum(c.derivatives.oiToMcap) && c.derivatives.oiToMcap > 0.1 ? 1 : 0),
    }))
    .sort((a, b) => b.fuel - a.fuel || (a.fundingAvg - b.fundingAvg))
    .slice(0, 40);
}

function liveRef(ref, merged, researched) {
  const r = researched.find((x) => x.asset.symbol === ref.symbol && (ref.coingeckoId ? x.asset.ids.coingecko === ref.coingeckoId : true));
  const a = r?.asset ?? merged.find((x) => x.symbol === ref.symbol && (ref.coingeckoId ? x.ids.coingecko === ref.coingeckoId : true));
  if (!a) return null;
  return { key: a.key, price: sig(a.market.price, 6), marketCap: a.market.marketCap, change7d: round(a.market.change.d7, 1), change30d: round(a.market.change.d30, 1), athChangePct: round(a.market.athChangePct, 1), stage: r?.stageInfo.stage ?? null, cri: r?.cri ?? null };
}

function countBy(rows, key) {
  const out = {};
  for (const r of rows) out[r[key]] = (out[r[key]] ?? 0) + 1;
  return out;
}
