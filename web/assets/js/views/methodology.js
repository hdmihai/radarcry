/** Methodology: principles, weights, fingerprint features, thresholds and the lifecycle vocabulary. */
import { html } from '../core/dom.js';
import { usd } from '../core/format.js';
import { L } from '../core/labels.js';

const STAGE_HELP = {
  DECLINE: 'Pantă negativă, sub EMA50, jos în range.',
  BASE: 'Lateral, fără direcție; aici se formează baza.',
  BUILDING: 'Minime ascendente și peste EMA50 sau pantă pozitivă.',
  ACCELERATION: 'Volum în accelerare, peste EMA20, primele procente de creștere.',
  PRE_EXPANSION: 'Sus în range, volatilitate comprimată, volum în creștere, minime ascendente: momentul urmărit.',
  EXPANSION: 'Mișcarea a pornit (7z ≥ 80% sau 30z ≥ 150%): târziu.',
  POST_EXPANSION: 'După un pump mare, corecție de peste 35%.',
};

export function methodologyMarkup(s) {
  const m = s.methodology ?? {};
  const th = m.thresholds ?? {};
  const sig = th.signals ?? {};
  const uni = th.universe ?? {};
  const domains = [...(m.domains ?? [])].sort((a, b) => b.weight - a.weight);
  const wmax = Math.max(0.01, ...domains.map((d) => d.weight));
  return html`
  <div class="view-head"><div><h2 class="view-title">Metodologie</h2>
    <p class="view-lede">Cum ajunge un token din top 1000 în radar și cum se calculează fiecare număr. Totul este determinist și reproductibil: același snapshot de date produce același rezultat.</p></div></div>
  <div class="cols-2">
    <section><h3 class="section-title">Principii</h3>
      <ul class="facts">${(m.principles ?? []).map((p) => html`<li><span>${p}</span></li>`)}</ul>
      <h3 class="section-title" style="margin-top:24px">Fluxul unei rulări</h3>
      <ol class="small ink2" style="padding-left:18px;display:grid;gap:6px;margin:0">
        <li>Universul: top ${uni.topN ?? 1000} CoinGecko + CoinMarketCap (CoinPaprika ca rezervă) plus listele publice Binance Alpha și Gate Alpha, unificate după contract și nume.</li>
        <li>Filtre: market cap între ${usd(uni.minMarketCapUsd)} și ${usd(uni.maxMarketCapUsd)}, volum 24h peste ${usd(uni.minVolume24hUsd)}, fără stablecoin/wrapped.</li>
        <li>Venue-uri: MEXC spot, Binance spot, perpetual MEXC/Gate/Bitget/OKX/Hyperliquid, Upbit/Bithumb, Binance Alpha, Gate Alpha, trending CoinGecko/GeckoTerminal, boost-uri DexScreener, DefiLlama.</li>
        <li>Cercetare profundă pe tot orizontul (până la ${m.horizon?.deep ?? s.meta?.config?.deepHorizon ?? 1000} de proiecte): lumânări 1D/4H și lichiditate DEX pentru fiecare; securitate, detalii, deținători și dezvoltare prin rotație între rulări; prioritatea de ${m.horizon?.priority ?? s.meta?.config?.deepLimit ?? 60} proiecte primește în plus liste complete de deținători și, cu cheie Arkham, fluxurile de portofele și entități.</li>
        <li>Futures Radar pe fiecare piață perpetuă din univers (până la ${m.horizon?.futures ?? 1000}); tabelul complet al orizontului se publică în data/universe.json (ecranul Univers).</li>
        <li>Fuziunea dovezilor pe 9 domenii, stadiu, hype, risc, semnal și plan structural.</li>
        <li>Diferența față de rularea anterioară devine catalizatori și alerte; semnalele intră în track record.</li>
      </ol>
    </section>
    <section><h3 class="section-title">Ponderile domeniilor</h3>
      <div class="bars">${domains.map((d) => html`<div class="bar-row"><span class="lbl">${d.label}</span><span class="track"><b style="width:${((d.weight / wmax) * 100).toFixed(1)}%"></b></span><span class="val">${Math.round(d.weight * 100)}%</span></div>`)}</div>
      <p class="small ink2" style="margin-top:12px">CRI = scor fuzionat × (0.70 + 0.20 × încredere + 0.10 × acoperire). Tier A ≥ 80, B ≥ 70, C ≥ 60, D ≥ 50.</p>
      <h3 class="section-title" style="margin-top:24px">Praguri de semnal</h3>
      <dl class="kv">
        <dt>Setup BUY</dt><dd>stadiu pre-expansiune sau accelerare, CRI ≥ ${sig.buySetup?.minCri}, similaritate ≥ ${sig.buySetup?.minAnalog}, fiabilitate ≥ ${sig.buySetup?.minReliability}, 4H nu bearish, fără hype, risc sub D</dd>
        <dt>Acumulare</dt><dd>bază, construcție sau pre-expansiune, CRI ≥ ${sig.accumulate?.minCri}, similaritate ≥ ${sig.accumulate?.minAnalog}, setup ≥ ${sig.accumulate?.minSetup}</dd>
        <dt>Urmărire</dt><dd>CRI ≥ ${sig.watch?.minCri} sau similaritate ≥ ${sig.watch?.minAnalog}</dd>
        <dt>Risk-off</dt><dd>pragul CRI pentru Setup BUY crește cu ${sig.riskOffPenalty} puncte</dd>
      </dl>
    </section>
  </div>
  <section class="section"><h3 class="section-title">Amprenta comparată cu LAB, BTW, AGT</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Trăsătură</th><th>Familie</th><th class="n">Pondere</th></tr></thead><tbody>
      ${(m.features ?? []).map((f) => html`<tr><td>${f.label}</td><td class="ink2">${f.group === 'dna' ? 'ADN (structură)' : 'fază (timing)'}</td><td class="n">${f.weight}</td></tr>`)}
    </tbody></table></div>
    <p class="small ink2" style="margin-top:10px">Similaritate gaussiană pe scala fixă 0–100 (σ = ${th.similarity?.sigma}), acoperire minimă ${Math.round((th.similarity?.minCoverage ?? 0) * 100)}%; trăsăturile necunoscute sunt excluse din calcul, nu tratate ca diferență. Secvența de stadii (LCS) contribuie ${Math.round((th.similarity?.sequenceWeight ?? 0) * 100)}%.</p>
  </section>
  <section class="section"><h3 class="section-title">Ciclul de viață</h3>
    <div class="tbl-wrap"><table class="tbl"><tbody>${L.stageOrder.map((st) => html`<tr><td><b>${L.stages[st] ?? st}</b></td><td class="ink2" style="white-space:normal">${STAGE_HELP[st] ?? ''}</td></tr>`)}</tbody></table></div>
  </section>
  <section class="section"><h3 class="section-title">Limitări asumate</h3>
    <ul class="facts">
      <li><span>API-urile gratuite au limite de rată; o rulare durează câteva minute și poate omite surse lente (marcate explicit).</span></li>
      <li><span>Holderii și concentrarea vin din GeckoTerminal/GoPlus și pot include adrese de exchange sau contracte de vesting neetichetate.</span></li>
      <li><span>Trei referințe sunt un eșantion mic: similaritatea ridicată arată un tipar comun, nu garantează un rezultat similar.</span></li>
      <li><span>${s.meta?.disclaimer ?? ''}</span></li>
    </ul>
  </section>`;
}
