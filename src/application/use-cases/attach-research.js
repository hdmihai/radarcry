/**
 * Use-case: attach Python research outputs to the published snapshot.
 *
 * The Python research engine (services/analyst-python/research) reads data/latest.json
 * and produces data/research/{momentum,liquidity}.json. This use-case merges them
 * under an optional `research` section, without touching the rest of the contract.
 *
 * Pure function — no I/O. Caller reads and writes; this only merges.
 * If research is absent (first run, Python failure, or not yet wired), returns snapshot
 * unchanged. `research` stays absent, never null (matches the `validity` / `forecast` pattern).
 */
export function attachResearch(snapshot, research) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  if (!research) return snapshot;
  const { momentum, liquidity } = research;
  if (momentum == null && liquidity == null) return snapshot;
  return {
    ...snapshot,
    research: {
      ...(momentum != null && { momentum }),
      ...(liquidity != null && { liquidity }),
    },
  };
}
