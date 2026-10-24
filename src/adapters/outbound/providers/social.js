/**
 * SOCIAL / DEVELOPMENT adapters.
 *
 * What is deliberately absent here:
 *  · X (Twitter) API — there is no free read tier; every read is billed. Excluded from code.
 *  · Reddit API — self-service app registration ended in November 2025, so a public repo cannot
 *    obtain credentials reliably. Excluded from code.
 *
 * What replaces them, free:
 *  · GitHub REST — development activity (commits, contributors, cadence). Free token: 5 000
 *    requests/hour (60/hour unauthenticated).
 *  · YouTube Data API v3 — attention, measured as mentions in recent uploads. Free key, 10 000
 *    quota units per day; a search costs 100 units, so the ledger charges 100 per search and the
 *    gate stops at 95 % of the daily allowance.
 */
import { isNum, median, round, toNum } from '../../../domain/shared/math.js';
import { DAY_MS } from '../../../domain/shared/time.js';
import { parseGithub } from '../../../domain/shared/repos.js';
import { disabled, mapResult, notConfigured } from './common.js';

export { parseGithub };

/* ─────────────────────────────────────────── GitHub ─────────────────────────────────────────── */

/**
 * Turn a commit-activity payload (52 weeks of { week, total }) into the development facts the
 * Smart Money Score and the change detector read.
 */
export function devActivity(weeks, { nowMs = Date.now() } = {}) {
  const rows = (weeks ?? []).map((w) => ({ at: (toNum(w.week) ?? 0) * 1000, total: toNum(w.total) ?? 0 })).filter((w) => w.at > 0);
  if (!rows.length) throw new Error('fără activitate de commit-uri raportată');
  rows.sort((a, b) => a.at - b.at);
  const since = (days) => rows.filter((r) => nowMs - r.at <= days * DAY_MS);
  const sum = (xs) => xs.reduce((s, r) => s + r.total, 0);
  const last30 = sum(since(30));
  const prev30 = sum(rows.filter((r) => nowMs - r.at > 30 * DAY_MS && nowMs - r.at <= 60 * DAY_MS));
  const yearly = sum(rows);
  const weekly = rows.map((r) => r.total);
  return {
    commits30d: last30,
    commits60to30d: prev30,
    commitsChangePct: prev30 > 0 ? round(((last30 / prev30) - 1) * 100, 1) : null,
    commits365d: yearly,
    medianWeekly: round(median(weekly), 1),
    activeWeeks52: weekly.filter((x) => x > 0).length,
    lastCommitAt: new Date(rows[rows.length - 1].at).toISOString(),
    stale: nowMs - rows[rows.length - 1].at > 90 * DAY_MS,
  };
}

