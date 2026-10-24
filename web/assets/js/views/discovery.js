/**
 * SMALL-CAP RADAR — the screen that answers the project's question.
 *
 * Layout decisions, all driven by what the question actually asks for:
 *  · the question itself is printed at the top, with the live count of projects that satisfy it;
 *  · each card leads with the three-part test (Stage · Opportunity · Risk) and shows which part
 *    failed, so a near-miss is legible instead of simply absent;
 *  · "what changed" is grouped by family, because the claim is *simultaneity across families*;
 *  · opportunity and earliness are shown side by side and never merged — the LAB case needs both;
 *  · every invalidator is printed with what it would falsify and where to watch it.
 */
import { html, tip } from '../core/dom.js';
import { compact, days, frac, num, pct, price, score, signClass, usd } from '../core/format.js';
import { SEVERITY, icon } from '../core/labels.js';
import { meter, qualityDot, searchBox, sortSelect } from './widgets.js';

const STAGE_TONE = { 0: 'muted', 1: 'good', 2: 'good', 3: 'warning', 4: 'serious' };

const BAND_TONE = {
  HIGH_POTENTIAL: 'good',
  CONFIRMED: 'good',
  EARLY: 'warning',
  WATCH: 'muted',
  IGNORE: 'muted',
  UNKNOWN: 'muted',
};

const FAMILY_SHORT = {
  FLOW: 'flux',
  HOLDERS: 'deținători',
  LIQUIDITY: 'lichiditate',
  DERIVATIVES: 'derivate',
  FUNDAMENTALS: 'fundamente',
  ATTENTION: 'atenție',
  LISTING: 'listare',
  STRUCTURE: 'structură',
};

const SORTS = [
  { id: 'rank', label: 'Ordinea motorului' },
  { id: 'opportunity', label: 'Oportunitate' },
  { id: 'earliness', label: 'Precocitate' },
  { id: 'changes', label: 'Număr de schimbări' },
  { id: 'confluence', label: 'Confluență' },
  { id: 'risk', label: 'Risc (crescător)' },
  { id: 'mcap', label: 'Capitalizare' },
];

const FILTERS = [
  { id: 'answer', label: 'Răspund la întrebare' },
  { id: 'early', label: 'Candidați timpurii' },
  { id: 'simultaneous', label: 'Schimbări simultane' },
  { id: 'all', label: 'Toți cei analizați' },
];

export const discoveryState = { filter: null, sort: 'rank', q: '' };

/**
 * The default filter is resolved against the data, not fixed: the screen opens on the strongest
 * bucket that actually has rows. Landing on an empty list would hide the near-misses, which are the
 * most useful thing on this screen when nothing clears all three conditions.
 */
function resolveFilter(counts) {
  if (discoveryState.filter) return discoveryState.filter;
  for (const id of ['answer', 'early', 'simultaneous', 'all']) if (counts[id] > 0) return id;
  return 'all';
}

function testStrip(tests) {
  return html`<div class="tests">${tests.map((t) => html`
    <span class="test" data-pass="${t.pass ? '1' : '0'}" data-tip="${tip(html`<b>${t.label}</b><br>cerință: ${t.want}<br>${t.pass ? 'îndeplinită' : 'neîndeplinită'}`)}">
      ${icon(t.pass ? 'check' : 'minus', 13)}<span>${t.label}</span>
    </span>`)}</div>`;
}

/** Standing conditions: shown as context, visibly apart from the changes they are not. */
function conditionChips(changed) {
  const list = changed.conditions ?? [];
  if (!list.length) return '';
  return html`<div class="chips">${list.map((c) => html`
    <span class="chip muted" data-tip="${tip(html`<b>${c.label}</b><br>${c.detail}<br><span class="muted">context — o stare, nu o schimbare: nu intră în numărul de schimbări simultane</span>`)}">context: ${c.label}</span>`)}</div>`;
}

