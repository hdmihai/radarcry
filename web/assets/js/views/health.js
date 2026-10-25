/** Data & sources: provider health, universe funnel and venue coverage. */
import { html, tip } from '../core/dom.js';
import { int } from '../core/format.js';
import { HEALTH, PROVIDER_STATUS } from '../core/labels.js';
import { statusLine } from './widgets.js';

export function healthMarkup(s) {
  const h = s.health ?? {};
  const overall = HEALTH[h.overall] ?? HEALTH.DEGRADED;
  const u = h.universe ?? {};
  const v = h.venues ?? {};
  const funnel = [
    ['CoinGecko top', u.coingecko],
    ['CoinMarketCap top', u.coinmarketcap],
    ['CoinPaprika (fallback)', u.coinpaprika],
    ...(Number.isFinite(u.binanceAlpha) ? [['Binance Alpha (listă publică)', u.binanceAlpha]] : []),
    ...(Number.isFinite(u.gateAlpha) ? [['Gate Alpha (API v4 public)', u.gateAlpha]] : []),
    ['Univers unificat', u.merged],
    ['Eligibili după filtre', u.eligible],
    ['Cercetați în profunzime', u.deep],
    ...(Number.isFinite(u.priority) ? [['…dintre care prioritate', u.priority]] : []),
    ...(Number.isFinite(u.futures) ? [['Piețe perpetue în Futures Radar', u.futures]] : []),
    ['Publicați cu dovezi complete', u.published],
  ];
  const roll = u.rolling ?? null;
  const fmax = Math.max(1, ...funnel.map((f) => f[1] ?? 0));
  const venueRows = [
    ['MEXC spot', v.mexcSpot],
    ['Binance spot (oglinda publică)', v.binanceSpot],
    ...Object.entries(v.perps ?? {}).map(([k, n]) => [`Perpetual ${k.toUpperCase()}`, n]),
    ['Upbit (KRW)', v.upbit],
    ['Bithumb (KRW)', v.bithumb],
    ['Binance Alpha', v.alpha],
    ...(Number.isFinite(v.gateAlpha) ? [['Gate Alpha', v.gateAlpha]] : []),
  ];
  const vmax = Math.max(1, ...venueRows.map((r) => r[1] ?? 0));
  return html`
  <div class="view-head"><div><h2 class="view-title">Date și surse</h2>
    <p class="view-lede">Fiecare sursă are un status explicit și planul pe care rulează. Nu există niciun abonament: fiecare sursă este publică sau are cont gratuit, iar toate cheile sunt opționale. O sursă căzută nu oprește scanarea — factorii afectați devin „necunoscuți”, ceea ce scade încrederea și acoperirea, fără a conta ca dovezi negative.</p></div>
    <div>${statusLine(overall.tone, overall.label, { size: 16 })}</div></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sursă</th><th>Rol</th><th>Plan gratuit</th><th>Status</th><th class="n">Înregistrări</th><th class="n">Latență</th><th class="n">Apeluri</th><th class="n">Unități</th><th>Cheie</th><th class="n">Cuotă lună</th></tr></thead><tbody>
    ${(h.providers ?? []).map((p) => {
      const st = PROVIDER_STATUS[p.status] ?? { label: p.status, tone: 'muted' };
      const q = p.quota;
      return html`<tr>
        <td><b>${p.label}</b></td>
        <td class="ink2" style="white-space:normal;min-width:220px">${p.role}</td>
        <td class="small ink2" style="white-space:normal;min-width:160px">${p.plan ?? '—'}</td>
        <td><span data-tip="${tip(p.message || st.label)}">${statusLine(st.tone, st.label, { size: 13 })}</span></td>
        <td class="n">${int(p.records)}</td>
        <td class="n">${Number.isFinite(p.latencyMs) ? `${int(p.latencyMs)} ms` : '—'}</td>
        <td class="n">${int(p.calls)}</td>
        <td class="n">${int(p.units)}</td>
        <td>${p.keyed ? 'da' : html`<span class="muted">nu</span>`}</td>
        <td class="n">${q && Number.isFinite(q.shareMonth) ? html`<span data-tip="${tip(`${int(q.usedMonth)} din ${int(q.limitMonth)} unități${q.paused ? ' — în pauză preventivă' : ''}`)}" class="${q.paused ? 'neg' : ''}">${Math.round(q.shareMonth * 100)}%</span>` : '—'}</td>
      </tr>`;
    })}
  </tbody></table></div>
  ${h.labels?.size ? html`<p class="small ink2" style="margin-top:10px">Etichete on-chain: <b>${int(h.labels.size)}</b> adrese EVM din setul <a href="${h.labels.source ?? '#'}" target="_blank" rel="noopener noreferrer">eth-labels</a> (${h.labels.license ?? 'MIT'}), incluse în repository și citite local — zero apeluri de rețea și zero limită de rată la rulare.</p>` : ''}
  ${(h.coverage?.sources ?? []).length ? html`<section class="section"><h3 class="section-title">Acoperirea surselor în această rulare <span class="muted small">(${h.coverage.okCount} din ${h.coverage.total})</span></h3>
    <div class="chips">${h.coverage.sources.map((c) => html`<span class="chip" data-tone="${c.ok ? 'good' : 'warning'}" data-tip="${tip(`${c.status ?? ''} ${c.message ?? ''}`.trim() || (c.ok ? 'a răspuns' : 'nu a răspuns'))}"><i></i>${c.label}</span>`)}</div>
    ${h.coverage.degraded ? html`<p class="small ink2" style="margin-top:8px">Surse obligatorii lipsă: ${h.coverage.requiredMissing.map((r) => r.label).join(', ')}.</p>` : ''}
  </section>` : ''}
  <div class="cols-2 section">
    <section><h3 class="section-title">Pâlnia universului</h3>
      <div class="bars">${funnel.map(([k, n]) => html`<div class="bar-row"><span class="lbl">${k}</span><span class="track"><b style="width:${(((n ?? 0) / fmax) * 100).toFixed(1)}%"></b></span><span class="val">${int(n)}</span></div>`)}</div>
      <p class="small ink2" style="margin-top:12px">Excluși: ${Object.entries(h.exclusions ?? {}).map(([k, n]) => `${({ STABLECOIN: 'stablecoin', WRAPPED_OR_STAKED: 'wrapped/staked', TOKENIZED_ASSET: 'active tokenizate', ABOVE_MAX_MCAP: 'peste market cap maxim', BELOW_MIN_MCAP: 'sub market cap minim', LOW_VOLUME: 'volum prea mic', NO_MARKET_CAP: 'fără market cap' })[k] ?? k} ${n}`).join(', ') || 'niciunul'}. Listați pe ambele agregatoare: ${int(u.crossListed)}.</p>
      ${roll ? html`<h3 class="section-title" style="margin-top:18px">Stratul rotativ (planurile gratuite cu limite mici)</h3>
      <p class="small ink2">Lumânările și lichiditatea DEX se citesc pentru fiecare proiect la fiecare rulare (acum = în rularea aceasta). Sursele care răspund doar câteva zeci de apeluri pe rulare se rotesc prin univers: faptele statice (securitatea contractului, categoriile și repository-ul) se păstrează între rulări cu data citirii, iar măsurătorile (deținători, commit-uri, mențiuni) se citesc proaspăt, prioritatea întâi, apoi proiectele măsurate cel mai demult — o măsurătoare nu este niciodată copiată în istoric a doua oară.</p>
      <div class="bars">${[
        ['Lumânări (acum)', roll.tiers?.candles],
        ['Lichiditate DEX (acum)', roll.tiers?.dex],
        [`Securitate (≤ ${Math.round((roll.cache?.ttlHours?.security ?? 168) / 24)} zile)`, roll.cache?.security],
        [`Detalii CG (≤ ${Math.round((roll.cache?.ttlHours?.detail ?? 336) / 24)} zile)`, roll.cache?.detail],
        [`Deținători (≤ ${roll.cache?.windowHours ?? 72} h)`, roll.cache?.holdersInfo],
        [`Dezvoltare (≤ ${roll.cache?.windowHours ?? 72} h)`, roll.cache?.dev],
      ].map(([k, n]) => html`<div class="bar-row"><span class="lbl">${k}</span><span class="track"><b style="width:${(((n ?? 0) / Math.max(1, roll.cache?.projects ?? 1)) * 100).toFixed(1)}%"></b></span><span class="val">${int(n)}/${int(roll.cache?.projects)}</span></div>`)}</div>` : ''}
    </section>
    <section><h3 class="section-title">Acoperire venue-uri (tokeni potriviți)</h3>
      <div class="bars">${venueRows.map(([k, n]) => html`<div class="bar-row"><span class="lbl">${k}</span><span class="track"><b style="width:${(((n ?? 0) / vmax) * 100).toFixed(1)}%"></b></span><span class="val">${int(n)}</span></div>`)}</div>
      <p class="small ink2" style="margin-top:12px">Potrivirea pe venue-uri se face după simbol și verificare de preț (±20% spot, ±25% perpetual, inclusiv multiplicatori ca 1000PEPE) ca să evite tokenii omonimi.${v.unmatched?.mexcSpot ? ` ${v.unmatched.mexcSpot} tickere MEXC respinse la verificarea de preț.` : ''}</p>
    </section>
  </div>`;
}
