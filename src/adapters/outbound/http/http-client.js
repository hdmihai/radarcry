/**
 * Resilient HTTP adapter (outbound): per-provider pacing, timeouts (AbortSignal), retries with
 * exponential backoff + full jitter, Retry-After support, rate-limit cooldown with adaptive pacing,
 * circuit breaker, call budgets, quota accounting (units) with a pause gate, and telemetry.
 * Every call resolves to a ProviderResult — it never throws into the application layer.
 *
 * Rate limits are handled as what they are — a request to slow down — not as a broken endpoint:
 *
 *  · A 429 (or a provider's own "too many requests" envelope) cools the whole lane down: every call
 *    queued behind it waits out the Retry-After or the provider's window, not only the call that
 *    met the limit. Before, the retry slept on its own while the next queued call went straight out
 *    and met the same limit, so four rate limits in a row arrived within seconds and opened the
 *    circuit — on GitHub's shared runner addresses GoPlus and GeckoTerminal lost half of every run.
 *  · The lane also slows down (its interval doubles, up to a cap) and recovers gradually after
 *    successes, so the pace converges on what the provider accepts from this address today.
 *  · The circuit opens on rate limits only after `rateLimitStrikes` consecutive requests stayed
 *    limited through their cooldowns — minutes of refusal, not seconds.
 *
 * A *lane* is the unit of pacing and of the circuit breaker. By default it is the provider; a
 * provider that reaches several hosts (the Solana RPC pool) gives each host and method its own lane,
 * so one host's limit never stalls the others. Budgets, quota and telemetry stay per provider.
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
  /**
   * The endpoint answered but does not serve this method (JSON-RPC "method not found", a method a
   * free tier switches off). Used inside endpoint pools to move on to the next host; a pool never
   * returns it to the application, which only sees the statuses above.
   */
  UNSUPPORTED: 'UNSUPPORTED',
};

/** No single cooldown is longer than this, whatever a Retry-After header asks for. */
export const MAX_COOLDOWN_MS = 60_000;

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

