/**
 * AI ASSISTANT — talk to the radar's assistant in plain text from the dashboard. The history (left) is
 * kept by the assistant itself, in memory/ of a PRIVATE GitHub repo (hosted/radarcry-agent), so it
 * survives a reload, a new phone, a closed laptop. The page only talks to GitHub's HTTP API (or, for
 * the local mode, to the agent's own server); it imports nothing from the agent.
 *
 *   GitHub mode  a message starts the repo's workflow (workflow_dispatch); the page then waits, with
 *                what GitHub says about the run, until the answer appears in the saved conversation.
 *                The token is a fine-grained one, limited to that one repo: Actions write + Contents read.
 *   Local mode   `npm run agent:serve` on a phone or computer; same screen, instant, streamed steps.
 *
 * The screen is drawn once and then updated in place (history, thread, header), so a reply that arrives
 * while you type never takes the cursor or the draft away.
 */
import { $, html, on, setHTML, storage } from '../core/dom.js';
import { ago } from '../core/format.js';

const LOCAL = 'http://127.0.0.1:8787';
const GH = 'https://api.github.com';
const WORKFLOW = 'assistant.yml';
const K = { mode: 'cri.chat.mode', base: 'cri.chat.base', token: 'cri.chat.token', repo: 'cri.chat.repo', ghToken: 'cri.chat.ghtoken', active: 'cri.chat.active' };

export const chatState = {
  mode: 'github', // github | local
  status: 'idle', // idle | probing | online | offline
  reason: null, // why it is offline: 'setup' or a sentence
  gh: { repo: '', token: '', branch: 'main' },
  base: null, // local mode: '' = this origin
  tried: [],
  token: '',
  convs: [],
  activeId: null,
  title: '',
  messages: [],
  sending: false,
  progress: '',
  error: null,
  draft: '',
  filter: '',
  sideOpen: false,
  settings: false,
  lessons: '',
};

/** Waiting between polls: a test makes it instant. */
export const timing = { first: 3000, step: 4000, limit: 8 * 60_000, settle: 5000, settleLimit: 120_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const describe = (err) => String(err?.message ?? err);
const isGh = () => chatState.mode === 'github';

async function timed(input, init = {}, ms = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

/* ───────────────────────────── GitHub transport ───────────────────────────── */

const HINT = { 401: 'tokenul GitHub este greșit sau a expirat', 403: 'tokenul nu are permisiunea cerută (Actions: scriere, Contents: citire) sau s-a depășit limita API', 404: 'repo-ul nu există sau tokenul nu îl vede', 422: 'workflow-ul assistant.yml lipsește sau nu are workflow_dispatch' };
const httpError = async (res, what) => {
  const doc = await res.json().catch(() => null);
  return new Error(`${what}: ${HINT[res.status] ?? `HTTP ${res.status}`}${doc?.message && !HINT[res.status] ? ` (${doc.message})` : ''}`);
};

const ghHeaders = (raw = false, json = false) => ({ accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${chatState.gh.token}`, ...(json ? { 'content-type': 'application/json' } : {}) });
const ghFetch = (path, { raw = false, body = null, method = 'GET' } = {}, ms = 20_000) => timed(`${GH}${path}`, { method, headers: ghHeaders(raw, Boolean(body)), ...(body ? { body: JSON.stringify(body) } : {}) }, ms);

/** A file of the private repo's memory, as text; null when it does not exist yet. */
async function ghRaw(path) {
  const { repo, branch } = chatState.gh;
  const res = await ghFetch(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, { raw: true });
  if (res.status === 404) return null;
  if (!res.ok) throw await httpError(res, 'citirea memoriei');
  return res.text();
}

async function ghDispatch(inputs) {
  const { repo, branch } = chatState.gh;
  const res = await ghFetch(`/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: { ref: branch, inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v ?? '')])) } });
  if (res.status !== 204) throw await httpError(res, 'pornirea asistentului');
}

async function probeGithub() {
  const { repo, token } = chatState.gh;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) {
    chatState.status = 'offline';
    chatState.reason = 'setup';
    return false;
  }
  try {
    const res = await ghFetch(`/repos/${repo}`);
    if (!res.ok) throw await httpError(res, 'conectarea');
    const doc = await res.json();
    if (doc.private !== true) throw new Error('repo-ul este PUBLIC: conversațiile tale ar fi vizibile oricui. Folosește un repo privat');
    chatState.gh.branch = doc.default_branch ?? 'main';
    chatState.status = 'online';
    chatState.reason = null;
    return true;
  } catch (err) {
    chatState.status = 'offline';
    chatState.reason = describe(err);
    return false;
  }
}

