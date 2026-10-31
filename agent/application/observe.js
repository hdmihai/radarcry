/**
 * OBSERVE — one pass over everything the agent watches, normalised into the observation object the
 * gates read. Every source is optional: a port that does not answer leaves its part null, and the
 * gates that depend on it report UNKNOWN.
 *
 * Calls per run (live): 1 repository + 1 last commit + 1 workflow list + 1 run list per workflow
 * (5) + jobs and annotations of the latest completed CI, scan and probe runs (≈ 9) + 1 Pages fetch
 * + 1–3 public price calls ≈ 20 requests — against GitHub's 1 000 requests an hour per repository
 * for the workflow token.
 */

/** Statuses of a run that count as "the latest result" (a cancelled or skipped run says nothing). */
const DECISIVE = new Set(['success', 'failure', 'timed_out', 'startup_failure', 'action_required']);

/** The CI gate report: one notice annotation `cri-gates` plus one error annotation per failed test. */
export function parseGateReport(annotations) {
  const notice = (annotations ?? []).find((a) => a.title === 'cri-gates');
  if (!notice) return null;
  const groups = {};
  for (const m of String(notice.message ?? '').matchAll(/([a-z][a-z.]*)=(\d+)\/(\d+)/g)) {
    const pass = Number(m[2]);
    const total = Number(m[3]);
    groups[m[1]] = { pass, fail: Math.max(0, total - pass), total };
  }
  const failures = (annotations ?? [])
    .filter((a) => typeof a.title === 'string' && a.title.startsWith('gate:'))
    .map((a) => ({ group: a.title.slice(5), name: String(a.message ?? '').split('\n')[0].slice(0, 200), message: String(a.message ?? '').slice(0, 600) }));
  return { groups, failures };
}

/** Decode a { fields, rows } table into objects. */
export function decodeTable(table) {
  const fields = table?.fields ?? [];
  return (table?.rows ?? []).map((row) => Object.fromEntries(fields.map((f, j) => [f, row[j]])));
}

/** Patterns that must never appear in a published file. */
export const SECRET_PATTERNS = Object.freeze([
  { id: 'url-key', re: /[?&](?:api[-_]?key|apikey|access[-_]?token|auth[-_]?token|key|token)=[A-Za-z0-9_-]{16,}/i },
  { id: 'coingecko-key', re: /\bCG-[A-Za-z0-9]{20,}\b/ },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { id: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/ },
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]);

export function scanSecrets(files) {
  const leaks = [];
  let bytes = 0;
  for (const f of files ?? []) {
    const text = String(f.text ?? '');
    bytes += text.length;
    for (const p of SECRET_PATTERNS) if (p.re.test(text)) leaks.push({ file: f.name, pattern: p.id });
  }
  return { files: (files ?? []).length, bytesKb: Math.round(bytes / 1024), leaks };
}

/** The parts of the published snapshot the gates read. */
export function snapshotView(s) {
  if (!s?.meta) return null;
  const rows = [...(s.discovery?.rows ?? []), ...(s.candidates ?? [])];
  return {
    generatedAt: s.meta.generatedAt ?? null,
    pulsedAt: s.meta.pulsedAt ?? null,
    mode: s.meta.mode ?? null,
    runId: s.meta.runId ?? null,
    durationMs: s.meta.durationMs ?? null,
    overall: s.health?.overall ?? null,
    coverage: s.health?.coverage?.sources ?? [],
    providers: (s.health?.providers ?? []).map((p) => ({ id: p.id, label: p.label, status: p.status, failures: p.failures ?? 0, calls: p.calls ?? 0, successRateHistory: p.successRateHistory ?? null, message: String(p.message ?? '').slice(0, 300), keyed: p.keyed ?? null })),
    quota: (s.quota?.providers ?? []).map((q) => ({ provider: q.provider, label: q.label, configured: q.configured, projectedShare: q.projectedShare ?? null, shareMonth: q.shareMonth ?? null, paused: q.paused === true })),
    validity: s.validity?.summary ?? null,
    eligible: s.health?.universe?.eligible ?? null,
    universe: s.health?.universe ?? null,
    rejectedInLists: rows.filter((r) => r?.validity?.status === 'REJECTED').length,
    forecast: s.forecast ?? null,
    parity: s.parity ? { permanent: s.parity.permanent, withKeys: s.parity.withKeys, achieved: s.parity.achieved } : null,
    trackRecord: s.trackRecord?.cohort ?? null,
  };
}

/**
 * @param {{ports:{ci:any, state:any, site?:any}, cfg:any, nowMs:number}} o
 */
