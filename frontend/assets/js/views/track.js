/** Forward track record of BUY_SETUP / ACCUMULATE signals, with Wilson intervals. */
import { html } from '../core/dom.js';
import { dateTime, pct, price, score } from '../core/format.js';
import { L } from '../core/labels.js';
import { wilsonChart } from '../charts/ci.js';
import { refChip } from './widgets.js';

export function trackMarkup(s) {
  const tr = s.trackRecord ?? {};
  const sum = tr.summary ?? {};
  const types = ['BUY_SETUP', 'ACCUMULATE'];
  const chart = wilsonChart(sum.byType, types, L.signals);
  const recent = tr.recent ?? [];
  const thr = sum.hitThresholdPct ?? 25;
  return html`
  <div class="view-head"><div><h2 class="view-title">Track record</h2>
    <p class="view-lede">Fiecare Setup BUY și Acumulare este înregistrat la prețul din momentul semnalului și urmărit înainte (forward), fără backfill. Un semnal e „reușit” dacă atinge +${thr}% (maximul favorabil, MFE) în orizontul dat. Intervalul Wilson 95% arată cât de sigură e rata la eșantionul actual.</p></div></div>
  ${sum.sampleWarning ? html`<div class="notice" data-kind="stale" style="border:1px solid var(--line);border-radius:var(--r-md);margin-bottom:16px"><div class="frame" style="padding:10px 12px"><p>${sum.sampleWarning}</p></div></div>` : ''}
  <div class="cols-2">
    <section class="panel">${chart ?? html`<div class="empty"><strong>Încă nu există semnale urmărite.</strong>Track record-ul se construiește din rulările programate; primele rezultate apar după 7 zile.</div>`}</section>
    <section>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tip</th><th class="n">Total</th><th class="n">Deschise</th><th class="n">Randament mediu 7z</th><th class="n">Randament mediu 30z</th></tr></thead><tbody>
        ${types.map((t) => {
          const x = sum.byType?.[t] ?? {};
          const h7 = (x.horizons ?? []).find((h) => h.days === 7) ?? {};
          const h30 = (x.horizons ?? []).find((h) => h.days === 30) ?? {};
          return html`<tr><td>${L.signals[t] ?? t}</td><td class="n">${x.total ?? 0}</td><td class="n">${x.open ?? 0}</td><td class="n">${pct(h7.meanReturnPct)}</td><td class="n">${pct(h30.meanReturnPct)}</td></tr>`;
        })}
      </tbody></table></div>
      <p class="small ink2" style="margin-top:12px">Reguli: același token nu este reînregistrat 14 zile după un semnal (cooldown); rezultatele pe orizont se îngheață după expirarea orizontului; păstrare 180 de zile.</p>
    </section>
  </div>
  <section class="section"><h3 class="section-title">Semnale recente</h3>
    ${recent.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Token</th><th>Tip</th><th class="n">Data</th><th class="n">Preț semnal</th><th class="n">Ultimul preț</th><th class="n">Randament</th><th class="n">Max / min</th><th>Analog</th><th class="n">CRI</th><th>Rezultate 7/14/30z</th></tr></thead><tbody>
      ${recent.map((e) => html`<tr data-open="${e.key}"><td><button class="tok-btn" type="button" data-open="${e.key}">${e.symbol}</button></td><td>${L.signals[e.type] ?? e.type}</td><td class="n">${dateTime(e.at)}</td><td class="n">${price(e.entryPrice)}</td><td class="n">${price(e.lastPrice)}</td><td class="n ${e.returnPct > 0 ? 'pos' : e.returnPct < 0 ? 'neg' : ''}">${pct(e.returnPct)}</td><td class="n"><span class="pos">${pct(e.maxPct)}</span> / <span class="neg">${pct(e.minPct)}</span></td><td>${refChip(e.analog)}</td><td class="n">${score(e.cri)}</td><td>${[7, 14, 30].map((d) => {
        const o = e.outcomes?.[`d${d}`];
        if (!o) return html`<span class="pill">${d}z deschis</span> `;
        return html`<span class="pill" data-tone="${o.hit ? 'good' : 'serious'}">${d}z ${o.hit ? 'reușit' : 'ratat'}</span> `;
      })}</td></tr>`)}
    </tbody></table></div>` : html`<p class="small muted">Niciun semnal înregistrat încă.</p>`}
  </section>`;
}
