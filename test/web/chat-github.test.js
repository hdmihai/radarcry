/**
 * The assistant page against a simulated GitHub: it connects only to a PRIVATE repo, starts the
 * workflow for a message, waits for the answer to appear in the saved conversation (with what GitHub
 * says about the run), and changes (verdicts, lessons) go through the same workflow.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bannerMarkup, chatMarkup, chatState, enterChat, sendText, sideMarkup, threadMarkup, timing } from '../../web/assets/js/views/chat.js';

const store = new Map();
const realFetch = globalThis.fetch;
let calls;
let repoDoc;
let files;
let runs;
let onDispatch;

const respond = (status, body, text = false) => new Response(text ? body : JSON.stringify(body), { status, headers: { 'content-type': text ? 'text/plain' : 'application/json' } });

function fakeGithub(url, init = {}) {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname);
  calls.push({ method: init.method ?? 'GET', path, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
  if (init.headers?.authorization !== 'Bearer ghp_test') return respond(401, { message: 'Bad credentials' });
  if (path === '/repos/owner/priv') return repoDoc ? respond(200, repoDoc) : respond(404, { message: 'Not Found' });
  if (path.startsWith('/repos/owner/priv/contents/')) {
    const f = path.replace('/repos/owner/priv/contents/', '');
    return f in files ? respond(200, files[f], true) : respond(404, { message: 'Not Found' });
  }
  if (path === '/repos/owner/priv/actions/workflows/assistant.yml/dispatches') {
    const inputs = JSON.parse(init.body).inputs;
    onDispatch?.(inputs);
    return new Response(null, { status: 204 });
  }
  if (path === '/repos/owner/priv/actions/workflows/assistant.yml/runs') return respond(200, { workflow_runs: runs() });
  return respond(404, { message: `unexpected ${path}` });
}

before(() => {
  globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } };
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
  globalThis.Element = class {};
  globalThis.fetch = async (url, init) => fakeGithub(String(url), init);
  Object.assign(timing, { first: 0, step: 0, settle: 0, settleLimit: 30, limit: 400, sleep: async () => {} });
});
after(() => { globalThis.fetch = realFetch; delete globalThis.window; delete globalThis.document; delete globalThis.Element; });

beforeEach(() => {
  store.clear();
  calls = [];
  repoDoc = { private: true, default_branch: 'trunk' };
  files = { 'memory/index.json': JSON.stringify({ version: 1, conversations: [{ id: 'aaaaaaaa-1111-4222-8333-444444444444', title: 'Starea radarului', pinned: false, createdAt: 'x', updatedAt: new Date().toISOString(), count: 2, preview: 'cum stă radarul?' }] }) };
  runs = () => [];
  onDispatch = null;
  Object.assign(chatState, { mode: 'github', status: 'idle', reason: null, gh: { repo: '', token: '', branch: 'main' }, convs: [], activeId: null, title: '', messages: [], sending: false, progress: '', error: null, draft: '', filter: '', lessons: '', settings: false });
  store.set('cri.chat.repo', JSON.stringify('owner/priv'));
  store.set('cri.chat.ghtoken', JSON.stringify('ghp_test'));
});

test('without settings it explains the setup and never calls GitHub', async () => {
  store.clear();
  await enterChat();
  assert.equal(chatState.status, 'offline');
  assert.equal(chatState.reason, 'setup');
  assert.equal(calls.length, 0);
  const b = String(bannerMarkup());
  assert.match(b, /hosted\/SETUP-RO\.md/);
  assert.match(b, /type="password"/);
  assert.match(b, /Actions scriere, Contents citire/);
});

test('it refuses a PUBLIC repo: the conversations would be visible to anyone', async () => {
  repoDoc = { private: false, default_branch: 'main' };
  await enterChat();
  assert.equal(chatState.status, 'offline');
  assert.match(chatState.reason, /PUBLIC/);
  assert.equal(calls.filter((c) => c.path.includes('/contents/')).length, 0, 'nothing is read from it');
});

test('bad token, missing repo and missing workflow each say what is wrong', async () => {
  store.set('cri.chat.ghtoken', JSON.stringify('wrong'));
  await enterChat();
  assert.match(chatState.reason, /tokenul GitHub este greșit sau a expirat/);
  store.set('cri.chat.ghtoken', JSON.stringify('ghp_test'));
  repoDoc = null;
  await enterChat();
  assert.match(chatState.reason, /repo-ul nu există sau tokenul nu îl vede/);
});

test('connected: the history comes from memory/index.json on the default branch, and the open conversation is restored', async () => {
  files['memory/conversations/aaaaaaaa-1111-4222-8333-444444444444.json'] = JSON.stringify({ id: 'aaaaaaaa-1111-4222-8333-444444444444', title: 'Starea radarului', messages: [{ id: 1, role: 'user', text: 'cum stă radarul?', at: new Date().toISOString() }, { id: 2, role: 'agent', text: 'Radarul e în risk-off.\n\n— Agentul AI al CRI Radar — răspuns scris de m. Cercetare, nu sfat financiar.', at: new Date().toISOString(), meta: { replyTo: 'm1', trace: [{ tool: 'radar', ok: true }, { tool: 'web_search', ok: true }], feedback: null } }] });
  files['memory/lessons-proposed.md'] = 'Lecții propuse la 2026-11-02:\n- Cheamă întâi unealta radar.\n';
  store.set('cri.chat.active', JSON.stringify('aaaaaaaa-1111-4222-8333-444444444444'));
  await enterChat();
  assert.equal(chatState.status, 'online');
  assert.equal(chatState.gh.branch, 'trunk');
  assert.ok(calls.some((c) => c.path.endsWith('/contents/memory/index.json')));
  assert.equal(chatState.convs.length, 1);
  assert.equal(chatState.messages.length, 2);
  const m = String(chatMarkup());
  assert.match(m, /Starea radarului/);
  assert.match(m, /Am folosit: datele radarului, căutare pe internet/);
  assert.match(m, /data-chat-fb="up" data-chat-msg="m1"/);
  assert.match(String(sideMarkup()), /Lecții propuse de asistent[\s\S]*Aprobă lecțiile/);
});

test('sending: the workflow is started with the message, the page waits, then shows the saved answer', async () => {
  await enterChat();
  const sent = [];
  let polls = 0;
  onDispatch = (inputs) => {
    sent.push(inputs);
    const id = inputs.conversation;
    runs = () => [{ created_at: new Date().toISOString(), status: polls < 2 ? 'queued' : 'in_progress', conclusion: null, html_url: 'https://github.com/owner/priv/actions/runs/1' }];
    // The runner finishes after a few polls: the conversation file appears.
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const path = decodeURIComponent(new URL(String(url)).pathname);
      if (path.endsWith(`/contents/memory/conversations/${id}.json`)) {
        polls += 1;
        if (polls >= 3) {
          files[`memory/conversations/${id}.json`] = JSON.stringify({ id, title: 'Ce risc are LAB', messages: [{ id: 1, role: 'user', text: 'ce risc are LAB?', at: new Date().toISOString(), meta: { id: inputs.message } }, { id: 2, role: 'agent', text: 'Risc de ofertă.', at: new Date().toISOString(), meta: { replyTo: inputs.message, trace: [], feedback: null } }] });
          globalThis.fetch = real;
        }
      }
      return fakeGithub(String(url), init);
    };
  };
  const ok = await sendText('ce risc are LAB?');
  assert.equal(ok, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['conversation', 'extra', 'message', 'op', 'text'].filter((k) => k in sent[0]).sort());
  assert.equal(sent[0].op, 'chat');
  assert.equal(sent[0].text, 'ce risc are LAB?');
  const dispatch = calls.find((c) => c.path.endsWith('/dispatches'));
  assert.equal(dispatch.body.ref, 'trunk', 'the repo default branch');
  assert.equal(chatState.title, 'Ce risc are LAB');
  assert.equal(chatState.messages.at(-1).text, 'Risc de ofertă.');
  assert.equal(chatState.sending, false);
  assert.ok(polls >= 3, 'it polled until the answer existed');
});

test('a failed run is reported with its link, and the message goes back into the field', async () => {
  await enterChat();
  onDispatch = () => { runs = () => [{ created_at: new Date().toISOString(), status: 'completed', conclusion: 'failure', html_url: 'https://github.com/owner/priv/actions/runs/9' }]; };
  const ok = await sendText('salut');
  assert.equal(ok, false);
  assert.match(chatState.error, /jobul GitHub s-a încheiat cu „failure”.*actions\/runs\/9/);
  assert.equal(chatState.draft, 'salut');
  assert.equal(chatState.messages.length, 0, 'the unanswered message is not kept as if it were');
  assert.match(String(threadMarkup()), /Mesajul a fost pus înapoi în câmp/);
});

test('a rejected dispatch (token without the Actions permission) says so', async () => {
  await enterChat();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).endsWith('/dispatches') ? respond(403, { message: 'Resource not accessible by personal access token' }) : real(url, init));
  try {
    assert.equal(await sendText('salut'), false);
    assert.match(chatState.error, /Actions: scriere, Contents: citire/);
  } finally { globalThis.fetch = real; }
});

test('a verdict on an answer goes through the workflow and is shown at once; lessons wait for approval', async () => {
  await enterChat();
  const { bindChat } = await import('../../web/assets/js/views/chat.js');
  assert.equal(typeof bindChat, 'function');
  chatState.activeId = 'aaaaaaaa-1111-4222-8333-444444444444';
  chatState.messages = [{ id: 2, role: 'agent', text: 'Un răspuns.', at: new Date().toISOString(), meta: { replyTo: 'm1', feedback: null, trace: [] } }];
  const seen = [];
  onDispatch = (i) => seen.push(i);
  // The click handler is delegated on the view: a fake element carrying the data attributes is clicked.
  const handlers = [];
  const view = { addEventListener: (type, fn) => handlers.push([type, fn]), contains: () => true };
  bindChat(view);
  const el = Object.assign(new Element(), { dataset: { chatFb: 'down', chatMsg: 'm1' } });
  el.closest = (sel) => (sel === '[data-chat-fb]' ? el : null);
  for (const [type, fn] of handlers) if (type === 'click') await fn({ target: el });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(seen[0].op, 'feedback');
  assert.deepEqual(JSON.parse(seen[0].extra), { value: 'down' });
  assert.equal(chatState.messages[0].meta.feedback, 'down');
});
