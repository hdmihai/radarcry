/**
 * Catalyst / event evidence (CRI v0.9.1 model): deterministic records with polarity, confidence,
 * provenance and time. Listing catalysts are detected by diffing venue registries between runs;
 * the first run only builds the baseline (no false "NEW" events).
 */
import { isNum } from '../shared/math.js';
import { DAY_MS, toMs } from '../shared/time.js';

export const CATALYST_TYPES = {
  NEW_PERP: { label: 'Listare perpetual (futures)', polarity: 'POSITIVE', confidence: 0.75 },
  NEW_MEXC_SPOT: { label: 'Listare spot MEXC', polarity: 'POSITIVE', confidence: 0.4 },
  NEW_BINANCE_SPOT: { label: 'Listare spot Binance', polarity: 'POSITIVE', confidence: 0.9 },
  NEW_UPBIT_KRW: { label: 'Listare Upbit (KRW)', polarity: 'POSITIVE', confidence: 0.9 },
  NEW_BITHUMB_KRW: { label: 'Listare Bithumb (KRW)', polarity: 'POSITIVE', confidence: 0.8 },
  NEW_BINANCE_ALPHA: { label: 'Intrare în Binance Alpha', polarity: 'POSITIVE', confidence: 0.7 },
  BINANCE_CEX_LISTING: { label: 'Alpha → listare Binance spot/futures', polarity: 'POSITIVE', confidence: 0.9 },
  ENTERED_TOP1000: { label: 'A intrat în top 1000', polarity: 'POSITIVE', confidence: 0.3 },
  RANK_JUMP: { label: 'Salt în clasamentul market cap', polarity: 'POSITIVE', confidence: 0.4 },
  VOLUME_SPIKE: { label: 'Explozie de volum (turnover)', polarity: 'POSITIVE', confidence: 0.45 },
  OI_SURGE: { label: 'Open interest în creștere rapidă', polarity: 'POSITIVE', confidence: 0.5 },
  FUNDING_FLIP_NEGATIVE: { label: 'Funding a devenit negativ (short-uri înghesuite)', polarity: 'POSITIVE', confidence: 0.45 },
  TRENDING_ENTRY: { label: 'A intrat în trending CoinGecko', polarity: 'NEUTRAL', confidence: 0.4 },
  KRW_WARNING: { label: 'Avertisment de investiție (exchange coreean)', polarity: 'NEGATIVE', confidence: 0.9 },
  UNLOCK: { label: 'Deblocare de tokeni', polarity: 'NEGATIVE', confidence: 0.8 },
  MANUAL: { label: 'Eveniment introdus manual', polarity: 'UNKNOWN', confidence: 0.6 },
};

export function makeEvent({ type, assetKey, symbol, observedAt, source, title, polarity, confidence, eventTime = null, details = null }) {
  const spec = CATALYST_TYPES[type] ?? CATALYST_TYPES.MANUAL;
  return {
    id: `${type}:${assetKey}:${eventTime ?? observedAt}`,
    type,
    assetKey,
    symbol,
    title: title ?? spec.label,
    polarity: polarity ?? spec.polarity,
    confidence: confidence ?? spec.confidence,
    observedAt,
    eventTime,
    source,
    details,
  };
}

/**
 * Build the current registry snapshot (what is listed where) from the attached venues.
 * Only venues whose provider succeeded are included, so an outage never looks like a delisting.
 */
export function buildRegistry(assets, okVenues) {
  const reg = { mexcSpot: {}, binanceSpot: {}, perps: {}, upbit: {}, bithumb: {}, alpha: {}, alphaCex: {}, universe: {} };
  for (const a of assets) {
    reg.universe[a.key] = true;
    if (okVenues.mexcSpot && a.venues?.mexcSpot) reg.mexcSpot[a.key] = true;
    if (okVenues.binanceSpot && a.venues?.binanceSpot) reg.binanceSpot[a.key] = true;
    for (const p of a.venues?.perps ?? []) {
      reg.perps[p.venue] ??= {};
      reg.perps[p.venue][a.key] = true;
    }
    if (okVenues.upbit && a.venues?.krw?.upbit) reg.upbit[a.key] = true;
    if (okVenues.bithumb && a.venues?.krw?.bithumb) reg.bithumb[a.key] = true;
    if (okVenues.alpha && a.venues?.alpha?.status === 'LISTED') {
      reg.alpha[a.key] = true;
      if (a.venues.alpha.listingCex) reg.alphaCex[a.key] = true;
    }
  }
  for (const venue of okVenues.perpVenues ?? []) reg.perps[venue] ??= {};
  return reg;
}

