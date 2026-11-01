/**
 * PLAIN TEXT — how the agent writes: sentences, Romanian numbers, local time, no markup.
 *
 * The agent talks to its owner in comments on a phone and in a terminal, where Markdown is noise
 * (asterisks, pipes, backticks). Every answer is therefore plain text: short paragraphs, at most a
 * „- ” list, decimals with a comma, thousands with a space, times in the owner's time zone. A text
 * written by a language model is cleaned of whatever markup it still produced.
 *
 * Pure (time zones are formatted, never read from a clock).
 */
import { isNum, round } from './stats.js';

export const DEFAULT_TZ = 'Europe/Bucharest';

/** A number the Romanian way: 2 362 · 10,1 · −11,4 (trailing zeros dropped). */
export function ro(x, digits = 1) {
  if (!isNum(x)) return '—';
  const r = round(x, digits);
  const [int, frac = ''] = Math.abs(r).toFixed(digits).split('.');
  const grouped = int.length > 3 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : int;
  const f = frac.replace(/0+$/, '');
  return `${r < 0 ? '−' : ''}${grouped}${f ? `,${f}` : ''}`;
}

export const pct = (x, digits = 1) => (isNum(x) ? `${ro(x, digits)}%` : '—');

/** Romanian numerals take „de” from 20 on: „3 porți”, „24 de porți”. */
export const n = (count, one, many) => (count === 1 ? `1 ${one}` : `${ro(count, 0)} ${Number.isInteger(count) && (count % 100 >= 20 || (count !== 0 && count % 100 === 0)) ? 'de ' : ''}${many}`);

/** „a, b și c”. */
export function list(items) {
  const a = (items ?? []).filter((x) => x !== null && x !== undefined && x !== '');
  if (a.length <= 1) return a.join('');
  return `${a.slice(0, -1).join(', ')} și ${a.at(-1)}`;
}

/**
 * Markdown's hard-wrapped lines joined back into their paragraph or list item (a phone wraps text by
 * itself); headings, list items, table rows and code blocks keep their own lines.
 */
export function unwrap(md) {
  const out = [];
  let fence = false;
  for (const raw of String(md ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*```/.test(line)) {
      fence = !fence;
      out.push(line);
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }
    const prev = out.length ? out[out.length - 1] : null;
    const block = /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|\||>)/.test(line);
    const open = prev !== null && prev.trim() !== '' && !/^\s*(#{1,6}\s|\||```)/.test(prev);
    if (line.trim() && !block && open) out[out.length - 1] = `${prev} ${line.trim()}`;
    else out.push(line);
  }
  return out.join('\n');
}

/**
 * A passage quoted to the owner: its lines kept (a list stays a list), at most max characters,
 * cut at a line or a word.
 */
export function passage(s, max = 700) {
  const lines = String(s ?? '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const out = [];
  let len = 0;
  for (const l of lines) {
    if (len + l.length > max) {
      if (!out.length || max - len > 120) out.push(cut(l, Math.max(max - len, 120)));
      else out.push('…');
      break;
    }
    out.push(l);
    len += l.length + 1;
  }
  return out.join('\n');
}

/** A sentence cut at a word boundary. */
export function cut(s, max = 220) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  return `${head.slice(0, Math.max(head.lastIndexOf(' '), max * 0.6))}…`;
}

const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

/** „31 octombrie, 22:39” in the owner's time zone (an ISO time or milliseconds). */
export function when(iso, tz = DEFAULT_TZ) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '—';
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]}, ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  } catch {
    return `${String(iso).slice(0, 16).replace('T', ' ')} UTC`;
  }
}

/**
 * Markdown (or HTML) turned into plain text: what a model or a document passage may still contain.
 */
export function plain(text) {
  let s = String(text ?? '').replace(/\r\n?/g, '\n');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\/?(details|summary|sub|sup|br|p|div|span|b|i|em|strong|code|pre)[^>]*>/gi, '');
  s = s.replace(/^```[^\n]*\n?/gm, '');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  // Tables: the separator row goes, the other rows become „a — b — c”.
  s = s.replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$\n?/gm, '');
  s = s.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (m, row) => row.split('|').map((c) => c.trim()).filter(Boolean).join(' — '));
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
  s = s.replace(/^[ \t]{0,3}>[ \t]?/gm, '');
  // Emphasis only around words: a cron expression („17 */4 * * *”) keeps its asterisks.
  s = s.replace(/\*\*(?=[^*\n]*\p{L})(\S(?:[^*\n]*\S)?)\*\*/gu, '$1').replace(/__(?=[^_\n]*\p{L})(\S(?:[^_\n]*\S)?)__/gu, '$1');
  s = s.replace(/(^|[\s(„])\*(?=[^*\n]*\p{L})(\S(?:[^*\n]*\S)?)\*(?=[\s).,;:!?”]|$)/gmu, '$1$2').replace(/(^|[\s(„])_(?=[^_\n]*\p{L})(\S(?:[^_\n]*\S)?)_(?=[\s).,;:!?”]|$)/gmu, '$1$2');
  s = s.replace(/`([^`\n]+)`/g, '$1').replace(/`+/g, '');
  s = s.replace(/^[ \t]*[*+][ \t]+/gm, '- ');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * The decimals of a measured text the Romanian way („3.43/zi” → „3,43/zi”, „×2.78” → „×2,78”);
 * dotted names and versions („scan.run”, „v1.2.3”, „qwen2.5”) are left alone.
 */
export const roText = (s) => String(s ?? '').replace(/(?<![\w.,:])(\d+)\.(\d+)(?![\w.]|,\d)/g, '$1,$2');

/** A calendar day: „2025-12-02” → „2 decembrie 2025”. */
export function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '—';
}

/**
 * The times of a measured text as the owner reads them: „2026-10-17T09:15:36Z” and „2026-11-01 06:18
 * UTC” become „17 octombrie, 12:15” and „1 noiembrie, 08:18” in the owner's time zone.
 */
export const isoText = (s, tz = DEFAULT_TZ) =>
  String(s ?? '')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})(?![\w:])/g, (m) => when(m, tz))
    .replace(/\b(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC\b/g, (m, d, t) => when(`${d}T${t}:00Z`, tz));

/** Whether a text still carries Markdown that a phone or a terminal would show as noise. */
export function hasMarkup(text) {
  return /\*\*|`|^[ \t]{0,3}#{1,6}[ \t]|^[ \t]*\|.*\|[ \t]*$|<details|<sub>|\]\(http/m.test(String(text ?? '').replace(/<!--[\s\S]*?-->/g, ''));
}
