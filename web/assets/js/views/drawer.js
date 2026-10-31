/**
 * Research card — everything a researcher checks before acting, in reading order:
 * verdict → why now / what blocks → plan → structure (4H SMC) → analog DNA → evidence by domain
 * → market & tokenomics → derivatives → on-chain & security → venues → catalysts → history → risk.
 */
import { html, tip } from '../core/dom.js';
import { ago, date, dateTime, days, frac, funding, int, pct, price, score, shortAddr, usd } from '../core/format.js';
import { L, POLARITY, RELIABILITY, SEVERITY, icon, sourceLabel } from '../core/labels.js';
import { candleChart } from '../charts/candles.js';
import { dnaCompare } from '../charts/dna.js';
import { criHistoryChart, dailyChart } from '../charts/lines.js';
import { change, extLink, gradeBadge, lifecycle, polarity, refChip, signalBadge, statusLine, validityBadge, validityList } from './widgets.js';

let CHART_W = 860; // set per render: narrow screens get a narrower viewBox so chart text stays legible
const DOMAIN_ORDER = ['similarity', 'structure', 'setup', 'activity', 'derivatives', 'onchain', 'catalyst', 'attention', 'fundamentals'];

function verdict(c) {
  const best = c.analogs?.best;
  const sc = c.score ?? {};
  return html`<div class="verdict">
    <div><div class="k">Semnal</div><div class="v">${signalBadge(c.signal, { large: true })}</div><div class="s">${c.signal?.type !== 'NONE' ? `tărie ${c.signal?.strength ?? '—'}/100` : 'sub pragurile de cercetare'}</div></div>
    <div><div class="k">Scor CRI</div><div class="v">${score(sc.cri)}<span class="tier">${sc.tier ?? '?'}</span></div><div class="s">încredere ${RELIABILITY[sc.reliabilityBand] ?? '—'}, ${Math.round((sc.coverage ?? 0) * 100)}% acoperire, ${L.states[sc.state] ?? sc.state ?? ''}</div></div>
    <div><div class="k">Cel mai apropiat analog</div><div class="v">${refChip(best?.ref, best?.similarity)}</div><div class="s">${best ? `ADN ${Math.round(best.dnaSim ?? 0)}, fază ${Math.round(best.phaseSim ?? 0)}${Number.isFinite(best.sequenceSim) ? `, secvență ${Math.round(best.sequenceSim)}` : ''}` : 'fără analog calculabil'}</div></div>
    <div><div class="k">Risc</div><div class="v">${gradeBadge(c.risk)} <span style="font-size:var(--fs-base);font-weight:600">${c.risk?.score ?? 0} pct</span></div><div class="s">${c.risk?.sizing ?? ''}</div></div>
  </div>`;
}

function thesis(c) {
  const why = c.whyNow ?? [];
  const blockers = c.signal?.blockers ?? [];
  const missing = (c.missing ?? []).map((id) => c.domains?.find((d) => d.id === id)?.label ?? id);
  return html`<div class="thesis">
    <div><h3 class="block-title">De ce acum</h3>
      ${why.length ? html`<ul class="facts">${why.map((w) => html`<li>${icon('check', 13)}<span>${w}</span></li>`)}</ul>` : html`<p class="muted small">Niciun argument de timing puternic în acest snapshot.</p>`}
    </div>
    <div><h3 class="block-title">Ce lipsește sau blochează</h3>
      <ul class="facts">
        ${blockers.map((b) => html`<li>${icon('warn', 13)}<span>${b}</span></li>`)}
        ${missing.length ? html`<li>${icon('minus', 13)}<span>Fără date: ${missing.join(', ')} (nu contează ca negative; reduc doar încrederea)</span></li>` : ''}
        ${(c.hypeReasons ?? []).slice(0, 2).map((h) => html`<li>${icon('info', 13)}<span>Atenție: ${h}</span></li>`)}
        ${!blockers.length && !missing.length ? html`<li>${icon('check', 13)}<span>Nimic blocant în regulile de semnal.</span></li>` : ''}
      </ul>
    </div>
  </div>`;
}