/** Failures that count towards the ordinary circuit breaker (rate limits have their own count). */
const BREAKER = new Set([STATUS.TIMEOUT, STATUS.NETWORK_ERROR, STATUS.HTTP_ERROR, STATUS.GEO_BLOCKED]);

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
  /** @type {Map<string, {next:number, chain:Promise<void>, failures:number, limited:number, slowMs:number, open:boolean, calls:number, units:number}>} */
  const states = new Map();

  const stateFor = (key) => {
    if (!states.has(key)) states.set(key, { next: 0, chain: Promise.resolve(), failures: 0, limited: 0, slowMs: 0, open: false, calls: 0, units: 0 });
    return states.get(key);
  };
  const laneKey = (provider, lane) => (lane ? `${provider}@${lane}` : provider);

  /** Serialise calls per lane and keep at least `intervalMs` between request starts. */
  async function pace(st, intervalMs) {
    const prev = st.chain;
    let release;
    st.chain = new Promise((r) => { release = r; });
    await prev;
    const wait = st.next - now();
    if (wait > 0) await sleepFn(wait);
    st.next = now() + (intervalMs ?? 0);
    return release;
  }

  /**
   * A rate limit slows the whole lane: the next call — whichever it is — starts after the cooldown,
   * and the lane's interval grows until the provider stops refusing. Returns the cooldown in ms.
   */
  function coolDown(st, o, retryAfter, attempt) {
    const base = Math.max(250, o.minIntervalMs ?? 0);
    st.slowMs = Math.min(o.maxSlowMs ?? 15_000, Math.max(base, st.slowMs * 2));
    const wait = Math.min(MAX_COOLDOWN_MS, Math.max(0, retryAfter ?? o.rateLimitCooldownMs ?? backoff(attempt + 1)));
    st.next = Math.max(st.next, now() + wait);
    return wait;
  }

  /**
   * One HTTP attempt. Rate limits set the lane's cooldown here, *before* the caller releases the
   * lane, so no queued call can slip out between the 429 and the pause it asks for.
   * @returns {Promise<{kind:'ok'|'rate'|'retry'|'stop', result:any, waitMs?:number}>}
   */
  async function attemptOnce(url, o, st, meta, attempt) {
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
      meta.latencyMs = now() - t0;
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      return { kind: 'retry', result: { ok: false, status: timeout ? STATUS.TIMEOUT : STATUS.NETWORK_ERROR, data: null, message: String(err?.cause?.code ?? err?.message ?? err) } };
    }
    meta.httpStatus = res.status;
    meta.latencyMs = now() - t0;
    const text = await res.text().catch(() => '');
    meta.bytes = text.length;

    if (res.status === 429 || res.status === 418) {
      const waitMs = coolDown(st, o, retryAfterMs(res.headers.get('retry-after'), now()), attempt);
      return { kind: 'rate', waitMs, result: { ok: false, status: STATUS.RATE_LIMITED, data: null, message: `HTTP ${res.status}` } };
    }
    // Free plan exhausted: 402 Payment Required, or 403 whose body names a quota/credit limit.
    if (res.status === 402 || (res.status === 403 && QUOTA_PATTERNS.test(text.slice(0, 600)))) {
      st.open = true;
      return { kind: 'stop', result: { ok: false, status: STATUS.QUOTA_EXHAUSTED, data: null, message: `HTTP ${res.status}: cuota planului gratuit este epuizată` } };
    }
    // 451, or a CDN 403 that names a location restriction (a plain 403 "Forbidden" is an auth problem, not geo).
    if (res.status === 451 || (res.status === 403 && /restricted location|country|region|cloudfront|not available in your/i.test(text.slice(0, 600)))) {
      return { kind: 'stop', result: { ok: false, status: STATUS.GEO_BLOCKED, data: null, message: `HTTP ${res.status} (restricționat geografic)` } };
    }
    if (res.status >= 500) return { kind: 'retry', result: { ok: false, status: STATUS.HTTP_ERROR, data: null, message: `HTTP ${res.status}` } };
    /*
     * 404 / 410 are answers about *that* resource (a repository deleted or made private, a coin id
     * the aggregator dropped), not signs that the provider is failing: they stop this call but never
     * count towards the circuit breaker. Counting them used to open GitHub's circuit after two
     * projects with stale repository links, so development activity went dark for the rest of every run.
     */
    if (res.status === 404 || res.status === 410) return { kind: 'stop', notFound: true, result: { ok: false, status: STATUS.HTTP_ERROR, data: null, message: `HTTP ${res.status}: resursa nu există` } };
    if (res.status >= 400) return { kind: 'stop', result: { ok: false, status: STATUS.HTTP_ERROR, data: null, message: `HTTP ${res.status}: ${text.slice(0, 400).replace(/\s+/g, ' ').trim().slice(0, 160)}` } };

    // "Accepted, still computing" (GitHub statistics answer 202 with an empty body) is a valid answer
    // when the adapter says what an empty answer means; otherwise an empty body is an invalid payload.
    if ((res.status === 202 || res.status === 204) && !text.trim() && o.emptyAs !== undefined) {
      return { kind: 'ok', result: { ok: true, status: STATUS.OK, data: o.emptyAs, message: `HTTP ${res.status}: răspuns gol (în curs de calcul la furnizor)` } };
    }

    let data;
    try {
      data = o.parse === 'text' ? text : JSON.parse(text);
    } catch (err) {
      return { kind: 'stop', result: { ok: false, status: STATUS.INVALID_PAYLOAD, data: null, message: `JSON invalid: ${String(err.message).slice(0, 120)}` } };
    }
    /*
     * Some APIs answer HTTP 200 with an error envelope in the body ({code: 4029, message: "too many
     * requests"}). A boolean `validate` can only call that "unexpected structure", which hides the
     * one fact that matters — the provider's own reason. `classify` lets an adapter name it: a
     * RATE_LIMITED verdict cools the lane exactly like an HTTP 429, anything else stops with the
     * provider's code and message, and both reach the telemetry as they are.
     */
    const verdict = o.classify ? o.classify(data) : null;
    if (verdict) {
      const result = { ok: false, status: verdict.status ?? STATUS.INVALID_PAYLOAD, data: null, message: verdict.message ?? 'răspuns respins de furnizor' };
      if (result.status === STATUS.RATE_LIMITED) return { kind: 'rate', waitMs: coolDown(st, o, null, attempt), result };
      return { kind: 'stop', result };
    }
    if (o.validate && !o.validate(data)) {
      return { kind: 'stop', result: { ok: false, status: STATUS.INVALID_PAYLOAD, data: null, message: 'structură neașteptată a răspunsului' } };
    }
    if (o.hash) meta.sha256 = createHash('sha256').update(text).digest('hex');
    return { kind: 'ok', result: { ok: true, status: STATUS.OK, data, message: '' } };
  }

  /**
   * @param {string} url
   * @param {{provider:string, endpoint?:string, lane?:string, headers?:Record<string,string>, timeoutMs?:number, retries?:number,
   *          minIntervalMs?:number, maxCalls?:number, breakerThreshold?:number,
   *          rateLimitCooldownMs?:number, rateLimitStrikes?:number, maxSlowMs?:number,
   *          validate?:(data:any)=>boolean, classify?:(data:any)=>({status:string, message?:string}|null),
   *          redact?:(message:string)=>string,
   *          parse?: 'json'|'text', hash?: boolean, units?: number, emptyAs?: any,
   *          method?: 'GET'|'POST', body?: string, contentType?: string}} o
   */
  async function request(url, o) {
    const provider = o.provider;
    const endpoint = o.endpoint ?? new URL(url).pathname;
    const ps = stateFor(provider); // budget and units: always per provider
    const st = stateFor(laneKey(provider, o.lane)); // pacing and circuit: per lane
    const started = now();
    const units = Number.isFinite(o.units) ? o.units : 1;
    const meta = { provider, endpoint, fetchedAt: new Date(started).toISOString(), latencyMs: 0, httpStatus: null, attempts: 0, bytes: 0, units: 0 };
    const done = (result) => finish({ ...result, meta }, o.redact);

    if (st.open) return done({ ok: false, status: STATUS.CIRCUIT_OPEN, data: null, message: 'circuit deschis după eșecuri repetate în această rulare' });
    if (o.maxCalls && ps.calls >= o.maxCalls) return done({ ok: false, status: STATUS.BUDGET_EXHAUSTED, data: null, message: `buget de ${o.maxCalls} apeluri epuizat` });
    if (gate) {
      const verdict = gate.check(provider, units);
      if (!verdict.allow) return done({ ok: false, status: STATUS.QUOTA_EXHAUSTED, data: null, message: verdict.reason ?? 'cuotă lunară aproape epuizată — pauză preventivă' });
    }
    if (deadlineMs && now() > deadlineMs) return done({ ok: false, status: STATUS.SKIPPED, data: null, message: 'termenul rulării a expirat' });

    const retries = o.retries ?? 2;
    let last = null;
    let notFound = false;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const release = await pace(st, (o.minIntervalMs ?? 0) + st.slowMs);
      // The wait in the queue (or a cooldown) may have outlived the run.
      if (deadlineMs && now() > deadlineMs) {
        release();
        last = { ok: false, status: STATUS.SKIPPED, data: null, message: 'termenul rulării a expirat' };
        break;
      }
      ps.calls += 1;
      ps.units += units;
      if (st !== ps) st.calls += 1;
      meta.units += units;
      gate?.charge?.(provider, units);
      meta.attempts = attempt + 1;
      let out;
      try {
        out = await attemptOnce(url, o, st, meta, attempt);
      } finally {
        release();
      }
      if (out.kind === 'ok') {
        st.failures = 0;
        st.limited = 0;
        if (st.slowMs) st.slowMs = st.slowMs < 200 ? 0 : Math.floor(st.slowMs * 0.7);
        return done(out.result);
      }
      last = out.result;
      notFound = out.notFound === true;
      if (out.kind === 'stop' || attempt >= retries) break;
      if (out.kind === 'rate') {
        // pace() waits the cooldown out — unless it would end after the run does.
        if (deadlineMs && now() + (out.waitMs ?? 0) > deadlineMs) break;
        continue;
      }
      await sleepFn(backoff(attempt)); // timeout, network error, 5xx: back off this call only
    }

    meta.latencyMs = now() - started;
    if (last?.status === STATUS.RATE_LIMITED) {
      st.limited += 1;
      if (st.limited >= (o.rateLimitStrikes ?? 4)) st.open = true;
    } else if (last && BREAKER.has(last.status) && !notFound) {
      st.failures += 1;
      if (st.failures >= (o.breakerThreshold ?? 4) || last.status === STATUS.GEO_BLOCKED) st.open = true;
    }
    return done(last ?? { ok: false, status: STATUS.NETWORK_ERROR, data: null, message: 'eroare necunoscută' });
  }

  const getJson = (url, o) => request(url, { ...o, method: 'GET' });
  const postJson = (url, payload, o) => request(url, { ...o, method: 'POST', body: JSON.stringify(payload ?? {}), contentType: 'application/json' });
  const postForm = (url, fields, o) => request(url, { ...o, method: 'POST', body: new URLSearchParams(fields ?? {}).toString(), contentType: 'application/x-www-form-urlencoded' });

  function finish(result, redact) {
    if (redact && result.message) result.message = redact(result.message);
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

  /**
   * Where a lane stands right now — for adapters that fail over between hosts and would rather
   * move on than queue behind a long cooldown.
   */
  const laneStatus = (provider, lane = null) => {
    const st = stateFor(laneKey(provider, lane));
    return { open: st.open, waitMs: Math.max(0, st.next - now()), slowMs: st.slowMs, limited: st.limited, failures: st.failures };
  };

  return { getJson, postJson, postForm, laneStatus, providerState: (p, lane = null) => ({ ...stateFor(laneKey(p, lane)) }) };
}
