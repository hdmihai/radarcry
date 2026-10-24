/**
 * Use-case: collect deep evidence for the shortlist, within the run's time, rate and **quota**
 * budgets. Independent providers run concurrently; each provider is paced by the HTTP adapter and
 * charged against the free-plan ledger, so a run never pushes a free tier past 95 %.
 *
 *   candles      MEXC 1D/4H → Binance public mirror → CoinGecko daily (in that order of quality)
 *   liquidity    DexScreener (keyless)
 *   security     GoPlus Free
 *   holders      NodeReal Free (EVM) → Solana public RPC → GeckoTerminal (coarse)
 *   entities     Arkham Intel API (optional key) for the top holders of the best candidates
 *   fundamentals CoinGecko coin detail
 *   development  GitHub REST (free token)
 *   attention    YouTube Data API (free key, 100 units per search)
 */
import { chartToDaily } from '../../domain/similarity/references.js';
import { pickRepo } from '../../domain/shared/repos.js';

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

/** Stop pulling from a provider once it says the budget, the circuit or the quota is spent. */
const STOP = new Set(['BUDGET_EXHAUSTED', 'CIRCUIT_OPEN', 'QUOTA_EXHAUSTED', 'NOT_CONFIGURED', 'GEO_BLOCKED']);

/**
 * @param {any[]} shortlist assets ordered by priority (best light score first)
 * @param {any} P providers
 * @param {any} cfg deep config
 * @param {{timeLeft:()=>number, logger:any}} rt
 * @returns {Promise<{byKey: Map<string, any>, usage: Record<string, {calls:number, ok:number, lastStatus:string|null, lastMessage:string}>}>}
 */