function plan(c) {
  const p = c.signal?.plan;
  if (!p) return '';
  const t = p.targets ?? [];
  return html`<section><h3 class="block-title">Plan de cercetare <span class="muted">${p.timeframe}, ${p.basis}</span></h3>
    <div class="plan">
      <div><div class="k">Zonă de intrare</div><div class="v">${price(p.entryLow)}–${price(p.entryHigh)}</div></div>
      <div><div class="k">Invalidare</div><div class="v">${price(p.invalidation)}</div><div class="s">risc ${pct(-Math.abs(p.riskPct ?? 0))} de la mijlocul zonei</div></div>
      <div><div class="k">Ținte</div>${t.map((x) => html`<div class="v small">${x.label}: ${price(x.price)} <span class="pos">${pct(x.pct, { dec: 0 })}</span></div>`)}</div>
      <div><div class="k">Raport risc/recompensă</div><div class="v">${Number.isFinite(p.rr) ? `1 : ${p.rr}` : '—'}</div><div class="s">${c.risk?.sizing ?? ''}</div></div>
    </div>
    <p class="plan-note">${p.note}</p>
  </section>`;
}

function structure(c, s) {
  const ch = c.chart;
  const t = c.technicals;
  if (!ch?.h4?.length && !ch?.d1?.length) {
    const why = c.depth === 'deep'
      ? 'Tokenul nu are piață spot pe MEXC, iar istoricul zilnic CoinGecko nu a intrat în bugetul gratuit de apeluri al acestei rulări.'
      : `Tokenul a primit doar evaluarea rapidă; intră în cercetarea profundă (MEXC 1D/4H, SMC) când urcă în primii ${s.meta?.config?.deepLimit ?? 60}.`;
    return html`<section><h3 class="block-title">Structură</h3><div class="empty"><strong>Fără lumânări în acest snapshot.</strong>${why} Stadiul afișat este estimat din date de listare.</div></section>`;
  }
  const h4 = t?.h4;
  const d1 = t?.d1;
  const facts = [];
  if (h4) {
    facts.push(['Structură 4H', h4.structure === 'BULLISH' ? 'bullish' : h4.structure === 'BEARISH' ? 'bearish' : h4.structure === 'RANGE' ? 'range' : 'necunoscută']);
    if (h4.lastEvent) facts.push(['Ultimul eveniment', `${h4.lastEvent.type === 'CHOCH' ? 'CHoCH' : 'BOS'} ${h4.lastEvent.dir === 'UP' ? 'în sus' : 'în jos'}, acum ${h4.lastEvent.barsAgo} lumânări`]);
    if (h4.sweep) facts.push(['Sweep lichiditate', `sell-side la ${price(h4.sweep.level)}, acum ${h4.sweep.barsAgo} lumânări`]);
    if (h4.dealingRange) facts.push(['Poziție în dealing range', `${Math.round((h4.dealingRange.position ?? 0) * 100)}% (${h4.dealingRange.position < 0.5 ? 'discount' : 'premium'})`]);
    facts.push(['RSI 4H', score(h4.rsi14)]);
  }
  if (d1) {
    facts.push(['Trend 1D', `${d1.close > d1.ema20 ? 'peste' : 'sub'} EMA20, ${d1.close > d1.ema50 ? 'peste' : 'sub'} EMA50`]);
    facts.push(['Pantă 30z', `${pct(d1.slope30, { dec: 2 })}/zi (R² ${(d1.r2_30 ?? 0).toFixed(2)})`]);
    facts.push(['Compresie volatilitate', `${(d1.compression ?? 0).toFixed(2)} (sub 1 = comprimat)`]);
    facts.push(['Accelerare volum 7/30', `${(d1.volAccel ?? 0).toFixed(2)}×`]);
    facts.push(['Minime ascendente', String(d1.higherLows ?? '—')]);
    facts.push(['RSI 1D', score(d1.rsi14)]);
  }
  const candles = candleChart({ h4: ch.h4, smc: h4, plan: c.signal?.plan, width: CHART_W, height: CHART_W < 600 ? 300 : 340 });
  const daily = dailyChart(ch.d1, { width: CHART_W, height: 120 });
  return html`<section><h3 class="block-title">Structură 4H (SMC) <span class="muted">sursă lumânări: ${ch.d1Source ?? 'MEXC'}; lumânări închise, fără bara curentă</span></h3>
    ${candles ?? ''}
    <div class="legend"><span><i style="background:var(--up);opacity:.5"></i>order block bullish</span><span><i style="background:var(--seq-3);opacity:.5"></i>fair value gap</span><span><i style="background:var(--accent);opacity:.6"></i>zonă de intrare</span><span style="color:var(--critical-ink)"><i class="dash"></i>invalidare</span><span style="color:var(--good-ink)"><i class="dash"></i>ținte</span></div>
    ${daily ? html`<div style="margin-top:14px"><div class="small muted" style="margin-bottom:4px">Închideri 1D, ultimele ${ch.d1.length} zile</div>${daily}</div>` : ''}
    <dl class="kv" style="margin-top:14px">${facts.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
  </section>`;
}

