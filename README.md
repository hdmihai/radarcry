# CRI Radar

**Crypto Research Intelligence** — un motor de cercetare care scanează top 1000 CoinMarketCap și
CoinGecko plus toate tokenurile Binance Alpha și Gate Alpha, cercetează în profunzime **fiecare**
proiect eligibil (până la 1000) și răspunde la o singură întrebare, formulată cuvânt cu cuvânt:

> „Arată-mi proiectele mici unde se schimbă simultan mai multe lucruri importante, înainte ca
> mișcarea să devină evidentă, și spune-mi ce riscuri pot invalida această ipoteză.”

Node.js, arhitectură hexagonală, **zero dependențe la rulare**, **niciun abonament de niciun fel**.
Rulează pe GitHub Actions și publică un dashboard static pe GitHub Pages.

Pe lângă răspunsul la întrebare, fiecare proiect verificat primește o **prognoză ≥100× în 12 luni**,
învățată din câștigătorii ultimului an (LAB, BTW, IRYS, AKEDO, pippin…), iar un **agent AI separat**
monitorizează gratuit toate porțile de calitate ale proiectului și învață din istoricul lui.

Este un proiect **exclusiv de cercetare**. Nicio componentă nu plasează și nu transmite ordine — un
test de arhitectură respinge automat orice endpoint de execuție sau de retragere.

---

## Ce face, concret

Întrebarea are patru părți, iar fiecare are un motor dedicat.

### „proiectele mici”
Proiecte mici și medii: capitalizare între **1 și 300 milioane $**, volum de minimum
**500 000 $/zi**. Universul este construit din două surse independente (CoinGecko și
CoinMarketCap, cu CoinPaprika ca plasă de siguranță), fuzionate pe contract și pe nume, nu pe simbol
— ca să nu ajungă doi omonimi în același rând; același simbol pe același lanț, dar la alt contract,
este alt token. Stablecoin-urile (recunoscute și după comportament: un token ancorat la 1 $, 1 € sau
la altă monedă, oricum s-ar numi), activele wrapped/staked și acțiunile tokenizate sunt excluse
explicit, iar fiecare excludere este numărată și publicată.

### Poarta de validitate: cine are voie în listele CRI
Înainte de a fi clasat, fiecare proiect eligibil trece **cinci verificări obligatorii**. Doar cele
care le trec pe toate apar în Small-Cap Radar, Radar CRI, Deep Research, alerte și track record:

| Verificare | Ce citește | Respinge când |
|---|---|---|
| Capitalizare mică sau medie, confirmată | CoinGecko, CoinMarketCap, CoinPaprika, Binance Alpha | peste 300 M$ sau sub 1 M$; capitalizare raportată doar de Gate Alpha; stablecoin, wrapped, tokenizat |
| Proiect real, identificat | agregatori, Binance Alpha, GoPlus, site și conturi sociale | niciun agregator și nici Binance Alpha; GoPlus: imitație a altui token, airdrop scam |
| Listat pe burse | spot Binance, OKX, Gate, Bitget, MEXC, Upbit, Bithumb; perpetue; Binance Alpha; lista de burse GoPlus | nicio piață centralizată care tranzacționează (≥ 10 000 $ în 24 h) — Gate Alpha singur nu ajunge |
| Contract fără capcane | GoPlus Token Security (EVM și Solana), GeckoTerminal | honeypot, vânzare blocată, taxă > 10 %, owner care modifică solduri, autodistrugere, creator cu honeypot-uri; owner ascuns, cod neverificat, înghețare — doar dacă nicio bursă de nivel 1–2 nu îl listează |
| Lichiditate reală | burse centralizate, DexScreener, Binance Alpha | fără piață spot centralizată și pool DEX sub 50 000 $ |

Distribuția deținătorilor și vechimea sunt **informative**: produc atenționări, nu resping. Regula
proiectului se aplică și aici — **„necunoscut” nu înseamnă „respins”**: un proiect al cărui contract
nu a fost încă scanat stă „în verificare” până îl aduce rotația GoPlus, fără să fie etichetat; doar o
dovadă respinge. Ecranul **Validare** publică regulile, numerele și fiecare proiect oprit, cu motivul;
în **Univers** filtrul „Validare” arată implicit doar proiectele verificate. Pragurile sunt în
`config/default.json` → `validity`.

**Binance Alpha intră în univers în întregime**, nu doar ca etichetă. LAB, BTW și AGT erau toate
tokenuri Alpha, iar LAB avea 12 M$ capitalizare înainte de mișcare — sub pragul de ~15 M$ al top
1000 CoinGecko. Un token Alpha deja prezent în top 1000 este doar îmbogățit; unul din afara lui
devine proiect propriu, cu identitatea CoinGecko când aceasta îi cunoaște contractul. Lista Alpha
(publică, fără cheie) aduce gratuit, pentru fiecare token, deținătorii și lichiditatea: două familii
de factori măsurabile față de propria normă la fiecare rulare, fără niciun apel în plus. Pe un token
Alpha cu rotație de peste 100 % pe zi, invalidatorul `ALPHA_VOLUME` amintește că o parte din volum
poate veni din farmingul punctelor Alpha.

**Programele Alpha ale tuturor burselor**, verificate unul câte unul (octombrie 2026):

| Bursă | Program | Listă publică prin API | Cum intră în radar |
|---|---|---|---|
| Binance | Binance Alpha | da — token list, exchange info, klines (developers.binance.com) | univers + holderi + lichiditate + lumânări 1D/4H + intrări noi |
| Gate | Gate Alpha | da — API v4 `/alpha/currencies` și `/alpha/tickers`, fără cheie | univers + preț, volum, capitalizare + intrări noi (`NEW_GATE_ALPHA`) |
| KuCoin | KuCoin Alpha | nu (doar anunțuri) | prin agregatori, DEX și listele Binance/Gate |
| Bybit | Bybit Alpha | nu | la fel |
| Bitget | Bitget Onchain | nu (API-ul Bitget Wallet cere parteneriat) | la fel |
| MEXC | zona Alpha / DEX+ | nu | la fel |