/**
 * Compare with the previous registry. `prev.seen[section]` stores first-seen timestamps so the
 * registry also works as a "listed since" ledger. Returns { events, next }.
 */
export function diffRegistry(prev, current, assetsByKey, nowMs, okVenues, { forgetDays = 10 } = {}) {
  const events = [];
  const nowIso = new Date(nowMs).toISOString();
  const seen = structuredClone(prev?.seen ?? {});
  const baselines = structuredClone(prev?.baselines ?? {});

  const section = (name, members, type, source, ok) => {
    if (!ok) return; // unknown this run: keep previous ledger untouched
    seen[name] ??= {};
    const isBaseline = !baselines[name];
    for (const key of Object.keys(members)) {
      const entry = seen[name][key];
      if (!entry) {
        seen[name][key] = [nowMs, nowMs]; // [firstSeenMs, lastSeenMs]
        const a = assetsByKey.get(key);
        if (!isBaseline && a && type) events.push(makeEvent({ type, assetKey: key, symbol: a.symbol, observedAt: nowIso, source }));
      } else if (Array.isArray(entry)) {
        entry[1] = nowMs;
      } else {
        seen[name][key] = [toMs(entry.first ?? entry) ?? nowMs, nowMs]; // migrate older formats
      }
    }
    // Forget only after a sustained absence: partial provider responses must not re-trigger "NEW" events.
    for (const [key, entry] of Object.entries(seen[name])) {
      const last = Array.isArray(entry) ? entry[1] : toMs(entry?.last ?? entry);
      if (!members[key] && (!isNum(last) || nowMs - last > forgetDays * DAY_MS)) delete seen[name][key];
    }
    baselines[name] = baselines[name] ?? nowIso;
  };

  section('mexcSpot', current.mexcSpot, 'NEW_MEXC_SPOT', 'mexc', okVenues.mexcSpot);
  section('binanceSpot', current.binanceSpot ?? {}, 'NEW_BINANCE_SPOT', 'binance_spot', okVenues.binanceSpot);
  for (const venue of Object.keys(current.perps)) {
    section(`perps:${venue}`, current.perps[venue], 'NEW_PERP', venue, (okVenues.perpVenues ?? []).includes(venue));
  }
  section('upbit', current.upbit, 'NEW_UPBIT_KRW', 'upbit', okVenues.upbit);
  section('bithumb', current.bithumb, 'NEW_BITHUMB_KRW', 'bithumb', okVenues.bithumb);
  section('alpha', current.alpha, 'NEW_BINANCE_ALPHA', 'binance_alpha', okVenues.alpha);
  section('alphaCex', current.alphaCex, 'BINANCE_CEX_LISTING', 'binance_alpha', okVenues.alpha);
  section('universe', current.universe, 'ENTERED_TOP1000', 'coingecko+coinmarketcap', okVenues.universe);

  for (const e of events) {
    if (e.type === 'NEW_PERP') e.title = `Listare perpetual pe ${e.source.toUpperCase()}`;
  }
  return { events, next: { seen, baselines, updatedAt: nowIso } };
}

/**
 * Change-based catalysts derived from the asset's own history (state), point-in-time.
 * @param {any} asset  with listing features (`lf`) attached
 * @param {{t:string, rankCmc?:number, turnover?:number, oiUsd?:number, funding?:number, cgTrending?:boolean}[]} history
 */
