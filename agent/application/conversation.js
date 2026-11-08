/**
 * CONVERSATION — the dashboard's chat with the agent. One use-case per thing the screen does: list the
 * history, open a conversation, send a message, rename or pin, delete, export. A message goes through
 * the same understanding as every other channel (application/chat.js); before that, a question about
 * what was said earlier is answered from the saved conversations, and a free question is completed
 * with a related earlier exchange when there is one.
 *
 * The one port it needs is ConversationsPort; everything else is optional, as in chat().
 */
import { CHAT_MARKER } from '../domain/chat.js';
import { LIMITS, addMessage, answerRecall, exportText, fileNameOf, findPassages, isValidId, newConversation, passagesOf, patchConversation, recallQuery, relatedNote, sortSummaries, summaryOf, topicContext } from '../domain/conversations.js';
import { DEFAULT_TZ, plain } from '../domain/plain.js';
import { chat } from './chat.js';

const BAD = { ok: false, status: 400 };
const missing = { ok: false, status: 404, message: 'conversația nu există' };

/** The reply without the hidden marker line the GitHub channel uses. */
const visible = (reply) => String(reply ?? '').replace(CHAT_MARKER, '').replace(/^\n/, '');

export async function listConversations({ ports }) {
  const all = await ports.conversations.all();
  return { ok: true, data: sortSummaries(all.map(summaryOf)) };
}

export async function openConversation({ ports, id }) {
  if (!isValidId(id)) return { ...BAD, message: 'identificator invalid' };
  const conv = await ports.conversations.get(id);
  return conv ? { ok: true, data: conv } : missing;
}

export async function updateConversation({ ports, id, patch }) {
  if (!isValidId(id)) return { ...BAD, message: 'identificator invalid' };
  const conv = await ports.conversations.get(id);
  if (!conv) return missing;
  const next = patchConversation(conv, patch ?? {});
  await ports.conversations.save(next);
  return { ok: true, data: summaryOf(next) };
}

export async function deleteConversation({ ports, id }) {
  if (!isValidId(id)) return { ...BAD, message: 'identificator invalid' };
  if (!(await ports.conversations.get(id))) return missing;
  await ports.conversations.remove(id);
  return { ok: true, data: { id } };
}

export async function exportConversation({ ports, id, cfg = {} }) {
  const r = await openConversation({ ports, id });
  if (!r.ok) return r;
  return { ok: true, data: { name: `${fileNameOf(r.data)}.txt`, text: exportText(r.data, cfg.chat?.timeZone ?? DEFAULT_TZ) } };
}

/**
 * Send one message into a conversation (created on the first message) and answer it.
 * @param {{ports:any, cfg?:any, nowMs:number, id:string, text:string, logger?:any, onStatus?:(s:string)=>void}} o
 */
export async function sendMessage({ ports, cfg = {}, nowMs, id, text, logger = console, onStatus = () => {} }) {
  if (!isValidId(id)) return { ...BAD, message: 'identificator invalid' };
  const question = String(text ?? '').trim();
  if (!question) return { ...BAD, message: 'mesajul este gol' };
  if (question.length > LIMITS.textChars) return { ...BAD, message: `mesajul are peste ${LIMITS.textChars} de caractere` };
  const tz = cfg.chat?.timeZone ?? DEFAULT_TZ;
  onStatus('Citesc conversația și istoricul…');
  const conv = (await ports.conversations.get(id)) ?? newConversation(id, nowMs);
  const all = await ports.conversations.all();

  let reply;
  let intent;
  let by;
  const topic = recallQuery(question);
  if (topic !== null) {
    onStatus('Caut în conversațiile anterioare…');
    const hits = topic ? findPassages(passagesOf(all), topic, { k: 4, minScore: 0.5 }) : [];
    reply = `${plain(answerRecall({ hits, recent: sortSummaries(all.map(summaryOf)), topic, tz }))}\n\n— Agentul AI al CRI Radar — răspuns din conversațiile salvate. Cercetare, nu sfat financiar.`;
    intent = 'recall';
    by = 'memory';
  } else {
    onStatus('Înțeleg întrebarea…');
    const r = await chat({ ports, cfg, nowMs, text: question, context: topicContext(conv), logger, commandWords: true });
    onStatus('Pregătesc răspunsul…');
    reply = visible(r.reply);
    intent = r.intent?.intent ?? 'ask';
    by = r.by;
    // A free question (or one the agent could not place) is completed with a related earlier exchange.
    if (['ask', 'help'].includes(intent) && !r.intent?.explicit) {
      const hits = findPassages(passagesOf(all, { excludeId: id }), question, { k: 1, minScore: 0.7, minWords: 2 });
      if (hits.length) {
        onStatus('Am găsit ceva și în conversațiile anterioare…');
        reply = reply.replace(/\n\n— Agentul AI[^\n]*$/u, (footer) => `${relatedNote(hits, { tz })}${footer}`);
      }
    }
  }

  let next = addMessage(conv, { role: 'user', text: question, nowMs });
  next = addMessage(next, { role: 'agent', text: reply, nowMs, meta: { intent, by } });
  await ports.conversations.save(next);
  return { ok: true, data: { conversation: summaryOf(next), messages: next.messages.slice(-2), intent, by } };
}
