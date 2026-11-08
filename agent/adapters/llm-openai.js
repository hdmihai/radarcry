/**
 * LlmPort over an OpenAI-compatible chat-completions API with tool calling — Groq and OpenRouter both
 * speak it, both have a free plan, both want an API key from a free account. The key is read from the
 * environment by the caller and sent only to the host pinned here; the model never sees it.
 *
 * `createLlmChain` tries the providers in order; a rate limit (429) is waited out when it is short
 * (the free plans limit tokens per minute), otherwise the next provider is tried.
 */
const HOSTS = new Set(['api.groq.com', 'openrouter.ai', '127.0.0.1']);
export const GROQ_URL = 'https://api.groq.com/openai/v1';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

export function createOpenAiCompat({ id, baseUrl, apiKey, model, timeoutMs = 90_000, maxTokens = 1200, fetchImpl = globalThis.fetch }) {
  const u = new URL(baseUrl);
  if (!HOSTS.has(u.hostname)) throw new Error(`gazdă nepermisă pentru model: ${u.hostname}`);
  const base = baseUrl.replace(/\/+$/, '');
  return {
    id,
    model,
    available: () => Boolean(apiKey),
    /** @returns {Promise<{ok:boolean, status?:number, retryAfterMs?:number, message?:string, data?:{message:any, usage:any, model:string, provider:string}}>} */
    async chat({ messages, tools = null, temperature = 0.3, maxTokens: max = maxTokens, modelOverride = null }) {
      if (!apiKey) return { ok: false, status: 0, message: `${id}: lipsește cheia` };
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: modelOverride ?? model, messages, temperature, max_tokens: max, ...(tools?.length ? { tools, tool_choice: 'auto' } : {}) }),
          signal: ctl.signal,
        });
        if (!res.ok) {
          const retry = Number(res.headers.get('retry-after'));
          const text = await res.text().catch(() => '');
          return { ok: false, status: res.status, retryAfterMs: Number.isFinite(retry) && retry > 0 ? Math.round(retry * 1000) : null, message: `${id}: HTTP ${res.status} ${text.replace(/\s+/g, ' ').slice(0, 160)}` };
        }
        const doc = await res.json();
        const message = doc?.choices?.[0]?.message;
        if (!message) return { ok: false, status: 502, message: `${id}: răspuns fără mesaj` };
        return { ok: true, data: { message, usage: doc.usage ?? null, model: doc.model ?? modelOverride ?? model, provider: id } };
      } catch (err) {
        return { ok: false, status: 0, message: `${id}: ${err?.name === 'AbortError' ? 'timp depășit' : String(err?.message ?? err).slice(0, 120)}` };
      } finally {
        clearTimeout(t);
      }
    },
  };
}

/**
 * @param {{providers:any[], sleep?:(ms:number)=>Promise<void>, maxWaitMs?:number}} o
 */
export function createLlmChain({ providers, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxWaitMs = 65_000 }) {
  const usable = providers.filter((p) => p?.available?.());
  return {
    available: () => usable.length > 0,
    providers: usable.map((p) => p.id),
    async chat(req) {
      const errors = [];
      for (const p of usable) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const r = await p.chat(req);
          if (r.ok) return r;
          errors.push(r.message);
          // A short rate limit is waited out once; a long one, or a server error, moves on.
          if (r.status === 429 && r.retryAfterMs !== undefined && attempt < 2 && (r.retryAfterMs ?? 8000) <= maxWaitMs) {
            await sleep((r.retryAfterMs ?? 8000) + 250);
            continue;
          }
          if (r.status >= 500 && attempt < 1) {
            await sleep(1500);
            continue;
          }
          break;
        }
      }
      return { ok: false, status: 503, message: errors.slice(-3).join(' | ') || 'niciun model configurat' };
    },
    /** A second opinion: one provider's own model, by name, without tools. */
    async ask({ providerId, model, messages, maxTokens = 700 }) {
      const named = usable.find((x) => x.id === providerId);
      const p = named ?? usable[0];
      if (!p) return { ok: false, message: 'niciun model configurat' };
      // A provider that is not configured is replaced by the first one, with its own default model.
      return p.chat({ messages, modelOverride: named ? model ?? null : null, temperature: 0.4, maxTokens });
    },
  };
}

/**
 * ConsultPort: the assistant asks another agent — another model, in a role — for a second opinion.
 * @param {{chain:any, roles:Record<string,{provider:string, model:string}>, build:(o:any)=>any[]}} o
 */
export function createConsult({ chain, roles, build }) {
  return {
    async ask({ role, question, context }) {
      const pick = roles[role] ?? roles.second_opinion ?? {};
      const r = await chain.ask({ providerId: pick.provider, model: pick.model, messages: build({ role, question, context }) });
      if (!r.ok) return { ok: false, message: r.message };
      const text = String(r.data.message.content ?? '').trim();
      return text ? { ok: true, data: { text, model: r.data.model } } : { ok: false, message: 'răspuns gol' };
    },
  };
}
