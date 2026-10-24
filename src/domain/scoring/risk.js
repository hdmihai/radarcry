/**
 * Risk assessment, kept separate from the opportunity score: LAB/BTW/AGT-type runners are by nature
 * low-float and concentrated, so those traits are surfaced as risk (with position-size guidance)
 * instead of silently filtering the very setups the radar is looking for.
 * Only CRITICAL risks (cannot sell, extreme tax, exchange warning) block a signal.
 */
import { isNum } from '../shared/math.js';

const POINTS = { CRITICAL: 60, HIGH: 18, MEDIUM: 7, LOW: 2 };

export const RISK_LABELS = {
  HONEYPOT: 'Honeypot / nu se poate vinde',
  EXTREME_TAX: 'Taxă de tranzacționare extremă',
  KRW_WARNING: 'Avertisment exchange coreean',
  EXTREME_CONCENTRATION: 'Concentrare extremă (top 10 ≥ 90%)',
  HIGH_CONCENTRATION: 'Concentrare ridicată (top 10 ≥ 70%)',
  UNLOCK_OVERHANG: 'Float foarte mic + FDV mare (presiune de deblocare)',
  LOW_FLOAT: 'Float sub 20%',
  FDV_OVERHANG: 'FDV ≥ 5× market cap',
  CROWDED_LONGS: 'Long-uri înghesuite (funding ridicat)',
  OI_EXCEEDS_MCAP: 'Open interest ≥ market cap',
  OVEREXTENDED: 'Supra-extins (RSI 1D ≥ 85 sau 7z ≥ +150%)',
  OWNER_PRIVILEGES: 'Privilegii owner (pause/blacklist/hidden owner)',
  MINTABLE: 'Contract cu mint activ',
  TAX: 'Taxă buy/sell 3–25%',
  PROXY_CONTRACT: 'Contract proxy (upgradeable)',
  NOT_OPEN_SOURCE: 'Cod sursă neverificat',
  THIN_LIQUIDITY: 'Lichiditate DEX foarte mică fără CEX',
  VERY_NEW: 'Listare foarte nouă (< 14 zile)',
  MCAP_DISAGREEMENT: 'CoinGecko și CMC raportează market cap foarte diferit',
  STALE_QUOTE: 'Cotație învechită (> 6h)',
  EXCHANGE_INFLOW: 'Depuneri nete pe exchange-uri (Arkham)',
  WALLET_DISTRIBUTION: 'Portofelele distribuie (Arkham)',
};

function flag(code, severity, detail) {
  return { code, severity, label: RISK_LABELS[code] ?? code, detail };
}

/**
 * @param {any} lf listing features
 * @param {any} oc on-chain facts (security, concentration, liquidity) — optional
 * @param {any} d1 daily features — optional
 * @param {string[]} qualityFlags
 */
