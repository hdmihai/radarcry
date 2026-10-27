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
 *   node src/main.js probe                          human-readable table
 *   node src/main.js probe --json                   machine-readable report on stdout
 *   node src/main.js probe --json-out probe.json    both: the table on stdout, the report in a file
 *   node src/main.js probe --gate probe.json        GitHub annotations + exit code from a report
 *
 * Every source ends in one of four verdicts, and only the last one fails the workflow:
 *
 *   ok       answered
 *   benign   not configured (an optional free key is absent) or switched off — expected
 *   limited  answered "not now": rate limit, quota, or a public node that will not serve a method to
 *            this address. A fact about the provider's capacity on a shared runner, not a breakage —
 *            reported as a warning with what would lift it
 *   broken   a keyless endpoint or a configured key stopped working: HTTP errors, invalid payloads,
 *            geo blocks, network failures that survive a second pass
 *
 * Shared runner addresses make single calls noisy, so every source that is not ok on the first pass
 * gets a second one after a pause, on a fresh client with one retry. The best of the two answers is
 * the verdict: a source that answered once in the last minute is not down.
 *
 * The probe never writes state and never publishes a snapshot.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { loadConfig, SECRETS } from '../src/config/load-config.js';
import { createLiveProviders } from '../src/main.js';
import { createTelemetry, silentLogger } from '../src/adapters/outbound/system/system.js';
import { PROVIDER_CATALOG } from '../src/application/use-cases/snapshot.js';

/** Long-lived contracts with a moderate holder base: any answer at all proves the endpoint. */
export const PROBE_TARGETS = Object.freeze({
  wbnb: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB on BSC
  // ORCA on Solana. Not USDC: `getTokenLargestAccounts` scans every token account of the mint, and a
  // mint with millions of accounts measures a node's patience, not whether it serves the method.
  solanaMint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
});

/** One small call per provider — the cheapest request that still proves the endpoint works. */
export function probes(P) {
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
    { id: 'gate_alpha', run: () => P.gateAlpha.markets() },
    { id: 'dexscreener', run: () => P.dexscreener.boosts() },
    { id: 'geckoterminal', run: () => P.geckoterminal.trendingPools() },
    { id: 'goplus', run: () => P.goplus.security('bsc', [PROBE_TARGETS.wbnb]) },
    { id: 'nodereal', run: () => P.nodereal.tokenHolders('bsc', PROBE_TARGETS.wbnb, { decimals: 18, top: 10 }) },
    { id: 'solana_rpc', run: () => P.solanaRpc.tokenHolders(PROBE_TARGETS.solanaMint) },
    { id: 'defillama', run: () => P.defillama.protocols() },
    { id: 'alternative_me', run: () => P.sentiment.fearGreed(7) },
    { id: 'cryptoquant', run: () => P.cryptoquant.series('btcPriceUsd', { days: 7 }) },
    { id: 'github', run: () => P.github.repo('bitcoin', 'bitcoin') },
    { id: 'youtube', run: () => P.youtube.mentions({ symbol: 'BTC', name: 'Bitcoin', days: 7, max: 5 }) },
    { id: 'arkham', run: () => P.arkham.addresses([PROBE_TARGETS.wbnb], { max: 1 }) },
  ];
}

export const VERDICT = Object.freeze({ OK: 'ok', BENIGN: 'benign', LIMITED: 'limited', BROKEN: 'broken' });
const BENIGN = new Set(['NOT_CONFIGURED', 'SKIPPED']);
const LIMITED = new Set(['RATE_LIMITED', 'QUOTA_EXHAUSTED', 'CIRCUIT_OPEN', 'BUDGET_EXHAUSTED']);
const RANK = { ok: 0, benign: 1, limited: 2, broken: 3 };

/** The verdict of one ProviderResult status. */
export function probeVerdict(status) {
  if (status === 'OK') return VERDICT.OK;
  if (BENIGN.has(status)) return VERDICT.BENIGN;
  if (LIMITED.has(status)) return VERDICT.LIMITED;
  return VERDICT.BROKEN;
}

