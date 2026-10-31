/**
 * The agent's use-cases.
 *
 *   analyze  observe → learn → evaluate every gate → norms and anomalies → incidents and lessons →
 *            calibration ledger → efficiency → self-heal plan → report (+ whether to narrate)
 *   narrate  facts → local model (if available) → guard → narrative, or the template with the reason
 *   act      execute the self-heal plan, keep the rolling findings issue in step with the report
 *
 * The three run as separate steps in the workflow (the model is installed only when `analyze` says
 * the narrative must be rewritten), and `run` chains them for local use and the demo.
 */
import { calibrationSummary, makeCohort, observePrices, pruneCohorts, weekId } from '../domain/calibration.js';
import { observedCadence, reliability } from '../domain/cadence.js';
import { cadenceOf } from '../domain/cron.js';
import { efficiency } from '../domain/efficiency.js';
import { GATES, GROUPS, STATUS, STATUS_RO, evaluateGates, summarize } from '../domain/gates.js';
import { healPlan } from '../domain/heal.js';
import { SEVERITY_ORDER, buildFindings, mergeReplay, updateIncidents } from '../domain/incidents.js';
import { buildFacts, buildPrompt, guardNarrative, narrativeKey, templateNarrative } from '../domain/narrative.js';
import { NORM_DEFAULTS, assess, describe } from '../domain/norms.js';
import { fnv1a } from '../domain/stats.js';
import { WATCHED, emptyMemory, ingest, replayIncidents } from './learn.js';
import { commitsFrom, observe, scanSecrets } from './observe.js';

export const REPORT_SCHEMA_VERSION = '1.0.0';
const MAX_ACTIONS = 120;
const MAX_REPORTS = 240;

/* ───────────────────────────── analyze ───────────────────────────── */

function normsReport(memory, norms) {
  const metrics = [...WATCHED];
  for (const key of Object.keys(memory.series ?? {})) {
    if (key.startsWith('prov.') && key.endsWith('.okShare')) metrics.push({ metric: key, label: `Rata de răspuns ${key.slice(5, -8)}`, direction: 'low', relFloor: 0.05 });
  }
  return metrics
    .filter((m) => (memory.series?.[m.metric] ?? []).length)
    .map((m) => {
      const series = memory.series[m.metric];
      const d = describe(series, norms);
      const a = assess(series, d.last, d.lastAt, { ...norms, direction: m.direction, relFloor: m.relFloor ?? 0.02 });
      return { metric: m.metric, label: m.label, direction: m.direction, n: d.n, median: d.median, p10: d.p10, p90: d.p90, last: d.last, lastAt: d.lastAt ? new Date(d.lastAt).toISOString() : null, z: a.z, status: a.status, before: a.n };
    });
}

/** Norm anomalies that no gate already covers become findings of their own. */
const COVERED = new Set(['scan.durationMin', 'scan.eligible']);
function anomalyResults(normRows, nowIso) {
  return normRows
    .filter((r) => r.status === 'ANOMALY' && !COVERED.has(r.metric))
    .map((r) => ({
      id: `norm.${r.metric}`,
      group: 'model',
      title: `Anomalie: ${r.label}`,
      status: STATUS.WARN,
      severity: 'warning',
      value: String(r.last),
      evidence: `Ultima valoare ${r.last} față de norma învățată ${r.median} (z = ${r.z}, din ${r.before} observații anterioare).`,
      remedy: r.metric.startsWith('prov.') ? 'furnizorul răspunde mai rar decât de obicei; dacă se repetă, sonda săptămânală îl confirmă.' : 'comparați rularea cu cele anterioare în ecranul „Date și surse”.',
      at: nowIso,
      signature: null,
    }));
}