/** Poll until `done()` is true or the time is up. */
async function waitFor(done, { limit = timing.settleLimit, step = timing.settle } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < limit) {
    await timing.sleep(step);
    if (await done()) return true;
  }
  return false;
}

/** Start the workflow for one message, then wait for its answer to appear in the saved conversation. */
async function sendGithub(id, text) {
  const s = chatState;
  const messageId = newId();
  const sentAt = Date.now();
  await ghDispatch({ op: 'chat', conversation: id, message: messageId, text });
  s.progress = 'Mesajul a plecat la GitHub…';
  const t0 = Date.now();
  let runState = 'în coadă la GitHub Actions';
  for (let i = 0; Date.now() - t0 < timing.limit; i += 1) {
    await timing.sleep(i < 3 ? timing.first : timing.step);
    const raw = await ghRaw(`memory/conversations/${encodeURIComponent(id)}.json`);
    if (raw) {
      const conv = JSON.parse(raw);
      if (conv.messages.some((m) => m.meta?.replyTo === messageId)) return conv;
    }
    if (i % 2 === 0) {
      const res = await ghFetch(`/repos/${s.gh.repo}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`);
      const run = res.ok ? ((await res.json()).workflow_runs ?? []).find((r) => Date.parse(r.created_at) >= sentAt - 20_000) : null;
      if (run) {
        if (run.status === 'completed' && run.conclusion !== 'success') throw new Error(`jobul GitHub s-a încheiat cu „${run.conclusion}”. Detalii: ${run.html_url}`);
        runState = run.status === 'completed' ? 'se salvează răspunsul' : run.status === 'in_progress' ? 'agentul lucrează' : 'în coadă la GitHub Actions';
      }
    }
    s.progress = `${runState[0].toUpperCase()}${runState.slice(1)}… (${Math.round((Date.now() - t0) / 1000)} s)`;
    const el = $('#chat-thread [data-pending] .chat-think span:last-child');
    if (el) el.textContent = s.progress;
  }
  throw new Error('GitHub nu a răspuns în timpul alocat. Verifică în repo → Actions dacă jobul rulează.');
}

/* ───────────────────────────── local transport ───────────────────────────── */

const headers = (json = false) => ({ ...(json ? { 'content-type': 'application/json' } : {}), ...(chatState.token ? { authorization: `Bearer ${chatState.token}` } : {}) });
const url = (path) => `${chatState.base ?? ''}${path}`;

/** Find the local agent: the saved address, then this very origin, then the default one. */
async function probeLocal() {
  const saved = storage.get(K.base, null);
  const candidates = [...new Set([...(typeof saved === 'string' ? [saved] : []), ...(/^https?:$/.test(location.protocol) ? [''] : []), LOCAL])];
  chatState.tried = [];
  for (const base of candidates) {
    chatState.tried.push(base || location.origin);
    try {
      const res = await timed(`${base}/api/health`);
      const doc = res.ok ? await res.json() : null;
      if (doc?.service === 'cri-agent') {
        chatState.base = base;
        chatState.status = 'online';
        chatState.reason = null;
        return true;
      }
    } catch { /* try the next one */ }
  }
  chatState.base = null;
  chatState.status = 'offline';
  chatState.reason = 'local';
  return false;
}

async function api(path, init = {}) {
  const res = await timed(url(path), { ...init, headers: { ...headers(Boolean(init.body)), ...(init.headers ?? {}) } }, 15_000);
  const doc = await res.json().catch(() => null);
  if (!res.ok) throw new Error(doc?.message ?? (res.status === 401 ? 'token lipsă sau greșit' : `HTTP ${res.status}`));
  return doc;
}

/* ───────────────────────────── both ───────────────────────────── */

async function loadList() {
  if (isGh()) {
    const raw = await ghRaw('memory/index.json');
    chatState.convs = raw ? JSON.parse(raw).conversations ?? [] : [];
  } else chatState.convs = (await api('/api/conversations')).conversations ?? [];
}

async function loadLessons() {
  chatState.lessons = '';
  if (!isGh()) return;
  try {
    const raw = await ghRaw('memory/lessons-proposed.md');
    chatState.lessons = raw && /^- /m.test(raw) ? raw.trim() : '';
  } catch { /* lessons are optional */ }
}

