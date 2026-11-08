/**
 * HTTP inbound adapter of the agent: the dashboard's chat talks to it. It only translates — a request
 * in, a use-case call, a response out; every decision lives in agent/application.
 *
 *   GET    /api/health                          {service, ok, auth}
 *   GET    /api/conversations                   the history, pinned first
 *   GET    /api/conversations/:id               one conversation with its messages
 *   PATCH  /api/conversations/:id               {title?, pinned?}
 *   DELETE /api/conversations/:id
 *   GET    /api/conversations/:id/export        a text file
 *   POST   /api/conversations/:id/messages      {text} → NDJSON: {type:"status"}…, {type:"reply"} | {type:"error"}
 *   anything else                                the built dashboard (dist), when one is given
 *
 * Safe by default: it listens on 127.0.0.1; a browser page of another origin cannot use it (the Origin
 * header is checked on every /api request, writes need a JSON content type); outside loopback a token
 * is mandatory; bodies are capped; errors never carry a stack.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const MAX_BODY = 32 * 1024;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const CONV = /^\/api\/conversations\/([^/]+)(?:\/(messages|export))?$/;

/**
 * @param {{app:{list:Function, open:Function, update:Function, remove:Function, exportText:Function, send:Function},
 *          port?:number, host?:string, dist?:string|null, origins?:string[], token?:string|null}} o
 */
export function createAgentServer({ app, port = 8787, host = '127.0.0.1', dist = null, origins = [], token = null }) {
  if (!LOOPBACK.has(host) && !token) throw new Error('în afara buclei locale serverul cere un token (CRI_AGENT_TOKEN)');
  const root = dist ? resolve(dist) : null;
  const secret = token ? Buffer.from(String(token)) : null;
  const allowed = new Set(origins.map((o) => String(o).replace(/\/+$/, '')));

  const own = (req) => `http://${req.headers.host ?? ''}`;
  const originOk = (req) => {
    const o = req.headers.origin;
    return !o || o === own(req) || allowed.has(o);
  };
  const authOk = (req) => {
    if (!secret) return true;
    const given = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
    return given.length === secret.length && timingSafeEqual(given, secret);
  };
  const cors = (req, res) => {
    const o = req.headers.origin;
    if (o && originOk(req)) {
      res.setHeader('access-control-allow-origin', o);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type, authorization');
      // A page served over https (GitHub Pages) reaching this local server needs the private-network opt-in.
      if (req.headers['access-control-request-private-network']) res.setHeader('access-control-allow-private-network', 'true');
      res.setHeader('access-control-max-age', '600');
    }
  };
  const send = (req, res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    cors(req, res);
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const fail = (req, res, r) => send(req, res, r.status && r.status >= 400 ? r.status : 500, { ok: false, message: r.message ?? 'eroare' });

  const body = (req) =>
    new Promise((ok, no) => {
      let size = 0;
      const parts = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          no(Object.assign(new Error('cererea este prea mare'), { status: 413 }));
          req.destroy();
          return;
        }
        parts.push(c);
      });
      req.on('end', () => {
        try {
          const text = Buffer.concat(parts).toString('utf8');
          ok(text ? JSON.parse(text) : {});
        } catch {
          no(Object.assign(new Error('JSON invalid'), { status: 400 }));
        }
      });
      req.on('error', no);
    });

  async function api(req, res, url) {
    if (!originOk(req)) return send(req, res, 403, { ok: false, message: 'origine nepermisă' });
    if (req.method === 'OPTIONS') return send(req, res, 204, '');
    if (url.pathname === '/api/health') return send(req, res, 200, { service: 'cri-agent', ok: true, auth: Boolean(secret) });
    if (!authOk(req)) return send(req, res, 401, { ok: false, message: 'token lipsă sau greșit' }, undefined, { 'www-authenticate': 'Bearer' });
    const writes = ['POST', 'PATCH'].includes(req.method);
    if (writes && !/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return send(req, res, 415, { ok: false, message: 'cer application/json' });

    if (url.pathname === '/api/conversations' && req.method === 'GET') {
      const r = await app.list();
      return r.ok ? send(req, res, 200, { ok: true, conversations: r.data }) : fail(req, res, r);
    }
    const m = CONV.exec(url.pathname);
    if (!m) return send(req, res, 404, { ok: false, message: 'nu există' });
    const id = decodeURIComponent(m[1]);
    if (!m[2]) {
      if (req.method === 'GET') {
        const r = await app.open(id);
        return r.ok ? send(req, res, 200, { ok: true, conversation: r.data }) : fail(req, res, r);
      }
      if (req.method === 'PATCH') {
        const r = await app.update(id, await body(req));
        return r.ok ? send(req, res, 200, { ok: true, conversation: r.data }) : fail(req, res, r);
      }
      if (req.method === 'DELETE') {
        const r = await app.remove(id);
        return r.ok ? send(req, res, 200, { ok: true }) : fail(req, res, r);
      }
    } else if (m[2] === 'export' && req.method === 'GET') {
      const r = await app.exportText(id);
      return r.ok ? send(req, res, 200, r.data.text, 'text/plain; charset=utf-8', { 'content-disposition': `attachment; filename="${r.data.name}"`, 'access-control-expose-headers': 'content-disposition' }) : fail(req, res, r);
    } else if (m[2] === 'messages' && req.method === 'POST') {
      const input = await body(req);
      cors(req, res);
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' });
      const line = (o) => res.write(`${JSON.stringify(o)}\n`);
      try {
        const r = await app.send(id, input.text, (text) => line({ type: 'status', text }));
        line(r.ok ? { type: 'reply', conversation: r.data.conversation, messages: r.data.messages, intent: r.data.intent, by: r.data.by } : { type: 'error', message: r.message ?? 'eroare' });
      } catch {
        line({ type: 'error', message: 'agentul nu a putut răspunde acum' });
      }
      return res.end();
    }
    return send(req, res, 405, { ok: false, message: 'metodă nepermisă' });
  }

  async function files(req, res, url) {
    if (!root || !['GET', 'HEAD'].includes(req.method)) return send(req, res, 404, 'not found', 'text/plain; charset=utf-8');
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!path.startsWith(root + sep) && path !== root) return send(req, res, 403, 'forbidden', 'text/plain; charset=utf-8');
    const st = await stat(path).catch(() => null);
    if (st?.isDirectory()) path = join(path, 'index.html');
    try {
      const data = await readFile(path);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      return send(req, res, 404, 'not found', 'text/plain; charset=utf-8');
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await files(req, res, url);
    } catch (err) {
      if (res.headersSent) return res.end();
      send(req, res, err?.status ?? 500, { ok: false, message: err?.status ? err.message : 'eroare internă' });
    }
  });
  return { server, listen: () => new Promise((ok, no) => { server.once('error', no); server.listen(port, host, () => ok(server)); }) };
}
