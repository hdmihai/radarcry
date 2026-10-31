#!/usr/bin/env node
/**
 * COMPOSITION ROOT + CLI (inbound adapter).
 * The only place where concrete adapters are chosen and wired into the application core.
 *
 *   node src/main.js scan                      live scan → data/latest.json (+ state)
 *   node src/main.js scan --fixtures           offline DEMO scan (synthetic, deterministic)
 *   node src/main.js scan --fixtures --simulate-days 30   replay 30 days of DEMO history first
 *   node src/main.js probe                     check every free source and print what works
 *   node src/main.js serve --dir dist --port 8080          static preview of the dashboard
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { loadConfig, SECRETS } from './config/load-config.js';
import { createHttpClient } from './adapters/outbound/http/http-client.js';
import { createCoinGecko } from './adapters/outbound/providers/coingecko.js';
import { createCoinMarketCap } from './adapters/outbound/providers/coinmarketcap.js';
import { createCoinPaprika } from './adapters/outbound/providers/coinpaprika.js';
import {
  createBinanceAlpha, createBinanceSpot, createBitget, createBithumb,
  createGate, createGateAlpha, createHyperliquid, createMexc, createOkx, createUpbit,
} from './adapters/outbound/providers/exchanges.js';
import { createArkham, createDefiLlama, createDexScreener, createGeckoTerminal, createGoPlus } from './adapters/outbound/providers/onchain.js';
import { createCoinalyze } from './adapters/outbound/providers/coinalyze.js';
import { createSentiment } from './adapters/outbound/providers/sentiment.js';
import { createNodeReal, createSolanaRpc } from './adapters/outbound/providers/holders.js';
import { createGithub, createYouTube } from './adapters/outbound/providers/social.js';
import { createCryptoQuant } from './adapters/outbound/providers/cryptoquant.js';
import { createFsStateRepository } from './adapters/outbound/state/fs-state-repository.js';
import { createFsSnapshotPublisher } from './adapters/outbound/publishing/fs-snapshot-publisher.js';
import { createLogger, createTelemetry, fixedClock, systemClock } from './adapters/outbound/system/system.js';
import { createDemoMarket } from './adapters/outbound/fixtures/demo-market.js';
import { createFixtureProviders } from './adapters/outbound/fixtures/fixture-providers.js';
import { createLedgerGate, quotaPlan } from './domain/budget/quota.js';
import { runScan, UniverseUnavailableError } from './application/use-cases/run-scan.js';
import { NoSnapshotError, runPulse } from './application/use-cases/pulse.js';
import { startStaticServer } from './adapters/inbound/static-server.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const opts = { _: command };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else { opts[key] = next; i += 1; }
  }
  return opts;
}

/**
 * Wire live HTTP adapters. Every provider here is public or runs on a free account — the quota gate
 * keeps each free plan under 95 % of its published limit and pauses it before the plan is spent.
 */
export function createLiveProviders({ config, keys, telemetry, logger, deadlineMs, gate = null }) {
  const http = createHttpClient({ telemetry, logger, deadlineMs, gate });
  const p = config.providers;
  return {
    coingecko: createCoinGecko({ http, cfg: p.coingecko, apiKey: keys.coingecko }),
    coinmarketcap: createCoinMarketCap({ http, cfg: p.coinmarketcap, apiKey: keys.coinmarketcap }),
    coinpaprika: createCoinPaprika({ http, cfg: p.coinpaprika }),
    mexc: createMexc({ http, cfg: p.mexc, futuresCfg: p.mexc_futures }),
    binanceSpot: createBinanceSpot({ http, cfg: p.binance_spot }),
    gate: createGate({ http, cfg: p.gate }),
    bitget: createBitget({ http, cfg: p.bitget }),
    okx: createOkx({ http, cfg: p.okx }),
    hyperliquid: createHyperliquid({ http, cfg: p.hyperliquid }),
    coinalyze: createCoinalyze({ http, cfg: p.coinalyze, apiKey: keys.coinalyze }),
    upbit: createUpbit({ http, cfg: p.upbit }),
    bithumb: createBithumb({ http, cfg: p.bithumb }),
    binanceAlpha: createBinanceAlpha({ http, cfg: p.binance_alpha }),
    gateAlpha: createGateAlpha({ http, cfg: p.gate_alpha }),
    dexscreener: createDexScreener({ http, cfg: p.dexscreener }),
    geckoterminal: createGeckoTerminal({ http, cfg: p.geckoterminal }),
    goplus: createGoPlus({ http, cfg: p.goplus }),
    nodereal: createNodeReal({ http, cfg: p.nodereal, apiKey: keys.nodereal }),
    solanaRpc: createSolanaRpc({ http, cfg: p.solana_rpc, accountUrl: keys.solana_rpc }),
    defillama: createDefiLlama({ http, cfg: p.defillama }),
    sentiment: createSentiment({ http, cfg: p.alternative_me }),
    cryptoquant: createCryptoQuant({ http, cfg: p.cryptoquant, apiKey: keys.cryptoquant }),
    github: createGithub({ http, cfg: p.github, token: keys.github }),
    youtube: createYouTube({ http, cfg: p.youtube, apiKey: keys.youtube }),
    arkham: createArkham({ http, cfg: p.arkham, apiKey: keys.arkham, baseUrl: keys.arkhamBase ?? undefined }),
  };
}

