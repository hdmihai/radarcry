/**
 * TOP 7 ZILE — top gainers pe 7 zile, filtrați pe calitate și ponderați
 * pe sănătate. Datele vin din `discovery.sevenDayMovers` (Faza 5): pipeline-ul
 * a decis deja sortarea (score desc), filtrele și boost-ul. Acest view doar
 * randează ce e în contract.
 *
 * Deasupra: Potențiali runneri pe următoarele 7 zile (views/runners.js, din data/runners.json).
 *
 * Decizii (Briefing Faza 6 §4):
 *  · fără sortare/filtrare UI în v1 — backend-ul a făcut deja ambele;
 *  · badge health colorat: HEALTHY good, FRAGILE warning, DISTRIBUTION serious, UNKNOWN muted;
 *  · citește doar `snap.discovery.sevenDayMovers` — niciun alt path.
 */
import { html, tip } from '../core/dom.js';
import { pct, usd, frac, num, signClass, DASH } from '../core/format.js';
import { validityBadge } from './widgets.js';
import { runnersMarkup } from './runners.js';

const HEALTH_TONE = {
  HEALTHY: 'good',
  FRAGILE: 'warning',
  DISTRIBUTION: 'serious',
  UNKNOWN: 'muted',
};

const HEALTH_LABEL = {
  HEALTHY: 'sănătos',
  FRAGILE: 'fragil',
  DISTRIBUTION: 'distribuție',
  UNKNOWN: 'necunoscut',
};

function healthBadge(verdict, boost) {
  const tone = HEALTH_TONE[verdict] ?? 'muted';
  const label = HEALTH_LABEL[verdict] ?? verdict ?? 'necunoscut';
  const tipBody = html`<b>${verdict ?? 'UNKNOWN'}</b><br>boost aplicat: ×${boost ?? DASH}`;
  return html`<span class="pill" data-tone="${tone}" data-tip="${tip(tipBody)}">${label}</span>`;
}

export function sevenDayMoversMarkup(snap) {
  return html`${runnersMarkup()}${realizedMarkup(snap)}`;
}

/** Creșterile deja realizate (output-ul `discovery.sevenDayMovers` din scanerul Node). */
export function realizedMarkup(snap) {
  const movers = snap?.discovery?.sevenDayMovers ?? [];
  if (!movers.length) {
    return html`<div class="frame"><p class="muted">Niciun token nu trece filtrele de calitate în această rulare.</p></div>`;
  }
  return html`<div class="frame">
    <h2>Top 7 zile — creșteri realizate, filtrate pe calitate</h2>
    <p class="muted">Cele mai puternice creșteri pe 7 zile, filtrate pe lichiditate,
       turnover și validitate, ponderate după sănătatea mișcării.
       Scor = change7d × ln(volume24h) × boost sănătate.</p>
    <table class="movers">
      <thead><tr>
        <th>#</th><th>Token</th><th>Change 7d</th><th>Volum 24h</th><th>Market cap</th>
        <th>Turnover</th><th>Up vol</th><th>Sănătate</th><th>Validitate</th><th>Scor</th>
      </tr></thead>
      <tbody>
        ${movers.map((m) => html`<tr>
          <td>${m.rank}</td>
          <td>
            <b>${m.symbol ?? DASH}</b>
            <span class="muted">${m.name ?? ''}</span>
            ${m.chain ? html`<br><small class="muted">${m.chain}</small>` : ''}
          </td>
          <td class="${signClass(m.change7d)}">${pct(m.change7d, { dec: 2, sign: true })}</td>
          <td>${usd(m.volume24h, { dec: 0 })}</td>
          <td>${usd(m.marketCap, { dec: 0 })}</td>
          <td>${frac(m.turnover, 3)}</td>
          <td>${frac(m.upVolRatio, 2)}</td>
          <td>${healthBadge(m.healthVerdict, m.healthBoost)}</td>
          <td>${validityBadge({ status: m.validity }, { compact: true })}</td>
          <td>${num(m.score, 2)}</td>
        </tr>`)}
      </tbody>
    </table>
  </div>`;
}
