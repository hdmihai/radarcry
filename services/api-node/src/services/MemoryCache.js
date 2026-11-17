/** CachePort: a small in-memory LRU with TTL. Enough for one API instance; swap for Redis behind the same port. */
export class MemoryCache {
  constructor({ max = 500, ttlMs = 10 * 60_000, now = Date.now } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.now = now;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() > hit.exp) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, exp: this.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  get size() {
    return this.map.size;
  }
}