function analogs(c, s) {
  const refs = s.references ?? [];
  const rows = c.analogs?.all ?? [];
  const featureLabel = Object.fromEntries((s.features ?? []).map((f) => [f.key, f.label]));
  const best = c.analogs?.best;
  return html`<section><h3 class="block-title">ADN comparat cu LAB, BTW și AGT <span class="muted">scală fixă 0–100, aceeași pentru toate run-urile</span></h3>
    ${dnaCompare(c, refs, s.features ?? [], { width: CHART_W })}
    <div class="legend"><span><i class="dot" style="background:var(--ink)"></i>${c.symbol}</span>${refs.map((r) => html`<span data-ref="${r.symbol}"><i style="background:var(--ref);width:4px;height:12px"></i>${r.symbol}</span>`)}</div>
    <div class="tbl-wrap" style="margin-top:12px"><table class="tbl">
      <thead><tr><th>Referință</th><th class="n">Similaritate</th><th class="n">ADN</th><th class="n">Fază</th><th class="n">Secvență stadii</th><th class="n">Acoperire</th></tr></thead>
      <tbody>${rows.map((a) => html`<tr><td>${refChip(a.ref)}</td><td class="n"><b>${score(a.similarity)}</b></td><td class="n">${score(a.dnaSim)}</td><td class="n">${score(a.phaseSim)}</td><td class="n">${Number.isFinite(a.sequenceSim) ? score(a.sequenceSim) : '—'}</td><td class="n">${Number.isFinite(a.coverage) ? `${Math.round(a.coverage * 100)}%` : '—'}</td></tr>`)}</tbody>
    </table></div>
    ${best ? html`<p class="small ink2" style="margin-top:10px">Cele mai bune potriviri cu ${best.ref}: ${(best.topMatches ?? []).map((k) => featureLabel[k] ?? k).join(', ') || '—'}. Cele mai mari diferențe: ${(best.weakest ?? []).map((k) => featureLabel[k] ?? k).join(', ') || '—'}.</p>` : ''}
  </section>`;
}

function domains(c) {
  const list = [...(c.domains ?? [])].sort((a, b) => DOMAIN_ORDER.indexOf(a.id) - DOMAIN_ORDER.indexOf(b.id));
  return html`<section><h3 class="block-title">Dovezi pe domenii <span class="muted">scor 0–100, 50 = neutru; contribuția ține cont de pondere și încredere</span></h3>
    <div class="panel" style="padding:4px 14px">
    ${list.map((d) => {
      const known = d.state === 'AVAILABLE' && Number.isFinite(d.score);
      const rowMarkup = html`<div class="domain-row">
        <span>${d.label ?? d.id}${d.proxy ? html` <span class="muted xs">(estimat)</span>` : ''}</span>
        <span class="domain-bar" ${known ? '' : 'data-unknown'}>${known ? html`<b style="width:${Math.max(2, d.score)}%"></b>` : ''}<span class="mid"></span></span>
        <span class="num" style="text-align:right">${known ? score(d.score) : html`<span class="muted">necun.</span>`}</span>
        <span class="num muted contrib" style="text-align:right" data-tip="${tip(`pondere ${Math.round((d.weight ?? 0) * 100)}%, încredere ${Math.round((d.confidence ?? 0) * 100)}%`)}">${Number.isFinite(d.contribution) ? `+${d.contribution.toFixed(1)}` : '—'}</span>
      </div>`;
      if (!d.facts?.length) return rowMarkup;
      return html`<details class="domain"><summary>${rowMarkup}</summary><div class="domain-facts">
        ${d.facts.map((f) => html`<div><span>${f.label}</span><span class="num">${f.display ?? (Number.isFinite(f.score) ? score(f.score) : '—')}</span></div>`)}
        ${(d.notes ?? []).map((n) => html`<div><span class="muted">${n}</span><span></span></div>`)}
        ${d.sources?.length ? html`<div><span class="muted">surse: ${d.sources.join(', ')}</span><span></span></div>` : ''}
      </div></details>`;
    })}
    </div>
  </section>`;
}

