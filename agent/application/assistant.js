/**
 * ASSISTANT — the owner's AI assistant: a language model that reasons over the radar's own data with
 * tools, looks things up on the internet, asks other agents for a second opinion, remembers what it
 * solved, and learns from what the owner approves. It is the same agent as before with a thinking
 * model behind it; when no model answers, the deterministic agent still does (application/chat.js).
 *
 * One use-case per operation the workflow runs: chat, patch, delete, feedback, learn, approve, reindex.
 * Ports (all optional but conversations): llm, web, consult, cases, notes, memory, state, knowledge.
 */
import { CHAT_MARKER } from '../domain/chat.js';
import { DEFAULT_TITLE, LIMITS as CONV, addMessage, findPassages, isValidId, newConversation, passagesOf, summaryOf } from '../domain/conversations.js';
import { LIMITS, TOOLS, TOOL_LABEL, buildSystemPrompt, caseIdOf, checkAnswer, checkCall, clip, finalText, findCases, historyOf, learnPrompt, newCase, parseLessons, repairNote, wrapUntrusted } from '../domain/assistant.js';
import { DEFAULT_TZ, cut, plain } from '../domain/plain.js';
import { chunkDocs, search } from '../domain/retrieval.js';
import { chat } from './chat.js';
import { deleteConversation, updateConversation } from './conversation.js';
import { radarTopic } from './facts.js';

const BAD = (message) => ({ ok: false, status: 400, message });
const GONE = { ok: false, status: 404, message: 'conversația nu există' };

/* ───────────────────────────── tools ───────────────────────────── */

async function runTool({ name, args, ctx }) {
  const { ports, cfg, nowMs } = ctx;
  switch (name) {
    case 'radar': {
      const r = await radarTopic({ ports, cfg, nowMs, ...args });
      return { ok: r.ok, text: r.text };
    }
    case 'search_docs': {
      const docs = ports.knowledge ? await ports.knowledge.docs() : null;
      const rules = ports.knowledge ? await ports.knowledge.rules() : null;
      const chunks = docs?.ok ? chunkDocs(docs.data) : [];
      if (rules?.ok) for (const r of rules.data.rules ?? []) chunks.push({ doc: 'agent/knowledge/rules.json', heading: `${r.id} ${r.title}`, path: `Reguli › ${r.id} ${r.title}`, text: `${r.rule}${r.why ? ` ${r.why}` : ''}` });
      const hits = search(chunks, args.query, { k: 3, minScore: 1 });
      return hits.length ? { ok: true, text: hits.map((h) => `${h.path}: ${cut(h.text, 700)}`).join('\n\n') } : { ok: true, text: 'Nimic găsit în documentație pentru această interogare.' };
    }
    case 'search_memory': {
      const lines = [];
      const convs = ports.conversations ? await ports.conversations.all() : [];
      for (const h of findPassages(passagesOf(convs, { excludeId: ctx.conversationId }), args.query, { k: 3, minScore: 0.5 })) lines.push(`Conversație „${cut(h.title, 40)}”: ai întrebat „${cut(h.question, 120)}”${h.answer ? ` → ${cut(h.answer, 260)}` : ''}`);
      const { good, avoid } = findCases(ports.cases ? await ports.cases.all() : [], args.query, { k: 2 });
      for (const c of good) lines.push(`Caz rezolvat${c.feedback === 'up' ? ' (aprobat)' : ''}: ${cut(c.request, 120)} → ${cut(c.answer, 300)}`);
      for (const c of avoid) lines.push(`Caz respins de proprietar: ${cut(c.request, 120)}`);
      const lessons = ports.notes ? await ports.notes.get('lessons.md') : null;
      if (lessons) lines.push(`Lecții aprobate: ${cut(plain(lessons), 500)}`);
      return { ok: true, text: lines.length ? lines.join('\n') : 'Nu am nimic relevant în memorie pentru această interogare.' };
    }
    case 'web_search': {
      if (!ports.web?.available?.()) return { ok: false, text: 'căutarea pe internet nu este configurată (lipsește TAVILY_API_KEY)' };
      const r = await ports.web.search(args.query);
      if (!r.ok) return { ok: false, text: `căutarea a eșuat: ${r.message}` };
      return { ok: true, text: wrapUntrusted('căutare web', r.data.slice(0, 5).map((x, i) => `${i + 1}. ${cut(x.title, 120)}\n${x.url}\n${cut(x.snippet, 420)}`).join('\n\n')) };
    }
    case 'read_page': {
      if (!ports.web) return { ok: false, text: 'cititorul de pagini nu este configurat' };
      const r = await ports.web.read(args.url);
      return r.ok ? { ok: true, text: wrapUntrusted(args.url, r.data.text) } : { ok: false, text: `pagina nu a putut fi citită: ${r.message}` };
    }
    case 'consult': {
      if (!ports.consult) return { ok: false, text: 'al doilea agent nu este configurat' };
      const r = await ports.consult.ask(args);
      return r.ok ? { ok: true, text: wrapUntrusted(`al doilea agent (${r.data.model})`, r.data.text, 1800) } : { ok: false, text: `al doilea agent nu a răspuns: ${r.message}` };
    }
    default:
      return { ok: false, text: 'unealtă necunoscută' };
  }
}

