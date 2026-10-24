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
    ['Univers unificat', u.merged],
    ['Eligibili după filtre', u.eligible],
    ['Publicați în dashboard', u.published],
    ['Cercetați în profunzime', u.deep],
  ];
  const fmax = Math.max(1, ...funnel.map((f) => f[1] ?? 0));
  const venueRows = [
    ['MEXC spot', v.mexcSpot],
    ['Binance spot (oglinda publică)', v.binanceSpot],
    ...Object.entries(v.perps ?? {}).map(([k, n]) => [`Perpetual ${k.toUpperCase()}`, n]),
    ['Upbit (KRW)', v.upbit],
    ['Bithumb (KRW)', v.bithumb],
    ['Binance Alpha', v.alpha],
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
    </section>
    <section><h3 class="section-title">Acoperire venue-uri (tokeni potriviți)</h3>
      <div class="bars">${venueRows.map(([k, n]) => html`<div class="bar-row"><span class="lbl">${k}</span><span class="track"><b style="width:${(((n ?? 0) / vmax) * 100).toFixed(1)}%"></b></span><span class="val">${int(n)}</span></div>`)}</div>
      <p class="small ink2" style="margin-top:12px">Potrivirea pe venue-uri se face după simbol și verificare de preț (±20% spot, ±25% perpetual, inclusiv multiplicatori ca 1000PEPE) ca să evite tokenii omonimi.${v.unmatched?.mexcSpot ? ` ${v.unmatched.mexcSpot} tickere MEXC respinse la verificarea de preț.` : ''}</p>
    </section>
  </div>`;
}