function updateLedger(memory, obs, { cfg, prices }) {
  const ledger = { cohorts: [...(memory.ledger?.cohorts ?? [])], archive: memory.ledger?.archive ?? null };
  const uni = obs.universe;
  let created = null;
  const cohortCfg = cfg.calibration ?? {};
  if (uni?.generatedAt && uni.rows?.length) {
    const id = weekId(Date.parse(uni.generatedAt));
    if (!ledger.cohorts.some((c) => c.id === id)) {
      const rows = uni.rows.filter((r) => r.valid === 'V' && Number.isFinite(r.fc100)).map((r) => ({ key: r.key, symbol: r.symbol, fc100: r.fc100, fc20: r.fc20, price: r.price }));
      if (rows.length) {
        const base = obs.snapshot?.forecast?.baseRates ?? [];
        const c = makeCohort({ at: uni.generatedAt, horizonDays: obs.snapshot?.forecast?.horizonDays ?? 365, base: { p100: base.find((b) => b.multiple === 100)?.pct, p20: base.find((b) => b.multiple === 20)?.pct }, rows, maxRows: cohortCfg.maxRows ?? 600 });
        ledger.cohorts.push(c);
        created = { id: c.id, rows: c.rows.length };
      }
    }
  }
  // Prices: the market's 24-hour high where the public price list has the project, the published
  // table's price otherwise.
  const map = new Map();
  for (const r of uni?.rows ?? []) if (Number.isFinite(r.price)) map.set(r.key, { price: r.price });
  for (const [id, p] of Object.entries(prices ?? {})) map.set(`cg:${id}`, p);
  let updated = 0;
  ledger.cohorts = ledger.cohorts.map((c) => {
    const r = observePrices(c, map, obs.nowMs);
    updated += r.updated;
    return r.cohort;
  });
  const pruned = pruneCohorts(ledger.cohorts, obs.nowMs, cohortCfg.keepDays ?? 430, ledger.archive);
  return { ledger: { cohorts: pruned.cohorts, archive: pruned.archive }, created, updated };
}

/** CoinGecko ids the ledger tracks (the `cg:` keys of every live cohort). */
export function trackedIds(memory) {
  const ids = new Set();
  for (const c of memory.ledger?.cohorts ?? []) for (const row of c.rows) if (String(row[0]).startsWith('cg:')) ids.add(String(row[0]).slice(3));
  return [...ids];
}

function memoryInfo(memory, fresh) {
  const metrics = Object.entries(memory.series ?? {}).map(([k, v]) => ({ metric: k, n: v.length }));
  return {
    fresh,
    runs: memory.runs,
    since: memory.createdAt,
    metrics,
    incidents: { open: (memory.incidents ?? []).filter((x) => x.status === 'open').length, resolved: (memory.incidents ?? []).filter((x) => x.status === 'resolved').length },
    fixes: Object.values(memory.fixes ?? {}).reduce((s, v) => s + v.filter((f) => f.sha).length, 0),
  };
}

/**
 * @param {{ports:{ci:any, state:any, site?:any, prices?:any, memory:any}, cfg:any, nowMs:number, limits?:any, logger?:any, narrateMode?:'auto'|'always'|'never'}} o
 */