export function assessRisk(lf, oc, d1, qualityFlags = []) {
  const flags = [];
  const sec = oc?.security;
  if (sec) {
    if (sec.honeypot === true || sec.cannotSell === true) flags.push(flag('HONEYPOT', 'CRITICAL', 'GoPlus: vânzare blocată'));
    const maxTax = Math.max(sec.buyTax ?? 0, sec.sellTax ?? 0);
    if (maxTax >= 0.25) flags.push(flag('EXTREME_TAX', 'CRITICAL', `taxă ${(maxTax * 100).toFixed(0)}%`));
    else if (maxTax >= 0.03) flags.push(flag('TAX', 'MEDIUM', `taxă ${(maxTax * 100).toFixed(1)}%`));
    const priv = ['hiddenOwner', 'canTakeBackOwnership', 'transferPausable', 'blacklist', 'slippageModifiable'].filter((k) => sec[k] === true);
    if (priv.length) flags.push(flag('OWNER_PRIVILEGES', priv.length >= 2 ? 'HIGH' : 'MEDIUM', priv.join(', ')));
    if (sec.mintable === true && !sec.ownerRenounced) flags.push(flag('MINTABLE', 'HIGH', 'owner poate emite tokeni'));
    if (sec.proxy === true) flags.push(flag('PROXY_CONTRACT', 'MEDIUM', 'logică modificabilă'));
    if (sec.openSource === false) flags.push(flag('NOT_OPEN_SOURCE', 'MEDIUM', 'contract neverificat'));
  }
  if (lf.krwWarning) flags.push(flag('KRW_WARNING', 'CRITICAL', String(lf.krwWarning)));

  const top10 = oc?.top10EffectivePct ?? oc?.top10Pct;
  if (isNum(top10)) {
    if (top10 >= 90) flags.push(flag('EXTREME_CONCENTRATION', 'HIGH', `top 10 = ${top10.toFixed(0)}%`));
    else if (top10 >= 70) flags.push(flag('HIGH_CONCENTRATION', 'MEDIUM', `top 10 = ${top10.toFixed(0)}%`));
  }
  if (isNum(lf.floatRatio) && isNum(lf.fdvToMcap) && lf.floatRatio < 0.12 && lf.fdvToMcap > 8) {
    flags.push(flag('UNLOCK_OVERHANG', 'HIGH', `float ${(lf.floatRatio * 100).toFixed(0)}%, FDV/MC ${lf.fdvToMcap.toFixed(1)}×`));
  } else {
    if (isNum(lf.floatRatio) && lf.floatRatio < 0.2) flags.push(flag('LOW_FLOAT', 'MEDIUM', `float ${(lf.floatRatio * 100).toFixed(0)}%`));
    if (isNum(lf.fdvToMcap) && lf.fdvToMcap >= 5) flags.push(flag('FDV_OVERHANG', 'MEDIUM', `FDV/MC ${lf.fdvToMcap.toFixed(1)}×`));
  }
  if (isNum(lf.fundingAvg) && lf.fundingAvg >= 0.0008) flags.push(flag('CROWDED_LONGS', 'HIGH', `funding ${(lf.fundingAvg * 100).toFixed(3)}%`));
  if (isNum(lf.oiToMcap) && lf.oiToMcap >= 1) flags.push(flag('OI_EXCEEDS_MCAP', 'MEDIUM', `OI/MC ${(lf.oiToMcap * 100).toFixed(0)}%`));
  if ((isNum(d1?.rsi14) && d1.rsi14 >= 85) || (isNum(lf.change7d) && lf.change7d >= 150)) {
    flags.push(flag('OVEREXTENDED', 'HIGH', `RSI ${d1?.rsi14?.toFixed?.(0) ?? '?'}, 7z ${lf.change7d?.toFixed?.(0) ?? '?'}%`));
  }
  if (isNum(oc?.dexLiquidityUsd) && oc.dexLiquidityUsd < 50_000 && !lf.mexcSpot && !lf.perpVenues) {
    flags.push(flag('THIN_LIQUIDITY', 'HIGH', `lichiditate DEX ${Math.round(oc.dexLiquidityUsd).toLocaleString('en-US')} $`));
  }
  if (isNum(lf.ageDays) && lf.ageDays < 14) flags.push(flag('VERY_NEW', 'HIGH', `${lf.ageDays.toFixed(0)} zile`));
  // Arkham wallet intelligence: coins moving to exchanges or wallets distributing (7d window).
  const wf = oc?.walletFlows;
  const win = String(wf?.window ?? '').replace(/^(\d+)d$/, '$1 zile');
  if (wf && isNum(oc.exchangeNetToMcap) && oc.exchangeNetToMcap >= 0.01 && wf.exchangeNetUsd >= 100_000) {
    flags.push(flag('EXCHANGE_INFLOW', 'MEDIUM', `depuneri nete ${Math.round(wf.exchangeNetUsd).toLocaleString('en-US')} $ (${(oc.exchangeNetToMcap * 100).toFixed(1)}% din MC, ultimele ${win})`));
  }
  if (wf && isNum(wf.netflowRatio) && wf.netflowRatio <= -0.35 && wf.walletOutUsd >= 100_000) {
    flags.push(flag('WALLET_DISTRIBUTION', 'MEDIUM', `flux net portofele ${(wf.netflowRatio * 100).toFixed(0)}%, ultimele ${win}`));
  }
  if (qualityFlags.includes('MCAP_DISAGREEMENT')) flags.push(flag('MCAP_DISAGREEMENT', 'MEDIUM', 'verifică supply-ul circulant'));
  if (qualityFlags.includes('STALE_QUOTE')) flags.push(flag('STALE_QUOTE', 'LOW', 'date posibil întârziate'));

  const score = Math.min(100, flags.reduce((s, f) => s + POINTS[f.severity], 0));
  const critical = flags.some((f) => f.severity === 'CRITICAL');
  const grade = critical ? 'D' : score < 15 ? 'A' : score < 35 ? 'B' : score < 60 ? 'C' : 'D';
  const sizing = { A: 'mărime standard', B: 'mărime redusă (≤ 50%)', C: 'mărime mică (≤ 25%)', D: 'evită / doar observare' }[grade];
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  return { score, grade, critical, sizing, flags };
}