async function openConv(id) {
  let conversation;
  if (isGh()) {
    const raw = await ghRaw(`memory/conversations/${encodeURIComponent(id)}.json`);
    if (!raw) throw new Error('conversația nu există');
    conversation = JSON.parse(raw);
  } else conversation = (await api(`/api/conversations/${encodeURIComponent(id)}`)).conversation;
  chatState.activeId = conversation.id;
  chatState.title = conversation.title;
  chatState.messages = conversation.messages;
  storage.set(K.active, conversation.id);
}

function fresh() {
  chatState.activeId = null;
  chatState.title = '';
  chatState.messages = [];
  chatState.error = null;
  storage.set(K.active, null);
}

/** Called when the screen opens: connect, then the history and the conversation that was open. */
export async function enterChat() {
  const s = chatState;
  s.mode = storage.get(K.mode, 'github') === 'local' ? 'local' : 'github';
  s.gh = { ...s.gh, repo: String(storage.get(K.repo, '') ?? ''), token: String(storage.get(K.ghToken, '') ?? '') };
  s.token = String(storage.get(K.token, '') ?? '');
  s.status = 'probing';
  if (!(await (isGh() ? probeGithub() : probeLocal()))) return;
  try {
    await loadList();
    await loadLessons();
    const last = storage.get(K.active, null);
    if (!s.activeId && last && s.convs.some((c) => c.id === last)) await openConv(last);
  } catch (err) {
    s.error = describe(err);
  }
}

/* ---------------- markup ---------------- */

const TOOL_NAME = { radar: 'datele radarului', search_docs: 'documentația', search_memory: 'memoria', web_search: 'căutare pe internet', read_page: 'o pagină web', consult: 'a doua opinie' };

/** An agent message is plain text; its signature line is shown apart. */
function body(text) {
  const m = /\n+(— Agentul AI[^\n]*)$/u.exec(text);
  const main = m ? text.slice(0, m.index) : text;
  return html`<div class="chat-text">${main}</div>${m ? html`<div class="chat-sign">${m[1].replace(/^— /, '')}</div>` : ''}`;
}

function messageMarkup(m) {
  const id = m.meta?.replyTo;
  const trace = (m.meta?.trace ?? []).filter((t) => TOOL_NAME[t.tool]);
  return html`<article class="chat-msg" data-role="${m.role}">
    <div class="chat-who">${m.role === 'user' ? 'Tu' : 'Agent'} <span class="muted">· ${ago(m.at)}</span></div>
    ${body(m.text)}
    ${id && trace.length ? html`<div class="chat-trace">Am folosit: ${[...new Set(trace.map((t) => TOOL_NAME[t.tool]))].join(', ')}</div>` : ''}
    ${id && isGh() ? html`<div class="chat-fb" role="group" aria-label="Verdict asupra răspunsului">
      <button type="button" data-chat-fb="up" data-chat-msg="${id}" aria-pressed="${m.meta.feedback === 'up' ? 'true' : 'false'}" title="Răspuns bun: îl țin minte ca exemplu">👍 Bun</button>
      <button type="button" data-chat-fb="down" data-chat-msg="${id}" aria-pressed="${m.meta.feedback === 'down' ? 'true' : 'false'}" title="Răspuns greșit: nu repet greșeala">👎 Greșit</button>
    </div>` : ''}
  </article>`;
}

function pendingMarkup() {
  return html`<article class="chat-msg" data-role="agent" data-pending="1" aria-label="Agentul se gândește">
    <div class="chat-who">Agent</div>
    <div class="chat-think"><span class="chat-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${chatState.progress || 'Se gândește…'}</span></div>
  </article>`;
}

export function threadMarkup() {
  const s = chatState;
  if (!s.messages.length && !s.sending) {
    return html`${s.error ? html`<div class="chat-error" role="alert">${s.error}</div>` : ''}<div class="chat-empty"><h2>Vorbește cu asistentul radarului</h2><p>Scrie în cuvintele tale, de exemplu „cum stă radarul?”, „ce s-a schimbat de ieri?”, „ce risc de ofertă are LAB?” sau „caută pe internet ce se spune despre BTW”. Poate căuta pe internet, cere o a doua opinie altui agent și ține minte ce a rezolvat. Poate dura până răspunde; vezi aici ce face.</p></div>`;
  }
  return html`${s.messages.map(messageMarkup)}${s.sending ? pendingMarkup() : ''}${s.error ? html`<div class="chat-error" role="alert">${s.error}</div>` : ''}`;
}

