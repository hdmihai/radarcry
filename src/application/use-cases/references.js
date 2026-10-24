/**
 * Use-case: keep the LAB/BTW/AGT reference library fresh.
 * Daily history is fetched at most once per `refreshDays` (or when config/references.json changes);
 * in between, the computed fingerprints are reused from state — cheap on rate limits.
 */
import { createHash } from 'node:crypto';
import { buildReference } from '../../domain/similarity/references.js';
import { crossSimilarity } from '../../domain/similarity/engine.js';
import { DAY_MS, toMs } from '../../domain/shared/time.js';
import { namesMatch, normSymbol } from '../../domain/shared/symbols.js';
import { sig } from '../../domain/shared/math.js';

export function configHash(refs) {
  return createHash('sha256').update(JSON.stringify(refs)).digest('hex').slice(0, 16);
}

/**
 * @param {{items:any[], fetchedAt:string|null, configHash:string|null}} cached
 * @param {any[]} refsConfig
 * @param {import('../ports/index.js').HistoryPort|null} history
 */
export async function ensureReferences(cached, refsConfig, history, nowMs, cfg, logger) {
  const hash = configHash(refsConfig);
  const fresh = cached?.fetchedAt && nowMs - toMs(cached.fetchedAt) < cfg.refreshDays * DAY_MS && cached.configHash === hash;
  const allComputed = (cached?.items ?? []).length === refsConfig.length && cached.items.every((r) => r.status === 'COMPUTED');
  if (fresh && cached.items?.length && (allComputed || nowMs - toMs(cached.fetchedAt) < DAY_MS)) {
    return { items: cached.items, fetchedAt: cached.fetchedAt, configHash: hash, reused: true };
  }

  const items = [];
  for (const ref of refsConfig) {
    let chart = null;
    let coingeckoId = ref.coingeckoId ?? null;
    if (history && !coingeckoId) {
      const s = await history.search(ref.searchQuery ?? ref.symbol);
      if (s.ok) {
        const want = normSymbol(ref.symbol);
        const hits = s.data.filter((c) => normSymbol(c.symbol) === want);
        const named = hits.filter((c) => (ref.nameHints ?? [ref.name]).some((n) => namesMatch(n, c.name)));
        const pick = (named.length ? named : hits).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))[0];
        coingeckoId = pick?.id ?? null;
      }
    }
    if (history && coingeckoId) {
      const r = await history.marketChart(coingeckoId, 365);
      if (r.ok) chart = r.data;
      else logger?.warn?.(`referință ${ref.symbol}: istoric indisponibil (${r.status}) — folosesc estimarea statică`);
    }
    items.push(buildReference({ ...ref, coingeckoId }, chart, nowMs));
  }
  return { items, fetchedAt: new Date(nowMs).toISOString(), configHash: hash, reused: false };
}

export function referencesView(items, simCfg) {
  const matrix = crossSimilarity(items, simCfg);
  return items.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    chain: r.chain,
    status: r.status,
    statusNote: r.statusNote,
    coingeckoId: r.coingeckoId ?? null,
    anchorDate: r.anchorDate,
    outcome: r.outcome,
    outcomeNote: r.outcomeNote,
    tags: r.tags,
    sources: r.sources,
    raw: r.raw,
    vector: r.vector,
    sequence: r.sequence,
    // Contract convention: chart series use epoch SECONDS and 5 significant digits.
    window: r.window
      ? {
          from: r.window.from,
          to: r.window.to,
          closes: (r.window.closes ?? []).map(([t, c]) => [Math.round(toMs(t) / 1000), sig(c, 5)]),
          after: (r.window.after ?? []).map(([t, c]) => [Math.round(toMs(t) / 1000), sig(c, 5)]),
        }
      : null,
    crossSimilarity: matrix[r.symbol],
  }));
}
