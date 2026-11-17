/**
 * Presentation formatting. Crypto conventions (dot decimals, $, K/M/B) because the audience reads
 * exchanges and TradingView daily; dates use Romanian month names in the viewer's time zone.
 */
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
export const DASH = '—';

export function usd(x, { dec } = {}) {
  if (!isNum(x)) return DASH;
  const a = Math.abs(x);
  const s = x < 0 ? '−' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(dec ?? 2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(dec ?? 2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(dec ?? (a >= 1e8 ? 0 : 1))}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(dec ?? 1)}K`;
  return `${s}$${a.toFixed(dec ?? 0)}`;
}

export function price(x) {
  if (!isNum(x)) return DASH;
  const a = Math.abs(x);
  if (a >= 1000) return x.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 100) return x.toFixed(2);
  if (a >= 1) return x.toFixed(4);
  if (a === 0) return '0';
  return Number.parseFloat(x.toPrecision(4)).toString().replace(/e-(\d+)/, (_, n) => `e−${n}`);
}

export function pct(x, { dec = 1, sign = true } = {}) {
  if (!isNum(x)) return DASH;
  const v = Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(dec);
  const neg = x < 0;
  const body = neg ? v.replace('-', '') : v;
  return `${neg ? '−' : sign && x > 0 ? '+' : ''}${body}%`;
}

/** Ratio stored as fraction → percent text (turnover 0.62 → 62%). */
export function frac(x, dec = 1) {
  if (!isNum(x)) return DASH;
  return `${(x * 100).toFixed(x * 100 >= 100 ? 0 : dec)}%`;
}

export function num(x, dec = 0) {
  if (!isNum(x)) return DASH;
  return x.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function compact(x) {
  if (!isNum(x)) return DASH;
  const a = Math.abs(x);
  if (a >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return String(Math.round(x));
}

/** Funding rate per interval (fraction) → percent with 4 decimals, like exchanges show it. */
export function funding(x) {
  if (!isNum(x)) return DASH;
  const v = (x * 100).toFixed(4);
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${v.replace('-', '')}%`;
}

export function score(x) {
  return isNum(x) ? x.toFixed(x >= 99.95 ? 0 : 1) : DASH;
}

export function int(x) {
  return isNum(x) ? Math.round(x).toLocaleString('en-US') : DASH;
}

export function signClass(x) {
  return isNum(x) ? (x > 0 ? 'pos' : x < 0 ? 'neg' : '') : 'muted';
}

const dtf = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
const dShort = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short' });

const toDate = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e11 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function dateTime(v) {
  const d = toDate(v);
  return d ? dtf.format(d) : DASH;
}

export function date(v) {
  const d = toDate(v);
  return d ? df.format(d) : DASH;
}

export function dayMonth(v) {
  const d = toDate(v);
  return d ? dShort.format(d) : DASH;
}

export function ago(v, nowMs = Date.now()) {
  const d = toDate(v);
  if (!d) return DASH;
  const s = Math.round((nowMs - d.getTime()) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 86400) return `peste ${Math.max(1, Math.round(f / 3600))} h`;
    return `peste ${Math.round(f / 86400)} z`;
  }
  if (s < 90) return 'acum';
  if (s < 3600) return `acum ${Math.round(s / 60)} min`;
  if (s < 86400 * 1.5) return `acum ${Math.round(s / 3600)} h`;
  return `acum ${Math.round(s / 86400)} z`;
}

export function days(x) {
  if (!isNum(x)) return DASH;
  if (x >= 730) return `${(x / 365).toFixed(1)} ani`;
  return `${Math.round(x)} z`;
}

export function duration(ms) {
  if (!isNum(ms)) return DASH;
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 90 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function shortAddr(a) {
  if (!a) return DASH;
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
