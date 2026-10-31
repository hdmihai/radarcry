/**
 * VALIDITY — before a project may appear in a CRI list, is it what it claims to be?
 *
 *   a small or mid cap (capitalisation under the cap, confirmed by an aggregator or by Binance),
 *   a real, identified project (listed by an aggregator, or curated by Binance Alpha),
 *   listed on an exchange (a centralised spot or perpetual market that actually trades),
 *   without a contract trap (honeypot, punitive tax, an owner who can rewrite balances…),
 *   with real liquidity (a way out that does not depend on one thin pool).
 *
 * The radar ranks projects by what is changing; this gate decides which projects it may rank at
 * all. The live audit that motivated it found, among the published rows of one run: a stablecoin
 * pegged at $1, a tokenised NVIDIA share matched to stock perpetuals, tokens known only from Gate
 * Alpha's memebox list (capitalisation reported by that list alone, symbol a hash), and a third of
 * the rows on no centralised exchange at all — each ranked next to real projects.
 *
 * Every check ends in one of five states, and the difference between them is the whole design:
 *
 *   PASS     the evidence is there and it is good
 *   WARN     the evidence is there and it is worth knowing — never blocks
 *   FAIL     the evidence is there and it disqualifies — the project is REJECTED, with the reason
 *   UNKNOWN  the evidence is missing — the project is PENDING, never rejected for it
 *   NA       the check does not apply (a native coin has no token contract)
 *
 * UNKNOWN is not FAIL: the project's founding rule ("unknown is not bearish") holds here too. A
 * contract not scanned yet is *pending* — kept out of the valid list until the next scan, never
 * labelled a scam. Only evidence rejects.
 *
 * Pure: no I/O, no clock. The evidence object is assembled by the application layer from whatever
 * the adapters read; this module only judges it.
 */
import { isNum, round } from '../shared/math.js';

