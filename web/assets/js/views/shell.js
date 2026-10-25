/** Top bar meta, notices and the market-weather strip. */
import { html, tip } from '../core/dom.js';
import { ago, dateTime, duration, pct, usd } from '../core/format.js';
import { HEALTH, REGIME, icon } from '../core/labels.js';
import { statusLine } from './widgets.js';

export function topMeta(s) {
  const mode = s.meta.mode === 'fixture' ? 'fixture' : 'live';
  const h = HEALTH[s.health?.overall] ?? HEALTH.DEGRADED;
  const u = s.health?.universe ?? {};
  return html`
    <span class="mode-pill" data-mode="${mode}" data-tip="${tip(mode === 'live' ? 'Date reale din API-uri publice gratuite' : 'Date simulate determinist, doar pentru demonstrație')}">${mode === 'live' ? 'LIVE' : 'DEMO'}</span>
    <span class="hide-sm" data-tip="${tip(html`<b>Snapshot ${s.meta.runId}</b><br>generat ${dateTime(s.meta.generatedAt)}<br>durată scanare ${duration(s.meta.durationMs)}`)}">Actualizat ${dateTime(s.meta.generatedAt)} <span class="muted">(${ago(s.meta.generatedAt)})</span></span>
    <span class="show-sm muted">${ago(s.meta.generatedAt)}</span>
    <a href="#/surse" class="hide-sm" style="text-decoration:none;color:inherit">${statusLine(h.tone, h.label)}</a>
    <span class="hide-sm muted">${u.eligible ?? '—'} tokeni analizați</span>`;
}

export function notices(s, nowMs = Date.now()) {
  const out = [];
  if (s.meta.mode === 'fixture') {
    out.push({ kind: 'demo', ico: 'info', text: html`<b>Mod demonstrativ.</b> Piața este simulată determinist (fără API-uri), cu tipare plantate de tip LAB/BTW/AGT, ca să poți explora fiecare ecran. Workflow-ul GitHub Actions publică date reale din CoinGecko, CoinMarketCap, MEXC, Binance, Coinalyze, NodeReal și celelalte surse gratuite.` });
  }
  const paused = s.quota?.paused ?? [];
  if (paused.length) {
    out.push({ kind: 'stale', ico: 'info', text: html`<b>Planuri gratuite în pauză preventivă:</b> ${paused.join(', ')}. La 95% din orice limită publicată, furnizorul este oprit până la resetare, ca o rulare să nu ajungă niciodată într-o zonă plătită sau blocată. Detalii în <a href="#/paritate">Paritate și bugete</a>.` });
  }
  const ageH = (nowMs - s.generatedMs) / 3600000;
  if (s.meta.mode !== 'fixture' && ageH > 10) {
    out.push({ kind: 'stale', ico: 'clock', text: html`<b>Snapshot vechi de ${Math.round(ageH)} ore.</b> Verifică rularea programată din GitHub Actions (tab-ul Actions al repository-ului).` });
  }
  if (s.health?.overall === 'CRITICAL' || s.health?.overall === 'DEGRADED') {
    const failing = (s.health.providers ?? []).filter((p) => !['OK', 'NOT_CONFIGURED', 'SKIPPED'].includes(p.status)).map((p) => p.label);
    out.push({ kind: s.health.overall === 'CRITICAL' ? 'error' : 'stale', ico: 'warn', text: html`<b>${s.health.overall === 'CRITICAL' ? 'Surse principale indisponibile.' : 'Unele surse nu au răspuns.'}</b> ${failing.length ? `Afectate: ${failing.join(', ')}. ` : ''}Domeniile fără date sunt marcate „necunoscut”: nu contează ca negative, reduc doar încrederea.` });
  }
  return out;
}

export function noticeMarkup(list) {
  return list.map((n) => html`<div class="notice" data-kind="${n.kind}" role="status"><div class="frame">${icon(n.ico, 15)}<p>${n.text}</p></div></div>`);
}

