/**
 * ALERTS — the short list a researcher should look at first, and the reason each line is on it.
 *
 * Alerts are derived, never configured per asset: a rule fires when a named condition is met, and
 * every alert carries the fact that triggered it. State transitions (a token entering the candidate
 * set, a grade improving, a risk turning critical) matter more than levels, so transitions are
 * computed against the previous run's stored verdicts.
 */
import { isNum, round } from '../shared/math.js';
import { SEVERITY } from '../risk/risk-engine.js';

export const ALERT_LEVEL = { URGENT: 'URGENT', IMPORTANT: 'IMPORTANT', INFO: 'INFO' };
const LEVEL_ORDER = { URGENT: 0, IMPORTANT: 1, INFO: 2 };

/**
 * @param {{rows:any[], lastSeen:Record<string, any>, market:any, nowMs:number}} input
 * @returns {{alerts:any[], counts:Record<string, number>}}
 */
export function buildAlerts({ rows, lastSeen = {}, market, nowMs }) {
  const alerts = [];
  const push = (o) => alerts.push({ ...o, at: new Date(nowMs).toISOString() });

  for (const r of rows ?? []) {
    // Rows arrive as the discovery pipeline produces them: `{ asset, verdict, changed, risk, … }`.
    // Reading the identity through the asset keeps this function usable with either that shape or
    // the flattened view row the snapshot publishes.
    const key = r.asset?.key ?? r.key ?? null;
    const sym = r.asset?.symbol ?? r.symbol ?? null;
    if (!key || !sym) continue;
    const prev = lastSeen[key] ?? null;
    const v = r.verdict ?? {};

    // New early research candidate — the headline event of the whole project.
    if (v.earlyResearchCandidate && !prev?.earlyResearchCandidate) {
      push({
        level: ALERT_LEVEL.URGENT,
        type: 'NEW_EARLY_CANDIDATE',
        key,
        symbol: sym,
        title: `${sym}: candidat nou de research timpuriu`,
        detail: `Stage ${v.stage}, oportunitate ${isNum(v.opportunity) ? round(v.opportunity, 0) : '—'}, risc ${isNum(v.risk) ? v.risk : '—'}, precocitate ${v.earliness ?? '—'}. ${r.changed?.summary ?? ''}`,
      });
    }

    // Confluence crossing the threshold without the price having moved yet.
    if (r.changed?.simultaneous && !prev?.simultaneous && (r.changed.earliness ?? 0) >= 60) {
      push({
        level: ALERT_LEVEL.IMPORTANT,
        type: 'CONFLUENCE',
        key,
        symbol: sym,
        title: `${sym}: ${r.changed.count} schimbări simultane, mișcarea încă neevidentă`,
        detail: r.changed.changes.slice(0, 3).map((c) => `${c.label}: ${c.detail}`).join(' · '),
      });
    }

    // Accumulation confirmed on-chain.
    const flows = r.asset?.onchain?.flows ?? r.onchain?.flows;
    if (flows?.verdict === 'ACCUMULATION' && prev?.flowVerdict !== 'ACCUMULATION') {
      push({
        level: ALERT_LEVEL.IMPORTANT,
        type: 'ACCUMULATION',
        key,
        symbol: sym,
        title: `${sym}: acumulare confirmată on-chain`,
        detail: `${flows.accumulating} portofele mari în creștere, fără depozite nete la burse (comparat cu instantaneul de acum ${flows.spanDays} zile)`,
      });
    }

    // Critical risk appearing on something we are watching.
    const critical = (r.risk?.invalidators ?? []).filter((i) => i.severity === SEVERITY.CRITICAL);
    if (critical.length && !(prev?.criticalRisks ?? 0)) {
      push({
        level: ALERT_LEVEL.URGENT,
        type: 'CRITICAL_RISK',
        key,
        symbol: sym,
        title: `${sym}: risc critic detectat`,
        detail: critical.map((c) => `${c.label} — ${c.invalidates}`).join(' · '),
      });
    }

    // Team or treasury selling into the signal: the single most thesis-invalidating event.
    if ((flows?.flags ?? []).includes('TEAM_TO_CEX') && !(prev?.flags ?? []).includes('TEAM_TO_CEX')) {
      push({
        level: ALERT_LEVEL.URGENT,
        type: 'TEAM_TO_CEX',
        key,
        symbol: sym,
        title: `${sym}: trezoreria proiectului trimite către burse`,
        detail: 'cererea detectată poate fi absorbită de vânzătorul cel mai informat — teza se reevaluează',
      });
    }

    // Futures grade reaching A or better.
    const grade = r.futures?.grade?.grade ?? r.asset?.futures?.grade?.grade;
    if (grade && ['A', 'A+', 'A++'].includes(grade) && prev?.futuresGrade !== grade) {
      push({
        level: ALERT_LEVEL.IMPORTANT,
        type: 'FUTURES_GRADE',
        key,
        symbol: sym,
        title: `${sym}: setup futures ${grade}`,
        detail: r.futures?.grade?.verdict ?? r.asset?.futures?.grade?.verdict ?? 'setup confirmat pe cele cinci blocuri',
      });
    }

    // Stage moving from early to expansion: the window is closing.
    if (isNum(prev?.stage) && isNum(v.stage) && prev.stage <= 2 && v.stage >= 3) {
      push({
        level: ALERT_LEVEL.INFO,
        type: 'WINDOW_CLOSING',
        key,
        symbol: sym,
        title: `${sym}: a trecut în expansiune`,
        detail: `Stage ${prev.stage} → ${v.stage}; precocitatea a scăzut la ${v.earliness ?? '—'}/100`,
      });
    }

    // Fresh catalysts.
    for (const c of (r.asset?.catalysts ?? r.catalysts ?? []).filter((x) => x.fresh)) {
      push({
        level: ALERT_LEVEL.INFO,
        type: c.type,
        key,
        symbol: sym,
        title: `${sym}: ${c.label}`,
        detail: c.detail ?? c.label ?? '',
      });
    }
  }

  // Market-wide alerts.
  if (market?.regime?.state === 'RISK_OFF') {
    push({ level: ALERT_LEVEL.IMPORTANT, type: 'REGIME_RISK_OFF', key: null, symbol: null, title: 'Regim de piață: risc-off', detail: 'semnalele de small-cap eșuează mai des în acest regim; pragurile rămân neschimbate, dar riscul de context crește' });
  }
  if (isNum(market?.altseason?.value) && market.altseason.value >= 75) {
    push({ level: ALERT_LEVEL.INFO, type: 'ALTSEASON', key: null, symbol: null, title: `Indice altseason ${Math.round(market.altseason.value)}/100`, detail: market.altseason.note });
  }
  if (isNum(market?.fearGreed?.value) && market.fearGreed.value <= 20) {
    push({ level: ALERT_LEVEL.INFO, type: 'EXTREME_FEAR', key: null, symbol: null, title: `Fear & Greed ${market.fearGreed.value} — frică extremă`, detail: 'istoric, zonele de frică extremă sunt momentele în care descoperirile timpurii sunt cel mai puțin aglomerate' });
  }

  const sorted = alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return {
    alerts: sorted.slice(0, 60),
    counts: {
      urgent: sorted.filter((a) => a.level === ALERT_LEVEL.URGENT).length,
      important: sorted.filter((a) => a.level === ALERT_LEVEL.IMPORTANT).length,
      info: sorted.filter((a) => a.level === ALERT_LEVEL.INFO).length,
    },
  };
}

/** The compact per-asset record kept between runs so transitions can be detected next time. */
export function lastSeenRecord(row) {
  const v = row.verdict ?? {};
  const flows = row.asset?.onchain?.flows ?? row.onchain?.flows ?? null;
  return {
    stage: v.stage ?? null,
    opportunity: isNum(v.opportunity) ? round(v.opportunity, 1) : null,
    risk: v.risk ?? null,
    earliness: v.earliness ?? null,
    earlyResearchCandidate: Boolean(v.earlyResearchCandidate),
    simultaneous: Boolean(row.changed?.simultaneous),
    flowVerdict: flows?.verdict ?? null,
    flags: flows?.flags ?? [],
    criticalRisks: (row.risk?.invalidators ?? []).filter((i) => i.severity === SEVERITY.CRITICAL).length,
    futuresGrade: row.futures?.grade?.grade ?? row.asset?.futures?.grade?.grade ?? null,
  };
}