function market(c) {
  const m = c.market ?? {};
  const ch = m.change ?? {};
  const mc = m.mcapChange ?? {};
  return html`<section><h3 class="block-title">Piață și tokenomics</h3>
    <div class="sec-grid">
      <dl class="kv"><dt>Preț</dt><dd>${price(m.price)}</dd><dt>Market cap</dt><dd>${usd(m.marketCap)}</dd><dt>FDV</dt><dd>${usd(m.fdv)}</dd><dt>FDV / MC</dt><dd>${Number.isFinite(m.fdvToMcap) ? `${m.fdvToMcap}×` : '—'}</dd><dt>Float circulant</dt><dd>${frac(m.floatRatio)}</dd></dl>
      <dl class="kv"><dt>Volum 24h</dt><dd>${usd(m.volume24h)}</dd><dt>Turnover</dt><dd>${frac(m.turnover)}</dd><dt>Distanță de ATH</dt><dd>${pct(m.athChangePct)}</dd><dt>Vechime listare</dt><dd>${days(m.ageDays)}</dd><dt>Rang CG / CMC</dt><dd>${c.rank?.coingecko ?? '—'} / ${c.rank?.cmc ?? '—'}</dd></dl>
      <dl class="kv"><dt>Preț 24h</dt><dd>${change(ch.h24)}</dd><dt>Preț 7z / 30z</dt><dd>${change(ch.d7)} / ${change(ch.d30)}</dd><dt>Market cap 24h</dt><dd>${change(mc.h24)}</dd><dt>Market cap 7z / 30z</dt><dd>${change(mc.d7)} / ${change(mc.d30)}</dd><dt>Rang în 7 zile</dt><dd>${Number.isFinite(m.rankChange7d) ? `${m.rankChange7d > 0 ? 'urcă' : m.rankChange7d < 0 ? 'coboară' : 'stabil'} ${Math.abs(m.rankChange7d)} poziții` : '—'}</dd></dl>
    </div>
    ${c.categories?.length ? html`<p class="small ink2" style="margin-top:10px">Categorii: ${c.categories.join(', ')}</p>` : ''}
    <p class="xs muted" style="margin-top:6px">Surse piață: ${(m.sources ?? []).join(', ') || '—'}. Creșterea market cap pe 7/30 zile vine din istoricul propriu al radarului (apare după primele rulări).</p>
  </section>`;
}

function derivatives(c) {
  const d = c.derivatives ?? {};
  const venues = Object.entries(d.byVenue ?? {});
  if (!d.venues?.length) return html`<section><h3 class="block-title">Derivate</h3><p class="small muted">Fără perpetual listat pe MEXC, Gate, Bitget sau OKX. Pentru tokenii de tip LAB, listarea de futures a fost adesea un catalizator.</p></section>`;
  return html`<section><h3 class="block-title">Derivate <span class="muted">${d.venues.join(', ')}</span></h3>
    <dl class="kv"><dt>Open interest</dt><dd>${usd(d.oiUsd)}</dd><dt>OI / market cap</dt><dd>${frac(d.oiToMcap)}</dd><dt>OI față de ~24h</dt><dd>${change(d.oiChangePct)}</dd><dt>Funding mediu (ponderat OI)</dt><dd>${funding(d.fundingAvg)}</dd></dl>
    ${venues.length ? html`<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Venue</th><th class="n">Funding</th><th class="n">Open interest</th><th class="n">Volum 24h</th></tr></thead><tbody>
      ${venues.map(([v, x]) => html`<tr><td>${v}</td><td class="n">${funding(x.fundingRate)}</td><td class="n">${usd(x.oiUsd)}</td><td class="n">${usd(x.volume24hUsd)}</td></tr>`)}
    </tbody></table></div>` : ''}
  </section>`;
}

