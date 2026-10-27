/**
 * Use-case: collect deep evidence for the research universe, within the run's time, rate and
 * **quota** budgets. Independent providers run concurrently; each provider is paced by the HTTP
 * adapter and charged against the free-plan ledger, so a run never pushes a free tier past 95 %.
 *
 * Two tiers (see deep-cache.js for why):
 *
 *   EVERY eligible project, every run — bulk or high-limit sources
 *     candles      Binance public mirror → MEXC → Binance Alpha (official public klines) → CoinGecko daily
 *     liquidity    DexScreener (keyless, 30 contracts per call)
 *
 *   A rolling slice per run — free plans that answer a few dozen calls
 *     security     GoPlus Free             static facts cached 7 days, refreshed oldest-first
 *     fundamentals CoinGecko coin detail   static facts cached 14 days, refreshed oldest-first
 *     holders      GeckoTerminal token info, measured fresh, research priority first, then stalest
 *     development  GitHub REST (free token), measured fresh, same rotation
 *     attention    YouTube Data API (free key, 100 units per search), same rotation
 *
 *   The research priority only — need the same wallets on consecutive runs
 *     holder lists NodeReal Free (EVM) → Solana RPC pool (free-account URL first, then public nodes)
 *     entities     Arkham Intel API (optional key) for the top holders of the best candidates
 */
import { chartToDaily } from '../../domain/similarity/references.js';
import { pickRepo } from '../../domain/shared/repos.js';
import { DEFAULT_TTL_HOURS, cachedFact, lastMeasured, markMeasured, rotationOrder, storeFact } from './deep-cache.js';

function groupByChain(assets) {
  const m = new Map();
  for (const a of assets) {
    if (!a.primary?.address) continue;
    const list = m.get(a.primary.chain) ?? [];
    list.push(a);
    m.set(a.primary.chain, list);
  }
  return m;
}

/** Run `fn` over `items` with at most `n` in flight, stopping new work once `go()` says so. */
async function pool(items, n, go, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (!go()) return;
      const item = items[next];
      next += 1;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
}

/** Stop pulling from a provider once it says the budget, the circuit or the quota is spent. */
const STOP = new Set(['BUDGET_EXHAUSTED', 'CIRCUIT_OPEN', 'QUOTA_EXHAUSTED', 'NOT_CONFIGURED', 'GEO_BLOCKED']);

/**
 * @param {any[]} targets assets ordered by research priority (best first)
 * @param {any} P providers
 * @param {any} cfg deep config
 * @param {{timeLeft:()=>number, logger:any}} rt
 * @param {{priorityKeys?:Set<string>|null, cache?:Record<string, any>|null, nowMs?:number}} [opts]
 *   `priorityKeys` — the projects the run is about (the shortlist); the budgeted slices serve them
 *   first and the holder lists serve only them. Without it every target is priority, which is the
 *   behaviour of a small, explicit shortlist. `cache` — the rolling cache from the state branch;
 *   it is updated in place and returned.
 * @returns {Promise<{byKey: Map<string, any>, usage: Record<string, any>, cache: Record<string, any>, tiers: any}>}
 */
