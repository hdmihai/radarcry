/**
 * Builds the public contract (data/latest.json) — the ONLY interface between the research
 * engine and the dashboard. The dashboard never computes research; it renders this document.
 */
import { round, sig } from '../../domain/shared/math.js';
import { FEATURES } from '../../domain/similarity/vector.js';
import { DOMAIN_LABELS } from '../../domain/scoring/domains.js';
import { STAGES, STAGE_LABELS } from '../../domain/lifecycle/stage.js';
import { HYPE_LABELS } from '../../domain/lifecycle/hype.js';
import { CATALYST_TYPES } from '../../domain/catalysts/catalysts.js';
import { SIGNAL_LABELS } from '../../domain/signals/signal.js';
import { RISK_LABELS } from '../../domain/scoring/risk.js';
import { STAGE_LABEL_RO, STAGE_MEANING_RO, EARLY_CANDIDATE } from '../../domain/discovery/classify.js';
import { BANDS, PRE_EXPANSION_WEIGHTS } from '../../domain/discovery/pre-expansion.js';
import { FUTURES_WEIGHTS, GRADE_CUTS, RR_MIN } from '../../domain/futures/grade.js';
import { FUNDING, FUNDING_LABEL_RO, OI_LABEL_RO } from '../../domain/futures/positioning.js';
import { TREND_LABEL_RO } from '../../domain/futures/trend.js';
import { FAMILY_LABEL_RO } from '../../domain/discovery/changes.js';
import { CLASS_LABEL_RO, EXCLUDED_FROM_EFFECTIVE } from '../../domain/onchain/labels.js';
import { PENALTIES, POSITIVE } from '../../domain/onchain/smart-money.js';
import { QUALITY_LABEL_RO } from '../../domain/quality/data-quality.js';
import { RISK_CATEGORY, SEVERITY_LABEL_RO } from '../../domain/risk/risk-engine.js';
import { COHORT, HORIZONS, WIN_THRESHOLD_PCT } from '../../domain/backtest/journal.js';
import { VERDICT_LABEL_RO } from '../../domain/onchain/holder-flows.js';
import { ALTSEASON_LABELS } from '../../domain/market/altseason.js';
import { platformCatalogue, SECRETS } from '../../domain/platforms/registry.js';

export const SCHEMA_VERSION = '4.0.0';

export const STATE_LABELS = {
  STRONGLY_POSITIVE: 'Puternic pozitiv',
  POSITIVE: 'Pozitiv',
  SLIGHTLY_POSITIVE: 'Ușor pozitiv',
  NEUTRAL: 'Neutru',
  SLIGHTLY_NEGATIVE: 'Ușor negativ',
  NEGATIVE: 'Negativ',
  STRONGLY_NEGATIVE: 'Puternic negativ',
  UNRESOLVED: 'Conflict între domenii',
  INSUFFICIENT_DATA: 'Date insuficiente',
};

/**
 * Every provider the engine can call, with its role and the exact free plan it runs on. There is no
 * paid plan anywhere in this list: a provider is either public and keyless, or free with an account.
 */
