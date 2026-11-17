/** Derivatives positioning and narrative rotation. */
import { html, raw, tip } from '../core/dom.js';
import { frac, funding, pct, score, usd } from '../core/format.js';
import { L } from '../core/labels.js';
import { change, signalBadge } from './widgets.js';

export function derivativesMarkup(s) {
  const sq = s.derivatives?.squeezeWatch ?? [];
  const crowded = s.candidates
    .filter((c) => Number.isFinite(c.derivatives?.fundingAvg) && c.derivatives.fundingAvg >= 0.0005 && (c.derivatives.oiToMcap ?? 0) >= 0.05)
    .sort((a, b) => b.derivatives.fundingAvg - a.derivatives.fundingAvg)
    .slice(0, 20);
  return html`
  <div class="view-head"><div><h2 class="view-title">Derivate</h2>
    <p class="view-lede">Perpetual-urile de pe MEXC, Gate, Bitget și OKX arată cine e poziționat greșit. Open interest în creștere cu funding negativ înseamnă short-uri care plătesc ca să rămână în poziție: combustibil pentru un squeeze dacă prețul își ține structura. Funding mare și pozitiv înseamnă long-uri aglomerate.</p></div></div>
  <section><h3 class="section-title">Squeeze watch <span class="muted small">(ordonat după combustibil: funding ≤ 0, OI în creștere, OI/MC ridicat)</span></h3>
    ${sq.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Token</th><th class="n">Open interest</th><th class="n">OI/MC</th><th class="n">OI ~24h</th><th class="n">Funding</th><th>Venue-uri</th><th class="n">7z</th><th class="n">CRI</th><th class="n">Combustibil</th></tr></thead><tbody>
      ${sq.map((x) => html`<tr data-open="${x.key}"><td><button class="tok-btn" type="button" data-open="${x.key}">${x.symbol}</button></td><td class="n">${usd(x.oiUsd)}</td><td class="n">${frac(x.oiToMcap)}</td><td class="n">${change(x.oiChangePct)}</td><td class="n">${funding(x.fundingAvg)}</td><td class="ink2">${(x.venues ?? []).join(', ')}</td><td class="n">${change(x.change7d)}</td><td class="n">${score(x.cri)}</td><td class="n" data-tip="${tip('Câte condiții sunt îndeplinite din 3: funding ≤ 0, OI +15% în ~24h, OI/MC peste 10%')}"><span class="life-bar" role="img" aria-label="${x.fuel ?? 0} din 3">${raw([0, 1, 2].map((i) => `<i class="${i < (x.fuel ?? 0) ? 'on' : ''}"></i>`).join(''))}</span></td></tr>`)}
    </tbody></table></div>` : html`<div class="empty"><strong>Niciun perpetual cu funding disponibil.</strong>Lista se umple când MEXC, Gate, Bitget sau OKX răspund; variația OI apare după a doua rulare.</div>`}
  </section>
  <section class="section"><h3 class="section-title">Long-uri aglomerate <span class="muted small">(funding ≥ 0.05%, OI/MC ≥ 5%)</span></h3>
    ${crowded.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Token</th><th class="n">Funding</th><th class="n">OI/MC</th><th class="n">Open interest</th><th class="n">7z</th><th>Semnal</th></tr></thead><tbody>
      ${crowded.map((c) => html`<tr data-open="${c.key}"><td><button class="tok-btn" type="button" data-open="${c.key}">${c.symbol}</button></td><td class="n">${funding(c.derivatives.fundingAvg)}</td><td class="n">${frac(c.derivatives.oiToMcap)}</td><td class="n">${usd(c.derivatives.oiUsd)}</td><td class="n">${change(c.market?.change?.d7)}</td><td>${signalBadge(c.signal)}</td></tr>`)}
    </tbody></table></div>` : html`<p class="small muted">Niciun token cu funding pozitiv extrem în universul publicat.</p>`}
  </section>`;
}