Un token ales de **mai multe** programe Alpha poartă eticheta fiecăruia, iar intrarea într-un program
(Binance Alpha, Gate Alpha), o listare coreeană sau trecerea Alpha → Binance spot contează ca
schimbare în familia „listări și acces”.

### Orizontul: întregul univers, nu o listă scurtă
Fiecare proiect eligibil — până la **1000** — este cercetat în profunzime la fiecare rulare:
lumânări 1D/4H (Binance, MEXC, Binance Alpha) și lichiditate DEX pentru toate. Sursele gratuite care
răspund doar câteva zeci de apeluri pe rulare (GoPlus, detaliile CoinGecko, GeckoTerminal, GitHub,
YouTube) **se rotesc** prin univers: prioritatea rulării întâi, apoi proiectele măsurate cel mai demult.
Faptele statice (securitatea contractului, categoriile, repository-ul) se păstrează între rulări cu
data citirii; măsurătorile (deținători, commit-uri, mențiuni) nu sunt niciodată copiate în istoric a
doua oară — un proiect nemăsurat în rularea curentă raportează „necunoscut”, nu cifra de ieri.
Futures Radar evaluează **fiecare piață perpetuă** din univers. Dashboard-ul arată vârful fiecărui
clasament cu toate dovezile, iar ecranul **Univers** (`data/universe.json`) arată toate rândurile.

Pe adresele partajate ale runner-elor GitHub, planurile gratuite răspund des „prea multe cereri”.
O limită de rată nu oprește furnizorul: încetinește toată coada lui (pauza cerută de server, apoi un
ritm mai rar, care revine treptat după răspunsuri reușite), iar circuitul se deschide doar după
câteva cereri la rând refuzate chiar și după pauză. Sursele lente se opresc cu 4 minute înainte de
termenul rulării, ca Futures Radar și snapshot-ul să aibă timpul lor.

Citirile care depind de cine le-a măsurat — deținători, lichiditate, concentrare — își păstrează
sursa, iar norma compară doar citiri din aceeași sursă: o rulare în care a răspuns GoPlus și una în
care a răspuns GeckoTerminal nu produc o „creștere a deținătorilor” falsă.

### „se schimbă simultan mai multe lucruri importante”
Fiecare rulare completă salvează un punct per proiect pe o ramură de stare. Din acel istoric se
construiește **norma proprie a proiectului** (median + MAD pe 30 de zile), iar o schimbare contează
doar dacă depășește acea normă — nu un prag universal. Un token cu volum mereu erratic nu primește un
semnal pentru același salt care ar fi remarcabil pe unul liniștit.

Simultaneitatea cere **lățime**: minimum 3 schimbări importante în minimum 2 **familii distincte** de
factori (fluxuri, deținători, lichiditate, derivate, fundamente, atenție, listări, structură). Cinci
semnale din aceeași familie sunt un singur lucru care se întâmplă, nu cinci.

### „înainte ca mișcarea să devină evidentă”
**Precocitatea** este raportată separat de momentum și nu este niciodată contopită cu el. Cazul LAB
din soluția tehnică este exact motivul: un proiect deja +400 % are momentum 98 și precocitate 35 —
excelent și prea târziu. Evidența publică se măsoară din preț, poziția în interval, trending,
boost-uri plătite și funding aglomerat.

### „ce riscuri pot invalida această ipoteză”
Riscul nu este o notă, ci o **listă de invalidatori numiți**. Fiecare rând spune ce anume ar falsifica
teza și unde se urmărește: honeypot, owner care poate relua controlul, taxă de vânzare, LP neblocat,
deblocare în 30 de zile, float mic, concentrare efectivă, lichiditate subțire, funding periculos,
trezoreria care trimite către burse exact în timpul semnalului. Un invalidator critic duce singur
scorul de risc în banda critică, fiindcă exact asta înseamnă „critic”.

### Verdictul
```
Early Research Candidate = Stage 1–2  ȘI  oportunitate > 75  ȘI  risc < 60
```
Definiția din soluția tehnică, fără condiții adăugate. Un proiect „răspunde la întrebare” când trece
acest test **și** are schimbări simultane în cel puțin două familii.

### Prognoza ≥100× în 12 luni, învățată din câștigătorii ultimului an
Fiecare proiect verificat primește probabilitatea unei creșteri de cel puțin **100×** (și de **20×**,
clasa LAB / BTW / IRYS) în următoarele 12 luni: pe card, în dosar, în fișa proiectului, în Univers
(coloana „≥100×”) și în ecranul **Prognoză ≥100×**. Este o estimare statistică a unui eveniment rar,
nu o predicție: chiar și cea mai mare probabilitate rămâne de ordinul procentelor.

1. **Lista de învățare** — proiectele care au crescut de cel puțin 15× în ultimele 365 de zile, din
   două surse gratuite: semințe documentate cu surse publice (`config/winners.json`) și candidații
   semnalați automat, la fiecare scanare, de minimele și maximele istorice ale întregii piețe
   (aceeași listă CoinGecko pe care scanarea o citește oricum — zero apeluri în plus). Fiecare intrare
   se confirmă din istoricul zilnic CoinGecko (câteva pe rulare, în bugetul gratuit), pe mediana a
   trei zile, cu minimul acceptat doar unde capitalizarea ≥ 1 M$ și volumul ≥ 25 000 $ — un tick
   izolat pe o pereche goală nu poate inventa o mișcare de 1000×.