export async function analyze({ ports, cfg, nowMs, limits = {}, logger = console, narrateMode = 'auto' }) {
  const nowIso = new Date(nowMs).toISOString();
  const loaded = await ports.memory.load();
  const fresh = !loaded;
  let memory = loaded ?? emptyMemory(nowIso);
  const norms = { ...NORM_DEFAULTS, ...(cfg.norms ?? {}) };

  const obs = await observe({ ports, cfg, nowMs });
  const { memory: learnedMemory, learned } = ingest(memory, obs, norms);
  memory = learnedMemory;
  memory.runs = (memory.runs ?? 0) + 1;
  memory.updatedAt = nowIso;

  // The run history teaches before the present is judged: past failures and the commits that ended them.
  const replayed = await replayIncidents(memory, obs, { ci: ports.ci });
  if (replayed.length) {
    const m = mergeReplay(memory, replayed);
    memory.incidents = m.incidents;
    memory.fixes = m.fixes;
  }

  // The ledger first: its calibration feeds a gate.
  let prices = {};
  if (ports.prices) {
    const ids = [...new Set([...trackedIds(memory), ...(obs.universe?.rows ?? []).filter((r) => String(r.key).startsWith('cg:') && r.valid === 'V').map((r) => String(r.key).slice(3))])];
    if (ids.length) {
      const pr = await ports.prices.prices(ids);
      if (pr.ok) prices = pr.data;
      else logger.warn?.(`agent: prețurile publice nu au răspuns (${pr.status}) — registrul de calibrare se actualizează la rularea următoare`);
    }
  }
  const led = updateLedger(memory, obs, { cfg, prices });
  memory.ledger = led.ledger;
  const calibration = calibrationSummary(memory.ledger.cohorts, nowMs, memory.ledger.archive);

  const expectedIntervalHours = {};
  for (const [role, wf] of Object.entries(obs.workflows)) {
    const crons = [].concat(wf.cron ?? []).filter(Boolean);
    const perDay = crons.reduce((s, c) => s + cadenceOf(c).perDay, 0);
    if (perDay > 0) expectedIntervalHours[role] = 24 / perDay;
  }

  const ctx = {
    series: memory.series,
    norms,
    limits,
    cadenceWindowDays: cfg.cadenceWindowDays ?? 7,
    expectedIntervalHours,
    freshness: cfg.freshness,
    inactivity: cfg.inactivity,
    calibration,
    memoryInfo: memoryInfo(memory, fresh),
    narrative: memory.narrative,
  };
  const gateResults = evaluateGates(obs, ctx);
  const normRows = normsReport(memory, norms);
  const anomalies = anomalyResults(normRows, nowIso);
  const all = [...gateResults, ...anomalies];

  const inc = updateIncidents(memory, all, { nowIso, commits: commitsFrom(obs) });
  memory.incidents = inc.incidents;
  memory.fixes = inc.fixes;
  const findings = buildFindings(all, memory);

  const cad = {};
  for (const role of ['scan', 'pulse']) {
    const wf = obs.workflows[role];
    if (wf) cad[role] = observedCadence(wf.runs, { nowMs, windowDays: cfg.cadenceWindowDays ?? 7, cron: wf.cron });
  }
  const rel = obs.workflows.scan ? reliability(obs.workflows.scan.runs, { nowMs, windowDays: 14 }) : null;
  const eff = efficiency({ parity: obs.snapshot?.parity ?? null, scan: cad.scan ?? null, pulse: cad.pulse ?? null, reliability: rel }, cfg.efficiency ?? {});

  const plan = healPlan({
    nowMs,
    scan: obs.workflows.scan ? { file: obs.workflows.scan.file, runs: obs.workflows.scan.runs } : null,
    pulse: obs.workflows.pulse ? { file: obs.workflows.pulse.file, runs: obs.workflows.pulse.runs } : null,
    quota: obs.snapshot?.quota ?? [],
    actions: memory.actions,
    cfg: cfg.heal ?? {},
    ref: obs.repo?.defaultBranch ?? 'main',
  });
  // A plan is only a plan until `act` runs it; a fixture or a dry run never acts.
  memory.pendingPlan = { at: nowIso, actions: plan.actions };

  const summary = summarize(all);
  const cadenceRows = Object.values(obs.workflows).map((wf) => {
    const c = observedCadence(wf.runs, { nowMs, windowDays: cfg.cadenceWindowDays ?? 7, cron: wf.cron });
    const r = reliability(wf.runs, { nowMs, windowDays: 14 });
    return { workflow: wf.file, name: wf.name, role: wf.role, state: wf.state, cron: wf.cron, ...c, reliability: r.rate === null ? null : Math.round(r.rate * 1000) / 10, completed: r.n };
  });

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: nowIso,
    mode: cfg.mode ?? 'live',
    repo: obs.repo?.fullName ?? null,
    overall: summary.overall,
    summary,
    groups: GROUPS.map((g) => ({ ...g, counts: Object.fromEntries(Object.values(STATUS).map((s) => [s, gateResults.filter((r) => r.group === g.id && r.status === s).length])) })),
    gates: gateResults.map(({ metric, ...r }) => ({ ...r, statusLabel: STATUS_RO[r.status] })),
    findings,
    cadence: cadenceRows,
    efficiency: eff,
    norms: normRows,
    calibration: { ...calibration, created: led.created, updatedRows: led.updated },
    incidents: {
      open: memory.incidents.filter((x) => x.status === 'open').map(pickIncident),
      resolved: memory.incidents.filter((x) => x.status === 'resolved').slice(0, 15).map(pickIncident),
    },
    learning: {
      runs: memory.runs,
      since: memory.createdAt,
      fresh,
      minSamples: norms.minSamples,
      learnedThisRun: { ...learned, incidentsFromHistory: replayed.length },
      metrics: Object.keys(memory.series).length,
      normsLearned: normRows.filter((r) => r.n >= norms.minSamples + 1).length,
      incidents: { open: memory.incidents.filter((x) => x.status === 'open').length, resolved: memory.incidents.filter((x) => x.status === 'resolved').length },
      fixes: Object.values(memory.fixes ?? {}).reduce((s, v) => s + v.filter((f) => f.sha).length, 0),
      transient: Object.values(memory.fixes ?? {}).reduce((s, v) => s + v.filter((f) => f.transient).length, 0),
    },
    plan: { actions: plan.actions, skipped: plan.skipped },
    actions: [],
    recentActions: (memory.actions ?? []).slice(-12).reverse(),
    narrative: memory.narrative ? { ...memory.narrative } : null,
    history: [...(memory.reports ?? []), { at: nowIso, overall: summary.overall, counts: summary.counts }].slice(-60),
    observed: { calls: obs.calls, sources: obs.sources, snapshotAt: obs.snapshot?.generatedAt ?? null, universeAt: obs.universe?.generatedAt ?? null },
    policy: { freeOnly: true, researchOnly: true, actionsAllowed: ['workflow_dispatch (scan, pulse)', 'issue (o problemă deschisă, actualizată)'], llm: 'model deschis local (Ollama), fără cont, fără cheie; garda verifică fiecare cifră' },
    gateCatalogue: GATES.map((g) => ({ id: g.id, group: g.group, title: g.title, what: g.what, severity: g.severity })),
  };

  memory.reports = [...(memory.reports ?? []), { at: nowIso, overall: summary.overall, counts: summary.counts, key: fnv1a(narrativeKey(report)) }].slice(-MAX_REPORTS);

  const key = fnv1a(narrativeKey(report));
  const lastN = memory.narrative;
  const stale = !lastN || lastN.key !== key || nowMs - Date.parse(lastN.at) > (cfg.narrator?.maxAgeHours ?? 24) * 3_600_000;
  const narrate = narrateMode === 'always' || (narrateMode !== 'never' && stale);
  // Until a narrative is written for this state, the template stands in (always true, never empty).
  if (!lastN || lastN.key !== key) report.narrative = { key, at: nowIso, by: 'template', text: templateNarrative(report), reason: lastN ? 'starea s-a schimbat; narațiunea se rescrie' : 'prima rulare', guard: null, model: null };

  await ports.memory.save(memory);
  await publishReport(ports, report);
  return { report, memory, narrate, obs };
}

