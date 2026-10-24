/**
 * DEEP RESEARCH — section ③: one project, one screen, everything.
 *
 * This is the screen a web3 researcher stays on. It deliberately does not summarise: the holder list
 * is shown as classified actors, the baseline comparison is shown metric by metric with the z-score
 * against the project's own norm, every invalidator is listed in full, and the platform registry is
 * grouped so the manual verification path is one click away for each source.
 */
import { html, tip } from '../core/dom.js';
import { compact, dateTime, days, frac, num, pct, price, score, shortAddr, signClass, usd } from '../core/format.js';
import { SEVERITY, icon } from '../core/labels.js';
import { meter, qualityDot } from './widgets.js';

export const researchState = { key: null };

const METRIC_LABEL = {
  price: 'Preț',
  marketCap: 'Capitalizare',
  volume24h: 'Volum 24h',
  turnover: 'Rotație',
  liquidityUsd: 'Lichiditate DEX',
  holders: 'Deținători',
  holdersEffective: 'Deținători efectivi',
  top10Pct: 'Top 10 (brut)',
  oiUsd: 'Open interest',
  fundingPct8h: 'Funding %/8h',
  tvl: 'TVL',
  devCommits30d: 'Commit-uri 30z',
  mentions7d: 'Mențiuni 7z',
  cexBalancePct: 'Sold pe burse',
  whaleBalancePct: 'Sold whale-uri',
  circulating: 'Supply circulant',
};

const CLASS_TONE = {
  cex: 'warning', fund: 'good', project: 'warning', flagged: 'serious', bot: 'muted',
  lp: 'muted', bridge: 'muted', staking: 'muted', burn: 'muted', lock: 'muted', protocol: 'muted',
  contract: 'muted', wallet: 'good',
};

function picker(rows, current) {
  return html`<label class="select-wrap"><span class="sr-only">Alege proiectul</span>
    <select class="select" id="rpick" aria-label="Proiect">
      ${rows.map((r) => html`<option value="${r.key}" ${r.key === current ? 'selected' : ''}>${r.symbol} — ${r.name}${r.verdict.answersQuestion ? ' ✦' : ''} (oportunitate ${score(r.verdict.opportunity)}, risc ${score(r.verdict.risk)})</option>`)}
    </select></label>`;
}

function holderPanel(oc) {
  const t = oc.holderTable;
  if (!t) {
    return html`<section class="panel">
      <div class="panel-head"><h4 class="panel-title">Deținători, clasificați în actori</h4></div>
      <p class="muted small">${oc.note ?? 'Lista de deținători nu a fost disponibilă pentru acest proiect în rularea curentă.'}</p>
      <p class="panel-note">Factorul a fost scos din ponderare, iar încrederea a scăzut corespunzător. „Nemăsurat” nu este același lucru cu „prost”.</p>
    </section>`;
  }
  return html`<section class="panel wide">
    <div class="panel-head">
      <h4 class="panel-title">Deținători, clasificați în actori</h4>
      <span class="muted xs">supply tranzacționabil: ${pct(t.effectiveSharePct, { sign: false })} din total</span>
    </div>
    <div class="facts">
      <div class="kv"><span>Top 10 brut</span><b>${pct(t.top10Pct, { sign: false })}</b></div>
      <div class="kv" data-tip="${tip('Concentrarea recalculată pe supply-ul care poate fi vândut: pool-urile, bridge-urile, staking-ul, lock-urile și adresele de ardere sunt excluse din bază.')}"><span>Top 10 efectiv</span><b>${pct(t.top10EffectivePct, { sign: false })}</b></div>
      <div class="kv"><span>Top 20 efectiv</span><b>${pct(t.top20EffectivePct, { sign: false })}</b></div>
      <div class="kv"><span>Top 50 brut</span><b>${pct(t.top50Pct, { sign: false })}</b></div>
    </div>
    <div class="classbar" aria-hidden="true">${(t.byClass ?? []).map((c) => html`<i data-cls="${c.key}" style="width:${Math.max(0.5, c.share ?? 0)}%" data-tip="${tip(html`<b>${c.label}</b><br>${c.count} adrese · ${pct(c.share, { sign: false })} din supply`)}"></i>`)}</div>
    <div class="chips xs">${(t.byClass ?? []).map((c) => html`<span class="chip" data-cls="${c.key}" data-tone="${CLASS_TONE[c.key] ?? 'muted'}"><i></i>${c.label} ${pct(c.share, { sign: false })} <span class="muted">(${c.count})</span></span>`)}</div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Adresă</th><th>Clasă</th><th>Entitate</th><th class="num">Cotă</th><th>Sursa etichetei</th><th>În supply efectiv</th></tr></thead>
      <tbody>${t.rows.map((h) => html`<tr>
        <td><button class="linkish" type="button" data-copy="${h.address}" data-tip="${tip(h.address)}">${shortAddr(h.address)}</button></td>
        <td><span class="pill" data-tone="${CLASS_TONE[h.class] ?? 'muted'}">${h.classLabel}</span></td>
        <td class="small">${h.entity ?? '—'}</td>
        <td class="num">${pct(h.share, { sign: false, dec: 2 })}</td>
        <td class="xs muted">${h.source}</td>
        <td>${h.excluded ? html`<span class="muted xs">exclus</span>` : html`<span class="xs">da</span>`}</td>
      </tr>`)}</tbody>
    </table></div>
    <p class="panel-note">${oc.note ?? ''}</p>
  </section>`;
}

