/**
 * LEARN — fold what was observed into the agent's memory, once per fact.
 *
 * Runs are ingested once (by id), snapshots once (by their generation time), telemetry entries once
 * (by time). On its first run the agent therefore learns from the project's whole visible history at
 * once: up to a hundred past runs per workflow from the GitHub API and every past scan recorded in
 * the state's telemetry — so its norms are not empty on day one.
 */
import { failureStreaks, knownStreak } from '../domain/incidents.js';
import { appendPoint } from '../domain/norms.js';
import { classify } from '../domain/signatures.js';

const KEEP_IDS = 400;

export function emptyMemory(nowIso) {
  return {
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    runs: 0,
    seen: { runs: {}, snapshots: [], telemetry: [] },
    series: {},
    incidents: [],
    fixes: {},
    ledger: { cohorts: [], archive: null },
    actions: [],
    reports: [],
    narrative: null,
  };
}

const ms = (iso) => Date.parse(iso);
const minutes = (a, b) => (Number.isFinite(ms(a)) && Number.isFinite(ms(b)) ? (ms(b) - ms(a)) / 60_000 : null);

function push(memory, metric, t, v, maxPoints) {
  memory.series[metric] = appendPoint(memory.series[metric], t, v, maxPoints);
}

/**
 * @returns {{memory:any, learned:{runs:number, snapshots:number, telemetry:number}}}
 */
export function ingest(memoryIn, obs, { maxPoints = 120 } = {}) {
  const memory = JSON.parse(JSON.stringify(memoryIn));
  memory.series ??= {};
  memory.seen ??= { runs: {}, snapshots: [], telemetry: [] };
  const learned = { runs: 0, snapshots: 0, telemetry: 0 };

  // Workflow runs: duration of each completed run, gap since the previous run of the same workflow.
  for (const [role, wf] of Object.entries(obs.workflows ?? {})) {
    const seen = new Set(memory.seen.runs[role] ?? []);
    const asc = [...(wf.runs ?? [])].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    asc.forEach((r, i) => {
      if (r.status !== 'completed' || seen.has(r.id)) return;
      seen.add(r.id);
      learned.runs += 1;
      const t = ms(r.createdAt);
      const d = minutes(r.startedAt ?? r.createdAt, r.updatedAt);
      if (r.conclusion === 'success' && d !== null && d >= 0) push(memory, `wf.${role}.durationMin`, t, Math.round(d * 100) / 100, maxPoints);
      if (i > 0) push(memory, `wf.${role}.gapH`, t, Math.round(((t - ms(asc[i - 1].createdAt)) / 3_600_000) * 100) / 100, maxPoints);
    });
    memory.seen.runs[role] = [...seen].slice(-KEEP_IDS);
  }

  // Past scans from the state's telemetry: calls and success share per provider.
  const seenT = new Set(memory.seen.telemetry ?? []);
  for (const e of obs.telemetry ?? []) {
    if (!e?.at || seenT.has(e.at)) continue;
    seenT.add(e.at);
    learned.telemetry += 1;
    const t = ms(e.at);
    let calls = 0;
    for (const [id, p] of Object.entries(e.providers ?? {})) {
      calls += p.calls ?? 0;
      if ((p.calls ?? 0) > 0) push(memory, `prov.${id}.okShare`, t, Math.round(((p.ok ?? 0) / p.calls) * 1000) / 1000, maxPoints);
    }
    // The offline simulator records no calls; a zero is "not measured", not a norm.
    if (calls > 0) push(memory, 'scan.calls', t, calls, maxPoints);
  }
  memory.seen.telemetry = [...seenT].slice(-KEEP_IDS);

  // The current snapshot: the scan's own figures.
  const s = obs.snapshot;
  if (s?.generatedAt && !(memory.seen.snapshots ?? []).includes(s.generatedAt)) {
    learned.snapshots += 1;
    const t = ms(s.generatedAt);
    if (Number.isFinite(s.durationMs)) push(memory, 'scan.durationMin', t, Math.round((s.durationMs / 60_000) * 100) / 100, maxPoints);
    if (Number.isFinite(s.universe?.eligible)) push(memory, 'scan.eligible', t, s.universe.eligible, maxPoints);
    if (Number.isFinite(s.universe?.merged)) push(memory, 'scan.merged', t, s.universe.merged, maxPoints);
    const v = s.validity;
    const checked = v ? (v.valid ?? 0) + (v.pending ?? 0) + (v.rejected ?? 0) : 0;
    if (checked) push(memory, 'scan.rejectedShare', t, Math.round((v.rejected / checked) * 1000) / 1000, maxPoints);
    const failing = (s.providers ?? []).filter((p) => !['OK', 'NOT_CONFIGURED', 'DISABLED', 'SKIPPED'].includes(p.status)).length;
    push(memory, 'scan.providersFailing', t, failing, maxPoints);
    const confirmed = (s.forecast?.winners ?? []).filter((w) => w.status === 'CONFIRMED').length;
    if (s.forecast) push(memory, 'scan.forecastConfirmed', t, confirmed, maxPoints);
    if (Number.isFinite(s.parity?.achieved)) push(memory, 'scan.parityAchieved', t, s.parity.achieved, maxPoints);
    memory.seen.snapshots = [...(memory.seen.snapshots ?? []), s.generatedAt].slice(-KEEP_IDS);
  }
  return { memory, learned };
}

