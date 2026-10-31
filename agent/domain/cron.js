/**
 * CRON — what a workflow's schedule promises, so the agent can compare it with what GitHub delivered.
 *
 * GitHub runs scheduled workflows on a best-effort basis: runs start late at busy times and some are
 * dropped altogether. The promise is computed exactly from the five-field expression (UTC, the way
 * GitHub reads it), by walking a whole non-leap year minute by minute — 525 600 checks, a few
 * milliseconds — so step values, ranges, lists and the day-of-month / day-of-week OR rule all count
 * correctly without a special case for each shape.
 *
 * Pure: no clock. The reference year is fixed, so the answer never depends on when it is asked.
 */
import { DAY_MS } from './stats.js';

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dow', min: 0, max: 6 },
];

/** One field → the set of values it matches, plus whether it was a wildcard. */
function parseField(text, { min, max, name }) {
  const values = new Set();
  const wildcard = text === '*' || text === '?';
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`cron: pas invalid „${part}” în câmpul ${name}`);
    let lo;
    let hi;
    if (range === '*' || range === '?') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      [lo, hi] = range.split('-').map(Number);
    } else {
      lo = Number(range);
      hi = stepText === undefined ? lo : max;
    }
    if (name === 'dow') {
      if (lo === 7) lo = 0;
      if (hi === 7) hi = 6;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) throw new Error(`cron: valoare invalidă „${part}” în câmpul ${name}`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, wildcard };
}

/** @returns {{minute:Set<number>, hour:Set<number>, dom:Set<number>, month:Set<number>, dow:Set<number>, domStar:boolean, dowStar:boolean}} */
export function parseCron(expr) {
  const parts = String(expr ?? '').trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron: sunt necesare 5 câmpuri, nu ${parts.length} („${expr}”)`);
  const f = parts.map((p, i) => parseField(p, FIELDS[i]));
  return { minute: f[0].values, hour: f[1].values, dom: f[2].values, month: f[3].values, dow: f[4].values, domStar: f[2].wildcard, dowStar: f[4].wildcard };
}

/** Does the parsed expression fire at this UTC minute? (Vixie rule: dom OR dow when both are set.) */
export function matches(c, ms) {
  const d = new Date(ms);
  if (!c.minute.has(d.getUTCMinutes()) || !c.hour.has(d.getUTCHours()) || !c.month.has(d.getUTCMonth() + 1)) return false;
  const domOk = c.dom.has(d.getUTCDate());
  const dowOk = c.dow.has(d.getUTCDay());
  if (c.domStar && c.dowStar) return true;
  if (c.domStar) return dowOk;
  if (c.dowStar) return domOk;
  return domOk || dowOk;
}

const YEAR_START = Date.UTC(2026, 0, 1);
const YEAR_MINUTES = 365 * 24 * 60;
const memo = new Map();

/**
 * Runs promised per day, on average over a year, and the nominal interval between them in hours.
 * @returns {{perDay:number, intervalHours:number, perYear:number}}
 */
export function cadenceOf(expr) {
  if (memo.has(expr)) return memo.get(expr);
  const c = parseCron(expr);
  let n = 0;
  for (let i = 0; i < YEAR_MINUTES; i += 1) if (matches(c, YEAR_START + i * 60_000)) n += 1;
  const out = { perYear: n, perDay: n / 365, intervalHours: n ? (365 * 24) / n : null };
  memo.set(expr, out);
  return out;
}

/** The fire times of an expression in [fromMs, toMs) — bounded, for overdue checks and tests. */
export function fireTimes(expr, fromMs, toMs, limit = 2000) {
  const c = parseCron(expr);
  const out = [];
  const start = Math.ceil(fromMs / 60_000) * 60_000;
  for (let t = start; t < toMs && out.length < limit; t += 60_000) if (matches(c, t)) out.push(t);
  return out;
}

/** The last time the schedule should have fired at or before `nowMs` (looks back at most `days`). */
export function lastFireBefore(expr, nowMs, days = 35) {
  const c = parseCron(expr);
  const end = Math.floor(nowMs / 60_000) * 60_000;
  for (let t = end; t > end - days * DAY_MS; t -= 60_000) if (matches(c, t)) return t;
  return null;
}
