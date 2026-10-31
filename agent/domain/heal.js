/**
 * HEAL — the one corrective action the agent may take on its own: start a workflow GitHub's
 * scheduler skipped.
 *
 * The scan's schedule promises six runs a day and GitHub delivered about three; every free quota in
 * this project is budgeted for the promised six, so filling the gap restores the designed state and
 * stays inside the designed cost. The agent therefore dispatches a scan (workflow_dispatch, which
 * the workflow's own GITHUB_TOKEN is allowed to start) only when all of these hold:
 *
 *   · the last scan started more than `minGapHours` ago (default 4.5 h — the cron interval plus a
 *     margin, so a late scheduled run is never doubled);
 *   · no scan is queued or running;
 *   · fewer than `maxPerDay` dispatches in the last 24 h;
 *   · the last two completed scans did not both fail (repeating a broken run wastes quota — that is a
 *     finding for a person, not a retry);
 *   · no free plan is above `maxQuotaShare` of its month, projected.
 *
 * The pulse gets the same treatment with its own limits and one more rule: never while a scan is
 * queued or running (the pulse would yield anyway). Nothing else is ever touched: the agent cannot
 * cancel, delete, re-run with other inputs or push code.
 *
 * Pure: returns a plan; the application executes it.
 */
import { DAY_MS, HOUR_MS, isNum, round, toMs } from './stats.js';

export const HEAL_DEFAULTS = Object.freeze({
  enabled: true,
  scan: { enabled: true, minGapHours: 4.5, maxPerDay: 4 },
  pulse: { enabled: true, minGapHours: 2, maxPerDay: 8 },
  maxQuotaShare: 85,
});

const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

function lastStart(runs) {
  const ts = (runs ?? []).map((r) => toMs(r.createdAt)).filter(isNum);
  return ts.length ? Math.max(...ts) : null;
}

const dispatchesSince = (actions, workflow, fromMs) => (actions ?? []).filter((a) => a.kind === 'dispatch' && a.workflow === workflow && a.ok !== false && toMs(a.at) >= fromMs).length;

/**
 * @param {{nowMs:number, scan:{file:string, runs:any[]}|null, pulse:{file:string, runs:any[]}|null,
 *          quota?:{projectedShare?:number|null}[], actions?:any[], cfg?:any, ref?:string}} o
 * @returns {{actions:{kind:'dispatch', workflow:string, ref:string, inputs?:any, reason:string}[], skipped:{workflow:string, reason:string}[]}}
 */
export function healPlan({ nowMs, scan, pulse, quota = [], actions = [], cfg = {}, ref = 'main' }) {
  const c = { ...HEAL_DEFAULTS, ...cfg, scan: { ...HEAL_DEFAULTS.scan, ...(cfg.scan ?? {}) }, pulse: { ...HEAL_DEFAULTS.pulse, ...(cfg.pulse ?? {}) } };
  const plan = { actions: [], skipped: [] };
  if (!c.enabled) return plan;
  const dayAgo = nowMs - DAY_MS;
  const scanActive = (scan?.runs ?? []).some((r) => ACTIVE.has(r.status));
  const maxShare = Math.max(0, ...quota.map((q) => q.projectedShare).filter(isNum));

  if (scan && c.scan.enabled) {
    const last = lastStart(scan.runs);
    const sinceH = isNum(last) ? (nowMs - last) / HOUR_MS : Infinity;
    const done = (scan.runs ?? []).filter((r) => r.status === 'completed').sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
    const twoFailed = done.length >= 2 && done[0].conclusion === 'failure' && done[1].conclusion === 'failure';
    const used = dispatchesSince(actions, scan.file, dayAgo);
    const why = scanActive ? 'o scanare rulează sau așteaptă'
      : sinceH < c.scan.minGapHours ? `ultima scanare a pornit acum ${round(sinceH, 1)} h (prag ${c.scan.minGapHours} h)`
      : twoFailed ? 'ultimele două scanări au eșuat — o a treia ar consuma cote fără folos; cauza trebuie remediată'
      : used >= c.scan.maxPerDay ? `limita de ${c.scan.maxPerDay} porniri pe 24 h a fost atinsă`
      : maxShare > c.maxQuotaShare ? `un plan gratuit este la ${round(maxShare, 1)}% din lună (prag ${c.maxQuotaShare}%)`
      : null;
    if (why) plan.skipped.push({ workflow: scan.file, reason: why });
    else plan.actions.push({ kind: 'dispatch', workflow: scan.file, ref, inputs: { mode: 'live' }, reason: `ultima scanare a pornit acum ${isFinite(sinceH) ? `${round(sinceH, 1)} h` : 'niciodată'}; cron-ul promite una la 4 h, iar GitHub a sărit programarea` });
  }

  if (pulse && c.pulse.enabled) {
    const last = lastStart(pulse.runs);
    const sinceH = isNum(last) ? (nowMs - last) / HOUR_MS : Infinity;
    const pulseActive = (pulse.runs ?? []).some((r) => ACTIVE.has(r.status));
    const used = dispatchesSince(actions, pulse.file, dayAgo);
    const startingScan = plan.actions.some((a) => a.workflow === scan?.file);
    const why = scanActive || startingScan ? 'o scanare rulează, așteaptă sau pornește acum (pulsul ar ceda rândul)'
      : pulseActive ? 'un puls rulează sau așteaptă'
      : sinceH < c.pulse.minGapHours ? `ultimul puls a pornit acum ${round(sinceH, 1)} h (prag ${c.pulse.minGapHours} h)`
      : used >= c.pulse.maxPerDay ? `limita de ${c.pulse.maxPerDay} porniri pe 24 h a fost atinsă`
      : null;
    if (why) plan.skipped.push({ workflow: pulse.file, reason: why });
    else plan.actions.push({ kind: 'dispatch', workflow: pulse.file, ref, reason: `ultimul puls a pornit acum ${isFinite(sinceH) ? `${round(sinceH, 1)} h` : 'niciodată'}; cron-ul promite unul la 15 min` });
  }
  return plan;
}
