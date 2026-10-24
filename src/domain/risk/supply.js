/**
 * SUPPLY PRESSURE — how much supply is still waiting to arrive, and when.
 *
 * Token unlock calendars are behind a subscription on every commercial provider (DefiLlama's
 * unlocks endpoint is Pro-only), so this module derives the same pressure from numbers that *are*
 * free: circulating versus total versus max supply, the FDV/MCAP ratio, the observed growth of
 * circulating supply across our own run history, and any unlock dates the operator has entered in
 * config/catalysts.json. Where a date is unknown, the pressure is reported as a rate rather than a
 * calendar — and labelled as such.
 */
import { isNum, round } from '../shared/math.js';
import { DAY_MS, ageDays, toMs } from '../shared/time.js';

/**
 * @param {{asset:any, points?:{at:number, metrics:any}[], unlocks?:{at:string, pctOfSupply?:number, note?:string}[], nowMs:number}} input
 */
export function supplyPressure({ asset, points = [], unlocks = [], nowMs }) {
  const m = asset.market ?? {};
  const circ = isNum(m.circulating) && m.circulating > 0 ? m.circulating : null;
  const total = isNum(m.total) && m.total > 0 ? m.total : null;
  const max = isNum(m.max) && m.max > 0 ? m.max : null;
  const denom = max ?? total;
  const floatRatio = circ && denom ? Math.min(1, circ / denom) : null;
  const fdvToMcap = isNum(m.fdv) && isNum(m.marketCap) && m.marketCap > 0 ? m.fdv / m.marketCap : null;

  // Observed emission: how fast has circulating supply actually grown in our own history?
  let inflationPctYear = null;
  let inflationBasis = null;
  const series = (points ?? [])
    .map((p) => ({ at: p.at, supply: p.metrics?.circulating ?? null }))
    .filter((p) => isNum(p.at) && isNum(p.supply) && p.supply > 0);
  if (series.length >= 2) {
    const first = series[0];
    const last = series[series.length - 1];
    const days = (last.at - first.at) / DAY_MS;
    if (days >= 5 && first.supply > 0) {
      const annual = round(((last.supply / first.supply) ** (365 / days) - 1) * 100, 2);
      // A shrinking circulating supply is burn or re-locking, not negative inflation: report it as 0
      // emission and say what was observed, so the supply factor is not credited twice.
      inflationPctYear = annual >= 0 ? annual : 0;
      inflationBasis = annual >= 0
        ? `observat pe ${round(days, 0)} zile din istoricul propriu`
        : `supply-ul circulant a scăzut cu ${round(Math.abs(annual), 1)}%/an pe ${round(days, 0)} zile observate (ardere sau re-blocare); emisiunea este raportată ca 0`;
    }
  }
  // Fallback: the gap still to be emitted, annualised over a conventional 4-year schedule.
  if (inflationPctYear === null && circ && denom && denom > circ) {
    const remaining = (denom - circ) / circ;
    inflationPctYear = round((remaining / 4) * 100, 2);
    inflationBasis = 'estimat din supply-ul rămas, presupunând un calendar de 4 ani (nu un calendar real)';
  }

  // Operator-entered unlock calendar (config/catalysts.json), the only reliable dated source we have.
  const dated = (unlocks ?? [])
    .map((u) => ({ at: toMs(u.at), pctOfSupply: isNum(u.pctOfSupply) ? u.pctOfSupply : null, note: u.note ?? null }))
    .filter((u) => isNum(u.at) && u.at > nowMs - 2 * DAY_MS)
    .sort((a, b) => a.at - b.at);
  const next = dated[0] ?? null;
  const within30 = dated.filter((u) => u.at - nowMs <= 30 * DAY_MS);
  const pct30 = within30.reduce((s, u) => s + (u.pctOfSupply ?? 0), 0);

  const warnings = [];
  if (isNum(floatRatio) && floatRatio < 0.3) warnings.push(`doar ${Math.round(floatRatio * 100)}% din supply este în circulație — restul poate ajunge pe piață`);
  if (isNum(fdvToMcap) && fdvToMcap >= 4) warnings.push(`FDV este ${round(fdvToMcap, 1)}× capitalizarea curentă`);
  if (isNum(inflationPctYear) && inflationPctYear > 30) warnings.push(`emisiune de ~${round(inflationPctYear, 0)}%/an (${inflationBasis})`);
  if (next) warnings.push(`deblocare programată pe ${new Date(next.at).toISOString().slice(0, 10)}${isNum(next.pctOfSupply) ? ` (~${next.pctOfSupply}% din supply)` : ''}`);
  if (!dated.length) warnings.push('calendarul exact de deblocări nu este disponibil gratuit — presiunea este estimată din supply, nu din date');

  return {
    circulating: circ,
    total,
    max,
    floatRatio: isNum(floatRatio) ? round(floatRatio, 4) : null,
    fdvToMcap: isNum(fdvToMcap) ? round(fdvToMcap, 2) : null,
    inflationPctYear,
    inflationBasis,
    unlocks: dated.map((u) => ({ ...u, at: new Date(u.at).toISOString(), inDays: round((u.at - nowMs) / DAY_MS, 1) })),
    nextUnlock: next ? { at: new Date(next.at).toISOString(), inDays: round((next.at - nowMs) / DAY_MS, 1), pctOfSupply: next.pctOfSupply, note: next.note } : null,
    unlockWithin30d: within30.length > 0 && (pct30 >= 2 || within30.some((u) => u.pctOfSupply === null)),
    unlockPct30d: within30.length ? round(pct30, 2) : null,
    unlockNote: next ? `deblocare în ${round((next.at - nowMs) / DAY_MS, 1)} zile` : null,
    ageDays: ageDays(asset.listing?.dateAdded ?? asset.listing?.firstDataAt ?? null, nowMs),
    warnings,
  };
}
