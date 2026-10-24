/**
 * HOLDER adapters — the top-holder list, which is the single most valuable free data source for the
 * question this project answers, and the hardest to get without paying.
 *
 *  · NodeReal Free (EVM)   — `nr_getTokenHolders` on the Free plan: 10 000 000 compute units per
 *                            month at no cost. The call costs 300 CU, so the quota ledger charges
 *                            300 units per request and the gate pauses the provider at 95 %.
 *  · Solana public RPC     — `getTokenLargestAccounts` + `getTokenSupply`, then `getMultipleAccounts`
 *                            to resolve each token account's owner. Keyless.
 *
 * Both return the same normalised shape so the domain's classifier does not care which chain the
 * list came from: { address, balance, share, isContract }.
 */
import { isNum, toNum } from '../../../domain/shared/math.js';
import { disabled, mapResult, notConfigured } from './common.js';

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
    if (!url) return notConfigured('nodereal', endpoint, `lanțul ${chain} nu este acoperit de acest furnizor`);
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

/* ───────────────────────────────────── Solana public RPC ───────────────────────────────────── */

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

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

export function createSolanaRpc({ http, cfg, url = SOLANA_RPC }) {
  const opt = (endpoint, extra = {}) => ({
    provider: 'solana_rpc',
    endpoint,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    minIntervalMs: cfg.minIntervalMs,
    maxCalls: cfg.maxCalls,
    breakerThreshold: 3,
    ...extra,
  });

  const rpc = (method, params, endpoint) => http.postJson(url, { jsonrpc: '2.0', id: 1, method, params }, opt(endpoint, { retries: 1, validate: (d) => d && (d.result !== undefined || d.error) }));

  const tokenHolders = async (mint) => {
    if (!cfg.enabled) return disabled('solana_rpc', 'getTokenLargestAccounts');
    const [largest, supply] = await Promise.all([
      rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }], 'getTokenLargestAccounts'),
      rpc('getTokenSupply', [mint, { commitment: 'confirmed' }], 'getTokenSupply'),
    ]);
    if (!largest.ok) return largest;
    if (largest.data?.error) return { ...largest, ok: false, status: 'HTTP_ERROR', data: null, message: `Solana RPC: ${largest.data.error.message}` };

    const addresses = (largest.data.result?.value ?? []).map((a) => a.address).filter(Boolean);
    /** @type {any[]} */
    let owners = [];
    if (addresses.length) {
      const res = await rpc('getMultipleAccounts', [addresses, { encoding: 'jsonParsed', commitment: 'confirmed' }], 'getMultipleAccounts');
      if (res.ok && !res.data?.error) {
        owners = (res.data.result?.value ?? []).map((acc) => ({
          owner: acc?.data?.parsed?.info?.owner ?? null,
          executable: acc?.executable === true,
        }));
      }
    }
    return mapResult(largest, (d) => normalizeSolanaHolders({
      largest: d.result,
      supply: supply.ok && !supply.data?.error ? supply.data.result : null,
      owners,
    }));
  };

  return { id: 'solana_rpc', tokenHolders };
}