export function sideMarkup() {
  const s = chatState;
  const q = s.filter.trim().toLowerCase();
  const items = s.convs.filter((c) => !q || `${c.title} ${c.preview}`.toLowerCase().includes(q));
  const row = (c) => {
    const active = c.id === s.activeId;
    return html`<li class="chat-item" ${active ? html`data-active="1"` : ''}>
      <button type="button" class="chat-item-main" data-chat-open="${c.id}" ${active ? html`aria-current="true"` : ''}>
        <span class="chat-item-title">${c.pinned ? html`<span aria-label="fixată">★ </span>` : ''}${c.title}</span>
        <span class="chat-item-meta">${ago(c.updatedAt)} · ${c.count} mesaje</span>
      </button>
      ${active ? html`<div class="chat-item-actions">
        <button type="button" data-chat-pin="${c.id}" aria-pressed="${c.pinned ? 'true' : 'false'}">${c.pinned ? 'Nu mai fixa' : 'Fixează'}</button>
        <button type="button" data-chat-rename="${c.id}">Redenumește</button>
        <button type="button" data-chat-export="${c.id}">Descarcă</button>
        <button type="button" data-chat-delete="${c.id}" class="danger">Șterge</button>
      </div>` : ''}
    </li>`;
  };
  const lessons = s.lessons ? html`<details class="chat-lessons"><summary>Lecții propuse de asistent</summary><pre>${s.lessons}</pre><button type="button" class="btn" data-chat-approve>Aprobă lecțiile</button><p class="muted">Nu au niciun efect până nu le aprobi.</p></details>` : '';
  return html`<div class="chat-side-top">
      <button type="button" class="btn chat-new" data-chat-new>＋ Conversație nouă</button>
      <input type="search" id="chat-filter" placeholder="Caută în istoric" value="${s.filter}" aria-label="Caută în istoric" autocomplete="off">
    </div>
    <ul class="chat-list" aria-label="Istoricul conversațiilor">${items.length ? items.map(row) : html`<li class="chat-none">${s.status !== 'online' ? 'Istoricul apare când asistentul e conectat.' : q ? 'Nimic găsit.' : 'Nicio conversație salvată încă.'}</li>`}</ul>
    ${lessons}`;
}

export function headMarkup() {
  const s = chatState;
  const dot = s.status === 'online' ? 'good' : s.status === 'probing' ? 'muted' : 'critical';
  const label = s.status === 'online' ? (isGh() ? 'conectat la GitHub' : 'conectat local') : s.status === 'probing' ? 'se conectează…' : 'deconectat';
  return html`<button type="button" class="btn chat-toggle" data-chat-side aria-expanded="${s.sideOpen ? 'true' : 'false'}">☰ Istoric</button>
    <h2 class="chat-title">${s.title || 'Conversație nouă'}</h2>
    <span class="chat-status" data-tone="${dot}"><i aria-hidden="true"></i>${label}</span>
    <button type="button" class="btn chat-gear" data-chat-settings aria-expanded="${s.settings ? 'true' : 'false'}">Conexiune</button>`;
}

