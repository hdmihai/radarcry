/**
 * UNIVERS — the whole research horizon on one screen: every project the run researched (all the
 * eligible small caps of the top-1000 universe plus the exchange Alpha lists) and every perpetual
 * market of the Futures Radar, one row each.
 *
 * The rows come from data/universe.json, which the engine publishes next to the dashboard contract
 * and which this view loads only when it is opened: a thousand rows should not slow down the page
 * a researcher opens every morning. Nothing is recomputed here — the table is the engine's own
 * output, filtered and sorted.
 */
import { html, tip } from '../core/dom.js';
import { dateTime, num, pct, price, score, signClass, usd } from '../core/format.js';
import { icon } from '../core/labels.js';
import { futuresGradeBadge } from './widgets.js';

const PAGE = 100;

export const universeState = {
  status: 'idle', // idle | loading | ready | error
  data: null,
  error: null,
  tab: 'assets',
  q: '',
  alpha: 'ALL',
  valid: 'V',
  stage: 'ALL',
  only: 'ALL',
  sort: 'rank',
  shown: PAGE,
};

/** Rows of one table as objects, with the engine's rank (1-based, publication order). */
export function decodeTable(table) {
  const fields = table?.fields ?? [];
  return (table?.rows ?? []).map((row, i) => {
    const o = { rank: i + 1 };
    fields.forEach((f, j) => { o[f] = row[j]; });
    return o;
  });
}

let pending = null;
/** Load data/universe.json once per page view; resolves when the state is ready or failed. */
export function ensureUniverse(url = 'data/universe.json') {
  if (universeState.status === 'ready' || universeState.status === 'error') return Promise.resolve();
  universeState.status = 'loading';
  pending ??= fetch(url, { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(res.status === 404 ? 'data/universe.json nu există încă — se publică la următoarea scanare completă' : `HTTP ${res.status}`);
      const doc = await res.json();
      if (!doc?.assets?.fields || !Array.isArray(doc.assets.rows)) throw new Error('structură neașteptată a fișierului universe.json');
      universeState.data = { ...doc, assetRows: decodeTable(doc.assets), futuresRows: decodeTable(doc.futures) };
      universeState.status = 'ready';
    })
    .catch((err) => {
      universeState.status = 'error';
      universeState.error = String(err?.message ?? err);
    });
  return pending;
}

const STAGE_LABEL = { 0: 'neconfirmat', 1: 'acumulare', 2: 'multi-factor', 3: 'expansiune', 4: 'târziu' };
const BAND_LABEL = { HIGH_POTENTIAL: 'potențial ridicat', CONFIRMED: 'confirmat', EARLY: 'timpuriu', WATCH: 'de urmărit', IGNORE: 'ignorat', UNKNOWN: 'necunoscut' };
const DETAIL = {
  full: { label: 'fișă completă', tone: 'good' },
  card: { label: 'card în radar', tone: 'muted' },
  list: { label: 'rând în radar', tone: 'muted' },
  research: { label: 'cercetat, doar aici', tone: 'muted' },
  table: { label: 'doar piață', tone: 'muted' },
};

const SORTS = [
  { id: 'rank', label: 'Ordinea motorului' },
  { id: 'opportunity', label: 'Oportunitate' },
  { id: 'earliness', label: 'Precocitate' },
  { id: 'changes', label: 'Număr de schimbări' },
  { id: 'risk', label: 'Risc (crescător)' },
  { id: 'cri', label: 'Scor CRI' },
  { id: 'mcap', label: 'Capitalizare (crescător)' },
  { id: 'chg7d', label: 'Variație 7 zile' },
  { id: 'fut', label: 'Notă futures' },
];

const ONLY = [
  { id: 'ALL', label: 'Toate' },
  { id: 'answers', label: 'Răspund la întrebare' },
  { id: 'early', label: 'Candidați timpurii' },
  { id: 'simultaneous', label: 'Schimbări simultane' },
  { id: 'moving', label: 'Cu schimbări' },
  { id: 'perps', label: 'Cu perpetue' },
];

/** Tables published before the validity gate have no `valid` column: nothing to filter on. */
const hasValidity = (data) => (data?.assets?.fields ?? []).includes('valid');

