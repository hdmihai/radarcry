/**
 * The dashboard's chat: conversations as data (domain), the use-cases that send and recall (application),
 * their files (adapter) and the HTTP surface the dashboard talks to (inbound adapter) — including the
 * ways a stranger's web page must not be able to use it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, addMessage, exportText, findPassages, isValidId, newConversation, passagesOf, patchConversation, recallQuery, summaryOf, titleOf, topicContext } from '../../agent/domain/conversations.js';
import { createConversationsFs } from '../../agent/adapters/conversations-fs.js';
import { createAgentServer } from '../../agent/adapters/http.js';
import { deleteConversation, exportConversation, listConversations, openConversation, sendMessage, updateConversation } from '../../agent/application/conversation.js';

const T0 = Date.parse('2026-11-01T10:00:00Z');
const quiet = { info() {}, warn() {}, debug() {} };
const ID_A = 'aaaaaaaa-1111-4222-8333-444444444444';
const ID_B = 'bbbbbbbb-1111-4222-8333-444444444444';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'cri-conv-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const portsIn = (dir) => ({ conversations: createConversationsFs({ dir: join(dir, 'conversations') }) });

test('titles: the first words of the first question, cut at a word', () => {
  assert.equal(titleOf('cum stă radarul?'), 'cum stă radarul?');
  const t = titleOf('  „cum stă radarul astăzi și ce s-a schimbat față de ieri în porțile de calitate ale proiectului?”');
  assert.ok(t.length <= LIMITS.titleChars + 1 && t.endsWith('…'), t);
  assert.ok(!t.includes('„'));
  assert.equal(titleOf('   '), 'Conversație nouă');
});

test('a conversation grows by new objects; its title comes from the first user message only', () => {
  const c0 = newConversation(ID_A, T0);
  const c1 = addMessage(c0, { role: 'user', text: 'ce șanse are LAB?', nowMs: T0 + 1000 });
  const c2 = addMessage(c1, { role: 'agent', text: 'Răspuns.', nowMs: T0 + 2000, meta: { intent: 'forecast' } });
  assert.equal(c0.messages.length, 0, 'the input is untouched');
  assert.equal(c2.title, 'ce șanse are LAB?');
  assert.deepEqual(c2.messages.map((m) => [m.id, m.role]), [[1, 'user'], [2, 'agent']]);
  const renamed = patchConversation(c2, { title: '  Prognoza LAB  ', pinned: true });
  assert.equal(renamed.title, 'Prognoza LAB');
  assert.equal(patchConversation(renamed, { title: '   ' }).title, 'Prognoza LAB', 'an empty title keeps the old one');
  assert.equal(summaryOf(renamed).count, 2);
  const long = Array.from({ length: LIMITS.messages + 20 }).reduce((c, _, i) => addMessage(c, { role: 'user', text: `m${i}`, nowMs: T0 }), c0);
  assert.equal(long.messages.length, LIMITS.messages);
});

test('ids: only a plain slug can name a file', () => {
  assert.ok(isValidId(ID_A));
  for (const bad of ['../etc/passwd', 'a/b', '', 'short', 'UPPERCASE-ID-12345', 'x'.repeat(80), null, 42]) assert.equal(isValidId(bad), false, String(bad));
});

test('recall: questions about what was said are recognised, with their topic', () => {
  assert.equal(recallQuery('ce am discutat despre LAB data trecută?'), 'lab');
  assert.equal(recallQuery('ce am discutat?'), '');
  assert.match(recallQuery('îți amintești ce ai spus despre prognoză'), /prognoza/);
  assert.equal(recallQuery('cum stă radarul?'), null);
  assert.equal(recallQuery('ce șanse are LAB?'), null);
});

test('a follow-up continues the last real question of the conversation, not a greeting or another follow-up', () => {
  let c = newConversation(ID_A, T0);
  c = addMessage(c, { role: 'user', text: 'ce șanse are LAB?', nowMs: T0 });
  c = addMessage(c, { role: 'agent', text: 'x', nowMs: T0, meta: { intent: 'forecast' } });
  c = addMessage(c, { role: 'user', text: 'de ce?', nowMs: T0 });
  c = addMessage(c, { role: 'agent', text: 'y', nowMs: T0, meta: { intent: 'forecast' } });
  assert.equal(topicContext(c), 'ce șanse are LAB?');
  assert.equal(topicContext(newConversation(ID_B, T0)), null);
});

test('past exchanges are searchable, and the current conversation can be left out', () => {
  let a = newConversation(ID_A, T0);
  a = addMessage(a, { role: 'user', text: 'cum se calculează prognoza de 100x?', nowMs: T0 });
  a = addMessage(a, { role: 'agent', text: 'Prognoza folosește probabilități calibrate.', nowMs: T0, meta: {} });
  let b = newConversation(ID_B, T0);
  b = addMessage(b, { role: 'user', text: 'ce face agentul cu porțile de calitate?', nowMs: T0 });
  const hits = findPassages(passagesOf([a, b]), 'prognoza', { k: 3 });
  assert.equal(hits[0].conversationId, ID_A);
  assert.equal(findPassages(passagesOf([a, b], { excludeId: ID_A }), 'prognoza', { k: 3 }).length, 0);
  // Words that only the answer used count half; an unrelated query finds nothing.
  assert.equal(findPassages(passagesOf([a]), 'probabilități', { k: 1, minScore: 0.4 })[0].score, 0.5);
  assert.deepEqual(findPassages(passagesOf([a, b]), 'bitcoin dominanță', { k: 3 }), []);
  // Every answer repeating a project word must not flatten the ranking (the case a rarity weighting fails).
  const same = [a, b].map((c) => addMessage(c, { role: 'agent', text: 'radar radar radar', nowMs: T0 }));
  assert.ok(findPassages(passagesOf(same), 'radar', { k: 3, minScore: 0.4 }).length >= 1);
  assert.match(exportText(a), /Tu:\ncum se calculează/);
});

test('the file adapter keeps one atomic file per conversation and refuses any id that is not a slug', async () => {
  await withDir(async (dir) => {
    const store = createConversationsFs({ dir: join(dir, 'c') });
    assert.deepEqual(await store.all(), [], 'a missing directory is an empty history');
    const c = addMessage(newConversation(ID_A, T0), { role: 'user', text: 'salut', nowMs: T0 });
    await store.save(c);
    assert.equal((await store.get(ID_A)).title, 'salut');
    assert.equal((await store.all()).length, 1);
    assert.equal(await store.get('../../etc/passwd'), null);
    await assert.rejects(() => store.save({ id: '../x', title: 't', messages: [] }));
    await store.remove('../../etc/passwd'); // a no-op, not a deletion outside
    await store.remove(ID_A);
    assert.equal(await store.get(ID_A), null);
  });
});

test('sending: the question and the answer are saved, progress is reported, and a later conversation can recall it', async () => {
  await withDir(async (dir) => {
    const ports = portsIn(dir);
    const seen = [];
    const r = await sendMessage({ ports, nowMs: T0, id: ID_A, text: 'cum stă radarul?', logger: quiet, onStatus: (s) => seen.push(s) });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(seen.length >= 2 && seen.every((s) => typeof s === 'string' && s.length > 3), `statuses: ${seen}`);
    assert.deepEqual(r.data.messages.map((m) => m.role), ['user', 'agent']);
    assert.ok(!r.data.messages[1].text.includes('cri-agent-chat'), 'the hidden marker never reaches the screen');
    assert.equal(r.data.conversation.title, 'cum stă radarul?');
    assert.equal((await openConversation({ ports, id: ID_A })).data.messages.length, 2);

    // A new conversation asks what was said before.
    const back = await sendMessage({ ports, nowMs: T0 + 3_600_000, id: ID_B, text: 'ce am discutat despre radarul?', logger: quiet });
    assert.equal(back.data.by, 'memory');
    assert.equal(back.data.intent, 'recall');
    assert.match(back.data.messages[1].text, /cum stă radarul\?/);
    // The word as the owner wrote it earlier is not needed: „radar” finds „radarul”.
    const again = await sendMessage({ ports, nowMs: T0 + 7_200_000, id: 'cccccccc-1111-4222-8333-444444444444', text: 'ce am discutat despre radar?', logger: quiet });
    assert.match(again.data.messages[1].text, /cum stă radarul\?/);
    assert.equal((await listConversations({ ports })).data.length, 3);
  });
});

test('sending: an empty, oversized or badly named request is refused, nothing is saved', async () => {
  await withDir(async (dir) => {
    const ports = portsIn(dir);
    assert.equal((await sendMessage({ ports, nowMs: T0, id: ID_A, text: '   ', logger: quiet })).status, 400);
    assert.equal((await sendMessage({ ports, nowMs: T0, id: ID_A, text: 'x'.repeat(LIMITS.textChars + 1), logger: quiet })).status, 400);
    assert.equal((await sendMessage({ ports, nowMs: T0, id: '../bad', text: 'salut', logger: quiet })).status, 400);
    assert.equal((await listConversations({ ports })).data.length, 0);
  });
});

test('rename, pin, export and delete', async () => {
  await withDir(async (dir) => {
    const ports = portsIn(dir);
    await sendMessage({ ports, nowMs: T0, id: ID_A, text: 'cum stă radarul?', logger: quiet });
    await sendMessage({ ports, nowMs: T0 + 5000, id: ID_B, text: 'ajutor', logger: quiet });
    const u = await updateConversation({ ports, id: ID_A, patch: { title: 'Starea radarului', pinned: true } });
    assert.deepEqual([u.data.title, u.data.pinned], ['Starea radarului', true]);
    const list = (await listConversations({ ports })).data;
    assert.equal(list[0].id, ID_A, 'pinned first even though the other is newer');
    const ex = await exportConversation({ ports, id: ID_A });
    assert.match(ex.data.name, /^starea-radarului-aaaaaaaa\.txt$/);
    assert.match(ex.data.text, /Agent:/);
    assert.equal((await deleteConversation({ ports, id: ID_A })).ok, true);
    assert.equal((await openConversation({ ports, id: ID_A })).status, 404);
    assert.equal((await deleteConversation({ ports, id: ID_A })).status, 404);
  });
});

/* ───────────────────────────── the HTTP surface ───────────────────────────── */