const recordsOf = (data) => {
  if (Array.isArray(data)) return data.length;
  if (data instanceof Map) return data.size;
  if (data && Array.isArray(data.holders)) return data.holders.length;
  if (data && typeof data === 'object') return Object.keys(data).length;
  return null;
};

async function runOne(probe) {
  const t0 = Date.now();
  let res;
  try {
    res = await probe.run();
  } catch (err) {
    res = { ok: false, status: 'NETWORK_ERROR', data: null, message: String(err?.message ?? err), meta: {} };
  }
  return {
    ok: Boolean(res.ok),
    status: res.status,
    verdict: probeVerdict(res.status),
    httpStatus: res.meta?.httpStatus ?? null,
    latencyMs: res.meta?.latencyMs ?? Date.now() - t0,
    units: res.meta?.units ?? null,
    records: res.ok ? recordsOf(res.data) : null,
    message: res.message ?? '',
    via: res.meta?.endpoint ?? null,
  };
}

/**
 * The verdict for SOLANA_RPC_URL itself, from the diagnosis of the account node: a configured key
 * that is refused is a finding the operator must act on, even when public nodes covered for it.
 */
export function accountRow(solana) {
  const account = solana?.account ?? null;
  if (!account) return null;
  const node = (solana.nodes ?? []).find((n) => n.keyed) ?? null;
  const base = { id: 'solana_rpc_account', label: 'SOLANA_RPC_URL', plan: 'cont gratuit (ex. Helius Free)', keyed: true, needsKey: false, signup: null, unlocks: null, attempts: 1, firstStatus: null, httpStatus: null, latencyMs: null, units: null, records: null, via: null };
  if (account.invalid) return { ...base, ok: false, status: 'INVALID_PAYLOAD', verdict: VERDICT.BROKEN, message: account.invalid };
  const m = node?.methods?.getTokenLargestAccounts ?? node?.methods?.getTokenSupply ?? null;
  if (!m) return null;
  const verdict = probeVerdict(m.status === 'UNSUPPORTED' ? 'HTTP_ERROR' : m.status);
  return { ...base, ok: m.status === 'OK', status: m.status === 'UNSUPPORTED' ? 'HTTP_ERROR' : m.status, verdict, httpStatus: m.httpStatus, latencyMs: m.latencyMs, records: m.records, message: m.message || `${account.label}: getTokenLargestAccounts servit` };
}

/**
 * Run every probe, then a second pass for whatever was not ok. Pure orchestration: the provider
 * factory, the pause and the key table come in, so the logic is testable without a network.
 *
 * @param {{makeProviders:(pass:1|2)=>any, keyed?:Record<string,boolean>, settleMs?:number, sleepFn?:(ms:number)=>Promise<void>, now?:()=>string}} o
 */
