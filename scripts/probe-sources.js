#!/usr/bin/env node
/**
 * PROBE — check every free source and report, per source, whether it answers *from this machine*.
 *
 * Why this exists: the project's whole premise is "public or free-account APIs only". That premise
 * has to be verifiable, not asserted. One command makes a single small call per provider and prints
 * what actually happened: HTTP status, latency, record count, and — when a key is missing — the
 * exact free signup step that would unlock it. It is also the fastest way to find out that a
 * provider has geo-blocked the runner, which otherwise shows up as a silently thinner scan.
 *
 *   node src/main.js probe              human-readable table
 *   node src/main.js probe --json       machine-readable, for CI
 *
 * The probe never writes state and never publishes a snapshot.
 */
import { loadConfig, SECRETS } from '../src/config/load-config.js';
import { createHttpClient } from '../src/adapters/outbound/http/http-client.js';
import { createLiveProviders } from '../src/main.js';
import { createTelemetry, silentLogger } from '../src/adapters/outbound/system/system.js';
import { PROVIDER_CATALOG } from '../src/application/use-cases/snapshot.js';

/** One small call per provider — the cheapest request that still proves the endpoint works. */
function probes(P) {
  return [
    { id: 'coingecko', run: () => P.coingecko.listTop(50) },
    { id: 'coinmarketcap', run: () => P.coinmarketcap.listTop(100) },
    { id: 'coinpaprika', run: () => P.coinpaprika.listTop(50) },
    { id: 'mexc', run: () => P.mexc.spotTickers() },
    { id: 'mexc_futures', run: () => P.mexc.perps() },
    { id: 'binance_spot', run: () => P.binanceSpot.spotTickers() },
    { id: 'gate', run: () => P.gate.perps() },
    { id: 'bitget', run: () => P.bitget.perps() },
    { id: 'okx', run: () => P.okx.perps() },
    { id: 'hyperliquid', run: () => P.hyperliquid.perps() },
    { id: 'coinalyze', run: () => P.coinalyze.markets() },
    { id: 'upbit', run: () => P.upbit.markets() },
    { id: 'bithumb', run: () => P.bithumb.markets() },
    { id: 'binance_alpha', run: () => P.binanceAlpha.markets() },
    { id: 'dexscreener', run: () => P.dexscreener.boosts() },
    { id: 'geckoterminal', run: () => P.geckoterminal.trendingPools() },
    // A well-known, long-lived contract: WBNB on BSC. Any answer at all proves the endpoint.
    { id: 'goplus', run: () => P.goplus.security('bsc', ['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c']) },
    { id: 'nodereal', run: () => P.nodereal.tokenHolders('bsc', '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', { decimals: 18, top: 10 }) },
    // USDC on Solana.
    { id: 'solana_rpc', run: () => P.solanaRpc.tokenHolders('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') },
    { id: 'defillama', run: () => P.defillama.protocols() },
    { id: 'alternative_me', run: () => P.sentiment.fearGreed(7) },
    { id: 'cryptoquant', run: () => P.cryptoquant.series('btcPriceUsd', { days: 7 }) },
    { id: 'github', run: () => P.github.repo('bitcoin', 'bitcoin') },
    { id: 'youtube', run: () => P.youtube.mentions({ symbol: 'BTC', name: 'Bitcoin', days: 7, max: 5 }) },
    { id: 'arkham', run: () => P.arkham.addresses(['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'], { max: 1 }) },
  ];
}

const OK = new Set(['OK']);
/** Statuses that mean "nothing is wrong, this is simply not configured / not needed". */
const BENIGN = new Set(['NOT_CONFIGURED', 'SKIPPED']);

const recordsOf = (data) => {
  if (Array.isArray(data)) return data.length;
  if (data instanceof Map) return data.size;
  if (data && typeof data === 'object') return Object.keys(data).length;
  return null;
};

