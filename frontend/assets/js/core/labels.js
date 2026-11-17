/**
 * Labels and icons. Domain labels (stages, signals, risks, hype, catalysts, research states) come
 * from the snapshot's methodology block so the backend stays the single source of truth; the maps
 * below only hold presentation vocabulary that has no meaning in the engine.
 */
import { raw } from './dom.js';

export const L = {
  stages: {},
  stageOrder: ['DECLINE', 'BASE', 'BUILDING', 'ACCELERATION', 'PRE_EXPANSION', 'EXPANSION', 'POST_EXPANSION'],
  signals: {},
  risks: {},
  hype: {},
  catalysts: {},
  states: {},
};

export function initLabels(methodology) {
  const m = methodology?.labels ?? {};
  Object.assign(L.stages, m.stages);
  Object.assign(L.signals, m.signals);
  Object.assign(L.risks, m.risks);
  Object.assign(L.hype, m.hype);
  Object.assign(L.catalysts, m.catalysts);
  Object.assign(L.states, m.states);
  if (Array.isArray(methodology?.stageOrder)) L.stageOrder = methodology.stageOrder;
}

export const SIGNAL_ORDER = ['BUY_SETUP', 'ACCUMULATE', 'WATCH', 'LATE', 'AVOID', 'NONE'];
export const SIGNAL_RANK = Object.fromEntries(SIGNAL_ORDER.map((s, i) => [s, SIGNAL_ORDER.length - i]));

export const SIGNAL_HELP = {
  BUY_SETUP: 'Structură în pre-expansiune, ADN apropiat de un analog, risc acceptabil și încă discret.',
  ACCUMULATE: 'Bază/construcție cu ADN similar: zonă de acumulare graduală, fără grabă.',
  WATCH: 'Merită urmărit: scor sau similaritate peste prag, dar fără confirmare structurală.',
  LATE: 'Mișcarea a pornit deja sau hype-ul e activ: nu urmări prețul.',
  AVOID: 'Risc critic sau structură în declin.',
  NONE: 'Sub pragurile de cercetare.',
};

export const PROVIDER_STATUS = {
  OK: { label: 'OK', tone: 'good' },
  PARTIAL: { label: 'Parțial', tone: 'warning' },
  NOT_CONFIGURED: { label: 'Neconfigurat (opțional)', tone: 'muted' },
  SKIPPED: { label: 'Nefolosit', tone: 'muted' },
  RATE_LIMITED: { label: 'Limită de rată', tone: 'warning' },
  TIMEOUT: { label: 'Timeout', tone: 'warning' },
  BUDGET_EXHAUSTED: { label: 'Buget de apeluri atins', tone: 'warning' },
  QUOTA_EXHAUSTED: { label: 'Cuotă gratuită în pauză', tone: 'warning' },
  CIRCUIT_OPEN: { label: 'Circuit deschis', tone: 'warning' },
  HTTP_ERROR: { label: 'Eroare HTTP', tone: 'serious' },
  NETWORK_ERROR: { label: 'Eroare de rețea', tone: 'serious' },
  INVALID_PAYLOAD: { label: 'Răspuns invalid', tone: 'serious' },
  GEO_BLOCKED: { label: 'Blocat geografic', tone: 'serious' },
};

export const HEALTH = {
  HEALTHY: { label: 'Date sănătoase', tone: 'good' },
  DEGRADED: { label: 'Date degradate', tone: 'warning' },
  CRITICAL: { label: 'Date critice', tone: 'critical' },
};

export const REGIME = {
  RISK_ON: { label: 'Risk-on', tone: 'good' },
  NEUTRAL: { label: 'Neutru', tone: 'muted' },
  RISK_OFF: { label: 'Risk-off', tone: 'serious' },
};

export const POLARITY = {
  POSITIVE: { label: 'Pozitiv', tone: 'good', icon: 'up' },
  NEGATIVE: { label: 'Negativ', tone: 'critical', icon: 'down' },
  NEUTRAL: { label: 'Neutru', tone: 'muted', icon: 'dot' },
  UNKNOWN: { label: 'Necunoscut', tone: 'muted', icon: 'dot' },
};

export const SEVERITY = {
  CRITICAL: { label: 'Critic', tone: 'critical' },
  HIGH: { label: 'Ridicat', tone: 'serious' },
  MEDIUM: { label: 'Mediu', tone: 'warning' },
  LOW: { label: 'Scăzut', tone: 'muted' },
};

export const RELIABILITY = { LOW: 'scăzută', MEDIUM: 'medie', HIGH: 'ridicată', VERY_HIGH: 'foarte ridicată' };

export const GRADE_HELP = {
  A: 'Risc A: mărime standard',
  B: 'Risc B: mărime redusă',
  C: 'Risc C: poziție mică, doar cu confirmare',
  D: 'Risc D: doar observare',
};

export const SOURCE = {
  history: 'istoricul radarului',
  mexc: 'MEXC',
  mexc_futures: 'MEXC Futures',
  gate: 'Gate',
  bitget: 'Bitget',
  okx: 'OKX',
  upbit: 'Upbit',
  bithumb: 'Bithumb',
  binance_alpha: 'Binance Alpha',
  gate_alpha: 'Gate Alpha',
  coingecko: 'CoinGecko',
  'coingecko+coinmarketcap': 'CoinGecko + CoinMarketCap',
  manual: 'config/catalysts.json',
};
export const sourceLabel = (s) => SOURCE[s] ?? s ?? '—';

export const DIRECTION = { ADVANCE: 'avansează', RETREAT: 'regresează', NEW: 'nou', SAME: 'neschimbat' };

const ICONS = {
  target: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  layers: '<path d="M2.5 10.5 8 13l5.5-2.5M2.5 7.5 8 10l5.5-2.5M8 3 2.5 5 8 7l5.5-2L8 3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  clock: '<circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.8V8l2.2 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  ban: '<circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m4 12 8-8" stroke="currentColor" stroke-width="1.6"/>',
  dash: '<path d="M4.5 8h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  check: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m5.3 8.2 1.9 1.9 3.6-3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  warn: '<path d="M8 2.2 14.2 13H1.8L8 2.2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.4v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.2" r=".9" fill="currentColor"/>',
  stop: '<path d="M5.5 1.8h5l3.7 3.7v5l-3.7 3.7h-5l-3.7-3.7v-5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 5v3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="10.9" r=".9" fill="currentColor"/>',
  minus: '<circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8h5.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  info: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="5" r=".9" fill="currentColor"/>',
  up: '<path d="M8 13V3.5M4 7.5 8 3.5l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M8 3v9.5M4 8.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  dot: '<circle cx="8" cy="8" r="2.5" fill="currentColor"/>',
  search: '<circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m10.5 10.5 3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  sun: '<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  moon: '<path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  external: '<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5H7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  bolt: '<path d="M9 1.8 3.5 9h4l-1 5.2L12.5 7h-4l.5-5.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
};

export function icon(name, size = 14, label = '') {
  const body = ICONS[name] ?? ICONS.dot;
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 16 16" ${a11y} focusable="false">${body}</svg>`);
}

export const SIGNAL_ICON = { BUY_SETUP: 'target', ACCUMULATE: 'layers', WATCH: 'eye', LATE: 'clock', AVOID: 'ban', NONE: 'dash' };
export const TONE_ICON = { good: 'check', warning: 'warn', serious: 'warn', critical: 'stop', muted: 'minus' };
