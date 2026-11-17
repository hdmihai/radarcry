/**
 * VALIDARE — the gate in front of every CRI list.
 *
 * A project reaches the Small-Cap Radar, the CRI radar, the alerts and the track-record cohort only if
 * it passes five checks: a small or mid capitalisation confirmed by an aggregator, a real and
 * identified project, a listing on an exchange, a contract without traps, and real liquidity. This
 * screen shows the policy, what the gate decided over the whole universe, and — row by row — why
 * each project was held back. Nothing is decided here: the verdicts are the engine's own.
 */
import { html } from '../core/dom.js';
import { num, usd } from '../core/format.js';
import { icon } from '../core/labels.js';

const PAGE = 60;
export const validityState = { tab: 'rejected', q: '', shown: PAGE };

/** Reader-facing names of the reason codes (the engine's sentences carry the details). */
const CODE_RO = {
  NOT_LISTED: 'nelistat pe nicio bursă',
  MCAP_ABOVE_CAP: 'capitalizare peste plafon',
  MCAP_BELOW_FLOOR: 'capitalizare sub prag',
  MCAP_UNVERIFIED: 'capitalizare neconfirmată',
  MCAP_UNKNOWN: 'capitalizare necunoscută',
  ALPHA_ONLY: 'neidentificat (doar Gate Alpha)',
  EXCLUDED_ASSET: 'stablecoin, tokenizat sau împachetat',
  FAKE_TOKEN: 'imită alt token',
  AIRDROP_SCAM: 'airdrop scam',
  HONEYPOT: 'honeypot',
  CANNOT_SELL: 'nu se poate vinde integral',
  NON_TRANSFERABLE: 'netransferabil',
  HIGH_TAX: 'taxă peste 10%',
  OWNER_CHANGE_BALANCE: 'owner-ul modifică solduri',
  BALANCE_MUTABLE: 'solduri modificabile (Solana)',
  SELFDESTRUCT: 'se poate autodistruge',
  DEFAULT_FROZEN: 'conturi înghețate implicit',
  HONEYPOT_CREATOR: 'creator cu honeypot-uri',
  MALICIOUS_CREATOR: 'creator semnalat',
  HIDDEN_OWNER: 'owner ascuns',
  TAKE_BACK_OWNERSHIP: 'ownership recuperabil',
  CLOSED_SOURCE: 'cod neverificat',
  FREEZE_AUTHORITY: 'autoritate de înghețare',
  CLOSABLE: 'program închidibil',
  CANNOT_BUY: 'nu se poate cumpăra',
  THIN_LIQUIDITY: 'lichiditate sub prag',
  NOT_SCANNED: 'contract încă nescanat',
  LIQUIDITY_UNKNOWN: 'lichiditate necitită',
  VENUES_UNREAD: 'bursele nu au răspuns',
};

const CHECK_HELP = {
  scope: (p) => `capitalizare între ${usd(p.minMarketCapUsd)} și ${usd(p.maxMarketCapUsd)}, raportată de un agregator (CoinGecko, CoinMarketCap, CoinPaprika) sau de Binance Alpha; stablecoin-urile, tokenurile împachetate și activele tokenizate sunt excluse`,
  identity: () => 'listat de un agregator sau ales de Binance pentru Binance Alpha; nu imită alt token și nu este un airdrop scam; site-ul și conturile sociale sunt notate',
  listing: (p) => `o piață spot pe Binance, OKX, Gate, Bitget, MEXC, Upbit sau Bithumb cu cel puțin ${usd(p.minSpotVolumeUsd)} volum în 24 h, un contract perpetuu, Binance Alpha, sau lista de burse GoPlus — Gate Alpha singur nu ajunge`,
  contract: (p) => `fără honeypot, fără taxă peste ${p.maxTaxPct}%, fără owner care poate modifica soldurile, fără autodistrugere; owner ascuns, cod neverificat sau autoritate de înghețare resping un token pe care nicio bursă care verifică proiectele nu îl listează`,
  liquidity: (p) => `o piață spot centralizată, sau — fără ea — un pool DEX de cel puțin ${usd(p.minDexLiquidityUsd)}`,
  distribution: (p) => `informativ: atenționare peste ${p.concentrationWarnPct}% în top 10 deținători efectivi`,
  maturity: (p) => `informativ: atenționare sub ${p.minAgeDays} zile de la listare sau la o rotație de peste ${p.turnoverWarn}× capitalizarea pe zi`,
};

