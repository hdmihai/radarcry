/** Reference library: LAB, BTW, AGT measured before ignition, plus who resembles them right now. */
import { html, raw, tip } from '../core/dom.js';
import { date, pct, price, score, usd } from '../core/format.js';
import { L } from '../core/labels.js';
import { referenceWindowChart } from '../charts/lines.js';
import { f2 } from '../charts/scale.js';
import { cri, refChip, signalBadge } from './widgets.js';

function profile(ref, features) {
  const W = 300;
  const H = 64;
  const n = features.length;
  const gap = 3;
  const groupGap = 8;
  const bw = (W - gap * (n - 1) - groupGap) / n;
  let x = 0;
  const parts = [];
  features.forEach((f, i) => {
    if (i > 0 && features[i - 1].group === 'dna' && f.group !== 'dna') x += groupGap;
    const v = ref.vector?.[f.key];
    if (Number.isFinite(v)) {
      const h = Math.max(2, (v / 100) * (H - 14));
      parts.push(`<rect x="${f2(x)}" y="${f2(H - 12 - h)}" width="${f2(bw)}" height="${f2(h)}" rx="1.5" fill="var(--ref)" fill-opacity="${f.group === 'dna' ? 0.95 : 0.55}"/>`);
    } else {
      parts.push(`<rect x="${f2(x)}" y="${H - 22}" width="${f2(bw)}" height="10" fill="var(--hatch)"/>`);
    }
    parts.push(`<rect class="hit" x="${f2(x)}" y="0" width="${f2(bw + gap)}" height="${H}" data-tip="${tip(html`<b>${f.label}</b><div class="tt-row"><span>${ref.symbol}</span><span>${Number.isFinite(v) ? Math.round(v) : 'necunoscut'}</span></div><span class="muted">${f.group === 'dna' ? 'trăsătură structurală (ADN)' : 'trăsătură de fază (timing)'}</span>`)}"/>`);
    x += bw + gap;
  });
  parts.push(`<line x1="0" x2="${W}" y1="${H - 12}" y2="${H - 12}" stroke="var(--line-strong)"/>`);
  parts.push(`<text x="0" y="${H - 1}">ADN</text><text x="${f2(W - 2)}" y="${H - 1}" text-anchor="end">fază</text>`);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profilul amprentei ${ref.symbol}">${parts.join('')}</svg>`;
}

function closest(s, symbol, n = 5) {
  return s.candidates
    .map((c) => ({ c, a: (c.analogs?.all ?? []).find((x) => x.ref === symbol) }))
    .filter((x) => Number.isFinite(x.a?.similarity) && x.c.stage !== 'EXPANSION' && x.c.stage !== 'POST_EXPANSION')
    .sort((a, b) => b.a.similarity - a.a.similarity)
    .slice(0, n);
}

function refCard(r, s) {
  const chart = referenceWindowChart(r);
  const live = r.live;
  const near = closest(s, r.symbol);
  return html`<article class="ref-card" data-ref="${r.symbol}">
    <div>
      <h3 class="ref-name">${r.symbol} <small>${r.name}${r.chain ? `, ${r.chain.toUpperCase()}` : ''}</small></h3>
      <p class="small ink2" style="margin-top:4px">${r.status === 'COMPUTED' ? 'Amprentă măsurată' : 'Amprentă statică (documentată)'}: ${r.statusNote ?? ''}</p>
    </div>
    <div><span class="ref-outcome">${r.outcome?.gainPct ? `+${Math.round(r.outcome.gainPct).toLocaleString('en-US')}%` : '—'}</span> <span class="small ink2">în ${r.outcome?.days ?? '—'} zile după ancora din ${date(r.anchorDate)}</span></div>
    ${chart ? html`<div>${chart}</div>` : html`<p class="small muted">Istoricul zilnic nu a putut fi descărcat; se folosește amprenta documentată.</p>`}
    <div><div class="small muted" style="margin-bottom:4px">Profil amprentă (0–100)</div>${raw(profile(r, s.features ?? []))}</div>
    <p class="small ink2">${r.outcomeNote ?? ''}</p>
    <div class="small"><span class="muted">Stadii în ultimele ${(r.sequence ?? []).length} zile înainte de ancoră:</span> ${seqSummary(r.sequence ?? [])}</div>
    ${live ? html`<dl class="kv"><dt>Acum</dt><dd>${price(live.price)} (${usd(live.marketCap)})</dd><dt>7z / 30z</dt><dd>${pct(live.change7d)} / ${pct(live.change30d)}</dd><dt>De la ATH</dt><dd>${pct(live.athChangePct)}</dd></dl>` : ''}
    <div><div class="small muted" style="margin-bottom:6px">Cei mai apropiați acum (înainte de expansiune)</div>
      ${near.length ? html`<div class="feed" style="border-top:0">${near.map(({ c, a }) => html`<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)"><button class="tok-btn" type="button" data-open="${c.key}">${c.symbol}</button><span class="small ink2">ADN ${score(a.dnaSim)}, total <b>${score(a.similarity)}</b></span>${signalBadge(c.signal)}</div>`)}</div>` : html`<p class="small muted">Niciun candidat comparabil.</p>`}
    </div>
    ${r.sources?.length ? html`<div class="small"><span class="muted">Surse:</span> ${r.sources.map((src, i) => html`${i ? ', ' : ''}<a href="${src.url}" target="_blank" rel="noopener noreferrer">${src.title.split(' — ')[0]}</a>`)}</div>` : ''}
  </article>`;
}

