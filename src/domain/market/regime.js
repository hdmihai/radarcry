/**
 * Market regime for small caps: risk appetite gates how aggressive the signals may be.
 * Inputs: CoinGecko global, CMC Fear & Greed + Altcoin Season Index, and universe breadth.
 */
import { clamp, isNum, median, round } from '../shared/math.js';

export function universeBreadth(assets) {
  const small = assets.filter((a) => isNum(a.market.marketCap) && a.market.marketCap < 500_000_000);
  const c7 = small.map((a) => a.market.change.d7).filter(isNum);
  const c30 = small.map((a) => a.market.change.d30).filter(isNum);
  const btc = assets.find((a) => a.ids.coingecko === 'bitcoin' || a.symbol === 'BTC');
  return {
    sample: small.length,
    upShare7d: c7.length ? round((c7.filter((x) => x > 0).length / c7.length) * 100, 1) : null,
    medianSmallCap7dPct: round(median(c7), 2),
    medianSmallCap30dPct: round(median(c30), 2),
    btc7dPct: round(btc?.market.change.d7 ?? null, 2),
    btc30dPct: round(btc?.market.change.d30 ?? null, 2),
  };
}

export function marketRegime({ global = null, fearGreed = null, altseason = null, breadth }) {
  const parts = [];
  const drivers = [];
  if (isNum(breadth?.upShare7d)) {
    parts.push({ v: clamp(breadth.upShare7d), w: 0.35 });
    drivers.push(`${breadth.upShare7d.toFixed(0)}% din small caps sunt pe plus pe 7z`);
  }
  if (isNum(breadth?.medianSmallCap7dPct) && isNum(breadth?.btc7dPct)) {
    const rel = breadth.medianSmallCap7dPct - breadth.btc7dPct;
    parts.push({ v: clamp(50 + rel * 4), w: 0.25 });
    drivers.push(`small caps vs BTC (7z): ${rel >= 0 ? '+' : ''}${rel.toFixed(1)} pp`);
  }
  if (isNum(fearGreed?.value)) {
    parts.push({ v: clamp(fearGreed.value), w: 0.2 });
    drivers.push(`Fear & Greed ${fearGreed.value} (${fearGreed.label ?? '—'})`);
  }
  if (isNum(altseason?.value)) {
    parts.push({ v: clamp(altseason.value), w: 0.2 });
    drivers.push(`Altcoin Season Index ${altseason.value}`);
  }
  if (isNum(global?.change24hPct)) drivers.push(`capitalizare totală 24h ${global.change24hPct >= 0 ? '+' : ''}${global.change24hPct.toFixed(2)}%`);
  if (!parts.length) return { label: 'UNKNOWN', score: null, drivers: ['date de regim indisponibile'] };
  const score = parts.reduce((s, p) => s + p.v * p.w, 0) / parts.reduce((s, p) => s + p.w, 0);
  const label = score >= 58 ? 'RISK_ON' : score <= 40 ? 'RISK_OFF' : 'NEUTRAL';
  return { label, score: round(score, 1), drivers };
}

/** Narrative / sector board from CoinGecko categories, annotated with our candidate counts. */
export function narrativeBoard(categories, candidates, assetsByCg) {
  if (!categories?.length) return [];
  const counts = new Map();
  for (const c of candidates) for (const cat of c.categories ?? []) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  return categories
    .filter((c) => isNum(c.marketCap) && c.marketCap > 50_000_000 && isNum(c.change24hPct))
    .sort((a, b) => b.change24hPct - a.change24hPct)
    .slice(0, 40)
    .map((c) => ({
      id: c.id,
      name: c.name,
      change24hPct: round(c.change24hPct, 2),
      marketCap: c.marketCap,
      volume24h: c.volume24h,
      candidates: counts.get(c.name) ?? 0,
      topCoins: (c.topCoins ?? []).map((id) => assetsByCg.get(id)?.symbol ?? id).slice(0, 3),
    }));
}
