/**
 * PROGNOZĂ — how likely is each project to rise at least 100× (and 20×) within twelve months, and
 * the learning list the estimate stands on: the projects that did it in the last year (LAB, BTW,
 * IRYS and every project like them), confirmed from daily history and measured at their low.
 *
 * Nothing is computed here: base rates, the list and every probability come from the engine.
 */
import { html, tip } from '../core/dom.js';
import { date, num, price, usd } from '../core/format.js';
import { icon } from '../core/labels.js';
import { forecastPill, forecastText } from './widgets.js';

export const forecastState = { show: 'top' };

const STATUS_TONE = { CONFIRMED: 'good', DOCUMENTED: 'muted', PENDING: 'muted', BELOW: 'serious' };
const CHAIN = { bsc: 'BNB Chain', solana: 'Solana', base: 'Base', ethereum: 'Ethereum', arbitrum: 'Arbitrum' };
const pctText = (x, d = 2) => (Number.isFinite(x) ? `${x.toFixed(d)}%` : '—');
const when = (s) => (typeof s === 'string' && s.length > 7 ? date(s) : s ?? '—');

function rateTile(r) {
  return html`<div class="qstat"><b class="num">${pctText(r.pct)}</b><span>rata de bază ≥${r.multiple}×</span>
    <small class="muted">${num(r.events)} câștigători din ${num(r.population)} proiecte urmărite · interval 90%: ${pctText(r.lo)}–${pctText(r.hi)}</small></div>`;
}

function winnerRow(w) {
  return html`<tr>
    <td><span class="tok"><span>${w.symbol}</span><span class="tok-sub">${w.name}${w.chain ? `, ${CHAIN[w.chain] ?? w.chain}` : ''}</span></span></td>
    <td class="n"><span class="tok"><span>${Number.isFinite(w.multiple) ? `${num(w.multiple, w.multiple < 100 ? 1 : 0)}×` : '—'}</span><span class="tok-sub">${Number.isFinite(w.days) ? `${w.days} zile` : ''}</span></span></td>
    <td class="n"><span class="tok"><span>$${price(w.low?.price)}</span><span class="tok-sub">${when(w.low?.at)}</span></span></td>
    <td class="n"><span class="tok"><span>$${price(w.peak?.price)}</span><span class="tok-sub">${when(w.peak?.at)}</span></span></td>
    <td class="n ${Number.isFinite(w.drawdownNowPct) && w.drawdownNowPct <= -80 ? 'neg' : ''}">${Number.isFinite(w.drawdownNowPct) ? `${w.drawdownNowPct.toFixed(0)}%` : '—'}</td>
    <td><span class="pill" data-tone="${STATUS_TONE[w.status] ?? 'muted'}" data-tip="${tip(w.note ?? w.statusLabel)}">${w.statusLabel}</span></td>
    <td class="xs">${(w.sources ?? []).map((s) => (s.url ? html`<a href="${s.url}" target="_blank" rel="noopener" data-tip="${tip(s.title)}">${icon('external', 11)}</a> ` : ''))}</td>
  </tr>`;
}

function topRow(t) {
  const near = (t.nearest ?? [])[0];
  return html`<tr>
    <td><span class="tok"><span><button class="tok-btn" type="button" data-open="${t.key}">${t.symbol}</button></span><span class="tok-sub">${t.name}</span></span></td>
    <td class="n">${usd(t.marketCap)}</td>
    <td>${forecastPill(t)}</td>
    <td class="n xs">${forecastText(t.targets?.['100'])}</td>
    <td class="n">${forecastText(t.targets?.['20'])}</td>
    <td class="xs">${near ? html`${near.symbol} ${near.multiple}× · ${near.similarity}%` : html`<span class="muted">—</span>`}${t.pastRun ? html`<br><span class="muted">a făcut deja ${t.pastRun.multiple}×</span>` : ''}</td>
  </tr>`;
}