export async function collectDeepData(targets, P, cfg, rt, { priorityKeys = null, cache = null, nowMs = Date.now() } = {}) {
  const out = new Map(targets.map((a) => [a.key, {}]));
  const priority = priorityKeys ?? new Set(targets.map((a) => a.key));
  const memo = cache ?? {};
  const ttlHours = { ...DEFAULT_TTL_HOURS, ...(cfg.cacheHours ?? {}) };
  const enough = (ms = 45_000) => rt.timeLeft() > ms;
  // The budgeted slices come from free plans that rate-limit, and a rate-limited provider is now
  // waited for rather than abandoned. They stop early enough to leave the later phases (the futures
  // radar, the snapshot) their time, however slowly a provider answers on a given day.
  const reserveMs = (cfg.reserveSeconds ?? 240) * 1000;
  const budgeted = (ms = 45_000) => enough(Math.max(ms, reserveMs));
  const usage = {};
  const track = (provider, r) => {
    const u = (usage[provider] ??= { calls: 0, ok: 0, units: 0, lastStatus: null, lastMessage: '' });
    u.calls += 1;
    u.units += r?.meta?.units ?? 0;
    if (r?.ok) u.ok += 1;
    else {
      u.lastStatus = r?.status ?? 'NETWORK_ERROR';
      u.lastMessage = r?.message ?? '';
    }
    return r;
  };
  const tiers = { candles: 0, dex: 0, security: { fresh: 0, carried: 0 }, detail: { fresh: 0, carried: 0 }, holdersInfo: 0, holderLists: 0, dev: 0, mentions: 0 };
  const byPriority = (list) => [...list].sort((a, b) => Number(!priority.has(a.key)) - Number(!priority.has(b.key)));

  /* ── candles, for every project with a market that publishes them ─────────────────────────────── */
  const klinesTask = async () => {
    const sourcesOf = (a) => {
      const s = [];
      // Binance's public data mirror is the deepest book; MEXC covers the long tail of small caps;
      // Binance Alpha's own klines cover the Alpha tokens that have no centralised spot market yet.
      if (a.venues?.binanceSpot) s.push({ id: 'binance_spot', api: P.binanceSpot, symbol: a.venues.binanceSpot.symbol });
      if (a.venues?.mexcSpot) s.push({ id: 'mexc', api: P.mexc, symbol: a.venues.mexcSpot.symbol });
      if (a.venues?.alpha?.status === 'LISTED' && a.venues.alpha.alphaId && P.binanceAlpha?.klines) s.push({ id: 'binance_alpha', api: P.binanceAlpha, symbol: a.venues.alpha.alphaId });
      return s.filter((x) => x.api?.klines);
    };
    const closed = new Set();
    const one = async (a) => {
      const slot = out.get(a.key);
      for (const s of sourcesOf(a)) {
        if (closed.has(s.id)) continue;
        const [d1, h4] = await Promise.all([
          s.api.klines(s.symbol, '1d', cfg.klines.d1Limit).then((r) => track(s.id, r)),
          s.api.klines(s.symbol, '4h', cfg.klines.h4Limit).then((r) => track(s.id, r)),
        ]);
        if (d1.ok && d1.data.length >= 30) { slot.d1 = d1.data; slot.d1Source = s.id; }
        if (h4.ok && h4.data.length >= 40) { slot.h4 = h4.data; slot.h4Source = s.id; }
        if (STOP.has(d1.status) && STOP.has(h4.status)) closed.add(s.id);
        if (slot.d1 && slot.h4) break;
      }
      if (slot.d1) tiers.candles += 1;
    };
    // One small pool per first-choice source: each provider is paced on its own, so a queue of
    // Binance projects must not hold up the MEXC ones behind it.
    const lanes = new Map();
    for (const a of targets) {
      const first = sourcesOf(a)[0];
      if (!first) continue;
      if (!lanes.has(first.id)) lanes.set(first.id, []);
      lanes.get(first.id).push(a);
    }
    await Promise.all([...lanes.values()].map((list) => pool(list, cfg.klinesConcurrency ?? 3, () => enough(70_000), one)));
  };

  const coingeckoTask = async () => {
    // Daily history fallback for projects with no market that publishes candles: a rotating slice.
    const noVenue = targets.filter((a) => a.ids?.coingecko
      && !a.venues?.mexcSpot && !a.venues?.binanceSpot && !(a.venues?.alpha?.status === 'LISTED' && a.venues.alpha.alphaId && P.binanceAlpha?.klines));
    const charts = rotationOrder(noVenue, { priority, last: (a) => lastMeasured(memo, a.key, 'chart'), nowMs }).slice(0, cfg.cgChartFallback ?? 12);
    for (const a of charts) {
      if (!budgeted(90_000)) break;
      const r = track('coingecko', await P.coingecko.marketChart(a.ids.coingecko, 120));
      if (r.ok) {
        const slot = out.get(a.key);
        slot.d1 = chartToDaily(r.data).map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, closed: true }));
        slot.d1Source = 'coingecko';
        markMeasured(memo, a.key, 'chart', nowMs);
        tiers.candles += 1;
      } else if (STOP.has(r.status)) break;
    }
    // Coin detail: categories (narratives), repository links (development). Static, so carried.
    const withId = targets.filter((a) => a.ids?.coingecko);
    const stale = [];
    for (const a of withId) {
      const hit = cachedFact(memo, a.key, 'detail', { nowMs, ttlHours });
      if (hit) { out.get(a.key).detail = { ...hit.data, asOf: hit.at, carried: true }; tiers.detail.carried += 1; } else stale.push(a);
    }
    const refresh = rotationOrder(stale, { priority, last: (a) => memo[a.key]?.detail?.at ?? null, nowMs, minRefreshHours: 0 }).slice(0, cfg.coinDetailLimit ?? 25);
    for (const a of refresh) {
      if (!budgeted(80_000)) break;
      const r = track('coingecko', await P.coingecko.detail(a.ids.coingecko));
      if (r.ok) {
        out.get(a.key).detail = r.data;
        storeFact(memo, a.key, 'detail', r.data, nowMs);
        tiers.detail.fresh += 1;
      } else if (STOP.has(r.status)) break;
    }
  };

  /* ── liquidity and security ────────────────────────────────────────────────────────────────── */
  const dexTask = async () => {
    for (const [chain, list] of groupByChain(byPriority(targets))) {
      // DexScreener answers up to 30 contracts per call; the adapter batches.
      if (!enough()) break;
      const r = track('dexscreener', await P.dexscreener.tokens(chain, list.map((a) => a.primary.address)));
      if (!r.ok) {
        if (STOP.has(r.status)) break;
        continue;
      }
      for (const a of list) {
        const d = r.data[a.primary.address];
        if (d) { out.get(a.key).dex = d; tiers.dex += 1; }
      }
    }
  };

  const securityTask = async () => {
    const stale = [];
    for (const a of targets.filter((x) => x.primary?.address)) {
      const hit = cachedFact(memo, a.key, 'security', { nowMs, ttlHours });
      if (hit) { out.get(a.key).security = { ...hit.data, asOf: hit.at, carried: true }; tiers.security.carried += 1; } else stale.push(a);
    }
    const list = rotationOrder(stale, { priority, last: (a) => memo[a.key]?.security?.at ?? null, nowMs, minRefreshHours: 0 }).slice(0, cfg.securityLimit ?? 45);
    // GoPlus answers one contract per call; a chain's group is read in small parts so the time
    // budget is checked between them, not only once per chain — a rate-limited GoPlus waits out its
    // cooldowns now, and forty BSC contracts in one piece could otherwise run past the reserve.
    const chunk = Math.max(1, cfg.securityChunk ?? 10);
    let stop = false;
    for (const [chain, group] of groupByChain(list)) {
      for (let i = 0; i < group.length && !stop; i += chunk) {
        if (!budgeted()) { stop = true; break; }
        const part = group.slice(i, i + chunk);
        const r = track('goplus', await P.goplus.security(chain, part.map((a) => a.primary.address)));
        if (!r.ok) {
          if (STOP.has(r.status)) stop = true;
          continue;
        }
        for (const a of part) {
          const s = r.data[a.primary.address];
          if (!s) continue;
          out.get(a.key).security = s;
          storeFact(memo, a.key, 'security', s, nowMs);
          tiers.security.fresh += 1;
        }
      }
      if (stop) break;
    }
  };

  /* ── holders: full lists for the priority, counts for a rotating slice of everyone ─────────────── */
  const holderListTask = async () => {
    let noderealOpen = Boolean(P.nodereal);
    let solanaOpen = Boolean(P.solanaRpc);
    const list = targets.filter((a) => a.primary?.address && priority.has(a.key)).slice(0, cfg.holdersLimit ?? 45);
    for (const a of list) {
      if (!budgeted(60_000)) break;
      if (!noderealOpen && !solanaOpen) break;
      const slot = out.get(a.key);
      const { chain, address } = a.primary;
      if (chain === 'solana' && solanaOpen) {
        const r = track('solana_rpc', await P.solanaRpc.tokenHolders(address));
        if (r.ok) { slot.holders = r.data; slot.holdersSource = 'solana_rpc'; tiers.holderLists += 1; continue; }
        if (STOP.has(r.status)) solanaOpen = false;
      } else if (chain !== 'solana' && noderealOpen) {
        const decimals = a.onchainMeta?.decimals ?? 18;
        const r = track('nodereal', await P.nodereal.tokenHolders(chain, address, { decimals, totalSupply: a.market?.circulating ?? null, top: 100 }));
        if (r.ok) { slot.holders = r.data; slot.holdersSource = 'nodereal'; tiers.holderLists += 1; continue; }
        if (STOP.has(r.status)) noderealOpen = false;
      }
    }
  };

  // Coarse holder facts (count, top-10 share) from GeckoTerminal, for projects without a list this run.
  const holdersInfoTask = async () => {
    if (!P.geckoterminal?.tokenInfo) return;
    const candidates = targets.filter((a) => a.primary?.address && !out.get(a.key).holders);
    const list = rotationOrder(candidates, { priority, last: (a) => lastMeasured(memo, a.key, 'holdersInfo'), nowMs }).slice(0, cfg.holdersInfoLimit ?? cfg.holdersLimit ?? 45);
    for (const a of list) {
      if (!budgeted(60_000)) break;
      const g = track('geckoterminal', await P.geckoterminal.tokenInfo(a.primary.chain, a.primary.address));
      if (g.ok) {
        out.get(a.key).holdersInfo = g.data;
        markMeasured(memo, a.key, 'holdersInfo', nowMs);
        tiers.holdersInfo += 1;
      } else if (STOP.has(g.status)) break;
    }
  };

  /** Entity intelligence for the largest holders of the very best candidates (optional key). */
  const entitiesTask = async () => {
    if (!P.arkham?.keyed) return;
    const list = targets.filter((a) => a.primary?.address && priority.has(a.key)).slice(0, cfg.arkhamAddressLimit ?? 20);
    for (const a of list) {
      if (!budgeted(70_000)) break;
      const slot = out.get(a.key);
      const addresses = (slot.holders?.holders ?? []).slice(0, 15).map((h) => h.address).filter(Boolean);
      if (!addresses.length) continue;
      const r = track('arkham', await P.arkham.addresses(addresses, { max: 15 }));
      if (r.ok) slot.arkhamEntities = r.data;
      else if (STOP.has(r.status)) break;
    }
  };

  /** Token-level flow view from Arkham, when a key is present (adds entity-to-entity direction). */
  const flowsTask = async () => {
    if (!P.arkham?.keyed) return;
    for (const a of targets.filter((x) => x.ids?.coingecko && priority.has(x.key)).slice(0, cfg.arkhamLimit)) {
      if (!budgeted(60_000)) break;
      const r = track('arkham', await P.arkham.tokenFlows(a.ids.coingecko));
      if (r.ok) out.get(a.key).arkhamFlows = r.data;
      else if (STOP.has(r.status)) break;
    }
  };

  /* ── development and attention ─────────────────────────────────────────────────────────────── */
  const devTask = async () => {
    if (!P.github) return;
    const repoOf = (a) => {
      const slot = out.get(a.key);
      return pickRepo([...(slot.detail?.repos ?? []), a.links?.github, slot.detail?.github]);
    };
    const withRepo = targets.filter((a) => repoOf(a));
    const list = rotationOrder(withRepo, { priority, last: (a) => lastMeasured(memo, a.key, 'dev'), nowMs }).slice(0, cfg.githubLimit ?? 18);
    for (const a of list) {
      if (!budgeted(60_000)) break;
      const slot = out.get(a.key);
      const parsed = repoOf(a);
      const [meta, activity] = await Promise.all([
        P.github.repo(parsed.owner, parsed.repo).then((r) => track('github', r)),
        P.github.commitActivity(parsed.owner, parsed.repo).then((r) => track('github', r)),
      ]);
      if (meta.ok || activity.ok) {
        slot.dev = { repo: parsed, meta: meta.ok ? meta.data : null, activity: activity.ok ? activity.data : null };
        markMeasured(memo, a.key, 'dev', nowMs);
        tiers.dev += 1;
      }
      if (STOP.has(meta.status) && STOP.has(activity.status)) break;
    }
  };

  const attentionTask = async () => {
    if (!P.youtube) return;
    const list = rotationOrder(targets, { priority, last: (a) => lastMeasured(memo, a.key, 'mentions'), nowMs }).slice(0, cfg.youtubeLimit ?? 12);
    for (const a of list) {
      if (!budgeted(60_000)) break;
      const r = track('youtube', await P.youtube.mentions({ symbol: a.symbol, name: a.name, days: 30, max: 50 }));
      if (r.ok) {
        out.get(a.key).mentions = r.data;
        markMeasured(memo, a.key, 'mentions', nowMs);
        tiers.mentions += 1;
      } else if (STOP.has(r.status)) break;
    }
  };

  /*
   * Ordering constraints, everything else in parallel:
   *  · development needs the coin detail payload — CoinGecko's `links.repos_url` is where the
   *    repository comes from (started side by side, the dev task once found no repository for anyone
   *    and made zero GitHub calls);
   *  · GeckoTerminal's coarse holder facts serve the projects that got no full holder list.
   */
  const detailsThenDev = coingeckoTask().finally(() => devTask());
  const holders = holderListTask().finally(() => holdersInfoTask());
  const results = await Promise.allSettled([klinesTask(), detailsThenDev, dexTask(), securityTask(), holders, attentionTask()]);
  // Entity resolution needs the holder lists, so it runs after the first wave.
  const second = await Promise.allSettled([entitiesTask(), flowsTask()]);
  for (const r of [...results, ...second]) if (r.status === 'rejected') rt.logger?.warn?.(`deep research: o sarcină a eșuat (${r.reason?.message ?? r.reason})`);
  return { byKey: out, usage, cache: memo, tiers };
}
