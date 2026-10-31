/** Methodology: principles, weights, fingerprint features, thresholds, the validity gate, the ≥100× forecast and the lifecycle vocabulary. */
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

/** A published threshold, or a dash when an older snapshot does not carry it. */
const val = (x) => (Number.isFinite(x) ? x : '—');

/** The validity gate in one table: what each check reads and what makes it fail. */
function validityMethod(v) {
  const p = v?.policy;
  if (!p) return '';
  const rows = [
    ['Capitalizare mică sau medie, confirmată', 'CoinGecko, CoinMarketCap, CoinPaprika, Binance Alpha', `peste ${usd(p.maxMarketCapUsd)} sau sub ${usd(p.minMarketCapUsd)}; capitalizare raportată doar de Gate Alpha; stablecoin, token împachetat, activ tokenizat`],
    ['Proiect real, identificat', 'agregatori, Binance Alpha, GoPlus, site și conturi sociale', 'niciun agregator și nici Binance Alpha; GoPlus: imitație a altui token sau airdrop scam'],
    ['Listat pe burse', 'spot Binance, OKX, Gate, Bitget, MEXC, Upbit, Bithumb; perpetue; Binance Alpha; lista de burse GoPlus', `nicio piață centralizată care tranzacționează (volum ≥ ${usd(p.minSpotVolumeUsd)} în 24 h) — Gate Alpha singur nu ajunge`],
    ['Contract fără capcane', 'GoPlus Token Security (EVM și Solana), GeckoTerminal', `honeypot, vânzare blocată, taxă peste ${p.maxTaxPct}%, owner care modifică solduri, autodistrugere, creator cu honeypot-uri; owner ascuns, cod neverificat, înghețare — doar dacă nicio bursă de nivel 1–2 nu îl listează`],
    ['Lichiditate reală', 'burse centralizate, DexScreener, Binance Alpha', `fără piață spot centralizată și pool DEX sub ${usd(p.minDexLiquidityUsd)}`],
    ['Distribuția deținătorilor', 'GoPlus, NodeReal (EVM), Solana RPC', `informativ: atenționare peste ${p.concentrationWarnPct}% în top 10 efectiv`],
    ['Vechime și activitate', 'DexScreener, Binance Alpha, CoinGecko', `informativ: atenționare sub ${p.minAgeDays} zile sau rotație peste ${p.turnoverWarn}× capitalizarea pe zi`],
  ];
  return html`<section class="section"><h3 class="section-title">Poarta de validitate</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Verificare</th><th>Ce citește</th><th>Respinge când</th></tr></thead><tbody>
      ${rows.map(([a, b, c]) => html`<tr><td><b>${a}</b></td><td class="ink2" style="white-space:normal">${b}</td><td class="ink2" style="white-space:normal">${c}</td></tr>`)}
    </tbody></table></div>
    <p class="small ink2" style="margin-top:10px">Rezultatul rulării curente: ${v.summary?.valid ?? 0} verificate, ${v.summary?.pending ?? 0} în verificare, ${v.summary?.rejected ?? 0} respinse — lista completă în ecranul <a href="#/validare">Validare</a>.</p>
  </section>`;
}

