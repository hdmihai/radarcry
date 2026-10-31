/**
 * GitHub REST adapter of the agent (CiPort + the issue calls of the notifier).
 *
 * Free by construction: inside Actions it uses the workflow's own GITHUB_TOKEN (1 000 requests an
 * hour per repository); locally, a public repository answers without a token (60 an hour, enough for
 * one pass of ~20 calls). Read endpoints only, plus exactly two writes the agent is allowed:
 *   POST  /actions/workflows/{file}/dispatches   start a workflow the scheduler skipped
 *   POST/PATCH /issues                            one rolling findings issue
 * There is no delete, no cancel, no re-run, no content write — the architecture test checks it.
 */
const API = 'https://api.github.com';

/** @param {any} r @param {(d:any)=>any} fn */
const map = (r, fn) => {
  if (!r.ok) return r;
  try {
    return { ...r, data: fn(r.data) };
  } catch (err) {
    return { ok: false, status: 'INVALID_PAYLOAD', data: null, message: String(err?.message ?? err) };
  }
};

export function normRun(r) {
  return {
    id: r.id,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.run_started_at ?? r.created_at,
    headSha: r.head_sha,
    headBranch: r.head_branch,
    message: String(r.head_commit?.message ?? r.display_title ?? '').split('\n')[0].slice(0, 200),
    attempt: r.run_attempt ?? 1,
    url: r.html_url,
  };
}

/**
 * @param {{token?:string|null, repo:string, fetchImpl?:typeof fetch, timeoutMs?:number, userAgent?:string}} o
 */
export function createGitHub({ token = null, repo, fetchImpl = fetch, timeoutMs = 20_000, userAgent = 'cri-radar-agent' }) {
  const [owner, name] = String(repo ?? '').split('/');
  if (!owner || !name) throw new Error(`agent: repository invalid „${repo}” (aștept owner/nume)`);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': userAgent,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  async function call(method, path, body) {
    try {
      const res = await fetchImpl(`${API}${path}`, {
        method,
        headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text().catch(() => '');
      if (res.status === 204) return { ok: true, status: 'OK', data: null };
      if (!res.ok) {
        const limited = res.status === 429 || (res.status === 403 && /rate limit/i.test(text));
        return { ok: false, status: limited ? 'RATE_LIMITED' : 'HTTP_ERROR', data: null, message: `HTTP ${res.status}: ${text.slice(0, 160).replace(/\s+/g, ' ')}` };
      }
      return { ok: true, status: 'OK', data: text ? JSON.parse(text) : null };
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      return { ok: false, status: timeout ? 'TIMEOUT' : 'NETWORK_ERROR', data: null, message: String(err?.cause?.code ?? err?.message ?? err) };
    }
  }

  return {
    id: 'github',
    repo: async () => map(await call('GET', base), (d) => ({ fullName: d.full_name, defaultBranch: d.default_branch, htmlUrl: d.html_url, owner: d.owner?.login ?? owner, name: d.name, pushedAt: d.pushed_at ?? null })),
    lastCommit: async (branch) => map(await call('GET', `${base}/commits?sha=${encodeURIComponent(branch)}&per_page=1`), (d) => ({ sha: d[0]?.sha ?? null, message: String(d[0]?.commit?.message ?? '').split('\n')[0], at: d[0]?.commit?.committer?.date ?? null })),
    workflows: async () => map(await call('GET', `${base}/actions/workflows?per_page=100`), (d) => (d.workflows ?? []).map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state, createdAt: w.created_at }))),
    runs: async (file, perPage = 100) => map(await call('GET', `${base}/actions/workflows/${encodeURIComponent(file)}/runs?per_page=${perPage}`), (d) => (d.workflow_runs ?? []).map(normRun)),
    jobs: async (runId) => map(await call('GET', `${base}/actions/runs/${runId}/jobs?per_page=50`), (d) => (d.jobs ?? []).map((j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, startedAt: j.started_at, completedAt: j.completed_at, steps: (j.steps ?? []).map((s) => ({ name: s.name, conclusion: s.conclusion, number: s.number })) }))),
    annotations: async (jobId) => map(await call('GET', `${base}/check-runs/${jobId}/annotations?per_page=50`), (d) => (d ?? []).map((a) => ({ level: a.annotation_level, title: a.title ?? null, message: a.message ?? '', path: a.path ?? null }))),
    /** The latest GitHub Pages deployment and its state — the site check when the site itself cannot be read. */
    pagesDeployment: async () => {
      const d = await call('GET', `${base}/deployments?environment=github-pages&per_page=1`);
      if (!d.ok) return d;
      const dep = (d.data ?? [])[0];
      if (!dep) return { ok: false, status: 'NOT_FOUND', data: null, message: 'niciun deploy GitHub Pages' };
      return map(await call('GET', `${base}/deployments/${dep.id}/statuses?per_page=1`), (st) => ({ id: dep.id, sha: dep.sha, createdAt: dep.created_at, state: st[0]?.state ?? null, url: st[0]?.environment_url || null, at: st[0]?.created_at ?? null }));
    },
    dispatch: async (file, ref, inputs) => call('POST', `${base}/actions/workflows/${encodeURIComponent(file)}/dispatches`, { ref, ...(inputs ? { inputs } : {}) }),
    // Issues (the notifier's only surface).
    openIssues: async () => map(await call('GET', `${base}/issues?state=open&per_page=50`), (d) => (d ?? []).filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, body: i.body ?? '', url: i.html_url }))),
    createIssue: async (title, body) => map(await call('POST', `${base}/issues`, { title, body }), (d) => ({ number: d.number, url: d.html_url })),
    updateIssue: async (number, fields) => map(await call('PATCH', `${base}/issues/${Number(number)}`, fields), (d) => ({ number: d.number, url: d.html_url, state: d.state })),
  };
}

/** NotifierPort over the GitHub adapter: one issue, found by its marker, opened, updated or closed. */
export function createIssueNotifier({ gh, marker = '<!-- cri-agent -->' }) {
  return {
    async upsert({ title, body, open }) {
      const list = await gh.openIssues();
      if (!list.ok) return list;
      const current = list.data.find((i) => i.body.includes(marker));
      if (open) {
        // Unchanged findings: no edit, so the issue's history shows only real changes.
        if (current && current.body.trim() === body.trim()) return { ok: true, status: 'OK', data: { number: current.number, url: current.url } };
        if (current) return gh.updateIssue(current.number, { body });
        return gh.createIssue(title, body);
      }
      if (current) return gh.updateIssue(current.number, { body, state: 'closed', state_reason: 'completed' });
      return { ok: true, status: 'OK', data: null };
    },
  };
}