2. **Amprenta la minim** — fiecare câștigător este măsurat *la minimul lui*, doar din lumânările de
   până atunci, pe aceleași trăsături ca analogii LAB/BTW/AGT. Ce s-a întâmplat după minim este
   eticheta, niciodată o trăsătură.
3. **Rata de bază** — câștigătorii împărțiți la proiectele mici urmărite în fereastră, cu o estimare
   prudentă la pornire (0,5 % pe an, cântărită ca 200 de proiecte) și interval Wilson de 90 %.
4. **Ajustarea** — cât de dens stau câștigătorii (la minim) în jurul proiectului față de cât de dens stă
   universul de azi (nucleu gaussian pe amprentă), trasă spre 1 cât timp câștigătorii sunt puțini și
   limitată la ×25: `p = p₀·LR / (p₀·LR + 1 − p₀)`. Intervalul publicat combină incertitudinea ratei
   de bază cu cât se schimbă estimarea când oricare câștigător lipsește din listă.

Semințele documentate (31 octombrie 2026, fiecare cu sursele ei în `config/winners.json`):

| Proiect | Lanț | Minim → vârf | Multiplu | Azi față de vârf |
|---|---|---|---|---|
| AKEDO (AKE) | BNB Chain | 0,000174 $ (iul 2026) → 0,1401 $ (20 sep 2026) | ~805× | −82 % |
| Bitway (BTW) | BNB Chain | 0,007687 $ (2 mar 2026) → 2,75 $ (14 oct 2026) | ~358× | −54 % |
| pippin (PIPPIN) | Solana | 0,00257 $ (oct 2025) → 0,8973 $ (26 feb 2026) | ~349× | −98 % |
| LAB | BNB Chain | ~0,10 $ (dec 2025) → 27,48 $ (iun 2026) | ~275× | −99,8 % |
| Alaya (AGT) | BNB Chain | 0,00161 $ (oct 2025) → 0,1099 $ (18 oct 2026) | ~68× | −32 % |
| Venice (VVV) | Base | 0,9172 $ (nov 2025) → 34,47 $ (sep 2026) | ~38× | −38 % |
| Irys (IRYS) | — | 0,0118 $ (oct 2026) → 0,2648 $ (23 oct 2026) | ~22× | −92 % |
| Audiera (BEAT) | BNB Chain | 0,59 $ (mai 2026) → 11,10 $ (12 iun 2026) | ~19× | −99 % |
| River (RIVER) | BNB Chain | ~5 $ (dec 2025) → 87,54 $ (26 ian 2026) | ~18× | −99 % |
| DeAgentAI (AIA) | BNB Chain | vârf 25,52 $ (7 nov 2025), minim nedocumentat | — | — |

Excluse, cu motivul: **YZY** (minimul raportat pare un tick izolat), **DOYR** (+5 891 % de la ~80 mii $
capitalizare — sub pragul universului, invizibil înainte de mișcare), **MYX, COAI, 币安人生** (mișcarea
principală s-a încheiat înainte de fereastra de 12 luni).

Ce spune lista, onest: **majoritatea câștigătorilor și-au pierdut aproape tot câștigul** după vârf
(mediana de azi față de vârf este în jur de −90 %), agregatorii păstrează mai ales supraviețuitorii
(deci rata de bază este o limită superioară), iar puterea de separare a amprentei se măsoară pe datele
de învățare (optimistă). De aceea agentul AI înregistrează săptămânal fiecare prognoză și o compară cu
ce s-a întâmplat efectiv — calibrarea se măsoară în timp, nu se presupune.

---

## Pornire rapidă

```bash
git clone <repo> && cd cri-radar
node --version            # ≥ 22.12 (vezi .nvmrc)

npm run demo              # piață simulată determinist → dashboard pe http://localhost:8080
```

`npm run demo` nu atinge niciun API: rulează pe un simulator de piață determinist care conține tipare
plantate de tip LAB/BTW/AGT, ca fiecare ecran să poată fi explorat înainte de prima scanare reală.

Pentru date reale:

```bash
npm run probe             # verifică fiecare sursă gratuită și spune ce funcționează de pe mașina ta
npm run scan              # scanare completă → data/latest.json + stare locală
npm run build && npm run serve
```

| Comandă | Ce face |
|---|---|
| `npm run scan` | scanare completă (univers, venue-uri, deținători, securitate, dezvoltare, atenție) |
| `npm run pulse` | reîmprospătare de 15 minute: preț, funding, open interest — nimic cu cuotă lunară |
| `npm run probe` | o cerere mică per furnizor (a doua trecere pentru ce nu a răspuns); stare, latență, chei lipsă, pașii de înscriere și ce nod Solana servește ce metodă |
| `npm run labels` | reconstruiește setul de etichete on-chain din eth-labels (MIT) |
| `npm run demo` | scanare simulată + agentul AI pe istoric simulat + build + server local |
| `npm run ci` | verificare de sintaxă + 322 de teste (arhitectură, motoare, contract, end-to-end, agent) |
| `npm run ci:gates` | aceeași suită, raportată pe porți de calitate (`.gates.json`, citit de agent în CI) |
| `npm run agent` | agentul AI pe repository-ul real (`GITHUB_REPOSITORY=owner/nume`, doar citire fără token) |
| `npm run agent:demo` | agentul AI pe istoricul simulat al demo-ului → `data/agent.json` |
| `npm run summary` | raportul de rulare, așa cum apare în GitHub Actions |

---

## Surse — toate publice sau cu cont gratuit