/** The ≥100× forecast in one paragraph per step, with the numbers of the current run. */
function forecastMethod(f) {
  if (!f?.model) return '';
  const r100 = (f.baseRates ?? []).find((r) => r.multiple === 100);
  const confirmed = (f.winners ?? []).filter((w) => w.status === 'CONFIRMED').length;
  return html`<section class="section"><h3 class="section-title">Prognoza ≥100× în 12 luni</h3>
    <ol class="small ink2" style="padding-left:18px;display:grid;gap:6px;margin:0">
      <li>Lista de învățare: proiectele care au crescut de cel puțin ${f.targets?.[1] ?? 20}× în ultimele ${f.windowDays ?? 365} de zile — semințe documentate din surse publice (LAB, BTW, IRYS…) plus candidații semnalați automat de minimele și maximele istorice ale pieței — confirmate fiecare din istoricul zilnic CoinGecko, pe mediana a trei zile, cu minimul acceptat doar unde capitalizarea și volumul erau reale.</li>
      <li>Amprenta fiecărui câștigător se calculează la minimul lui, doar din lumânările de până atunci, pe aceleași trăsături ca analogii LAB/BTW/AGT. Ce s-a întâmplat după minim este eticheta, niciodată o trăsătură.</li>
      <li>Rata de bază: câștigătorii împărțiți la proiectele urmărite în fereastră, cu o estimare prudentă la pornire (${f.model.prior?.pct}% pe an, cântărită ca ${f.model.prior?.weight} de proiecte) și interval Wilson de 90%.</li>
      <li>Ajustarea: raportul de densitate dintre câștigători (la minim) și universul de azi, nucleu gaussian (σ = ${f.model.sigma}, acoperire minimă ${Math.round((f.model.minCoverage ?? 0) * 100)}%), tras spre 1 cât timp câștigătorii sunt puțini (k = ${f.model.shrinkK}) și limitat la ×${f.model.lrClamp}. Probabilitatea finală: p = p₀·LR / (p₀·LR + 1 − p₀).</li>
    </ol>
    <p class="small ink2" style="margin-top:10px">Rularea curentă: ${confirmed} câștigători confirmați, rata de bază ≥100× ${r100 ? `${r100.pct}% (${r100.lo}–${r100.hi}%)` : '—'} — detaliile în ecranul <a href="#/prognoza">Prognoză</a>.</p>
  </section>`;
}