async function scan(opts) {
  const logger = createLogger({ verbose: Boolean(opts.verbose) });
  const { config, references, catalysts, labels, winners, keys, keyed } = await loadConfig({ root: ROOT, cli: opts });
  const outDir = resolve(opts.out ?? process.env.CRI_OUT_DIR ?? join(ROOT, 'data'));
  const stateDir = resolve(opts.state ?? process.env.CRI_STATE_DIR ?? join(ROOT, '.cri-state'));
  // A replay starts from an empty state: time must only move forward inside a state directory.
  if (opts.fresh || (opts.fixtures && Number(opts.simulateDays ?? 0) > 0)) {
    await rm(stateDir, { recursive: true, force: true });
    logger.info(`stare resetată: ${stateDir}`);
  }
  const stateRepo = createFsStateRepository({ dir: stateDir, logger });
  const publisher = createFsSnapshotPublisher({ outDir, schemaPath: join(ROOT, 'schema', 'latest.schema.json'), logger });

  if (opts.fixtures) {
    const endMs = opts.at ? Date.parse(opts.at) : Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const market = createDemoMarket({ endMs });
    const simulateDays = Number(opts.simulateDays ?? 0);
    let result;
    for (let d = simulateDays; d >= 0; d -= 1) {
      const clock = fixedClock(endMs - d * 86_400_000);
      const telemetry = createTelemetry();
      const providers = createFixtureProviders({ market, clock });
      result = await runScan({
        clock,
        logger: d === 0 ? logger : quiet(logger),
        telemetry,
        providers,
        stateRepo,
        publisher,
        referencesConfig: references,
        manualCatalysts: catalysts,
        winnersSeed: winners,
        labels,
        keys: {},
        keyed: {},
        quotaGate: null,
        mode: 'fixture',
      }, config);
      if (d > 0 && d % 5 === 0) logger.info(`simulare DEMO: mai sunt ${d} zile`);
    }
    report(logger, result);
    return 0;
  }

  const clock = systemClock;
  const telemetry = createTelemetry();
  const deadlineMs = clock.now() + config.runtime.maxMinutes * 60_000 + 60_000;

  // The quota gate needs the stored ledger before the first call, so the state is read twice:
  // once here for the ledger, and once inside the use-case for the research memory.
  const stored = await stateRepo.load();
  const plan = quotaPlan(stored.ledger ?? {}, config.quotas ?? {}, clock.now(), { keyed });
  const quotaGate = createLedgerGate(plan, { limits: config.quotas ?? {}, ledger: stored.ledger ?? {}, nowMs: clock.now() });
  for (const w of plan.warnings) logger.warn(`cuotă: ${w}`);
  for (const p of plan.paused) logger.warn(`cuotă: ${p} este în pauză până la resetare`);

  const providers = createLiveProviders({ config, keys, telemetry, logger, deadlineMs, gate: quotaGate });
  logger.info(`chei gratuite configurate: ${SECRETS.map((s) => `${s.label} ${keys[s.key] ? '✓' : '—'}`).join(' · ')}`);
  try {
    const result = await runScan({
      clock, logger, telemetry, providers, stateRepo, publisher,
      referencesConfig: references, manualCatalysts: catalysts, winnersSeed: winners, labels,
      keys, keyed, quotaGate, mode: 'live',
    }, config);
    report(logger, result);
    return 0;
  } catch (err) {
    if (err instanceof UniverseUnavailableError) { logger.error(err.message); return 2; }
    throw err;
  }
}

/**
 * The 15-minute refresh. It reads the published snapshot, re-reads only the facts that move that
 * fast from keyless endpoints, and republishes. Nothing with a monthly quota is touched.
 */
async function pulse(opts) {
  const logger = createLogger({ verbose: Boolean(opts.verbose) });
  const { config, keys, keyed } = await loadConfig({ root: ROOT, cli: opts });
  const outDir = resolve(opts.out ?? process.env.CRI_OUT_DIR ?? join(ROOT, 'data'));
  const publisher = createFsSnapshotPublisher({ outDir, schemaPath: join(ROOT, 'schema', 'latest.schema.json'), logger });
  const reader = async () => {
    try {
      return JSON.parse(await readFile(join(outDir, 'latest.json'), 'utf8'));
    } catch {
      return null;
    }
  };
  const clock = systemClock;
  const telemetry = createTelemetry();
  const deadlineMs = clock.now() + (config.runtime.pulseMaxMinutes ?? 4) * 60_000 + 30_000;
  const providers = createLiveProviders({ config, keys, telemetry, logger, deadlineMs, gate: null });
  try {
    const result = await runPulse({ clock, logger, telemetry, providers, publisher, reader }, config);
    const s = result.summary;
    logger.info(`puls: ${s.updated} rânduri actualizate din ${s.prices} prețuri și ${s.perpSymbols} simboluri cu perpetue${s.coinalyze ? `, ${s.coinalyze} din Coinalyze` : ''}`);
    void keyed;
    return 0;
  } catch (err) {
    if (err instanceof NoSnapshotError) { logger.error(err.message); return 2; }
    throw err;
  }
}

