/**
 * Filesystem state repository (outbound adapter for StateRepositoryPort).
 * One JSON file per concern, atomic writes (tmp + rename), bounded retention so the state
 * branch stays small forever. In GitHub Actions the directory lives on the `cri-state` branch.
 *
 * This state is the project's point-in-time memory: it is what makes "something changed" a
 * measurable statement rather than a guess, and it is why the engine never needs to look into the
 * future to decide what a signal was.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sig } from '../../../domain/shared/math.js';

const FILES = {
  history: 'history.json',
  discovery: 'discovery.json',
  flows: 'flows.json',
  registry: 'registry.json',
  journal: 'journal.json',
  cohort: 'cohort.json',
  references: 'references.json',
  catalysts: 'catalysts.json',
  telemetry: 'telemetry.json',
  ledger: 'quota-ledger.json',
  lastSeen: 'last-seen.json',
  lastSeenV4: 'last-seen-v4.json',
  // The rolling research cache (static facts + when each measurement was last refreshed).
  deepCache: 'deep-cache.json',
  meta: 'meta.json',
};

export const STATE_VERSION = 3;

/* Compact columnar codec for history points (serialisation concern of this adapter only). */
// New fields are appended at the end; decoding uses the field list stored in each file, so older states stay readable.
const H_FIELDS = ['t', 'price', 'mcap', 'turnover', 'rank', 'oiUsd', 'funding', 'cri', 'stage', 'signal', 'holders', 'watchlist', 'cgTrending', 'walletNet'];
const STAGE_CODE = { DECLINE: 'D', BASE: 'B', BUILDING: 'U', ACCELERATION: 'A', PRE_EXPANSION: 'P', EXPANSION: 'E', POST_EXPANSION: 'X', UNKNOWN: '?' };
const SIGNAL_CODE = { BUY_SETUP: 'S', ACCUMULATE: 'C', WATCH: 'W', LATE: 'L', AVOID: 'V', NONE: 'N' };
const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const STAGE_DECODE = invert(STAGE_CODE);
const SIGNAL_DECODE = invert(SIGNAL_CODE);

export function encodeHistory(history) {
  const out = { fields: H_FIELDS, assets: {} };
  for (const [key, h] of Object.entries(history ?? {})) {
    out.assets[key] = {
      l: Math.round(Date.parse(h.lastSeen) / 1000),
      p: (h.points ?? []).map((pt) => H_FIELDS.map((f) => {
        const v = pt[f];
        if (f === 't') return Math.round(Date.parse(v) / 1000);
        if (f === 'stage') return STAGE_CODE[v] ?? null;
        if (f === 'signal') return SIGNAL_CODE[v] ?? null;
        if (f === 'cgTrending') return v === true ? 1 : v === false ? 0 : null;
        return v ?? null;
      })),
    };
  }
  return out;
}

export function decodeHistory(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (!raw.fields || !raw.assets) return raw; // legacy object format
  const fields = raw.fields;
  const out = {};
  for (const [key, h] of Object.entries(raw.assets)) {
    out[key] = {
      lastSeen: new Date(h.l * 1000).toISOString(),
      points: (h.p ?? []).map((row) => {
        const pt = {};
        fields.forEach((f, i) => {
          const v = row[i];
          if (f === 't') pt.t = new Date(v * 1000).toISOString();
          else if (f === 'stage') pt.stage = STAGE_DECODE[v] ?? null;
          else if (f === 'signal') pt.signal = SIGNAL_DECODE[v] ?? null;
          else if (f === 'cgTrending') pt.cgTrending = v === 1 ? true : v === 0 ? false : null;
          else pt[f] = v;
        });
        return pt;
      }),
    };
  }
  return out;
}

/* ───────────────── discovery history: the per-asset norm the change engine compares against ──── */

/**
 * Columnar codec for the discovery history. The field list travels with the file, so adding a
 * tracked metric later — or reordering the list, as below — does not invalidate a state written by
 * an older version: the decoder always reads the order stored in the file it is given.
 *
 * Every eligible project stores a point each run (about 900 projects, up to ~50 points each), and
 * most of those points are market-level only. The metrics are therefore ordered market-first, so a
 * market-level point is a short row once its trailing nulls are trimmed, and values are kept to six
 * significant digits — far finer than any robust z-score or percentile can resolve.
 */
export const D_METRICS = [
  'price', 'marketCap', 'volume24h', 'turnover', 'circulating', 'oiUsd', 'fundingPct8h',
  'liquidityUsd', 'holders', 'holdersEffective', 'top10Pct', 'tvl', 'devCommits30d', 'mentions7d',
  'cexBalancePct', 'whaleBalancePct',
  // Who measured the sourced metrics (see SOURCED in domain/discovery/baseline.js). Appended, so a
  // state written before they existed still decodes: its readings come back as unsourced.
  'liquiditySource', 'holdersSource', 'top10Source',
];

/** One letter per provider for the source columns; anything unknown is stored verbatim. */
const SOURCE_CODE = { binance_alpha: 'A', dexscreener: 'D', geckoterminal: 'T', goplus: 'G', nodereal: 'N', solana_rpc: 'S', holder_list: 'L' };
const SOURCE_NAME = Object.fromEntries(Object.entries(SOURCE_CODE).map(([k, v]) => [v, k]));
const isSourceField = (name) => name.endsWith('Source');

