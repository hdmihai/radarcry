/**
 * MOMENTUM ÎN TREPTE — reguli pe lumânări 1h/4h, nu model.
 * Datele vin din `data/step-momentum.json`, produs de `services/analyst-python/step_momentum`.
 * View-ul nu calculează: scorul, condițiile și metricile sunt output-ul motorului.
 */
import { html, tip } from '../core/dom.js';
import { DASH, pct, usd } from '../core/format.js';

export const stepMomentumState = { status: 'idle', data: null, error: null };
let pending = null;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const ratio = (x) => (isNum(x) ? `×${x.toFixed(2)}` : DASH);

export function ensureStepMomentum(url = 'data/step-momentum.json') {
  if (stepMomentumState.status === 'ready' || stepMomentumState.status === 'error') return Promise.resolve();
  stepMomentumState.status = 'loading';
  pending ??= fetch(url, { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(res.status === 404 ? 'data/step-momentum.json nu există încă — se publică la următoarea scanare completă' : `HTTP ${res.status}`);
      const doc = await res.json();
      if (!doc || !Array.isArray(doc.stepMomentum) || doc.method !== 'rules') throw new Error('structură neașteptată a fișierului step-momentum.json');
      stepMomentumState.data = doc;
      stepMomentumState.status = 'ready';
    })
    .catch((err) => {
      stepMomentumState.status = 'error';
      stepMomentumState.error = String(err?.message ?? err);
    });
  return pending;
}

function conditionPills(item, rulesByKey) {
  return html`<div class="chips">${Object.entries(item.conditions ?? {}).map(([key, value]) => {
    const tone = value === true ? 'good' : value === false ? 'serious' : 'muted';
    const word = value === true ? 'da' : value === false ? 'nu' : 'necunoscut';
    const text = rulesByKey[key]?.text ?? key;
    return html`<span class="pill" data-tone="${tone}" data-tip="${tip(text)}">${word}</span>`;
  })}</div>`;
}

const SECTOR_LABELS = { 'ai-agents': 'AI Agents', 'binance-smart-chain': 'BNB Chain', 'meme-token': 'Meme' };
const sectorLabel = (id) => SECTOR_LABELS[id] ?? id;

/** Sectoarele proiectului ca pastile. Procentul este media pe 7 zile a sectorului, calculată de motor. */
function sectorCell(item) {
  const sectors = Array.isArray(item.sectors) ? item.sectors : [];
  if (!sectors.length) return html`${DASH}`;
  const momentum = item.sectorMomentum ?? {};
  const pills = sectors.map((id) => {
    const value = momentum[id];
    const known = isNum(value);
    const tipAttr = known ? html` data-tip="${tip('Media pe 7 zile a membrilor sectorului evaluați în această rulare.')}"` : '';
    return html`<span class="pill" data-tone="muted"${tipAttr}>${sectorLabel(id)}${known ? html` ${pct(value, { dec: 1 })}` : ''}</span>`;
  });
  return html`<div class="chips">${pills}</div>`;
}

export function stepMomentumMarkup() {
  const doc = stepMomentumState.data;
  const meta = doc?.stepMomentumMeta;
  const items = doc?.stepMomentum ?? [];
  const rulesByKey = Object.fromEntries((doc?.rules ?? []).map((r) => [r.key, r]));

  let body;
  if (stepMomentumState.status === 'loading') {
    body = html`<p class="muted">Se încarcă momentum în trepte…</p>`;
  } else if (stepMomentumState.status === 'error') {
    body = html`<p class="error">${stepMomentumState.error}</p>`;
  } else if (stepMomentumState.status !== 'ready') {
    body = html`<p class="muted">Lista se încarcă la deschiderea ecranului, din data/step-momentum.json.</p>`;
  } else if (!items.length) {
    body = html`<p class="muted">Niciun proiect verificat nu îndeplinește regulile în această rulare.</p>`;
  } else {
    body = html`<table class="movers">
      <thead><tr>
        <th>#</th><th>Proiect</th><th>Sectoare</th><th>Scor</th><th>7 zile vs BTC</th><th>De la minimul de 20 zile</th><th>Open interest 14 zile</th>
      </tr></thead>
      <tbody>
        ${items.map((item, idx) => html`<tr>
          <td>${idx + 1}</td>
          <td>
            <b>${item.symbol || DASH}</b> <span class="muted">${item.name || ''}</span>
            ${item.futuresOnly ? html`<br><span class="pill" data-tone="warning">doar futures</span>` : ''}
            <br><small class="muted">mcap ${usd(item.marketCap, { dec: 0 })} · vol ${usd(item.volume24h, { dec: 0 })}</small>
            <details><summary>condiții ${isNum(item.score) ? item.score : DASH}/${isNum(item.known) ? item.known : DASH}</summary>
              ${conditionPills(item, rulesByKey)}
            </details>
          </td>
          <td>${sectorCell(item)}</td>
          <td><b>${isNum(item.score) ? item.score : DASH}/${isNum(item.known) ? item.known : DASH}</b></td>
          <td>${pct(item.metrics?.outperformance7dPct, { dec: 1 })}</td>
          <td>${pct(item.metrics?.gainFrom20dLowPct, { dec: 1 })}</td>
          <td>${pct(item.metrics?.openInterestChange14dPct, { dec: 1 })}${isNum(item.metrics?.longShortTaker) ? html`<br><small class="muted">L/S taker ${ratio(item.metrics.longShortTaker)}</small>` : ''}</td>
        </tr>`)}
      </tbody>
    </table>`;
  }

  const metaLine = meta
    ? html`<p class="muted">Verificate pe Gate: ${meta.withGate ?? DASH} · evaluate: ${meta.evaluatedCount ?? DASH} · semnalate: ${meta.signaledCount ?? DASH} · futures-only: ${meta.futuresOnlyCount ?? DASH} · amânate de buget: ${meta.deferredByBudget ?? 0}</p>`
    : '';
  const notes = (doc?.notes ?? []).map((note) => html`<p class="muted">${note}</p>`);

  return html`<div class="frame">
    <h2>Momentum în trepte</h2>
    <p class="muted">Proiecte mici verificate, listate pe Gate, aflate într-o urcare în trepte (1h confirmat pe 4h) — nu o mișcare deja epuizată. Regulile sunt fixe; nu este modelul LightGBM de pe ecranul Top 7 zile.</p>
    ${metaLine}
    ${notes}
    ${body}
  </div>`;
}
