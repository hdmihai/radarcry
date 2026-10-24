/**
 * PARITY AND FREE-PLAN BUDGETS.
 *
 * Two claims this project makes about itself are checked on this screen rather than asserted:
 *   1. it reproduces a commercial research desk at a stated percentage — shown as a weighted
 *      capability matrix, with the gaps named instead of hidden;
 *   2. it runs with no subscription of any kind — shown as the live consumption of every free plan,
 *      in that plan's own units, with the 95 % pause threshold visible.
 */
import { html, tip } from '../core/dom.js';
import { num, score } from '../core/format.js';
import { icon } from '../core/labels.js';

const STATUS_TONE = {
  FREE_API: 'good',
  FREE_DERIVED: 'good',
  FREE_LINK: 'warning',
  OPTIONAL_KEY: 'warning',
  NOT_COVERED: 'serious',
};

const STATUS_SHORT = {
  FREE_API: 'API gratuit',
  FREE_DERIVED: 'reconstruit',
  FREE_LINK: 'link gratuit',
  OPTIONAL_KEY: 'cheie opțională',
  NOT_COVERED: 'neacoperit',
};

function bar(value, tone) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return html`<span class="pbar" data-tone="${tone}"><i style="width:${v}%"></i></span>`;
}

export function parityMarkup(s) {
  const p = s.parity ?? {};
  const q = s.quota ?? null;
  const caps = p.capabilities ?? [];
  const byStatus = p.byStatus ?? {};

  return html`
    <div class="view-head">
      <h2 class="view-title">Paritate și bugete gratuite</h2>
      <p class="view-lede">Cât din ce oferă un birou de research comercial este reprodus aici, și cu ce cost. Costul este zero: fiecare sursă este publică sau are cont gratuit, iar cheile opționale sunt gratuite ori de trial. Capabilitățile neacoperite sunt listate, nu ascunse.</p>
    </div>

    <div class="qbar">
      <div class="qstat" data-tone="good">
        <b class="num">${score(p.permanent)}%</b><span>permanent</span>
        <small class="muted">doar ce funcționează fără nicio cheie care poate expira</small>
      </div>
      <div class="qstat">
        <b class="num">${score(p.withKeys)}%</b><span>cu cheile gratuite opționale</span>
        <small class="muted">inclusiv sloturile de cheie configurate de operator</small>
      </div>
      <div class="qstat" data-tone="${(p.achieved ?? 0) >= 85 ? 'good' : 'warning'}">
        <b class="num">${score(p.achieved)}%</b><span>atins în această rulare</span>
        <small class="muted">o sursă care nu a răspuns scade acest număr, nu pe celelalte două</small>
      </div>
      <div class="qstat">
        <b class="num">${caps.length}</b><span>capabilități evaluate</span>
        <small class="muted">${Object.entries(byStatus).map(([k, v]) => `${STATUS_SHORT[k] ?? k}: ${v}`).join(' · ')}</small>
      </div>
    </div>

    <section class="section">
      <h3 class="section-title">Matricea de capabilități</h3>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Capabilitate</th><th class="num">Pondere</th><th>Stare</th><th>Cum este acoperită</th></tr></thead>
        <tbody>${caps.map((c) => html`<tr>
          <td><b>${c.label}</b>${c.live === false ? html` <span class="pill" data-tone="warning" data-tip="${tip('Sursa acestei capabilități nu a răspuns în rularea curentă; paritatea atinsă este redusă corespunzător.')}">indisponibil acum</span>` : ''}</td>
          <td class="num">${c.weight}</td>
          <td><span class="pill" data-tone="${STATUS_TONE[c.resolvedStatus] ?? 'muted'}">${STATUS_SHORT[c.resolvedStatus] ?? c.resolvedStatus}</span></td>
          <td class="small">${c.how}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="panel-note">${p.note ?? ''}</p>
    </section>

    ${(p.gaps ?? []).length ? html`<section class="section">
      <h3 class="section-title">Ce nu este acoperit automat, și de ce</h3>
      <ul class="inval">${p.gaps.map((g) => html`<li data-tone="${STATUS_TONE[g.status] ?? 'muted'}">
        <div class="inval-head"><span class="sev" data-tone="${STATUS_TONE[g.status] ?? 'muted'}">${STATUS_SHORT[g.status] ?? g.status}</span><b>${g.label}</b><span class="muted xs">pondere ${g.weight}</span></div>
        <div class="inval-body">${g.how}</div>
      </li>`)}</ul>
    </section>` : ''}

    ${q ? html`<section class="section">
      <h3 class="section-title">Consumul planurilor gratuite</h3>
      <p class="panel-note">${q.note}</p>
      ${(q.paused ?? []).length ? html`<div class="hardfilter" data-kind="cap">${icon('warn', 14)}<div><b>Furnizori în pauză preventivă:</b> ${q.paused.join(', ')}. Se reactivează automat la resetarea planului.</div></div>` : ''}
      ${(q.warnings ?? []).length ? html`<ul class="xs">${q.warnings.map((w) => html`<li>${w}</li>`)}</ul>` : ''}
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Plan</th><th class="num">Limită lună</th><th class="num">Folosit lună</th><th class="num">Limită zi</th><th class="num">Folosit zi</th><th class="num">Această rulare</th><th>Consum</th></tr></thead>
        <tbody>${(q.providers ?? []).map((x) => {
          const share = x.shareMonth ?? x.shareDay ?? 0;
          const tone = x.paused ? 'serious' : share >= 80 ? 'warning' : 'good';
          return html`<tr>
            <td><b>${x.label}</b>${x.configured ? '' : html` <span class="muted xs">(fără cheie — nu consumă)</span>`}</td>
            <td class="num">${x.limitMonth === null ? '—' : num(x.limitMonth)}</td>
            <td class="num">${num(x.usedMonth)}</td>
            <td class="num">${x.limitDay === null ? '—' : num(x.limitDay)}</td>
            <td class="num">${num(x.usedDay)}</td>
            <td class="num">${num(x.thisRun)}</td>
            <td>${bar(share, tone)}<span class="xs muted"> ${score(share)}%${x.projectedShare !== null && x.projectedShare !== undefined ? ` · proiecție lună ${score(x.projectedShare)}%` : ''}</span></td>
          </tr>`;
        })}</tbody>
      </table></div>
      <p class="panel-note">Pragul de pauză: ${q.pauseAtPct}% din orice limită.</p>
    </section>` : ''}

    <section class="section">
      <h3 class="section-title">Chei gratuite — ce deblochează fiecare</h3>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Variabilă</th><th>Plan</th><th>Deblochează</th><th>Înscriere</th><th>Stare</th></tr></thead>
        <tbody>${(s.methodology?.secrets ?? []).map((k) => html`<tr>
          <td><code>${k.env}</code></td>
          <td class="small">${k.label} — ${k.plan}</td>
          <td class="small">${k.unlocks}</td>
          <td class="small">${k.signup}</td>
          <td><span class="pill" data-tone="${k.configured ? 'good' : 'muted'}">${k.configured ? 'configurată' : 'absentă (opțională)'}</span></td>
        </tr>`)}</tbody>
      </table></div>
      <p class="panel-note">Nicio cheie nu este obligatorie. Fără ea, capabilitatea devine UNKNOWN — care nu înseamnă „negativ”, doar „nemăsurat” — sau rămâne disponibilă prin interfața web gratuită a platformei.</p>
    </section>`;
}
