/** Minimal static file server (inbound adapter) for local previews of the built dashboard. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff' };

export function startStaticServer({ dir, port = 8080, host = '127.0.0.1' }) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      let path = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!path.startsWith(root + sep) && path !== root) { res.writeHead(403).end('forbidden'); return; }
      const st = await stat(path).catch(() => null);
      if (st?.isDirectory()) path = join(path, 'index.html');
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, host, () => ok(server)));
}
