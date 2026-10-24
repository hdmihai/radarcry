/**
 * Watchlist intelligence (CRI v0.4.7 / v0.6.1 / v0.6.6): stage transitions and research alerts
 * between runs. Alerts mean "review this", never "trade this".
 */
import { isNum } from '../shared/math.js';
import { STAGES, STAGE_LABELS } from './stage.js';
import { SIGNAL_LABELS } from '../signals/signal.js';

const IMPORTANT = new Set(['BASE>BUILDING', 'BUILDING>ACCELERATION', 'BUILDING>PRE_EXPANSION', 'ACCELERATION>PRE_EXPANSION', 'PRE_EXPANSION>EXPANSION', 'BASE>PRE_EXPANSION']);

/**
 * @param {{key:string,symbol:string,stage:string,cri:number|null,signal:{type:string}}[]} candidates
 * @param {Record<string,{stage:string,cri:number|null,signal:string}>} previous  last known state per asset
 */
export function watchlistChanges(candidates, previous, nowIso) {
  const transitions = [];
  const alerts = [];
  for (const c of candidates) {
    const p = previous?.[c.key];
    if (!p) continue;
    if (p.stage && c.stage && p.stage !== c.stage && STAGES.includes(p.stage) && STAGES.includes(c.stage)) {
      const dir = STAGES.indexOf(c.stage) > STAGES.indexOf(p.stage) ? 'ADVANCE' : 'RETREAT';
      const t = { key: c.key, symbol: c.symbol, from: p.stage, to: c.stage, direction: dir, at: nowIso, cri: c.cri };
      transitions.push(t);
      if (IMPORTANT.has(`${p.stage}>${c.stage}`)) {
        alerts.push({ ...t, kind: 'STAGE', severity: c.stage === 'PRE_EXPANSION' ? 'HIGH' : 'MEDIUM', reason: `Stadiu: ${STAGE_LABELS[p.stage] ?? p.stage} → ${STAGE_LABELS[c.stage] ?? c.stage}` });
      }
    }
    if (isNum(p.cri) && isNum(c.cri) && c.cri - p.cri >= 10) {
      alerts.push({ key: c.key, symbol: c.symbol, kind: 'SCORE', severity: 'MEDIUM', cri: c.cri, reason: `Scor CRI +${(c.cri - p.cri).toFixed(0)} (${p.cri.toFixed(0)} → ${c.cri.toFixed(0)})`, at: nowIso });
    }
    if (p.signal !== c.signal.type && ['BUY_SETUP', 'ACCUMULATE'].includes(c.signal.type)) {
      alerts.push({ key: c.key, symbol: c.symbol, kind: 'SIGNAL', severity: c.signal.type === 'BUY_SETUP' ? 'HIGH' : 'MEDIUM', cri: c.cri, reason: `Semnal nou: ${SIGNAL_LABELS[c.signal.type] ?? c.signal.type}`, at: nowIso });
    }
  }
  const sev = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  alerts.sort((a, b) => sev[a.severity] - sev[b.severity]);
  return { transitions, alerts };
}
