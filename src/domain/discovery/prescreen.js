/**
 * PRESCREEN — which projects deserve the deep-research budget this run.
 *
 * Deep research is the expensive part of a scan: holder lists, contract security, development and
 * attention are only affordable for about sixty projects a run on free plans. Which sixty is the
 * most consequential decision the pipeline makes, because the discovery engine can only answer the
 * project's question for the projects it is shown.
 *
 * Choosing them by the legacy score alone made the answer circular: the engine that looks for
 * "several important things changing at once" only ever saw what an older, price-led model already
 * liked. The prescreen gives part of the budget to the change engine itself, run cheaply on every
 * eligible project with the facts each run already holds for the whole universe — volume, turnover,
 * open interest, funding, new venues — measured against that project's own norm.
 *
 * Pure: no I/O, no clock. The caller passes the change view; this module only ranks it.
 */
import { isNum, round } from '../shared/math.js';
import { CONDITION_KEYS, confluenceOf } from './changes.js';

/**
 * Standing conditions never steer the budget: a token that has had most of its supply circulating
 * for two years is not "changing", and would otherwise win slots every run. whatChanged() already
 * reports them apart from the changes; the filter below also guards hand-built inputs.
 */
export const STATE_DETECTORS = CONDITION_KEYS;

/**
 * Rank key for one project: confluence of the changes that are events, damped by how much of the
 * move is already public. Zero means "nothing is moving against its own norm" — not "bad".
 *
 * @param {{changes?:any[], earliness?:number}|null} changed output of whatChanged()
 * @returns {number}
 */
export function prescreenScore(changed) {
  const events = (changed?.changes ?? []).filter((c) => !STATE_DETECTORS.has(c.key));
  if (!events.length) return 0;
  const earliness = isNum(changed.earliness) ? changed.earliness : 50;
  // An already-obvious move keeps half its weight: still worth a look, never ahead of a quiet one.
  return round(confluenceOf(events) * (0.5 + earliness / 200), 3);
}

/**
 * Pick the projects the change engine asks for, best first, up to `slots`.
 *
 * @param {{key:string, score:number}[]} rows
 * @param {number} slots
 * @returns {string[]} keys
 */
export function prescreenPicks(rows, slots) {
  if (!(slots > 0)) return [];
  return [...(rows ?? [])]
    .filter((r) => isNum(r.score) && r.score > 0)
    .sort((a, b) => b.score - a.score || String(a.key).localeCompare(String(b.key)))
    .slice(0, slots)
    .map((r) => r.key);
}