async function serve(dir, { token = null, dist = null, origins = ['https://owner.github.io'] } = {}) {
  const ports = portsIn(dir);
  const app = {
    list: () => listConversations({ ports }),
    open: (id) => openConversation({ ports, id }),
    update: (id, patch) => updateConversation({ ports, id, patch }),
    remove: (id) => deleteConversation({ ports, id }),
    exportText: (id) => exportConversation({ ports, id }),
    send: (id, text, onStatus) => sendMessage({ ports, nowMs: T0, id, text, logger: quiet, onStatus }),
  };
  const { server, listen } = createAgentServer({ app, port: 0, dist, origins, token });
  await listen();
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((ok) => server.close(ok)) };
}
const J = { 'content-type': 'application/json' };

test('http: health, then a streamed message: status lines first, the reply last, and it is saved', async () => {
  await withDir(async (dir) => {
    const s = await serve(dir);
    try {
      const health = await (await fetch(`${s.base}/api/health`)).json();
      assert.deepEqual([health.service, health.ok], ['cri-agent', true]);
      const res = await fetch(`${s.base}/api/conversations/${ID_A}/messages`, { method: 'POST', headers: J, body: JSON.stringify({ text: 'cum stă radarul?' }) });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /x-ndjson/);
      const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
      assert.ok(events.slice(0, -1).every((e) => e.type === 'status'), JSON.stringify(events));
      assert.ok(events.length >= 3);
      const last = events.at(-1);
      assert.equal(last.type, 'reply');
      assert.deepEqual(last.messages.map((m) => m.role), ['user', 'agent']);
      const list = await (await fetch(`${s.base}/api/conversations`)).json();
      assert.equal(list.conversations[0].id, ID_A);
      const one = await (await fetch(`${s.base}/api/conversations/${ID_A}`)).json();
      assert.equal(one.conversation.messages.length, 2);
      const patched = await (await fetch(`${s.base}/api/conversations/${ID_A}`, { method: 'PATCH', headers: J, body: JSON.stringify({ pinned: true, title: 'Radar' }) })).json();
      assert.deepEqual([patched.conversation.pinned, patched.conversation.title], [true, 'Radar']);
      const ex = await fetch(`${s.base}/api/conversations/${ID_A}/export`);
      assert.match(ex.headers.get('content-disposition'), /attachment; filename="radar-aaaaaaaa\.txt"/);
      assert.match(await ex.text(), /Tu:/);
      assert.equal((await fetch(`${s.base}/api/conversations/${ID_A}`, { method: 'DELETE' })).status, 200);
      assert.equal((await fetch(`${s.base}/api/conversations/${ID_A}`)).status, 404);
    } finally {
      await s.close();
    }
  });
});