export function methodologyMarkup(s) {
  const m = s.methodology ?? {};
  const th = m.thresholds ?? {};
  const sig = th.signals ?? {};
  const uni = th.universe ?? {};
  // The legacy CRI engine's weights and fingerprint live under `similarity` since contract v4.
  const domains = [...(m.similarity?.domains ?? m.domains ?? [])].sort((a, b) => b.weight - a.weight);
  const features = m.similarity?.features ?? m.features ?? [];
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
        <li>Filtre: market cap între ${usd(uni.minMarketCapUsd)} și ${usd(uni.maxMarketCapUsd)}, volum 24h peste ${usd(uni.minVolume24hUsd)}, fără stablecoin-uri (inclusiv cele ancorate la euro, franc sau yen), tokenuri împachetate sau acțiuni tokenizate.</li>
        <li>Venue-uri: spot Binance, OKX, Gate, Bitget, MEXC, Upbit/Bithumb; perpetual MEXC/Gate/Bitget/OKX/Hyperliquid; Binance Alpha, Gate Alpha, trending CoinGecko/GeckoTerminal, boost-uri DexScreener, DefiLlama.</li>
        <li>Cercetare profundă pe tot orizontul (până la ${m.horizon?.deep ?? s.meta?.config?.deepHorizon ?? 1000} de proiecte): lumânări 1D/4H și lichiditate DEX pentru fiecare; securitate, detalii, deținători și dezvoltare prin rotație între rulări; prioritatea de ${m.horizon?.priority ?? s.meta?.config?.deepLimit ?? 60} proiecte primește în plus liste complete de deținători și, cu cheie Arkham, fluxurile de portofele și entități.</li>
        <li>Futures Radar pe fiecare piață perpetuă din univers (până la ${m.horizon?.futures ?? 1000}); tabelul complet al orizontului se publică în data/universe.json (ecranul Univers).</li>
        <li>Fuziunea dovezilor pe 9 domenii, stadiu, hype, risc, semnal și plan structural.</li>
        <li>Poarta de validitate (ecranul <a href="#/validare">Validare</a>): în listele CRI intră doar proiectele care trec cinci verificări obligatorii — capitalizare mică sau medie confirmată de un agregator, proiect real și identificat, listare pe burse, contract fără capcane (GoPlus) și lichiditate reală. O dovadă negativă respinge; o dovadă lipsă ține proiectul „în verificare”, fără să-l eticheteze.</li>
        <li>Prognoza (ecranul <a href="#/prognoza">Prognoză</a>): probabilitatea fiecărui proiect verificat de a crește de cel puțin 100× (și 20×) în 12 luni, din rata de bază a ultimului an și din cât seamănă azi cu câștigătorii la minimul lor.</li>
        <li>Diferența față de rularea anterioară devine catalizatori și alerte; semnalele intră în track record.</li>
      </ol>
    </section>
    <section><h3 class="section-title">Ponderile domeniilor</h3>
      <div class="bars">${domains.map((d) => html`<div class="bar-row"><span class="lbl">${d.label}</span><span class="track"><b style="width:${((d.weight / wmax) * 100).toFixed(1)}%"></b></span><span class="val">${Math.round(d.weight * 100)}%</span></div>`)}</div>
      <p class="small ink2" style="margin-top:12px">CRI = scor fuzionat × (0.70 + 0.20 × încredere + 0.10 × acoperire). Tier A ≥ 80, B ≥ 70, C ≥ 60, D ≥ 50.</p>
      <h3 class="section-title" style="margin-top:24px">Praguri de semnal</h3>
      <dl class="kv">
        <dt>Setup BUY</dt><dd>stadiu pre-expansiune sau accelerare, CRI ≥ ${val(sig.buySetup?.minCri)}, similaritate ≥ ${val(sig.buySetup?.minAnalog)}, fiabilitate ≥ ${val(sig.buySetup?.minReliability)}, 4H nu bearish, fără hype, risc sub D</dd>
        <dt>Acumulare</dt><dd>bază, construcție sau pre-expansiune, CRI ≥ ${val(sig.accumulate?.minCri)}, similaritate ≥ ${val(sig.accumulate?.minAnalog)}, setup ≥ ${val(sig.accumulate?.minSetup)}</dd>
        <dt>Urmărire</dt><dd>CRI ≥ ${val(sig.watch?.minCri)} sau similaritate ≥ ${val(sig.watch?.minAnalog)}</dd>
        <dt>Risk-off</dt><dd>pragul CRI pentru Setup BUY crește cu ${val(sig.riskOffPenalty)} puncte</dd>
      </dl>
    </section>
  </div>
  <section class="section"><h3 class="section-title">Amprenta comparată cu LAB, BTW, AGT</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Trăsătură</th><th>Familie</th><th class="n">Pondere</th></tr></thead><tbody>
      ${features.map((f) => html`<tr><td>${f.label}</td><td class="ink2">${f.group === 'dna' ? 'ADN (structură)' : 'fază (timing)'}</td><td class="n">${f.weight}</td></tr>`)}
    </tbody></table></div>
    <p class="small ink2" style="margin-top:10px">Similaritate gaussiană pe scala fixă 0–100 (σ = ${th.similarity?.sigma}), acoperire minimă ${Math.round((th.similarity?.minCoverage ?? 0) * 100)}%; trăsăturile necunoscute sunt excluse din calcul, nu tratate ca diferență. Secvența de stadii (LCS) contribuie ${Math.round((th.similarity?.sequenceWeight ?? 0) * 100)}%.</p>
  </section>
  <section class="section"><h3 class="section-title">Ciclul de viață</h3>
    <div class="tbl-wrap"><table class="tbl"><tbody>${L.stageOrder.map((st) => html`<tr><td><b>${L.stages[st] ?? st}</b></td><td class="ink2" style="white-space:normal">${STAGE_HELP[st] ?? ''}</td></tr>`)}</tbody></table></div>
  </section>
  ${validityMethod(s.validity)}
  ${forecastMethod(s.forecast)}
  <section class="section"><h3 class="section-title">Limitări asumate</h3>
    <ul class="facts">
      <li><span>Poarta de validitate reduce riscul, nu îl elimină: GoPlus nu acoperă toate lanțurile, iar o listare pe o bursă mare nu garantează proiectul. Atenționările (concentrare, taxe mici, mint) rămân de verificat manual.</span></li>
      <li><span>API-urile gratuite au limite de rată; o rulare durează câteva minute și poate omite surse lente (marcate explicit).</span></li>
      <li><span>Holderii și concentrarea vin din GeckoTerminal/GoPlus și pot include adrese de exchange sau contracte de vesting neetichetate.</span></li>
      <li><span>Trei referințe sunt un eșantion mic: similaritatea ridicată arată un tipar comun, nu garantează un rezultat similar.</span></li>
      <li><span>Prognoza ≥100× estimează un eveniment rar dintr-o listă scurtă de câștigători: cea mai mare probabilitate rămâne de ordinul procentelor, iar agregatorii păstrează mai ales supraviețuitorii, deci rata de bază este o limită superioară. Calibrarea se măsoară în timp, de agentul AI.</span></li>
      <li><span>${s.meta?.disclaimer ?? ''}</span></li>
    </ul>
  </section>`;
}