export async function runProbes({ makeProviders, keyed = {}, settleMs = 15_000, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date().toISOString() }) {
  const P1 = makeProviders(1);
  const list = probes(P1);
  const rows = [];
  for (const probe of list) {
    const info = PROVIDER_CATALOG[probe.id] ?? { label: probe.id, role: '', plan: '' };
    const secret = SECRETS.find((s) => s.key === probe.id);
    rows.push({
      id: probe.id,
      label: info.label,
      plan: info.plan,
      keyed: Boolean(keyed[probe.id]),
      // A secret with a keyless fallback (SOLANA_RPC_URL) is an upgrade, not a requirement.
      needsKey: Boolean(secret) && !secret.fallback,
      optionalKey: secret?.env ?? null,
      signup: secret?.signup ?? null,
      unlocks: secret?.unlocks ?? null,
      attempts: 1,
      firstStatus: null,
      ...(await runOne(probe)),
    });
  }

  const retry = rows.filter((r) => r.verdict === VERDICT.LIMITED || r.verdict === VERDICT.BROKEN);
  if (retry.length) {
    if (settleMs > 0) await sleepFn(settleMs);
    const second = new Map(probes(makeProviders(2)).map((p) => [p.id, p]));
    for (const row of retry) {
      const again = await runOne(second.get(row.id));
      const firstStatus = row.status;
      if (RANK[again.verdict] <= RANK[row.verdict]) Object.assign(row, again);
      row.attempts = 2;
      row.firstStatus = firstStatus;
    }
  }

  // Which Solana node serves which method from this machine — the pool's own view of the network.
  let solana = null;
  if (P1.solanaRpc?.diagnose) {
    try {
      solana = { ...(P1.solanaRpc.describe?.() ?? {}), nodes: await P1.solanaRpc.diagnose(PROBE_TARGETS.solanaMint) };
    } catch (err) {
      solana = { error: String(err?.message ?? err) };
    }
  }
  const acc = accountRow(solana);
  if (acc) rows.push(acc);

  const count = (v) => rows.filter((r) => r.verdict === v).length;
  return {
    at: now(),
    summary: { total: rows.length, working: count(VERDICT.OK), unconfigured: count(VERDICT.BENIGN), limited: count(VERDICT.LIMITED), broken: count(VERDICT.BROKEN) },
    rows,
    solana,
  };
}

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
/** One line per source, whatever a provider put in its error body. */
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const MARK = { ok: '✓', benign: '·', limited: '~', broken: '✗' };

/** The human-readable report. */
export function renderProbe(report) {
  const out = [];
  out.push('', `CRI Radar — verificarea surselor gratuite  (${report.at})`, '');
  out.push(`${pad('SURSĂ', 24)} ${pad('STARE', 18)} ${pad('HTTP', 5)} ${pad('ms', 6)} ${pad('ÎNREG.', 7)} MESAJ`);
  out.push('─'.repeat(112));
  for (const r of report.rows) {
    const again = r.attempts > 1 ? ` (a 2-a încercare; prima: ${r.firstStatus})` : '';
    out.push(`${pad(`${MARK[r.verdict] ?? '?'} ${r.label}`, 24)} ${pad(r.status, 18)} ${pad(r.httpStatus ?? '—', 5)} ${pad(r.latencyMs, 6)} ${pad(r.records ?? '—', 7)} ${oneLine(`${r.message ?? ''}${again}`).slice(0, 52)}`);
  }
  out.push('─'.repeat(112));
  const s = report.summary;
  out.push(`${s.working} funcționale · ${s.unconfigured} neconfigurate (opționale) · ${s.limited} limitate (avertisment) · ${s.broken} cu probleme`, '');

  const nodes = report.solana?.nodes ?? [];
  if (nodes.length) {
    out.push('Solana JSON-RPC — ce servește fiecare nod de pe această mașină:');
    for (const n of nodes) {
      if (n.invalid) { out.push(`  ✗ ${pad(n.label, 34)} ${n.invalid}`); continue; }
      const cell = (m) => {
        const x = n.methods?.[m];
        if (!x) return '—';
        return x.status === 'OK' ? `OK (${x.latencyMs ?? '?'} ms)` : `${x.status}${x.httpStatus && x.httpStatus !== 200 ? ` ${x.httpStatus}` : ''}`;
      };
      out.push(`  ${n.keyed ? '★' : ' '} ${pad(n.label, 34)} supply: ${pad(cell('getTokenSupply'), 18)} lista de deținători: ${cell('getTokenLargestAccounts')}`);
    }
    if (!nodes.some((n) => n.methods?.getTokenLargestAccounts?.status === 'OK')) {
      out.push('  Niciun nod nu servește acum getTokenLargestAccounts de aici. Un cont gratuit o deblochează:');
      out.push('  Helius Free (fără card) → URL-ul Mainnet RPC în secretul SOLANA_RPC_URL.');
    }
    out.push('');
  }

  const missing = report.rows.filter((r) => r.needsKey && !r.keyed);
  if (missing.length) {
    out.push('Chei gratuite neconfigurate — fiecare este opțională, iar absența ei nu rupe nimic:');
    for (const r of missing) {
      out.push(`  ${pad(r.optionalKey ?? r.id, 22)} ${r.plan}`);
      out.push(`  ${' '.repeat(22)} deblochează: ${r.unlocks}`);
      out.push(`  ${' '.repeat(22)} înscriere:   ${r.signup}`);
    }
    out.push('');
  }
  const limited = report.rows.filter((r) => r.verdict === VERDICT.LIMITED);
  if (limited.length) {
    out.push('Limitate pe această adresă (avertisment, nu eroare — scanarea le așteaptă sau le ocolește):');
    for (const r of limited) out.push(`  ${pad(r.label, 24)} ${r.status} ${oneLine(r.message)}`);
    out.push('');
  }
  const broken = report.rows.filter((r) => r.verdict === VERDICT.BROKEN);
  if (broken.length) {
    out.push('Surse cu probleme:');
    for (const r of broken) out.push(`  ${pad(r.label, 24)} ${r.status} ${oneLine(r.message)}`);
    out.push('', 'O sursă căzută nu oprește scanarea: factorii afectați devin „necunoscuți”, ceea ce scade',
      'încrederea și acoperirea, fără să conteze ca dovezi negative.', '');
  }
  return out.join('\n');
}

