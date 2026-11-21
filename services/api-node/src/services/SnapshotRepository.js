/**
 * Outbound adapters implementing SnapshotPort.
 *
 *   FileSnapshotRepository  reads data/latest.json from disk, reloads only when mtime changes
 *                           (the scanner rewrites the file in place after each run).
 *   HttpSnapshotRepository  reads the snapshot published on GitHub Pages
 *                           (https://hdmihai.github.io/radarcry/data/latest.json), with a TTL —
 *                           so the API can run anywhere without a local scan.
 */
import { readFile, stat } from 'node:fs/promises';

export function validateRunners(doc, where) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.candidates)) {
    throw new Error(`${where}: contract neașteptat (lipsește candidates în runners.json)`);
  }
  return doc;
}

function validate(doc, where) {
  if (!doc || typeof doc !== 'object' || !doc.meta || !Array.isArray(doc.candidates)) {
    throw new Error(`${where}: contract neașteptat (lipsesc meta/candidates)`);
  }
  return doc;
}

export class FileSnapshotRepository {
  constructor({ path, now = Date.now, validator = validate }) {
    this.path = path;
    this.validator = validator;
    this.now = now;
    this.cached = null;
    this.mtimeMs = 0;
    this.loadedAt = null;
  }

  async load() {
    const st = await stat(this.path);
    if (this.cached && st.mtimeMs === this.mtimeMs) return this.cached;
    const doc = this.validator(JSON.parse(await readFile(this.path, 'utf8')), this.path);
    this.cached = doc;
    this.mtimeMs = st.mtimeMs;
    this.loadedAt = this.now();
    return doc;
  }

  info() {
    return { source: `file:${this.path}`, loadedAt: this.loadedAt };
  }
}

export class HttpSnapshotRepository {
  constructor({ url, ttlMs = 5 * 60_000, timeoutMs = 20_000, fetchImpl = globalThis.fetch, now = Date.now, validator = validate }) {
    this.url = url;
    this.validator = validator;
    this.ttlMs = ttlMs;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.now = now;
    this.cached = null;
    this.loadedAt = null;
    this.inflight = null;
  }

  async load() {
    if (this.cached && this.now() - this.loadedAt < this.ttlMs) return this.cached;
    this.inflight ??= (async () => {
      try {
        const res = await this.fetch(this.url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
        if (!res.ok) throw new Error(`${this.url}: HTTP ${res.status}`);
        const doc = this.validator(await res.json(), this.url);
        this.cached = doc;
        this.loadedAt = this.now();
        return doc;
      } catch (err) {
        // Serve the last good snapshot rather than nothing: stale research is labelled by its runId.
        if (this.cached) return this.cached;
        throw err;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  info() {
    return { source: this.url, loadedAt: this.loadedAt };
  }
}

export function createSnapshotRepository({ source, ttlMs, validator }) {
  if (/^https?:\/\//i.test(source)) return new HttpSnapshotRepository({ url: source, ttlMs, validator });
  return new FileSnapshotRepository({ path: source, validator });
}

/** data/runners.json lângă latest.json (același director local sau aceeași origine Pages). */
export function createRunnersRepository({ snapshotSource, ttlMs }) {
  const source = String(snapshotSource).replace(/latest\.json(\?.*)?$/, 'runners.json');
  return createSnapshotRepository({ source, ttlMs, validator: validateRunners });
}

export function validateStepMomentum(doc, where) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.stepMomentum) || doc.method !== 'rules') {
    throw new Error(`${where}: contract neașteptat (step-momentum.json trebuie să fie method=rules și să aibă stepMomentum)`);
  }
  return doc;
}

/** data/step-momentum.json lângă latest.json (același director local sau aceeași origine Pages). */
export function createStepMomentumRepository({ snapshotSource, ttlMs }) {
  const source = String(snapshotSource).replace(/latest\.json(\?.*)?$/, 'step-momentum.json');
  return createSnapshotRepository({ source, ttlMs, validator: validateStepMomentum });
}