Nu există niciun abonament în acest proiect. Un **test de arhitectură respinge orice apel către un
host care nu este pe lista de surse aprobate**, și respinge explicit host-urile despre care se știe
că necesită plată. Adăugarea unui furnizor cere adăugarea lui pe listă, în același commit, cu planul
gratuit declarat — exact pasul de review care împiedică un endpoint plătit să se strecoare.

### Fără nicio cheie
CoinPaprika · MEXC spot și futures · oglinda publică de date Binance (`data-api.binance.vision`) ·
Gate (spot + perpetue + Gate Alpha) · Bitget (spot + perpetue) · OKX (spot + perpetue) · Hyperliquid · Upbit · Bithumb · Binance Alpha · DexScreener · GeckoTerminal ·
noduri RPC Solana publice (Solana Foundation, PublicNode, dRPC, OnFinality — încercate pe rând) ·
DefiLlama Open API · alternative.me Fear & Greed · setul de etichete
[eth-labels](https://github.com/dawsbot/eth-labels) (MIT, 61 108 adrese, inclus în repository)

### Cu o cheie gratuită, opțională
| Variabilă | Plan | Ce deblochează |
|---|---|---|
| `COINGECKO_API_KEY` | Demo, 10 000 apeluri/lună | limite mai mari pe universul principal |
| `CMC_API_KEY` | Basic, 10 000 credite/lună (top 1000 = 5 credite) | **top 1000 CoinMarketCap** — al doilea univers independent + verificare încrucișată |
| `COINALYZE_API_KEY` | cont gratuit, 40 apeluri/minut | funding și open interest pe Binance, Bybit, OKX |
| `NODEREAL_API_KEY` | Free, 10 mil. unități/lună | lista de deținători pe lanțurile EVM |
| `SOLANA_RPC_URL` | Helius Free (fără card), 1 mil. credite/lună, 10 cereri/s | lista de deținători pe Solana din GitHub Actions — URL-ul întreg, cu cheia: `https://mainnet.helius-rpc.com/?api-key=…` |
| `CRYPTOQUANT_API_KEY` | Basic, 10 000 credite/lună | context de ciclu pe BTC/ETH |
| `YOUTUBE_API_KEY` | gratuit, 10 000 unități/zi | atenție video (API-ul X nu are nivel gratuit de citire) |
| `GITHUB_TOKEN` | gratuit, 5 000 cereri/oră | activitate de dezvoltare (în Actions există deja) |
| `ARKHAM_API_KEY` | trial gratuit, la cerere | tipul și numele entității pentru deținători |

**Nicio cheie nu este obligatorie.** Fără ea, capabilitatea devine `UNKNOWN` — ceea ce nu înseamnă
„negativ”, ci „nemăsurat” — sau rămâne disponibilă prin interfața web gratuită a platformei.

**De ce `SOLANA_RPC_URL`.** Lista celor mai mari deținători pe Solana vine din `getTokenLargestAccounts`,
metoda pe care nodurile gratuite o restricționează primele (parcurge toate conturile token-ului).
Nodul public al Solana Foundation a răspuns HTTP 429 la fiecare astfel de apel din GitHub Actions, la
fiecare rulare. Scanarea întreabă acum pe rând mai multe noduri publice și ține minte, pe durata
rulării, care metodă e refuzată unde; dacă niciunul nu o servește, raportează exact asta, iar
concentrarea pe Solana vine în continuare din GeckoTerminal. Un URL dintr-un cont gratuit Helius
(înscriere fără card, 1 credit per apel; o rulare folosește cel mult 90) este încercat primul și
face lista disponibilă la fiecare rulare. URL-ul conține cheia: este citit doar din secret și nu apare
niciodată în loguri, în snapshot sau pe dashboard.

### Platformele cu API plătit, păstrate ca link gratuit
**CoinGlass**, **Dune Analytics**, **Arkham Intelligence** (web) și **exploratoarele de lanț** rămân
în proiect ca **linkuri cu context precompletat** pe fiecare proiect: chain, contract, simbol. Așa le
folosește oricum un cercetător. Ce ar fi venit din API-ul lor plătit este fie reconstruit din surse
gratuite și marcat explicit ca model (harta de lichidări), fie listat ca neacoperit.

---

## Eficiența față de soluțiile profesionale

Cerința a fost „eficiență comparabilă cu soluțiile comerciale, minimum 90 % din performanța lor”.
Afirmația are sens doar dacă este **calculată**, așa că proiectul o calculează în doi pași: ce poate
face (matricea de capabilități, calculată de motor la fiecare scanare) și cât de des și cât de sigur
o face efectiv (măsurat de agentul AI din istoricul rulărilor).

**1. Paritatea de capabilități** — o matrice de **32 de capabilități ponderate**: tot ce oferă un
birou de research plătit (clasa Nansen / Arkham Pro / CoinGlass / Messari / Kaito / Token Metrics) și
cum este acoperit aici. Trei cifre, niciodată una:

| Cifră | Valoare | Ce înseamnă |
|---|---|---|
| **Permanent** | **87,7 %** | doar ce funcționează fără nicio cheie care poate expira |
| **Cu cheile gratuite opționale** | **92,8 %** | inclusiv sloturile de cheie configurate de operator |
| **Atins în ultima rulare live** | **82,9 %** | o sursă care nu a răspuns sau o cheie gratuită neconfigurată scade această cifră |

**2. Eficiența operațională** — un desk profesional este în timp real; acesta reîmprospătează cercetarea
la 4 ore și faptele de piață la 15 minute, iar GitHub sare o parte din programări. Valoarea unui fapt de
cercetare scade cu timpul (timp de înjumătățire de 24 h pentru semnalele de cercetare, construite pentru
orizonturi de zile, și de 2 h pentru funding și open interest); o reîmprospătare la I ore păstrează în
medie `F(I) = H / (I·ln 2) · (1 − 2^(−I/H))` din valoare.

| Măsurat pe repository-ul live (31 oct 2026) | Promis de cron | Livrat |
|---|---|---|
| Scanări complete pe zi | 6 | 4,1 |
| Pulsuri pe zi | 96 | 5,4 |
| Prospețimea datelor | 94,6 % | 87,1 % |
| Scanări reușite (14 zile) | — | 96,4 % |

```
eficiență efectivă = paritate atinsă × prospețime livrată × fiabilitate = 82,9 % × 87,1 % × 96,4 % ≈ 69,6 %
ținta de design    = paritate cu chei gratuite × prospețime promisă       = 92,8 % × 94,6 %          ≈ 87,8 %
```

Diferența se explică în trei pârghii, de la cea mai mare: **cheile gratuite neconfigurate** (~10 puncte
— `NODEREAL_API_KEY`, `SOLANA_RPC_URL` de la Helius Free și `COINALYZE_API_KEY` readuc fluxurile pe
portofele mari, open interest-ul agregat și harta de lichidări), **programările sărite de GitHub**
(~6 puncte — agentul AI le completează acum cu `workflow_dispatch`) și **scanările eșuate** (~3 puncte).

**3. Costul** — prețurile publice ale soluțiilor comparate, octombrie 2026:

| Soluție profesională | Ce acoperă | Preț |
|---|---|---|
| [Nansen Pro](https://academy.nansen.ai/articles/9412804-pro-plan-explained) | etichete, Smart Money, fluxuri pe portofele, alerte | 49 $/lună anual, 69 $/lună lunar |
| [CoinGlass API](https://coinglass.com/pricing) | funding, open interest, lichidări în timp real | 29 – 699 $/lună |
| [Token Metrics](https://nexusfi.com/d/data-providers/token-metrics/) | note AI și prognoze | 33 – 625 $/lună |
| [Messari](https://costbench.com/software/onchain-analytics/messari) | research și fundamente | planul Pro retras în 2026, doar Enterprise la cerere |
| Arkham Intel API | entități pe adrese | acces la cerere; interfața web rămâne gratuită |
| **CRI Radar** | **toate capabilitățile de mai sus, mai puțin două** | **0 $** |

Capabilitățile neacoperite sunt **listate explicit**, nu ascunse: flux de lichidări pe ordine în timp
real (CoinGlass, plătit) și analiza fluxului X (fără nivel gratuit de citire). Prognoza este marcată ca
model (credit 85 %), la fel ca harta de lichidări.

![Paritate și bugete gratuite](docs/img/parity.png)

---

## Porțile de calitate

Toate verificările de care depinde proiectul, într-un singur catalog (`agent/domain/gates.js`),
evaluate de agentul AI la fiecare rulare. Starea de mai jos este cea **măsurată pe repository-ul live**
pe 31 octombrie 2026 (scanarea de la 14:35 UTC), înainte de publicarea acestei versiuni: 27 trecute,
3 atenționări, 0 eșecuri; porțile marcate *nou* încep să fie măsurate după push.

**Cod — CI la fiecare push, pe Node 22 și 24**

| Poartă | Ce verifică | Stare live |
|---|---|---|
| CI verde pe ultimul commit din main | suita completă, ambele versiuni de Node | ✅ 46495d6, ambele joburi |
| Sintaxă validă | `node --check` pe src, web, scripts, test, agent | ✅ |
| Arhitectură hexagonală | domeniu pur și determinist, aplicația doar spre domeniu, simulator = adaptoare reale, workflow-uri fără concurență comună | ✅ |
| Doar surse gratuite | fiecare URL din adaptoare pe lista aprobată; CoinGlass API, Dune API, X API, Moralis, Etherscan, CryptoPanic, **CoinGecko Pro** interzise | ✅ |
| Exclusiv research | niciun endpoint de ordine sau retragere | ✅ |
| Teste de domeniu / aplicație / adaptoare / interfață | 143 / 62 / 59 / 18 teste | ✅ |
| Testele agentului AI | 30 de teste | *nou* |
| Scanare DEMO offline + contract + site | simulare de 10 zile, schemă validă, `dist/` complet | ✅ |
| Pulsul păstrează contractul | pulsul nu încalcă schema | ✅ |
| Etichetele on-chain clasifică | eth-labels (MIT) prezent și verificat | ✅ |

**Rulare — fiecare scanare live**

| Poartă | Ce verifică | Stare live |
|---|---|---|
| Ultima scanare live a reușit | fără republicarea snapshot-ului vechi | ✅ 14:35 UTC, 14,9 min |
| Contractul publicat respectă schema | `data/latest.json` validat înainte de publicare | ✅ |
| Sursele obligatorii au răspuns | universul CoinGecko, lumânările 1D/4H | ✅ 2/2 |
| Furnizorii gratuiți răspund | eșecuri și rata de succes istorică | ⚠️ 16/20 — Solana RPC public limitat (24 %), GoPlus 72 %, GeckoTerminal 82 %, GitHub 79 % (cauza GitHub — circuit deschis de 404-uri — este corectată în această versiune) |
| Bugetele planurilor gratuite | consum lunar proiectat < 80 % | ✅ max 14,7 % (CoinGecko) |
| Poarta de validitate aplicată | fiecare proiect eligibil are verdict, niciun respins în liste | ✅ 426 verificate · 0 în verificare · 69 respinse |
| Prognoza ≥100× | câștigători confirmați, rată de bază plauzibilă, fără date din viitor | *nou* |
| Durata scanării în normă | sub `runtime.maxMinutes` și în norma învățată | ✅ 14 din 22 min |
| Universul în normă | top 1000 complet, eligibile fără prăbușiri | ✅ 4 539 unificate, 495 eligibile |
| Starea cercetării salvată | `cri-state` conține ultima scanare | ✅ 28 de rulări |
| Site-ul publică ultimul snapshot | GitHub Pages servește aceeași rulare | ✅ deploy 14:53 UTC reușit |
| Prospețimea datelor | vârsta snapshot-ului față de cadența promisă | ✅ 1,2 h (ultimul puls 14:52 UTC) |
| Nicio cheie în fișierele publicate | snapshot, rezumat, univers, raportul agentului | ✅ 3 fișiere, 3,8 MB, curate |

**Cadență și programare**

| Poartă | Ce verifică | Stare live |
|---|---|---|
| Cadența scanării | rulări efective / promise, 7 zile | ⚠️ 4,1 / 6 pe zi (69 %), interval median 5,9 h, maxim 10,3 h |
| Cadența pulsului | idem, „best effort” prin design | ⚠️ 5,4 / 96 pe zi (6 %) |
| Workflow-uri active | niciunul dezactivat | ✅ 5/5 |
| Activitate în repository | programările se opresc după 60 de zile fără activitate | ✅ |

**Periodice, model și agent**

| Poartă | Ce verifică | Stare live |
|---|---|---|
| Sonda săptămânală | un apel pe fiecare furnizor | ✅ 27 oct (eșecul din 26 oct a fost rezolvat de commitul 2c6def4 — reconstruit de agent) |
| Actualizarea lunară a etichetelor | reconstruire eth-labels + PR | … prima rulare pe 1 noiembrie |
| Calibrarea prognozei | observat față de prognozat, Brier la scadență | … în învățare (registrul începe cu prima cohortă) |
| Track record-ul semnalelor | rezultat la 7 / 14 / 30 de zile | … în învățare (1 semnal în cohortă, nicio scadență atinsă) |
| Memoria agentului | norme, incidente, remedieri | *nou* — prima trecere a învățat 24 de norme din 71 de rulări și 27 de scanări |
| Narațiunea AI | model deschis local, verificat cifră cu cifră | *nou* |

Fiecare rulare CI publică porțile de cod ca adnotări GitHub (`scripts/gate-reporter.js` +
`scripts/gates-annotate.js`), iar tabelul de mai sus este regenerat de agent în ecranul **Agent AI**.

---

## Agentul AI de calitate (modul separat)

`agent/` este un modul independent: **nu importă nimic din scanner** (un test de arhitectură o
verifică) și citește doar ce publică scannerul, ce înregistrează GitHub și ce servește site-ul. Rulează
în workflow-ul `Agent AI` după fiecare CI, scanare, sondă și actualizare de etichete, plus orar.

La fiecare trecere:

1. **observă** rulările fiecărui workflow, joburile și raportul porților din CI (adnotări, prin API),
   snapshot-ul de pe `cri-state`, deploy-ul Pages, cotele planurilor gratuite, fișierele publicate;
2. **evaluează** toate cele 36 de porți (PASS · WARN · FAIL · necunoscut · în învățare — „necunoscut”
   nu este niciodată citit ca rău);
3. **învață din istoric**: norme robuste (mediană + MAD) pentru durate, intervale, apeluri, rata de
   răspuns a fiecărui furnizor, ponderea respinșilor, paritate; **incidentele trecute și commiturile care
   le-au încheiat** — la prima trecere pe repository-ul live a reconstruit singur eșecul sondei din 26
   octombrie (rezolvat de 2c6def4, „probe fix”) și scanarea anulată din 24 octombrie (rezolvată de
   c3d9c34, „separă concurrency pulse/scan”); data viitoare când apare același tip de eșec, citează
   remedierea care a funcționat;
4. **ține registrul prognozelor**: în fiecare săptămână notează probabilitatea ≥100× / ≥20× publicată
   pentru fiecare proiect verificat, apoi urmărește maximul de 24 h al prețului (CoinGecko public, fără
   cheie) — interimar: creșteri observate față de cele implicate; la 12 luni: scorul Brier față de rata
   de bază;
5. **scrie rezumatul** cu un model deschis rulat local în runner (Ollama, implicit `qwen2.5:3b`; fără
   cont, fără cheie, nimic nu iese din runner). O gardă verifică fiecare cifră din text față de fapte și
   respinge limbajul de tranzacționare; un text respins este înlocuit de șablonul determinist, cu motivul;
6. **acționează, strict limitat**: pornește o scanare sau un puls pe care GitHub l-a sărit (doar când
   nu rulează nimic, cel mult 4 scanări și 8 pulsuri pe 24 h, niciodată după două eșecuri la rând sau
   peste 85 % din cota unui plan gratuit) și ține o singură problemă GitHub deschisă cât timp există
   porți serioase sau critice eșuate. Nu poate anula, șterge, relua cu alți parametri sau modifica cod.

Memoria și raportul trăiesc pe ramura orfană `cri-agent` (un commit, force-push); scanarea și pulsul
copiază `report/agent.json` în site. Costul: tokenul automat al workflow-ului (~20 de cereri din cele
1 000 pe oră), câteva apeluri publice CoinGecko, un runner de repository public.

Variabile opționale (Settings → Secrets and variables → Actions → **Variables**): `CRI_AGENT_LLM=off`
(fără model, doar șablonul), `CRI_AGENT_MODEL` (alt model deschis din registrul Ollama),
`CRI_AGENT_HEAL=off` (fără porniri automate), `CRI_AGENT_ISSUES=off` (fără problema GitHub).

---

## Dashboard

![Dashboard CRI Radar](docs/img/dashboard.png)

Trei secțiuni principale, în ordinea în care lucrează un cercetător, plus un meniu secundar.

**① Futures Radar** — cinci blocuri ponderate: trend 1D (25), structură 4H (30), poziționare pe
derivate (25), lichiditate (10), volum și volatilitate (10). Notele A++ ≥ 95 · A+ ≥ 90 · A ≥ 85 ·
B ≥ 80. Filtrele dure sunt afișate când se aplică: un trend zilnic puternic descendent **exclude
complet** direcția LONG, iar funding extrem, o intrare la peste 8 % deasupra zonei sau un raport
câștig/risc sub 2 **plafonează nota la B** — și se vede ce notă ar fi fost fără plafon.

![Card Small-Cap Radar](docs/img/small-cap-card.png)

**② Small-Cap Radar** — răspunsul la întrebare. Fiecare card începe cu testul în trei părți
(Stage · Oportunitate · Risc) și arată care parte a picat, astfel încât o ratare la limită să fie
lizibilă, nu absentă. Urmează ce s-a schimbat, grupat pe familii; scorul factor cu factor, cu
ponderea efectivă și calitatea datelor; invalidatorii; și calea de verificare manuală pe fiecare
platformă.

![Card Futures Radar](docs/img/futures-card.png)

**③ Deep Research** — un proiect, un singur ecran: teza în proză, deținătorii **clasificați în
actori** (bursă, pool, bridge, staking, trezorerie, fond, adresă semnalată), concentrarea pe
supply-ul efectiv, comparația metrică cu metrică față de propria normă, toți invalidatorii și
registrul complet de platforme.

![Deep Research](docs/img/deep-research.png)

Meniu secundar: Univers · **Validare** · **Prognoză ≥100×** · Alerte · Analogi LAB/BTW/AGT · Radar CRI ·
Derivate · Narative · Track record · Paritate și bugete · **Agent AI** · Date și surse · Metodologie.

**Prognoză ≥100×** arată ratele de bază cu intervalele lor, cele mai mari probabilități (doar proiecte
verificate, cu cel mai apropiat câștigător la minimul lui) și lista de învățare cu sursele fiecărei
intrări. **Agent AI** arată rezumatul, ce cere atenție (cu remedierea care a funcționat data trecută),
toate porțile pe grupe, cadența reală față de cron, eficiența față de soluțiile profesionale, normele
învățate, incidentele cu commiturile care le-au rezolvat și registrul de calibrare.

![Prognoză ≥100× (demo)](docs/img/forecast.png)

![Agent AI (demo)](docs/img/agent.png)

Fiecare proiect listat poartă verdictul porții de validitate („verificat”, cu numărul de atenționări),
iar verificările lui sunt la un clic distanță: pe cardul Small-Cap Radar, pe rândul Radar CRI, în
dosarul Deep Research și în fișa proiectului.

Dashboard-ul este mobile-first: fiecare ecran a fost verificat la 390 px fără derulare orizontală.

<img src="docs/img/mobile.png" alt="CRI Radar pe telefon" width="320">

---

## Cum rămâne onest

- **UNKNOWN nu este bearish.** Un factor nemăsurat este scos din ponderare, ponderea lui se
  redistribuie proporțional, iar încrederea scade. Scorul nu este penalizat, fiindcă „nu am putut
  măsura” și „este rău” sunt lucruri diferite și doar unul dintre ele e în date.
- **Fiecare scor este explicabil**: factor → pondere nominală → pondere efectivă → dovadă → sursă →
  calitatea datelor. Nimic nu apare pe ecran fără provenanță.
- **Concentrarea se calculează pe supply-ul efectiv.** Pool-urile, bridge-urile, staking-ul, lock-urile
  și adresele de ardere sunt excluse din bază, fiindcă nimeni nu poate decide să le vândă.
- **Fără look-ahead.** O normă pentru rularea T folosește doar puncte strict anterioare lui T, iar
  fiecare intrare din track record este înghețată la momentul descoperirii și evaluată mai târziu cu
  prețuri citite ulterior.
- **Un eșantion mic se raportează ca eșantion mic.** Track record-ul vine cu intervale Wilson 95 %;
  sub 20 de intrări rezultatul este marcat explicit ca insuficient, nu prezentat ca rată de succes.
- **Planurile gratuite sunt contorizate** în unitățile lor proprii (apeluri, credite, unități de
  calcul). La 95 % din orice limită publicată, furnizorul intră în pauză preventivă până la resetare,
  ca o rulare să nu ajungă niciodată într-o zonă plătită sau blocată.
- **Harta de lichidări este un model**, nu date de ordine, și spune asta, cu ipotezele alături.
- **O listă CRI conține doar proiecte verificate.** Un proiect respins nu este ascuns: apare în
  ecranul Validare cu motivul (dovada care îl descalifică), iar unul încă nescanat apare „în
  verificare”, nu „suspect”.
- **O prognoză este o probabilitate, cu interval și bază.** Rata de bază vine din câștigătorii
  confirmați din istoric, amprenta lor se măsoară la minim, fără nicio dată de după, iar agentul
  verifică în timp dacă probabilitățile publicate se adeveresc.
- **Agentul nu poate inventa o cifră.** Rezumatul scris de model trece printr-o gardă care respinge
  orice număr absent din fapte; eficiența publicată este măsurată din rulări, nu declarată.

---

## Automatizare

| Workflow | Cadență | Ce face |
|---|---|---|
| `Scan & deploy` | la 4 ore, la :17 | scanare completă, validare contract, salvare stare, deploy Pages |
| `Pulse` | la 15 minute | preț, funding, open interest; nu atinge nicio cuotă lunară |
| `CI` | la fiecare push | sintaxă, reguli de arhitectură, 322 de teste raportate pe porți, build DEMO offline cu agentul |
| `Probe surse` | săptămânal | o cerere per furnizor, a doua trecere pentru ce nu a răspuns; limitele de rată sunt avertismente, eșuează doar pe o sursă stricată |
| `Actualizare etichete` | lunar | reconstruiește setul eth-labels și deschide un pull request |
| `Agent AI` | după CI, scanare, sondă și etichete; orar | porțile de calitate, învățarea din istoric, registrul prognozelor, rezumatul local, pornirea programărilor sărite |

Starea de cercetare trăiește pe ramura orfană `cri-state`, iar memoria agentului pe `cri-agent`: câte
un singur commit, force-push la fiecare rulare, deci nu cresc niciodată. Programările GitHub sunt
*best effort*, iar agentul le măsoară: în prima săptămână scanarea a rulat ~4 ori pe zi din 6 promise,
pulsul ~5 din 96. Agentul completează scanările lipsă cu `workflow_dispatch` (în limitele de mai sus);
un puls ratat rămâne inofensiv, fiindcă următorul republică aceleași fapte, iar dashboard-ul își
declară mereu propria vechime.

### Pași de configurare
1. **Settings → Pages → Build and deployment → Source: GitHub Actions** — *înainte* de prima
   scanare. Un push pe `main` care atinge `src/`, `web/`, `config/`, `schema/` sau `scripts/`
   pornește automat `Scan & deploy`; fără Pages activat, scanarea își salvează starea, dar pasul de
   publicare se oprește cu un mesaj care spune exact această setare.
2. Rulează o dată `Scan & deploy` din tab-ul Actions, dacă nu a pornit deja de la push.
3. Opțional, adaugă oricare dintre cheile gratuite din tabelul de mai sus în **Settings → Secrets and
   variables → Actions**. `npm run probe` îți spune exact care lipsesc și de unde se iau; ecranul
   **Agent AI** arată câte puncte de eficiență aduce fiecare.
4. Agentul AI nu cere nimic: pornește singur după primul CI. Prima lui rulare creează ramura
   `cri-agent`; site-ul include raportul de la următoarea scanare sau următorul puls.

### Primele rulări: normele proprii se construiesc
Radarul măsoară o schimbare față de **norma fiecărui proiect** (mediana și dispersia lui din ultimele
30 de zile), nu față de o medie a pieței. Fiecare scanare salvează un punct de istoric pentru *toate*
proiectele eligibile, iar detectoarele de volum, rotație și open interest se activează după minimum
4 puncte, adică după aproximativ 16 ore la o scanare la 4 ore. Până atunci, Small-Cap Radar poate
semnala doar schimbările care nu cer istoric (listări noi, funding negativ, structură 4H, TVL pe 7
zile din DefiLlama) și afișează explicit câte proiecte au deja normă. Un rezultat gol în primele
rulări înseamnă „încă nu se poate măsura”, nu „piață liniștită”.

> Workflow-urile programate se dezactivează automat după 60 de zile fără activitate în repository.

---

## Structura

```
src/
  domain/          logică pură: zero I/O, zero importuri în afară
    discovery/     norme proprii, ce s-a schimbat, scor de pre-expansiune, stadiu și verdict
    onchain/       clasificarea deținătorilor, fluxuri, Smart Money Score
    futures/       trend 1D, structură 4H, poziționare, hartă de lichidări, notare
    risk/          presiune de supply, motorul de invalidatori
    quality/       faptul măsurat (valoare · sursă · vechime · calitate) și redistribuirea ponderilor
    budget/        registrul de cuote și poarta de pauză la 95 %
    platforms/     modelul în trei straturi al platformelor și sloturile de cheie
    benchmark/     matricea de paritate
    validity/      poarta de validitate: cinci verificări obligatorii
    forecast/      câștigătorii anului (confirmați din istoric) și modelul ≥100× / ≥20×
    …              narațiune, alerte, backtest, similaritate LAB/BTW/AGT, piață
  application/     cazuri de utilizare + porturi; depinde doar de domeniu
  adapters/        HTTP, furnizori, stare, publicare, fixtures (simulatorul determinist)
  config/          încărcarea configurației și citirea secretelor din mediu
agent/             agentul AI de calitate — modul separat, nu importă nimic din src/
  domain/          porți, cron și cadență, norme robuste, incidente și remedieri, calibrare,
                   eficiență, auto-reparare, narațiune și gardă — pur, determinist
  application/     observă → învață → evaluează → narează → acționează; porturi
  adapters/        API GitHub, fișierele de stare, Pages, prețuri publice, Ollama local, simulator
  main.js          rădăcina de compoziție (analyze · narrate · act · run)
web/               dashboard static, ES module native, fără build step
schema/            contractele: latest, universe, agent — validate la fiecare publicare
config/            praguri, referințe LAB/BTW/AGT, câștigătorii documentați (winners.json), etichete
test/              322 de teste, inclusiv cele de arhitectură ale scannerului și ale agentului
```

Detalii de proiectare, inclusiv de ce fiecare prag este unde este: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Avertisment

Cercetare, nu sfat financiar. Scorurile sunt priorități de analiză cu invalidatori expliciți, nu
recomandări de cumpărare. Nivelele din Futures Radar sunt derivate din structura prețului și nu sunt
instrucțiuni de tranzacționare. Proiectul nu execută și nu transmite ordine.

MIT. Setul de etichete on-chain este derivat din [eth-labels](https://github.com/dawsbot/eth-labels)
(MIT, notificare în `config/labels/LICENSE-eth-labels.txt`). Date de securitate a contractelor:
GoPlus Security. Fear & Greed Index: alternative.me. Date de derivate: Coinalyze.