export function detectChangeEvents(asset, history, nowMs) {
  const out = [];
  if (!history?.length) return out;
  const nowIso = new Date(nowMs).toISOString();
  const last = history[history.length - 1];
  const weekAgo = [...history].reverse().find((h) => nowMs - toMs(h.t) >= 6 * DAY_MS) ?? history[0];
  const dayAgo = [...history].reverse().find((h) => nowMs - toMs(h.t) >= 20 * 3_600_000) ?? null;
  const lf = asset.lf ?? {};
  const base = { assetKey: asset.key, symbol: asset.symbol, observedAt: nowIso };

  const rankNow = asset.rank.cmc ?? asset.rank.coingecko;
  const rankThen = weekAgo?.rank;
  if (isNum(rankNow) && isNum(rankThen) && rankThen - rankNow >= Math.max(60, rankThen * 0.15)) {
    out.push(makeEvent({ ...base, type: 'RANK_JUMP', source: 'history', title: `Urcare de ${rankThen - rankNow} poziții în ~7 zile`, details: { from: rankThen, to: rankNow } }));
  }
  const turnovers = history.slice(-8, -1).map((h) => h.turnover).filter(isNum);
  if (isNum(lf.turnover) && turnovers.length >= 3) {
    const avg = turnovers.reduce((s, x) => s + x, 0) / turnovers.length;
    if (avg > 0 && lf.turnover / avg >= 3 && lf.turnover >= 0.15) {
      out.push(makeEvent({ ...base, type: 'VOLUME_SPIKE', source: 'history', title: `Turnover x${(lf.turnover / avg).toFixed(1)} față de media recentă`, details: { now: lf.turnover, avg } }));
    }
  }
  if (dayAgo && isNum(lf.oiUsd) && isNum(dayAgo.oiUsd) && dayAgo.oiUsd > 0) {
    const ch = (lf.oiUsd / dayAgo.oiUsd - 1) * 100;
    if (ch >= 40 && lf.oiUsd >= 250_000) out.push(makeEvent({ ...base, type: 'OI_SURGE', source: 'history', title: `Open interest +${ch.toFixed(0)}% în ~24h`, details: { changePct: ch } }));
  }
  if (isNum(lf.fundingAvg) && isNum(last?.funding) && last.funding > 0 && lf.fundingAvg <= -0.0002) {
    out.push(makeEvent({ ...base, type: 'FUNDING_FLIP_NEGATIVE', source: 'history', details: { from: last.funding, to: lf.fundingAvg } }));
  }
  if (asset.attention?.cgTrending === true && last && last.cgTrending === false) {
    out.push(makeEvent({ ...base, type: 'TRENDING_ENTRY', source: 'coingecko' }));
  }
  if (asset.venues?.krw?.warning) {
    out.push(makeEvent({ ...base, type: 'KRW_WARNING', source: 'upbit', title: `Avertisment KRW: ${asset.venues.krw.warning}` }));
  }
  return out;
}

/**
 * Manual research notebook entries (config/catalysts.json): unlocks, mainnets, TGEs, etc.
 * Upcoming events within `aheadDays` and past events within `pastDays` are kept.
 */
export function manualEvents(entries, assetsBySymbol, nowMs, { aheadDays = 30, pastDays = 14 } = {}) {
  const out = [];
  for (const e of entries ?? []) {
    const t = toMs(e.date);
    if (!isNum(t)) continue;
    if (t > nowMs + aheadDays * DAY_MS || t < nowMs - pastDays * DAY_MS) continue;
    const a = e.key ? null : assetsBySymbol.get(String(e.symbol ?? '').toUpperCase());
    const assetKey = e.key ?? a?.key;
    if (!assetKey) continue;
    out.push(makeEvent({
      type: e.type && CATALYST_TYPES[e.type] ? e.type : 'MANUAL',
      assetKey,
      symbol: (e.symbol ?? a?.symbol ?? '').toUpperCase(),
      observedAt: new Date(nowMs).toISOString(),
      eventTime: new Date(t).toISOString(),
      source: e.source ?? 'manual',
      title: e.title,
      polarity: e.polarity,
      confidence: isNum(e.confidence) ? e.confidence : undefined,
    }));
  }
  return out;
}

/**
 * Catalyst domain value from recent events: exponential time-decay (half-life 7 days).
 * No events → null (UNKNOWN, never bearish).
 */
export function catalystBalance(events, nowMs, halfLifeDays = 7) {
  if (!events?.length) return null;
  let pos = 0;
  let neg = 0;
  for (const e of events) {
    const t = toMs(e.eventTime ?? e.observedAt) ?? nowMs;
    const ageD = Math.abs(nowMs - t) / DAY_MS;
    const w = (e.confidence ?? 0.5) * 0.5 ** (ageD / halfLifeDays);
    if (e.polarity === 'POSITIVE') pos += w;
    else if (e.polarity === 'NEGATIVE') neg += w;
  }
  if (pos === 0 && neg === 0) return null;
  return { positive: pos, negative: neg, score: Math.max(0, Math.min(100, 50 + 28 * pos - 35 * neg)) };
}