/* ───────────────────────────── chat ───────────────────────────── */

/**
 * Answer one message. The conversation is created on its first message; a message that was already
 * answered (a re-run of the workflow) is returned as it was, not answered twice.
 */
export async function assist({ ports, cfg = {}, nowMs, id, messageId, text, logger = console, onStatus = () => {} }) {
  if (!isValidId(id)) return BAD('identificator de conversație invalid');
  if (!isValidId(messageId)) return BAD('identificator de mesaj invalid');
  const question = String(text ?? '').trim();
  if (!question) return BAD('mesajul este gol');
  if (question.length > CONV.textChars) return BAD(`mesajul are peste ${CONV.textChars} de caractere`);
  const tz = cfg.chat?.timeZone ?? DEFAULT_TZ;
  const conv = (await ports.conversations.get(id)) ?? newConversation(id, nowMs);
  const done = conv.messages.findIndex((m) => m.meta?.replyTo === messageId);
  if (done >= 0) return { ok: true, data: { conversation: summaryOf(conv), messages: conv.messages.slice(done - 1, done + 1), intent: 'assistant', by: conv.messages[done].meta?.by ?? 'asistent', repeated: true } };

  const steps = Math.min(cfg.assistant?.maxSteps ?? LIMITS.steps, LIMITS.steps);
  const trace = [];
  const evidence = [question, ...historyOf(conv).map((m) => m.content)];
  let reply = null;
  let by = 'asistent';
  let model = null;
  let answer = null;

  if (ports.llm?.available?.()) {
    const cases = findCases(ports.cases ? await ports.cases.all() : [], question, { k: 2 });
    const system = buildSystemPrompt({ owner: ports.notes ? await ports.notes.get('owner.md') : null, lessons: ports.notes ? await ports.notes.get('lessons.md') : null, cases, nowMs, tz });
    const messages = [{ role: 'system', content: system }, ...historyOf(conv), { role: 'user', content: question }];
    const ctx = { ports, cfg, nowMs, conversationId: id };
    let calls = 0;
    let repaired = false;
    let failure = null;
    for (let step = 1; step <= steps + 1 && !failure; step += 1) {
      const last = step > steps;
      onStatus(step === 1 ? 'Gândesc…' : 'Continui…');
      const r = await ports.llm.chat({ messages, tools: last ? null : TOOLS });
      if (!r.ok) { failure = r.message; break; }
      model = r.data.model;
      const msg = r.data.message;
      const wanted = last ? [] : (msg.tool_calls ?? []).slice(0, LIMITS.callsPerStep);
      if (wanted.length && calls < LIMITS.callsTotal) {
        messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: wanted });
        for (const call of wanted) {
          calls += 1;
          const name = call.function?.name;
          const checked = checkCall(name, call.function?.arguments);
          let out;
          if (!checked.ok) out = { ok: false, text: `apel refuzat: ${checked.why}` };
          else {
            onStatus(`${TOOL_LABEL[name]}…`);
            try { out = await runTool({ name, args: checked.args, ctx }); } catch (err) { out = { ok: false, text: `unealta a eșuat: ${String(err?.message ?? err).slice(0, 100)}` }; }
          }
          const content = clip(out.text);
          evidence.push(content);
          trace.push({ tool: name, ok: Boolean(out.ok), ...(checked.ok && name !== 'radar' ? { query: checked.args.query ?? checked.args.url ?? checked.args.question } : checked.ok ? { topic: checked.args.topic, symbol: checked.args.symbol } : {}) });
          messages.push({ role: 'tool', tool_call_id: call.id, content });
        }
        continue;
      }
      answer = String(msg.content ?? '').trim();
      if (!answer) { failure = 'model: răspuns gol'; break; }
      const verdict = checkAnswer(answer, evidence);
      if (!verdict.ok && !repaired && step <= steps) {
        repaired = true;
        messages.push({ role: 'assistant', content: answer }, { role: 'user', content: repairNote(verdict) });
        answer = null;
        continue;
      }
      reply = finalText(answer, { by: `răspuns scris de ${model} (${r.data.provider}), cu cifre din unelte`, caution: verdict.ok ? '' : `Atenție: ${verdict.unknown.length ? `cifrele ${verdict.unknown.join(', ')} nu au fost verificate cu o unealtă` : 'formularea poate suna a recomandare'}; tratează-le ca neconfirmate.` });
      by = `llm:${model}`;
      break;
    }
    if (reply === null) logger.warn?.(`asistent: modelul nu a răspuns (${failure ?? 'fără răspuns final'}); răspund din raport`);
  }

  if (reply === null) {
    // No model, or it failed: the deterministic agent answers from the radar's own report.
    onStatus('Modelul nu a răspuns; răspund din raportul meu…');
    const r = await chat({ ports, cfg, nowMs, text: question, context: null, logger, commandWords: true });
    reply = String(r.reply).replace(CHAT_MARKER, '').replace(/^\n/, '');
    by = 'deterministic';
  }

  const caseId = answer && by.startsWith('llm') ? caseIdOf(nowMs, messageId) : null;
  let next = addMessage(conv, { role: 'user', text: question, nowMs, meta: { id: messageId } });
  next = addMessage(next, { role: 'agent', text: reply, nowMs, meta: { intent: 'assistant', by, replyTo: messageId, trace, ...(caseId ? { caseId } : {}), feedback: null } });
  await ports.conversations.save(next);
  if (caseId && ports.cases) await ports.cases.save(newCase({ nowMs, conversation: id, messageId, request: question, answer: reply, tools: trace.map((t) => t.tool), model }));
  await ports.conversations.reindex?.();
  return { ok: true, data: { conversation: summaryOf(next), messages: next.messages.slice(-2), intent: 'assistant', by } };
}

