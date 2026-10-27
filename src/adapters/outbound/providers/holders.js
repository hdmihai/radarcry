/**
 * HOLDER adapters — the top-holder list, which is the single most valuable free data source for the
 * question this project answers, and the hardest to get without paying.
 *
 *  · NodeReal Free (EVM)   — `nr_getTokenHolders` on the Free plan: 10 000 000 compute units per
 *                            month at no cost. The call costs 300 CU, so the quota ledger charges
 *                            300 units per request and the gate pauses the provider at 95 %.
 *  · Solana JSON-RPC       — `getTokenLargestAccounts`, then `getTokenSupply` and `getMultipleAccounts`
 *                            to resolve each token account's owner. A pool of endpoints: the optional
 *                            free-account URL (SOLANA_RPC_URL) first, then public keyless nodes.
 *
 * Both return the same normalised shape so the domain's classifier does not care which chain the
 * list came from: { address, balance, share, isContract }.
 */
import { isNum, toNum } from '../../../domain/shared/math.js';
import { STATUS } from '../http/http-client.js';
import { disabled, mapResult, notConfigured, unsupported } from './common.js';

/* ───────────────────────────────────── NodeReal (EVM) ──────────────────────────────────────── */

/** Compute units per Enhanced API call on the Free plan. */
export const NODEREAL_CU = { tokenHolders: 300, tokenHolderCount: 300, call: 20 };

export const NODEREAL_HOSTS = {
  ethereum: 'eth-mainnet.nodereal.io',
  bsc: 'bsc-mainnet.nodereal.io',
  polygon: 'polygon-mainnet.nodereal.io',
  arbitrum: 'open-platform.nodereal.io/{key}/arbitrum-nitro',
  optimism: 'opt-mainnet.nodereal.io',
  base: 'base-mainnet.nodereal.io',
  avalanche: 'open-platform.nodereal.io/{key}/avalanche-c',
};

const hex = (n) => `0x${Math.max(1, Math.floor(n)).toString(16)}`;

/**
 * NodeReal returns `{ details: [{ tokenAddress, balance }], totalSupply, pageToken }` with balances
 * as hex strings in base units.
 */
export function normalizeNodeRealHolders(payload, { decimals = 18, totalSupply = null } = {}) {
  const details = payload?.details ?? payload?.result?.details ?? [];
  const supplyRaw = payload?.totalSupply ?? payload?.result?.totalSupply ?? null;
  const scale = 10 ** (isNum(decimals) ? decimals : 18);
  const toUnits = (v) => {
    if (typeof v === 'string' && v.startsWith('0x')) {
      const n = Number(BigInt(v));
      return Number.isFinite(n) ? n / scale : null;
    }
    const n = toNum(v);
    return n === null ? null : n / scale;
  };
  const supply = (() => {
    const s = toUnits(supplyRaw);
    if (isNum(s) && s > 0) return s;
    return isNum(totalSupply) && totalSupply > 0 ? totalSupply : null;
  })();

  const rows = [];
  for (const d of details) {
    const address = String(d.tokenAddress ?? d.address ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) continue;
    const balance = toUnits(d.balance);
    rows.push({
      address,
      balance,
      share: isNum(balance) && isNum(supply) && supply > 0 ? (balance / supply) * 100 : null,
      isContract: null,
    });
  }
  rows.sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
  if (!rows.length) throw new Error('lista de deținători este goală');
  return { holders: rows, totalSupply: supply, source: 'nodereal' };
}

export function createNodeReal({ http, cfg, apiKey = null }) {
  const endpointFor = (chain) => {
    const host = NODEREAL_HOSTS[chain];
    if (!host || !apiKey) return null;
    return host.includes('{key}')
      ? `https://${host.replace('{key}', apiKey)}`
      : `https://${host}/v1/${apiKey}`;
  };

  const opt = (endpoint, extra = {}) => ({
    provider: 'nodereal',
    endpoint,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    minIntervalMs: cfg.minIntervalMs,
    maxCalls: cfg.maxCalls,
    breakerThreshold: 3,
    ...extra,
  });

  /**
   * @param {string} chain
   * @param {string} address  token contract
   * @param {{decimals?:number, totalSupply?:number|null, top?:number}} o
   */
  const tokenHolders = async (chain, address, { decimals = 18, totalSupply = null, top = 100 } = {}) => {
    const endpoint = `nr_getTokenHolders ${chain}`;
    if (!cfg.enabled) return disabled('nodereal', endpoint);
    if (!apiKey) {
      return notConfigured('nodereal', endpoint,
        'lipsește NODEREAL_API_KEY — planul Free oferă 10 mil. unități de calcul/lună fără abonament și deblochează lista de deținători pe lanțurile EVM');
    }
    const url = endpointFor(chain);
    if (!url) return unsupported('nodereal', endpoint, `lanțul ${chain} nu este acoperit de acest furnizor`);
    const res = await http.postJson(
      url,
      { jsonrpc: '2.0', id: 1, method: 'nr_getTokenHolders', params: [address, hex(Math.min(top, 1000)), '0x0'] },
      opt(endpoint, { units: NODEREAL_CU.tokenHolders, retries: 1, validate: (d) => d && (d.result || d.error) }),
    );
    if (!res.ok) return res;
    if (res.data?.error) {
      return { ...res, ok: false, status: 'HTTP_ERROR', data: null, message: `NodeReal: ${res.data.error.message ?? 'eroare RPC'}` };
    }
    return mapResult(res, (d) => normalizeNodeRealHolders(d.result ?? d, { decimals, totalSupply }));
  };

  return { id: 'nodereal', tokenHolders, cuPerCall: NODEREAL_CU };
}