export const PROVIDER_CATALOG = {
  coingecko: { label: 'CoinGecko', role: 'Univers top 1000, trending, categorii, global, detalii, istoric referințe', plan: 'cheie Demo gratuită — 10 000 apeluri/lună' },
  coinmarketcap: { label: 'CoinMarketCap', role: 'Al doilea univers top 1000, supply, date de listare, tag-uri', plan: 'cheie Basic gratuită — 10 000 credite/lună' },
  coinpaprika: { label: 'CoinPaprika', role: 'Plasă de siguranță pentru univers + vechime listare', plan: 'API public, fără cheie' },
  mexc: { label: 'MEXC Spot', role: 'Tickere spot + lumânări 1D/4H pentru long tail-ul de small-cap', plan: 'endpoint-uri publice, 20 cereri/2s' },
  mexc_futures: { label: 'MEXC Futures', role: 'Funding + open interest perpetual', plan: 'endpoint-uri publice' },
  binance_spot: { label: 'Binance (oglinda publică de date)', role: 'Tickere, lumânări și adâncime de pe cea mai lichidă piață', plan: 'data-api.binance.vision, fără cheie' },
  gate: { label: 'Gate', role: 'Funding + open interest perpetual', plan: 'endpoint-uri publice' },
  bitget: { label: 'Bitget', role: 'Funding + open interest perpetual', plan: 'endpoint-uri publice' },
  okx: { label: 'OKX', role: 'Open interest + adâncime perpetual', plan: 'endpoint-uri publice' },
  hyperliquid: { label: 'Hyperliquid', role: 'Perpetue on-chain: funding, OI, volum', plan: 'API public, fără cheie' },
  coinalyze: { label: 'Coinalyze', role: 'Funding, open interest și lichidări pe Binance / Bybit / OKX (înlocuiește CoinGlass, al cărui API este plătit)', plan: 'cont gratuit — 40 apeluri/minut' },
  upbit: { label: 'Upbit', role: 'Listări KRW + avertismente (catalizator)', plan: 'endpoint public' },
  bithumb: { label: 'Bithumb', role: 'Listări KRW (catalizator)', plan: 'endpoint public' },
  binance_alpha: { label: 'Binance Alpha', role: 'Tokeni Alpha, holderi, listare CEX (habitatul LAB/BTW/AGT)', plan: 'endpoint public' },
  dexscreener: { label: 'DexScreener', role: 'Lichiditate DEX, buys/sells, boost-uri plătite ca semnal de atenție', plan: 'API public, fără cheie' },
  geckoterminal: { label: 'GeckoTerminal', role: 'Informații token on-chain, pool-uri trending, distribuție aproximativă', plan: 'API public, ~10/minut' },
  goplus: { label: 'GoPlus Security', role: 'Securitate contract: honeypot, mint, taxe, LP blocat, owner ascuns', plan: 'plan gratuit — 150k unități/lună, atribuire obligatorie' },
  nodereal: { label: 'NodeReal', role: 'Lista de deținători pe lanțurile EVM (nr_getTokenHolders)', plan: 'plan Free — 10 mil. unități de calcul/lună' },
  solana_rpc: { label: 'Solana JSON-RPC', role: 'Cele mai mari conturi de token și supply pe Solana', plan: 'endpoint public, fără cheie' },
  defillama: { label: 'DefiLlama', role: 'TVL + taxe/venituri de protocol', plan: 'Open API, fără cheie' },
  alternative_me: { label: 'alternative.me', role: 'Fear & Greed Index cu istoric', plan: 'API public, fără cheie' },
  cryptoquant: { label: 'CryptoQuant', role: 'Context de ciclu pe BTC/ETH (date de piață, fereastră zilnică)', plan: 'cheie Basic gratuită — 10 000 credite/lună' },
  github: { label: 'GitHub', role: 'Activitate de dezvoltare: commit-uri, contribuitori, ritm', plan: 'token gratuit — 5 000 cereri/oră' },
  youtube: { label: 'YouTube Data API', role: 'Atenție video (înlocuiește API-ul X, care nu are nivel gratuit de citire)', plan: 'cheie gratuită — 10 000 unități/zi' },
  arkham: { label: 'Arkham Intel API', role: 'Tipul și numele entității pentru deținători și fluxuri (opțional)', plan: 'trial gratuit la cerere; fără cheie se folosește setul eth-labels inclus în repo' },
};

/** Providers whose absence makes the run degraded rather than merely thinner. */
const CORE_PROVIDERS = ['coingecko', 'mexc'];

/** Below this share of successful HTTP calls, a provider that answered at all is reported PARTIAL. */
export const PARTIAL_BELOW = 0.8;