export function forecastMarkup(s) {
  const f = s.forecast ?? null;
  const head = html`
    <div class="view-head"><div>
      <h2 class="view-title">Prognoză ≥100× în 12 luni</h2>
      <p class="view-lede">Pentru fiecare proiect verificat: probabilitatea unei creșteri de cel puțin 100× (și de 20×, clasa LAB / BTW / IRYS) în următoarele 12 luni. Pornește de la rata de bază — câte proiecte mici au făcut asta în ultimul an — și o ajustează după cât de mult seamănă proiectul azi cu câștigătorii la minimul lor, măsurați strict înainte de mișcare. Este o estimare statistică a unui eveniment rar: chiar și cea mai mare probabilitate rămâne mică. Nu este o predicție și nu este un sfat financiar.</p>
    </div></div>`;
  if (!f) return html`${head}<div class="empty"><strong>Acest snapshot nu are încă prognoza.</strong><p>Se publică de la prima scanare completă cu modulul de prognoză.</p></div>`;
  const confirmed = f.winners.filter((w) => w.status === 'CONFIRMED').length;
  const documented = f.winners.filter((w) => w.status === 'DOCUMENTED').length;
  const pending = f.winners.filter((w) => w.status === 'PENDING').length;
  const listed = f.winners.filter((w) => w.status !== 'BELOW');
  const below = f.winners.filter((w) => w.status === 'BELOW');
  const sep = f.model?.separation ?? {};
  return html`${head}
    <div class="qbar">
      ${(f.baseRates ?? []).map(rateTile)}
      <div class="qstat"><b class="num">${num(confirmed)}</b><span>câștigători confirmați</span><small class="muted">din istoricul zilnic · ${num(documented)} documentați din surse · ${num(pending)} în verificare</small></div>
      <div class="qstat" data-tone="warning"><b class="num">${f.roundTrip ? `${f.roundTrip.medianDrawdownPct.toFixed(0)}%` : '—'}</b><span>de la vârf, azi (mediana)</span><small class="muted">cât au păstrat câștigătorii: majoritatea au pierdut aproape tot după vârf</small></div>
    </div>

    <section class="section">
      <h3 class="section-title">Cele mai mari probabilități acum <span class="muted xs">(doar proiecte verificate)</span></h3>
      ${(f.top ?? []).length ? html`<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Proiect</th><th class="n">Capitalizare</th><th>≥100×</th><th class="n">≥100× (interval 90%)</th><th class="n">≥20× (interval 90%)</th><th>Cel mai apropiat câștigător</th></tr></thead>
        <tbody>${f.top.map(topRow)}</tbody>
      </table></div>` : html`<div class="empty"><strong>Nicio prognoză publicată în această rulare.</strong></div>`}
      <p class="panel-note">Intervalul combină incertitudinea ratei de bază cu cât se schimbă estimarea când oricare dintre câștigători lipsește din listă. ×N înseamnă de câte ori peste rata de bază.</p>
    </section>

    <section class="section">
      <h3 class="section-title">Lista de învățare: câștigătorii ultimelor ${Math.round((f.windowDays ?? 365) / 30)} luni</h3>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Proiect</th><th class="n">Multiplu</th><th class="n">Minim</th><th class="n">Vârf</th><th class="n">Azi față de vârf</th><th>Stare</th><th>Surse</th></tr></thead>
        <tbody>${listed.map(winnerRow)}</tbody>
      </table></div>
      <p class="panel-note">${icon('info', 12)} Lista pornește de la proiectele documentate din surse publice (LAB, BTW, IRYS, AKEDO, pippin…) și se completează automat la fiecare scanare din minimele și maximele istorice ale întregii piețe. Fiecare intrare este confirmată din istoricul zilnic CoinGecko — pe mediana a trei zile, cu prag de capitalizare și volum la minim, ca un tick izolat să nu poată inventa o mișcare — iar amprenta proiectului se măsoară la minim, fără nicio dată de după.</p>
      ${below.length ? html`<details class="confirms"><summary>Infirmate de istoricul zilnic (${below.length})</summary>
        <div class="tbl-wrap"><table class="tbl"><tbody>${below.map(winnerRow)}</tbody></table></div></details>` : ''}
      ${(f.excluded ?? []).length ? html`<details class="confirms"><summary>Excluse și de ce (${f.excluded.length})</summary>
        <ul>${f.excluded.map((e) => html`<li><b>${e.symbol}</b> — ${e.reason}${e.url ? html` <a href="${e.url}" target="_blank" rel="noopener">${icon('external', 11)}</a>` : ''}</li>`)}</ul></details>` : ''}
    </section>

    <section class="section">
      <h3 class="section-title">Cum se calculează</h3>
      <ul class="facts">
        <li><span><b>Rata de bază.</b> Câștigătorii ≥N× ai ultimului an împărțiți la proiectele mici urmărite de radar, cu o estimare prudentă la pornire (${f.model?.prior?.pct ?? '—'}% pe an, cântărită ca ${num(f.model?.prior?.weight)} de proiecte), ca un istoric scurt să nu o umfle. Lista agregatorilor conține doar supraviețuitori, deci partea din date este o limită superioară.</span></li>
        <li><span><b>Ajustarea.</b> Raportul dintre cât de dens stau câștigătorii la minimul lor în jurul proiectului și cât de dens stă întregul univers (${num(f.model?.background)} proiecte) — pe aceleași 15 trăsături ca analogii LAB/BTW/AGT, cu trăsăturile necunoscute omise, nu tratate ca rele. Cu puțini câștigători, ajustarea este trasă spre 1 (k = ${f.model?.shrinkK}) și limitată la ×${f.model?.lrClamp}.</span></li>
        <li><span><b>Puterea de separare</b> (pe datele de învățare, deci optimistă): câștigătorii primesc la minimul lor în medie ${sep['100'] ? `×${sep['100'].medianLift}` : '—'} pentru ≥100× și ${sep['20'] ? `×${sep['20'].medianLift}` : '—'} pentru ≥20×. O valoare apropiată de 1 spune că trăsăturile disponibile nu deosebesc încă bine câștigătorii — și atunci prognoza rămâne aproape de rata de bază, ceea ce este răspunsul corect.</span></li>
        <li><span><b>Ce urmează.</b> Agentul AI înregistrează prognozele și le compară cu ce s-a întâmplat efectiv, ca să măsoare calibrarea pe măsură ce trec lunile (ecranul <a href="#/agent">Agent AI</a>).</span></li>
      </ul>
      <p class="panel-note">${f.note}</p>
    </section>`;
}

export function bindForecast() {}
