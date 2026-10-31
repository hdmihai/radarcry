/**
 * CADENCE — how often each workflow actually ran, against how often its schedule promised.
 *
 * GitHub's scheduler is best-effort, and this project measured the gap: in its first week the full
 * scan (cron every 4 h, 6 a day) ran about 3 times a day and the pulse (cron every 15 min, 96 a day)
 * about 5 times. The ratio observed/promised is what the dashboard's "every 4 hours" is really
 * worth, so it is computed from the run list, never assumed.
 *
 * Every event counts toward the observed cadence (schedule, dispatch, push): what matters for the
 * freshness of the data is that a scan ran, not who started it.
 *
 * Pure: `nowMs` arrives as an argument.
 */
import { cadenceOf } from './cron.js';
import { DAY_MS, HOUR_MS, isNum, median, quantile, round, toMs } from './stats.js';

/**
 * @param {{createdAt:string, event?:string, status?:string, conclusion?:string|null}[]} runs
 * @param {{nowMs:number, windowDays?:number, cron?:string|null}} o
 */
export function observedCadence(runs, { nowMs, windowDays = 7, cron = null } = {}) {
  const from = nowMs - windowDays * DAY_MS;
  const all = (runs ?? []).map((r) => ({ ...r, t: toMs(r.createdAt) })).filter((r) => isNum(r.t)).sort((a, b) => a.t - b.t);
  const inWin = all.filter((r) => r.t >= from && r.t <= nowMs);
  // A workflow younger than the window is measured over its own life, not penalised for days it did not exist.
  const firstAt = all.length ? all[0].t : null;
  const spanDays = firstAt === null ? windowDays : Math.max(1 / 24, Math.min(windowDays, (nowMs - Math.max(from, firstAt)) / DAY_MS));
  const gaps = [];
  for (let i = 1; i < inWin.length; i += 1) gaps.push((inWin[i].t - inWin[i - 1].t) / HOUR_MS);
  const ok = all.filter((r) => r.conclusion === 'success');
  // A workflow may declare several schedules; their promises add up.
  const crons = cron ? [].concat(cron).filter(Boolean) : [];
  const promisedPerDay = crons.length ? crons.reduce((s, c) => s + cadenceOf(c).perDay, 0) : null;
  const perDay = inWin.length / spanDays;
  return {
    windowDays,
    spanDays: round(spanDays, 2),
    runs: inWin.length,
    scheduled: inWin.filter((r) => r.event === 'schedule').length,
    perDay: round(perDay, 2),
    expectedPerDay: promisedPerDay === null ? null : round(promisedPerDay, 3),
    ratio: promisedPerDay > 0 ? round(Math.min(1, perDay / promisedPerDay), 3) : null,
    medianGapHours: round(median(gaps), 2),
    p90GapHours: round(quantile(gaps, 0.9), 2),
    maxGapHours: gaps.length ? round(Math.max(...gaps), 2) : null,
    lastAt: all.length ? new Date(all[all.length - 1].t).toISOString() : null,
    lastSuccessAt: ok.length ? new Date(ok[ok.length - 1].t).toISOString() : null,
    sinceLastHours: all.length ? round((nowMs - all[all.length - 1].t) / HOUR_MS, 2) : null,
    sinceSuccessHours: ok.length ? round((nowMs - ok[ok.length - 1].t) / HOUR_MS, 2) : null,
    active: (runs ?? []).filter((r) => r.status && r.status !== 'completed').length,
  };
}

/** Success rate over the window, with the count it rests on (completed runs only). */
export function reliability(runs, { nowMs, windowDays = 14 } = {}) {
  const from = nowMs - windowDays * DAY_MS;
  const done = (runs ?? []).filter((r) => r.status === 'completed' && isNum(toMs(r.createdAt)) && toMs(r.createdAt) >= from && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');
  const ok = done.filter((r) => r.conclusion === 'success').length;
  return { n: done.length, ok, rate: done.length ? round(ok / done.length, 3) : null, windowDays };
}

/**
 * A failure that later passes on the *same commit* was transient (a rate limit, a slow source), not
 * broken code — the distinction decides whether the remedy is "fix the code" or "tolerate the noise".
 * Two shapes count: a run that passed on a re-run (attempt > 1), and a failed run followed by a green
 * one of the same commit (scheduled workflows run one commit many times).
 */
export function flakiness(runs) {
  const done = (runs ?? []).filter((r) => r.headSha && r.status === 'completed').map((r) => ({ ...r, t: toMs(r.createdAt) })).sort((a, b) => a.t - b.t);
  const reruns = done.filter((r) => r.conclusion === 'success' && (r.attempt ?? 1) > 1).length;
  const bySha = new Map();
  for (const r of done) bySha.set(r.headSha, [...(bySha.get(r.headSha) ?? []), r]);
  let transient = 0;
  for (const list of bySha.values()) {
    const firstFail = list.findIndex((r) => r.conclusion === 'failure');
    if (firstFail >= 0 && list.slice(firstFail + 1).some((r) => r.conclusion === 'success')) transient += 1;
  }
  return { reruns, transient, commits: bySha.size };
}