test('http: a web page of another origin cannot use the agent; the dashboard origins can', async () => {
  await withDir(async (dir) => {
    const s = await serve(dir);
    try {
      const evil = await fetch(`${s.base}/api/conversations`, { headers: { origin: 'https://evil.example' } });
      assert.equal(evil.status, 403);
      assert.equal(evil.headers.get('access-control-allow-origin'), null);
      const post = await fetch(`${s.base}/api/conversations/${ID_A}/messages`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' }, body: '{"text":"salut"}' });
      assert.equal(post.status, 403, 'a cross-site form post is refused before anything runs');
      const pre = await fetch(`${s.base}/api/conversations`, { method: 'OPTIONS', headers: { origin: 'https://owner.github.io', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get('access-control-allow-origin'), 'https://owner.github.io');
      assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
      const own = await fetch(`${s.base}/api/conversations`, { headers: { origin: s.base } });
      assert.equal(own.status, 200);
      const wrongType = await fetch(`${s.base}/api/conversations/${ID_A}/messages`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"text":"salut"}' });
      assert.equal(wrongType.status, 415);
    } finally {
      await s.close();
    }
  });
});

test('http: with a token every call but health needs it; oversized and malformed bodies are refused', async () => {
  await withDir(async (dir) => {
    const s = await serve(dir, { token: 'sekret-123' });
    try {
      assert.equal((await fetch(`${s.base}/api/health`)).status, 200);
      assert.equal((await fetch(`${s.base}/api/conversations`)).status, 401);
      assert.equal((await fetch(`${s.base}/api/conversations`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
      const auth = { ...J, authorization: 'Bearer sekret-123' };
      assert.equal((await fetch(`${s.base}/api/conversations`, { headers: auth })).status, 200);
      const big = await fetch(`${s.base}/api/conversations/${ID_A}/messages`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'x'.repeat(40_000) }) }).catch((e) => e);
      assert.ok(big instanceof Error || big.status === 413, 'a body over the cap is cut off');
      const bad = await fetch(`${s.base}/api/conversations/${ID_A}`, { method: 'PATCH', headers: auth, body: '{nope' });
      assert.equal(bad.status, 400);
      assert.equal((await fetch(`${s.base}/api/conversations/..%2F..%2Fx`, { headers: auth })).status, 400);
    } finally {
      await s.close();
    }
  });
});

test('http: outside the loopback a token is mandatory; the dashboard is served from dist without leaving it', async () => {
  assert.throws(() => createAgentServer({ app: {}, host: '0.0.0.0' }), /token/);
  await withDir(async (dir) => {
    const dist = join(dir, 'dist');
    await mkdir(dist);
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>CRI</title>');
    await writeFile(join(dir, 'secret.txt'), 'nope');
    const s = await serve(dir, { dist });
    try {
      const page = await fetch(`${s.base}/`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type'), /text\/html/);
      assert.equal((await fetch(`${s.base}/missing.js`)).status, 404);
      const up = await fetch(`${s.base}/..%2Fsecret.txt`);
      assert.notEqual(await up.text(), 'nope', 'no file outside dist is reachable');
    } finally {
      await s.close();
    }
  });
});
