/**
 * HOLDER FLOWS — accumulation versus distribution, measured by comparing two classified snapshots
 * of the same holder list rather than by watching individual transfers (which needs a paid indexer).
 *
 * The verdict rule is the attachment's:
 *   ACCUMULATION requires at least 5 large wallets increasing their balance while the token is
 *   *not* seeing net deposits to centralised exchanges. Growth that arrives together with CEX
 *   deposits is not accumulation; it is positioning to sell.
 *
 * Flags are the things a researcher must see even when the overall verdict is neutral:
 *   TEAM_TO_CEX           — a project/treasury address sent to an exchange
 *   TEAM_TO_UNKNOWN       — a project/treasury address moved out to an unlabelled wallet
 *   REPEATED_DISTRIBUTION — the same large wallets have been shrinking across several runs
 *   NEW_WHALE             — a wallet that was not in the list is now a top holder
 *   FLAGGED_INFLOW        — a flagged address increased its position
 */
import { isNum, round } from '../shared/math.js';
import { HOLDER_CLASSES } from './labels.js';

/** Minimum share of supply for a holder to count as "large" in the accumulation test. */
export const LARGE_HOLDER_PCT = 0.5;
export const MIN_ACCUMULATING = 5;

export const VERDICT = {
  ACCUMULATION: 'ACCUMULATION',
  ACCUMULATING: 'ACCUMULATING',
  NEUTRAL: 'NEUTRAL',
  DISTRIBUTING: 'DISTRIBUTING',
  DISTRIBUTION: 'DISTRIBUTION',
  UNKNOWN: 'UNKNOWN',
};

export const VERDICT_LABEL_RO = {
  ACCUMULATION: 'acumulare confirmată',
  ACCUMULATING: 'semne de acumulare',
  NEUTRAL: 'fără direcție clară',
  DISTRIBUTING: 'semne de distribuție',
  DISTRIBUTION: 'distribuție confirmată',
  UNKNOWN: 'necunoscut (lipsesc două instantanee)',
};

/** Compact snapshot stored per run: address → [share, classCode]. Small enough for the state branch. */
export function flowSnapshot(classified, nowMs) {
  const entries = {};
  for (const h of classified?.holders ?? []) {
    if (!h.address || !isNum(h.share)) continue;
    entries[String(h.address).toLowerCase()] = [round(h.share, 4), h.class];
  }
  return {
    at: nowMs,
    cexSharePct: isNum(classified?.cexSharePct) ? round(classified.cexSharePct, 3) : null,
    top10Pct: isNum(classified?.top10Pct) ? round(classified.top10Pct, 3) : null,
    holders: entries,
  };
}

/** Keep a bounded series of snapshots per asset. */
export function appendFlowSnapshot(series, snapshot, { max = 24 } = {}) {
  const next = [...(series ?? []), snapshot].sort((a, b) => a.at - b.at);
  const seen = new Set();
  const out = [];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const k = Math.floor(next[i].at / 3_600_000); // one snapshot per hour at most
    if (seen.has(k)) continue;
    seen.add(k);
    out.unshift(next[i]);
  }
  return out.slice(-max);
}

/**
 * Compare the newest classified holder list against the stored history.
 *
 * @param {{current:any, history:any[], nowMs:number, minDeltaPct?:number}} input
 * @returns {{verdict:string, verdictLabel:string, accumulating:number, distributing:number,
 *   newWhales:number, exited:number, cexDeltaPct:number|null, top10DeltaPct:number|null,
 *   flags:string[], movers:any[], comparedAgainst:string|null, spanDays:number|null, note:string}}
 */