/** GitHub workflow-command escaping (data and property values). */
const escData = (s) => String(s ?? '').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * The workflow's verdict from a report: a warning per limited source, an error per broken one, and
 * exit code 1 only when something is broken.
 */
export function probeGate(report) {
  const lines = [];
  const rows = report?.rows ?? [];
  for (const r of rows.filter((x) => x.verdict === VERDICT.LIMITED)) lines.push(`::warning title=${escProp(r.label)}::${escData(`${r.status} ${oneLine(r.message)}`)}`);
  for (const r of rows.filter((x) => x.verdict === VERDICT.BROKEN)) lines.push(`::error title=${escProp(r.label)}::${escData(`${r.status} ${oneLine(r.message)}`)}`);
  const s = report?.summary ?? {};
  lines.push(`${s.working ?? 0}/${s.total ?? rows.length} surse funcționale · ${s.limited ?? 0} limitate · ${s.broken ?? 0} cu probleme`);
  return { code: rows.some((x) => x.verdict === VERDICT.BROKEN) ? 1 : 0, lines };
}

/** Live wiring: one call per provider, retries off on the first pass and one retry on the second. */
export async function probeSources({ root, json = false, jsonOut = null, gate = null, settleMs = 15_000 } = {}) {
  if (gate) {
    const report = JSON.parse(await readFile(gate, 'utf8'));
    const { code, lines } = probeGate(report);
    for (const l of lines) console.log(l);
    return code;
  }
  const { config, keys, keyed } = await loadConfig({ root });
  // No quota gate here: a probe is one call per provider and must report the real state even when a
  // plan is near its limit.
  const makeProviders = (pass) => createLiveProviders({
    config: {
      ...config,
      providers: Object.fromEntries(Object.entries(config.providers).map(([k, v]) => [k, { ...v, retries: pass === 1 ? 0 : 1, timeoutMs: Math.min(v.timeoutMs ?? 15_000, 15_000) }])),
    },
    keys,
    telemetry: createTelemetry(),
    logger: silentLogger,
    deadlineMs: null,
    gate: null,
  });
  const report = await runProbes({ makeProviders, keyed, settleMs });
  if (jsonOut) await writeFile(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderProbe(report));
  return report.summary.broken ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('probe-sources.js')) {
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
  };
  probeSources({ root, json: process.argv.includes('--json'), jsonOut: arg('--json-out'), gate: arg('--gate') })
    .then((code) => { process.exitCode = code; });
}