const pickIncident = (x) => ({ gate: x.gate, title: x.title, severity: x.severity, worst: x.worst, firstSeen: x.firstSeen, lastSeen: x.lastSeen, count: x.count, resolvedAt: x.resolvedAt, resolvedBy: x.resolvedBy, durationHours: x.durationHours ?? null, evidence: x.evidence });

/* ───────────────────────────── narrate ───────────────────────────── */

export async function narrate({ ports, nowMs, cfg = {}, logger = console }) {
  const nowIso = new Date(nowMs).toISOString();
  const memory = (await ports.memory.load()) ?? emptyMemory(nowIso);
  const report = await ports.memory.lastReport();
  if (!report) throw new Error('agent: nu există un raport de narat — rulați întâi „analyze”');
  const key = fnv1a(narrativeKey(report));

  /** The narrator gate reads the narrative it gets; summary, verdict and findings follow it. */
  const settle = (n) => {
    const gi = report.gates.findIndex((g) => g.id === 'agent.narrator');
    if (gi < 0) return;
    const ok = n.by === 'llm' || n.reason === 'disabled';
    const status = ok ? STATUS.PASS : STATUS.WARN;
    report.gates[gi] = { ...report.gates[gi], status, statusLabel: STATUS_RO[status], value: n.by === 'llm' ? n.model : 'șablon', evidence: n.by === 'llm' ? `Rezumat scris de ${n.model}, verificat: ${n.guard}.` : n.reason === 'disabled' ? 'Modelul local este dezactivat; rezumatul vine din șablonul determinist.' : `Șablon determinist: ${n.reason}.`, remedy: ok ? null : 'pasul Ollama din workflow-ul agentului este opțional; verificați jurnalul lui sau variabila CRI_AGENT_MODEL.', severity: ok ? null : 'warning' };
    report.findings = (report.findings ?? []).filter((f) => f.id !== 'agent.narrator');
    if (!ok) report.findings.push({ id: 'agent.narrator', title: report.gates[gi].title, status, severity: 'warning', value: 'șablon', evidence: report.gates[gi].evidence, remedy: report.gates[gi].remedy, signature: null, link: null, firstSeen: nowIso, count: 1, lesson: null });
    report.summary = summarize([...report.gates, ...report.findings.filter((f) => f.id.startsWith('norm.')).map((f) => ({ status: f.status }))]);
    report.overall = report.summary.overall;
  };

  const narrator = ports.narrator;
  const usable = narrator && cfg.narrator?.enabled !== false && (await narrator.available());
  let n = null;
  if (usable) {
    // The facts describe the state in which the summary is published: one written by the model.
    settle({ by: 'llm', model: narrator.model, guard: 'fiecare cifră se regăsește în fapte' });
    const facts = buildFacts(report);
    const r = await narrator.generate(buildPrompt(facts));
    if (r.ok) {
      const g = guardNarrative(r.data, facts);
      if (g.ok) n = { key, at: nowIso, by: 'llm', model: narrator.model, guard: 'fiecare cifră se regăsește în fapte', reason: null, text: String(r.data).trim() };
      else {
        n = { key, at: nowIso, by: 'template', model: null, guard: null, reason: `garda a respins textul modelului: ${g.reasons.join('; ')}`, rejected: String(r.data).slice(0, 1200) };
        logger.warn?.(`agent: narațiunea modelului respinsă (${g.reasons.join('; ')}) — se publică șablonul`);
      }
    } else n = { key, at: nowIso, by: 'template', model: null, guard: null, reason: `modelul local nu a răspuns (${r.status}${r.message ? `: ${r.message}` : ''})` };
  } else {
    n = { key, at: nowIso, by: 'template', model: null, guard: null, reason: narrator ? 'modelul local nu este disponibil în această rulare' : 'disabled' };
  }
  settle(n);
  // The template is written last, from the report as published, so its counts match the screen.
  if (n.by === 'template') n.text = templateNarrative(report);
  memory.narrative = n;
  report.narrative = n;
  await ports.memory.save(memory);
  await publishReport(ports, report);
  return { report, narrative: n };
}