export async function collectDeepData(shortlist, P, cfg, rt) {
  const out = new Map(shortlist.map((a) => [a.key, {}]));
  const enough = (ms = 45_000) => rt.timeLeft() > ms;
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

  /* ── candles ───────────────────────────────────────────────────────────────────────────────── */
  const klinesTask = async () => {
    const list = shortlist.filter((a) => a.venues?.mexcSpot || a.venues?.binanceSpot);
    await Promise.all(list.map(async (a) => {
      if (!enough(70_000)) return;
      const slot = out.get(a.key);
      // Binance's public data mirror is the deepest book; MEXC covers the long tail of small caps.
      const sources = [];
      if (a.venues?.binanceSpot) sources.push({ id: 'binance_spot', api: P.binanceSpot, symbol: a.venues.binanceSpot.symbol });
      if (a.venues?.mexcSpot) sources.push({ id: 'mexc', api: P.mexc, symbol: a.venues.mexcSpot.symbol });
      for (const s of sources) {
        if (!s.api?.klines) continue;
        const [d1, h4] = await Promise.all([
          s.api.klines(s.symbol, '1d', cfg.klines.d1Limit).then((r) => track(s.id, r)),
          s.api.klines(s.symbol, '4h', cfg.klines.h4Limit).then((r) => track(s.id, r)),
        ]);
        if (d1.ok && d1.data.length >= 30) { slot.d1 = d1.data; slot.d1Source = s.id; }
        if (h4.ok && h4.data.length >= 40) { slot.h4 = h4.data; slot.h4Source = s.id; }
        if (slot.d1 && slot.h4) break;
      }
    }));
  };

  const coingeckoTask = async () => {
    // Daily history fallback for assets with no centralised spot market at all.
    const noVenue = shortlist.filter((a) => !a.venues?.mexcSpot && !a.venues?.binanceSpot && a.ids.coingecko).slice(0, cfg.cgChartFallback);
    for (const a of noVenue) {
      if (!enough(90_000)) break;
      const r = track('coingecko', await P.coingecko.marketChart(a.ids.coingecko, 120));
      if (r.ok) {
        const slot = out.get(a.key);
        slot.d1 = chartToDaily(r.data).map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, closed: true }));
        slot.d1Source = 'coingecko';
      } else if (STOP.has(r.status)) break;
    }
    // Coin detail: categories (narratives), repo links (development), community metrics.
    for (const a of shortlist.filter((x) => x.ids.coingecko).slice(0, cfg.coinDetailLimit)) {
      if (!enough(80_000)) break;
      const r = track('coingecko', await P.coingecko.detail(a.ids.coingecko));
      if (r.ok) out.get(a.key).detail = r.data;
      else if (STOP.has(r.status)) break;
    }
  };

  /* ── liquidity and security ────────────────────────────────────────────────────────────────── */
  const dexTask = async () => {
    for (const [chain, list] of groupByChain(shortlist)) {
      if (!enough()) break;
      const r = track('dexscreener', await P.dexscreener.tokens(chain, list.map((a) => a.primary.address)));
      if (!r.ok) continue;
      for (const a of list) {
        const d = r.data[a.primary.address];
        if (d) out.get(a.key).dex = d;
      }
    }
  };

  const securityTask = async () => {
    const list = shortlist.filter((a) => a.primary?.address).slice(0, cfg.securityLimit);
    for (const [chain, group] of groupByChain(list)) {
      if (!enough()) break;
      const r = track('goplus', await P.goplus.security(chain, group.map((a) => a.primary.address)));
      if (!r.ok) {
        if (STOP.has(r.status)) break;
        continue;
      }
      for (const a of group) {
        const s = r.data[a.primary.address];
        if (s) out.get(a.key).security = s;
      }
    }
  };

  /* ── holders: the core of the on-chain engine ──────────────────────────────────────────────── */
  const holdersTask = async () => {
    const list = shortlist.filter((a) => a.primary?.address).slice(0, cfg.holdersLimit);
    let noderealOpen = Boolean(P.nodereal);
    let solanaOpen = Boolean(P.solanaRpc);
    for (const a of list) {
      if (!enough(60_000)) break;
      const slot = out.get(a.key);
      const { chain, address } = a.primary;

      if (chain === 'solana' && solanaOpen) {
        const r = track('solana_rpc', await P.solanaRpc.tokenHolders(address));
        if (r.ok) { slot.holders = r.data; slot.holdersSource = 'solana_rpc'; continue; }
        if (STOP.has(r.status)) solanaOpen = false;
      } else if (noderealOpen) {
        const decimals = a.onchainMeta?.decimals ?? 18;
        const r = track('nodereal', await P.nodereal.tokenHolders(chain, address, { decimals, totalSupply: a.market?.circulating ?? null, top: 100 }));
        if (r.ok) { slot.holders = r.data; slot.holdersSource = 'nodereal'; continue; }
        if (STOP.has(r.status)) noderealOpen = false;
      }

      // Coarse fallback: GeckoTerminal reports a holder count and top-10 share, without addresses.
      const g = track('geckoterminal', await P.geckoterminal.tokenInfo(chain, address));
      if (g.ok) slot.holdersInfo = g.data;
      else if (STOP.has(g.status)) break;
    }
  };

  /** Entity intelligence for the largest holders of the very best candidates (optional key). */
  const entitiesTask = async () => {
    if (!P.arkham?.keyed) return;
    const list = shortlist.filter((a) => a.primary?.address).slice(0, cfg.arkhamAddressLimit ?? 20);
    for (const a of list) {
      if (!enough(70_000)) break;
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
    for (const a of shortlist.filter((x) => x.ids.coingecko).slice(0, cfg.arkhamLimit)) {
      if (!enough(60_000)) break;
      const r = track('arkham', await P.arkham.tokenFlows(a.ids.coingecko));
      if (r.ok) out.get(a.key).arkhamFlows = r.data;
      else if (STOP.has(r.status)) break;
    }
  };

  /* ── development and attention ─────────────────────────────────────────────────────────────── */
  const devTask = async () => {
    if (!P.github) return;
    let budget = cfg.githubLimit ?? 18;
    for (const a of shortlist) {
      if (budget <= 0 || !enough(60_000)) break;
      const slot = out.get(a.key);
      const parsed = pickRepo([...(slot.detail?.repos ?? []), a.links?.github, slot.detail?.github]);
      if (!parsed) continue;
      budget -= 1;
      const [meta, activity] = await Promise.all([
        P.github.repo(parsed.owner, parsed.repo).then((r) => track('github', r)),
        P.github.commitActivity(parsed.owner, parsed.repo).then((r) => track('github', r)),
      ]);
      if (meta.ok || activity.ok) {
        slot.dev = { repo: parsed, meta: meta.ok ? meta.data : null, activity: activity.ok ? activity.data : null };
      }
      if (STOP.has(meta.status) && STOP.has(activity.status)) break;
    }
  };

  const attentionTask = async () => {
    if (!P.youtube) return;
    let budget = cfg.youtubeLimit ?? 12;
    for (const a of shortlist) {
      if (budget <= 0 || !enough(60_000)) break;
      budget -= 1;
      const r = track('youtube', await P.youtube.mentions({ symbol: a.symbol, name: a.name, days: 30, max: 50 }));
      if (r.ok) out.get(a.key).mentions = r.data;
      else if (STOP.has(r.status)) break;
    }
  };

  /*
   * Development activity depends on the coin detail payload: CoinGecko's `links.repos_url` is where
   * the repository URL comes from, since market listings carry no links. Started side by side, the
   * dev task scanned the shortlist before the first detail had arrived, found no repository for
   * anyone and finished in a millisecond — which is how the first live run made zero GitHub calls.
   * The dependency is therefore expressed as a sequence, while everything else stays parallel.
   */
  const detailsThenDev = coingeckoTask().finally(() => devTask());
  const results = await Promise.allSettled([
    klinesTask(), detailsThenDev, dexTask(), securityTask(), holdersTask(), attentionTask(),
  ]);
  // Entity resolution needs the holder lists, so it runs after the first wave.
  const second = await Promise.allSettled([entitiesTask(), flowsTask()]);
  for (const r of [...results, ...second]) if (r.status === 'rejected') rt.logger?.warn?.(`deep research: o sarcină a eșuat (${r.reason?.message ?? r.reason})`);
  return { byKey: out, usage };
}