export function bannerMarkup() {
  const s = chatState;
  if (s.status === 'online' && !s.settings) return html``;
  const offline = s.status === 'offline';
  const intro = !offline ? '' : isGh()
    ? (s.reason === 'setup'
      ? html`<p><b>Conectează asistentul.</b> Rulează pe GitHub, într-un repo privat al tău (pașii sunt în <code>hosted/SETUP-RO.md</code>). Aici pui numele repo-ului privat, de forma <code>cont/radarcry-agent</code>, și un token GitHub fine-grained limitat la el: Actions scriere, Contents citire.</p>`
      : html`<p><b>Nu m-am putut conecta:</b> ${s.reason}.</p>`)
    : html`<p><b>Agentul local nu răspunde.</b> Am încercat ${s.tried.join(' și ')}. Pornește-l cu <code>npm run agent:serve</code>, apoi deschide <code>${LOCAL}/#/chat</code>. Ce scrii rămâne în câmpul de mai jos.</p>`;
  const fields = isGh()
    ? html`<label>Repo privat (cont/nume) <input type="text" name="repo" value="${s.gh.repo}" placeholder="cont/radarcry-agent" autocomplete="off" spellcheck="false"></label>
      <label>Token GitHub (fine-grained) <input type="password" name="ghtoken" value="${s.gh.token}" autocomplete="off"></label>`
    : html`<label>Adresa agentului <input type="text" name="base" value="${s.base ?? storage.get(K.base, '') ?? ''}" placeholder="${LOCAL}" autocomplete="off" spellcheck="false"></label>
      <label>Token (doar dacă ai setat CRI_AGENT_TOKEN) <input type="password" name="token" value="${s.token}" autocomplete="off"></label>`;
  return html`<div class="chat-banner" data-kind="${offline ? 'offline' : 'info'}">
    ${intro}
    <form class="chat-conn" id="chat-conn">
      <label>Mod <select name="mode" id="chat-mode"><option value="github" ${isGh() ? html`selected` : ''}>GitHub (recomandat)</option><option value="local" ${isGh() ? '' : html`selected`}>Server local</option></select></label>
      ${fields}
      <button type="submit" class="btn">Conectează</button>
    </form>
    <p class="muted">Tokenul rămâne doar în acest browser și nu are acces la altceva decât la repo-ul ales.</p>
  </div>`;
}

export function chatMarkup() {
  const s = chatState;
  return html`<section class="chat" id="chat-root" data-side="${s.sideOpen ? 'open' : 'closed'}" aria-label="AI Assistant">
    <aside class="chat-side" id="chat-side">${sideMarkup()}</aside>
    <div class="chat-main">
      <header class="chat-head" id="chat-head">${headMarkup()}</header>
      <div id="chat-banner">${bannerMarkup()}</div>
      <div class="chat-thread" id="chat-thread" role="log" aria-live="polite" tabindex="0">${threadMarkup()}</div>
      <form class="chat-form" id="chat-form" autocomplete="off">
        <textarea id="chat-input" rows="1" maxlength="4000" placeholder="Scrie un mesaj asistentului…" aria-label="Mesaj pentru asistent">${s.draft}</textarea>
        <button type="submit" class="btn chat-send" id="chat-send" ${s.sending ? html`disabled` : ''}>Trimite</button>
      </form>
      <p class="chat-hint muted">Asistentul răspunde în text simplu, din datele radarului, de pe internet și din ce a rezolvat înainte. Cercetare, nu sfat financiar.</p>
    </div>
  </section>`;
}

/* ---------------- in-place updates ---------------- */

function paint({ side = true, thread = true, head = true, banner = true, stick = false } = {}) {
  if (side) setHTML($('#chat-side'), sideMarkup());
  if (head) setHTML($('#chat-head'), headMarkup());
  if (banner) setHTML($('#chat-banner'), bannerMarkup());
  const t = $('#chat-thread');
  if (thread && t) {
    const near = stick || t.scrollHeight - t.scrollTop - t.clientHeight < 80;
    setHTML(t, threadMarkup());
    if (near) t.scrollTop = t.scrollHeight;
  }
  const send = $('#chat-send');
  if (send) send.disabled = chatState.sending;
  const root = $('#chat-root');
  if (root) root.dataset.side = chatState.sideOpen ? 'open' : 'closed';
}

async function refresh() {
  try {
    await loadList();
  } catch (err) {
    chatState.error = describe(err);
  }
}

/** NDJSON lines from a streamed response, as they arrive (local mode). */
async function* lines(res) {
  if (!res.body?.getReader) {
    for (const l of (await res.text()).split('\n')) if (l.trim()) yield l;
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (l) yield l;
    }
  }
  if (buf.trim()) yield buf.trim();
}

async function sendLocal(id, msg) {
  const s = chatState;
  const res = await fetch(url(`/api/conversations/${encodeURIComponent(id)}/messages`), { method: 'POST', headers: headers(true), body: JSON.stringify({ text: msg }), cache: 'no-store' });
  if (!res.ok) {
    const doc = await res.json().catch(() => null);
    throw new Error(doc?.message ?? (res.status === 401 ? 'token lipsă sau greșit' : `HTTP ${res.status}`));
  }
  let reply = null;
  for await (const l of lines(res)) {
    let ev;
    try { ev = JSON.parse(l); } catch { continue; }
    if (ev.type === 'status') {
      s.progress = ev.text;
      const el = $('#chat-thread [data-pending] .chat-think span:last-child');
      if (el) el.textContent = ev.text;
    } else if (ev.type === 'reply') reply = ev;
    else if (ev.type === 'error') throw new Error(ev.message);
  }
  if (!reply) throw new Error('răspunsul s-a întrerupt');
  return { messages: [...s.messages.filter((m) => !m.local), ...reply.messages], title: reply.conversation.title };
}

