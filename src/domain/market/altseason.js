/**
 * ALTSEASON INDEX, computed locally.
 *
 * The published "Altcoin Season Index" is a paid endpoint on every provider that offers it. Its
 * definition, however, is public and simple: the share of the top 100 coins (excluding stablecoins
 * and wrapped assets) that outperformed Bitcoin over a 90-day window. 75 % or more is altcoin
 * season; 25 % or less is Bitcoin season.
 *
 * We already hold the top-1000 listing with 90-day and 30-day changes, so the index is computed
 * here from our own universe rather than bought. The output always carries its coverage, the window
 * used and the number of coins compared, so it can be judged rather than trusted.
 */
import { clamp, isNum, round } from '../shared/math.js';
import { exclusionReason } from '../shared/symbols.js';

export const ALTSEASON_LABELS = [
  { min: 75, key: 'ALTSEASON', label: 'sezon de altcoin-uri' },
  { min: 55, key: 'ALT_LEANING', label: 'înclinat spre altcoin-uri' },
  { min: 45, key: 'MIXED', label: 'echilibrat' },
  { min: 25, key: 'BTC_LEANING', label: 'înclinat spre Bitcoin' },
  { min: 0, key: 'BITCOIN_SEASON', label: 'sezon Bitcoin' },
];

export function altseasonLabel(value) {
  if (!isNum(value)) return { key: 'UNKNOWN', label: 'necunoscut' };
  return ALTSEASON_LABELS.find((l) => value >= l.min) ?? ALTSEASON_LABELS[ALTSEASON_LABELS.length - 1];
}

/**
 * @param {any[]} assets  merged universe rows (need market.change.d90 / d30 and a rank)
 * @param {{topN?:number, minCoverage?:number, window?:'d90'|'d30'}} [o]
 * @returns {{value:number|null, label:string, key:string, window:string, compared:number,
 *   beatingBtc:number, btcChangePct:number|null, coverage:number, note:string}}
 */
export function altseasonIndex(assets, { topN = 100, minCoverage = 0.6, window = 'd90' } = {}) {
  const btc = (assets ?? []).find((a) => a.symbol === 'BTC');
  const pickWindow = (w) => {
    const btcChange = btc?.market?.change?.[w];
    if (!isNum(btcChange)) return null;
    const ranked = (assets ?? [])
      .filter((a) => a.symbol !== 'BTC')
      .filter((a) => !exclusionReason({ symbol: a.symbol, name: a.name, tags: a.tags, price: a.market?.price, change7d: a.market?.change?.d7 }))
      .filter((a) => isNum(a.market?.marketCap))
      .sort((x, y) => y.market.marketCap - x.market.marketCap)
      .slice(0, topN);
    const withData = ranked.filter((a) => isNum(a.market?.change?.[w]));
    if (!ranked.length) return null;
    return { btcChange, ranked, withData, w };
  };

  let r = pickWindow(window);
  let fellBack = false;
  if (!r || r.withData.length / Math.max(1, r.ranked.length) < minCoverage) {
    const alt = pickWindow(window === 'd90' ? 'd30' : 'd90');
    if (alt && (!r || alt.withData.length > r.withData.length)) { r = alt; fellBack = true; }
  }

  if (!r || !r.withData.length) {
    return {
      value: null,
      label: 'necunoscut',
      key: 'UNKNOWN',
      window,
      compared: 0,
      beatingBtc: 0,
      btcChangePct: null,
      coverage: 0,
      note: 'indicele nu a putut fi calculat: lipsesc variațiile pe fereastra necesară sau BTC din universul scanat',
    };
  }

  const beating = r.withData.filter((a) => a.market.change[r.w] > r.btcChange).length;
  const value = clamp(round((beating / r.withData.length) * 100, 1), 0, 100);
  const l = altseasonLabel(value);
  const coverage = round(r.withData.length / Math.max(1, r.ranked.length), 2);

  return {
    value,
    label: l.label,
    key: l.key,
    window: r.w === 'd90' ? '90 zile' : '30 zile',
    compared: r.withData.length,
    beatingBtc: beating,
    btcChangePct: round(r.btcChange, 2),
    coverage,
    note: `calculat local: ${beating} din ${r.withData.length} monede din top ${topN} au bătut BTC pe ${r.w === 'd90' ? '90' : '30'} de zile${fellBack ? ' (fereastră de rezervă, acoperire insuficientă pe cea principală)' : ''}. Definiția publică: ≥75% = sezon de altcoin-uri, ≤25% = sezon Bitcoin.`,
  };
}
