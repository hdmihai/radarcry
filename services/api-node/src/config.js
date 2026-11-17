/**
 * Configuration from the environment (the only place process.env is read).
 *
 *   PORT                    3000
 *   HOST                    0.0.0.0
 *   SNAPSHOT_SOURCE         path or URL of latest.json (default: <repo>/data/latest.json if it
 *                           exists, else the GitHub Pages copy)
 *   SNAPSHOT_TTL_MS         300000 (HTTP source only)
 *   ANALYST_MODE            http | spawn
 *   ANALYST_URL             http://127.0.0.1:8000
 *   ANALYST_TIMEOUT_MS      15000
 *   ANALYST_RETRIES         2
 *   PYTHON_BIN              python3 (spawn mode)
 *   CORS_ORIGINS            comma list; default GitHub Pages + local previews
 *   SERVE_FRONTEND          1 = also serve ../../frontend and /data (local preview)
 *   RATE_LIMIT_PER_MINUTE   120
 *   TRUST_PROXY             0/1 (behind a reverse proxy)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SERVICE_ROOT = resolve(HERE, '..');
export const REPO_ROOT = resolve(SERVICE_ROOT, '..', '..');
export const PAGES_SNAPSHOT = 'https://hdmihai.github.io/radarcry/data/latest.json';

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v) => v === '1' || v === 'true';

export function loadConfig(env = process.env) {
  const localSnapshot = join(REPO_ROOT, 'data', 'latest.json');
  const version = JSON.parse(readFileSync(join(SERVICE_ROOT, 'package.json'), 'utf8')).version;
  const serveFrontend = bool(env.SERVE_FRONTEND);
  return {
    version,
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    snapshotSource: env.SNAPSHOT_SOURCE ?? (existsSync(localSnapshot) ? localSnapshot : PAGES_SNAPSHOT),
    snapshotTtlMs: int(env.SNAPSHOT_TTL_MS, 5 * 60_000),
    analyst: {
      mode: env.ANALYST_MODE ?? 'http',
      baseUrl: env.ANALYST_URL ?? 'http://127.0.0.1:8000',
      timeoutMs: int(env.ANALYST_TIMEOUT_MS, 15_000),
      retries: int(env.ANALYST_RETRIES, 2),
      python: env.PYTHON_BIN ?? 'python3',
      cliPath: join(REPO_ROOT, 'services', 'analyst-python', 'cli.py'),
      cwd: join(REPO_ROOT, 'services', 'analyst-python'),
    },
    corsOrigins: (env.CORS_ORIGINS ?? 'https://hdmihai.github.io,http://localhost:8080,http://127.0.0.1:8080,http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 120),
    trustProxy: bool(env.TRUST_PROXY),
    frontendDir: serveFrontend ? join(REPO_ROOT, 'frontend') : null,
    dataDir: serveFrontend ? join(REPO_ROOT, 'data') : null,
  };
}