export function narrativesMarkup(s) {
  const nar = s.market?.narratives ?? [];
  const maxAbs = Math.max(1, ...nar.map((n) => Math.abs(n.change24hPct ?? 0)));
  const stages = s.stats?.stages ?? {};
  const sigs = s.stats?.signals ?? {};
  const totalStages = Object.values(stages).reduce((a, b) => a + b, 0) || 1;
  const maxStage = Math.max(1, ...Object.values(stages));
  return html`
  <div class="view-head"><div><h2 class="view-title">Narative și ciclu</h2>
    <p class="view-lede">Rotația pe categorii CoinGecko în ultimele 24 de ore și unde se află universul scanat în ciclul de viață. Un token bun într-o narativă care începe să se rotească are vânt din spate.</p></div></div>
  <div class="cols-2">
    <section><h3 class="section-title">Categorii, variație 24h</h3>
      ${nar.length ? html`<div class="bars">${nar.map((n) => {
        const v = n.change24hPct ?? 0;
        const w = (Math.abs(v) / maxAbs) * 50;
        return html`<div class="bar-row" data-tip="${tip(html`<b>${n.name}</b><div class="tt-row"><span>Market cap</span><span>${usd(n.marketCap)}</span></div><div class="tt-row"><span>Volum 24h</span><span>${usd(n.volume24h)}</span></div><div class="tt-row"><span>Candidați în radar</span><span>${n.candidates}</span></div><div class="tt-row"><span>Top</span><span>${(n.topCoins ?? []).join(', ')}</span></div>`)}">
          <span class="lbl">${n.name}${n.candidates ? html` <span class="muted">(${n.candidates})</span>` : ''}</span>
          <span class="track div"><b class="${v >= 0 ? 'pos-b' : 'neg-b'}" style="width:${w.toFixed(1)}%"></b></span>
          <span class="val ${v >= 0 ? 'pos' : 'neg'}">${pct(v)}</span></div>`;
      })}</div>` : html`<p class="small muted">Categoriile CoinGecko nu au fost disponibile în acest snapshot.</p>`}
      <p class="xs muted" style="margin-top:8px">În paranteză: câți candidați din radar aparțin categoriei.</p>
    </section>
    <section><h3 class="section-title">Universul pe stadii</h3>
      <div class="bars">${L.stageOrder.map((st) => html`<div class="bar-row"><span class="lbl">${L.stages[st] ?? st}</span><span class="track"><b style="width:${((stages[st] ?? 0) / maxStage * 100).toFixed(1)}%"></b></span><span class="val">${stages[st] ?? 0} <span class="muted">(${Math.round(((stages[st] ?? 0) / totalStages) * 100)}%)</span></span></div>`)}</div>
      <h3 class="section-title" style="margin-top:24px">Semnale în snapshot</h3>
      <div class="bars">${['BUY_SETUP', 'ACCUMULATE', 'WATCH', 'LATE', 'AVOID', 'NONE'].map((t) => html`<div class="bar-row"><span class="lbl">${L.signals[t] === '—' ? 'Fără semnal' : L.signals[t] ?? t}</span><span class="track"><b style="width:${((sigs[t] ?? 0) / Math.max(1, ...Object.values(sigs)) * 100).toFixed(1)}%"></b></span><span class="val">${sigs[t] ?? 0}</span></div>`)}</div>
    </section>
  </div>
  <section class="section"><h3 class="section-title">Candidați după categorie</h3>
    ${(() => {
      const byCat = new Map();
      for (const c of s.candidates.filter((x) => x.depth === 'deep')) for (const cat of c.categories ?? []) {
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(c);
      }
      const rows = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12);
      if (!rows.length) return html`<p class="small muted">Categoriile sunt disponibile doar pentru tokenii cercetați în profunzime.</p>`;
      return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Categorie</th><th class="n">Candidați</th><th>Cei mai buni</th></tr></thead><tbody>
        ${rows.map(([cat, list]) => html`<tr><td>${cat}</td><td class="n">${list.length}</td><td>${list.sort((a, b) => b.score.cri - a.score.cri).slice(0, 5).map((c, i) => html`${i ? ', ' : ''}<button class="tok-btn" type="button" data-open="${c.key}">${c.symbol}</button> <span class="muted small">${score(c.score.cri)}</span>`)}</td></tr>`)}
      </tbody></table></div>`;
    })()}
  </section>`;
}