function filtered(rows, gate = true) {
  const st = universeState;
  const q = st.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.symbol} ${r.name} ${r.key}`.toLowerCase().includes(q)) return false;
    if (gate && st.valid !== 'ALL' && r.valid !== st.valid) return false;
    const alpha = String(r.alpha ?? '');
    if (st.alpha === 'ANY' && !alpha) return false;
    if (st.alpha === 'B' && !alpha.includes('B')) return false;
    if (st.alpha === 'G' && !alpha.includes('G')) return false;
    if (st.alpha === 'BOTH' && !(alpha.includes('B') && alpha.includes('G'))) return false;
    if (st.alpha === 'NONE' && alpha) return false;
    if (st.stage !== 'ALL' && String(r.stage) !== st.stage) return false;
    if (st.only === 'answers' && r.answers !== 1) return false;
    if (st.only === 'early' && r.early !== 1) return false;
    if (st.only === 'simultaneous' && r.simultaneous !== 1) return false;
    if (st.only === 'moving' && !(r.changes > 0)) return false;
    if (st.only === 'perps' && !(r.perps > 0)) return false;
    return true;
  });
}

const GRADE_RANK = { 'A++': 6, 'A+': 5, A: 4, B: 3, NO_TRADE: 0 };
function sorted(rows) {
  const by = {
    opportunity: (r) => r.opportunity,
    earliness: (r) => r.earliness,
    changes: (r) => (Number.isFinite(r.changes) ? r.changes * 10 + (r.families ?? 0) : null),
    cri: (r) => r.cri,
    chg7d: (r) => r.chg7d,
    fut: (r) => (r.futGrade ? (GRADE_RANK[r.futGrade] ?? 0) * 1000 + (r.futScore ?? 0) : null),
  };
  const st = universeState.sort;
  if (st === 'rank') return rows;
  const asc = st === 'risk' || st === 'mcap';
  const f = st === 'risk' ? (r) => r.risk : st === 'mcap' ? (r) => r.marketCap : by[st];
  return [...rows].sort((a, b) => {
    const va = f(a);
    const vb = f(b);
    const na = Number.isFinite(va);
    const nb = Number.isFinite(vb);
    if (!na && !nb) return a.rank - b.rank;
    if (!na) return 1;
    if (!nb) return -1;
    return asc ? va - vb : vb - va;
  });
}

const alphaChips = (alpha) => {
  const a = String(alpha ?? '');
  if (!a) return '';
  return html`${a.includes('B') ? html`<span class="chip" data-tip="${tip('Listat în Binance Alpha (lista publică oficială)')}">Binance Alpha</span>` : ''}${a.includes('G') ? html`<span class="chip" data-tip="${tip('Listat în Gate Alpha (API v4 public); singur nu ajunge pentru validare')}">Gate Alpha</span>` : ''}`;
};

/** One letter per centralised spot market, as published by the engine (universe-view SPOT_CODE). */
const SPOT_NAME = { B: 'Binance', M: 'MEXC', G: 'Gate', O: 'OKX', T: 'Bitget', U: 'Upbit', H: 'Bithumb' };
const spotChips = (spot) => String(spot ?? '').split(',').filter(Boolean)
  .map((c) => html`<span class="chip" data-tone="good" data-tip="${tip(`Piață spot ${SPOT_NAME[c] ?? c} cu volum în ultimele 24 h`)}">${SPOT_NAME[c] ?? c}</span>`);

function listingChips(r) {
  const spot = spotChips(r.spot);
  const alpha = alphaChips(r.alpha);
  const perps = r.perps > 0 ? html`<span class="chip" data-tip="${tip(`${r.perps} ${r.perps === 1 ? 'contract perpetuu' : 'contracte perpetue'} pe bursele citite`)}">perp ×${r.perps}</span>` : '';
  if (!spot.length && !alpha && !perps) return html`<span class="muted xs">nelistat</span>`;
  return html`${spot}${alpha}${perps}`;
}

/** The same listings as two compact lines for the table: spot markets, then Alpha and perpetuals. */
function listingCell(r) {
  const spot = String(r.spot ?? '').split(',').filter(Boolean).map((c) => SPOT_NAME[c] ?? c);
  const a = String(r.alpha ?? '');
  const extra = [a.includes('B') ? 'Binance Alpha' : null, a.includes('G') ? 'Gate Alpha' : null, r.perps > 0 ? `perp ×${r.perps}` : null].filter(Boolean);
  if (!spot.length && !extra.length) return html`<span class="muted xs">nelistat</span>`;
  return html`<span class="tok" data-tip="${tip(`Spot (volum în 24 h): ${spot.length ? spot.join(', ') : 'niciuna'}${extra.length ? ` · ${extra.join(' · ')}` : ''}`)}"><span>${spot.length ? spot.join(', ') : html`<span class="muted">fără spot</span>`}</span><span class="tok-sub">${extra.join(' · ')}</span></span>`;
}

const VALID_PILL = {
  V: { label: 'verificat', tone: 'good', icon: 'check' },
  P: { label: 'în verificare', tone: 'muted', icon: 'clock' },
  R: { label: 'respins', tone: 'critical', icon: 'stop' },
};

/** The validity verdict of one row; the reason is in the tooltip (and in the Validare screen). */
function validPill(r) {
  const v = VALID_PILL[r.valid];
  if (!v) return html`<span class="muted xs">—</span>`;
  const warn = r.valid === 'V' && r.validWarn > 0 ? ` · ${r.validWarn} aten.` : '';
  const why = r.validWhy ?? (r.valid === 'V' ? (r.validWarn > 0 ? `A trecut toate verificările obligatorii, cu ${r.validWarn} ${r.validWarn === 1 ? 'atenționare' : 'atenționări'} (detaliile în fișa proiectului).` : 'A trecut toate verificările obligatorii.') : '');
  return html`<span class="pill" data-tone="${v.tone}" data-tip="${tip(why)}">${icon(v.icon, 11)} ${v.label}${warn}</span>`;
}

function openAction(r, s) {
  if (r.detail === 'full') return html`<button class="linkish xs" type="button" data-dossier="${r.key}">dosar</button>`;
  if (s.byKey?.has(r.key)) return html`<button class="linkish xs" type="button" data-open="${r.key}">fișă</button>`;
  const d = DETAIL[r.detail] ?? DETAIL.table;
  return html`<span class="muted xs">${d.label}</span>`;
}

function assetRow(r, s) {
  return html`<tr>
    <td class="n muted">${r.rank}</td>
    <td><span class="tok"><span>${r.symbol}</span><span class="tok-sub">${r.name}${r.chain ? `, ${r.chain}` : ''}</span></span></td>
    <td>${validPill(r)}</td>
    <td class="ucol-list">${listingCell(r)}</td>
    <td>${Number.isFinite(r.stage) ? html`<span class="tok"><span>Stage ${r.stage}</span><span class="tok-sub">${STAGE_LABEL[r.stage] ?? ''}${r.band ? ` · ${BAND_LABEL[r.band] ?? r.band}` : ''}</span></span>` : html`<span class="muted xs">necercetat</span>`}</td>
    <td class="n">${score(r.opportunity)}</td>
    <td class="n">${score(r.earliness)}</td>
    <td class="n ${Number.isFinite(r.risk) && r.risk >= 60 ? 'neg' : ''}">${score(r.risk)}</td>
    <td class="n">${Number.isFinite(r.changes) ? html`<span class="tok"><span>${r.changes}${r.simultaneous === 1 ? html` <span class="pill" data-tone="good">simultan</span>` : ''}</span><span class="tok-sub">${r.families ?? 0} familii</span></span>` : '—'}</td>
    <td class="n"><span class="tok"><span>${score(r.cri)}</span><span class="tok-sub">${r.analog ? `${r.analog} ${r.analogSim ?? ''}` : ''}</span></span></td>
    <td>${r.futGrade ? futuresGradeBadge(r.futGrade) : html`<span class="muted xs">${r.perps > 0 ? 'neevaluat' : 'fără perp'}</span>`}</td>
    <td class="n"><span class="tok"><span>${usd(r.marketCap)}</span><span class="tok-sub num ${signClass(r.chg7d)}">${pct(r.chg7d)} 7z</span></span></td>
    <td class="n"><span class="tok"><span>${num(r.holders)}</span><span class="tok-sub">${usd(r.liquidityUsd)} lichid.</span></span></td>
    <td>${openAction(r, s)}</td>
  </tr>`;
}

function assetCard(r, s) {
  return html`<div class="card-row">
    <span class="tok"><b>${r.rank}. ${r.symbol}</b><span class="tok-sub">${r.name}</span></span>
    <span>${validPill(r)}</span>
    ${r.validWhy ? html`<span class="line xs muted">${r.validWhy}</span>` : ''}
    <span class="line"><span class="chips xs">${listingChips(r)}</span></span>
    <span class="line">${Number.isFinite(r.stage) ? `Stage ${r.stage} · ` : 'necercetat · '}oportunitate ${score(r.opportunity)} · precocitate ${score(r.earliness)} · risc ${score(r.risk)}</span>
    <span class="line">${Number.isFinite(r.changes) ? `${r.changes} schimbări în ${r.families ?? 0} familii${r.simultaneous === 1 ? ' (simultan)' : ''}` : ''} · ${usd(r.marketCap)} · ${pct(r.chg7d)} 7z ${r.futGrade ? futuresGradeBadge(r.futGrade) : ''} ${openAction(r, s)}</span>
  </div>`;
}

function futuresRow(f) {
  return html`<tr>
    <td class="n muted">${f.rank}</td>
    <td><span class="tok"><span>${f.symbol}</span><span class="tok-sub">${f.name}</span></span></td>
    <td>${futuresGradeBadge(f.grade)}</td>
    <td class="n">${score(f.score)}</td>
    <td>${f.trend ? String(f.trend).toLowerCase().replace('_', ' ') : '—'}</td>
    <td class="n">${score(f.setup)}</td>
    <td class="n">${Number.isFinite(f.fundingPct8h) ? `${f.fundingPct8h > 0 ? '+' : ''}${f.fundingPct8h.toFixed(4)}%` : '—'}</td>
    <td class="n">${usd(f.oiUsd)}</td>
    <td class="xs">${f.venues || '—'}</td>
    <td class="n"><span class="tok"><span>$${price(f.price)}</span><span class="tok-sub num ${signClass(f.chg24h)}">${pct(f.chg24h)} 24h</span></span></td>
    <td class="xs">${f.bias ? html`${f.bias} · intrare $${price(f.entry)} · invalidare $${price(f.stop)} · țintă $${price(f.target1)}${Number.isFinite(f.rr1) ? ` · ${f.rr1}R` : ''}` : html`<span class="muted">fără nivele</span>`}</td>
  </tr>`;
}

function assetsPanel(s, data) {
  const st = universeState;
  const all = data.assetRows;
  const gated = hasValidity(data);
  if (!gated) st.valid = 'ALL';
  const rows = sorted(filtered(all, gated));
  const visible = rows.slice(0, st.shown);
  const counts = {
    alpha: all.filter((r) => r.alpha).length,
    both: all.filter((r) => String(r.alpha ?? '').includes('B') && String(r.alpha ?? '').includes('G')).length,
    researched: all.filter((r) => Number.isFinite(r.stage)).length,
    V: all.filter((r) => r.valid === 'V').length,
    P: all.filter((r) => r.valid === 'P').length,
    R: all.filter((r) => r.valid === 'R').length,
  };
  return html`
    <div class="qbar">
      <div class="qstat"><b class="num">${num(all.length)}</b><span>proiecte eligibile</span><small class="muted">small caps din top 1000 + listele Alpha</small></div>
      ${gated ? html`<div class="qstat" data-tone="good"><b class="num">${num(counts.V)}</b><span>verificate</span><small class="muted">${num(counts.P)} în verificare · <a href="#/validare">${num(counts.R)} respinse</a></small></div>` : ''}
      <div class="qstat"><b class="num">${num(counts.researched)}</b><span>cercetate de motor</span><small class="muted">norme proprii, schimbări, risc</small></div>
      <div class="qstat"><b class="num">${num(counts.alpha)}</b><span>în programe Alpha</span><small class="muted">${num(counts.both)} în Binance și Gate deodată</small></div>
      <div class="qstat"><b class="num">${num(data.futuresRows.length)}</b><span>piețe perpetue</span><small class="muted">evaluate de Futures Radar</small></div>
    </div>
    <div class="filters">
      <label class="search"><span class="sr-only">Caută</span>${icon('search', 14)}<input type="search" id="usearch" placeholder="Caută simbol sau nume" value="${st.q}" autocomplete="off"></label>
      ${gated ? html`<select class="select" id="uvalid" aria-label="Validare">
        ${[['V', `Verificate (${num(counts.V)})`], ['ALL', 'Orice stare de validare'], ['P', `În verificare (${num(counts.P)})`], ['R', `Respinse (${num(counts.R)})`]].map(([v, l]) => html`<option value="${v}" ${st.valid === v ? 'selected' : ''}>${l}</option>`)}
      </select>` : ''}
      <select class="select" id="ualpha" aria-label="Program Alpha">
        ${[['ALL', 'Orice listare'], ['ANY', 'Orice program Alpha'], ['B', 'Binance Alpha'], ['G', 'Gate Alpha'], ['BOTH', 'Binance și Gate'], ['NONE', 'Fără program Alpha']].map(([v, l]) => html`<option value="${v}" ${st.alpha === v ? 'selected' : ''}>${l}</option>`)}
      </select>
      <select class="select" id="ustage" aria-label="Stadiu">
        ${[['ALL', 'Orice stadiu'], ...[0, 1, 2, 3, 4].map((x) => [String(x), `Stage ${x} · ${STAGE_LABEL[x]}`])].map(([v, l]) => html`<option value="${v}" ${st.stage === v ? 'selected' : ''}>${l}</option>`)}
      </select>
      <select class="select" id="uonly" aria-label="Filtru">${ONLY.map((o) => html`<option value="${o.id}" ${st.only === o.id ? 'selected' : ''}>${o.label}</option>`)}</select>
      <select class="select" id="usort" aria-label="Ordonează">${SORTS.map((o) => html`<option value="${o.id}" ${st.sort === o.id ? 'selected' : ''}>${o.label}</option>`)}</select>
      <span class="result-count">${num(rows.length)} ${rows.length === 1 ? 'proiect' : 'proiecte'}</span>
    </div>
    ${rows.length ? html`
      <div class="tbl-wrap responsive sticky"><table class="tbl">
        <thead><tr>
          <th class="n">#</th><th>Token</th><th>Validare</th><th>Listări</th><th>Stadiu</th>
          <th class="n" title="Scorul de pre-expansiune">Oport.</th><th class="n" title="Cât de puțin evidentă este încă mișcarea">Precoc.</th><th class="n">Risc</th>
          <th class="n" title="Schimbări față de propria normă, în fereastra de 7 zile">Schimbări</th><th class="n">CRI · analog</th><th>Futures</th>
          <th class="n">Capitalizare</th><th class="n">Deținători</th><th>Detalii</th>
        </tr></thead>
        <tbody>${visible.map((r) => assetRow(r, s))}</tbody>
      </table></div>
      <div class="cards">${visible.map((r) => assetCard(r, s))}</div>
      ${rows.length > st.shown ? html`<p style="margin-top:12px"><button class="btn" type="button" data-umore>Arată încă ${Math.min(PAGE, rows.length - st.shown)} din ${rows.length - st.shown}</button></p>` : ''}
    ` : html`<div class="empty"><strong>Niciun proiect pentru filtrele alese.</strong><p>Relaxează un filtru sau șterge căutarea.</p></div>`}`;
}

function futuresPanel(data) {
  const st = universeState;
  const q = st.q.trim().toLowerCase();
  const rows = data.futuresRows.filter((f) => !q || `${f.symbol} ${f.name}`.toLowerCase().includes(q));
  const visible = rows.slice(0, st.shown);
  return html`
    <div class="filters">
      <label class="search"><span class="sr-only">Caută</span>${icon('search', 14)}<input type="search" id="usearch" placeholder="Caută simbol sau nume" value="${st.q}" autocomplete="off"></label>
      <span class="result-count">${num(rows.length)} instrumente</span>
    </div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th class="n">#</th><th>Instrument</th><th>Notă</th><th class="n">Scor</th><th>Trend 1D</th><th class="n">Structură 4H</th><th class="n">Funding/8h</th><th class="n">Open interest</th><th>Burse</th><th class="n">Preț</th><th>Nivele de research</th></tr></thead>
      <tbody>${visible.map(futuresRow)}</tbody>
    </table></div>
    ${rows.length > st.shown ? html`<p style="margin-top:12px"><button class="btn" type="button" data-umore>Arată încă ${Math.min(PAGE, rows.length - st.shown)} din ${rows.length - st.shown}</button></p>` : ''}
    <p class="panel-note">Nivelele provin din structura 4H; proiectul nu execută și nu transmite ordine.</p>`;
}

export function universeMarkup(s) {
  const st = universeState;
  const meta = s.meta?.universe ?? null;
  const head = html`
    <div class="view-head">
      <h2 class="view-title">Univers — întregul orizont de scanare</h2>
      <p class="view-lede">Fiecare proiect cercetat în rularea curentă, câte un rând: toate small cap-urile eligibile din top 1000 CoinGecko + CoinMarketCap, plus tokenurile din Binance Alpha și Gate Alpha pe care top 1000 nu le atinge, și fiecare piață perpetuă evaluată de Futures Radar. Ecranele principale arată vârful fiecărui clasament cu toate dovezile; aici este restul, ca nimic din ce s-a cercetat să nu rămână nevăzut. Implicit vezi doar proiectele verificate — singurele care intră în listele CRI; filtrul „Validare” arată și proiectele în verificare sau respinse, cu motivul.</p>
    </div>`;
  if (!meta) {
    return html`${head}<div class="empty"><strong>Acest snapshot nu are încă tabelul întregului orizont.</strong><p>Tabelul se publică de la prima scanare completă cu orizontul extins (data/universe.json).</p></div>`;
  }
  if (st.status === 'idle' || st.status === 'loading') {
    return html`${head}<div class="empty"><strong>Se încarcă ${num(meta.projects)} proiecte și ${num(meta.futures)} piețe perpetue…</strong><p class="muted small">Tabelul este un fișier separat, citit doar când deschizi acest ecran.</p></div>`;
  }
  if (st.status === 'error') {
    return html`${head}<div class="empty"><strong>Tabelul întregului orizont nu a putut fi citit.</strong><p>${st.error}</p></div>`;
  }
  const data = st.data;
  const otherRun = data.runId && s.meta?.runId && data.runId !== s.meta.runId;
  const pulsed = s.meta?.pulse?.at;
  return html`${head}
    ${otherRun ? html`<p class="panel-note">${icon('info', 12)} Tabelul provine din rularea ${data.runId}, iar snapshot-ul principal din rularea ${s.meta.runId}; tabelul se rescrie la următoarea scanare completă.</p>`
      : pulsed ? html`<p class="panel-note">${icon('clock', 12)} Valorile din tabel sunt din scanarea completă de la ${dateTime(data.generatedAt)}; prețul, funding-ul și open interest din ecranele principale sunt reîmprospătate de puls (${dateTime(pulsed)}).</p>` : ''}
    <div class="seg" role="tablist" aria-label="Tabel">
      <button class="pill" type="button" role="tab" data-utab="assets" aria-selected="${st.tab === 'assets' ? 'true' : 'false'}">Proiecte<span class="count">${num(data.assetRows.length)}</span></button>
      <button class="pill" type="button" role="tab" data-utab="futures" aria-selected="${st.tab === 'futures' ? 'true' : 'false'}">Perpetue<span class="count">${num(data.futuresRows.length)}</span></button>
    </div>
    ${st.tab === 'futures' ? futuresPanel(data) : assetsPanel(s, data)}
    <p class="panel-note">${data.note ?? ''}</p>`;
}

/** Wire the controls of this view; `rerender` re-renders this view only. */
export function bindUniverse(root, rerender) {
  let timer = null;
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el?.id !== 'usearch') return;
    universeState.q = el.value;
    universeState.shown = PAGE;
    clearTimeout(timer);
    timer = setTimeout(() => rerender({ keepFocus: '#usearch' }), 140);
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    const map = { uvalid: 'valid', ualpha: 'alpha', ustage: 'stage', uonly: 'only', usort: 'sort' };
    const k = map[el?.id];
    if (!k) return;
    universeState[k] = el.value;
    universeState.shown = PAGE;
    rerender({ keepFocus: `#${el.id}` });
  });
  root.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const tab = t?.closest('[data-utab]');
    if (tab) {
      universeState.tab = tab.dataset.utab;
      universeState.shown = PAGE;
      rerender();
      return;
    }
    if (t?.closest('[data-umore]')) {
      universeState.shown += PAGE;
      rerender();
    }
  });
}
