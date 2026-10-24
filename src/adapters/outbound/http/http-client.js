/**
 * Resilient HTTP adapter (outbound): per-provider pacing, timeouts (AbortSignal), retries with
 * exponential backoff + full jitter, Retry-After support, circuit breaker, call budgets,
 * quota accounting (units) with a pause gate, and telemetry.
 * Every call resolves to a ProviderResult — it never throws into the application layer.
 */
import { createHash } from 'node:crypto';

export const STATUS = {
  OK: 'OK',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  HTTP_ERROR: 'HTTP_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  GEO_BLOCKED: 'GEO_BLOCKED',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  SKIPPED: 'SKIPPED',
};

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

function retryAfterMs(header, nowMs) {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/** HTTP 402/403 bodies that mean "free plan exhausted" rather than "wrong key". */
const QUOTA_PATTERNS = /quota|credit limit|monthly limit|plan limit|usage limit|exceeded your|out of credits|cu limit|compute unit/i;

/**
 * @param {{fetchImpl?: typeof fetch, telemetry?: {record:(e:any)=>void}, logger?: any, userAgent?: string,
 *          deadlineMs?: number, now?: () => number, sleepFn?: (ms:number)=>Promise<void>,
 *          gate?: {check:(provider:string, units:number)=>({allow:boolean, reason?:string}), charge:(provider:string, units:number)=>void}}} opts
 */
export function createHttpClient({
  fetchImpl = globalThis.fetch,
  telemetry = null,
  logger = null,
  userAgent = 'CRI-Radar/4.0 (+research-only; https://github.com/)',
  deadlineMs = null,
  now = Date.now,
  sleepFn = sleep,
  gate = null,
} = {}) {
  /** @type {Map<string, {next:number, chain:Promise<void>, failures:number, open:boolean, calls:number, units:number}>} */
  const providers = new Map();

  const stateFor = (provider) => {
    if (!providers.has(provider)) providers.set(provider, { next: 0, chain: Promise.resolve(), failures: 0, open: false, calls: 0, units: 0 });
    return providers.get(provider);
  };

  /** Serialise calls per provider and keep at least `minIntervalMs` between request starts. */
  async function pace(provider, minIntervalMs) {
    const st = stateFor(provider);
    const prev = st.chain;
    let release;
    st.chain = new Promise((r) => { release = r; });
    await prev;
    const wait = st.next - now();
    if (wait > 0) await sleepFn(wait);
    st.next = now() + (minIntervalMs ?? 0);
    return release;
  }

  /**
   * @param {string} url
   * @param {{provider:string, endpoint?:string, headers?:Record<string,string>, timeoutMs?:number, retries?:number,
   *          minIntervalMs?:number, maxCalls?:number, breakerThreshold?:number, validate?:(data:any)=>boolean,
   *          parse?: 'json'|'text', hash?: boolean, units?: number,
   *          method?: 'GET'|'POST', body?: string, contentType?: string}} o
   */
  async function request(url, o) {
    const provider = o.provider;
    const endpoint = o.endpoint ?? new URL(url).pathname;
    const st = stateFor(provider);
    const started = now();
    const units = Number.isFinite(o.units) ? o.units : 1;
    const meta = { provider, endpoint, fetchedAt: new Date(started).toISOString(), latencyMs: 0, httpStatus: null, attempts: 0, bytes: 0, units: 0 };

    if (st.open) return finish({ ok: false, status: STATUS.CIRCUIT_OPEN, data: null, message: 'circuit deschis după eșecuri repetate în această rulare', meta });
    if (o.maxCalls && st.calls >= o.maxCalls) return finish({ ok: false, status: STATUS.BUDGET_EXHAUSTED, data: null, message: `buget de ${o.maxCalls} apeluri epuizat`, meta });
    if (gate) {
      const verdict = gate.check(provider, units);
      if (!verdict.allow) return finish({ ok: false, status: STATUS.QUOTA_EXHAUSTED, data: null, message: verdict.reason ?? 'cuotă lunară aproape epuizată — pauză preventivă', meta });
    }
    if (deadlineMs && now() > deadlineMs) return finish({ ok: false, status: STATUS.SKIPPED, data: null, message: 'termenul rulării a expirat', meta });

    const retries = o.retries ?? 2;
    let last = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const release = await pace(provider, o.minIntervalMs);
      st.calls += 1;
      st.units += units;
      meta.units += units;
      gate?.charge?.(provider, units);
      meta.attempts = attempt + 1;
      const t0 = now();
      let res;
      try {
        res = await fetchImpl(url, {
          method: o.method ?? 'GET',
          headers: {
            accept: 'application/json',
            'user-agent': userAgent,
            ...(o.body !== undefined ? { 'content-type': o.contentType ?? 'application/json' } : {}),
            ...(o.headers ?? {}),
          },
          ...(o.body !== undefined ? { body: o.body } : {}),
          signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
        });
      } catch (err) {
        release();
        const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        last = { ok: false, status: timeout ? STATUS.TIMEOUT : STATUS.NETWORK_ERROR, data: null, message: String(err?.cause?.code ?? err?.message ?? err) };
        meta.latencyMs = now() - t0;
        if (attempt < retries) { await sleepFn(backoff(attempt)); continue; }
        break;
      }
      release();
      meta.httpStatus = res.status;
      meta.latencyMs = now() - t0;
      const text = await res.text().catch(() => '');
      meta.bytes = text.length;
      if (res.status === 429 || res.status === 418) {
        last = { ok: false, status: STATUS.RATE_LIMITED, data: null, message: `HTTP ${res.status}` };
        const ra = retryAfterMs(res.headers.get('retry-after'), now());
        if (attempt < retries) { await sleepFn(Math.min(ra ?? backoff(attempt + 1), 30_000)); continue; }
        break;
      }
      // Free plan exhausted: 402 Payment Required, or 403 whose body names a quota/credit limit.
      if (res.status === 402 || (res.status === 403 && QUOTA_PATTERNS.test(text.slice(0, 600)))) {
        last = { ok: false, status: STATUS.QUOTA_EXHAUSTED, data: null, message: `HTTP ${res.status}: cuota planului gratuit este epuizată` };
        st.open = true;
        break;
      }
      // 451, or a CDN 403 that names a location restriction (a plain 403 "Forbidden" is an auth problem, not geo).
      if (res.status === 451 || (res.status === 403 && /restricted location|country|region|cloudfront|not available in your/i.test(text.slice(0, 600)))) {
        last = { ok: false, status: STATUS.GEO_BLOCKED, data: null, message: `HTTP ${res.status} (restricționat geografic)` };
        break;
      }
      if (res.status >= 500) {
        last = { ok: false, status: STATUS.HTTP_ERROR, data: null, message: `HTTP ${res.status}` };
        if (attempt < retries) { await sleepFn(backoff(attempt)); continue; }
        break;
      }
      if (res.status >= 400) {
        last = { ok: false, status: STATUS.HTTP_ERROR, data: null, message: `HTTP ${res.status}: ${text.slice(0, 160)}` };
        break;
      }
      let data;
      try {
        data = o.parse === 'text' ? text : JSON.parse(text);
      } catch (err) {
        last = { ok: false, status: STATUS.INVALID_PAYLOAD, data: null, message: `JSON invalid: ${String(err.message).slice(0, 120)}` };
        break;
      }
      if (o.validate && !o.validate(data)) {
        last = { ok: false, status: STATUS.INVALID_PAYLOAD, data: null, message: 'structură neașteptată a răspunsului' };
        break;
      }
      if (o.hash) meta.sha256 = createHash('sha256').update(text).digest('hex');
      st.failures = 0;
      return finish({ ok: true, status: STATUS.OK, data, message: '', meta });
    }
    meta.latencyMs = now() - started;
    if (last && [STATUS.TIMEOUT, STATUS.NETWORK_ERROR, STATUS.HTTP_ERROR, STATUS.RATE_LIMITED, STATUS.GEO_BLOCKED].includes(last.status)) {
      st.failures += 1;
      if (st.failures >= (o.breakerThreshold ?? 4) || last.status === STATUS.GEO_BLOCKED) st.open = true;
    }
    return finish({ ...(last ?? { ok: false, status: STATUS.NETWORK_ERROR, data: null, message: 'eroare necunoscută' }), meta });
  }

  const getJson = (url, o) => request(url, { ...o, method: 'GET' });
  const postJson = (url, payload, o) => request(url, { ...o, method: 'POST', body: JSON.stringify(payload ?? {}), contentType: 'application/json' });
  const postForm = (url, fields, o) => request(url, { ...o, method: 'POST', body: new URLSearchParams(fields ?? {}).toString(), contentType: 'application/x-www-form-urlencoded' });

  function finish(result) {
    telemetry?.record?.({
      provider: result.meta.provider,
      endpoint: result.meta.endpoint,
      status: result.status,
      httpStatus: result.meta.httpStatus,
      latencyMs: result.meta.latencyMs,
      attempts: result.meta.attempts,
      bytes: result.meta.bytes,
      units: result.meta.units,
      at: result.meta.fetchedAt,
      message: result.message,
    });
    if (!result.ok) logger?.debug?.(`[${result.meta.provider}] ${result.meta.endpoint} → ${result.status} ${result.message ?? ''}`);
    return result;
  }

  function backoff(attempt) {
    const base = Math.min(15_000, 800 * 2 ** attempt);
    return Math.round(base / 2 + Math.random() * (base / 2)); // full jitter (half-floor)
  }

  return { getJson, postJson, postForm, providerState: (p) => ({ ...stateFor(p) }) };
}