/** The norm checks the report publishes: which metric, which side is a problem, how loose. */
export const WATCHED = Object.freeze([
  { metric: 'wf.ci.durationMin', label: 'Durata CI (min)', direction: 'high' },
  { metric: 'wf.scan.durationMin', label: 'Durata workflow-ului de scanare (min)', direction: 'high' },
  { metric: 'wf.scan.gapH', label: 'Interval între scanări (h)', direction: 'high', relFloor: 0.1 },
  { metric: 'wf.pulse.gapH', label: 'Interval între pulsuri (h)', direction: 'high', relFloor: 0.1 },
  { metric: 'scan.durationMin', label: 'Durata scanării propriu-zise (min)', direction: 'high' },
  { metric: 'scan.calls', label: 'Apeluri API pe scanare', direction: 'both', relFloor: 0.05 },
  { metric: 'scan.eligible', label: 'Proiecte eligibile', direction: 'low', relFloor: 0.05 },
  { metric: 'scan.merged', label: 'Proiecte unificate în univers', direction: 'low', relFloor: 0.05 },
  { metric: 'scan.rejectedShare', label: 'Ponderea respinșilor de poarta de validitate', direction: 'high', relFloor: 0.1 },
  { metric: 'scan.providersFailing', label: 'Furnizori cu probleme', direction: 'high', relFloor: 0.5 },
  { metric: 'scan.parityAchieved', label: 'Paritate realizată (%)', direction: 'low', relFloor: 0.02 },
  { metric: 'scan.forecastConfirmed', label: 'Câștigători confirmați în lista de învățare', direction: 'low', relFloor: 0.1 },
]);

/** The gate each workflow's own result stands for, when its history is replayed. */
const RUN_GATES = Object.freeze({
  ci: { gate: 'ci.run', title: 'CI verde pe ultimul commit din main', severity: 'critical' },
  scan: { gate: 'scan.run', title: 'Ultima scanare live a reușit', severity: 'critical' },
  probe: { gate: 'per.probe', title: 'Sonda săptămânală a surselor gratuite', severity: 'serious' },
  labels: { gate: 'per.labels', title: 'Actualizarea lunară a etichetelor on-chain', severity: 'warning' },
});

/**
 * Replay the visible run history: every failure streak that has ended and that memory does not
 * know yet becomes a resolved incident, with the commit that ended it (or "transient"). For the last
 * failed run of a new streak the agent reads the failed steps and annotations once, so the lesson is
 * filed under its failure signature too — the next time the same kind of failure appears, the agent
 * quotes the fix that worked. At most `maxLookups` such reads per pass.
 */
export async function replayIncidents(memory, obs, { ci = null, maxLookups = 3 } = {}) {
  const found = [];
  let lookups = 0;
  for (const [role, g] of Object.entries(RUN_GATES)) {
    const wf = obs.workflows?.[role];
    if (!wf?.runs?.length) continue;
    for (const streak of failureStreaks(wf.runs)) {
      if (streak.open || knownStreak(memory.incidents, g.gate, streak)) continue;
      let signature = null;
      if (ci?.jobs && ci?.annotations && lookups < maxLookups && streak.lastRunId) {
        lookups += 1;
        const texts = [];
        const j = await ci.jobs(streak.lastRunId);
        for (const job of j.ok ? j.data.slice(0, 3) : []) {
          texts.push(...(job.steps ?? []).filter((st) => st.conclusion === 'failure').map((st) => st.name));
          const a = await ci.annotations(job.id);
          if (a.ok) texts.push(...a.data.map((x) => `${x.title ?? ''} ${x.message ?? ''}`));
        }
        signature = classify(texts)?.code ?? null;
      }
      found.push({ ...g, streak, signature });
    }
  }
  return found;
}