export function marketStrip(s) {
  const m = s.market ?? {};
  const r = REGIME[m.regime?.label] ?? REGIME.NEUTRAL;
  const g = m.global ?? {};
  const b = m.breadth ?? {};
  const u = s.health?.universe ?? {};
  const regimeTip = html`<b>Regim ${r.label} (${m.regime?.score ?? '—'}/100)</b>${(m.regime?.drivers ?? []).map((d) => html`<br>${d}`)}<br><span class="muted">În risk-off pragul pentru Setup BUY crește automat.</span>`;
  const fact = (k, v, t) => html`<div class="mfact" ${t ? html`data-tip="${t}"` : ''}><span class="mfact-k">${k}</span><span class="mfact-v">${v}</span></div>`;
  return html`<div class="frame">
    ${fact('Regim piață', html`${statusLine(r.tone, r.label, { size: 13 })}<span class="sub">${m.regime?.score ?? '—'}</span>`, tip(regimeTip))}
    ${fact('Fear & Greed', html`${m.fearGreed?.value ?? '—'} <span class="sub">${m.fearGreed?.label ?? ''}</span>`, tip(html`<b>alternative.me Fear &amp; Greed</b><br>0 = frică extremă, 100 = lăcomie extremă${Number.isFinite(m.fearGreed?.change7d) ? html`<div class="tt-row"><span>față de 7 zile</span><span>${m.fearGreed.change7d > 0 ? '+' : ''}${m.fearGreed.change7d}</span></div>` : ''}<br><span class="muted">API public, fără cheie</span>`))}
    ${fact('Altseason', html`${m.altseason?.value ?? '—'}<span class="sub">/100 · ${m.altseason?.label ?? ''}</span>`, tip(html`<b>Indice altseason, calculat local</b><br>${m.altseason?.note ?? ''}<br><span class="muted">endpoint-urile comerciale pentru acest indice sunt plătite, așa că este recalculat din propriul top 100</span>`))}
    ${fact('Dominanță BTC', html`${Number.isFinite(g.btcDominance) ? g.btcDominance.toFixed(1) : '—'}%`)}
    ${fact('Capitalizare totală', html`${usd(g.totalMarketCapUsd)} <span class="sub ${g.change24hPct >= 0 ? 'pos' : 'neg'}">${pct(g.change24hPct)}</span>`)}
    ${fact('Small caps pe plus (7z)', html`${Number.isFinite(b.upShare7d) ? Math.round(b.upShare7d) : '—'}% <span class="sub">mediană ${pct(b.medianSmallCap7dPct)}</span>`, tip(`Lățimea pieței pe ${b.sample ?? '—'} tokeni din universul filtrat; BTC 7z: ${pct(b.btc7dPct)}`))}
    ${fact('Univers scanat', html`${u.coingecko ?? '—'} CG + ${u.coinmarketcap ?? '—'} CMC${Number.isFinite(u.binanceAlpha) || Number.isFinite(u.gateAlpha) ? html` + ${(u.binanceAlpha ?? 0) + (u.gateAlpha ?? 0)} Alpha` : ''} <span class="sub">→ ${u.eligible ?? '—'} eligibili, ${u.deep ?? '—'} cercetați</span>`, tip(html`<b>Pâlnia universului</b>${Number.isFinite(u.binanceAlpha) ? html`<div class="tt-row"><span>Tokenuri Binance Alpha</span><span>${u.binanceAlpha}</span></div>` : ''}${Number.isFinite(u.gateAlpha) ? html`<div class="tt-row"><span>Tokenuri Gate Alpha</span><span>${u.gateAlpha}</span></div>` : ''}${u.alphaPrograms ? html`<div class="tt-row"><span>…listate în ambele programe</span><span>${u.alphaPrograms.both ?? '—'}</span></div>` : ''}${Number.isFinite(u.alphaOnly) ? html`<div class="tt-row"><span>Tokenuri Alpha în afara top 1000 (adăugate doar prin Alpha)</span><span>${u.alphaOnly}</span></div><div class="tt-row"><span>…dintre care eligibile</span><span>${u.alphaOnlyEligible ?? '—'}</span></div>` : ''}<div class="tt-row"><span>Unificat (fără dubluri)</span><span>${u.merged ?? '—'}</span></div><div class="tt-row"><span>Excluși (stablecoin, wrapped, prea mari/mici)</span><span>${u.excluded ?? '—'}</span></div><div class="tt-row"><span>Eligibili</span><span>${u.eligible ?? '—'}</span></div><div class="tt-row"><span>Cercetați în profunzime</span><span>${u.deep ?? '—'}${Number.isFinite(u.priority) ? ` (prioritate ${u.priority})` : ''}</span></div>${Number.isFinite(u.futures) ? html`<div class="tt-row"><span>Piețe perpetue în Futures Radar</span><span>${u.futures}</span></div>` : ''}<div class="tt-row"><span>Publicați în dashboard (restul în Univers)</span><span>${u.published ?? '—'}</span></div>`))}
  </div>`;
}
