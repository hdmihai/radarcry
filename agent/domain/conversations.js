/**
 * CONVERSATIONS — the owner's dialogue with the agent as data: a conversation is a titled list of
 * messages; it is kept (by an adapter) so the dashboard can show the history, and so the agent can
 * look back at what was already said („ce am discutat despre LAB?”) before it answers.
 *
 * Pure: time arrives as an argument, nothing here reads a file or a clock.
 */
import { fold } from './commands.js';
import { isFollowUp } from './intent.js';
import { tokens } from './retrieval.js';
import { cut, list, n, when, DEFAULT_TZ } from './plain.js';

export const LIMITS = Object.freeze({
  textChars: 4000, // what the owner may write in one message
  messageChars: 12000, // what is kept of one message
  messages: 400, // per conversation, the oldest are dropped
  conversations: 300, // listed and searched
  titleChars: 60,
});

export const DEFAULT_TITLE = 'Conversație nouă';
const ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
export const isValidId = (id) => typeof id === 'string' && ID.test(id);

const iso = (ms) => new Date(ms).toISOString();

export function newConversation(id, nowMs) {
  return { version: 1, id, title: DEFAULT_TITLE, pinned: false, createdAt: iso(nowMs), updatedAt: iso(nowMs), messages: [] };
}

/** A title from the first words of a message: one line, cut at a word. */
export function titleOf(text) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/^["„”«»]+|["„”«»]+$/g, '');
  if (!one) return DEFAULT_TITLE;
  if (one.length <= LIMITS.titleChars) return one;
  const head = one.slice(0, LIMITS.titleChars);
  const at = head.lastIndexOf(' ');
  return `${(at > 24 ? head.slice(0, at) : head).replace(/[,;:.\-–—\s]+$/, '')}…`;
}

/** The conversation with one more message (a new object; the input is untouched). */
export function addMessage(conv, { role, text, nowMs, meta = null }) {
  const body = String(text ?? '').slice(0, LIMITS.messageChars);
  const message = { id: (conv.messages.at(-1)?.id ?? 0) + 1, role, text: body, at: iso(nowMs), ...(meta ? { meta } : {}) };
  const messages = [...conv.messages, message].slice(-LIMITS.messages);
  const title = conv.title === DEFAULT_TITLE && role === 'user' ? titleOf(body) : conv.title;
  return { ...conv, title, messages, updatedAt: iso(nowMs) };
}

/** A new title and/or pin; an empty title keeps the old one. */
export function patchConversation(conv, { title, pinned }) {
  const t = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, LIMITS.titleChars) : '';
  return { ...conv, title: t || conv.title, pinned: typeof pinned === 'boolean' ? pinned : conv.pinned };
}

export function summaryOf(conv) {
  const last = [...conv.messages].reverse().find((m) => m.role === 'user') ?? null;
  return { id: conv.id, title: conv.title, pinned: Boolean(conv.pinned), createdAt: conv.createdAt, updatedAt: conv.updatedAt, count: conv.messages.length, preview: last ? cut(last.text, 90) : '' };
}

/** Pinned first, then the most recently active. */
export function sortSummaries(items) {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}

/**
 * What a short follow-up („de ce?”, „detalii”) continues: the last question of this conversation
 * that was a question of its own (not a greeting, not itself a follow-up).
 */
export function topicContext(conv) {
  const m = conv?.messages ?? [];
  for (let i = m.length - 1; i >= 0; i -= 1) {
    if (m[i].role !== 'user' || isFollowUp(m[i].text)) continue;
    const answer = m[i + 1];
    if (answer?.role === 'agent' && ['help', 'greet'].includes(answer.meta?.intent)) continue;
    return m[i].text.slice(0, 6000);
  }
  return null;
}

/** Retrieval items: every question with the answer it got, one passage each. */
export function passagesOf(conversations, { excludeId = null } = {}) {
  const out = [];
  for (const c of conversations) {
    if (c.id === excludeId) continue;
    const m = c.messages ?? [];
    for (let i = 0; i < m.length; i += 1) {
      if (m[i].role !== 'user') continue;
      const answer = m[i + 1]?.role === 'agent' ? m[i + 1] : null;
      out.push({ conversationId: c.id, title: c.title, at: m[i].at, heading: c.title, path: `Conversația „${c.title}”`, question: m[i].text, answer: answer?.text ?? '', text: `${m[i].text}\n${answer?.text ?? ''}` });
    }
  }
  return out;
}

/**
 * The earlier exchanges that touch the words of a query. A history is small and its answers repeat the
 * project's own words („radar”), so a rarity weighting (BM25) would score everything near zero; this is
 * coverage instead: a word of the question or the title counts fully, a word only in the answer half,
 * divided by the words asked. 1 = every word was in a question the owner asked.
 * @returns {(ReturnType<typeof passagesOf>[number] & {score:number})[]} best first, ties to the most recent
 */