/* ───────────────────────────── the other operations ───────────────────────────── */

export async function patchOp({ ports, id, patch }) {
  const r = await updateConversation({ ports, id, patch });
  if (r.ok) await ports.conversations.reindex?.();
  return r;
}

export async function deleteOp({ ports, id }) {
  const r = await deleteConversation({ ports, id });
  if (r.ok) await ports.conversations.reindex?.();
  return r;
}

/** The owner's verdict on an answer: it marks the message and the case, and the case teaches the next answers. */
export async function feedbackOp({ ports, id, messageId, value }) {
  if (!isValidId(id)) return BAD('identificator invalid');
  if (!['up', 'down', null].includes(value)) return BAD('verdict invalid');
  const conv = await ports.conversations.get(id);
  if (!conv) return GONE;
  const at = conv.messages.findIndex((m) => m.role === 'agent' && m.meta?.replyTo === messageId);
  if (at < 0) return { ok: false, status: 404, message: 'mesajul nu există' };
  const messages = conv.messages.map((m, i) => (i === at ? { ...m, meta: { ...m.meta, feedback: value } } : m));
  await ports.conversations.save({ ...conv, messages });
  const caseId = conv.messages[at].meta?.caseId;
  const c = caseId && ports.cases ? await ports.cases.get(caseId) : null;
  if (c) await ports.cases.save({ ...c, feedback: value });
  return { ok: true, data: { id, messageId, value } };
}

/** Weekly: the model drafts lessons from the cases; they wait for the owner's approval. */
export async function learnOp({ ports, cfg = {}, nowMs, logger = console }) {
  const cases = ports.cases ? await ports.cases.all() : [];
  const fresh = cases.filter((c) => c.feedback || Date.parse(c.at) > nowMs - 14 * 86_400_000);
  if (fresh.length < 3) return { ok: true, data: { proposed: 0, why: 'prea puține cazuri noi' } };
  if (!ports.llm?.available?.()) return { ok: true, data: { proposed: 0, why: 'niciun model configurat' } };
  const p = learnPrompt(fresh, nowMs, cfg.chat?.timeZone);
  const r = await ports.llm.chat({ messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.prompt }], maxTokens: 700 });
  if (!r.ok) { logger.warn?.(`asistent: lecțiile nu s-au putut redacta (${r.message})`); return { ok: true, data: { proposed: 0, why: r.message } }; }
  const lessons = parseLessons(r.data.message.content);
  if (!lessons.length) return { ok: true, data: { proposed: 0, why: 'modelul nu a dat lecții valide' } };
  await ports.notes.put('lessons-proposed.md', `Lecții propuse la ${new Date(nowMs).toISOString().slice(0, 10)} din ${fresh.length} cazuri (nu au efect până nu le aprobi):\n${lessons.join('\n')}\n`);
  return { ok: true, data: { proposed: lessons.length } };
}

/** The owner approves the proposed lessons: only then does the assistant start to use them. */
export async function approveOp({ ports }) {
  const proposed = await ports.notes.get('lessons-proposed.md');
  if (!proposed?.trim()) return { ok: false, status: 404, message: 'nu există lecții propuse' };
  const lines = proposed.split('\n').filter((l) => /^- /.test(l));
  if (!lines.length) return { ok: false, status: 400, message: 'lecții invalide' };
  const current = (await ports.notes.get('lessons.md')) ?? '';
  const merged = [...new Set([...current.split('\n').filter((l) => /^- /.test(l)), ...lines])].slice(-24);
  await ports.notes.put('lessons.md', `${merged.join('\n')}\n`);
  await ports.notes.put('lessons-proposed.md', '');
  return { ok: true, data: { lessons: merged.length } };
}

export { DEFAULT_TITLE };