/** "RATE_LIMITED ×18 · TIMEOUT ×3" — the failure statuses of one provider, most frequent first. */
function failureMix(statuses) {
  return Object.entries(statuses ?? {})
    .filter(([s]) => s !== 'OK')
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s} ×${n}`)
    .join(' · ');
}

/**
 * One health row per provider. The status is built from two views that can disagree, and the more
 * honest one wins:
 *  · the use case's view (`results`), which counts logical requests — one GoPlus *batch* per chain;
 *  · the HTTP telemetry, which counts every call — one GoPlus call per *token*.
 * In the first live run GoPlus was reported "OK · 3/4" from the first view while 21 of its 43 calls
 * had failed, i.e. half the contracts went unscanned. A provider that answered some calls and
 * failed many is PARTIAL, and its message says how many and why.
 *
 * A key-slot provider that was never called because its free key is absent is NOT_CONFIGURED with
 * the key it needs — never an unexplained SKIPPED.
 */
export function buildProviderHealth(results, telemetrySummary, successRates, keyed, quota = null) {
  return Object.entries(PROVIDER_CATALOG).map(([id, info]) => {
    const r = results[id] ?? null;
    const t = telemetrySummary[id] ?? null;
    const q = quota?.providers?.[id] ?? null;
    let status = r?.status ?? (t ? (t.failures && !t.ok ? 'HTTP_ERROR' : 'OK') : 'SKIPPED');
    let message = r?.message ?? t?.lastMessage ?? '';
    if (status === 'OK' && t && t.calls > 0 && t.ok > 0 && t.failures > 0 && t.ok / t.calls < PARTIAL_BELOW) {
      status = 'PARTIAL';
      message = `${t.ok}/${t.calls} apeluri reușite · ${failureMix(t.statuses)}${t.lastMessage ? ` · ultimul: ${t.lastMessage}` : ''}`;
    }
    const secret = SECRETS.find((s) => s.key === id);
    if (status === 'SKIPPED' && secret && !keyed[id] && !(t?.calls > 0)) {
      status = 'NOT_CONFIGURED';
      message = `lipsește ${secret.env} — ${secret.plan}; deblochează: ${secret.unlocks}`;
    }
    return {
      id,
      label: info.label,
      role: info.role,
      plan: info.plan,
      status,
      message,
      statuses: t?.statuses ?? null,
      mode: r?.meta?.mode ?? null,
      records: r?.meta?.records ?? null,
      latencyMs: t?.avgLatencyMs ?? r?.meta?.latencyMs ?? null,
      calls: t?.calls ?? 0,
      failures: t?.failures ?? 0,
      units: t?.units ?? null,
      keyed: Boolean(keyed[id]),
      sha256: r?.meta?.sha256 ?? null,
      successRateHistory: successRates[id]?.successRate ?? null,
      quota: q ? {
        limitMonth: q.limitMonth,
        limitDay: q.limitDay,
        usedMonth: q.usedMonth,
        usedDay: q.usedDay,
        shareMonth: q.shareMonth,
        shareDay: q.shareDay,
        projectedShare: q.projectedShare,
        paused: q.paused,
        reason: q.reason,
      } : null,
    };
  });
}

export function overallHealth(providers) {
  const st = Object.fromEntries(providers.map((p) => [p.id, p.status]));
  if (st.coingecko !== 'OK' && st.coinmarketcap !== 'OK' && st.coinpaprika !== 'OK') return 'CRITICAL';
  if (CORE_PROVIDERS.some((p) => st[p] !== 'OK')) return 'DEGRADED';
  const failing = providers.filter((p) => !['OK', 'NOT_CONFIGURED', 'SKIPPED'].includes(p.status)).length;
  return failing >= 5 ? 'DEGRADED' : 'HEALTHY';
}

export function chartPayload(deep) {
  if (!deep) return null;
  const h4 = (deep.h4 ?? []).filter((k) => k.closed !== false).slice(-96).map((k) => [Math.round(k.t / 1000), sig(k.o, 5), sig(k.h, 5), sig(k.l, 5), sig(k.c, 5), sig(k.v, 3)]);
  const d1 = (deep.d1 ?? []).slice(-90).map((k) => [Math.round(k.t / 1000), sig(k.c, 5)]);
  if (!h4.length && !d1.length) return null;
  return { h4, d1, d1Source: deep.d1Source ?? null };
}

/**
 * The methodology block: everything needed to audit a number without reading the code. It is also
 * what the dashboard's "Metodologie" screen renders, so the published thresholds can never drift
 * from the constants the engines actually use — they are imported, not retyped.
 */
export function methodology(config, { keys = {} } = {}) {
  return {
    question: 'Arată-mi proiectele mici unde se schimbă simultan mai multe lucruri importante, înainte ca mișcarea să devină evidentă, și spune-mi ce riscuri pot invalida această ipoteză.',
    principles: [
      'UNKNOWN nu este bearish: un factor nemăsurat este scos din ponderare și ponderea lui se redistribuie; scade încrederea, nu scorul.',
      'Fiecare scor este explicabil: factor → pondere efectivă → dovadă → sursă → calitatea datelor.',
      '„S-a schimbat ceva” se măsoară față de propria normă a proiectului (median + MAD pe 30 de zile), nu față de o constantă de piață.',
      'Simultaneitatea cere lățime: minimum 3 schimbări importante în minimum 2 familii distincte de factori.',
      'Precocitatea este raportată separat de momentum: un proiect deja +400% are momentum mare și precocitate mică.',
      'Riscul este o listă de invalidatori numiți, fiecare cu ce ar falsifica teza și unde se urmărește.',
      'Concentrarea se calculează pe supply-ul efectiv: pool-urile, bridge-urile, staking-ul, lock-urile și adresele de ardere sunt excluse.',
      'Fără look-ahead: o normă pentru rularea T folosește doar puncte strict anterioare lui T.',
      'Fără abonamente: fiecare sursă este publică sau cu cont gratuit; cheile opționale doar adaugă, iar absența lor nu rupe nimic.',
      'Research, nu execuție: nicio componentă nu plasează și nu transmite ordine.',
    ],
    scoring: {
      preExpansion: {
        weights: PRE_EXPANSION_WEIGHTS,
        bands: BANDS,
        note: 'Ponderi din soluția tehnică. Factorii nemăsurați se scot din numitor, iar ponderea lor se redistribuie proporțional.',
      },
      futures: {
        weights: FUTURES_WEIGHTS,
        grades: GRADE_CUTS,
        hardFilters: [
          'Trend 1D STRONG BEAR → direcția LONG este exclusă complet',
          'funding extrem (≥ 0,05%/8h) → nota plafonată la B',
          'preț la peste 8% deasupra zonei de intrare → nota plafonată la B',
          `raport câștig/risc sub ${RR_MIN} → nota plafonată la B`,
        ],
        fundingThresholds: FUNDING,
      },
      smartMoney: {
        positive: Object.fromEntries(Object.entries(POSITIVE).map(([k, v]) => [k, { points: v.points, label: v.label }])),
        penalties: Object.fromEntries(Object.entries(PENALTIES).map(([k, v]) => [k, { points: v.points, label: v.label }])),
        note: 'Suma brută trăiește pe axa −85…+100 și este mapată pe 0..100 cu 0 brut la 46, pentru ca „nimic detectat” să stea sub neutru, nu la zero.',
      },
      earlyCandidate: {
        rule: `Stage ${EARLY_CANDIDATE.stages.join(' sau ')} ȘI oportunitate > ${EARLY_CANDIDATE.minOpportunity} ȘI risc < ${EARLY_CANDIDATE.maxRisk}`,
        note: 'Definiția din soluția tehnică, fără condiții adăugate.',
      },
    },
    stages: Object.entries(STAGE_LABEL_RO).map(([k, label]) => ({ stage: Number(k), label, meaning: STAGE_MEANING_RO[k] })),
    changeFamilies: FAMILY_LABEL_RO,
    holderClasses: Object.entries(CLASS_LABEL_RO).map(([k, label]) => ({ key: k, label, excludedFromEffective: EXCLUDED_FROM_EFFECTIVE.has(k) })),
    riskCategories: Object.values(RISK_CATEGORY),
    trackRecord: {
      cohort: config.trackRecord?.cohort ?? COHORT,
      horizonsDays: HORIZONS,
      winThresholdPct: WIN_THRESHOLD_PCT,
      note: 'Fiecare intrare este înregistrată la momentul descoperirii și evaluată mai târziu cu prețuri citite ulterior; intervalele sunt Wilson 95%.',
    },
    thresholds: { universe: config.universe, discovery: config.discovery, similarity: config.similarity },
    quotas: config.quotas,
    secrets: SECRETS.map((s) => ({ env: s.env, label: s.label, plan: s.plan, unlocks: s.unlocks, signup: s.signup, configured: Boolean(keys[s.key]) })),
    platforms: platformCatalogue({ keys }),
    // Legacy similarity engine (LAB/BTW/AGT analogs) keeps its own documented weights.
    similarity: {
      weights: config.weights ?? null,
      domains: Object.entries(DOMAIN_LABELS).map(([id, label]) => ({ id, label, weight: config.weights?.[id] ?? 0 })),
      features: FEATURES.map((f) => ({ key: f.key, label: f.label, weight: f.weight, group: f.group })),
    },
    stageOrder: STAGES,
    labels: {
      stages: STAGE_LABELS,
      stagesV4: STAGE_LABEL_RO,
      signals: SIGNAL_LABELS,
      risks: RISK_LABELS,
      severities: SEVERITY_LABEL_RO,
      hype: HYPE_LABELS,
      catalysts: Object.fromEntries(Object.entries(CATALYST_TYPES).map(([k, v]) => [k, v.label])),
      states: STATE_LABELS,
      quality: QUALITY_LABEL_RO,
      trend: TREND_LABEL_RO,
      funding: FUNDING_LABEL_RO,
      oiRegime: OI_LABEL_RO,
      flows: VERDICT_LABEL_RO,
      altseason: ALTSEASON_LABELS,
      families: FAMILY_LABEL_RO,
      holderClasses: CLASS_LABEL_RO,
    },
  };
}

/** The quota panel: what each free plan has left, and whether anything is paused. */
export function quotaView(plan, runUnits) {
  if (!plan) return null;
  return {
    providers: Object.values(plan.providers ?? {}).map((p) => ({
      provider: p.provider,
      label: p.label,
      configured: p.configured,
      limitMonth: p.limitMonth,
      limitDay: p.limitDay,
      usedMonth: p.usedMonth,
      usedDay: p.usedDay,
      remainingMonth: p.remainingMonth,
      remainingDay: p.remainingDay,
      shareMonth: p.shareMonth === null ? null : round(p.shareMonth * 100, 1),
      shareDay: p.shareDay === null ? null : round(p.shareDay * 100, 1),
      projectedShare: p.projectedShare === null ? null : round(p.projectedShare * 100, 1),
      thisRun: runUnits?.[p.provider] ?? 0,
      paused: p.paused,
      reason: p.reason,
    })).sort((a, b) => (b.shareMonth ?? b.shareDay ?? 0) - (a.shareMonth ?? a.shareDay ?? 0)),
    paused: plan.paused ?? [],
    warnings: plan.warnings ?? [],
    pauseAtPct: 95,
    note: 'Fiecare plan gratuit este contorizat în unitățile lui proprii (apeluri, credite, unități de calcul). La 95% din orice limită, furnizorul este pus în pauză preventiv până la resetare, ca o rulare să nu ajungă niciodată într-o zonă plătită sau blocată.',
  };
}
