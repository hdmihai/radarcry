/** Catalysts feed + watchlist alerts and stage transitions. */
import { html } from '../core/dom.js';
import { ago, date, dateTime, score } from '../core/format.js';
import { DIRECTION, L, POLARITY, SEVERITY, sourceLabel } from '../core/labels.js';
import { ui } from '../core/store.js';
import { polarity, statusLine } from './widgets.js';

const ALERT_TONE = { URGENT: 'critical', IMPORTANT: 'warning', INFO: 'muted' };
const ALERT_WORD = { URGENT: 'urgent', IMPORTANT: 'important', INFO: 'informativ' };

/**
 * The v4 alert feed: state *transitions* rather than levels, so a token entering the candidate set
 * or a treasury starting to deposit to an exchange is what reaches the top of the list.
 */
function alerts(s) {
  const list = s.alerts?.items ?? [];
  if (!list.length) {
    return html`<div class="empty"><strong>Nicio alertă în această rulare.</strong>
      <p>Alertele se declanșează pe tranziții, nu pe niveluri: un candidat timpuriu nou, o confluență care trece pragul fără ca prețul să se fi mișcat, acumulare confirmată on-chain, un risc critic apărut, trezoreria care începe să depună pe burse, sau o notă de futures care ajunge la A.</p></div>`;
  }
  return html`<ul class="feed">${list.slice(0, 60).map((a) => html`<li>
    <span class="when">${dateTime(a.at)}</span>
    <span class="what">${a.symbol ? html`<button class="tok-btn" type="button" data-open="${a.key}">${a.symbol}</button> ` : ''}<b>${a.title}</b>${a.detail ? html`<p>${a.detail}</p>` : ''}</span>
    <span class="meta">${statusLine(ALERT_TONE[a.level] ?? 'muted', ALERT_WORD[a.level] ?? a.level, { size: 12 })}</span>
  </li>`)}</ul>`;
}

function legacyAlerts(s) {
  const list = s.watchlist?.alerts ?? [];
  if (!list.length) return html`<p class="small muted">Nicio tranziție de semnal din motorul de similaritate.</p>`;
  return html`<ul class="feed">${list.slice(0, 24).map((a) => html`<li>
    <span class="when">${dateTime(a.at)}</span>
    <span class="what"><button class="tok-btn" type="button" data-open="${a.key}">${a.symbol}</button><p>${a.reason}</p></span>
    <span class="meta">${statusLine(SEVERITY[a.severity]?.tone ?? 'muted', SEVERITY[a.severity]?.label ?? a.severity, { size: 12 })}<br>CRI ${score(a.cri)}</span>
  </li>`)}</ul>`;
}