/* ───────────────────────────── act ───────────────────────────── */

export async function act({ ports, nowMs, cfg = {}, logger = console, dryRun = false }) {
  const nowIso = new Date(nowMs).toISOString();
  const memory = (await ports.memory.load()) ?? emptyMemory(nowIso);
  const report = await ports.memory.lastReport();
  if (!report) throw new Error('agent: nu există un raport — rulați întâi „analyze”');
  const done = [];
  for (const a of memory.pendingPlan?.actions ?? []) {
    if (dryRun || !ports.ci?.dispatch) {
      done.push({ ...a, at: nowIso, ok: null, status: 'DRY_RUN' });
      continue;
    }
    const r = await ports.ci.dispatch(a.workflow, a.ref, a.inputs);
    done.push({ ...a, at: nowIso, ok: r.ok, status: r.status, message: r.message ?? '' });
    if (r.ok) logger.info?.(`agent: am pornit ${a.workflow} — ${a.reason}`);
    else logger.warn?.(`agent: nu am putut porni ${a.workflow} (${r.status}${r.message ? `: ${r.message}` : ''})`);
  }
  memory.pendingPlan = null;
  memory.actions = [...(memory.actions ?? []), ...done.filter((d) => d.status !== 'DRY_RUN')].slice(-MAX_ACTIONS);
  report.actions = done;
  report.recentActions = (memory.actions ?? []).slice(-12).reverse();

  // One rolling issue for findings at or above the configured severity; closed when they clear.
  let issue = null;
  if (ports.notifier && cfg.issues?.enabled !== false && !dryRun) {
    const min = SEVERITY_ORDER[cfg.issues?.minSeverity ?? 'serious'] ?? 3;
    const serious = (report.findings ?? []).filter((f) => (SEVERITY_ORDER[f.severity] ?? 0) >= min);
    const r = await ports.notifier.upsert({ title: 'Agent AI: porți de calitate care cer atenție', body: issueBody(report, serious), open: serious.length > 0 });
    issue = { ok: r.ok, status: r.status, number: r.data?.number ?? null, url: r.data?.url ?? null, open: serious.length > 0 };
  }
  report.issue = issue;
  await ports.memory.save(memory);
  await publishReport(ports, report);
  return { report, actions: done, issue };
}