export async function observe({ ports, cfg, nowMs }) {
  const { ci, state, site } = ports;
  const nowIso = new Date(nowMs).toISOString();
  const calls = { github: 0, site: 0 };

  const repoR = await ci.repo();
  calls.github += 1;
  const repoInfo = repoR.ok ? repoR.data : null;
  const branch = repoInfo?.defaultBranch ?? cfg.branch ?? 'main';
  const commitR = await ci.lastCommit(branch);
  calls.github += 1;
  const wfR = await ci.workflows();
  calls.github += 1;
  const byFile = new Map((wfR.ok ? wfR.data : []).map((w) => [String(w.path ?? '').split('/').pop(), w]));

  const workflows = {};
  for (const w of cfg.workflows ?? []) {
    const meta = byFile.get(w.file) ?? null;
    const runsR = await ci.runs(w.file, 100);
    calls.github += 1;
    const runs = (runsR.ok ? runsR.data : [])
      .filter((r) => !r.headBranch || r.headBranch === branch)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const latest = runs.find((r) => r.status === 'completed' && DECISIVE.has(r.conclusion)) ?? null;
    const lastSuccess = runs.find((r) => r.conclusion === 'success') ?? null;
    let jobs = [];
    let annotations = [];
    if (latest && w.inspect !== false) {
      const jR = await ci.jobs(latest.id);
      calls.github += 1;
      jobs = jR.ok ? jR.data : [];
      for (const j of jobs.slice(0, 4)) {
        const aR = await ci.annotations(j.id);
        calls.github += 1;
        if (aR.ok) annotations.push(...aR.data.map((a) => ({ ...a, job: j.name })));
      }
    }
    workflows[w.role] = {
      file: w.file,
      role: w.role,
      name: meta?.name ?? w.name ?? w.file,
      state: meta?.state ?? null,
      createdAt: meta?.createdAt ?? null,
      cron: w.cron ?? null,
      cadence: w.cadence ?? null,
      maxAgeDays: w.maxAgeDays ?? null,
      runs,
      runsOk: runsR.ok,
      latest,
      lastSuccess,
      jobs,
      annotations,
      gateReport: w.role === 'ci' ? parseGateReport(annotations) : null,
    };
  }

  const snapR = await state.snapshot();
  const snapshot = snapR.ok ? snapshotView(snapR.data) : null;
  const metaR = await state.meta();
  const telemetryR = await state.telemetry();
  const publishedR = await state.published();
  const universeR = await state.universe();
  const universeRows = universeR.ok ? decodeTable(universeR.data?.assets) : [];

  let pages = null;
  if (site) {
    const pR = await site.summary();
    calls.site += 1;
    pages = pR.ok ? { ok: true, url: pR.data.url, generatedAt: pR.data.generatedAt, status: 'OK', reason: null } : { ok: false, url: pR.data?.url ?? null, generatedAt: null, status: pR.message || pR.status, reason: pR.status };
  }
  // The site could not be read from here (a network error, not an HTTP answer): the deployment
  // record says whether the last publish succeeded.
  if ((!pages || (!pages.ok && pages.reason !== 'HTTP_ERROR')) && ci.pagesDeployment) {
    const dR = await ci.pagesDeployment();
    calls.github += 2;
    if (dR.ok) pages = { ok: dR.data.state === 'success', via: 'deployments', url: dR.data.url ?? pages?.url ?? null, generatedAt: null, status: `deploy ${dR.data.state}`, reason: dR.data.state === 'success' ? null : `DEPLOY_${String(dR.data.state).toUpperCase()}`, state: dR.data.state, deployedAt: dR.data.at ?? dR.data.createdAt, sha: dR.data.sha };
  }

  return {
    nowMs,
    nowIso,
    repo: repoInfo ? { ...repoInfo, defaultBranch: branch, lastCommitAt: commitR.ok ? commitR.data.at : null, lastCommitSha: commitR.ok ? commitR.data.sha : null, lastCommitMessage: commitR.ok ? commitR.data.message : null } : null,
    workflows,
    snapshot,
    stateMeta: metaR.ok ? metaR.data : null,
    telemetry: telemetryR.ok && Array.isArray(telemetryR.data) ? telemetryR.data : [],
    universe: { generatedAt: universeR.ok ? universeR.data?.generatedAt ?? null : null, rows: universeRows },
    pages,
    secrets: publishedR.ok ? scanSecrets(publishedR.data) : null,
    calls,
    sources: { repo: repoR.ok, workflows: wfR.ok, snapshot: snapR.ok, universe: universeR.ok, site: pages?.ok ?? null },
  };
}

/** Commits that landed on the default branch, from the CI push runs (sha, first line, time). */
export function commitsFrom(obs) {
  const seen = new Set();
  const out = [];
  for (const r of [...(obs.workflows?.ci?.runs ?? []), ...(obs.workflows?.scan?.runs ?? [])]) {
    if (r.event !== 'push' || !r.headSha || seen.has(r.headSha)) continue;
    seen.add(r.headSha);
    out.push({ sha: r.headSha, message: String(r.message ?? '').split('\n')[0], at: r.createdAt });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