function transitions(s) {
  const list = s.watchlist?.transitions ?? [];
  if (!list.length) return html`<p class="small muted">Nicio tranziție de stadiu de la rularea anterioară.</p>`;
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Token</th><th>Din</th><th>În</th><th>Direcție</th><th class="n">CRI</th><th class="n">Când</th></tr></thead><tbody>
    ${list.slice(0, 60).map((t) => html`<tr data-open="${t.key}"><td><button class="tok-btn" type="button" data-open="${t.key}">${t.symbol}</button></td><td class="ink2">${L.stages[t.from] ?? t.from ?? '—'}</td><td>${L.stages[t.to] ?? t.to}</td><td>${statusLine(t.direction === 'ADVANCE' ? 'good' : t.direction === 'RETREAT' ? 'warning' : 'muted', DIRECTION[t.direction] ?? t.direction, { size: 12 })}</td><td class="n">${score(t.cri)}</td><td class="n muted">${ago(t.at)}</td></tr>`)}
  </tbody></table></div>`;
}

export function catalystsMarkup(s) {
  const f = ui.catalystFilter;
  const all = s.catalysts ?? [];
  const types = [...new Set(all.map((e) => e.type))];
  const list = all.filter((e) => (f.polarity === 'ALL' || e.polarity === f.polarity) && (f.type === 'ALL' || e.type === f.type));
  const upcoming = all.filter((e) => e.eventTime && Date.parse(e.eventTime) > s.generatedMs).sort((a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime));
  return html`
  <div class="view-head"><div><h2 class="view-title">Alerte și catalizatori</h2>
    <p class="view-lede">Ce s-a schimbat între rulări: candidați timpurii noi, confluențe care trec pragul, acumulare confirmată, riscuri critice apărute, listări noi (perpetual, Binance spot, MEXC, Upbit/Bithumb, Alpha), salturi de rang, explozii de volum și open interest, plus evenimente programate din config/catalysts.json. Prima rulare doar înregistrează starea de bază.</p></div>
    <div class="muted small">${(s.alerts?.counts?.urgent ?? 0)} urgente · ${(s.alerts?.counts?.important ?? 0)} importante · ${(s.alerts?.counts?.info ?? 0)} informative</div></div>
  <div class="cols-2">
    <section><h3 class="section-title">Alerte</h3>${alerts(s)}</section>
    <section>
      <h3 class="section-title">Flux catalizatori <span class="muted small">(${list.length} din ${all.length}, ultimele 7 zile)</span></h3>
      <div class="filters" style="padding-top:0">
        <div class="seg" role="group" aria-label="Polaritate">
          ${['ALL', 'POSITIVE', 'NEGATIVE', 'NEUTRAL'].map((p) => html`<button type="button" data-cpol="${p}" aria-pressed="${f.polarity === p}">${p === 'ALL' ? 'Toate' : POLARITY[p].label}</button>`)}
        </div>
        <select class="select" data-ctype aria-label="Tip catalizator">
          <option value="ALL">Toate tipurile</option>
          ${types.map((t) => html`<option value="${t}" ${f.type === t ? 'selected' : ''}>${L.catalysts[t] ?? t}</option>`)}
        </select>
      </div>
      ${upcoming.length ? html`<div class="panel" style="margin-bottom:12px"><div class="small muted" style="margin-bottom:6px">Programate</div>${upcoming.map((e) => html`<div class="small" style="display:flex;gap:10px;justify-content:space-between;padding:3px 0"><span>${polarity(e.polarity)} <b>${e.symbol}</b> ${e.title}</span><span class="muted">${date(e.eventTime)}</span></div>`)}</div>` : ''}
      ${list.length ? html`<ul class="feed">${list.slice(0, 80).map((e) => html`<li>
        <span class="when">${dateTime(e.eventTime ?? e.observedAt)}</span>
        <span class="what">${polarity(e.polarity)} <button class="tok-btn" type="button" data-open="${e.assetKey}">${e.symbol}</button> <b>${e.title}</b><p>${(L.catalysts[e.type] ?? e.type) !== e.title ? `${L.catalysts[e.type] ?? e.type}, ` : ''}sursă: ${sourceLabel(e.source)}</p></span>
        <span class="meta">${POLARITY[e.polarity]?.label ?? ''}<br>încredere ${Math.round((e.confidence ?? 0) * 100)}%</span>
      </li>`)}</ul>` : html`<div class="empty"><strong>Niciun catalizator pentru filtrul ales.</strong>Alege „Toate” sau alt tip.</div>`}
    </section>
  </div>
  <section class="section"><h3 class="section-title">Tranziții de stadiu</h3>${transitions(s)}</section>
  <section class="section"><h3 class="section-title">Alerte din motorul de similaritate (LAB/BTW/AGT)</h3>${legacyAlerts(s)}</section>`;
}

export function bindCatalysts(root, rerender) {
  root.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-cpol]') : null;
    if (b) {
      ui.catalystFilter.polarity = b.dataset.cpol;
      rerender();
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target?.matches?.('[data-ctype]')) {
      ui.catalystFilter.type = e.target.value;
      rerender();
    }
  });
}
