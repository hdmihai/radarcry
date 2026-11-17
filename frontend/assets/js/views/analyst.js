/**
 * „Analiză cantitativă” — the drawer section filled by the optional API (services/analyst-python,
 * through services/api-node). Pure markup: main.js decides when to call it.
 *   state.status: 'loading' | 'ready' | 'error'
 */
import { html } from '../core/dom.js';
import { num, pct } from '../core/format.js';

const BAND_CLASS = { FAVORABIL: 'pos', NEFAVORABIL: 'neg' };
const SERIES = { d1: 'zilnică', h4: '4H', sparkline: 'sparkline' };
const SOURCE = { d1: 'zilnic', h4: 'din 4H', sparkline: 'sparkline' };
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const fixed = (x, d = 2) => (fin(x) ? x.toFixed(d) : '—');

const title = (extra = '') => html`<h3 class="block-title">Analiză cantitativă <span class="muted">Python · Pandas${extra}</span></h3>`;

export function analystMarkup(state) {
  if (!state || state.status === 'off') return '';
  if (state.status === 'loading') return html`<section>${title()}<p class="small muted">Se calculează metricile din serie…</p></section>`;
  if (state.status === 'error') return html`<section>${title()}<p class="small muted">Analistul nu a răspuns: ${state.error ?? 'eroare necunoscută'}. Restul fișei vine din snapshot și rămâne valabil.</p></section>`;

  const a = state.data?.analysis ?? {};
  const m = a.metrics ?? {};
  const v = a.verdict ?? {};
  const r = m.returnPct ?? {};
  const align = a.scoreAlignment;
  const comp = v.components ?? {};
  return html`<section>${title(`, serie ${SERIES[a.seriesUsed] ?? a.seriesUsed ?? '—'}`)}
    <p class="small"><b class="${BAND_CLASS[v.band] ?? ''}">${v.band ?? '—'} · scor cantitativ ${fixed(v.quantScore, 1)}</b>
      <span class="muted">încredere ${fin(v.confidence) ? `${Math.round(v.confidence * 100)}%` : '—'} · tendință ${fixed(comp.trend)} · structură ${fixed(comp.structure)} · participare ${fixed(comp.participation)} · risc ${fixed(comp.risk)}</span></p>
    <div class="sec-grid">
      <dl class="kv"><dt>Randament 7 / 30</dt><dd>${pct(r.p7)} / ${pct(r.p30)}</dd><dt>Volatilitate anualizată</dt><dd>${pct(m.volatilityAnnPct, { sign: false, dec: 0 })}</dd><dt>Sharpe / Sortino</dt><dd>${fixed(m.sharpe)} / ${fixed(m.sortino)}</dd><dt>VaR / CVaR 95%</dt><dd>${pct(m.var95Pct)} / ${pct(m.cvar95Pct)}</dd></dl>
      <dl class="kv"><dt>Drawdown maxim / curent</dt><dd>${pct(m.maxDrawdownPct, { dec: 0 })} / ${pct(m.currentDrawdownPct, { dec: 0 })}</dd><dt>Tendință (R²)</dt><dd>${pct(m.slopePctPerPeriod, { dec: 2 })}/perioadă (${fixed(m.r2)})</dd><dt>RSI 14 / Hurst</dt><dd>${num(m.rsi14)} / ${fixed(m.hurst)}</dd><dt>Comprimare Bollinger</dt><dd>${fin(m.bandwidthPercentile) ? `percentila ${Math.round(m.bandwidthPercentile)}` : '—'}</dd></dl>
      <dl class="kv"><dt>Volum (z robust)</dt><dd>${fixed(m.volumeZ, 1)}${m.volumeSource ? html` <span class="muted">${SOURCE[m.volumeSource] ?? m.volumeSource}</span>` : ''}</dd><dt>OBV</dt><dd>${fin(m.obvSlope) ? (m.obvSlope > 0 ? 'în creștere' : 'în scădere') : '—'}</dd><dt>ATR 14</dt><dd>${pct(m.atrPct14, { sign: false })}</dd><dt>Scor CRI ↔ preț</dt><dd>${align ? `ρ ${fixed(align.spearman)}, ${align.reading}` : '—'}</dd></dl>
    </div>
    ${v.signals?.length ? html`<p class="small" style="margin-top:8px">Semnale: ${v.signals.join('; ')}</p>` : ''}
    ${v.flags?.length ? html`<p class="small" style="margin-top:4px">Atenție: ${v.flags.join('; ')}</p>` : ''}
    <p class="xs muted" style="margin-top:6px">${v.note ?? ''}${state.data?.cached ? ' Rezultat din cache pentru acest snapshot.' : ''}</p>
  </section>`;
}