function issueBody(report, findings) {
  // No timestamp in the body: the issue is edited only when the findings themselves change.
  const lines = ['<!-- cri-agent -->', `Stare generală a porților de calitate: **${STATUS_RO[report.overall] ?? report.overall}**. Raportul complet: ecranul „Agent AI” al dashboard-ului.`, ''];
  if (!findings.length) lines.push('Toate porțile serioase și critice au trecut; problema se închide automat.');
  for (const f of findings) {
    lines.push(`### ${f.status === 'FAIL' ? '❌' : '⚠️'} ${f.title}`);
    lines.push(f.evidence);
    if (f.remedy) lines.push(`**Remediu:** ${f.remedy}`);
    if (f.lesson?.lastFix) lines.push(`**Din istoric:** rezolvat ultima dată de ${f.lesson.lastFix.sha.slice(0, 7)} — ${f.lesson.lastFix.message}`);
    else if (f.lesson?.transient) lines.push(`**Din istoric:** s-a rezolvat singur de ${f.lesson.transient} ori.`);
    if (f.link) lines.push(`[rularea](${f.link})`);
    lines.push('');
  }
  lines.push('_Problema este scrisă și închisă automat de workflow-ul „Agent AI”. Cercetare, nu sfat financiar._');
  return lines.join('\n');
}

/* ───────────────────────────── report ───────────────────────────── */

export function reportMarkdown(r) {
  const icon = { PASS: '✅', WARN: '⚠️', FAIL: '❌', UNKNOWN: '·', LEARNING: '…' };
  const out = [`## Agent AI — ${STATUS_RO[r.overall] ?? r.overall}`, '', `${r.summary.counts.PASS} trecute · ${r.summary.counts.WARN} atenționări · ${r.summary.counts.FAIL} eșecuri · ${r.summary.counts.UNKNOWN + r.summary.counts.LEARNING} fără date sau în învățare (${r.summary.total} în total) — ${r.generatedAt}`, ''];
  if (r.narrative?.text) out.push(`> ${r.narrative.text.split('\n').join('\n> ')}`, '', `<sub>${r.narrative.by === 'llm' ? `scris de ${r.narrative.model} (local), verificat cifră cu cifră` : `șablon determinist${r.narrative.reason && r.narrative.reason !== 'disabled' ? ` — ${r.narrative.reason}` : ''}`}</sub>`, '');
  for (const g of r.groups) {
    out.push(`### ${g.label}`, '', '| | Poartă | Valoare | Dovadă |', '|---|---|---|---|');
    for (const x of r.gates.filter((y) => y.group === g.id)) out.push(`| ${icon[x.status] ?? ''} | ${x.title} | ${x.value ?? '—'} | ${String(x.evidence ?? '').replace(/\|/g, '\\|')} |`);
    out.push('');
  }
  if (r.efficiency?.capability) {
    const e = r.efficiency;
    out.push('### Eficiență față de un desk profesional', '', `Paritate ${e.capability.permanent}% permanent · ${e.capability.withKeys}% cu chei gratuite · ${e.capability.achieved}% realizat; prospețime ${e.freshness.observed}% (promisă ${e.freshness.promised}%); fiabilitate ${e.reliability ?? '—'}% → **eficiență efectivă ${e.effective ?? '—'}%** (design ${e.design ?? '—'}%).`, '');
  }
  if ((r.actions ?? []).length) out.push('### Acțiuni', '', ...r.actions.map((a) => `- ${a.ok ? 'pornit' : a.status === 'DRY_RUN' ? 'plan (simulare)' : 'eșuat'}: ${a.workflow} — ${a.reason}`), '');
  return out.join('\n');
}

async function publishReport(ports, report) {
  // The report itself is published: it must pass the same secret scan as the snapshot.
  const scan = scanSecrets([{ name: 'agent.json', text: JSON.stringify(report) }]);
  if (scan.leaks.length) throw new Error(`agent: raportul conține un tipar de cheie (${scan.leaks.map((l) => l.pattern).join(', ')}) — nu se publică`);
  await ports.memory.publish(report, reportMarkdown(report));
}

/** analyze → narrate → act, for local use and the demo. */
export async function runAll({ ports, cfg, nowMs, limits, logger = console, narrateMode = 'auto', dryRun = false }) {
  const a = await analyze({ ports, cfg, nowMs, limits, logger, narrateMode });
  if (a.narrate) await narrate({ ports, nowMs, cfg, logger });
  return act({ ports, nowMs, cfg, logger, dryRun });
}
