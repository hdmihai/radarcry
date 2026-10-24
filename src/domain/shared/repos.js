/**
 * Repository-reference parsing. Pure string work, so it lives in the domain: both the GitHub adapter
 * and the use-case that decides *which* repositories are worth a call need the same parser, and the
 * application layer must never import an adapter to get it.
 */

/** Accepts a repo URL, an `owner/repo` string, or a GitHub URL with extra path segments. */
export function parseGithub(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/.exec(s) ?? /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(s);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/, '');
  if (!repo || repo === '.' || repo === '..' || owner === '.' || owner === '..') return null;
  // "github.com/orgs/foo" and similar non-repository paths are not repositories.
  if (['orgs', 'users', 'topics', 'collections', 'sponsors', 'settings'].includes(owner.toLowerCase())) return null;
  return { owner, repo };
}

/** Pick the most plausible source repository from a coin-detail payload. */
export function pickRepo(candidates) {
  for (const c of candidates ?? []) {
    const parsed = parseGithub(c);
    if (parsed) return parsed;
  }
  return null;
}