function changeChips(changed, { max = 8 } = {}) {
  if (!changed.changes.length) return html`<p class="muted small">Nicio schimbare peste propria normă de 30 de zile.</p>${conditionChips(changed)}`;
  return html`<div class="chips">${changed.changes.slice(0, max).map((c) => html`
    <span class="chip" data-fam="${c.family}" data-tip="${tip(html`<b>${c.label}</b><br>${c.detail}<br><span class="muted">familie: ${c.familyLabel ?? FAMILY_SHORT[c.family]} · pondere ${c.weight} · amplitudine ${c.magnitude}</span>`)}">
      <i></i>${c.label}
    </span>`)}${changed.changes.length > max ? html`<span class="chip muted">+${changed.changes.length - max}</span>` : ''}</div>${conditionChips(changed)}`;
}

function invalidatorList(risk, { max = 6 } = {}) {
  const list = risk.invalidators ?? [];
  if (!list.length) return html`<p class="muted small">Niciun invalidator detectat — ceea ce înseamnă „nemăsurat”, nu „inexistent”.</p>`;
  return html`<ul class="inval">${list.slice(0, max).map((i) => {
    const sv = SEVERITY[i.severity] ?? SEVERITY.LOW;
    return html`<li data-tone="${sv.tone}">
      <div class="inval-head"><span class="sev" data-tone="${sv.tone}">${sv.label}</span><b>${i.label}</b></div>
      <div class="inval-body"><span class="muted">ar invalida teza:</span> ${i.invalidates}</div>
      <div class="inval-watch">${icon('eye', 12)} se urmărește în: ${i.watch}</div>
    </li>`;
  })}${list.length > max ? html`<li class="muted small">+${list.length - max} alți invalidatori în fișa completă</li>` : ''}</ul>`;
}

function factorBars(scoreBlock) {
  return html`<div class="fbars">${scoreBlock.factors.map((f) => html`
    <div class="fbar" data-tip="${tip(html`<b>${f.label}</b><br>${f.evidence ?? 'fără dovadă textuală'}<br><span class="muted">pondere nominală ${f.weight} → efectivă ${f.effectiveWeight}% · contribuție ${f.points} puncte · calitate ${f.quality}</span>`)}">
      <span class="bar-k">${qualityDot(f.quality)} ${f.label}</span>
      <span class="domain-bar"><i style="width:${Math.max(2, Math.round(f.score))}%"></i></span>
      <span class="bar-v num">${score(f.score)}</span>
      <span class="bar-w muted xs">${f.effectiveWeight}%</span>
    </div>`)}
    ${scoreBlock.missing.length ? html`<p class="panel-note">Factori nemăsurați, scoși din ponderare (ponderea lor s-a redistribuit; încrederea a scăzut, scorul nu a fost penalizat): ${scoreBlock.missing.map((m) => `${m.label} (${m.reason})`).join('; ')}.</p>` : ''}
  </div>`;
}

function platformRow(row, catalogue) {
  const byKey = new Map();
  for (const g of catalogue ?? []) for (const p of g.platforms ?? []) byKey.set(p.key, p);
  const urls = row.platformUrls ?? Object.fromEntries((row.platforms ?? []).map((p) => [p.key, p.url]));
  const keys = ['arkham', 'dexscreener', 'geckoterminal', 'goplus', 'coinglass', 'explorer', 'dune', 'coingecko', 'coinmarketcap', 'defillama', 'coinalyze'];
  const items = keys.map((k) => ({ key: k, url: urls[k], meta: byKey.get(k) })).filter((x) => x.url);
  if (!items.length) return '';
  return html`<div class="plat">
    <span class="muted xs">Verifică manual:</span>
    ${items.map((x) => html`<a class="plat-link" href="${x.url}" target="_blank" rel="noopener noreferrer"
      data-tip="${tip(html`<b>${x.meta?.label ?? x.key}</b><br>${x.meta?.role ?? ''}<br><span class="muted">${x.meta?.plan ?? ''}</span>`)}">${x.meta?.label ?? x.key}${icon('external', 11)}</a>`)}
  </div>`;
}

/** Why the project was researched in depth this run. */
const SELECTED_BY = {
  CHANGE_ENGINE: { label: 'adus de motorul de schimbări', tip: 'Motorul de schimbări a rulat pe toate proiectele eligibile, față de norma fiecăruia, și a cerut o analiză în profunzime pentru acesta: ceva se mișcă acum peste propria normă.' },
  CONTINUITY: { label: 'urmărit în continuare', tip: 'La rularea anterioară proiectul era în construcție (confirmare multi-factor, candidat timpuriu sau schimbări simultane), așa că rămâne în profunzime pentru ca normele lui de deținători și lichiditate să se acumuleze.' },
  SCORE: { label: 'selectat după scor', tip: 'Adus în profunzime de scorul CRI sau de similaritatea structurală cu LAB/BTW/AGT.' },
};

