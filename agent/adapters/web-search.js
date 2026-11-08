/**
 * WebPort: the internet for the assistant. Search through Tavily (free plan, a key from a free account,
 * no card) with Exa as the second source; reading a page through Jina Reader, so the runner never opens
 * an arbitrary address itself — the reader does. Keys come from the environment of the caller.
 */
const HOSTS = new Set(['api.tavily.com', 'api.exa.ai', 'r.jina.ai', '127.0.0.1']);
const pin = (url) => {
  if (!HOSTS.has(new URL(url).hostname)) throw new Error(`gazdă nepermisă pentru web: ${new URL(url).hostname}`);
  return url.replace(/\/+$/, '');
};

async function post(fetchImpl, url, headers, body, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    return { ok: true, doc: await res.json() };
  } catch (err) {
    return { ok: false, message: err?.name === 'AbortError' ? 'timp depășit' : String(err?.message ?? err).slice(0, 100) };
  } finally {
    clearTimeout(t);
  }
}

export function createTavily({ apiKey, baseUrl = 'https://api.tavily.com', timeoutMs = 25_000, fetchImpl = globalThis.fetch }) {
  const base = pin(baseUrl);
  return {
    id: 'tavily',
    available: () => Boolean(apiKey),
    async search(query) {
      const r = await post(fetchImpl, `${base}/search`, { authorization: `Bearer ${apiKey}` }, { query, max_results: 5, search_depth: 'basic', include_answer: false }, timeoutMs);
      if (!r.ok) return { ok: false, message: `tavily: ${r.message}` };
      return { ok: true, data: (r.doc.results ?? []).map((x) => ({ title: String(x.title ?? ''), url: String(x.url ?? ''), snippet: String(x.content ?? '') })) };
    },
  };
}

export function createExa({ apiKey, baseUrl = 'https://api.exa.ai', timeoutMs = 25_000, fetchImpl = globalThis.fetch }) {
  const base = pin(baseUrl);
  return {
    id: 'exa',
    available: () => Boolean(apiKey),
    async search(query) {
      const r = await post(fetchImpl, `${base}/search`, { 'x-api-key': apiKey }, { query, numResults: 5, contents: { text: { maxCharacters: 600 } } }, timeoutMs);
      if (!r.ok) return { ok: false, message: `exa: ${r.message}` };
      return { ok: true, data: (r.doc.results ?? []).map((x) => ({ title: String(x.title ?? ''), url: String(x.url ?? ''), snippet: String(x.text ?? '') })) };
    },
  };
}

export function createJinaReader({ apiKey = null, baseUrl = 'https://r.jina.ai', timeoutMs = 30_000, fetchImpl = globalThis.fetch }) {
  const base = pin(baseUrl);
  return {
    id: 'jina',
    available: () => true,
    async read(url) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${base}/${url}`, { headers: { accept: 'text/plain', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, signal: ctl.signal });
        if (!res.ok) return { ok: false, message: `jina: HTTP ${res.status}` };
        return { ok: true, data: { url, text: (await res.text()).slice(0, 40_000) } };
      } catch (err) {
        return { ok: false, message: `jina: ${err?.name === 'AbortError' ? 'timp depășit' : String(err?.message ?? err).slice(0, 100)}` };
      } finally {
        clearTimeout(t);
      }
    },
  };
}

/** Search through the first source that answers; read through the reader. */
export function createWeb({ searchers, reader = null }) {
  const usable = searchers.filter((s) => s?.available?.());
  return {
    available: () => usable.length > 0,
    async search(query) {
      const errors = [];
      for (const s of usable) {
        const r = await s.search(query);
        if (r.ok && r.data.length) return r;
        errors.push(r.message ?? `${s.id}: fără rezultate`);
      }
      return { ok: false, message: errors.join(' | ') || 'niciun motor de căutare configurat' };
    },
    read: (url) => (reader ? reader.read(url) : Promise.resolve({ ok: false, message: 'cititorul de pagini nu e configurat' })),
  };
}