/* ───────────────────────────────────── Solana JSON-RPC pool ─────────────────────────────────── */

const SOLANA = 'solana_rpc';

/**
 * Public Solana mainnet nodes that answer without a key, in the order they are tried. Each is a full
 * node run by its operator as a free public service, so their answers are interchangeable; the pool
 * only has to find one that serves the method being asked.
 *
 * `getTokenLargestAccounts` is the hard one. It scans every token account of the mint, and it is the
 * first method free tiers restrict: the Solana Foundation endpoint answered it with HTTP 429 on every
 * call of every run of this project from GitHub's runners (while `getTokenSupply` passed), and
 * PublicNode is reported to refuse it outright. The pool therefore asks each node at most a couple of
 * times per run, remembers which nodes refuse which method, and reports plainly when none serves it.
 * A free-account endpoint (SOLANA_RPC_URL — Helius Free needs no card) is tried before all of them.
 */
export const SOLANA_PUBLIC_ENDPOINTS = Object.freeze([
  Object.freeze({ id: 'solana-foundation', url: 'https://api.mainnet-beta.solana.com', label: 'api.mainnet-beta.solana.com' }),
  Object.freeze({ id: 'publicnode', url: 'https://solana-rpc.publicnode.com', label: 'solana-rpc.publicnode.com' }),
  Object.freeze({ id: 'drpc', url: 'https://solana.drpc.org', label: 'solana.drpc.org' }),
  Object.freeze({ id: 'onfinality', url: 'https://solana.api.onfinality.io/public', label: 'solana.api.onfinality.io' }),
]);

/** Free-account RPC providers, recognised from the host of SOLANA_RPC_URL — for the label only. */
const ACCOUNT_FAMILIES = [
  ['helius-rpc.com', 'Helius'], ['helius.xyz', 'Helius'], ['alchemy.com', 'Alchemy'], ['quiknode.pro', 'QuickNode'],
  ['drpc.org', 'dRPC'], ['chainstack.com', 'Chainstack'], ['ankr.com', 'Ankr'], ['shyft.to', 'Shyft'],
  ['onfinality.io', 'OnFinality'], ['getblock.io', 'GetBlock'], ['blockpi.network', 'BlockPI'], ['rpcfast.com', 'RPC Fast'],
];

/**
 * The free-account endpoint from SOLANA_RPC_URL. The URL carries the key (in the path or the query),
 * so it is never printed: the label names only the provider family, and every message from this
 * endpoint passes through a redactor that masks each secret-looking part of the URL.
 *
 * @returns {null | {invalid:string} | {id:'account', url:string, label:string, keyed:true, redact:(m:string)=>string}}
 */
export function solanaAccountEndpoint(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  let u;
  try { u = new URL(text); } catch { return { invalid: 'SOLANA_RPC_URL nu este un URL valid' }; }
  if (u.protocol !== 'https:') return { invalid: 'SOLANA_RPC_URL trebuie să înceapă cu https://' };
  const host = u.hostname.toLowerCase();
  const family = ACCOUNT_FAMILIES.find(([d]) => host === d || host.endsWith(`.${d}`))?.[1] ?? 'furnizor propriu';
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const parts = [...u.pathname.split('/'), ...u.searchParams.values(), u.username, u.password];
  // Keys are long (a Helius key is a 36-character UUID); short parts such as `v2` or `solana` are not.
  const secrets = [...new Set([...parts, ...parts.map(decode)])].filter((s) => typeof s === 'string' && s.length >= 12)
    .sort((a, b) => b.length - a.length); // longest first: a secret containing another is masked whole
  const redact = (m) => secrets.reduce((acc, s) => acc.split(s).join('***'), String(m ?? ''));
  return { id: 'account', url: text, label: `${family} · cont gratuit`, keyed: true, redact };
}

