/**
 * LIQUIDATION MAP (modelled, not bought).
 *
 * Commercial dashboards sell a liquidation heatmap built from order-level data. That data is behind
 * a subscription, so this module *models* the same object from inputs we can read for free:
 * open interest, the funding sign (which side is paying, therefore which side is crowded) and the
 * recent price range. The output is explicitly labelled as modelled, with the assumptions written
 * next to it — a researcher can then judge it instead of trusting it.
 *
 * Method: liquidation price for leverage L is entry·(1 − 1/L) for a long and entry·(1 + 1/L) for a
 * short. Entries are assumed to be distributed over the recent range (traders entered where price
 * traded), weighted by how much time price spent at each level, and split across the retail leverage
 * ladder. Clusters are the levels where the modelled notional stacks up.
 */
import { clamp, isNum, round } from '../shared/math.js';
import { FUNDING_STATE } from './positioning.js';

/** Retail leverage ladder with the share of open interest usually sitting at each rung. */
export const LEVERAGE_LADDER = [
  { lev: 50, share: 0.1 },
  { lev: 25, share: 0.2 },
  { lev: 20, share: 0.2 },
  { lev: 10, share: 0.3 },
  { lev: 5, share: 0.2 },
];

/**
 * @param {{candles:{h:number,l:number,c:number,v:number|null}[], oiUsd:number|null, funding:string,
 *          price:number, lookback?:number, buckets?:number}} input
 * @returns {null|{modelled:true, assumptions:string[], longShare:number, shortShare:number,
 *   clusters:{price:number, side:'LONG'|'SHORT', notionalUsd:number, distancePct:number, leverage:number[]}[],
 *   magnetBelow:any|null, magnetAbove:any|null, note:string}}
 */
export function liquidationMap({ candles, oiUsd, funding, price, lookback = 120, buckets = 40 }) {
  if (!Array.isArray(candles) || candles.length < 20 || !isNum(price) || price <= 0) return null;
  const win = candles.slice(-lookback);
  const hi = Math.max(...win.map((k) => k.h));
  const lo = Math.min(...win.map((k) => k.l));
  if (!(hi > lo)) return null;

  // Where did price actually trade? Time-at-level is the best free proxy for where entries sit.
  const step = (hi - lo) / buckets;
  const weight = new Array(buckets).fill(0);
  for (const k of win) {
    const from = clamp(Math.floor((k.l - lo) / step), 0, buckets - 1);
    const to = clamp(Math.floor((k.h - lo) / step), 0, buckets - 1);
    const span = to - from + 1;
    const w = isNum(k.v) && k.v > 0 ? k.v : 1;
    for (let i = from; i <= to; i += 1) weight[i] += w / span;
  }
  const wSum = weight.reduce((s, x) => s + x, 0) || 1;

  // Which side is crowded? Funding is the honest, free answer.
  let longShare = 0.5;
  if (funding === FUNDING_STATE.DANGER) longShare = 0.8;
  else if (funding === FUNDING_STATE.CROWDED_LONGS) longShare = 0.68;
  else if (funding === FUNDING_STATE.HEALTHY) longShare = 0.57;
  else if (funding === FUNDING_STATE.CROWDED_SHORTS) longShare = 0.32;
  const shortShare = 1 - longShare;

  const notional = isNum(oiUsd) && oiUsd > 0 ? oiUsd : null;
  /** @type {Map<number, {price:number, side:string, notionalUsd:number, leverage:Set<number>}>} */
  const acc = new Map();
  const add = (p, side, amount, lev) => {
    if (!isNum(p) || p <= 0 || amount <= 0) return;
    // Bucket clusters on a 0.5 % price grid so nearby liquidations merge into one readable level.
    const keyPrice = round(p / (1 + 0.005 * Math.round(Math.log(p / price) / Math.log(1.005))), 10);
    const key = `${side}:${Math.round(Math.log(p) / Math.log(1.005))}`;
    const cur = acc.get(key) ?? { price: keyPrice, side, notionalUsd: 0, leverage: new Set() };
    cur.notionalUsd += amount;
    cur.leverage.add(lev);
    cur.price = p;
    acc.set(key, cur);
  };

  for (let i = 0; i < buckets; i += 1) {
    const entry = lo + step * (i + 0.5);
    const share = weight[i] / wSum;
    if (share <= 0) continue;
    for (const { lev, share: lShare } of LEVERAGE_LADDER) {
      const longNotional = (notional ?? 100) * longShare * share * lShare;
      const shortNotional = (notional ?? 100) * shortShare * share * lShare;
      // Maintenance margin trims the real liquidation a touch above the naive 1/L level.
      const liqLong = entry * (1 - 1 / lev + 0.004);
      const liqShort = entry * (1 + 1 / lev - 0.004);
      if (liqLong < price) add(liqLong, 'LONG', longNotional, lev);
      if (liqShort > price) add(liqShort, 'SHORT', shortNotional, lev);
    }
  }

  const clusters = [...acc.values()]
    .map((c) => ({
      price: round(c.price, 8),
      side: c.side,
      notionalUsd: notional ? Math.round(c.notionalUsd) : null,
      weight: round(c.notionalUsd / ((notional ?? 100) || 1), 4),
      distancePct: round((c.price / price - 1) * 100, 2),
      leverage: [...c.leverage].sort((a, b) => a - b),
    }))
    .filter((c) => Math.abs(c.distancePct) <= 35)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12);

  const below = clusters.filter((c) => c.distancePct < 0).sort((a, b) => b.weight - a.weight)[0] ?? null;
  const above = clusters.filter((c) => c.distancePct > 0).sort((a, b) => b.weight - a.weight)[0] ?? null;

  return {
    modelled: true,
    assumptions: [
      'intrările sunt distribuite pe intervalul recent, ponderate cu volumul tranzacționat la fiecare nivel',
      'scara de levier presupusă: 50x 10%, 25x 20%, 20x 20%, 10x 30%, 5x 20%',
      `partea aglomerată este dedusă din funding (${Math.round(longShare * 100)}% long / ${Math.round(shortShare * 100)}% short)`,
      notional ? 'nominalul este scalat la open interest-ul agregat raportat de burse' : 'open interest necunoscut — nominalele sunt relative, nu în dolari',
    ],
    longShare: round(longShare, 2),
    shortShare: round(shortShare, 2),
    clusters,
    magnetBelow: below,
    magnetAbove: above,
    note: 'Hartă modelată din OI + funding + interval, nu date de ordine. Comercial, acest obiect vine din API-uri cu abonament; aici este reconstruit din surse gratuite și marcat ca estimare.',
  };
}