export function holderFlows({ current, history, nowMs, minDeltaPct = 0.05, minSpanHours = 20 }) {
  const snaps = (history ?? []).filter((s) => s && isNum(s.at) && s.at < nowMs).sort((a, b) => a.at - b.at);
  // Compare against a snapshot far enough back to be meaningful. A 15-minute pulse measured against
  // a 15-minute-old snapshot shows noise, not accumulation; the oldest available snapshot is used
  // when nothing yet reaches the window, so an early run still produces an honest reading.
  const spanMs = minSpanHours * 3_600_000;
  const aged = snaps.filter((s) => nowMs - s.at >= spanMs);
  const prev = aged.length ? aged[aged.length - 1] : snaps.length ? snaps[0] : null;
  if (!current || !prev) {
    return {
      verdict: VERDICT.UNKNOWN,
      verdictLabel: VERDICT_LABEL_RO.UNKNOWN,
      accumulating: null,
      distributing: null,
      newWhales: null,
      exited: null,
      cexDeltaPct: null,
      top10DeltaPct: null,
      flags: [],
      movers: [],
      comparedAgainst: prev ? new Date(prev.at).toISOString() : null,
      spanDays: null,
      note: 'este nevoie de două instantanee ale listei de deținători; primul a fost salvat acum',
    };
  }

  const flags = new Set();
  const movers = [];
  let accumulating = 0;
  let distributing = 0;
  let newWhales = 0;
  let exited = 0;

  const prevHolders = prev.holders ?? {};
  const currentByAddr = new Map();
  for (const h of current.holders ?? []) if (h.address) currentByAddr.set(String(h.address).toLowerCase(), h);

  for (const [addr, h] of currentByAddr) {
    if (!isNum(h.share)) continue;
    const before = prevHolders[addr]?.[0] ?? null;
    const delta = isNum(before) ? h.share - before : null;
    const large = h.share >= LARGE_HOLDER_PCT;

    if (before === null && large) {
      newWhales += 1;
      movers.push({ address: addr, class: h.class, label: h.label, share: round(h.share, 3), delta: null, kind: 'NOU' });
      if (h.class === HOLDER_CLASSES.FLAGGED) flags.add('FLAGGED_INFLOW');
      continue;
    }
    if (!isNum(delta) || Math.abs(delta) < minDeltaPct) continue;

    if (delta > 0) {
      if (large && h.sellable) accumulating += 1;
      if (h.class === HOLDER_CLASSES.CEX) flags.add('CEX_INFLOW');
      if (h.class === HOLDER_CLASSES.FLAGGED) flags.add('FLAGGED_INFLOW');
    } else if (large && h.sellable) {
      distributing += 1;
      if (h.class === HOLDER_CLASSES.PROJECT) flags.add('TEAM_OUTFLOW');
    }
    movers.push({
      address: addr,
      class: h.class,
      label: h.label,
      entity: h.entity ?? null,
      share: round(h.share, 3),
      delta: round(delta, 3),
      kind: delta > 0 ? 'CREȘTERE' : 'SCĂDERE',
    });
  }

  for (const [addr, v] of Object.entries(prevHolders)) {
    if (currentByAddr.has(addr)) continue;
    if ((v?.[0] ?? 0) >= LARGE_HOLDER_PCT) exited += 1;
  }

  const cexDelta = isNum(current.cexSharePct) && isNum(prev.cexSharePct) ? current.cexSharePct - prev.cexSharePct : null;
  const top10Delta = isNum(current.top10Pct) && isNum(prev.top10Pct) ? current.top10Pct - prev.top10Pct : null;
  const cexDepositing = isNum(cexDelta) && cexDelta > 0.3;
  const cexWithdrawing = isNum(cexDelta) && cexDelta < -0.3;

  // Team / treasury movements are read against the exchange direction.
  const projectShrinking = movers.some((m) => m.class === HOLDER_CLASSES.PROJECT && isNum(m.delta) && m.delta < -0.1);
  if (projectShrinking && cexDepositing) flags.add('TEAM_TO_CEX');
  else if (projectShrinking) flags.add('TEAM_TO_UNKNOWN');

  // Repeated distribution: large sellable holders shrinking in at least 3 of the last 4 snapshots.
  const recent = snaps.slice(-4);
  if (recent.length >= 3) {
    let shrinkRuns = 0;
    for (let i = 1; i < recent.length; i += 1) {
      const a = recent[i - 1].holders ?? {};
      const b = recent[i].holders ?? {};
      let down = 0;
      for (const [addr, v] of Object.entries(b)) {
        const before = a[addr]?.[0];
        if (isNum(before) && v?.[0] < before - minDeltaPct && v?.[0] >= LARGE_HOLDER_PCT) down += 1;
      }
      if (down >= 3) shrinkRuns += 1;
    }
    if (shrinkRuns >= 2) flags.add('REPEATED_DISTRIBUTION');
  }

  // The attachment's verdict rule.
  let verdict = VERDICT.NEUTRAL;
  if (accumulating >= MIN_ACCUMULATING && !cexDepositing) verdict = VERDICT.ACCUMULATION;
  else if (accumulating >= 3 && accumulating > distributing && !cexDepositing) verdict = VERDICT.ACCUMULATING;
  else if (distributing >= MIN_ACCUMULATING || (distributing >= 3 && cexDepositing)) verdict = VERDICT.DISTRIBUTION;
  else if (distributing > accumulating) verdict = VERDICT.DISTRIBUTING;
  if (cexWithdrawing && verdict === VERDICT.NEUTRAL && accumulating >= 2) verdict = VERDICT.ACCUMULATING;

  const spanDays = round((nowMs - prev.at) / 86_400_000, 2);
  return {
    verdict,
    verdictLabel: VERDICT_LABEL_RO[verdict],
    accumulating,
    distributing,
    newWhales,
    exited,
    cexDeltaPct: isNum(cexDelta) ? round(cexDelta, 3) : null,
    top10DeltaPct: isNum(top10Delta) ? round(top10Delta, 3) : null,
    flags: [...flags],
    movers: movers.sort((a, b) => Math.abs(b.delta ?? b.share) - Math.abs(a.delta ?? a.share)).slice(0, 12),
    comparedAgainst: new Date(prev.at).toISOString(),
    spanDays,
    note: `comparat cu instantaneul de acum ${spanDays} zile; pragul de „portofel mare” este ${LARGE_HOLDER_PCT}% din supply`,
  };
}