export async function sendText(text) {
  const s = chatState;
  const msg = String(text ?? '').trim();
  if (!msg || s.sending) return false;
  if (s.status !== 'online') {
    s.error = 'Asistentul nu este conectat. Mesajul tău rămâne în câmp.';
    paint({ side: false, head: false, banner: false });
    return false;
  }
  s.activeId ??= newId();
  const id = s.activeId;
  s.error = null;
  s.sending = true;
  s.progress = isGh() ? 'Trimit mesajul…' : 'Trimit mesajul…';
  s.messages = [...s.messages, { role: 'user', text: msg, at: new Date().toISOString(), local: true }];
  paint({ side: false, head: false, banner: false, stick: true });
  let ok = false;
  try {
    if (isGh()) {
      const conv = await sendGithub(id, msg);
      s.messages = conv.messages;
      s.title = conv.title;
    } else {
      const r = await sendLocal(id, msg);
      s.messages = r.messages;
      s.title = r.title;
    }
    storage.set(K.active, id);
    ok = true;
  } catch (err) {
    s.messages = s.messages.filter((m) => !m.local);
    s.error = `Nu am primit răspunsul: ${describe(err)}. Mesajul a fost pus înapoi în câmp.`;
    s.draft = msg;
    const input = $('#chat-input');
    if (input) input.value = msg;
  } finally {
    s.sending = false;
    s.progress = '';
  }
  if (ok) await refresh();
  paint({ stick: true });
  return ok;
}

/** The conversation as a text file, built here so it works in both modes. */
export function exportText(title, messages) {
  const head = [`${title || 'Conversație'}`, `Conversație cu asistentul AI al CRI Radar, ${messages.length} mesaje.`, ''];
  const rows = messages.map((m) => `[${m.at}] ${m.role === 'user' ? 'Tu' : 'Agent'}:\n${m.text}`);
  return `${[...head, ...rows].join('\n\n')}\n`;
}

function download() {
  const s = chatState;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([exportText(s.title, s.messages)], { type: 'text/plain;charset=utf-8' }));
  a.download = `${(s.title || 'conversatie').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'conversatie'}.txt`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** A change made through the workflow (rename, pin, delete, verdict, lessons): optimistic now, confirmed when the index says so. */
async function change(op, id, extra, optimistic, confirmed) {
  await ghDispatch({ op, conversation: id ?? '', message: extra?.message ?? '', extra: JSON.stringify(extra?.body ?? {}) });
  optimistic();
  paint({ stick: false });
  waitFor(async () => { await refresh(); return confirmed(); }).then(() => paint({ thread: false }));
}

