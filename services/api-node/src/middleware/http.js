/**
 * Cross-cutting HTTP concerns, dependency-free: request id, CORS allow-list, fixed-window rate
 * limit, and the single place where domain errors become HTTP status codes.
 */
import { randomUUID } from 'node:crypto';

export function requestId() {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    res.set('x-request-id', req.id);
    next();
  };
}

export function cors(allowed = []) {
  const any = allowed.includes('*');
  const set = new Set(allowed);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && (any || set.has(origin))) {
      res.set('access-control-allow-origin', any ? '*' : origin);
      res.set('vary', 'Origin');
      res.set('access-control-allow-methods', 'GET,POST,OPTIONS');
      res.set('access-control-allow-headers', 'content-type,x-request-id');
      res.set('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

export function rateLimit({ windowMs = 60_000, max = 120, now = Date.now } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const t = now();
    const ip = req.ip ?? 'unknown';
    let e = hits.get(ip);
    if (!e || t - e.start >= windowMs) {
      e = { start: t, n: 0 };
      hits.set(ip, e);
      if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
    }
    e.n += 1;
    res.set('x-ratelimit-limit', String(max));
    res.set('x-ratelimit-remaining', String(Math.max(0, max - e.n)));
    if (e.n > max) {
      res.set('retry-after', String(Math.ceil((e.start + windowMs - t) / 1000)));
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'prea multe cereri, reîncearcă puțin mai târziu' });
    }
    next();
  };
}

const STATUS = { INVALID_INPUT: 400, NOT_FOUND: 404, UNAVAILABLE: 503, UPSTREAM: 502 };

export function notFoundHandler() {
  return (req, res) => res.status(404).json({ error: 'NOT_FOUND', message: `ruta ${req.method} ${req.path} nu există` });
}

export function errorHandler(logger = console) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'INVALID_INPUT', message: 'corpul cererii nu este JSON valid', requestId: req.id });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'corpul cererii este prea mare', requestId: req.id });
    const status = STATUS[err?.kind] ?? 500;
    if (status >= 500) logger.error?.(`[${req.id}] ${req.method} ${req.originalUrl}: ${err?.stack ?? err}`);
    res.status(status).json({
      error: err?.kind ?? 'INTERNAL',
      message: status === 500 ? 'eroare internă' : err.message,
      ...(err?.details && status !== 500 ? { details: err.details } : {}),
      requestId: req.id,
    });
  };
}