/**
 * JSON-RPC answers come back as HTTP 200 with either `result` or `error`. The error code says whose
 * problem it is, and the pool needs to know: the node's (try the next one), the method's on this
 * node (remember, try the next one), or the input's (every node would say the same — stop).
 */
export function classifySolanaRpc(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { status: STATUS.INVALID_PAYLOAD, message: 'răspuns JSON-RPC neașteptat' };
  if (d.error) {
    const code = Number(d.error.code);
    const text = String(d.error.message ?? '').replace(/\s+/g, ' ').slice(0, 140);
    const message = `RPC ${Number.isFinite(code) ? code : '?'}: ${text}`;
    if (code === 429 || /rate.?limit|too many requests|request limit|limit exceeded|exceeded the limit|throttl/i.test(text)) return { status: STATUS.RATE_LIMITED, message };
    if (code === -32601 || code === -32010
      || /method (not found|not supported|not available|is not available|not allowed|is disabled|disabled)|not whitelisted|unsupported method|not supported on|secondary ind|not available (on|for) (the )?free/i.test(text)) {
      return { status: STATUS.UNSUPPORTED, message };
    }
    if (code === -32602) return { status: STATUS.INVALID_PAYLOAD, message }; // the input: not a mint, bad params
    return { status: STATUS.HTTP_ERROR, message }; // the node: unhealthy, behind, internal error
  }
  if (d.result === undefined) return { status: STATUS.INVALID_PAYLOAD, message: 'răspuns JSON-RPC fără „result”' };
  return null;
}

/** An error every node would repeat, because it is about the mint and not about the node. */
const INPUT_ERROR = /^RPC -32602\b/;

/** HTTP statuses that mean "this node will not serve this" rather than "try again later". */
const AUTH_REFUSAL = new Set([401, 403]);
const METHOD_REFUSAL = new Set([400, 404, 405, 410, 501]);

/**
 * `getTokenLargestAccounts` returns the 20 largest *token accounts*, not their owners. The owner is
 * what matters for concentration (one person can hold several token accounts), so the adapter
 * resolves owners with `getMultipleAccounts` and aggregates by owner.
 */
export function normalizeSolanaHolders({ largest, supply, owners }) {
  const decimals = toNum(supply?.value?.decimals) ?? 0;
  const total = toNum(supply?.value?.uiAmount) ?? (toNum(supply?.value?.amount) !== null ? toNum(supply.value.amount) / 10 ** decimals : null);
  const accounts = largest?.value ?? [];
  if (!accounts.length) throw new Error('nicio deținere raportată de RPC');

  const byOwner = new Map();
  accounts.forEach((a, i) => {
    const amount = toNum(a.uiAmount) ?? (toNum(a.amount) !== null ? toNum(a.amount) / 10 ** decimals : null);
    if (!isNum(amount) || amount <= 0) return;
    const info = owners?.[i] ?? null;
    const owner = info?.owner ?? a.address;
    const prev = byOwner.get(owner) ?? { address: owner, balance: 0, accounts: 0, isContract: info?.executable === true ? true : false, tokenAccounts: [] };
    prev.balance += amount;
    prev.accounts += 1;
    prev.tokenAccounts.push(a.address);
    byOwner.set(owner, prev);
  });

  const rows = [...byOwner.values()].map((r) => ({
    address: r.address,
    balance: r.balance,
    share: isNum(total) && total > 0 ? (r.balance / total) * 100 : null,
    isContract: r.isContract,
    tokenAccounts: r.tokenAccounts,
  })).sort((a, b) => b.balance - a.balance);

  return { holders: rows, totalSupply: total, source: 'solana_rpc', note: 'cele mai mari 20 de conturi de token, agregate pe proprietar' };
}

const SHORT = {
  [STATUS.RATE_LIMITED]: '429', [STATUS.UNSUPPORTED]: 'refuzat', [STATUS.TIMEOUT]: 'timeout', [STATUS.NETWORK_ERROR]: 'rețea',
  [STATUS.CIRCUIT_OPEN]: 'oprit', [STATUS.QUOTA_EXHAUSTED]: 'cotă epuizată', [STATUS.GEO_BLOCKED]: 'geo', [STATUS.INVALID_PAYLOAD]: 'răspuns invalid',
};