export function findPassages(passages, query, { k = 4, minScore = 0.5, minWords = 1 } = {}) {
  const q = [...new Set(tokens(query))];
  if (q.length < minWords) return [];
  const scored = passages.map((p) => {
    const inQ = new Set(tokens(`${p.question} ${p.title}`));
    const inA = new Set(tokens(p.answer));
    const full = q.filter((t) => inQ.has(t)).length;
    const half = q.filter((t) => !inQ.has(t) && inA.has(t)).length;
    return { ...p, score: Math.round(((full + 0.5 * half) / q.length) * 1000) / 1000 };
  });
  return scored.filter((x) => x.score >= minScore).sort((a, b) => b.score - a.score || Date.parse(b.at) - Date.parse(a.at)).slice(0, k);
}

const RECALL = [
  /\bce am (?:discutat|vorbit|stabilit|decis|hotarat|convenit|spus|scris)\b/,
  /\b(?:ai|mai ai) (?:memorie|retinut|tinut minte|notat)\b/,
  /\b(?:iti|ne) (?:amintesti|aduci aminte)\b/,
  /\btii minte\b/,
  /\bam mai (?:vorbit|discutat|intrebat)\b/,
  /\b(?:conversatia|discutia|conversatiile|discutiile) (?:anterioara|anterioare|trecuta|trecute|de (?:ieri|data trecuta))\b/,
  /\bdata trecuta\b/,
  /\bistoric(?:ul)? (?:conversatiilor|discutiilor|chat)/,
  /\bin (?:conversatiile|discutiile) (?:noastre|anterioare)\b/,
  /\bce (?:mi-?ai|ti-?am) (?:spus|raspuns|zis)\b/,
];
const TOPIC_FILLER = /\b(?:ce|am|discutat|vorbit|stabilit|decis|hotarat|convenit|spus|scris|despre|legat|de|cu|privire|la|in|conversatiile|conversatia|discutiile|discutia|noastre|anterioare|anterioara|trecuta|trecute|data|ai|mai|retinut|tinut|minte|notat|memorie|iti|ne|amintesti|aduci|aminte|tii|istoric|istoricul|chat|am|intrebat|mi|ti|ai|zis|raspuns|ieri|azi|mine|pe|care|si|sa|imi|spui|zici|poti|sa-mi|te|rog|nu|vreau|vrei|mea|mele|noastra)\b/g;

/**
 * Is the message a question about what was said before? Then the topic (possibly empty: „ce am
 * discutat?”), else null.
 */
export function recallQuery(text) {
  const f = fold(text);
  if (!RECALL.some((re) => re.test(f))) return null;
  return f.replace(TOPIC_FILLER, ' ').replace(/[^a-z0-9ăâîșț\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The answer to „what did we discuss”: the passages found, or the latest conversations. */
export function answerRecall({ hits, recent, topic, tz = DEFAULT_TZ }) {
  if (hits.length) {
    const head = topic ? `Am găsit ${n(hits.length, 'loc', 'locuri')} în conversațiile noastre despre „${cut(topic, 50)}”:` : `Iată ce am în conversațiile noastre:`;
    const lines = hits.map((h) => `- ${when(h.at, tz)}, în „${cut(h.title, 50)}”: ai întrebat „${cut(h.question, 120)}”${h.answer ? ` și ți-am răspuns: ${cut(stripFooter(h.answer), 260)}` : ''}`);
    return [head, ...lines].join('\n');
  }
  if (topic && recent.length) return `Nu găsesc nimic despre „${cut(topic, 50)}” în conversațiile salvate. Cele mai recente sunt: ${list(recent.slice(0, 3).map((c) => `„${cut(c.title, 40)}” (${when(c.updatedAt, tz)})`))}.`;
  if (recent.length) return `Cele mai recente conversații ale noastre: ${list(recent.slice(0, 5).map((c) => `„${cut(c.title, 40)}” (${when(c.updatedAt, tz)})`))}. Spune-mi un subiect și caut în ele.`;
  return 'Nu am încă nicio conversație salvată. De aici înainte le țin minte și pot căuta în ele.';
}

/** A short note added to a free answer when an earlier conversation was about the same thing. */
export function relatedNote(hits, { tz = DEFAULT_TZ } = {}) {
  if (!hits.length) return '';
  const h = hits[0];
  return `\n\nDin conversațiile noastre anterioare: pe ${when(h.at, tz)}, în „${cut(h.title, 50)}”, ai întrebat „${cut(h.question, 100)}”${h.answer ? ` și ți-am spus: ${cut(stripFooter(h.answer), 200)}` : ''}`;
}

/** The agent's signature line is not part of what it said. */
export function stripFooter(text) {
  return String(text ?? '').replace(/\n+— Agentul AI[^\n]*$/u, '').trim();
}

/** A conversation as a text file the owner can keep. */
export function exportText(conv, tz = DEFAULT_TZ) {
  const head = [`${conv.title}`, `Conversație cu agentul AI al CRI Radar, începută pe ${when(conv.createdAt, tz)}, ${n(conv.messages.length, 'mesaj', 'mesaje')}.`, ''];
  const body = conv.messages.map((m) => `[${when(m.at, tz)}] ${m.role === 'user' ? 'Tu' : 'Agent'}:\n${m.text}`);
  return `${[...head, ...body].join('\n\n')}\n`;
}

/** A file name safe on every system. */
export const fileNameOf = (conv) => `${fold(conv.title).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'conversatie'}-${String(conv.id).slice(0, 8)}`;
