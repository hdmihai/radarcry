/**
 * RESEARCH PYTHON — cross-sectional research published by the Python bridge
 * (services/analyst-python/research), attached to latest.json by `attach-research`.
 *
 * The screen computes nothing: it renders `snap.research.momentum` and
 * `snap.research.liquidity` exactly as published. Fields the engine could not compute
 * (gaps[]) stay `—`; we never fake a zero or an "N/A". If the CI steps were fail-soft
 * and the field is absent, the screen renders a calm message instead of an error.
 */
import { html, tip } from '../core/dom.js';
import { DASH, frac, num, pct, signClass } from '../core/format.js';

const TOP_N = 15;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function benchmarkTip(b) {
  if (b === 'crossSectionalMedian') {
    return tip('Outperformance față de mediana cross-sectională a celor 120 de active din discovery în aceeași rulare. BTC nu face parte din eșantion (e benchmark-ul de referință).');
  }
  if (b === 'BTC') return tip('Outperformance față de BTC în aceeași perioadă.');
  return tip('Benchmark raportat de motor.');
}

function missingMark(why) {
  return html`<span class="muted" data-tip="${tip(why ?? 'Nu a putut fi calculat în această rulare (lipsă time series sau date insuficiente).')}">${DASH}</span>`;
}

function momentumTable(features) {
  const rows = Object.entries(features)
    .filter(([, f]) => isNum(f?.outperformance7d))
    .sort((a, b) => b[1].outperformance7d - a[1].outperformance7d)
    .slice(0, TOP_N);
  if (!rows.length) return html`<p class="muted">Momentum cross-sectional indisponibil în această rulare.</p>`;
  return html`<table class="movers">
    <thead><tr>
      <th>#</th><th>Token</th>
      <th data-tip="${tip('Randamentul pe 7 zile minus mediana cross-sectională a celor 120 de active din discovery. Pozitiv = a mers mai bine decât media pieței cercetate.')}">Outperformance 7z</th>
      <th data-tip="${tip('h24 × 0.2 + d7 × 0.5 + d30 × 0.3. Un scor compozit care favorizează trendul pe 7 zile, cu confirmare pe 24h și 30z.')}">Composite</th>
      <th data-tip="${tip('Rotație: volum 24h / capitalizare. Valori mici = lichiditate subțire.')}">Turnover</th>
      <th data-tip="${tip('Cât de devreme e mișcarea în raport cu norma activului (percentilă).')}">Earliness</th>
      <th data-tip="${tip('Variația open interest. Câmpul poate lipsi când activul nu e listat pe futures.')}">OI Δ</th>
    </tr></thead>
    <tbody>
      ${rows.map(([sym, f], i) => html`<tr>
        <td>${i + 1}</td>
        <td><b>${sym}</b></td>
        <td class="${signClass(f.outperformance7d)}" data-tip="${benchmarkTip(f.benchmark)}">${pct(f.outperformance7d, { dec: 2 })}</td>
        <td class="${signClass(f.momentumComposite)}">${isNum(f.momentumComposite) ? num(f.momentumComposite, 2) : DASH}</td>
        <td>${isNum(f.turnover) ? frac(f.turnover, 1) : missingMark('Turnover indisponibil: lipsește volumul 24h pentru acest activ în rularea curentă.')}</td>
        <td>${isNum(f.earliness) ? num(f.earliness, 2) : missingMark('Earliness nu a putut fi calculat: lipsește seria de preț pentru percentile.')}</td>
        <td>${isNum(f.oiChangePct) ? pct(f.oiChangePct, { dec: 2 }) : missingMark('Open interest nu e publicat pentru acest activ sau lipsește seria de 14 zile.')}</td>
      </tr>`)}
    </tbody>
  </table>`;
}

function discoveryTable(discovery) {
  const rows = Object.entries(discovery)
    .filter(([, f]) => isNum(f?.researchComposite))
    .sort((a, b) => b[1].researchComposite - a[1].researchComposite)
    .slice(0, TOP_N);

  if (!rows.length) {
    return html`<p class="muted">Research composite pentru discovery indisponibil în această rulare.</p>`;
  }

  return html`
    <p class="muted xs">Node nu scorează discovery în această rulare; se afișează doar research composite. Agreement nu este relevant aici.</p>
    <table class="movers">
      <thead><tr>
        <th>#</th><th>Token</th>
        <th>Research composite</th>
        <th>Gaps</th>
      </tr></thead>
      <tbody>
        ${rows.map(([sym, f], i) => html`<tr>
          <td>${i + 1}</td>
          <td><b>${sym}</b></td>
          <td>${num(f.researchComposite, 3)}</td>
          <td class="xs muted">${(f.gaps ?? []).join(', ') || DASH}</td>
        </tr>`)}
      </tbody>
    </table>`;
}