export async function probeSources({ root, json = false } = {}) {
  const { config, keys, keyed } = await loadConfig({ root });
  const telemetry = createTelemetry();
  // No quota gate here: a probe is one call per provider and must report the real state even when a
  // plan is near its limit. Retries are off so a dead endpoint fails fast instead of back-off waiting.
  const providers = createLiveProviders({
    config: { ...config, providers: Object.fromEntries(Object.entries(config.providers).map(([k, v]) => [k, { ...v, retries: 0, timeoutMs: Math.min(v.timeoutMs ?? 15_000, 15_000) }])) },
    keys,
    telemetry,
    logger: silentLogger,
    deadlineMs: null,
    gate: null,
  });

  const rows = [];
  for (const probe of probes(providers)) {
    const info = PROVIDER_CATALOG[probe.id] ?? { label: probe.id, role: '', plan: '' };
    const t0 = Date.now();
    let res;
    try {
      res = await probe.run();
    } catch (err) {
      res = { ok: false, status: 'NETWORK_ERROR', data: null, message: String(err?.message ?? err), meta: {} };
    }
    const secret = SECRETS.find((s) => s.key === probe.id);
    rows.push({
      id: probe.id,
      label: info.label,
      plan: info.plan,
      keyed: Boolean(keyed[probe.id]),
      needsKey: Boolean(secret),
      signup: secret?.signup ?? null,
      unlocks: secret?.unlocks ?? null,
      ok: Boolean(res.ok),
      status: res.status,
      httpStatus: res.meta?.httpStatus ?? null,
      latencyMs: res.meta?.latencyMs ?? Date.now() - t0,
      units: res.meta?.units ?? null,
      records: res.ok ? recordsOf(res.data) : null,
      message: res.message ?? '',
    });
  }

  const working = rows.filter((r) => OK.has(r.status)).length;
  const unconfigured = rows.filter((r) => BENIGN.has(r.status)).length;
  const broken = rows.filter((r) => !OK.has(r.status) && !BENIGN.has(r.status));

  if (json) {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      summary: { total: rows.length, working, unconfigured, broken: broken.length },
      rows,
    }, null, 2));
    return broken.length ? 1 : 0;
  }

  const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
  console.log(`\nCRI Radar — verificarea surselor gratuite  (${new Date().toISOString()})\n`);
  console.log(`${pad('SURSĂ', 22)} ${pad('STARE', 18)} ${pad('HTTP', 5)} ${pad('ms', 6)} ${pad('ÎNREG.', 7)} MESAJ`);
  console.log('─'.repeat(110));
  for (const r of rows) {
    const mark = OK.has(r.status) ? '✓' : BENIGN.has(r.status) ? '·' : '✗';
    console.log(`${pad(`${mark} ${r.label}`, 22)} ${pad(r.status, 18)} ${pad(r.httpStatus ?? '—', 5)} ${pad(r.latencyMs, 6)} ${pad(r.records ?? '—', 7)} ${String(r.message ?? '').slice(0, 54)}`);
  }
  console.log('─'.repeat(110));
  console.log(`${working} surse funcționale · ${unconfigured} neconfigurate (opționale) · ${broken.length} cu probleme\n`);

  const missing = rows.filter((r) => r.needsKey && !r.keyed);
  if (missing.length) {
    console.log('Chei gratuite neconfigurate — fiecare este opțională, iar absența ei nu rupe nimic:');
    for (const r of missing) {
      const s = SECRETS.find((x) => x.key === r.id);
      console.log(`  ${pad(s?.env ?? r.id, 22)} ${r.plan}`);
      console.log(`  ${' '.repeat(22)} deblochează: ${r.unlocks}`);
      console.log(`  ${' '.repeat(22)} înscriere:   ${r.signup}`);
    }
    console.log('');
  }
  if (broken.length) {
    console.log('Surse cu probleme:');
    for (const r of broken) console.log(`  ${pad(r.label, 22)} ${r.status} ${r.message}`);
    console.log('\nO sursă căzută nu oprește scanarea: factorii afectați devin „necunoscuți”, ceea ce scade');
    console.log('încrederea și acoperirea, fără să conteze ca dovezi negative.\n');
  }
  return broken.length ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('probe-sources.js')) {
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  probeSources({ root, json: process.argv.includes('--json') }).then((code) => { process.exitCode = code; });
}