function onchain(c) {
  const o = c.onchain;
  if (!o) return html`<section><h3 class="block-title">On-chain și securitate</h3><p class="small muted">Neanalizat în acest snapshot (doar tokenii din cercetarea profundă primesc GoPlus, GeckoTerminal și DexScreener).</p></section>`;
  const sec = o.security ?? {};
  const checks = [
    ['honeypot', 'Honeypot', sec.honeypot === true ? 'bad' : sec.honeypot === false ? 'ok' : null],
    ['sell', 'Se poate vinde', sec.cannotSell === true ? 'bad' : sec.cannotSell === false ? 'ok' : null],
    ['tax', 'Taxe cumpărare / vânzare', taxState(sec), `${taxPct(sec.buyTax)} / ${taxPct(sec.sellTax)}`],
    ['mint', 'Fără mint', sec.mintable === true ? 'bad' : sec.mintable === false ? 'ok' : null],
    ['owner', 'Ownership renunțat', sec.ownerRenounced === true ? 'ok' : sec.ownerRenounced === false ? 'warn' : null],
    ['hidden', 'Fără owner ascuns', sec.hiddenOwner === true ? 'bad' : sec.hiddenOwner === false ? 'ok' : null],
    ['pause', 'Transferuri nepausabile', sec.transferPausable === true ? 'warn' : sec.transferPausable === false ? 'ok' : null],
    ['blacklist', 'Fără blacklist', sec.blacklist === true ? 'warn' : sec.blacklist === false ? 'ok' : null],
    ['proxy', 'Contract non-proxy', sec.proxy === true ? 'warn' : sec.proxy === false ? 'ok' : null],
    ['open', 'Cod sursă verificat', sec.openSource === true ? 'ok' : sec.openSource === false ? 'warn' : null],
  ];
  const tone = { ok: 'good', warn: 'warning', bad: 'critical' };
  return html`<section><h3 class="block-title">On-chain și securitate <span class="muted">${(o.sources ?? []).join(', ')}</span></h3>
    <div class="cols-2">
      <dl class="kv"><dt>Holderi</dt><dd>${int(o.holders)} ${Number.isFinite(o.holdersChangePct) ? html`<span class="small">(${change(o.holdersChangePct)} în ~7z)</span>` : ''}</dd>
        <dt>Top 10 holderi</dt><dd>${Number.isFinite(o.top10Pct) ? `${o.top10Pct}%` : '—'}${Number.isFinite(o.top10EffectivePct) ? html` <span class="muted small">(${o.top10EffectivePct}% fără burn/LP/CEX)</span>` : ''}</dd>
        <dt>Lichiditate DEX</dt><dd>${usd(o.dexLiquidityUsd)} <span class="muted small">${Number.isFinite(o.liqToMcap) ? `(${frac(o.liqToMcap)} din MC)` : ''}</span></dd>
        <dt>Buys / sells 24h</dt><dd>${Number.isFinite(o.buySellRatio) ? `${o.buySellRatio}×` : '—'}</dd>
        <dt>Vechime pool principal</dt><dd>${days(o.pairAgeDays)}</dd>
        <dt>Scor GeckoTerminal</dt><dd>${o.gtScore ?? '—'}</dd></dl>
      <ul class="facts">${checks.map(([, label, st, extra]) => html`<li>${st ? statusLine(tone[st], label, { size: 13 }) : statusLine('muted', `${label}: necunoscut`, { size: 13 })}${extra ? html`<span class="muted">${extra}</span>` : ''}</li>`)}</ul>
    </div>
  </section>`;
}