export const VALIDITY = Object.freeze({ VALID: 'VALID', PENDING: 'PENDING', REJECTED: 'REJECTED' });
export const CHECK = Object.freeze({ PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN', NA: 'NA' });

export const VALIDITY_LABEL_RO = Object.freeze({ VALID: 'verificat', PENDING: 'în verificare', REJECTED: 'respins' });

/** The thresholds. Every value is published with the snapshot, next to the results it produced. */
export const DEFAULT_VALIDITY_POLICY = Object.freeze({
  minMarketCapUsd: 1_000_000,
  maxMarketCapUsd: 300_000_000,
  /** A buy or sell tax above this is a trap; between `warnTaxPct` and this it is a warning. */
  maxTaxPct: 10,
  warnTaxPct: 5,
  /** Without a centralised spot market, the DEX pool is the only exit. */
  minDexLiquidityUsd: 50_000,
  /** A listing counts when the pair trades at least this much in 24 h (when the volume is known). */
  minSpotVolumeUsd: 10_000,
  minAgeDays: 14,
  concentrationWarnPct: 50,
  /** Owner or creator holding more than this share of supply is a warning. */
  insiderWarnPct: 20,
  fdvWarnRatio: 10,
  turnoverWarn: 3,
  /** Gate Alpha lists thousands of launchpad tokens automatically; on its own it confirms nothing. */
  acceptGateAlphaOnly: false,
});

/** The checks, in display order. The first five decide; the last two inform. */
export const VALIDITY_CHECKS = Object.freeze([
  { key: 'scope', label: 'Capitalizare mică sau medie, confirmată', required: true },
  { key: 'identity', label: 'Proiect real, identificat', required: true },
  { key: 'listing', label: 'Listat pe burse', required: true },
  { key: 'contract', label: 'Contract fără capcane', required: true },
  { key: 'liquidity', label: 'Lichiditate reală', required: true },
  { key: 'distribution', label: 'Distribuția deținătorilor', required: false },
  { key: 'maturity', label: 'Vechime și activitate', required: false },
]);
const REQUIRED = new Set(VALIDITY_CHECKS.filter((c) => c.required).map((c) => c.key));

/** Exchanges, by the bar they set for a listing. Tier 1 lists after real due diligence. */
export const EXCHANGE_TIER = Object.freeze({
  binance: 1, okx: 1, upbit: 1, coinbase: 1, kraken: 1,
  gate: 2, bitget: 2, bithumb: 2, kucoin: 2, bybit: 2, htx: 2,
  mexc: 3,
});
export const EXCHANGE_NAME = Object.freeze({
  binance: 'Binance', okx: 'OKX', upbit: 'Upbit', coinbase: 'Coinbase', kraken: 'Kraken',
  gate: 'Gate', bitget: 'Bitget', bithumb: 'Bithumb', kucoin: 'KuCoin', bybit: 'Bybit', htx: 'HTX',
  mexc: 'MEXC', hyperliquid: 'Hyperliquid',
});

const MCAP_SOURCE_RO = {
  coingecko: 'CoinGecko', coinmarketcap: 'CoinMarketCap', coinpaprika: 'CoinPaprika',
  binance_alpha: 'Binance Alpha', gate_alpha: 'Gate Alpha',
};
const VERIFIED_MCAP = new Set(['coingecko', 'coinmarketcap', 'coinpaprika', 'binance_alpha']);
const EXCLUSION_RO = {
  STABLECOIN: 'stablecoin sau activ ancorat la o monedă — nu are cum să facă parte dintr-o teză de creștere',
  WRAPPED_OR_STAKED: 'token împachetat sau chitanță de staking — urmează activul de bază',
  TOKENIZED_ASSET: 'activ tradițional tokenizat (acțiune, aur, titluri de stat) — urmează piața de origine',
};

const money = (x) => {
  if (!isNum(x)) return 'necunoscut';
  if (Math.abs(x) >= 1e9) return `${round(x / 1e9, 2)} mld $`;
  if (Math.abs(x) >= 1e6) return `${round(x / 1e6, 1)} mil $`;
  if (Math.abs(x) >= 1e3) return `${round(x / 1e3, 0)} mii $`;
  return `${round(x, 0)} $`;
};
const listRo = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} și ${xs[xs.length - 1]}`);

/** One finding inside a check: a code for aggregation, a sentence for the reader. */
const finding = (code, text) => ({ code, text });

/**
 * Resolve a check from its findings: the worst finding decides the state.
 * @param {string} key
 * @param {{fail?:any[], warn?:any[], unknown?:any[], pass?:string|null, na?:string|null}} f
 */
function result(key, { fail = [], warn = [], unknown = [], pass = null, na = null }) {
  const label = VALIDITY_CHECKS.find((c) => c.key === key)?.label ?? key;
  if (fail.length) return { key, label, status: CHECK.FAIL, codes: fail.map((x) => x.code), detail: fail.map((x) => x.text).join('; '), warnings: warn.map((x) => x.text) };
  if (unknown.length) return { key, label, status: CHECK.UNKNOWN, codes: unknown.map((x) => x.code), detail: unknown.map((x) => x.text).join('; '), warnings: warn.map((x) => x.text) };
  if (na) return { key, label, status: warn.length ? CHECK.WARN : CHECK.NA, codes: warn.map((x) => x.code), detail: [na, ...warn.map((x) => x.text)].join('; '), warnings: warn.map((x) => x.text) };
  if (warn.length) return { key, label, status: CHECK.WARN, codes: warn.map((x) => x.code), detail: [pass, ...warn.map((x) => x.text)].filter(Boolean).join('; '), warnings: warn.map((x) => x.text) };
  return { key, label, status: CHECK.PASS, codes: [], detail: pass ?? '', warnings: [] };
}

/* ─────────────────────────────────────────── the checks ──────────────────────────────────────── */

function scopeCheck(ev, p) {
  const fail = [];
  const warn = [];
  if (ev.exclusion) fail.push(finding('EXCLUDED_ASSET', EXCLUSION_RO[ev.exclusion] ?? 'activ exclus din universul de research'));
  const mc = ev.marketCap;
  const src = ev.marketCapSource;
  if (!isNum(mc)) return result('scope', { fail, unknown: fail.length ? [] : [finding('MCAP_UNKNOWN', 'capitalizarea nu este raportată de nicio sursă')] });
  if (src && !VERIFIED_MCAP.has(src) && !(src === 'gate_alpha' && p.acceptGateAlphaOnly)) {
    fail.push(finding('MCAP_UNVERIFIED', `capitalizarea de ${money(mc)} vine doar din lista ${MCAP_SOURCE_RO[src] ?? src}, fără confirmarea unui agregator`));
  }
  if (mc > p.maxMarketCapUsd) fail.push(finding('MCAP_ABOVE_CAP', `capitalizare ${money(mc)}, peste plafonul de ${money(p.maxMarketCapUsd)} al proiectelor mici și medii`));
  if (mc < p.minMarketCapUsd) fail.push(finding('MCAP_BELOW_FLOOR', `capitalizare ${money(mc)}, sub pragul de ${money(p.minMarketCapUsd)}`));
  // Another aggregator above the cap: the project is small by one count and not by another.
  const above = Object.entries(ev.marketCapBySource ?? {})
    .filter(([s, v]) => VERIFIED_MCAP.has(s) && isNum(v) && v > p.maxMarketCapUsd);
  if (!fail.length && above.length) warn.push(finding('MCAP_DISPUTED', `${listRo(above.map(([s]) => MCAP_SOURCE_RO[s] ?? s))} raportează peste plafon (${money(Math.max(...above.map(([, v]) => v)))})`));
  if (isNum(ev.mcapDisagreementPct) && ev.mcapDisagreementPct > 50) warn.push(finding('MCAP_DISAGREEMENT', `agregatorii diferă cu ${round(ev.mcapDisagreementPct, 0)}% asupra capitalizării`));
  if (isNum(ev.fdv) && mc > 0 && ev.fdv / mc > p.fdvWarnRatio) warn.push(finding('LOW_FLOAT', `doar ${round((mc / ev.fdv) * 100, 1)}% din supply este în circulație (FDV ${money(ev.fdv)})`));
  return result('scope', { fail, warn, pass: `capitalizare ${money(mc)} (${MCAP_SOURCE_RO[src] ?? src ?? 'sursă necunoscută'}), sub plafonul de ${money(p.maxMarketCapUsd)}` });
}

function identityCheck(ev, p) {
  const fail = [];
  const warn = [];
  const sec = ev.security ?? {};
  if (sec.fakeToken === true) fail.push(finding('FAKE_TOKEN', 'GoPlus: imită un token cunoscut (alt contract decât cel original)'));
  if (sec.airdropScam === true) fail.push(finding('AIRDROP_SCAM', 'GoPlus: token de tip „airdrop scam”'));
  const aggregators = (ev.aggregators ?? []).map((s) => MCAP_SOURCE_RO[s] ?? s);
  const binanceAlpha = (ev.alphaPrograms ?? []).includes('binance');
  const gateAlphaOnly = !aggregators.length && !binanceAlpha;
  if (gateAlphaOnly && !p.acceptGateAlphaOnly) {
    fail.push(finding('ALPHA_ONLY', (ev.alphaPrograms ?? []).includes('gate')
      ? 'cunoscut doar din lista Gate Alpha (listare automată de launchpad) — niciun agregator nu îl confirmă'
      : 'nu este listat de niciun agregator (CoinGecko, CoinMarketCap, CoinPaprika)'));
  }
  const sites = (ev.links?.websites ?? []).length;
  const socials = (ev.links?.socials ?? []).length;
  if (!fail.length && ev.linksChecked && !sites && !socials) warn.push(finding('NO_LINKS', 'niciun site și niciun cont social în sursele consultate'));
  if (sec.launchpad && !fail.length) warn.push(finding('LAUNCHPAD_TOKEN', `lansat printr-un launchpad (${sec.launchpad})`));
  const who = [...aggregators, ...(binanceAlpha ? ['Binance Alpha (selecție Binance)'] : [])];
  const presence = [sites ? 'site' : null, socials ? `${socials} ${socials === 1 ? 'cont social' : 'conturi sociale'}` : null].filter(Boolean);
  return result('identity', { fail, warn, pass: `listat de ${listRo(who)}${presence.length ? ` · ${presence.join(', ')}` : ''}` });
}

/** GoPlus names exchanges in prose ("Gate.io", "Huobi"); map them onto the venue keys above. */
export function exchangeKey(name) {
  const n = String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (n.startsWith('gate')) return 'gate';
  if (n === 'huobi' || n === 'htx' || n.startsWith('huobi')) return 'htx';
  if (n.startsWith('okx') || n === 'okex') return 'okx';
  if (n.startsWith('binance')) return 'binance';
  if (n.startsWith('coinbase')) return 'coinbase';
  if (n.startsWith('kucoin')) return 'kucoin';
  return n;
}

/** Listings that count: a spot pair that trades, a perpetual, Binance Alpha, GoPlus's CEX list. */
export function listingSummary(ev, p = DEFAULT_VALIDITY_POLICY) {
  const spot = (ev.spot ?? []).filter((s) => !isNum(s.quoteVolume) || s.quoteVolume >= p.minSpotVolumeUsd);
  const idle = (ev.spot ?? []).filter((s) => isNum(s.quoteVolume) && s.quoteVolume < p.minSpotVolumeUsd);
  const perps = [...new Set(ev.perps ?? [])];
  const binanceAlpha = (ev.alphaPrograms ?? []).includes('binance');
  const goplusCex = [...new Set((ev.cexList ?? []).map(String))];
  const tiers = [
    ...spot.map((s) => EXCHANGE_TIER[s.venue] ?? 3),
    ...goplusCex.map((n) => EXCHANGE_TIER[exchangeKey(n)] ?? 3),
  ];
  const bestTier = tiers.length ? Math.min(...tiers) : null;
  return {
    spot, idle, perps, binanceAlpha, goplusCex,
    bestTier,
    listed: spot.length > 0 || perps.length > 0 || binanceAlpha || goplusCex.length > 0,
    /** A spot listing on an exchange that does due diligence (tier 1–2), by our read or GoPlus's. */
    vetted: bestTier !== null && bestTier <= 2,
  };
}

function listingCheck(ev, p) {
  const L = listingSummary(ev, p);
  const warn = [];
  if (ev.krwWarning) warn.push(finding('KRW_WARNING', 'bursa coreeană a pus un avertisment de investiție (risc de delistare)'));
  if (L.idle.length) warn.push(finding('IDLE_PAIR', `perechi fără volum pe ${listRo(L.idle.map((s) => EXCHANGE_NAME[s.venue] ?? s.venue))}`));
  if (L.listed) {
    const parts = [];
    if (L.spot.length) parts.push(`spot pe ${listRo(L.spot.map((s) => EXCHANGE_NAME[s.venue] ?? s.venue))}`);
    if (L.perps.length) parts.push(`perpetue pe ${L.perps.length} ${L.perps.length === 1 ? 'bursă' : 'burse'}`);
    if (L.binanceAlpha) parts.push('Binance Alpha');
    if (!L.spot.length && L.goplusCex.length) parts.push(`GoPlus: ${listRo(L.goplusCex)}`);
    if (!L.spot.length && !L.perps.length && L.binanceAlpha && !L.goplusCex.length) warn.push(finding('ALPHA_NO_CEX', 'doar în Binance Alpha, încă fără piață pe o bursă centralizată'));
    if (!L.spot.length && L.perps.length && !L.binanceAlpha) warn.push(finding('PERPS_ONLY', 'doar contracte perpetue, fără piață spot'));
    return result('listing', { warn, pass: parts.join(' · ') });
  }
  if (!ev.venuesRead?.spot) return result('listing', { warn, unknown: [finding('VENUES_UNREAD', 'bursele nu au răspuns în această rulare — listarea nu a putut fi verificată')] });
  const gate = (ev.alphaPrograms ?? []).includes('gate');
  return result('listing', {
    warn,
    fail: [finding('NOT_LISTED', `nicio piață pe o bursă centralizată citită (${listRo(['Binance', 'OKX', 'Gate', 'Bitget', 'MEXC', 'Upbit', 'Bithumb'])}) și nici în Binance Alpha${gate ? ' — doar Gate Alpha' : ''}`)],
  });
}

function contractCheck(ev, p, listing) {
  if (!ev.hasContract) return result('contract', { na: 'monedă nativă a propriului lanț — nu are contract de token' });
  const sec = ev.security;
  const gt = ev.gt ?? null;
  if (!sec) {
    // GeckoTerminal's own honeypot flag is evidence even when GoPlus has not answered yet.
    if (gt?.honeypot === true) return result('contract', { fail: [finding('HONEYPOT', 'GeckoTerminal: honeypot — tokenul nu poate fi vândut')] });
    if (!ev.scanner) return result('contract', { warn: [finding('NO_SCANNER', `lanțul ${ev.chain ?? 'acestui token'} nu are un scanner de securitate gratuit — validat doar prin listări`)], na: 'contract nescanat' });
    return result('contract', { unknown: [finding('NOT_SCANNED', 'contractul nu a fost încă scanat (GoPlus) — intră în rotația următoarei rulări')] });
  }
  const traps = [];
  const controls = [];
  const warn = [];
  const yes = (v) => v === true;
  const tax = Math.max(isNum(sec.buyTaxPct) ? sec.buyTaxPct : -1, isNum(sec.sellTaxPct) ? sec.sellTaxPct : -1);
  // Traps: whatever the listings, the contract itself takes the holder's money or exit.
  if (yes(sec.honeypot) || yes(gt?.honeypot)) traps.push(finding('HONEYPOT', 'honeypot — cumpărătorii nu pot vinde'));
  else if (yes(sec.cannotSell)) traps.push(finding('CANNOT_SELL', 'soldul nu poate fi vândut integral'));
  if (yes(sec.nonTransferable)) traps.push(finding('NON_TRANSFERABLE', 'token netransferabil'));
  if (tax > p.maxTaxPct) traps.push(finding('HIGH_TAX', `taxă de ${round(tax, 1)}% la tranzacționare (peste ${p.maxTaxPct}%)`));
  if (yes(sec.ownerChangeBalance)) traps.push(finding('OWNER_CHANGE_BALANCE', 'owner-ul poate modifica soldurile deținătorilor'));
  if (yes(sec.balanceMutable)) traps.push(finding('BALANCE_MUTABLE', 'autoritate care poate modifica soldurile (Solana)'));
  if (yes(sec.selfdestruct)) traps.push(finding('SELFDESTRUCT', 'contractul se poate autodistruge'));
  if (yes(sec.defaultFrozen)) traps.push(finding('DEFAULT_FROZEN', 'conturile noi pornesc înghețate (Solana)'));
  if (yes(sec.honeypotSameCreator)) traps.push(finding('HONEYPOT_CREATOR', 'creatorul a mai lansat honeypot-uri'));
  if (yes(sec.maliciousCreator)) traps.push(finding('MALICIOUS_CREATOR', 'creatorul este o adresă semnalată ca rău-intenționată'));
  // Controls: a power someone keeps over the token. Disqualifying on a token no vetted exchange
  // carries; a warning on one that a tier 1–2 exchange lists (or that GoPlus's trust list names):
  // such an exchange reviewed the project before listing it, and an upgradeable or owner-managed
  // contract is common among real projects. The power stays visible, as a warning.
  if (yes(sec.hiddenOwner)) controls.push(finding('HIDDEN_OWNER', 'owner ascuns'));
  if (yes(sec.canTakeBackOwnership)) controls.push(finding('TAKE_BACK_OWNERSHIP', 'ownership-ul renunțat poate fi recuperat'));
  if (sec.openSource === false) controls.push(finding('CLOSED_SOURCE', 'cod sursă neverificat public'));
  if (yes(sec.freezable)) controls.push(finding('FREEZE_AUTHORITY', 'autoritate de înghețare activă (Solana)'));
  if (yes(sec.closable)) controls.push(finding('CLOSABLE', 'programul tokenului poate fi închis (Solana)'));
  if (yes(sec.cannotBuy)) controls.push(finding('CANNOT_BUY', 'tokenul nu poate fi cumpărat'));
  if (yes(gt?.freezeAuthority) && !yes(sec.freezable)) controls.push(finding('FREEZE_AUTHORITY', 'autoritate de înghețare activă (GeckoTerminal)'));
  // Warnings: worth knowing, never disqualifying.
  if (tax > p.warnTaxPct && tax <= p.maxTaxPct) warn.push(finding('TAX', `taxă de ${round(tax, 1)}%`));
  if (yes(sec.mintable) && sec.ownerRenounced !== true) warn.push(finding('MINTABLE', 'supply-ul mai poate fi emis de owner'));
  if (yes(sec.transferPausable) && !yes(sec.freezable)) warn.push(finding('PAUSABLE', 'transferurile pot fi oprite'));
  if (yes(sec.blacklist)) warn.push(finding('BLACKLIST', 'are listă neagră de adrese'));
  if (yes(sec.slippageModifiable) || yes(sec.personalSlippageModifiable)) warn.push(finding('TAX_MODIFIABLE', 'taxele pot fi modificate de owner'));
  if (yes(sec.proxy)) warn.push(finding('PROXY', 'contract upgradabil (proxy)'));
  if (yes(sec.externalCall)) warn.push(finding('EXTERNAL_CALL', 'apelează alte contracte în funcțiile principale'));
  if (yes(sec.tradingCooldown)) warn.push(finding('COOLDOWN', 'impune pauză între tranzacții'));
  if (isNum(sec.ownerPercentPct) && sec.ownerPercentPct > p.insiderWarnPct) warn.push(finding('OWNER_HOLDS', `owner-ul deține ${round(sec.ownerPercentPct, 1)}% din supply`));
  if (isNum(sec.creatorPercentPct) && sec.creatorPercentPct > p.insiderWarnPct) warn.push(finding('CREATOR_HOLDS', `creatorul deține ${round(sec.creatorPercentPct, 1)}% din supply`));

  const trusted = listing.vetted || sec.trusted === true;
  const fail = [...traps, ...(trusted ? [] : controls)];
  if (trusted) warn.push(...controls.map((c) => finding(c.code, `${c.text} (acceptat: listat pe o bursă care verifică proiectele)`)));
  const when = sec.asOf ? ` (citit ${String(sec.asOf).slice(0, 10)}${sec.carried ? ', purtat din rularea anterioară' : ''})` : '';
  const clean = [
    sec.honeypot === false ? 'fără honeypot' : null,
    tax >= 0 ? `taxe ${round(Math.max(0, sec.buyTaxPct ?? 0), 1)}/${round(Math.max(0, sec.sellTaxPct ?? 0), 1)}%` : null,
    sec.ownerRenounced === true ? 'owner renunțat' : null,
    sec.openSource === true ? 'cod verificat' : null,
  ].filter(Boolean);
  return result('contract', { fail, warn, pass: `${sec.source === 'goplus' ? 'GoPlus' : 'scaner'}${when}: ${clean.length ? clean.join(', ') : 'niciun semnal de capcană'}` });
}

function liquidityCheck(ev, p, listing) {
  const spotVolume = listing.spot.reduce((s, x) => s + (isNum(x.quoteVolume) ? x.quoteVolume : 0), 0);
  const liq = ev.liquidityUsd;
  const warn = [];
  if (listing.spot.length) {
    if (isNum(liq) && isNum(ev.marketCap) && ev.marketCap > 0 && liq / ev.marketCap < 0.002 && liq < p.minDexLiquidityUsd) {
      warn.push(finding('THIN_DEX', `pool DEX subțire (${money(liq)})`));
    }
    return result('liquidity', { warn, pass: `piață spot centralizată${spotVolume > 0 ? `, ${money(spotVolume)} volum în 24 h` : ''}${isNum(liq) ? ` · pool DEX ${money(liq)}` : ''}` });
  }
  if (!isNum(liq)) return result('liquidity', { unknown: [finding('LIQUIDITY_UNKNOWN', 'fără piață spot centralizată și fără o citire a lichidității DEX')] });
  if (liq < p.minDexLiquidityUsd) {
    return result('liquidity', { fail: [finding('THIN_LIQUIDITY', `singura ieșire este un pool DEX de ${money(liq)} (sub ${money(p.minDexLiquidityUsd)})`)] });
  }
  if (isNum(ev.marketCap) && ev.marketCap > 0 && liq / ev.marketCap < 0.005) warn.push(finding('THIN_VS_MCAP', `lichiditatea DEX este doar ${round((liq / ev.marketCap) * 100, 2)}% din capitalizare`));
  return result('liquidity', { warn, pass: `pool DEX de ${money(liq)}${ev.liquiditySource ? ` (${ev.liquiditySource})` : ''}` });
}

function distributionCheck(ev, p) {
  const t = ev.top10EffectivePct;
  if (!isNum(t)) return result('distribution', { unknown: [finding('HOLDERS_UNKNOWN', 'distribuția deținătorilor nu a fost măsurată în această rulare')] });
  if (t > p.concentrationWarnPct) return result('distribution', { warn: [finding('CONCENTRATED', `cei mai mari 10 deținători efectivi au ${round(t, 1)}% (burse, pool-uri și lock-uri excluse)`)] });
  return result('distribution', { pass: `top 10 efectiv ${round(t, 1)}%` });
}

function maturityCheck(ev, p) {
  const warn = [];
  if (isNum(ev.ageDays) && ev.ageDays < p.minAgeDays) warn.push(finding('TOO_NEW', `listat de ${round(ev.ageDays, 0)} zile — prea puțin istoric`));
  if (isNum(ev.turnover) && ev.turnover > p.turnoverWarn) warn.push(finding('WASH_SUSPECT', `rotație de ${round(ev.turnover, 1)}× capitalizarea pe zi — posibil volum artificial`));
  if ((ev.flags ?? []).includes('STALE_QUOTE')) warn.push(finding('STALE_QUOTE', 'cotație neactualizată de peste 6 ore'));
  if (!isNum(ev.ageDays) && !warn.length) return result('maturity', { unknown: [finding('AGE_UNKNOWN', 'data listării nu este cunoscută')] });
  return result('maturity', { warn, pass: isNum(ev.ageDays) ? `listat de ${round(ev.ageDays, 0)} zile` : 'activitate normală' });
}

/**
 * Judge one project.
 * @param {any} ev evidence assembled by the application (see use-cases/validity.js)
 * @param {Partial<typeof DEFAULT_VALIDITY_POLICY>} [policy]
 */
export function assessValidity(ev, policy = {}) {
  const p = { ...DEFAULT_VALIDITY_POLICY, ...policy };
  const listing = listingSummary(ev, p);
  const checks = [
    scopeCheck(ev, p),
    identityCheck(ev, p),
    listingCheck(ev, p),
    contractCheck(ev, p, listing),
    liquidityCheck(ev, p, listing),
    distributionCheck(ev, p),
    maturityCheck(ev, p),
  ];
  const failed = checks.filter((c) => c.status === CHECK.FAIL);
  // Only a missing *required* check holds a project back; the informative ones never do.
  const missing = checks.filter((c) => c.status === CHECK.UNKNOWN && REQUIRED.has(c.key));
  const status = failed.length ? VALIDITY.REJECTED : missing.length ? VALIDITY.PENDING : VALIDITY.VALID;
  return {
    status,
    label: VALIDITY_LABEL_RO[status],
    checks,
    reasons: failed.map((c) => ({ check: c.key, codes: c.codes, text: c.detail })),
    missing: missing.map((c) => ({ check: c.key, codes: c.codes, text: c.detail })),
    warnings: checks.flatMap((c) => (c.status === CHECK.FAIL ? [] : c.warnings.map((text) => ({ check: c.key, text })))),
    listingTier: listing.bestTier,
  };
}

/** Counts over a run: how many passed, and what rejected or held back the rest. */
export function validitySummary(results) {
  const out = { checked: 0, valid: 0, pending: 0, rejected: 0, byCode: {}, byCheck: {} };
  for (const r of results) {
    out.checked += 1;
    if (r.status === VALIDITY.VALID) out.valid += 1;
    else if (r.status === VALIDITY.PENDING) out.pending += 1;
    else out.rejected += 1;
    for (const x of r.status === VALIDITY.REJECTED ? r.reasons : r.status === VALIDITY.PENDING ? r.missing : []) {
      out.byCheck[x.check] = (out.byCheck[x.check] ?? 0) + 1;
      for (const c of x.codes) out.byCode[c] = (out.byCode[c] ?? 0) + 1;
    }
  }
  return out;
}
