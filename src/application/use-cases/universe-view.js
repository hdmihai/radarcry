/**
 * The whole research horizon in one compact table — published as data/universe.json.
 *
 * The dashboard contract (latest.json) carries the top of each ranking with its full evidence: the
 * early candidates, the simultaneous changes, the best setups. This file carries *every* project
 * the run researched — all eligible projects of the top-1000 universe plus the exchange Alpha
 * lists, and every perpetual market of the Futures Radar — one row each, as arrays under a field
 * list, so a thousand rows stay a few hundred kilobytes and the main page does not have to load
 * them to open.
 *
 * Nothing is computed here: every value already exists in a domain result; this only selects,
 * rounds and encodes.
 */
import { isNum, round, sig } from '../../domain/shared/math.js';
import { VALIDITY_CODE, validityWhy } from './validity.js';

export const UNIVERSE_SCHEMA_VERSION = '1.1.0';

export const ASSET_FIELDS = Object.freeze([
  'key', 'symbol', 'name', 'chain',
  'price', 'marketCap', 'volume24h', 'chg24h', 'chg7d', 'chg30d',
  'sources', 'alpha', 'spot', 'perps',
  'stage', 'band', 'opportunity', 'earliness', 'risk', 'confidence',
  'changes', 'families', 'simultaneous', 'answers', 'early',
  'cri', 'signal', 'analog', 'analogSim',
  'futGrade', 'futScore',
  'holders', 'liquidityUsd', 'top10Eff', 'baseline',
  'selectedBy', 'detail',
  // The validity gate: V verified · P pending (evidence missing) · R rejected; why; warnings count.
  'valid', 'validWhy', 'validWarn',
]);

export const FUTURES_FIELDS = Object.freeze([
  'key', 'symbol', 'name', 'grade', 'score', 'confidence', 'trend', 'setup',
  'fundingPct8h', 'oiUsd', 'venues', 'price', 'chg24h', 'marketCap',
  'bias', 'entry', 'stop', 'target1', 'rr1', 'candles', 'reason', 'detail',
]);

const VALIDITY_GROUP = { VALID: 0, PENDING: 1, REJECTED: 2 };
const SOURCE_CODE = { coingecko: 'CG', coinmarketcap: 'CMC', coinpaprika: 'CP', binance_alpha: 'BA', gate_alpha: 'GA' };
/** Centralised spot markets, one letter each: Binance, MEXC, Gate, OKX, biTget, Upbit, bitHumb. */
export const SPOT_CODE = Object.freeze({ binance: 'B', mexc: 'M', gate: 'G', okx: 'O', bitget: 'T', upbit: 'U', bithumb: 'H' });
const r2 = (x) => (isNum(x) ? round(x, 2) : null);
const int = (x) => (isNum(x) ? Math.round(x) : null);
const px = (x) => (isNum(x) ? sig(x, 6) : null);
const flag = (x) => (x ? 1 : 0);

/**
 * @param {{eligible:any[], researched:any[], ranked:any[], futuresRows:any[], published:{discovery:Map<string,'full'|'row'>, futures:Set<string>},
 *          selectedBy:(key:string)=>string, validity?:Map<string, any>|null, meta:{generatedAt:string, runId:string, mode:string}}} input
 */
