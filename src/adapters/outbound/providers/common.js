/** Shared helpers for provider adapters. */
import { STATUS } from '../http/http-client.js';

/** Transform the data of a successful ProviderResult, keeping status and provenance. */
export function mapResult(res, fn) {
  if (!res.ok) return res;
  try {
    const data = fn(res.data);
    const records = Array.isArray(data) ? data.length : data instanceof Map ? data.size : data && typeof data === 'object' ? Object.keys(data).length : null;
    return { ...res, data, meta: { ...res.meta, records } };
  } catch (err) {
    return { ...res, ok: false, status: STATUS.INVALID_PAYLOAD, data: null, message: `normalizare eșuată: ${String(err.message).slice(0, 140)}` };
  }
}

export function notConfigured(provider, endpoint, message) {
  return { ok: false, status: STATUS.NOT_CONFIGURED, data: null, message, meta: { provider, endpoint, fetchedAt: new Date().toISOString(), latencyMs: 0, httpStatus: null } };
}

/**
 * The provider is configured and reachable, but cannot answer *this input* — a chain it does not
 * cover, an empty address list. That is a different fact from NOT_CONFIGURED (no key), and the
 * difference is load-bearing: use cases stop calling a provider for the rest of the run when it
 * reports NOT_CONFIGURED, so reporting an unsupported chain that way would let one SUI token switch
 * off holder or security coverage for every BSC token that follows it.
 */
export function unsupported(provider, endpoint, message) {
  return { ok: false, status: STATUS.SKIPPED, data: null, message, meta: { provider, endpoint, fetchedAt: new Date().toISOString(), latencyMs: 0, httpStatus: null } };
}

export function disabled(provider, endpoint) {
  return { ok: false, status: STATUS.SKIPPED, data: null, message: 'dezactivat din configurație', meta: { provider, endpoint, fetchedAt: new Date().toISOString(), latencyMs: 0, httpStatus: null } };
}

/** Merge several page results into one (partial success keeps what arrived, status explains). */
export function mergePages(provider, endpoint, pages) {
  const okPages = pages.filter((p) => p.ok);
  if (!okPages.length) return pages[0] ?? notConfigured(provider, endpoint, 'nicio pagină');
  const data = okPages.flatMap((p) => p.data);
  const partial = okPages.length < pages.length;
  return {
    ok: true,
    status: STATUS.OK,
    data,
    message: partial ? `parțial: ${okPages.length}/${pages.length} pagini (${pages.find((p) => !p.ok)?.status})` : '',
    meta: {
      ...okPages[0].meta,
      endpoint,
      latencyMs: pages.reduce((s, p) => s + (p.meta?.latencyMs ?? 0), 0),
      records: data.length,
      partial,
      sha256: okPages.map((p) => p.meta?.sha256).filter(Boolean).join('').slice(0, 64) || undefined,
    },
  };
}

export const flag01 = (v) => (v === '1' || v === 1 || v === true ? true : v === '0' || v === 0 || v === false ? false : null);