const ENTITY_TYPE = { cex: 'exchange', fund: 'fond', 'market maker': 'market maker', dex: 'DEX / pool', protocol: 'protocol', wallet: 'portofel' };
const signedUsd = (x) => (Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${usd(Math.abs(x))}` : '—');

/** Arkham wallet intelligence (CRI v0.5.4 layer): who moves the token, and in which direction. */
function walletIntel(c, s) {
  if (c.depth !== 'deep') return '';
  const w = c.onchain?.walletFlows;
  const ark = (s.health?.providers ?? []).find((p) => p.id === 'arkham');
  const win = String(w?.window ?? '7d').replace(/^(\d+)d$/, '$1 zile').replace(/^(\d+)h$/, '$1 h');
  const title = html`<h3 class="block-title">Fluxuri portofele și entități <span class="muted">Arkham, ultimele ${win}</span></h3>`;
  if (!w) {
    const msg = ark?.status === 'NOT_CONFIGURED'
      ? 'Arkham nu este configurat. Adaugă secretul ARKHAM_API_KEY în GitHub (Settings → Secrets and variables → Actions) ca radarul să citească fluxurile de portofele și entitățile pentru primii candidați. Până atunci aceste fapte sunt necunoscute, nu negative.'
      : 'Fără fluxuri Arkham pentru acest token în rularea curentă (bugetul de apeluri s-a epuizat sau tokenul nu are ID CoinGecko).';
    return html`<section>${title}<p class="small muted">${msg}</p></section>`;
  }
  const ratio = w.netflowRatio;
  const width = Number.isFinite(ratio) ? Math.min(50, Math.abs(ratio) * 50) : 0;
  const verdict = !Number.isFinite(ratio) ? 'necunoscut' : ratio >= 0.15 ? 'portofelele acumulează' : ratio <= -0.15 ? 'portofelele distribuie' : 'echilibrat';
  const exVerdict = !Number.isFinite(w.exchangeBias) ? 'necunoscut' : w.exchangeBias >= 0.15 ? `retrageri nete ${usd(-w.exchangeNetUsd)}` : w.exchangeBias <= -0.15 ? `depuneri nete ${usd(w.exchangeNetUsd)}` : 'echilibrat';
  const per = w.persistence;
  return html`<section>${title}
    <div class="bar-row" style="grid-template-columns:150px minmax(0,1fr) 120px;margin-bottom:12px" data-tip="${tip(html`<b>Flux net portofele</b><br>(intrări − ieșiri) / (intrări + ieșiri) pentru adresele care nu sunt exchange-uri sau pool-uri DEX`)}">
      <span class="lbl">Flux net portofele</span>
      <span class="track div"><b class="${ratio >= 0 ? 'pos-b' : 'neg-b'}" style="width:${width.toFixed(1)}%"></b></span>
      <span class="val ${ratio >= 0 ? 'pos' : 'neg'}">${Number.isFinite(ratio) ? pct(ratio * 100, { dec: 0 }) : '—'}</span>
    </div>
    <div class="cols-2">
      <dl class="kv">
        <dt>Verdict portofele</dt><dd>${verdict}</dd>
        <dt>Portofele: intrări / ieșiri</dt><dd>${usd(w.walletInUsd)} / ${usd(w.walletOutUsd)} <span class="muted small">(net ${signedUsd(w.walletNetUsd)})</span></dd>
        <dt>Exchange-uri</dt><dd>${exVerdict} <span class="muted small">(depuneri ${usd(w.exchangeInUsd)}, retrageri ${usd(w.exchangeOutUsd)})</span></dd>
        <dt>Pool-uri DEX / protocoale</dt><dd>net ${signedUsd(w.protocolNetUsd)}</dd>
        <dt>Persistența acumulării</dt><dd>${per ? `${per.positive} din ${per.total} observații pozitive` : 'apare după câteva rulări'}</dd>
        <dt>Entități etichetate</dt><dd>${w.entityCount ?? 0} <span class="muted small">${Number.isFinite(w.labeledShare) ? `(${Math.round(w.labeledShare * 100)}% din volumul fluxurilor)` : ''}</span></dd>
      </dl>
      ${(w.topEntities ?? []).length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Entitate</th><th>Tip</th><th class="n">Net</th></tr></thead><tbody>
        ${w.topEntities.map((e) => html`<tr><td style="white-space:normal">${e.name}</td><td class="ink2">${ENTITY_TYPE[String(e.type ?? '').toLowerCase()] ?? ENTITY_TYPE[e.cls] ?? e.type ?? 'portofel'}</td><td class="n ${e.netUsd > 0 ? 'pos' : e.netUsd < 0 ? 'neg' : ''}">${signedUsd(e.netUsd)}</td></tr>`)}
      </tbody></table></div>` : html`<p class="small muted">Nicio entitate etichetată printre adresele cu cele mai mari fluxuri.</p>`}
    </div>
    <p class="xs muted" style="margin-top:8px">Adresele cu cele mai mari fluxuri ale tokenului în fereastră. Retragerile de pe exchange-uri spre portofele indică acumulare; depunerile indică posibilă vânzare. Fluxul singur nu face un semnal: contează doar împreună cu structura, activitatea și analogii.</p>
  </section>`;
}

// GoPlus taxes are fractions (0.05 = 5%); the risk engine flags ≥ 3% (medium) and ≥ 25% (critical).
const taxPct = (t) => (Number.isFinite(t) ? `${(t * 100).toFixed(t * 100 < 10 ? 1 : 0)}%` : '—');
function taxState(sec) {
  if (!Number.isFinite(sec.buyTax) && !Number.isFinite(sec.sellTax)) return null;
  const m = Math.max(sec.buyTax ?? 0, sec.sellTax ?? 0);
  return m >= 0.25 ? 'bad' : m >= 0.03 ? 'warn' : 'ok';
}

const SPOT_NAME = { binance: 'Binance', mexc: 'MEXC', gate: 'Gate', okx: 'OKX', bitget: 'Bitget' };

/** The validity gate's verdict for this project: the reason it may appear in the CRI lists. */
function validity(c) {
  const v = c.validity;
  if (!v?.checks?.length) return '';
  return html`<section><h3 class="block-title">Verificare de validitate <span class="muted">doar proiectele verificate intră în listele CRI</span></h3>
    <div style="margin-bottom:6px">${validityBadge(v)}</div>
    ${validityList(v)}
  </section>`;
}

function venues(c) {
  const v = c.venues ?? {};
  const a = c.attention ?? {};
  const alpha = v.alpha ?? {};
  const alphaText = alpha.status === 'LISTED' ? `listat${alpha.listingCex ? ', deja pe Binance spot/futures' : ''}${alpha.holders ? `, ${int(alpha.holders)} holderi` : ''}` : alpha.status === 'NOT_LISTED' ? 'nelistat' : 'necunoscut';
  const f = c.fundamentals;
  return html`<section><h3 class="block-title">Venue-uri, atenție și fundamente</h3>
    <div class="sec-grid">
      <dl class="kv"><dt>Spot</dt><dd>${v.spot ? (v.spot.length ? v.spot.map((x) => SPOT_NAME[x] ?? x).join(', ') : 'nelistat pe bursele citite') : v.mexcSpot ? 'MEXC' : 'nu'}</dd><dt>Binance Alpha</dt><dd>${alphaText}</dd><dt>Perpetual</dt><dd>${v.perps?.length ? v.perps.join(', ') : 'niciunul'}</dd><dt>Upbit / Bithumb (KRW)</dt><dd>${v.krw ? `${v.krw.upbit ? 'Upbit' : ''}${v.krw.upbit && v.krw.bithumb ? ', ' : ''}${v.krw.bithumb ? 'Bithumb' : ''}${!v.krw.upbit && !v.krw.bithumb ? 'nelistat' : ''}${v.krw.warning ? `, avertisment: ${v.krw.warning}` : ''}` : '—'}</dd></dl>
      <dl class="kv"><dt>Trending CoinGecko</dt><dd>${a.cgTrending ? `da${a.cgTrendingRank ? ` (#${a.cgTrendingRank})` : ''}` : 'nu'}</dd><dt>Boost DexScreener</dt><dd>${a.dexBoost ? `${a.dexBoost} (promovare plătită)` : 'nu'}</dd><dt>Trending GeckoTerminal</dt><dd>${a.gtTrending ? 'da' : 'nu'}</dd><dt>Watchlist CoinGecko</dt><dd>${int(a.watchlistUsers)}</dd></dl>
      <dl class="kv">${f ? html`<dt>Protocol</dt><dd>${f.protocol ?? '—'}</dd><dt>TVL</dt><dd>${usd(f.tvl)} ${change(f.tvlChange7d)}</dd><dt>MC / TVL</dt><dd>${Number.isFinite(f.mcapToTvl) ? `${f.mcapToTvl.toFixed(2)}×` : '—'}</dd><dt>Fees 30z</dt><dd>${usd(f.fees30d)}</dd>` : html`<dt>Fundamente</dt><dd class="muted">fără protocol DefiLlama asociat</dd>`}</dl>
    </div>
  </section>`;
}

function catalysts(c) {
  const list = c.catalysts ?? [];
  return html`<section><h3 class="block-title">Catalizatori</h3>
    ${list.length ? html`<ul class="feed">${list.map((e) => html`<li><span class="when">${dateTime(e.eventTime ?? e.observedAt)}</span><span class="what">${polarity(e.polarity)} <b>${e.title}</b><p>${(L.catalysts[e.type] ?? e.type) !== e.title ? `${L.catalysts[e.type] ?? e.type}, ` : ''}sursă: ${sourceLabel(e.source)}${e.eventTime && Date.parse(e.eventTime) > Date.now() ? `, programat ${date(e.eventTime)}` : ''}</p></span><span class="meta">${POLARITY[e.polarity]?.label ?? ''}<br>încredere ${Math.round((e.confidence ?? 0) * 100)}%</span></li>`)}</ul>` : html`<p class="small muted">Niciun catalizator detectat în ultimele zile.</p>`}
  </section>`;
}

function history(c, s) {
  const chart = criHistoryChart(c.history, s.methodology?.thresholds?.signals, L.stages, { width: CHART_W, height: 150 });
  if (!chart) return '';
  return html`<section><h3 class="block-title">Istoric scor CRI <span class="muted">liniuțele de jos marchează schimbările de stadiu</span></h3>${chart}</section>`;
}

function risks(c) {
  const flags = c.risk?.flags ?? [];
  return html`<section><h3 class="block-title">Riscuri <span class="muted">separate de oportunitate; doar riscurile critice blochează semnalul</span></h3>
    ${flags.length ? html`<ul class="facts">${flags.map((f) => html`<li>${statusLine(SEVERITY[f.severity]?.tone ?? 'muted', SEVERITY[f.severity]?.label ?? f.severity, { size: 13 })}<span><b>${f.label}</b>${f.detail ? html` <span class="muted">(${f.detail})</span>` : ''}</span></li>`)}</ul>` : html`<p class="small muted">Niciun semnal de risc detectat cu datele disponibile.</p>`}
  </section>`;
}

export function drawerMarkup(c, s, { narrow = false } = {}) {
  CHART_W = narrow ? 440 : 860;
  const links = c.links ?? {};
  return html`
  <header class="drawer-head">
    <div>
      <h2 class="drawer-title" id="drawer-title">${c.symbol} <span class="name">${c.name}</span></h2>
      <div class="small ink2" style="margin-top:4px">${lifecycle(c.stage, { proxy: c.stageProxy })} <span class="muted">${(c.stageReasons ?? []).slice(0, 3).join(', ')}</span></div>
    </div>
    <button class="icon-btn close-btn" type="button" data-close aria-label="Închide fișa">${icon('close', 16)}</button>
    <div class="drawer-links">
      ${extLink(links.coingecko, 'CoinGecko')} ${extLink(links.coinmarketcap, 'CoinMarketCap')} ${extLink(links.dexscreener, 'DexScreener')} ${extLink(links.mexc, 'MEXC')} ${extLink(links.explorer, 'Explorer')} ${extLink(links.website, 'Website')} ${extLink(links.twitter, 'X')}
      ${c.contract ? html`<button class="linkish" type="button" data-copy="${c.contract}" data-tip="${tip(c.contract)}">${icon('copy', 13)} ${c.chainLabel ?? ''} ${shortAddr(c.contract)}</button>` : ''}
    </div>
  </header>
  <div class="drawer-body">
    ${c.depth !== 'deep' ? html`<div class="notice" data-kind="stale" style="border:1px solid var(--line);border-radius:var(--r-md)"><div class="frame" style="padding:10px 12px">${icon('info', 15)}<p><b>Evaluare rapidă.</b> Scor calculat din piață, venue-uri, derivate și catalizatori; fără lumânări, SMC sau on-chain. Domeniile lipsă sunt necunoscute, nu negative.</p></div></div>` : ''}
    ${verdict(c)}
    ${thesis(c)}
    ${plan(c)}
    ${structure(c, s)}
    ${analogs(c, s)}
    ${domains(c)}
    ${market(c)}
    ${derivatives(c)}
    ${onchain(c)}
    ${walletIntel(c, s)}
    ${validity(c)}
    ${venues(c)}
    ${catalysts(c)}
    ${history(c, s)}
    ${risks(c)}
    <p class="xs muted">${s.meta?.disclaimer ?? ''} Snapshot ${s.meta?.runId}, generat ${ago(s.meta?.generatedAt)}.</p>
  </div>`;
}

