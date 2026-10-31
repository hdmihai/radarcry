/**
 * Outbound web adapters of the agent, each pinned to one host family:
 *
 *   SitePort   the deployed dashboard on GitHub Pages (`*.github.io`), to check that it serves the
 *              same run as the state branch
 *   PricePort  CoinGecko's public market list (api.coingecko.com, keyless — the agent never uses the
 *              operator's key, so it cannot eat the scanner's monthly quota), for the 24-hour highs
 *              the calibration ledger needs
 *   Narrator   a local Ollama server (127.0.0.1 / localhost only): an open model running inside the
 *              runner, free, no account, nothing leaves the machine
 */

async function getJson(fetchImpl, url, { timeoutMs = 20_000, headers = {} } = {}) {
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'cri-radar-agent', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text().catch(() => '');
    if (res.status === 429) return { ok: false, status: 'RATE_LIMITED', data: null, message: 'HTTP 429' };
    if (!res.ok) return { ok: false, status: 'HTTP_ERROR', data: null, message: `HTTP ${res.status}` };
    return { ok: true, status: 'OK', data: JSON.parse(text) };
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, status: timeout ? 'TIMEOUT' : 'NETWORK_ERROR', data: null, message: String(err?.cause?.code ?? err?.message ?? err) };
  }
}

/** The default Pages address of a project site: https://<owner>.github.io/<repo>/ */
export const pagesUrlOf = (fullName) => {
  const [owner, name] = String(fullName ?? '').split('/');
  return owner && name ? `https://${owner.toLowerCase()}.github.io/${name}/` : null;
};

export function createSite({ url, fetchImpl = fetch }) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.github.io')) throw new Error(`agent: site-ul verificat trebuie să fie pe *.github.io, nu ${u.hostname}`);
  const base = url.endsWith('/') ? url : `${url}/`;
  return {
    async summary() {
      const r = await getJson(fetchImpl, `${base}data/summary.json?agent=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
      if (!r.ok) return { ...r, data: { url: base } };
      return { ok: true, status: 'OK', data: { url: base, generatedAt: r.data?.generatedAt ?? null } };
    },
  };
}

/** Public market prices, a few calls of up to 200 ids, with one patient retry on a rate limit. */
export function createPublicPrices({ fetchImpl = fetch, chunk = 200, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retryMs = 20_000 }) {
  return {
    async prices(ids) {
      const out = {};
      let failures = 0;
      let last = null;
      for (let i = 0; i < ids.length; i += chunk) {
        const part = ids.slice(i, i + chunk);
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${part.map(encodeURIComponent).join(',')}&per_page=250&page=1&sparkline=false`;
        let r = await getJson(fetchImpl, url, { timeoutMs: 25_000 });
        if (r.status === 'RATE_LIMITED') {
          await sleep(retryMs);
          r = await getJson(fetchImpl, url, { timeoutMs: 25_000 });
        }
        last = r;
        if (!r.ok || !Array.isArray(r.data)) {
          failures += 1;
          continue;
        }
        for (const x of r.data) {
          if (x?.id && Number.isFinite(x.current_price)) out[x.id] = { price: x.current_price, high24h: Number.isFinite(x.high_24h) ? x.high_24h : null };
        }
        if (i + chunk < ids.length) await sleep(2_500);
      }
      const n = Object.keys(out).length;
      if (!n && failures) return { ok: false, status: last?.status ?? 'HTTP_ERROR', data: null, message: last?.message ?? '' };
      return { ok: true, status: failures ? 'PARTIAL' : 'OK', data: out };
    },
  };
}

/** NarratorPort over a local Ollama server. */
export function createOllama({ baseUrl = 'http://127.0.0.1:11434', model, fetchImpl = fetch, timeoutMs = 240_000, numPredict = 420 }) {
  const u = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error(`agent: modelul trebuie să ruleze local (127.0.0.1), nu pe ${u.hostname}`);
  const root = baseUrl.replace(/\/$/, '');
  return {
    id: 'ollama',
    model,
    async available() {
      if (!model) return false;
      const r = await getJson(fetchImpl, `${root}/api/tags`, { timeoutMs: 5_000 });
      return r.ok && (r.data?.models ?? []).some((m) => m.name === model || m.name?.startsWith(`${model}:`) || m.model === model);
    },
    async generate({ system, prompt }) {
      try {
        const res = await fetchImpl(`${root}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, system, prompt, stream: false, options: { temperature: 0.2, num_predict: numPredict, num_ctx: 4096 } }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (!res.ok) return { ok: false, status: 'HTTP_ERROR', data: null, message: `HTTP ${res.status}: ${text.slice(0, 160)}` };
        const d = JSON.parse(text);
        return d?.response ? { ok: true, status: 'OK', data: String(d.response) } : { ok: false, status: 'INVALID_PAYLOAD', data: null, message: 'răspuns gol' };
      } catch (err) {
        const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        return { ok: false, status: timeout ? 'TIMEOUT' : 'NETWORK_ERROR', data: null, message: String(err?.message ?? err).slice(0, 160) };
      }
    },
  };
}