export function universeTable({ eligible, researched, ranked, futuresRows, published, selectedBy, validity = null, meta }) {
  const legacy = new Map(researched.map((r) => [r.asset.key, r]));
  const disc = new Map(ranked.map((r, i) => [r.asset.key, { r, i }]));
  const fut = new Map(futuresRows.map((f) => [f.key, f]));

  // Verified projects first (only they enter the CRI lists), then those still pending, then the
  // rejected; inside each group the discovery order (the engine's own ranking), then the legacy
  // score for anything the discovery engine did not reach this run.
  const group = (a) => VALIDITY_GROUP[validity?.get(a.key)?.status] ?? 0;
  const order = [...eligible].sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    const da = disc.get(a.key)?.i ?? Infinity;
    const db = disc.get(b.key)?.i ?? Infinity;
    if (da !== db) return da - db;
    return (legacy.get(b.key)?.cri ?? -1) - (legacy.get(a.key)?.cri ?? -1);
  });

  const rows = order.map((a) => {
    const L = legacy.get(a.key);
    const D = disc.get(a.key)?.r ?? null;
    const F = fut.get(a.key) ?? null;
    const v = D?.verdict ?? null;
    const oc = D?.asset?.onchain ?? null;
    const m = a.market ?? {};
    const spot = [
      a.venues?.binanceSpot ? SPOT_CODE.binance : null,
      a.venues?.mexcSpot ? SPOT_CODE.mexc : null,
      ...Object.keys(a.venues?.spot ?? {}).map((venue) => SPOT_CODE[venue] ?? null),
      a.venues?.krw?.upbit === true ? SPOT_CODE.upbit : null,
      a.venues?.krw?.bithumb === true ? SPOT_CODE.bithumb : null,
    ].filter(Boolean).join(',');
    const val = validity?.get(a.key) ?? null;
    const best = L?.analogs?.best ?? null;
    return [
      a.key, a.symbol, a.name, a.primary?.chain ?? null,
      px(m.price), int(m.marketCap), int(m.volume24h), r2(m.change?.h24), r2(m.change?.d7), r2(m.change?.d30),
      (a.sources ?? []).map((s) => SOURCE_CODE[s] ?? s).join(','),
      (a.venues?.alphaPrograms ?? []).map((p) => (p === 'binance' ? 'B' : p === 'gate' ? 'G' : p)).join(','),
      spot,
      (a.venues?.perps ?? []).length,
      v ? v.stage : null,
      v ? v.band : null,
      v ? r2(v.opportunity) : null,
      v ? v.earliness ?? null : null,
      v ? v.risk ?? null : null,
      v ? v.confidence ?? null : null,
      D ? D.changed.count : null,
      D ? D.changed.familyCount : null,
      D ? flag(D.changed.simultaneous) : null,
      v ? flag(v.answersQuestion) : null,
      v ? flag(v.earlyResearchCandidate) : null,
      L ? L.cri ?? null : null,
      L ? L.signal?.type ?? null : null,
      best ? best.ref ?? null : null,
      best ? int(best.similarity) : null,
      F ? F.grade?.grade ?? null : null,
      F ? r2(F.grade?.score) : null,
      oc ? oc.holders ?? null : null,
      oc ? int(oc.liquidityUsd) : null,
      oc ? r2(oc.top10EffectivePct) : null,
      D ? D.baseline?.points ?? null : null,
      D ? selectedBy(a.key) : null,
      published.discovery.get(a.key) ?? (L?.depth === 'deep' ? 'research' : 'table'),
      val ? VALIDITY_CODE[val.status] ?? null : null,
      val ? validityWhy(val) : null,
      val ? val.warnings.length : null,
    ];
  });

  const futures = futuresRows.map((f) => {
    const l = f.levels ?? null;
    return [
      f.key, f.symbol, f.name,
      f.grade?.grade ?? null, r2(f.grade?.score), f.grade?.confidence ?? null,
      f.trend?.regime ?? null, r2(f.setup?.score),
      isNum(f.positioning?.fundingPct8h) ? round(f.positioning.fundingPct8h, 5) : null,
      int(f.derivatives?.oiUsd),
      (f.derivatives?.venueNames ?? []).join(','),
      px(f.price), r2(f.change?.h24), int(f.marketCap),
      l?.bias ?? null, px(l?.entry), px(l?.stop), px(l?.target1), isNum(l?.rr1) ? round(l.rr1, 2) : null,
      f.candleSource ?? null,
      f.reason ?? null,
      published.futures.has(f.key) ? 'full' : 'table',
    ];
  });

  return {
    schemaVersion: UNIVERSE_SCHEMA_VERSION,
    generatedAt: meta.generatedAt,
    runId: meta.runId,
    mode: meta.mode,
    note: 'Fiecare proiect cercetat în această rulare, câte un rând. Dovezile complete (teza, invalidatorii, deținătorii clasificați) sunt publicate în data/latest.json pentru vârful fiecărui clasament; coloana „detail” spune unde se află: full = fișă completă, card = card cu factori, list = rând de listă, research = cercetat în profunzime, doar aici, table = doar date de piață. Coloana „valid”: V = verificat (intră în listele CRI), P = în verificare (lipsește o dovadă), R = respins (motivul în „validWhy”).',
    assets: { fields: [...ASSET_FIELDS], rows },
    futures: { fields: [...FUTURES_FIELDS], rows: futures },
  };
}

/**
 * Decode one table back into objects, with the engine's rank (1-based, publication order) — the
 * same shape the dashboard builds. Used by the tests and by anything reading the file in Node.
 */
export function decodeTable(table) {
  return (table?.rows ?? []).map((row, i) => ({ rank: i + 1, ...Object.fromEntries(table.fields.map((f, j) => [f, row[j]])) }));
}