function comparisonPanel(cmp) {
  const entries = Object.entries(cmp ?? {});
  if (!entries.length) {
    return html`<section class="panel"><div class="panel-head"><h4 class="panel-title">Față de propria normă</h4></div>
      <p class="muted small">Istoricul propriu al acestui proiect este încă prea scurt pentru o normă. Fiecare rulare completă adaugă un punct; după patru puncte, comparațiile devin disponibile.</p></section>`;
  }
  return html`<section class="panel wide">
    <div class="panel-head"><h4 class="panel-title">Față de propria normă (30 de zile)</h4><span class="muted xs">z = abatere robustă (median + MAD), imună la un singur vârf</span></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Metrică</th><th class="num">Acum</th><th class="num">Mediană</th><th class="num">Variație</th><th class="num">z</th><th class="num">Percentilă</th><th class="num">Puncte</th></tr></thead>
      <tbody>${entries.map(([k, c]) => html`<tr>
        <td>${METRIC_LABEL[k] ?? k}</td>
        <td class="num">${compact(c.value)}</td>
        <td class="num">${compact(c.median)}</td>
        <td class="num ${signClass(c.changePct)}">${pct(c.changePct)}</td>
        <td class="num ${Math.abs(c.z ?? 0) >= 2 ? (c.z > 0 ? 'pos' : 'neg') : 'muted'}">${c.z === null ? '—' : c.z.toFixed(1)}</td>
        <td class="num muted">${c.percentile === null ? '—' : `${Math.round(c.percentile * 100)}`}</td>
        <td class="num muted">${c.n}</td>
      </tr>`)}</tbody>
    </table></div>
  </section>`;
}

function platformPanel(row, catalogue) {
  const urls = row.platformUrls ?? Object.fromEntries((row.platforms ?? []).map((p) => [p.key, p.url]));
  const groups = (catalogue ?? []).map((g) => ({
    group: g.group,
    items: (g.platforms ?? []).map((p) => ({ ...p, url: urls[p.key] })).filter((p) => p.url),
  })).filter((g) => g.items.length);
  if (!groups.length) return '';
  return html`<section class="panel wide">
    <div class="panel-head"><h4 class="panel-title">Verificare manuală pe platforme</h4><span class="muted xs">context precompletat pentru fiecare sursă</span></div>
    ${groups.map((g) => html`<div class="platgroup">
      <h5>${g.group}</h5>
      <div class="plat">${g.items.map((p) => html`<a class="plat-link" data-layer="${p.layer}" href="${p.url}" target="_blank" rel="noopener noreferrer"
        data-tip="${tip(html`<b>${p.label}</b><br>${p.role}<br><span class="muted">${p.plan}</span>${p.layer === 'KEY_SLOT' ? html`<br><span class="muted">slot de cheie: ${p.configured ? 'configurat' : 'liber (opțional)'}</span>` : ''}`)}">
        ${p.label}${p.layer === 'KEY_SLOT' && !p.configured ? html` <span class="muted xs">(cheie liberă)</span>` : ''}${icon('external', 11)}</a>`)}</div>
    </div>`)}
    <p class="panel-note">Legendă: <b>AUTO</b> = API gratuit apelat în cod; <b>LINK</b> = interfața web gratuită a platformei, cu contextul deja completat; <b>KEY_SLOT</b> = adaptor existent care se activează cu o cheie gratuită sau de trial.</p>
  </section>`;
}