function liquidityTable(futures) {
  const rows = Object.entries(futures).sort((a, b) => {
    const ac = isNum(a[1]?.researchComposite) ? 1 : 0;
    const bc = isNum(b[1]?.researchComposite) ? 1 : 0;
    if (ac !== bc) return bc - ac;
    return (b[1]?.nodeFuturesScore ?? 0) - (a[1]?.nodeFuturesScore ?? 0);
  });
  if (!rows.length) return html`<p class="muted">Lichiditate futures indisponibilă în această rulare.</p>`;
  const withComposite = rows.filter(([, f]) => isNum(f?.researchComposite)).length;
  return html`
    <p class="muted xs">${withComposite} din ${rows.length} perechi futures au composite publicat de motor. Restul apar cu ${DASH} pe composite și agreement — lipsa e documentată în <code>gaps</code> al fiecărei intrări, nu ascunsă.</p>
    <table class="movers">
      <thead><tr>
        <th>#</th><th>Token</th>
        <th data-tip="${tip('Scorul Node (0–100) din motorul principal. Prezent pentru toate cele 40 de perechi futures.')}">Node score</th>
        <th data-tip="${tip('Scorul compozit din research-ul Python. Poate lipsi când motorul nu a avut factori suficienți.')}">Research composite</th>
        <th data-tip="${tip('Cât de bine se aliniază scorul Node cu research-ul Python (0–1, afișat %). Calculat doar când ambele scoruri există.')}">Agreement</th>
        <th>Gaps</th>
      </tr></thead>
      <tbody>
        ${rows.map(([sym, f], i) => html`<tr>
          <td>${i + 1}</td>
          <td><b>${sym}</b></td>
          <td>${isNum(f.nodeFuturesScore) ? num(f.nodeFuturesScore, 0) : DASH}</td>
          <td>${isNum(f.researchComposite) ? num(f.researchComposite, 3) : missingMark('Research composite nu a putut fi calculat: factori insuficienți (vezi gaps).')}</td>
          <td>${isNum(f.agreement) ? frac(f.agreement, 1) : missingMark('Acordul necesită ambele scoruri; apare doar când ambele sunt disponibile.')}</td>
          <td class="xs muted">${(f.gaps ?? []).join(', ') || DASH}</td>
        </tr>`)}
      </tbody>
    </table>`;
}

function gapsSummary(momentumFeatures) {
  const seen = new Map();
  const why = {
    gainFrom20dLow: 'Lipsește seria de preț — latest.json nu are priceHistory.',
    risingLows: 'Lipsește seria de preț — nu putem identifica minime ascendente.',
    volumeTrendUp: 'Lipsește seria de volum — nu putem măsura trendul.',
    openInterestChange14d: 'Lipsește seria de open interest — nu putem calcula variația pe 14 zile.',
    oiChangePct: 'Open interest indisponibil pentru acest activ în rularea curentă.',
  };
  for (const f of Object.values(momentumFeatures ?? {})) {
    for (const g of f?.gaps ?? []) {
      if (!seen.has(g)) seen.set(g, { count: 0, why: why[g] ?? 'Câmp documentat ca indisponibil de motorul Python.' });
      seen.get(g).count += 1;
    }
  }
  const entries = [...seen.entries()].sort((a, b) => b[1].count - a[1].count);
  if (!entries.length) return '';
  return html`<details>
    <summary class="muted">Câmpuri documentate ca indisponibile (${entries.length} tipuri)</summary>
    <table class="movers">
      <thead><tr><th>Câmp</th><th>Apariții</th><th>Motiv</th></tr></thead>
      <tbody>
        ${entries.map(([key, { count, why: w }]) => html`<tr>
          <td><code>${key}</code></td>
          <td>${count}</td>
          <td class="small muted">${w}</td>
        </tr>`)}
      </tbody>
    </table>
    <p class="muted xs">Aceste valori nu sunt 0 și nu sunt ascunse — sunt imposibil de calculat din snapshot-uri instantanee (latest.json nu conține serii istorice de preț, volum sau open interest).</p>
  </details>`;
}

export function researchPythonMarkup(snap) {
  const r = snap?.research;
  if (!r) {
    return html`<div class="frame">
      <h2>Research Python — nu e publicat încă</h2>
      <div class="empty" style="margin-top:12px;text-align:left;max-width:720px">
        <p class="muted">Research-ul cross-sectional (momentum + lichiditate) e produs de modulul Python
        <code>services/analyst-python/research</code> și înglobat în <code>latest.json</code> de
        <code>attach-research</code>. În această rulare a CI, cele două steps rulează fail-soft — nu blochează
        pipeline-ul, dar nici nu produc research. Ecranul va apărea automat după prima rulare completă.</p>
      </div>
    </div>`;
  }
  const mf = r.momentum?.features ?? {};
  const lf = r.liquidity?.futures ?? {};
  const ld = r.liquidity?.discovery ?? {};
  const mm = r.momentum?.meta ?? {};
  const lm = r.liquidity?.meta ?? {};
  const schema = mm.schemaVersion ?? lm.schemaVersion ?? DASH;

  return html`<div class="frame">
    <h2>Research Python — cross-sectional</h2>
    <p class="muted">Research produs de modulul Python și înglobat în <code>latest.json</code> de
      <code>attach-research</code>. Ecranul nu calculează nimic: afișează exact ce a publicat motorul.
      Câmpurile imposibile (lipsă time series) apar ca ${DASH}, niciodată ca 0 sau ca un substitut.</p>
    <p class="muted xs">Schemă research <b>${schema}</b>
      · discovery ${mm.discoveryCount ?? lm.discoveryCount ?? DASH}
      · futures ${mm.futuresCount ?? lm.futuresCount ?? DASH}
      · squeeze ${mm.squeezeCount ?? lm.squeezeCount ?? DASH}</p>

    <h3>Momentum cross-sectional — top ${TOP_N} după outperformance 7z</h3>
    <p class="muted xs">Benchmark: mediana cross-sectională a celor 120 de active din discovery, calculată în aceeași rulare. BTC nu face parte din eșantion.</p>
    ${momentumTable(mf)}

    <h3>Lichiditate futures</h3>
    ${liquidityTable(lf)}

    <h3>Lichiditate discovery</h3>
    ${discoveryTable(ld)}

    ${gapsSummary(mf)}
  </div>`;
}

export function researchPythonCount(snap) {
  const n = snap?.research?.momentum?.features;
  return n ? Object.keys(n).length : null;
}
