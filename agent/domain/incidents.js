/**
 * INCIDENTS — the agent's memory of what went wrong, how long it lasted and what fixed it.
 *
 * A gate that turns WARN or FAIL opens an incident (one per gate at a time; a WARN that becomes a
 * FAIL is the same incident, escalated). Every later run that still sees it raises its count. When
 * the gate passes again the incident is resolved, and the agent records *what changed*: the commit
 * that landed on the main branch while it was open, if there was one, or "resolved by itself" when
 * there was none — a transient failure (a rate limit, a slow source).
 *
 * That record is what the agent learns from: the next time the same gate or the same failure
 * signature opens an incident, the finding quotes the fix that worked last time, or says that this
 * one has cleared by itself N times before. UNKNOWN and LEARNING never open or close anything.
 *
 * Pure: time arrives as ISO strings / ms.
 */
import { toMs } from './stats.js';

export const SEVERITY_ORDER = Object.freeze({ critical: 4, serious: 3, warning: 2, info: 1 });
const worse = (a, b) => ((SEVERITY_ORDER[a] ?? 0) >= (SEVERITY_ORDER[b] ?? 0) ? a : b);
const MAX_RESOLVED = 60;
const MAX_FIXES = 6;

/**
 * @param {{incidents?:any[], fixes?:Record<string, any[]>}} memory
 * @param {{id:string, title:string, status:string, severity:string|null, evidence:string, signature?:string|null}[]} results
 * @param {{nowIso:string, commits?:{sha:string, message:string, at:string}[]}} o
 * @returns {{incidents:any[], fixes:Record<string, any[]>, opened:any[], resolved:any[]}}
 */
export function updateIncidents(memory, results, { nowIso, commits = [] }) {
  const incidents = (memory.incidents ?? []).map((x) => ({ ...x }));
  const fixes = Object.fromEntries(Object.entries(memory.fixes ?? {}).map(([k, v]) => [k, [...v]]));
  const opened = [];
  const resolved = [];
  const openByGate = new Map(incidents.filter((x) => x.status === 'open').map((x) => [x.gate, x]));

  for (const r of results) {
    const bad = r.status === 'FAIL' || r.status === 'WARN';
    const inc = openByGate.get(r.id);
    if (bad) {
      if (inc) {
        inc.lastSeen = nowIso;
        inc.count += 1;
        inc.status = 'open';
        inc.severity = worse(inc.severity, r.severity ?? 'warning');
        inc.worst = r.status === 'FAIL' ? 'FAIL' : inc.worst;
        inc.evidence = r.evidence;
        inc.signature = r.signature ?? inc.signature ?? null;
      } else {
        const fresh = { gate: r.id, title: r.title, status: 'open', severity: r.severity ?? 'warning', worst: r.status, firstSeen: nowIso, lastSeen: nowIso, count: 1, evidence: r.evidence, signature: r.signature ?? null, resolvedAt: null, resolvedBy: null };
        incidents.push(fresh);
        openByGate.set(r.id, fresh);
        opened.push(fresh);
      }
    } else if (inc && r.status === 'PASS') {
      inc.status = 'resolved';
      inc.resolvedAt = nowIso;
      const from = toMs(inc.firstSeen);
      // The last commit that landed while the incident was open is the candidate fix.
      const fix = [...commits].filter((c) => toMs(c.at) >= from && toMs(c.at) <= toMs(nowIso)).sort((a, b) => toMs(b.at) - toMs(a.at))[0] ?? null;
      inc.resolvedBy = fix ? { sha: fix.sha, message: String(fix.message ?? '').split('\n')[0].slice(0, 140), at: fix.at } : { transient: true };
      inc.durationHours = Math.round(((toMs(nowIso) - from) / 3_600_000) * 10) / 10;
      for (const key of [inc.gate, inc.signature ? `sig:${inc.signature}` : null].filter(Boolean)) {
        fixes[key] = [{ at: nowIso, gate: inc.gate, ...inc.resolvedBy, durationHours: inc.durationHours }, ...(fixes[key] ?? [])].slice(0, MAX_FIXES);
      }
      openByGate.delete(r.id);
      resolved.push(inc);
    }
  }

  const open = incidents.filter((x) => x.status === 'open');
  const done = incidents.filter((x) => x.status === 'resolved').sort((a, b) => toMs(b.resolvedAt) - toMs(a.resolvedAt)).slice(0, MAX_RESOLVED);
  return { incidents: [...open, ...done], fixes, opened, resolved };
}

/**
 * What the history says about a gate or signature: the last fix with a commit, and how many times
 * it cleared by itself.
 */
