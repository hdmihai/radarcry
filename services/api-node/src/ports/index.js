/**
 * PORTS — the contract between the application core and the outside world.
 *
 * The core (domain + application) depends only on these shapes. Adapters in src/services implement
 * them; src/server.js (the composition root) wires the concrete adapters in. Swapping the Python
 * microservice for another analyst, or the file snapshot for an HTTP one, never touches the core.
 *
 * @typedef {object} SnapshotPort
 * @property {() => Promise<object>} load        the current data/latest.json (parsed)
 * @property {() => {source:string, loadedAt:number|null}} info
 *
 * @typedef {object} AnalystPort
 * @property {() => Promise<{ok:boolean, version?:string, capabilities?:string[]}>} health
 * @property {(payload:object) => Promise<object>} analyzeAsset     one asset: quant metrics + verdict
 * @property {(payloads:object[]) => Promise<object>} analyzeUniverse cross-sectional ranks, clusters
 * @property {(series:object) => Promise<object>} analyzeSeries     ad-hoc numeric series
 * @property {(chain:string, address:string) => Promise<object>} onchain  ERC-20 facts via Web3
 *
 * @typedef {object} CachePort
 * @property {(key:string) => any} get
 * @property {(key:string, value:any) => void} set
 *
 * @typedef {object} ClockPort
 * @property {() => number} now
 */

export const PORTS = Object.freeze({
  SnapshotPort: ['load', 'info'],
  AnalystPort: ['health', 'analyzeAsset', 'analyzeUniverse', 'analyzeSeries', 'onchain'],
  CachePort: ['get', 'set'],
  ClockPort: ['now'],
});

/** Fail fast at wiring time when an adapter does not implement its port. */
export function assertPort(name, impl) {
  const methods = PORTS[name];
  if (!methods) throw new Error(`port necunoscut: ${name}`);
  const missing = methods.filter((m) => typeof impl?.[m] !== 'function');
  if (missing.length) throw new Error(`${name}: adaptorul nu implementează ${missing.join(', ')}`);
  return impl;
}
