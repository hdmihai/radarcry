/**
 * Configuration: config/default.json ← config/local.json (optional) ← environment variables ← CLI.
 *
 * Secrets are **only** read from the environment (GitHub Actions secrets in CI). Every secret in
 * this project is a free account key or a free trial key — there is no paid plan anywhere — and
 * every one of them is optional: a missing key downgrades a capability to UNKNOWN or to the
 * platform's free web link, and the run continues.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SECRETS } from '../domain/platforms/registry.js';

export { SECRETS };

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
  return out;
}

const int = (v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);


export async function loadConfig({ root, env = process.env, cli = {} }) {
  const read = async (name, fallback) => (existsSync(join(root, name)) ? JSON.parse(await readFile(join(root, name), 'utf8')) : fallback);
  let config = await read('config/default.json', {});
  config = deepMerge(config, await read('config/local.json', null));

  const envOver = {
    universe: { topN: int(env.CRI_TOP_N), minMarketCapUsd: int(env.CRI_MIN_MCAP), maxMarketCapUsd: int(env.CRI_MAX_MCAP), minVolume24hUsd: int(env.CRI_MIN_VOLUME) },
    deep: { limit: int(env.CRI_DEEP_LIMIT) },
    runtime: { maxMinutes: int(env.CRI_MAX_MINUTES) },
  };
  config = deepMerge(config, prune(envOver));
  config = deepMerge(config, prune({
    universe: { topN: int(cli.limit) },
    deep: { limit: int(cli.deep) },
    runtime: { maxMinutes: int(cli.maxMinutes) },
  }));
  validate(config);

  const references = await read('config/references.json', []);
  const catalysts = (await read('config/catalysts.json', { events: [] })).events ?? [];
  const labels = await read('config/labels/evm-labels.json', null);

  const keys = {
    coingecko: env.COINGECKO_API_KEY || env.COINGECKO_DEMO_API_KEY || null,
    coingeckoPlan: env.COINGECKO_PLAN === 'pro' ? 'pro' : 'demo',
    coinmarketcap: env.CMC_API_KEY || env.COINMARKETCAP_API_KEY || null,
    coinalyze: env.COINALYZE_API_KEY || null,
    cryptoquant: env.CRYPTOQUANT_API_KEY || null,
    nodereal: env.NODEREAL_API_KEY || null,
    youtube: env.YOUTUBE_API_KEY || null,
    github: env.GITHUB_TOKEN || env.GH_TOKEN || null,
    arkham: env.ARKHAM_API_KEY || null,
    // Optional base-URL override (default https://api.arkm.com); endpoint paths are mapped by the adapter.
    arkhamBase: env.ARKHAM_API_BASE || null,
  };

  /** Which providers are keyed this run — used by the quota gate and the parity benchmark. */
  const keyed = Object.fromEntries(SECRETS.map((s) => [s.key, Boolean(keys[s.key])]));

  return { config, references, catalysts, labels, keys, keyed, secrets: SECRETS };
}

function prune(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const p = typeof v === 'object' && !Array.isArray(v) ? prune(v) : v;
    if (typeof p === 'object' && p && !Array.isArray(p) && !Object.keys(p).length) continue;
    out[k] = p;
  }
  return out;
}

function validate(c) {
  const errs = [];
  const u = c.universe ?? {};
  if (!(u.topN > 0 && u.topN <= 5000)) errs.push('universe.topN trebuie să fie între 1 și 5000');
  if (!(u.minMarketCapUsd >= 0)) errs.push('universe.minMarketCapUsd trebuie să fie ≥ 0');
  if (!(u.maxMarketCapUsd > u.minMarketCapUsd)) errs.push('universe.maxMarketCapUsd trebuie să fie mai mare decât minMarketCapUsd');
  if (!(u.minVolume24hUsd >= 0)) errs.push('universe.minVolume24hUsd trebuie să fie ≥ 0');
  if (!(c.deep?.limit >= 0 && c.deep.limit <= 300)) errs.push('deep.limit trebuie să fie între 0 și 300');
  if (!(c.runtime?.maxMinutes > 0 && c.runtime.maxMinutes <= 120)) errs.push('runtime.maxMinutes trebuie să fie între 1 și 120');
  const cohort = c.trackRecord?.cohort ?? {};
  if (!(cohort.minOpportunity >= 0 && cohort.minOpportunity <= 100)) errs.push('trackRecord.cohort.minOpportunity trebuie să fie între 0 și 100');
  if (!(cohort.maxRisk >= 0 && cohort.maxRisk <= 100)) errs.push('trackRecord.cohort.maxRisk trebuie să fie între 0 și 100');
  for (const [name, q] of Object.entries(c.quotas ?? {})) {
    if (q.month !== undefined && !(q.month > 0)) errs.push(`quotas.${name}.month trebuie să fie pozitiv`);
    if (q.day !== undefined && !(q.day > 0)) errs.push(`quotas.${name}.day trebuie să fie pozitiv`);
  }
  if (errs.length) throw new Error(`Configurație invalidă: ${errs.join('; ')}`);
}