const compactValue = (v) => (typeof v === 'number' && Number.isFinite(v) ? sig(v, 6) : v ?? null);
const encodeField = (name, v) => (isSourceField(name) && typeof v === 'string' ? SOURCE_CODE[v] ?? v : compactValue(v));
const decodeField = (name, v) => (isSourceField(name) && typeof v === 'string' ? SOURCE_NAME[v] ?? v : v ?? null);

/** Drop trailing nulls: the decoder reads a missing tail as null, so nothing is lost. */
function trimTail(values) {
  let end = values.length;
  while (end > 0 && values[end - 1] === null) end -= 1;
  return values.slice(0, end);
}
const D_VERDICT = ['stage', 'opportunity', 'risk', 'earliness', 'confidence', 'changes', 'families'];

export function encodeDiscovery(discovery) {
  const out = { metrics: D_METRICS, verdict: D_VERDICT, assets: {} };
  for (const [key, h] of Object.entries(discovery ?? {})) {
    out.assets[key] = {
      l: h.lastSeen ? Math.round(Date.parse(h.lastSeen) / 1000) : null,
      p: (h.points ?? []).map((pt) => {
        const m = trimTail(D_METRICS.map((name) => encodeField(name, pt.metrics?.[name])));
        const v = trimTail(D_VERDICT.map((name) => compactValue(pt.verdict?.[name])));
        return v.length ? [Math.round(pt.at / 1000), m, v] : [Math.round(pt.at / 1000), m];
      }),
    };
  }
  return out;
}

export function decodeDiscovery(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (!raw.assets) return raw;
  const metrics = raw.metrics ?? D_METRICS;
  const verdict = raw.verdict ?? D_VERDICT;
  const out = {};
  for (const [key, h] of Object.entries(raw.assets)) {
    out[key] = {
      lastSeen: h.l ? new Date(h.l * 1000).toISOString() : null,
      points: (h.p ?? []).map(([t, m, v]) => ({
        at: t * 1000,
        metrics: Object.fromEntries(metrics.map((name, i) => [name, decodeField(name, m?.[i])])),
        verdict: Object.fromEntries(verdict.map((name, i) => [name, v?.[i] ?? null])),
      })),
    };
  }
  return out;
}

/* ───────────────── holder-flow snapshots: address → [share, classCode] ──────────────────────── */

export function encodeFlows(flows) {
  const out = {};
  for (const [key, series] of Object.entries(flows ?? {})) {
    out[key] = (series ?? []).map((s) => ({
      t: Math.round(s.at / 1000),
      c: s.cexSharePct ?? null,
      x: s.top10Pct ?? null,
      // "address|share|class" keeps the file compact and human-inspectable.
      h: Object.entries(s.holders ?? {}).map(([addr, [share, cls]]) => `${addr}|${share}|${cls}`),
    }));
  }
  return out;
}

export function decodeFlows(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, series] of Object.entries(raw)) {
    if (!Array.isArray(series)) continue;
    out[key] = series.map((s) => {
      // Tolerate an already-decoded series (fixtures and tests pass the plain object through).
      if (s && typeof s.at === 'number' && s.holders && !Array.isArray(s.h)) return s;
      const holders = {};
      for (const row of s.h ?? []) {
        const [addr, share, cls] = String(row).split('|');
        if (!addr) continue;
        holders[addr] = [Number(share), cls];
      }
      return { at: (s.t ?? 0) * 1000, cexSharePct: s.c ?? null, top10Pct: s.x ?? null, holders };
    });
  }
  return out;
}

export function emptyState() {
  return {
    version: STATE_VERSION,
    history: {},
    discovery: {},
    flows: {},
    registry: null,
    journal: { entries: [] },
    cohort: [],
    references: { items: [], fetchedAt: null, configHash: null },
    catalysts: [],
    telemetry: [],
    ledger: {},
    lastSeen: {},
    lastSeenV4: {},
    deepCache: {},
    meta: { runs: 0, firstRunAt: null, lastRunAt: null },
  };
}

export function createFsStateRepository({ dir, logger = null }) {
  async function readJson(name, fallback) {
    try {
      return JSON.parse(await readFile(join(dir, name), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') logger?.warn?.(`state: nu pot citi ${name} (${err.message}) — pornesc de la zero pentru acest fișier`);
      return fallback;
    }
  }

  async function writeJson(name, value) {
    const path = join(dir, name);
    const tmp = `${path}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(value), 'utf8');
    await rename(tmp, path);
  }

  const ENCODE = { history: encodeHistory, discovery: encodeDiscovery, flows: encodeFlows };

  return {
    dir,
    async load() {
      const s = emptyState();
      for (const [key, file] of Object.entries(FILES)) s[key] = await readJson(file, s[key]);
      s.history = decodeHistory(s.history);
      s.discovery = decodeDiscovery(s.discovery);
      s.flows = decodeFlows(s.flows);
      if (!s.journal?.entries) s.journal = { entries: [] };
      if (!Array.isArray(s.cohort)) s.cohort = [];
      if (!s.references?.items) s.references = { items: [], fetchedAt: null, configHash: null };
      if (!s.ledger || typeof s.ledger !== 'object') s.ledger = {};
      if (!s.deepCache || typeof s.deepCache !== 'object' || Array.isArray(s.deepCache)) s.deepCache = {};
      return s;
    },
    async save(state) {
      await mkdir(dir, { recursive: true });
      for (const [key, file] of Object.entries(FILES)) {
        const encode = ENCODE[key];
        const value = encode ? encode(state[key]) : key === 'meta' ? { ...(state.meta ?? {}), stateVersion: STATE_VERSION } : state[key];
        await writeJson(file, value ?? null);
      }
    },
  };
}
