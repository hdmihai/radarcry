/**
 * Client for the optional CRI Radar API (services/api-node → services/analyst-python).
 *
 * The dashboard stays a static site: on GitHub Pages it renders data/latest.json and nothing else.
 * The quantitative analysis appears only when an API is reachable, decided in this order:
 *   1. ?api=<url> in the page URL (saved; ?api=off forgets it)
 *   2. a URL saved earlier in localStorage (cri.api.base)
 *   3. <meta name="cri-api" content="https://..."> in index.html
 *   4. same origin, when the page is served by api-node itself (localhost / 127.0.0.1)
 * No API → no request, no error, no empty section.
 */
const KEY = 'cri.api.base';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const clean = (u) => String(u).trim().replace(/\/+$/, '');
const isHttp = (u) => /^https?:\/\/[^\s/]+/i.test(u);

/**
 * Pure resolution of the API base: '' = same origin, a URL, or null (disabled).
 * @param {{href:string, hostname:string}} loc
 * @param {{get:(k:string,d?:any)=>any, set:(k:string,v:any)=>void}} store
 * @param {string|null} meta
 */
export function resolveApiBase(loc, store, meta = null) {
  let param = null;
  try {
    param = new URL(loc.href).searchParams.get('api');
  } catch {
    param = null;
  }
  if (param === 'off') {
    store.set(KEY, null);
    return null;
  }
  if (param && isHttp(param)) {
    store.set(KEY, clean(param));
    return clean(param);
  }
  const saved = store.get(KEY, null);
  if (typeof saved === 'string' && isHttp(saved)) return clean(saved);
  if (meta && isHttp(meta)) return clean(meta);
  if (LOCAL_HOSTS.has(loc.hostname)) return '';
  return null;
}

async function timedJson(url, ms, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, cache: 'no-store', headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(t);
  }
}

/** A small client; `available()` probes /api/health once and remembers the answer. */
export function createAnalystClient(base, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  let probe = null;
  return {
    base,
    available() {
      if (base === null || !fetchImpl) return Promise.resolve(false);
      probe ??= timedJson(`${base}/api/health`, 2500, fetchImpl)
        .then((h) => Boolean(h && h.analyst?.ok))
        .catch(() => false);
      return probe;
    },
    asset(key) {
      return timedJson(`${base}/api/analysis/${encodeURIComponent(key)}`, 20_000, fetchImpl);
    },
  };
}