function filteredRows(list) {
  const q = validityState.q.trim().toLowerCase();
  return q ? list.filter((r) => `${r.symbol} ${r.name} ${r.key}`.toLowerCase().includes(q)) : list;
}

function reasonChips(codes) {
  return html`<span class="chips xs">${(codes ?? []).map((c) => html`<span class="chip">${CODE_RO[c] ?? c}</span>`)}</span>`;
}

function rowMarkup(r) {
  return html`<tr>
    <td><span class="tok"><span>${r.symbol}</span><span class="tok-sub">${r.name}${r.chain ? `, ${r.chain}` : ''}</span></span></td>
    <td class="n">${usd(r.marketCap)}</td>
    <td class="vcol-codes">${reasonChips(r.codes)}</td>
    <td class="xs vcol-why">${r.why}</td>
  </tr>`;
}

function cardMarkup(r) {
  return html`<div class="card-row">
    <span class="tok"><b>${r.symbol}</b><span class="tok-sub">${r.name}</span></span>
    <span>${usd(r.marketCap)}</span>
    <span class="line">${reasonChips(r.codes)}</span>
    <span class="line xs muted">${r.why}</span>
  </div>`;
}

export function validityMarkup(s) {
  const v = s.validity ?? null;
  const head = html`
    <div class="view-head">
      <h2 class="view-title">Validare — cine intră în listele CRI</h2>
      <p class="view-lede">Înainte de a fi clasat, fiecare proiect eligibil trece cinci verificări obligatorii: capitalizare mică sau medie confirmată, proiect real și identificat, listare pe burse, contract fără capcane și lichiditate reală. Doar proiectele care le trec pe toate apar în Small-Cap Radar, în Radar CRI, în alerte și în track record. Aici sunt regulile și fiecare proiect oprit, cu motivul.</p>
    </div>`;
  if (!v) {
    return html`${head}<div class="empty"><strong>Acest snapshot nu are încă verificarea de validitate.</strong><p>Se publică de la prima scanare completă care rulează poarta de validitate.</p></div>`;
  }
  const sum = v.summary ?? {};
  const p = v.policy ?? {};
  const tab = validityState.tab === 'pending' ? 'pending' : 'rejected';
  const list = filteredRows(tab === 'pending' ? v.pending ?? [] : v.rejected ?? []);
  const shown = list.slice(0, validityState.shown);
  const codes = Object.entries(sum.byCode ?? {}).sort((a, b) => b[1] - a[1]);
  const totalListed = tab === 'pending' ? sum.pending : sum.rejected;
  return html`${head}
    <div class="qbar">
      <div class="qstat" data-tone="good"><b class="num">${num(sum.valid)}</b><span>verificate</span><small class="muted">intră în listele CRI</small></div>
      <div class="qstat"><b class="num">${num(sum.pending)}</b><span>în verificare</span><small class="muted">lipsește o dovadă (de obicei scanarea contractului) — nu sunt suspecte, doar încă nedovedite</small></div>
      <div class="qstat" data-tone="${sum.rejected ? 'warning' : 'muted'}"><b class="num">${num(sum.rejected)}</b><span>respinse</span><small class="muted">o dovadă le descalifică</small></div>
      <div class="qstat"><b class="num">${num(sum.checked)}</b><span>verificate în total</span><small class="muted">toate proiectele eligibile ale rulării</small></div>
    </div>

    <section class="section">
      <h3 class="section-title">Cele șapte verificări</h3>
      <ul class="vchecks">${(v.checks ?? []).map((c) => html`<li data-tone="${c.required ? 'good' : 'muted'}">
        <span class="vc-ico">${icon(c.required ? 'check' : 'info', 13)}</span>
        <span class="vc-body"><b>${c.label}</b> <span class="muted xs">· ${c.required ? 'obligatorie' : 'informativă'}</span><br><span class="xs">${CHECK_HELP[c.key] ? CHECK_HELP[c.key](p) : ''}</span></span>
      </li>`)}</ul>
      <p class="panel-note">„Necunoscut” nu înseamnă „respins”: un proiect fără o dovadă rămâne în verificare, iar rotația surselor gratuite o aduce la rulările următoare. Doar o dovadă poate respinge.</p>
    </section>

    ${codes.length ? html`<section class="section">
      <h3 class="section-title">Ce a oprit proiectele în această rulare</h3>
      <div class="vcounts">${codes.map(([c, n]) => html`<span class="chip">${CODE_RO[c] ?? c} <b class="num">${num(n)}</b></span>`)}</div>
    </section>` : ''}

    <div class="filters">
      <div class="seg" role="tablist" aria-label="Lista">
        <button class="pill" type="button" role="tab" data-vtab="rejected" aria-selected="${tab === 'rejected' ? 'true' : 'false'}">Respinse<span class="count">${num(sum.rejected)}</span></button>
        <button class="pill" type="button" role="tab" data-vtab="pending" aria-selected="${tab === 'pending' ? 'true' : 'false'}">În verificare<span class="count">${num(sum.pending)}</span></button>
      </div>
      <label class="search"><span class="sr-only">Caută</span>${icon('search', 14)}<input type="search" id="vsearch" placeholder="Caută simbol sau nume" value="${validityState.q}" autocomplete="off"></label>
      <span class="result-count">${num(list.length)} ${list.length === 1 ? 'proiect' : 'proiecte'}${totalListed > (tab === 'pending' ? v.pending : v.rejected)?.length ? html` (primele ${num((tab === 'pending' ? v.pending : v.rejected).length)} din ${num(totalListed)}, în ordinea motorului)` : ''}</span>
    </div>
    ${list.length ? html`
      <div class="tbl-wrap responsive"><table class="tbl">
        <thead><tr><th>Token</th><th class="n">Capitalizare</th><th>Motiv</th><th>Detaliu</th></tr></thead>
        <tbody>${shown.map(rowMarkup)}</tbody>
      </table></div>
      <div class="cards">${shown.map(cardMarkup)}</div>
      ${list.length > shown.length ? html`<p style="margin-top:12px"><button class="btn" type="button" data-vmore>Arată încă ${Math.min(PAGE, list.length - shown.length)} din ${list.length - shown.length}</button></p>` : ''}
    ` : html`<div class="empty"><strong>${tab === 'pending' ? 'Niciun proiect în verificare.' : 'Niciun proiect respins.'}</strong><p>${validityState.q ? 'Șterge căutarea pentru a vedea toată lista.' : 'Toate proiectele eligibile au trecut această parte a verificării.'}</p></div>`}
    <p class="panel-note">${v.note ?? ''} Tabelul complet, cu starea fiecărui proiect, este în <a href="#/univers">Univers</a>.</p>`;
}

/** Wire the controls of this view; `rerender` re-renders this view only. */
export function bindValidity(root, rerender) {
  let timer = null;
  root.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const tab = t?.closest('[data-vtab]');
    if (tab) {
      validityState.tab = tab.dataset.vtab;
      validityState.shown = PAGE;
      rerender();
      return;
    }
    if (t?.closest('[data-vmore]')) {
      validityState.shown += PAGE;
      rerender();
    }
  });
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el?.id !== 'vsearch') return;
    validityState.q = el.value;
    validityState.shown = PAGE;
    clearTimeout(timer);
    timer = setTimeout(() => rerender({ keepFocus: '#vsearch' }), 140);
  });
}
