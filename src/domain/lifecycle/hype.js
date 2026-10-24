/**
 * Hype meter. The whole point of the radar is to be early, so attention is scored as a
 * lifecycle, not as "more is better":
 *  STEALTH   – structure improving, nobody is talking about it yet (best risk/reward)
 *  EMERGING  – attention starts to rise while price has not gone vertical
 *  HYPED     – trending / paid promotion / vertical price: late, FOMO risk
 *  EXHAUSTED – after an expansion, attention fading while price bleeds
 */
import { isNum } from '../shared/math.js';

export const HYPE_LABELS = {
  STEALTH: 'Discret (înainte de hype)',
  EMERGING: 'Atenție în creștere',
  HYPED: 'Hype activ (târziu)',
  EXHAUSTED: 'Epuizat',
  UNKNOWN: 'Necunoscut',
};

/**
 * @param {{cgTrending?:boolean, dexBoost?:number|null, gtTrending?:boolean, change7d?:number|null,
 *          watchlistChangePct?:number|null, rankJump?:number|null, stage?:string, attentionKnown?:boolean}} a
 */
export function hypeState(a) {
  const c7 = a.change7d;
  const trending = a.cgTrending === true || a.gtTrending === true;
  const boosted = isNum(a.dexBoost) && a.dexBoost > 0;
  const reasons = [];
  if (a.stage === 'POST_EXPANSION') {
    reasons.push('după expansiune, preț în retragere');
    return { state: 'EXHAUSTED', reasons };
  }
  if ((trending || boosted) && isNum(c7) && c7 >= 50) {
    if (trending) reasons.push('în trending');
    if (boosted) reasons.push('promovare plătită activă (DexScreener boost)');
    reasons.push(`7z +${c7.toFixed(0)}%`);
    return { state: 'HYPED', reasons };
  }
  if (isNum(c7) && c7 >= 120) {
    reasons.push(`7z +${c7.toFixed(0)}% — mișcare verticală`);
    return { state: 'HYPED', reasons };
  }
  if (trending || boosted || (isNum(a.watchlistChangePct) && a.watchlistChangePct >= 10) || (isNum(a.rankJump) && a.rankJump >= 80)) {
    if (trending) reasons.push('a intrat în trending');
    if (boosted) reasons.push('boost DexScreener');
    if (isNum(a.watchlistChangePct) && a.watchlistChangePct >= 10) reasons.push(`watchlist CoinGecko +${a.watchlistChangePct.toFixed(0)}%`);
    if (isNum(a.rankJump) && a.rankJump >= 80) reasons.push(`salt de ${a.rankJump.toFixed(0)} poziții în clasament`);
    return { state: 'EMERGING', reasons };
  }
  if (a.attentionKnown === false) return { state: 'UNKNOWN', reasons: ['surse de atenție indisponibile'] };
  reasons.push('fără semnale de atenție/hype');
  return { state: 'STEALTH', reasons };
}