export function researchMarkup(s) {
  const rows = s.discovery?.rows ?? [];
  if (!rows.length) {
    return html`<div class="view-head"><h2 class="view-title">Deep Research</h2></div>
      <div class="empty"><strong>Nu există proiecte analizate în acest snapshot.</strong><p>Rulează o scanare completă; motorul de descoperire publică aici fiecare proiect pe care l-a cercetat în profunzime.</p></div>`;
  }
  const detailed = rows.filter((r) => r.onchain?.holderTable || r.comparison);
  const pool = detailed.length ? detailed : rows;
  const row = pool.find((r) => r.key === researchState.key) ?? pool[0];
  const v = row.verdict;
  const t = row.thesis;
  const qa = t.questionAnswer ?? {};

  return html`
    <div class="view-head">
      <h2 class="view-title">Deep Research</h2>
      <p class="view-lede">Un proiect, un singur ecran: teza, ce s-a schimbat față de propria normă, deținătorii clasificați în actori, invalidatorii și calea de verificare manuală pe fiecare platformă.</p>
    </div>

    <div class="filters">${picker(pool, row.key)}<span class="result-count">${pool.length} ${pool.length === 1 ? 'proiect cu dosar complet' : 'proiecte cu dosar complet'}</span></div>

    <article class="dossier">
      <header class="dossier-head">
        <div class="dcard-id">
          <span class="tok lg">${row.symbol}</span><span class="tok-sub">${row.name}</span>
          <span class="pill" data-tone="${v.stage >= 3 ? 'warning' : 'good'}">Stage ${v.stage} · ${v.stageLabel}</span>
          <span class="pill">${v.bandLabel}</span>
          ${v.answersQuestion ? html`<span class="pill" data-tone="good">${icon('target', 12)} răspunde la întrebare</span>` : ''}
          ${row.chain ? html`<span class="pill" data-tone="muted">${row.chain}</span>` : ''}
        </div>
        <div class="dcard-nums">
          ${meter('Oportunitate', v.opportunity, { tone: 'good' })}
          ${meter('Precocitate', v.earliness, { tone: v.earliness >= 65 ? 'good' : 'warning' })}
          ${meter('Momentum', v.momentum, { tone: 'muted' })}
          ${meter('Risc', v.risk, { tone: v.risk >= 60 ? 'serious' : 'good', invert: true })}
          ${meter('Încredere', v.confidence, { tone: v.confidence >= 70 ? 'good' : 'warning' })}
        </div>
      </header>

      <section class="panel qanswer">
        <div class="panel-head"><h4 class="panel-title">Răspunsul la întrebarea proiectului</h4></div>
        <p class="qquote">„${qa.question ?? ''}”</p>
        <div class="facts">
          <div class="kv"><span>Proiect mic?</span><b>${qa.small ?? '—'}</b></div>
          <div class="kv"><span>Se schimbă simultan mai multe lucruri?</span><b>${qa.simultaneous ?? '—'}</b></div>
          <div class="kv"><span>Încă neevident?</span><b>${qa.notYetObvious ?? '—'}</b></div>
        </div>
        <p class="verdict">${qa.verdict ?? v.verdict}</p>
        ${(qa.risksThatInvalidate ?? []).length ? html`<ul class="inval compact">${qa.risksThatInvalidate.map((r) => {
          const sv = SEVERITY[r.severity] ?? SEVERITY.LOW;
          return html`<li data-tone="${sv.tone}"><div class="inval-head"><span class="sev" data-tone="${sv.tone}">${sv.label}</span><b>${r.label}</b></div><div class="inval-body">${r.invalidates}</div><div class="inval-watch">${icon('eye', 12)} ${r.watch}</div></li>`;
        })}</ul>` : ''}
      </section>

      <section class="panel"><div class="panel-head"><h4 class="panel-title">Teza, în proză</h4><span class="muted xs">${t.confidenceLabel}</span></div>
        <p class="thesis">${t.paragraph}</p>
        <p class="panel-note">${icon('clock', 12)} ${t.timing}</p>
      </section>

      <div class="dcard-grid">
        <section class="panel">
          <div class="panel-head"><h4 class="panel-title">Ce s-a schimbat</h4><span class="muted xs">${row.changed.count} în ${row.changed.familyCount} familii</span></div>
          <ul class="changes">${row.changed.changes.map((c) => html`<li data-fam="${c.family}">
            <b>${c.label}</b><span class="muted xs"> · ${c.familyLabel ?? c.family}</span>
            <div class="small">${c.detail}</div>
          </li>`)}</ul>
          ${row.changed.changes.length ? '' : html`<p class="muted small">Nicio schimbare peste propria normă.</p>`}
          ${(row.changed.conditions ?? []).length ? html`<p class="muted xs" style="margin-top:8px">Context, nu schimbări: ${row.changed.conditions.map((c) => c.label.toLowerCase()).join(' · ')}</p>` : ''}
        </section>

        <section class="panel">
          <div class="panel-head"><h4 class="panel-title">Scorul, factor cu factor</h4><span class="muted xs">acoperire ${frac(row.score.coverage)} · încredere ${row.score.confidence}%</span></div>
          <div class="fbars">${row.score.factors.map((f) => html`<div class="fbar" data-tip="${tip(html`<b>${f.label}</b><br>${f.evidence ?? ''}<br><span class="muted">pondere ${f.weight} → ${f.effectiveWeight}% · ${f.points} puncte</span>`)}">
            <span class="bar-k">${qualityDot(f.quality)} ${f.label}</span>
            <span class="domain-bar"><i style="width:${Math.max(2, Math.round(f.score))}%"></i></span>
            <span class="bar-v num">${score(f.score)}</span>
            <span class="bar-w muted xs">${f.effectiveWeight}%</span>
          </div>`)}</div>
          ${row.score.missing.length ? html`<p class="panel-note">Nemăsurat: ${row.score.missing.map((m) => m.label).join(', ')} — ponderea s-a redistribuit, încrederea a scăzut.</p>` : ''}
        </section>

        <section class="panel">
          <div class="panel-head"><h4 class="panel-title">Smart Money Score</h4>${row.onchain.smartMoney?.score !== null && row.onchain.smartMoney?.score !== undefined ? html`<span class="pill" data-tone="${row.onchain.smartMoney.score >= 60 ? 'good' : 'muted'}">${score(row.onchain.smartMoney.score)}/100</span>` : ''}</div>
          ${row.onchain.smartMoney ? html`
            <ul class="smlist">${(row.onchain.smartMoney.components ?? []).map((c) => html`<li data-sign="pos"><b>+${c.points}</b> ${c.label}${c.evidence ? html`<div class="small muted">${c.evidence}</div>` : ''}</li>`)}
            ${(row.onchain.smartMoney.penalties ?? []).map((c) => html`<li data-sign="neg"><b>${c.points}</b> ${c.label}${c.evidence ? html`<div class="small muted">${c.evidence}</div>` : ''}</li>`)}</ul>
            <p class="panel-note">${row.onchain.smartMoney.note ?? ''}</p>` : html`<p class="muted small">Fără date on-chain suficiente pentru acest scor.</p>`}
        </section>

        <section class="panel">
          <div class="panel-head"><h4 class="panel-title">Supply și deblocări</h4></div>
          ${row.supply ? html`<div class="facts">
            <div class="kv"><span>În circulație</span><b>${frac(row.supply.floatRatio, 0)}</b></div>
            <div class="kv"><span>FDV / capitalizare</span><b>${row.supply.fdvToMcap ?? '—'}×</b></div>
            <div class="kv"><span>Emisiune estimată</span><b>${row.supply.inflationPctYear === null ? '—' : `${row.supply.inflationPctYear}%/an`}</b></div>
            <div class="kv"><span>Deblocare în 30z</span><b>${row.supply.unlockWithin30d ? 'da' : 'nu'}</b></div>
            ${row.supply.nextUnlock ? html`<div class="kv"><span>Următoarea deblocare</span><b>${row.supply.nextUnlock.at.slice(0, 10)} (${days(row.supply.nextUnlock.inDays)})</b></div>` : ''}
          </div>
          <ul class="xs">${(row.supply.warnings ?? []).map((w) => html`<li>${w}</li>`)}</ul>` : html`<p class="muted small">Fără date de supply.</p>`}
        </section>
      </div>

      ${holderPanel(row.onchain)}
      ${comparisonPanel(row.comparison)}

      <section class="panel wide">
        <div class="panel-head"><h4 class="panel-title">Toți invalidatorii (${row.risk.invalidators.length})</h4><span class="pill" data-tone="${row.risk.score >= 60 ? 'serious' : 'good'}">risc ${score(row.risk.score)} · ${row.risk.level}</span></div>
        <ul class="inval">${row.risk.invalidators.map((i) => {
          const sv = SEVERITY[i.severity] ?? SEVERITY.LOW;
          return html`<li data-tone="${sv.tone}">
            <div class="inval-head"><span class="sev" data-tone="${sv.tone}">${sv.label}</span><b>${i.label}</b><span class="muted xs">${i.category}</span></div>
            <div class="inval-body"><span class="muted">ar invalida teza:</span> ${i.invalidates}</div>
            <div class="inval-watch">${icon('eye', 12)} se urmărește în: ${i.watch}</div>
          </li>`;
        })}</ul>
        <p class="panel-note">${row.risk.note}</p>
      </section>

      ${row.onchain.security ? html`<section class="panel wide">
        <div class="panel-head"><h4 class="panel-title">Securitatea contractului</h4><span class="muted xs">GoPlus Security, plan gratuit</span></div>
        <div class="facts">
          ${Object.entries({
            isHoneypot: 'Honeypot', isMintable: 'Mintable', isProxy: 'Proxy', canTakeBackOwnership: 'Owner poate reveni',
            hiddenOwner: 'Owner ascuns', transferPausable: 'Transfer pauzabil',
          }).map(([k, label]) => html`<div class="kv"><span>${label}</span><b class="${row.onchain.security[k] === true ? 'neg' : row.onchain.security[k] === false ? 'pos' : 'muted'}">${row.onchain.security[k] === true ? 'da' : row.onchain.security[k] === false ? 'nu' : '—'}</b></div>`)}
          <div class="kv"><span>Taxă cumpărare</span><b>${pct(row.onchain.security.buyTaxPct, { sign: false })}</b></div>
          <div class="kv"><span>Taxă vânzare</span><b class="${(row.onchain.security.sellTaxPct ?? 0) >= 10 ? 'neg' : ''}">${pct(row.onchain.security.sellTaxPct, { sign: false })}</b></div>
          <div class="kv"><span>LP blocat</span><b>${pct(row.onchain.security.lpLockedPct, { sign: false })}</b></div>
        </div>
      </section>` : ''}

      ${platformPanel(row, s.methodology?.platforms)}

      <footer class="dossier-foot">
        <div class="muted xs">Normă proprie: ${row.baseline.points} puncte pe ${days(row.baseline.spanDays)} · lumânări: ${row.features?.source ?? '—'} · snapshot ${dateTime(s.meta.generatedAt)}</div>
        <div class="muted xs">${s.meta.disclaimer}</div>
      </footer>
    </article>`;
}

export function bindResearch(root, rerender) {
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el?.id === 'rpick') {
      researchState.key = el.value;
      rerender();
    }
  });
}
