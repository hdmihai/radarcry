/**
 * POTENȚIALI RUNNERI (7 zile) — proiectele care seamănă, ACUM, cu ce aveau în ziua dinaintea
 * creșterii proiectele care au urcat ≥ +50% în 7 zile (EVAA, IRYS, BR …).
 *
 * Datele vin din data/runners.json, produs de modulul Python services/analyst-python/runners la
 * fiecare scanare completă (GitHub Actions, la 4 ore). View-ul îl încarcă doar când ecranul se
 * deschide și nu recalculează nimic: probabilitatea, factorii, regulile și similaritățile sunt
 * output-ul motorului.
 */
import { html, tip } from '../core/dom.js';
import { dateTime, signClass, usd, DASH } from '../core/format.js';

export const runnersState = { status: 'idle', data: null, error: null };

let pending = null;
/** Încarcă data/runners.json o singură dată pe vizită. */
export function ensureRunners(url = 'data/runners.json') {
  if (runnersState.status === 'ready' || runnersState.status === 'error') return Promise.resolve();
  runnersState.status = 'loading';
  pending ??= fetch(url, { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(res.status === 404 ? 'data/runners.json nu există încă — se publică la următoarea scanare completă' : `HTTP ${res.status}`);
      const doc = await res.json();
      if (!doc || !Array.isArray(doc.candidates)) throw new Error('structură neașteptată a fișierului runners.json');
      runnersState.data = doc;
      runnersState.status = 'ready';
    })
    .catch((err) => {
      runnersState.status = 'error';
      runnersState.error = String(err?.message ?? err);
    });
  return pending;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const pctFrac = (x, dec = 1) => (isNum(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(dec)}%` : DASH);
const prob = (x) => (isNum(x) ? `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%` : DASH);
const fix = (x, d = 2) => (isNum(x) ? x.toFixed(d) : DASH);

const STAGE = {
  PRE: { tone: 'good', label: 'pre-aprindere' },
  APRINDERE: { tone: 'warning', label: 'aprindere' },
  EXTINS: { tone: 'serious', label: 'extins' },
};
const TIER_TONE = { A: 'good', B: 'warning', C: 'muted' };
const SEV_TONE = { high: 'serious', medium: 'warning', info: 'muted' };
const FAM = { preț: 'STRUCTURE', structură: 'STRUCTURE', volatilitate: 'FUNDAMENTALS', momentum: 'ATTENTION', volum: 'LIQUIDITY', mărime: 'HOLDERS', derivate: 'DERIVATIVES', regim: 'FLOW' };

function factorChip(f) {
  const body = html`<b>${f.label}</b>: ${f.text}<br>impact în probabilitate: ${f.contribution > 0 ? '+' : ''}${fix(f.contribution, 3)} log-odds
    ${f.runnersMedian ? html`<br>mediană runneri: ${f.runnersMedian} · restul: ${f.othersMedian}` : ''}`;
  return html`<span class="chip" data-fam="${FAM[f.family] ?? ''}" data-tone="${f.contribution > 0 ? 'good' : 'serious'}" data-tip="${tip(body)}"><i></i>${f.label}: <b>${f.text}</b></span>`;
}

function similarCell(c) {
  const refs = (c.references ?? []).filter((r) => isNum(r.similarity)).sort((a, b) => b.similarity - a.similarity);
  const best = refs[0];
  const nn = (c.similarTo ?? [])[0];
  return html`${best ? html`<div data-tip="${tip(html`Amprenta din ${best.date} (apoi ${pctFrac(best.gain, 0)} în 7 zile)`)}"><b>${best.symbol}</b> ${prob(best.similarity)}</div>` : ''}
    ${nn ? html`<small class="muted" data-tip="${tip(html`Cel mai apropiat runner istoric: ${nn.symbol} pe ${nn.date}, apoi ${pctFrac(nn.gain, 0)}`)}">${nn.symbol} ${nn.date} · ${prob(nn.similarity)}</small>` : ''}
    ${!best && !nn ? DASH : ''}`;
}

function rulesCell(c, rulesById) {
  if (!c.rulesMatched?.length) return html`<span class="muted">${DASH}</span>`;
  return html`<div class="chips">${c.rulesMatched.map((id) => {
    const r = rulesById[id];
    return html`<span class="pill" data-tip="${tip(r ? html`<b>${id}</b>: ${r.text}<br>precizie ${prob(r.precision)} · lift ×${fix(r.lift)} · ${r.support} cazuri out-of-time` : id)}">${id}</span>`;
  })}</div>`;
}

function allFactors(c) {
  return html`<details class="runner-all"><summary>toți factorii (${c.factors?.length ?? 0})</summary>
    <table class="movers"><thead><tr><th>Factor</th><th>Valoare</th><th>Impact</th><th>Mediană runneri</th><th>Mediană restul</th></tr></thead>
    <tbody>${(c.factors ?? []).map((f) => html`<tr>
      <td>${f.label}</td><td>${f.text}</td>
      <td class="${signClass(f.contribution)}">${f.contribution > 0 ? '+' : ''}${fix(f.contribution, 3)}</td>
      <td>${f.runnersMedian ?? DASH}</td><td>${f.othersMedian ?? DASH}</td></tr>`)}</tbody></table>
    ${c.context?.catalysts?.length ? html`<p class="muted">Evenimente 7 zile: ${c.context.catalysts.join(', ')}</p>` : ''}
    <p class="muted">Listat spot: ${(c.context?.spot ?? []).join(', ') || DASH} · perpetuale: ${c.context?.perps ?? 0}${c.context?.korean ? ' · bursă coreeană' : ''}${c.context?.alpha ? ' · Alpha' : ''}</p>
  </details>`;
}

function candidatesTable(d) {
  const rulesById = Object.fromEntries((d.rules ?? []).map((r) => [r.id, r]));
  if (!d.candidates.length) return html`<p class="muted">Niciun proiect nu depășește acum pragul (probabilitate ≥ 1,5× rata de bază sau ≥ 2 reguli).</p>`;
  return html`<table class="movers runners">
    <thead><tr><th>#</th><th>Token</th><th>Probabilitate</th><th>Factori principali</th><th>Reguli</th><th>Seamănă cu</th><th>Riscuri</th></tr></thead>
    <tbody>${d.candidates.map((c) => {
      const st = STAGE[c.stage] ?? { tone: 'muted', label: c.stage ?? DASH };
      return html`<tr>
        <td data-label="#">${c.rank}</td>
        <td data-label="Token"><b>${c.symbol ?? DASH}</b> <span class="muted">${c.name ?? ''}</span>
          <br><span class="pill" data-tone="${st.tone}" data-tip="${tip(c.stageWhy ?? '')}">${st.label}</span>
          <small class="muted">${c.chain ?? ''} · mcap ${usd(c.marketCap, { dec: 0 })} · vol ${usd(c.volume24h, { dec: 0 })}</small></td>
        <td data-label="Probabilitate"><b>${prob(c.probability)}</b> <span class="pill" data-tone="${TIER_TONE[c.tier] ?? 'muted'}" data-tip="${tip(html`Nivel ${c.tier}: ×${fix(c.lift)} față de rata de bază ${prob(d.metrics?.baseRate)}`)}">${c.tier} ×${fix(c.lift, 1)}</span>
          ${c.partialDay ? html`<br><small class="muted">zi în curs (${c.asOf})</small>` : html`<br><small class="muted">${c.asOf}</small>`}</td>
        <td data-label="Factori principali"><div class="chips">${(c.drivers ?? []).slice(0, 5).map(factorChip)}</div>${allFactors(c)}</td>
        <td data-label="Reguli">${rulesCell(c, rulesById)}</td>
        <td data-label="Seamănă cu">${similarCell(c)}</td>
        <td data-label="Riscuri"><div class="chips">${(c.risks ?? []).filter((r) => r.severity !== 'info').map((r) => html`<span class="pill" data-tone="${SEV_TONE[r.severity] ?? 'muted'}">${r.label}</span>`)}</div></td>
      </tr>`;
    })}</tbody></table>`;
}

function qualityLine(d) {
  const m = d.metrics ?? {};
  const body = html`Validare ${m.validation ?? DASH}; ${m.folds?.length ?? 0} perioade out-of-time.<br>
    AUC 0,5 = aleator, 1 = perfect. PR-AUC și precizia@10 se compară cu rata de bază (${prob(m.baseRate)}).<br>
    Antrenat pe ${m.trainRows ?? DASH} zile-activ (${m.trainFrom ?? DASH} → ${m.trainTo ?? DASH}), ${m.trainRunners ?? DASH} zile cu runner.`;
  return html`<p class="muted" data-tip="${tip(body)}">Model ${m.engine ?? DASH} · AUC out-of-time <b>${fix(m.auc, 3)}</b> · PR-AUC <b>${fix(m.prAuc, 3)}</b>
    · precizie top 10/zi <b>${prob(m.precisionAt10)}</b> vs bază ${prob(m.baseRate)} · top 1%: ×${fix(m.liftTop1pct, 1)}
    · ${d.universe?.assets ?? DASH} active, ${d.universe?.runnerEvents ?? DASH} runneri istorici · actualizat ${dateTime(d.generatedAt)}</p>`;
}

function factorsTable(d) {
  const rows = (d.factors ?? []).filter((f) => f.significant).slice(0, 16);
  if (!rows.length) return '';
  return html`<details class="runner-block" open><summary><h3>Ce au avut în comun runnerii (ziua dinaintea creșterii)</h3></summary>
    <p class="muted">Fiecare factor comparat între ziua dinaintea celor ${d.universe?.runnerEvents ?? DASH} aprinderi istorice și restul zilelor.
       AUC &gt; 0,5 = mai mare la runneri, &lt; 0,5 = mai mic; doar factorii semnificativi după corecția Benjamini–Hochberg.</p>
    <table class="movers"><thead><tr><th>Factor</th><th>Runneri (mediană)</th><th>Restul</th><th>AUC</th><th>Prag</th><th>Lift</th></tr></thead>
    <tbody>${rows.map((f) => html`<tr><td data-tip="${tip(f.hint ?? '')}">${f.label}</td><td><b>${f.runnersText}</b></td><td>${f.othersText}</td>
      <td>${fix(f.auc, 3)}</td><td>${f.thresholdText ? html`${f.direction === 'mai mare' ? '≥' : '≤'} ${f.thresholdText}` : DASH}</td><td>${f.lift ? `×${fix(f.lift)}` : DASH}</td></tr>`)}</tbody></table></details>`;
}

function rulesTable(d) {
  if (!d.rules?.length) return '';
  return html`<details class="runner-block"><summary><h3>Reguli învățate (${d.rules.length})</h3></summary>
    <p class="muted">Reguli DACĂ–ȘI extrase din arbori de decizie (stil skope-rules) și verificate pe ultima pătrime a istoricului, nevăzută la învățare.</p>
    <table class="movers"><thead><tr><th>ID</th><th>Regulă</th><th>Precizie</th><th>Lift</th><th>Cazuri</th><th>Recall</th></tr></thead>
    <tbody>${d.rules.map((r) => html`<tr><td>${r.id}</td><td>${r.text}</td><td>${prob(r.precision)}</td><td>×${fix(r.lift)}</td><td>${r.support}</td><td>${prob(r.recall)}</td></tr>`)}</tbody></table></details>`;
}

function referencesBlock(d) {
  if (!d.references?.length) return '';
  return html`<details class="runner-block"><summary><h3>Tiparele de referință</h3></summary>
    <table class="movers"><thead><tr><th>Token</th><th>Ziua dinaintea creșterii</th><th>Câștig max 7z</th><th>Factori distinctivi</th></tr></thead>
    <tbody>${d.references.map((r) => html`<tr><td><b>${r.symbol}</b><br><small class="muted">${r.note ?? ''}</small></td>
      <td>${r.resolved ? r.date : html`<span class="pill" data-tone="warning">nerezolvat</span>`}</td><td>${r.resolved ? pctFrac(r.gain, 0) : DASH}</td>
      <td><div class="chips">${(r.factors ?? []).map((f) => html`<span class="chip" data-tip="${tip(html`percentila ${f.percentile} în univers`)}"><i></i>${f.label}: <b>${f.text}</b></span>`)}</div></td></tr>`)}</tbody></table></details>`;
}

function eventsBlock(d) {
  if (!d.events?.length) return '';
  return html`<details class="runner-block"><summary><h3>Runneri recenți (60 zile) și factorii lor</h3></summary>
    <table class="movers"><thead><tr><th>Token</th><th>Zi semnal</th><th>Câștig max 7z</th><th>Factori distinctivi</th></tr></thead>
    <tbody>${d.events.map((e) => html`<tr><td><b>${e.symbol}</b> <span class="muted">${e.name ?? ''}</span></td><td>${e.date}</td>
      <td class="pos">${pctFrac(e.gain, 0)}</td>
      <td><div class="chips">${(e.factors ?? []).map((f) => html`<span class="chip" data-tip="${tip(html`percentila ${f.percentile}`)}"><i></i>${f.label}: <b>${f.text}</b></span>`)}</div></td></tr>`)}</tbody></table></details>`;
}

export function runnersMarkup() {
  if (runnersState.status === 'idle' || runnersState.status === 'loading') {
    return html`<div class="frame"><h2>Potențiali runneri — următoarele 7 zile</h2><p class="muted">Se încarcă lista de potențiali runneri…</p></div>`;
  }
  if (runnersState.status === 'error') {
    return html`<div class="frame"><h2>Potențiali runneri — următoarele 7 zile</h2><p class="muted">${runnersState.error}</p></div>`;
  }
  const d = runnersState.data;
  return html`<div class="frame">
    <h2>Potențiali runneri — următoarele 7 zile</h2>
    <p class="muted">${d.target?.definition ?? ''}. Lista arată proiectele care au ACUM factorii comuni ai runnerilor istorici
      (EVAA, IRYS, BR și toți ceilalți detectați automat), cu probabilitatea calibrată, regulile potrivite, similaritatea și riscurile.
      Nu e recomandare de investiții.</p>
    ${qualityLine(d)}
    ${candidatesTable(d)}
    ${factorsTable(d)}${rulesTable(d)}${referencesBlock(d)}${eventsBlock(d)}
    ${(d.notes ?? []).length ? html`<p class="muted">${d.notes.join(' ')}</p>` : ''}
  </div>`;
}
