/**
 * PythonBridge — outbound adapter implementing AnalystPort over the Python analyst (FastAPI).
 *
 * Two transports, same port:
 *   http   (default) JSON over HTTP to services/analyst-python (uvicorn). Used in Docker / prod.
 *   spawn  runs `python cli.py <command>` once per call, JSON on stdin/stdout. Used in GitHub
 *          Actions or on a laptop where no long-running Python server is wanted.
 *
 * Resilience is the adapter's job, not the core's: per-call timeout, bounded retries with backoff
 * on transient failures (network, 502/503/504), and a small circuit breaker so a dead analyst does
 * not make every API request wait for its timeout.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { upstream, unavailable, invalid } from '../domain/errors.js';

const TRANSIENT = new Set([502, 503, 504]);
const ROUTES = {
  health: { method: 'GET', path: '/health' },
  analyzeAsset: { method: 'POST', path: '/v1/analyze/asset' },
  analyzeUniverse: { method: 'POST', path: '/v1/analyze/universe' },
  analyzeSeries: { method: 'POST', path: '/v1/analyze/series' },
  onchain: { method: 'GET', path: '/v1/onchain' },
};

export class PythonBridge {
  /**
   * @param {object} opts
   * @param {'http'|'spawn'} [opts.mode]
   * @param {string} [opts.baseUrl]        e.g. http://127.0.0.1:8000
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.retries]
   * @param {string} [opts.python]         spawn mode: interpreter
   * @param {string} [opts.cliPath]        spawn mode: path to services/analyst-python/cli.py
   * @param {string} [opts.cwd]
   * @param {number} [opts.breakerThreshold]
   * @param {number} [opts.breakerCooldownMs]
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {typeof nodeSpawn} [opts.spawnImpl]
   * @param {() => number} [opts.now]
   * @param {(ms:number) => Promise<void>} [opts.sleep]
   */
  constructor(opts = {}) {
    this.mode = opts.mode ?? 'http';
    if (!['http', 'spawn'].includes(this.mode)) throw new Error(`PythonBridge: mod necunoscut ${this.mode}`);
    this.baseUrl = String(opts.baseUrl ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.retries = opts.retries ?? 2;
    this.python = opts.python ?? 'python3';
    this.cliPath = opts.cliPath ?? null;
    this.cwd = opts.cwd ?? undefined;
    this.breakerThreshold = opts.breakerThreshold ?? 5;
    this.breakerCooldownMs = opts.breakerCooldownMs ?? 30_000;
    this.fetch = opts.fetchImpl ?? globalThis.fetch;
    this.spawn = opts.spawnImpl ?? nodeSpawn;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.failures = 0;
    this.openUntil = 0;
    if (this.mode === 'spawn' && !this.cliPath) throw new Error('PythonBridge: modul spawn cere cliPath');
  }

  /* ───────────── AnalystPort ───────────── */

  async health() {
    try {
      const body = await this.#call('health', null, { retries: 0, timeoutMs: Math.min(this.timeoutMs, 3000) });
      return { ok: body?.status === 'ok', mode: this.mode, ...body };
    } catch (err) {
      return { ok: false, mode: this.mode, error: String(err?.message ?? err), breaker: this.breakerState() };
    }
  }

  analyzeAsset(payload) {
    return this.#call('analyzeAsset', payload);
  }

  analyzeUniverse(payloads) {
    return this.#call('analyzeUniverse', { assets: payloads });
  }

  analyzeSeries(series) {
    return this.#call('analyzeSeries', series);
  }

  onchain(chain, address) {
    return this.#call('onchain', { chain, address });
  }

  breakerState() {
    return { open: this.now() < this.openUntil, failures: this.failures, openUntil: this.openUntil || null };
  }

  /* ───────────── transport ───────────── */

  async #call(op, body, { retries = this.retries, timeoutMs = this.timeoutMs } = {}) {
    if (this.now() < this.openUntil) {
      throw unavailable('analistul Python este temporar indisponibil (circuit deschis)', { retryAfterMs: this.openUntil - this.now() });
    }
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const out = this.mode === 'http' ? await this.#http(op, body, timeoutMs) : await this.#spawn(op, body, timeoutMs);
        this.failures = 0;
        return out;
      } catch (err) {
        lastErr = err;
        if (!err.transient || attempt === retries) break;
        await this.sleep(200 * 2 ** attempt);
      }
    }
    if (lastErr?.transient) {
      this.failures += 1;
      if (this.failures >= this.breakerThreshold) this.openUntil = this.now() + this.breakerCooldownMs;
    }
    if (lastErr?.kind) throw lastErr;
    throw upstream(`analistul Python a eșuat: ${lastErr?.message ?? lastErr}`);
  }

  async #http(op, body, timeoutMs) {
    const route = ROUTES[op];
    let url = `${this.baseUrl}${route.path}`;
    if (op === 'onchain') url += `/${encodeURIComponent(body.chain)}/${encodeURIComponent(body.address)}`;
    let res;
    try {
      res = await this.fetch(url, {
        method: route.method,
        headers: { accept: 'application/json', ...(route.method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        body: route.method === 'POST' ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw Object.assign(new Error(err?.name === 'TimeoutError' ? `timeout după ${timeoutMs} ms` : String(err?.message ?? err)), { transient: true });
    }
    const text = await res.text();
    let doc = null;
    try {
      doc = text ? JSON.parse(text) : null;
    } catch {
      doc = null;
    }
    if (res.ok) {
      if (doc === null) throw Object.assign(upstream('analistul Python a întors un răspuns non-JSON'), { transient: false });
      return doc;
    }
    if (TRANSIENT.has(res.status)) throw Object.assign(new Error(`HTTP ${res.status}`), { transient: true });
    const detail = doc?.detail ?? doc?.error ?? text.slice(0, 300);
    if (res.status === 422 || res.status === 400) throw invalid(`analistul a respins datele: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}`);
    throw upstream(`analistul Python: HTTP ${res.status}`, { detail });
  }

  #spawn(op, body, timeoutMs) {
    const command = { health: 'health', analyzeAsset: 'asset', analyzeUniverse: 'universe', analyzeSeries: 'series', onchain: 'onchain' }[op];
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawn(this.python, [this.cliPath, command], { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      } catch (err) {
        reject(Object.assign(new Error(String(err?.message ?? err)), { transient: true }));
        return;
      }
      let out = '';
      let errOut = '';
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn(v);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, Object.assign(new Error(`timeout după ${timeoutMs} ms`), { transient: true }));
      }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (errOut += d.slice(0, 4000)));
      child.on('error', (err) => finish(reject, Object.assign(new Error(String(err?.message ?? err)), { transient: true })));
      child.on('close', (code) => {
        let doc = null;
        try {
          doc = out.trim() ? JSON.parse(out) : null;
        } catch {
          doc = null;
        }
        if (code === 0 && doc !== null) return finish(resolve, doc);
        if (code === 2) return finish(reject, invalid(`analistul a respins datele: ${doc?.detail ?? errOut.trim().slice(0, 300)}`));
        finish(reject, Object.assign(upstream(`analistul Python (spawn) a ieșit cu codul ${code}`, { stderr: errOut.trim().slice(-600) }), { transient: false }));
      });
      child.stdin.on('error', () => {});
      child.stdin.end(body === null ? '{}' : JSON.stringify(body));
    });
  }
}