/** Wire the screen once; the handlers are delegated, so they survive every re-render. */
export function bindChat(view) {
  const guard = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      chatState.error = describe(err);
      paint({ side: false, head: false, banner: false });
    }
  };
  const input = () => $('#chat-input');
  const fit = (el) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; };
  const submit = () => {
    const el = input();
    if (!el) return;
    const text = el.value;
    if (!text.trim() || chatState.sending) return;
    el.value = '';
    chatState.draft = '';
    fit(el);
    sendText(text);
  };
  const conv = (id) => chatState.convs.find((x) => x.id === id);

  on(view, 'submit', '#chat-form', (e) => { e.preventDefault(); submit(); });
  on(view, 'input', '#chat-input', (e, el) => { chatState.draft = el.value; fit(el); });
  on(view, 'keydown', '#chat-input', (e) => {
    // On a phone Enter is a new line (the button sends); with a mouse and keyboard Enter sends.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && globalThis.matchMedia?.('(pointer: fine)').matches) { e.preventDefault(); submit(); }
  });
  on(view, 'input', '#chat-filter', (e, el) => { chatState.filter = el.value; setHTML($('#chat-side'), sideMarkup()); const f = $('#chat-filter'); if (f) { f.focus(); f.setSelectionRange(el.value.length, el.value.length); } });
  on(view, 'click', '[data-chat-new]', () => { if (chatState.sending) return; fresh(); chatState.sideOpen = false; paint({ stick: true }); input()?.focus(); });
  on(view, 'click', '[data-chat-side]', () => { chatState.sideOpen = !chatState.sideOpen; paint({ side: false, thread: false, banner: false }); });
  on(view, 'click', '[data-chat-settings]', () => { chatState.settings = !chatState.settings; paint({ side: false, thread: false, head: true }); });
  on(view, 'change', '#chat-mode', (e, el) => { chatState.mode = el.value === 'local' ? 'local' : 'github'; setHTML($('#chat-banner'), bannerMarkup()); });
  on(view, 'click', '[data-chat-open]', guard(async (e, el) => {
    if (chatState.sending) return;
    await openConv(el.dataset.chatOpen);
    chatState.error = null;
    chatState.sideOpen = false;
    paint({ stick: true });
  }));
  on(view, 'click', '[data-chat-pin]', guard(async (e, el) => {
    const c = conv(el.dataset.chatPin);
    const pinned = !c?.pinned;
    if (isGh()) await change('patch', c.id, { body: { pinned } }, () => { if (c) c.pinned = pinned; }, () => conv(c.id)?.pinned === pinned);
    else {
      await api(`/api/conversations/${encodeURIComponent(c.id)}`, { method: 'PATCH', body: JSON.stringify({ pinned }) });
      await refresh();
      paint({ thread: false, head: false, banner: false });
    }
  }));
  on(view, 'click', '[data-chat-rename]', guard(async (e, el) => {
    const title = globalThis.prompt('Titlul conversației', chatState.title)?.trim();
    if (!title) return;
    const id = el.dataset.chatRename;
    if (isGh()) await change('patch', id, { body: { title } }, () => { const c = conv(id); if (c) c.title = title; chatState.title = title; }, () => conv(id)?.title === title);
    else {
      const { conversation } = await api(`/api/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      chatState.title = conversation.title;
      await refresh();
      paint({ thread: false, banner: false });
    }
  }));
  on(view, 'click', '[data-chat-export]', guard(async () => { download(); }));
  on(view, 'click', '[data-chat-delete]', guard(async (e, el) => {
    if (!globalThis.confirm('Ștergi definitiv această conversație? Ce a învățat asistentul din ea rămâne.')) return;
    const id = el.dataset.chatDelete;
    if (isGh()) {
      await change('delete', id, {}, () => { chatState.convs = chatState.convs.filter((c) => c.id !== id); if (chatState.activeId === id) fresh(); }, () => !conv(id));
    } else {
      await api(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (chatState.activeId === id) fresh();
      await refresh();
      paint({ stick: true });
    }
  }));
  on(view, 'click', '[data-chat-fb]', guard(async (e, el) => {
    if (!isGh() || !chatState.activeId) return;
    const messageId = el.dataset.chatMsg;
    const msg = chatState.messages.find((m) => m.meta?.replyTo === messageId);
    const value = msg?.meta?.feedback === el.dataset.chatFb ? null : el.dataset.chatFb;
    await ghDispatch({ op: 'feedback', conversation: chatState.activeId, message: messageId, extra: JSON.stringify({ value }) });
    if (msg) msg.meta = { ...msg.meta, feedback: value };
    paint({ side: false, head: false, banner: false });
  }));
  on(view, 'click', '[data-chat-approve]', guard(async () => {
    await ghDispatch({ op: 'approve' });
    chatState.lessons = '';
    paint({ thread: false, head: false, banner: false });
  }));
  on(view, 'submit', '#chat-conn', guard(async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const s = chatState;
    s.mode = f.get('mode') === 'local' ? 'local' : 'github';
    storage.set(K.mode, s.mode);
    if (s.mode === 'github') {
      s.gh.repo = String(f.get('repo') ?? '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '');
      s.gh.token = String(f.get('ghtoken') ?? '').trim();
      storage.set(K.repo, s.gh.repo);
      storage.set(K.ghToken, s.gh.token);
    } else {
      const base = String(f.get('base') ?? '').trim().replace(/\/+$/, '');
      s.token = String(f.get('token') ?? '').trim();
      storage.set(K.base, base || null);
      storage.set(K.token, s.token);
    }
    s.settings = false;
    s.status = 'probing';
    fresh();
    paint({ thread: false });
    if (await (isGh() ? probeGithub() : probeLocal())) {
      await refresh();
      await loadLessons();
    }
    paint({ stick: true });
  }));
}