function seqSummary(seq) {
  if (!seq.length) return '—';
  const counts = {};
  for (const x of seq) counts[x] = (counts[x] ?? 0) + 1;
  const parts = L.stageOrder.filter((st) => counts[st]).map((st) => `${L.stages[st] ?? st} ${counts[st]} z`);
  return `${parts.join(', ')}; ultima zi: ${L.stages[seq[seq.length - 1]] ?? seq[seq.length - 1]}`;
}

function matrix(s) {
  const refs = s.references ?? [];
  if (refs.length < 2) return '';
  const cell = (v) => {
    const lvl = v >= 80 ? 4 : v >= 60 ? 3 : v >= 40 ? 2 : v >= 20 ? 1 : 0;
    const dark = lvl >= 3;
    return html`<td style="background:var(--seq-${lvl});color:${dark ? 'var(--plane)' : 'var(--ink)'}">${Number.isFinite(v) ? Math.round(v) : '—'}</td>`;
  };
  return html`<section class="section"><h3 class="section-title">Cât de diferite sunt referințele între ele</h3>
    <p class="small ink2" style="margin-bottom:10px;max-width:75ch">Similaritatea dintre cele trei amprente pe aceeași scală. Dacă ar fi aproape identice, potrivirea cu „oricare” nu ar adăuga informație; diferențele arată că fiecare acoperă un tipar distinct.</p>
    <table class="matrix"><thead><tr><th></th>${refs.map((r) => html`<th>${refChip(r.symbol)}</th>`)}</tr></thead>
    <tbody>${refs.map((r) => html`<tr><th>${refChip(r.symbol)}</th>${refs.map((q) => cell(r.crossSimilarity?.[q.symbol]))}</tr>`)}</tbody></table>
  </section>`;
}

export function analogsMarkup(s) {
  const refs = s.references ?? [];
  const best = [...s.candidates].filter((c) => c.analogs?.best && !['EXPANSION', 'POST_EXPANSION'].includes(c.stage)).sort((a, b) => b.analogs.best.similarity - a.analogs.best.similarity).slice(0, 10);
  return html`
  <div class="view-head"><div><h2 class="view-title">Analogi: LAB, BTW, AGT</h2>
    <p class="view-lede">Fiecare referință este măsurată din istoricul zilnic doar până la ancora pump-ului (fără look-ahead). Amprenta are 9 trăsături structurale (ce fel de token este) și 6 de fază (unde se află în ciclu), pe o scală fixă 0–100, aceeași cu care sunt comparați candidații.</p></div></div>
  <div class="cols-3">${refs.map((r) => refCard(r, s))}</div>
  ${matrix(s)}
  <section class="section"><h3 class="section-title">Cele mai mari similarități din tot universul</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Token</th><th>Analog</th><th class="n">Similaritate</th><th class="n">ADN</th><th class="n">Fază</th><th class="n">CRI</th><th>Semnal</th></tr></thead>
    <tbody>${best.map((c) => html`<tr data-open="${c.key}"><td><button class="tok-btn" type="button" data-open="${c.key}">${c.symbol}</button> <span class="muted small">${c.name}</span></td><td>${refChip(c.analogs.best.ref)}</td><td class="n"><b>${score(c.analogs.best.similarity)}</b></td><td class="n">${score(c.analogs.best.dnaSim)}</td><td class="n">${score(c.analogs.best.phaseSim)}</td><td class="n">${cri(c.score, c.key)}</td><td>${signalBadge(c.signal)}</td></tr>`)}</tbody></table></div>
  </section>`;
}
