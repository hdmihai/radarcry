/** Infrastructure adapters: clock, structured logger, telemetry collector. */

export const systemClock = { now: () => Date.now() };

export function fixedClock(ms) {
  return { now: () => ms };
}

export function createLogger({ verbose = false, sink = console } = {}) {
  const line = (level, msg) => `${new Date().toISOString()} ${level.padEnd(5)} ${msg}`;
  return {
    info: (m) => sink.log(line('INFO', m)),
    warn: (m) => sink.warn(line('WARN', m)),
    error: (m) => sink.error(line('ERROR', m)),
    debug: (m) => { if (verbose) sink.log(line('DEBUG', m)); },
  };
}

export const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** Collects every provider call of the run; summarised into the snapshot's health section. */
export function createTelemetry() {
  const events = [];
  return {
    record: (e) => events.push(e),
    events: () => [...events],
    summary() {
      const byProvider = {};
      for (const e of events) {
        const p = (byProvider[e.provider] ??= { provider: e.provider, calls: 0, ok: 0, failures: 0, latencyMs: 0, statuses: {}, lastMessage: null, bytes: 0 });
        p.calls += 1;
        p.latencyMs += e.latencyMs ?? 0;
        p.bytes += e.bytes ?? 0;
        p.statuses[e.status] = (p.statuses[e.status] ?? 0) + 1;
        if (e.status === 'OK') p.ok += 1; else { p.failures += 1; p.lastMessage = `${e.endpoint}: ${e.status} ${e.message ?? ''}`.trim(); }
      }
      for (const p of Object.values(byProvider)) p.avgLatencyMs = p.calls ? Math.round(p.latencyMs / p.calls) : null;
      return byProvider;
    },
  };
}