function quiet(logger) {
  return { ...logger, info() {}, debug() {} };
}

function report(logger, result) {
  const s = result.summary;
  logger.info(`gata: ${s.eligible} eligibile · ${s.deep} cercetate în profunzime (prioritate ${s.priority ?? '—'}) · ${s.discovered ?? 0} analizate de motorul de descoperire`);
  logger.info(`candidați timpurii: ${s.earlyCandidates ?? 0} · răspund exact la întrebarea proiectului: ${s.answering ?? 0}`);
  if (s.futures) logger.info(`futures radar: ${s.futures.scanned} scanate, ${s.futures.graded} cu notă${s.futures.best ? ` · cel mai bun ${s.futures.best.symbol} ${s.futures.best.grade}` : ''}`);
  if (s.parity) logger.info(`paritate cu soluțiile comerciale: ${s.parity.achieved}% în această rulare (${s.parity.permanent}% permanent, ${s.parity.withKeys}% cu cheile gratuite opționale)`);
  logger.info(`sănătate ${s.overall} · ${(s.durationMs / 1000).toFixed(1)}s`);
}

const HELP = `CRI Radar 4.0 — Crypto Research Intelligence

Întrebarea la care răspunde proiectul:
  „Arată-mi proiectele mici unde se schimbă simultan mai multe lucruri importante,
   înainte ca mișcarea să devină evidentă, și spune-mi ce riscuri pot invalida această ipoteză."

Utilizare:
  node src/main.js scan [--fixtures] [--simulate-days N] [--at ISO] [--fresh] [--limit 1000]
                        [--deep 60] [--horizon 1000] [--futures-max 1000]
                        [--out data] [--state .cri-state] [--verbose]
  node src/main.js pulse [--out data]   reîmprospătează preț, funding și open interest peste ultimul snapshot
  node src/main.js probe [--json] [--json-out probe.json] [--settle 15]
                                        verifică fiecare sursă gratuită și raportează ce funcționează
  node src/main.js probe --gate probe.json
                                        avertismente/erori GitHub din raport; eșuează doar pe surse stricate
  node src/main.js serve [--dir dist] [--port 8080]

Chei opționale — toate gratuite, niciun abonament. Fără ele, capabilitatea devine UNKNOWN
(nu „negativ") sau rămâne disponibilă prin interfața web gratuită a platformei:
${SECRETS.map((s) => `  ${s.env.padEnd(22)} ${s.label} — ${s.plan}\n  ${''.padEnd(22)} deblochează: ${s.unlocks}\n  ${''.padEnd(22)} înscriere: ${s.signup}`).join('\n')}

Alte variabile: CRI_STATE_DIR, CRI_OUT_DIR, CRI_MAX_MINUTES, CRI_TOP_N, CRI_MIN_MCAP, CRI_MAX_MCAP,
CRI_MIN_VOLUME, CRI_DEEP_LIMIT (prioritatea), CRI_DEEP_HORIZON (orizontul cercetat, implicit 1000),
CRI_FUTURES_MAX (instrumente în Futures Radar, implicit 1000)

Proiectul este exclusiv de research: nicio componentă nu plasează și nu transmite ordine.`;

async function main(argv) {
  const opts = parseArgs(argv);
  switch (opts._) {
    case 'scan':
      return scan(opts);
    case 'pulse':
      return pulse(opts);
    case 'probe': {
      const { probeSources } = await import('../scripts/probe-sources.js');
      const settle = Number(opts.settle);
      return probeSources({
        root: ROOT,
        json: opts.json === true,
        jsonOut: typeof opts.jsonOut === 'string' ? resolve(opts.jsonOut) : null,
        gate: typeof opts.gate === 'string' ? resolve(opts.gate) : null,
        settleMs: Number.isFinite(settle) && settle >= 0 ? settle * 1000 : 15_000,
      });
    }
    case 'serve': {
      const dir = resolve(opts.dir ?? join(ROOT, 'dist'));
      const port = Number(opts.port ?? 8080);
      await startStaticServer({ dir, port });
      console.log(`CRI Radar: http://localhost:${port}/  (servesc ${dir}; Ctrl+C pentru oprire)`);
      return new Promise(() => {});
    }
    default:
      console.log(HELP);
      return 0;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { if (typeof code === 'number') process.exitCode = code; }).catch((err) => {
    console.error(err?.stack ?? err);
    process.exitCode = 1;
  });
}