function card(row, s) {
  const v = row.verdict;
  const t = row.thesis;
  const flows = row.onchain?.flows;
  const sm = row.onchain?.smartMoney;
  return html`<article class="dcard" data-answer="${v.answersQuestion ? '1' : '0'}" id="d-${row.key}">
    <header class="dcard-head">
      <div class="dcard-id">
        <button class="tok-btn" type="button" data-open="${row.key}" data-tipfn="cand" data-key="${row.key}">
          <span class="tok">${row.symbol}</span><span class="tok-sub">${row.name}</span>
        </button>
        <span class="pill" data-tone="${STAGE_TONE[v.stage] ?? 'muted'}" data-tip="${tip(html`<b>Stage ${v.stage} — ${v.stageLabel}</b><br>${v.stageMeaning}`)}">Stage ${v.stage} · ${v.stageLabel}</span>
        <span class="pill" data-tone="${BAND_TONE[v.band] ?? 'muted'}">${v.bandLabel}</span>
        ${v.answersQuestion ? html`<span class="pill" data-tone="good" data-tip="${tip('Îndeplinește toate cele trei condiții pentru candidat timpuriu ȘI are schimbări simultane în cel puțin două familii — exact forma întrebării proiectului.')}">${icon('target', 12)} răspunde la întrebare</span>` : ''}
        ${SELECTED_BY[row.selectedBy] ? html`<span class="pill" data-tone="muted" data-tip="${tip(SELECTED_BY[row.selectedBy].tip)}">${SELECTED_BY[row.selectedBy].label}</span>` : ''}
      </div>
      <div class="dcard-nums">
        ${meter('Oportunitate', v.opportunity, { tone: BAND_TONE[v.band] ?? 'muted', tip: html`Scorul de pre-expansiune din 8 factori ponderați. Bandă: ${v.bandLabel}.` })}
        ${meter('Precocitate', v.earliness, { tone: v.earliness >= 65 ? 'good' : v.earliness >= 40 ? 'warning' : 'serious', tip: html`Cât de puțin evidentă este încă mișcarea. Evidență publică: ${score(row.changed.obviousness)}/100.` })}
        ${meter('Momentum', v.momentum, { tone: 'muted', tip: 'Cât de puternică este deja mișcarea. Momentum mare + precocitate mică = descoperire târzie.' })}
        ${meter('Risc', v.risk, { tone: v.risk >= 60 ? 'serious' : v.risk >= 40 ? 'warning' : 'good', invert: true, tip: html`${v.riskLevel ?? ''} — suma invalidatorilor, nu o opinie.` })}
        ${meter('Încredere', v.confidence, { tone: v.confidence >= 70 ? 'good' : v.confidence >= 50 ? 'warning' : 'serious', tip: `${t.confidenceLabel} — cât din imaginea completă a putut fi măsurată.` })}
      </div>
    </header>

    ${testStrip(v.tests)}

    <p class="thesis">${t.paragraph}</p>

    <div class="dcard-grid">
      <section class="panel">
        <div class="panel-head"><h4 class="panel-title">Ce s-a schimbat <span class="muted xs">· ${row.changed.count} în ${row.changed.familyCount} ${row.changed.familyCount === 1 ? 'familie' : 'familii'}, fereastră ${row.changed.windowDays}z</span></h4></div>
        ${changeChips(row.changed)}
        <div class="facts xs">
          <div class="kv"><span>Confluență</span><b class="num">${row.changed.confluence}</b></div>
          <div class="kv"><span>Simultaneitate</span><b>${row.changed.simultaneous ? 'da' : 'nu'}</b></div>
          <div class="kv"><span>Normă proprie</span><b>${row.baseline.points} puncte${row.baseline.spanDays ? ` / ${days(row.baseline.spanDays)}` : ''}</b></div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h4 class="panel-title">Scor, factor cu factor</h4><span class="muted xs">acoperire ${frac(row.score.coverage)}</span></div>
        ${factorBars(row.score)}
      </section>

      <section class="panel">
        <div class="panel-head"><h4 class="panel-title">Ce ar invalida teza</h4><span class="pill" data-tone="${v.risk >= 60 ? 'serious' : v.risk >= 40 ? 'warning' : 'good'}">risc ${score(v.risk)} · ${row.risk.level}</span></div>
        ${invalidatorList(row.risk)}
      </section>

      <section class="panel">
        <div class="panel-head"><h4 class="panel-title">Fapte on-chain și de piață</h4></div>
        <div class="facts">
          <div class="kv"><span>Capitalizare</span><b>${usd(row.market.marketCap)}</b></div>
          <div class="kv"><span>Volum 24h</span><b>${usd(row.market.volume24h)}</b></div>
          <div class="kv"><span>Rotație</span><b>${frac(row.market.turnover, 2)}/zi</b></div>
          <div class="kv"><span>7 zile</span><b class="${signClass(row.market.change.d7)}">${pct(row.market.change.d7)}</b></div>
          <div class="kv"><span>30 zile</span><b class="${signClass(row.market.change.d30)}">${pct(row.market.change.d30)}</b></div>
          <div class="kv"><span>Lichiditate DEX</span><b>${usd(row.onchain.liquidityUsd)}</b></div>
          <div class="kv"><span>Deținători</span><b>${num(row.onchain.holders)}</b></div>
          <div class="kv" data-tip="${tip('Concentrarea pe supply-ul efectiv: pool-urile, bridge-urile, staking-ul, lock-urile și adresele de ardere sunt excluse, pentru că nu pot fi vândute de un decident.')}"><span>Top 10 efectiv</span><b>${pct(row.onchain.top10EffectivePct, { sign: false })}</b></div>
          <div class="kv"><span>Pe burse (CEX)</span><b>${pct(row.onchain.cexBalancePct, { sign: false })}</b></div>
          <div class="kv"><span>Funding</span><b>${row.derivatives.fundingPct8h === null ? '—' : `${row.derivatives.fundingPct8h > 0 ? '+' : ''}${row.derivatives.fundingPct8h.toFixed(4)}%/8h`}</b></div>
          <div class="kv"><span>Open interest</span><b>${usd(row.derivatives.oiUsd)}</b></div>
          <div class="kv"><span>Preț</span><b class="num">$${price(row.market.price)}</b></div>
        </div>
        ${flows ? html`<p class="panel-note">${icon('layers', 12)} Fluxuri: <b>${flows.verdictLabel ?? flows.verdict}</b>${Number.isFinite(flows.accumulating) ? ` — ${flows.accumulating} portofele mari în acumulare, ${flows.distributing} în distribuție` : ''}${flows.flags?.length ? ` · semnale: ${flows.flags.join(', ')}` : ''}.</p>` : ''}
        ${sm?.score !== null && sm?.score !== undefined ? html`<p class="panel-note">${icon('bolt', 12)} Smart Money Score <b>${score(sm.score)}</b>/100 (${sm.measured} din 16 componente evaluabile): ${(sm.components ?? []).slice(0, 4).map((c) => `${c.label} +${c.points}`).join(', ') || 'nicio componentă pozitivă'}${(sm.penalties ?? []).length ? `; penalizări: ${sm.penalties.map((c) => `${c.label} ${c.points}`).join(', ')}` : ''}.</p>` : ''}
      </section>
    </div>

    <footer class="dcard-foot">
      <div class="dcard-timing">${icon('clock', 13)} ${t.timing}</div>
      ${t.confirms?.length ? html`<details class="confirms"><summary>Ce ar confirma teza (${t.confirms.length})</summary>
        <ul>${t.confirms.map((c) => html`<li><b>${c.label}</b> — ${c.detail} <span class="muted xs">(${c.where})</span></li>`)}</ul>
      </details>` : ''}
      ${platformRow(row, s.methodology?.platforms)}
    </footer>
  </article>`;
}