export function createGithub({ http, cfg, token = null }) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const opt = (endpoint, extra = {}) => ({
    provider: 'github',
    endpoint,
    headers,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    minIntervalMs: cfg.minIntervalMs,
    maxCalls: cfg.maxCalls,
    breakerThreshold: 3,
    ...extra,
  });

  /** Repository metadata: stars, forks, archived, pushed_at. */
  const repo = async (owner, name) => {
    if (!cfg.enabled) return disabled('github', '/repos');
    return mapResult(
      await http.getJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, opt('/repos/:owner/:repo', { retries: 1, validate: (d) => d && typeof d.full_name === 'string' })),
      (d) => ({
        fullName: d.full_name,
        stars: toNum(d.stargazers_count),
        forks: toNum(d.forks_count),
        openIssues: toNum(d.open_issues_count),
        archived: d.archived === true,
        pushedAt: d.pushed_at ?? null,
        language: d.language ?? null,
        url: d.html_url ?? null,
      }),
    );
  };

  /** 52 weeks of commit activity. GitHub answers 202 with an empty body while it computes. */
  const commitActivity = async (owner, name, { nowMs = Date.now() } = {}) => {
    if (!cfg.enabled) return disabled('github', '/stats/commit_activity');
    const res = await http.getJson(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/stats/commit_activity`,
      opt('/stats/commit_activity', { retries: 1, validate: (d) => Array.isArray(d) }),
    );
    if (!res.ok) return res;
    if (!res.data.length) {
      return { ...res, ok: false, status: 'SKIPPED', data: null, message: 'GitHub încă agregă statisticile acestui depozit (răspuns 202/gol) — se reia la rularea următoare' };
    }
    return mapResult(res, (rows) => devActivity(rows, { nowMs }));
  };

  /*
   * Only commit activity is exposed. A contributor list was tried and dropped: the free token is
   * 5 000 requests an hour shared with every other GitHub call in the run, and contributor count
   * never entered a score — commit cadence is what the change engine compares against its norm.
   * Keeping an unused second call here would spend budget on a number nothing reads, and would be
   * a code path the demo never exercises.
   */
  return { id: 'github', repo, commitActivity, parse: parseGithub };
}

/* ─────────────────────────────────────────── YouTube ────────────────────────────────────────── */

export const YOUTUBE_SEARCH_UNITS = 100;

/** Tickers that are ordinary English words: a bare match on these is noise, so require the cashtag. */
export const WORD_TICKERS = new Set([
  'ai', 'go', 'on', 'in', 'at', 'it', 'me', 'my', 'we', 'up', 'id', 'is', 'or', 'so', 'to', 'by', 'do', 'if', 'no',
  'all', 'and', 'any', 'api', 'app', 'arb', 'art', 'bar', 'bay', 'bid', 'big', 'bit', 'box', 'boy', 'bug', 'bus',
  'buy', 'cad', 'can', 'cap', 'car', 'cat', 'ceo', 'cow', 'cut', 'day', 'dog', 'ear', 'eat', 'end', 'eth', 'eye',
  'fan', 'far', 'fun', 'gas', 'gem', 'get', 'gin', 'god', 'gun', 'hat', 'hit', 'hot', 'ice', 'inj', 'job', 'joy',
  'key', 'kid', 'lab', 'law', 'leo', 'let', 'lot', 'low', 'man', 'map', 'may', 'mix', 'mob', 'moo', 'net', 'new',
  'nft', 'now', 'oil', 'old', 'one', 'our', 'out', 'own', 'pay', 'pen', 'pet', 'pie', 'pig', 'pop', 'pro', 'put',
  'ray', 'red', 'rio', 'run', 'sea', 'see', 'set', 'she', 'sky', 'son', 'sun', 'tea', 'the', 'tip', 'top', 'toy',
  'try', 'two', 'use', 'van', 'war', 'way', 'web', 'who', 'why', 'win', 'yes', 'you', 'zen',
]);

/**
 * Build a matcher for one asset. The bare ticker only counts when written in capitals (how tickers
 * are actually written), the cashtag counts in any case, and the project name counts as a phrase.
 */
export function mentionMatcher({ symbol, name }) {
  const sym = String(symbol ?? '').trim();
  const nm = String(name ?? '').trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tests = [];
  if (sym) {
    tests.push(new RegExp(`\\$${esc(sym)}\\b`, 'i'));
    const ambiguous = WORD_TICKERS.has(sym.toLowerCase()) || sym.length <= 2;
    if (!ambiguous) tests.push(new RegExp(`\\b${esc(sym)}\\b`));
  }
  if (nm && nm.length >= 4 && nm.toLowerCase() !== sym.toLowerCase()) tests.push(new RegExp(`\\b${esc(nm)}\\b`, 'i'));
  return (text) => {
    const t = String(text ?? '');
    return tests.some((re) => re.test(t));
  };
}

/** Aggregate matched items into the mention facts used by the change detector. */
export function mentionStats(items, matcher, { nowMs = Date.now() } = {}) {
  const hits = [];
  for (const it of items ?? []) {
    const sn = it.snippet ?? {};
    const text = `${sn.title ?? ''} ${sn.description ?? ''}`;
    if (!matcher(text)) continue;
    const at = sn.publishedAt ? Date.parse(sn.publishedAt) : null;
    hits.push({
      title: sn.title ?? null,
      channel: sn.channelTitle ?? null,
      at: sn.publishedAt ?? null,
      atMs: Number.isFinite(at) ? at : null,
      videoId: it.id?.videoId ?? null,
    });
  }
  const within = (days) => hits.filter((h) => isNum(h.atMs) && nowMs - h.atMs <= days * DAY_MS).length;
  return {
    mentions7d: within(7),
    mentions30d: within(30),
    channels: new Set(hits.map((h) => h.channel).filter(Boolean)).size,
    latest: hits.sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0)).slice(0, 5),
    scanned: (items ?? []).length,
  };
}

export function createYouTube({ http, cfg, apiKey = null }) {
  const opt = (endpoint, extra = {}) => ({
    provider: 'youtube',
    endpoint,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    minIntervalMs: cfg.minIntervalMs,
    maxCalls: cfg.maxCalls,
    breakerThreshold: 3,
    ...extra,
  });

  /**
   * One search = 100 quota units of the 10 000 free daily allowance, so the caller must budget.
   * @param {{symbol:string, name:string, days?:number, max?:number}} o
   */
  const mentions = async ({ symbol, name, days = 30, max = 50 }, { nowMs = Date.now() } = {}) => {
    const endpoint = '/youtube/v3/search';
    if (!cfg.enabled) return disabled('youtube', endpoint);
    if (!apiKey) {
      return notConfigured('youtube', endpoint,
        'lipsește YOUTUBE_API_KEY — cheia este gratuită (10 000 unități/zi, o căutare costă 100) și înlocuiește API-ul X, care nu are nivel gratuit de citire');
    }
    const publishedAfter = new Date(nowMs - days * DAY_MS).toISOString();
    const q = `${name} ${symbol} crypto`;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=${Math.min(max, 50)}`
      + `&publishedAfter=${encodeURIComponent(publishedAfter)}&q=${encodeURIComponent(q)}&key=${encodeURIComponent(apiKey)}`;
    const res = await http.getJson(url, opt(endpoint, { units: YOUTUBE_SEARCH_UNITS, retries: 1, validate: (d) => Array.isArray(d?.items) }));
    if (!res.ok) return res;
    return mapResult(res, (d) => mentionStats(d.items, mentionMatcher({ symbol, name }), { nowMs }));
  };

  return { id: 'youtube', mentions, unitsPerSearch: YOUTUBE_SEARCH_UNITS };
}