export function lessonsFor(fixes, gate, signature = null) {
  const list = [...(fixes?.[gate] ?? []), ...(signature ? fixes?.[`sig:${signature}`] ?? [] : [])];
  const seen = new Set();
  const uniq = list.filter((f) => {
    const k = `${f.at}|${f.sha ?? 't'}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const withCommit = uniq.filter((f) => f.sha).sort((a, b) => toMs(b.at) - toMs(a.at));
  return {
    lastFix: withCommit[0] ? { sha: withCommit[0].sha, message: withCommit[0].message, at: withCommit[0].at, durationHours: withCommit[0].durationHours ?? null } : null,
    transient: uniq.filter((f) => f.transient).length,
    occurrences: uniq.length,
  };
}

/** Findings: every non-passing gate, enriched with its incident and what history teaches about it. */
export function buildFindings(results, { incidents, fixes }) {
  const openByGate = new Map((incidents ?? []).filter((x) => x.status === 'open').map((x) => [x.gate, x]));
  return results
    .filter((r) => r.status === 'FAIL' || r.status === 'WARN')
    .map((r) => {
      const inc = openByGate.get(r.id);
      const lesson = lessonsFor(fixes, r.id, r.signature);
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        severity: r.severity ?? 'warning',
        value: r.value,
        evidence: r.evidence,
        remedy: r.remedy,
        signature: r.signature ?? null,
        link: r.link ?? null,
        firstSeen: inc?.firstSeen ?? null,
        count: inc?.count ?? 1,
        lesson: lesson.occurrences ? lesson : null,
      };
    })
    .sort((a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) || (b.status === 'FAIL') - (a.status === 'FAIL') || a.id.localeCompare(b.id));
}

/* ───────────────────────────── history replay ───────────────────────────── */

const DECISIVE = new Set(['success', 'failure', 'timed_out', 'startup_failure']);

/**
 * Failure streaks in a workflow's run history, each with what ended it: the first green run after
 * it, on a different commit (a fix) or on the same one (transient). A streak still failing at the
 * end of the list is returned with `open: true`.
 */
export function failureStreaks(runs) {
  const asc = (runs ?? []).filter((r) => r.status === 'completed' && DECISIVE.has(r.conclusion)).sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
  const out = [];
  let cur = null;
  for (const r of asc) {
    if (r.conclusion === 'success') {
      if (cur) {
        const fixed = r.headSha && r.headSha !== cur.lastSha;
        out.push({ ...cur, resolvedAt: r.createdAt, resolvedBy: fixed ? { sha: r.headSha, message: String(r.message ?? '').split('\n')[0].slice(0, 140), at: r.createdAt } : { transient: true } });
        cur = null;
      }
    } else {
      cur ??= { from: r.createdAt, count: 0 };
      cur.to = r.createdAt;
      cur.count += 1;
      cur.lastSha = r.headSha ?? null;
      cur.lastRunId = r.id;
      cur.lastUrl = r.url ?? null;
    }
  }
  if (cur) out.push({ ...cur, open: true });
  return out;
}

/** Does a streak overlap an incident already in memory for the same gate? */
export function knownStreak(incidents, gate, streak) {
  const a = toMs(streak.from);
  const b = toMs(streak.resolvedAt ?? streak.to);
  return (incidents ?? []).some((x) => x.gate === gate && toMs(x.firstSeen) <= b + 60_000 && toMs(x.resolvedAt ?? x.lastSeen) >= a - 60_000);
}

/**
 * Fold resolved streaks from the run history into memory as resolved incidents, with the fix they
 * teach. `found`: [{gate, title, streak, signature}] — only streaks not already known.
 */
export function mergeReplay(memory, found) {
  const incidents = [...(memory.incidents ?? [])];
  const fixes = Object.fromEntries(Object.entries(memory.fixes ?? {}).map(([k, v]) => [k, [...v]]));
  for (const f of found) {
    const s = f.streak;
    const durationHours = Math.round(((toMs(s.resolvedAt) - toMs(s.from)) / 3_600_000) * 10) / 10;
    incidents.push({ gate: f.gate, title: f.title, status: 'resolved', severity: f.severity ?? 'serious', worst: 'FAIL', firstSeen: s.from, lastSeen: s.to, count: s.count, evidence: `Reconstruit din istoricul rulărilor: ${s.count === 1 ? 'o rulare eșuată' : `${s.count}${s.count % 100 >= 20 ? ' de' : ''} rulări eșuate`}${f.signature ? ` (${f.signature})` : ''}.`, signature: f.signature ?? null, resolvedAt: s.resolvedAt, resolvedBy: s.resolvedBy, durationHours, replayed: true });
    for (const key of [f.gate, f.signature ? `sig:${f.signature}` : null].filter(Boolean)) {
      fixes[key] = [{ at: s.resolvedAt, gate: f.gate, ...s.resolvedBy, durationHours, replayed: true }, ...(fixes[key] ?? [])].sort((x, y) => toMs(y.at) - toMs(x.at)).slice(0, MAX_FIXES);
    }
  }
  const open = incidents.filter((x) => x.status === 'open');
  const done = incidents.filter((x) => x.status === 'resolved').sort((a, b) => toMs(b.resolvedAt) - toMs(a.resolvedAt)).slice(0, MAX_RESOLVED);
  return { incidents: [...open, ...done], fixes };
}