function matches(row, f) {
  if (f === 'answer') return row.verdict.answersQuestion;
  if (f === 'early') return row.verdict.earlyResearchCandidate;
  if (f === 'simultaneous') return row.changed.simultaneous;
  return true;
}

function sortRows(rows, sort) {
  const by = {
    opportunity: (r) => r.verdict.opportunity ?? -1,
    earliness: (r) => r.verdict.earliness ?? -1,
    changes: (r) => r.changed.count,
    confluence: (r) => r.changed.confluence,
    mcap: (r) => r.market.marketCap ?? -1,
  };
  if (sort === 'risk') return [...rows].sort((a, b) => (a.verdict.risk ?? 101) - (b.verdict.risk ?? 101));
  const f = by[sort];
  return f ? [...rows].sort((a, b) => f(b) - f(a)) : rows;
}

export function discoveryMarkup(s) {
  const d = s.discovery ?? { rows: [], answering: 0, earlyCandidates: 0, analysed: 0 };
  const all = d.rows ?? [];
  const counts = {
    answer: all.filter((r) => matches(r, 'answer')).length,
    early: all.filter((r) => matches(r, 'early')).length,
    simultaneous: all.filter((r) => matches(r, 'simultaneous')).length,
    all: all.length,
  };
  const filter = resolveFilter(counts);
  const q = discoveryState.q.trim().toLowerCase();
  let rows = all.filter((r) => matches(r, filter));
  if (q) rows = rows.filter((r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  rows = sortRows(rows, discoveryState.sort);
  // When nothing clears all three conditions, say so where the eye lands first.
  const shortfall = counts.answer === 0 ? nearMiss(all) : null;
  // On the first runs the empty answer has a structural cause — no project has a norm yet — and the
  // reader must see that cause, not mistake a radar that cannot measure yet for a quiet market.
  const cov = d.coverage ?? null;
  const normsBuilding = Boolean(cov && cov.eligible > 0 && cov.withBaseline < cov.eligible * 0.5);

  return html`
    <div class="view-head">
      <h2 class="view-title">Small-Cap Radar</h2>
      <p class="view-lede">Întrebarea la care răspunde acest ecran, cuvânt cu cuvânt: <em>„Arată-mi proiectele mici unde se schimbă simultan mai multe lucruri importante, înainte ca mișcarea să devină evidentă, și spune-mi ce riscuri pot invalida această ipoteză.”</em></p>
    </div>

    <div class="qbar">
      <div class="qstat" data-tone="${d.answering > 0 ? 'good' : 'muted'}">
        <b class="num">${d.answering}</b><span>răspund la întrebare</span>
        <small class="muted">candidat timpuriu <em>și</em> schimbări simultane în ≥2 familii</small>
      </div>
      <div class="qstat">
        <b class="num">${d.earlyCandidates}</b><span>candidați timpurii</span>
        <small class="muted">Stage 1–2 · oportunitate &gt; 75 · risc &lt; 60</small>
      </div>
      <div class="qstat">
        <b class="num">${counts.simultaneous}</b><span>cu schimbări simultane</span>
        <small class="muted">≥3 schimbări în ≥2 familii, fereastră de 7 zile</small>
      </div>
      <div class="qstat">
        <b class="num">${d.analysed}</b><span>proiecte analizate în adâncime</span>
        <small class="muted">din ${num(s.health?.universe?.eligible)} eligibile după filtrul de small-cap${cov ? html`; ${num(cov.prescreened)} aduse de motorul de schimbări` : ''}</small>
      </div>
      ${cov ? html`<div class="qstat" data-tone="${normsBuilding ? 'muted' : 'good'}">
        <b class="num">${num(cov.withBaseline)}<small class="muted">/${num(cov.eligible)}</small></b><span>cu normă proprie</span>
        <small class="muted">istoric de minim ${num(cov.minPoints)} rulări în ${num(cov.windowDays)} zile · ${num(cov.moving)} se mișcă acum față de propria normă</small>
      </div>` : ''}
    </div>

    ${normsBuilding ? html`<div class="notice" data-kind="demo" style="margin:10px 0 0;border-radius:10px"><div class="frame" style="padding:10px 12px">${icon('info', 15)}<p>
      <b>Normele proprii sunt în construcție.</b> ${num(cov.withBaseline)} din ${num(cov.eligible)} proiecte eligibile au deja istoric suficient.
      Radarul măsoară o schimbare față de norma fiecărui proiect, nu față de o medie a pieței, așa că detectoarele de volum, rotație și open interest
      se activează după ${cov.runsToNorms > 0 ? html`încă aproximativ <b>${num(cov.runsToNorms)} ${cov.runsToNorms === 1 ? 'rulare' : 'rulări'}</b>` : 'următoarea rulare'} (una la 4 ore).
      Până atunci pot apărea doar schimbările care nu cer istoric — listări noi, funding negativ — iar un rezultat gol înseamnă „încă nu se poate măsura”, nu „piață liniștită”.
    </p></div></div>` : ''}

    ${shortfall ? html`<div class="notice" data-kind="demo" style="margin:10px 0 0;border-radius:10px"><div class="frame" style="padding:10px 12px">${icon('info', 15)}<p>
      <b>Niciun proiect nu îndeplinește simultan toate cele trei condiții în această rulare.</b>
      Cel mai aproape este <b>${shortfall.symbol}</b>: ${shortfall.why}. Pragurile nu se coboară pentru a produce un rezultat —
      lista de mai jos arată exact ce îi lipsește fiecărui proiect, ceea ce este informația utilă când fereastra nu este deschisă.
    </p></div></div>` : ''}

    <div class="filters">
      <div class="seg" role="tablist" aria-label="Filtrează radarul">
        ${FILTERS.map((f) => html`<button class="pill" type="button" role="tab" data-dfilter="${f.id}" aria-selected="${filter === f.id ? 'true' : 'false'}">${f.label}<span class="count">${counts[f.id]}</span></button>`)}
      </div>
      ${searchBox(discoveryState.q, 'dsearch', 'Caută simbol sau nume')}
      ${sortSelect(SORTS, discoveryState.sort, 'dsort')}
      <span class="result-count">${rows.length} ${rows.length === 1 ? 'proiect' : 'proiecte'}</span>
    </div>

    ${rows.length ? html`<div class="dlist">${rows.map((r) => card(r, s))}</div>` : html`<div class="empty">
      <strong>Niciun proiect nu îndeplinește acest filtru în rularea curentă.</strong>
      <p>Asta este un rezultat, nu o eroare: condiția cere ca mai multe lucruri importante să se schimbe simultan <em>înainte</em> ca mișcarea să devină evidentă, iar astfel de ferestre sunt rare. Încearcă filtrul „Toți cei analizați” pentru a vedea ce lipsește fiecărui proiect din cele trei condiții.</p>
      ${d.note ? html`<p class="muted small">${d.note}</p>` : ''}
    </div>`}

    ${rows.length ? html`<p class="panel-note">${d.note ?? ''}</p>` : ''}`;
}

/** Wire the filter / search / sort controls of this view. */
export function bindDiscovery(root, rerender) {
  root.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-dfilter]') : null;
    if (!el) return;
    discoveryState.filter = el.dataset.dfilter;
    rerender();
  });
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el?.id === 'dsearch') {
      discoveryState.q = el.value;
      rerender({ keepFocus: '#dsearch' });
    }
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el?.id === 'dsort') {
      discoveryState.sort = el.value;
      rerender();
    }
  });
}


/** The project closest to satisfying all three conditions, and which condition it misses. */
function nearMiss(rows) {
  const scored = rows
    .filter((r) => Number.isFinite(r.verdict.opportunity))
    .map((r) => {
      const failed = r.verdict.tests.filter((t) => !t.pass);
      // Distance to the goal: how far each failed condition still is, in its own units.
      const gap = failed.reduce((d, t) => {
        if (t.key === 'opportunity') return d + Math.max(0, 75 - (r.verdict.opportunity ?? 0));
        if (t.key === 'risk') return d + Math.max(0, (r.verdict.risk ?? 100) - 60);
        return d + 20; // a wrong stage is a structural miss, not a near one
      }, 0);
      return { r, failed, gap };
    })
    .sort((a, b) => a.gap - b.gap);
  const best = scored[0];
  if (!best) return null;
  const why = best.failed.map((t) => `${t.label} (cerință: ${t.want})`).join(' și ');
  return { symbol: best.r.symbol, why: why || 'îi lipsește doar simultaneitatea pe cel puțin două familii' };
}