/**
 * @param {{http:any, cfg:any, accountUrl?:string|null, endpoints?:ReadonlyArray<{id:string,url:string,label:string}>}} deps
 */
export function createSolanaRpc({ http, cfg, accountUrl = null, endpoints = SOLANA_PUBLIC_ENDPOINTS }) {
  const account = solanaAccountEndpoint(accountUrl);
  const hasAccount = Boolean(account && !account.invalid);
  const pool = [...(hasAccount ? [account] : []), ...endpoints];
  const dead = new Set(); // nodes unusable for the rest of the run: auth, geo, spent quota, not JSON-RPC
  /** @type {Map<string, Set<string>>} node id → methods it does not serve */
  const refused = new Map();
  /** @type {Map<string, string>} method → public node that served it last */
  const affinity = new Map();
  const failoverWaitMs = cfg.failoverWaitMs ?? 3_000;

  const laneOf = (ep, method) => `${ep.id}/${method}`;
  const opt = (ep, method, extra = {}) => ({
    provider: SOLANA,
    endpoint: `${method} · ${ep.label}`,
    lane: laneOf(ep, method),
    timeoutMs: cfg.timeoutMs,
    // A public node that is busy is not waited for — the next one is the retry. An account endpoint
    // is worth one more try: its limit is per key (10 requests/second on Helius Free), not shared.
    retries: ep.keyed ? (cfg.retries ?? 1) : 0,
    minIntervalMs: ep.keyed ? (cfg.accountMinIntervalMs ?? 150) : cfg.minIntervalMs,
    maxCalls: cfg.maxCalls,
    breakerThreshold: 3,
    rateLimitCooldownMs: cfg.rateLimitCooldownMs ?? 10_000,
    rateLimitStrikes: cfg.rateLimitStrikes ?? 2,
    maxSlowMs: cfg.maxSlowMs ?? 8_000,
    classify: classifySolanaRpc,
    redact: ep.redact,
    ...extra,
  });

  const order = (method) => {
    const first = affinity.get(method);
    const rank = (ep) => (ep.keyed ? 0 : ep.id === first ? 1 : 2);
    return pool
      .map((ep, i) => ({ ep, i }))
      .filter(({ ep }) => !dead.has(ep.id) && !refused.get(ep.id)?.has(method))
      .sort((a, b) => rank(a.ep) - rank(b.ep) || a.i - b.i)
      .map(({ ep }) => ep);
  };

  const refuse = (id, method) => {
    if (!refused.has(id)) refused.set(id, new Set());
    refused.get(id).add(method);
  };

  /** Why the pool could not serve a method, as one status and one readable line. */
  const poolFailure = (method, attempts) => {
    const has = (s) => attempts.some((a) => a.status === s);
    // No attempt at all means every node had already refused this method (or us) earlier in the run.
    const refusedAll = attempts.every((a) => a.refusal);
    const status = has(STATUS.RATE_LIMITED) ? STATUS.RATE_LIMITED
      : has(STATUS.QUOTA_EXHAUSTED) ? STATUS.QUOTA_EXHAUSTED
        : attempts.find((a) => [STATUS.TIMEOUT, STATUS.NETWORK_ERROR, STATUS.HTTP_ERROR, STATUS.INVALID_PAYLOAD].includes(a.status) && !a.refusal)?.status
          ?? (has(STATUS.CIRCUIT_OPEN) ? STATUS.CIRCUIT_OPEN : refusedAll && !hasAccount ? STATUS.NOT_CONFIGURED : STATUS.HTTP_ERROR);
    const tried = attempts.length
      ? attempts.map((a) => `${a.ep.label} ${a.note ?? SHORT[a.status] ?? (a.httpStatus ? `HTTP ${a.httpStatus}` : a.status)}`).join(' · ')
      : 'toate nodurile au refuzat metoda mai devreme în această rulare';
    const advice = hasAccount
      ? ''
      : ' — fără cheie, lista de deținători Solana depinde de noduri publice care limitează această metodă; SOLANA_RPC_URL (cont gratuit, ex. Helius Free) o deblochează';
    const invalid = account?.invalid ? ` (${account.invalid})` : '';
    return {
      ok: false,
      status,
      data: null,
      message: `${method}: ${tried}${advice}${invalid}`.slice(0, 400),
      meta: { provider: SOLANA, endpoint: method, fetchedAt: new Date().toISOString(), latencyMs: 0, httpStatus: null, attempts: attempts.length },
    };
  };

  /** One JSON-RPC method, answered by the first node of the pool that serves it. */
  const call = async (method, params) => {
    const attempts = [];
    for (const ep of order(method)) {
      const lane = http.laneStatus?.(SOLANA, laneOf(ep, method));
      if (lane?.open) { attempts.push({ ep, status: STATUS.CIRCUIT_OPEN }); continue; }
      if (lane && lane.waitMs > failoverWaitMs) {
        attempts.push({ ep, status: STATUS.RATE_LIMITED, note: `în pauză ${Math.ceil(lane.waitMs / 1000)} s` });
        continue;
      }
      const r = await http.postJson(ep.url, { jsonrpc: '2.0', id: 1, method, params }, opt(ep, method));
      if (r.ok) {
        if (!ep.keyed) affinity.set(method, ep.id);
        return r;
      }
      if (INPUT_ERROR.test(r.message ?? '')) return r; // the mint, not the node
      if (r.status === STATUS.BUDGET_EXHAUSTED || r.status === STATUS.SKIPPED) return r; // the run's limits
      const http_ = r.meta?.httpStatus ?? null;
      let refusal = false;
      if (r.status === STATUS.GEO_BLOCKED || r.status === STATUS.QUOTA_EXHAUSTED || (r.status === STATUS.HTTP_ERROR && AUTH_REFUSAL.has(http_))) {
        dead.add(ep.id);
        refusal = r.status !== STATUS.QUOTA_EXHAUSTED;
      } else if (r.status === STATUS.UNSUPPORTED || (r.status === STATUS.HTTP_ERROR && METHOD_REFUSAL.has(http_))) {
        refuse(ep.id, method);
        refusal = true;
      } else if (r.status === STATUS.INVALID_PAYLOAD) {
        // Not JSON-RPC at all (a challenge page, an empty body): the node is unusable from here. A
        // broken *normalisation* is different — it comes after a good answer and is returned as is.
        dead.add(ep.id);
        refusal = true;
      }
      attempts.push({ ep, status: r.status, httpStatus: http_, refusal });
    }
    return poolFailure(method, attempts);
  };

  const tokenHolders = async (mint) => {
    if (!cfg.enabled) return disabled(SOLANA, 'getTokenLargestAccounts');
    const largest = await call('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
    if (!largest.ok) return largest;
    const addresses = (largest.data.result?.value ?? []).map((a) => a.address).filter(Boolean);
    // Supply (for shares) and owners (to merge one wallet's token accounts) only once the list exists.
    const [supply, accounts] = await Promise.all([
      call('getTokenSupply', [mint, { commitment: 'confirmed' }]),
      addresses.length ? call('getMultipleAccounts', [addresses, { encoding: 'jsonParsed', commitment: 'confirmed' }]) : Promise.resolve(null),
    ]);
    const owners = accounts?.ok
      ? (accounts.data.result?.value ?? []).map((acc) => ({ owner: acc?.data?.parsed?.info?.owner ?? null, executable: acc?.executable === true }))
      : [];
    return mapResult(largest, (d) => normalizeSolanaHolders({ largest: d.result, supply: supply.ok ? supply.data.result : null, owners }));
  };

  /**
   * One call per node and method, outside the pool's memory — for the probe, which has to say which
   * node serves what from the machine it runs on.
   */
  const diagnose = async (mint, { methods = ['getTokenSupply', 'getTokenLargestAccounts'], retries = 0 } = {}) => {
    const rows = [];
    if (account?.invalid) rows.push({ id: 'account', label: 'SOLANA_RPC_URL', keyed: true, invalid: account.invalid, methods: {} });
    for (const ep of pool) {
      const row = { id: ep.id, label: ep.label, keyed: Boolean(ep.keyed), methods: {} };
      for (const method of methods) {
        const r = await http.postJson(ep.url, { jsonrpc: '2.0', id: 1, method, params: [mint, { commitment: 'confirmed' }] },
          opt(ep, method, { lane: `diagnose:${laneOf(ep, method)}`, retries, maxCalls: undefined }));
        const value = r.ok ? r.data?.result?.value : null;
        row.methods[method] = {
          status: r.status,
          httpStatus: r.meta?.httpStatus ?? null,
          latencyMs: r.meta?.latencyMs ?? null,
          records: Array.isArray(value) ? value.length : value ? 1 : null,
          message: r.ok ? '' : r.message,
        };
      }
      rows.push(row);
    }
    return rows;
  };

  const describe = () => ({
    account: account ? (account.invalid ? { invalid: account.invalid } : { label: account.label }) : null,
    endpoints: pool.map((ep) => ({ id: ep.id, label: ep.label, keyed: Boolean(ep.keyed) })),
  });

  return { id: SOLANA, tokenHolders, diagnose, describe };
}
