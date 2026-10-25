# Arhitectura CRI Radar

Acest document explică **de ce** proiectul arată așa. Ce face fiecare parte se citește din cod;
aici stau deciziile care nu se văd din cod și pragurile care ar părea arbitrare fără motivul lor.

---

## 1. Hexagonul, și de ce este verificat mecanic

```
                       ┌──────────────────────────────────────────┐
   surse gratuite ───► │  adapters/outbound                       │
   (API public sau     │  http · providers · state · publishing   │
    cont gratuit)      │  fixtures (simulator determinist)        │
                       └────────────────┬─────────────────────────┘
                                        │ implementează porturile
                       ┌────────────────▼─────────────────────────┐
                       │  application                             │
                       │  ports/  ← contractul                    │
                       │  use-cases/ run-scan · discovery ·       │
                       │     deep-research · deep-cache ·         │
                       │     futures-radar · universe-view ·      │
                       │     pulse · snapshot · state-update      │
                       └────────────────┬─────────────────────────┘
                                        │ folosește doar domeniul
                       ┌────────────────▼─────────────────────────┐
                       │  domain  (pur: zero I/O)                 │
                       │  discovery · onchain · futures · risk ·  │
                       │  quality · budget · platforms ·          │
                       │  benchmark · narrative · backtest · …    │
                       └──────────────────────────────────────────┘
                                        │
            data/latest.json + data/universe.json  ◄── contractul
                                        │
                       ┌────────────────▼─────────────────────────┐
                       │  web/  dashboard static (GitHub Pages)   │
                       │  nu calculează cercetare — o randează    │
                       └──────────────────────────────────────────┘
```

Regula de dependență nu este o convenție, ci un **test care rulează la fiecare commit**
(`test/architecture.test.js`):

- `domain` importă **doar** din `domain`. Fără `node:fs`, fără `fetch`, fără adaptoare. Un parser de
  URL de repository a fost mutat în domeniu exact din acest motiv: use-case-ul care decide *care*
  depozite merită un apel avea nevoie de el, iar importul dintr-un adaptor ar fi rupt regula.
- `application` importă doar `domain` și `application`. Tabelul cheilor gratuite a fost mutat în
  `domain/platforms/registry.js`: *care* planuri gratuite există este cunoaștere de domeniu, iar
  citirea lui `process.env` este treaba adaptorului de configurație.
- `adapters` nu importă niciodată `main.js`.
- `web` importă doar din `web`. Frontend-ul vorbește cu motorul exclusiv prin `data/latest.json` și
  tabelul orizontului `data/universe.json`.

Și, specific acestui proiect, șase teste în plus:

- **lista de surse aprobate** — orice URL absolut din `adapters/outbound` trebuie să rezolve la un
  host aflat pe o listă explicită, fiecare cu planul gratuit declarat;
- **host-uri cu abonament** — un apel către CoinGlass API, Dune API, X API, Moralis, Etherscan sau
  CryptoPanic eșuează testul, oriunde în `src/`;
- **endpoint-uri de execuție** — orice urmă de `order`, `withdraw` sau endpoint privat eșuează
  testul, chiar și nefolosită;
- **determinismul domeniului** — niciun fișier din `src/domain` nu poate conține `Date.now()`,
  `Math.random()`, `new Date()` fără argument sau `performance.now()`. Timpul intră prin `ClockPort`
  în rădăcina de compoziție și circulă spre interior ca argument explicit `nowMs`. Fără această
  regulă, cercetarea point-in-time s-ar rupe în liniște: codul ar funcționa, dar două rulări pe
  aceleași date ar putea da scoruri diferite, iar nimic nu ar semnala-o;
- **paritatea adaptoarelor** — harta de provideri construită pentru fixtures trebuie să ofere exact
  aceleași chei și aceleași metode ca cea live. O metodă existentă doar live este o cale de cod pe
  care nicio rulare demo nu o atinge; una existentă doar în fixtures este un test care trece pe
  ceva ce nu există în producție. Testul a găsit trei astfel de nepotriviri la auditul final;
- **concurența workflow-urilor** — niciun workflow nu împarte grupul de concurență cu altul, iar
  pulsul de 15 minute verifică explicit dacă rulează o scanare completă și îi cedează rândul.
  Grupurile sunt comune la nivel de repository: când pulsul împărțea grupul cu scanarea, fiecare
  puls de la :22 anula scanarea pornită la :17, iar starea de cercetare nu putea crește.

Testele de arhitectură verifică direcția dependențelor, dar nu și *forma datelor* care trec granița.
Pentru granița cea mai periculoasă — securitatea contractului, unde un vocabular greșit nu produce o
eroare, ci un „curat” fals — `test/application/security-wiring.test.js` pornește de la un răspuns
GoPlus în forma exactă a API-ului public și îl trece prin adaptorul real, prin `securityFacts()` și
prin motorul de risc. Traducerea dintre vocabularul furnizorului și cel al domeniului se face într-un
singur loc, iar testul îl fixează.

De ce mecanic și nu prin review: constrângerea „doar gratuit, fără abonament” este ușor de respectat
în prima zi și ușor de încălcat în a treizecea, cu un singur endpoint care „oricum merge acum”.
Testul mută decizia din memorie în CI.

---

## 2. Memoria point-in-time — fundația întregului proiect

Un singur snapshot poate spune doar cum **arată** un proiect. Nu poate spune ce s-a **schimbat**.
Toată întrebarea proiectului depinde de a doua propoziție, deci istoricul propriu nu este o
optimizare, ci fundația.

Fiecare rulare completă scrie pe ramura orfană `cri-state`:

| Fișier | Ce conține |
|---|---|
| `discovery.json` | un punct per proiect per rulare: 16 metrici urmărite + verdictul de atunci |
| `flows.json` | instantanee ale listei clasificate de deținători (adresă → cotă + clasă) |
| `history.json` | istoricul motorului de similaritate LAB/BTW/AGT |
| `registry.json` | ce este listat unde, ca registru „listat din” |
| `cohort.json` | jurnalul de track record, înghețat la descoperire |
| `quota-ledger.json` | consumul fiecărui plan gratuit, în unitățile lui |
| `references.json`, `catalysts.json`, `telemetry.json`, `last-seen*.json` | restul |

Toate folosesc codecuri columnare cu lista de câmpuri **în fișier**, astfel încât adăugarea unei
metrici mai târziu nu invalidează o stare scrisă de o versiune mai veche. Ramura este un singur
commit, force-push la fiecare rulare: nu crește niciodată.

### Fără look-ahead, prin construcție
O normă pentru rularea T folosește doar puncte **strict anterioare** lui T. Fiecare intrare de track
record îngheață prețul și verdictul la momentul descoperirii și este evaluată mai târziu cu prețuri
citite mai târziu. Nicio decizie nu este reluată cu informație din viitor — nu ca politică, ci pentru
că funcțiile nu primesc viitorul.

### Norma proprie: median + MAD, nu medie + deviație
Z-scorul este robust: `(x − median) / (1,4826 × MAD)`. Un singur vârf istoric nu trebuie să lărgească
împrăștierea atât încât următorul vârf să devină invizibil — exact eșecul pe care o medie simplă îl
produce.

Un caz limită merită spus: pe un istoric **perfect plat** nu există împrăștiere de măsurat. Varianta
„orice mișcare este notabilă” ar transforma o derivă de 1 % într-un eveniment de 3 sigma, adică exact
modul în care un detector de schimbări începe să se declanșeze pe zgomot. În schimb mișcarea este
judecată față de nivel: sub o zecime din mediană este indistinctibilă de norma plată, peste ea se
raportează direcția la o magnitudine fixă, fără a inventa o mărime.

---

## 3. „UNKNOWN nu este bearish” — regula care structurează totul

Un factor nemăsurat este **scos din numitor**, ponderea lui se redistribuie proporțional peste ce
*a fost* măsurat, iar cota de pondere care a ajuns devine **Confidence**.

Consecința, verificată prin test: două proiecte cu aceeași lichiditate primesc același scor de
lichiditate, chiar dacă unuia îi lipsește lista de deținători. Celui din urmă îi scade încrederea.
Alternativa — a scora factorul lipsă cu zero — ar face ca „nu am putut măsura” și „este rău” să arate
identic, iar acestea sunt lucruri diferite și doar unul este în date.

Fiecare factor poartă și o **calitate** (`HIGH` / `MEDIUM` / `LOW` / `STALE` / `UNKNOWN`), care nu
schimbă scorul, ci doar cât de mult contează la încredere. O lumânare de pe bursă este sursă primară;
o estimare reconstruită nu este; iar date reale mai vechi decât orizontul lor util sunt `STALE`, nu
greșite.

---

## 4. Ce s-a schimbat, și de ce „simultan” înseamnă lățime

Detectorul are o **listă închisă** de schimbări importante, fiecare cu familia și pragul ei, exprimat
față de norma proprie. Confluența nu este un număr de semnale: în interiorul unei familii, al doilea
semnal contează 40 % din primul, iar lățimea peste familii aduce un bonus.

De ce: cinci citiri din familia fluxurilor (volum, rotație, volum relativ, volum pe zile de creștere,
accelerare) sunt **un** lucru care se întâmplă, văzut de cinci ori. Dacă ar conta ca cinci, pragul de
simultaneitate ar fi trecut de orice token cu o zi bună de volum. Pragul este deci: **≥ 3 schimbări
în ≥ 2 familii distincte**, în aceeași fereastră de 7 zile.

### Precocitate versus momentum
Cele două numere sunt raportate separat și nu sunt niciodată contopite. Cazul LAB din soluția tehnică
este motivul: un proiect deja +400 % are momentum excelent și precocitate mică. Dacă ar exista un
singur scor, acel proiect ar sta în vârful listei, iar lista ar deveni un clasament al mișcărilor deja
terminate — adică exact opusul a ce cere întrebarea.

Evidența publică se compune din: variație pe 30 și 7 zile, poziția în intervalul de 30 de zile,
amplitudinea ultimei expansiuni, prezența în trending, boost-uri plătite, accelerarea volumului,
funding aglomerat și apropierea de maximul istoric.

---

## 5. Scorul de pre-expansiune (0–100)

| Factor | Pondere | Ce măsoară |
|---|---:|---|
| Volum | 20 | fluxul, față de propria normă, nu față de o constantă |
| Whale intelligence | 20 | cine acumulează și unde se duce |
| Lichiditate | 15 | dacă o poziție reală poate fi construită și desfăcută |
| Deținători | 15 | lărgirea bazei și scăderea concentrării efective |
| Presiune de supply | 10 | cât supply nou așteaptă să fie vândut |
| Structură | 10 | preț comprimat sub un nivel, sau deja extins |
| Regim de piață | 5 | dacă mareea ajută sau se opune |
| Narațiune | 5 | dacă sectorul este cumpărat |

Benzile: `0–39 IGNORĂ · 40–59 DE URMĂRIT · 60–74 TIMPURIU · 75–89 CONFIRMAT · 90–100 POTENȚIAL
RIDICAT`. Testele verifică faptul că intervalul este **atingibil în ambele capete**: un proiect ideal
construit în test scoră 90,8 (potențial ridicat), unul fundamental rupt scoră 11,5 (ignoră). Fără acea
verificare, o calibrare prea aspră ar face ca banda de sus să nu existe în practică, iar pragul din
regula de candidat să fie de fapt imposibil.

Două decizii de ponderare merită explicate:

- **Blocul de whale intelligence** combină verdictul de fluxuri cu Smart Money Score, dar ponderea
  celui de-al doilea urmează **acoperirea** lui: la acoperire completă contribuie jumătate din bloc,
  la acoperire subțire doar un sfert. Un sub-scor din care s-au putut evalua 4 din 16 componente nu
  trebuie să dilueze un verdict de fluxuri care *a fost* măsurat direct.
- **Smart Money Score** are un prag minim de credit parțial: o componentă care se declanșează exact
  la pragul publicat primește cel puțin 60 % din puncte. Fără acel prag, o citire fix la prag ar
  scora aproape zero, ceea ce ar deplasa tăcut pragul însuși.

---

## 6. On-chain: de la adrese la actori

O listă brută de deținători este aproape inutilă pentru cercetare. Cel mai mare „deținător” este de
obicei un pool de lichiditate, un bridge, un contract de staking sau adresa de ardere. Concentrarea
calculată peste acea listă nu spune nimic despre cine poate vinde.

Precedența clasificării, de la dovada cea mai tare la cea mai slabă:

1. **adrese canonice de ardere** — un fapt, nu o etichetă;
2. **tipul de entitate Arkham**, când cheia opțională este configurată;
3. **setul eth-labels inclus în repo** (MIT, 61 108 adrese: burse, bridge-uri, pool-uri, fonduri,
   protocoale, adrese semnalate);
4. **marcajele furnizorului** (GoPlus: LP, blocat);
5. **adresele proprii ale token-ului**, descoperite în rulare (creator, owner, pool principal);
6. **detecția structurală** — un contract neidentificat nu este, totuși, o persoană.

Punctul 3 este motivul pentru care setul este **construit la build și comitat în repo**: clasificarea
trebuie să funcționeze la fiecare rulare, inclusiv când rețeaua nu răspunde, iar un instrument de
cercetare nu ar trebui să depindă de disponibilitatea unui depozit terț la momentul scanării. Costul
de rețea la rulare este zero, limita de rată este zero.

### Concentrarea efectivă
Pool-urile, bridge-urile, staking-ul, lock-urile și adresele de ardere sunt **scoase din bază**, iar
concentrarea se recalculează peste supply-ul rămas. Diferența este de obicei mare și de obicei
inversează concluzia: un token al cărui „top 10” pare 90 % poate avea 75 % din supply-ul
tranzacționabil în mâinile top 10 — sau 25 %.

### Acumulare versus distribuție
Fluxurile se măsoară comparând **două instantanee clasificate** ale aceleiași liste, nu urmărind
transferuri individuale (ceea ce ar cere un indexer plătit). Regula din soluția tehnică:
`ACCUMULATION` cere **≥ 5 portofele mari în creștere ȘI absența depozitelor nete către burse`.
Creșterea care vine odată cu depozite la bursă nu este acumulare, ci poziționare pentru vânzare.

Instantaneul de comparație este ales la **cel puțin 20 de ore vechime**. Un puls de 15 minute măsurat
față de un instantaneu de 15 minute arată zgomot, nu acumulare.

---

## 7. Futures Radar: cinci blocuri și filtrele care le anulează

```
Trend 1D            25      direcția și permisiunea
Structură 4H        30      intrarea
Poziționare         25      cine este deja în tranzacție și cât îl costă să rămână
Lichiditate         10      dacă se poate intra și ieși
Volum/volatilitate  10      dacă există combustibil și dacă mișcarea e încă strânsă
```

`A++ ≥ 95 · A+ ≥ 90 · A ≥ 85 · B ≥ 80 · altfel NO_TRADE`

**Filtrele dure sunt rostul notei.** Aritmetica singură dă bucuros A+ unui long în interiorul unui
trend zilnic care se prăbușește, sau unei intrări urmărite 20 % peste zonă:

- trend 1D puternic descendent → direcția LONG este **exclusă complet**;
- funding extrem (≥ 0,05 %/8h) → nota **plafonată la B**;
- preț la peste 8 % deasupra zonei de intrare → **plafonată la B**;
- raport câștig/risc sub 2 → **plafonată la B**.

Dashboard-ul arată și ce notă ar fi fost **fără plafon**: un B care ar fi fost A+ fără penalizarea de
urmărire este altă informație decât un B simplu.

Praguri de funding, per 8 ore, din soluția tehnică: `+0,001 % sănătos · +0,015 % long-uri aglomerate ·
+0,05 % pericol · −0,03 % short-uri aglomerate`. Regimurile preț/OI: `↑↑ acumulare de long-uri ·
↓↑ short-uri noi · ↑↓ acoperire de short · ↓↓ lichidare de long-uri`.

Două corecții făcute aici merită notate, fiindcă ambele erau greșeli reale:

- **invalidarea trebuie să stea sub intrare.** Când zona de cerere s-a format *sub* ultimul swing low,
  swing low-ul nu este o invalidare pentru acea intrare, ci podeaua zonei. Altfel riscul ieșea negativ
  și raportul câștig/risc dispărea.
- **„niciun pivot găsit” nu înseamnă „pivoți descrescători”.** O creștere perfect lină nu are pivoți
  fractali confirmați. Tratarea absenței lor ca structură descendentă transforma cel mai curat uptrend
  din univers într-unul rupt. Acum structura este `UNKNOWN` și nu contribuie — ca peste tot.

### Harta de lichidări
Dashboard-urile comerciale vând o hartă construită din date la nivel de ordine, aflate în spatele unui
abonament. Aici obiectul este **modelat** din intrări gratuite: open interest, semnul funding-ului
(care spune ce parte este aglomerată) și intervalul recent de preț, cu intrările distribuite
proporțional cu volumul tranzacționat la fiecare nivel și o scară de levier retail presupusă.

Rezultatul este marcat explicit ca model, cu ipotezele afișate alături — ca un cercetător să le poată
judeca, nu să le creadă. Când open interest-ul lipsește, nominalele sunt relative și scrie asta.

---

## 8. Riscul ca listă de invalidatori

Jumătatea a doua a întrebării cere riscuri *care pot invalida ipoteza*, nu un scor. Deci motorul
produce rânduri, fiecare cu: ce este, **ce anume ar falsifica teza** și **unde se urmărește**.
Scorul agregat este derivat din listă, niciodată invers.

Agregarea are randamente descrescătoare — al treilea risc „mediu” adaugă mai puțin decât primul —
plus **praguri minime de severitate**: un singur invalidator critic duce scorul în banda critică.
Fără acel prag, un honeypot ateriza la 31/100 „moderat”, iar un honeypot înseamnă că nu poți vinde
deloc. Pragul este ce face ca `risc < 60` din regula de candidat să însemne ceea ce spune.

Riscurile de **calitate a datelor** sunt o categorie separată și contează la jumătate: un token
nescanat nu trebuie să pară mai periculos decât unul scanat și periculos.

### Calendarul de deblocări, care nu este gratuit nicăieri
Endpoint-ul de unlocks este Pro la toți furnizorii. Deci presiunea este derivată din ce *este*
gratuit: float, raport FDV/MCAP și emisiunea observată în istoricul propriu — iar lipsa calendarului
este **scrisă pe ecran**, nu acoperită. Datele exacte se pot introduce manual în
`config/catalysts.json` și devin atunci fapte datate.

O corecție: un supply circulant în scădere este ardere sau re-blocare, nu inflație negativă. Se
raportează ca emisiune 0, cu explicația a ce s-a observat.

---

## 9. Bugetele planurilor gratuite

Constrângerea „fără abonament” nu se respectă doar alegând furnizori gratuiți: un plan gratuit epuizat
la jumătatea lunii transformă un instrument de cercetare într-unul stricat. Deci fiecare plan este
contorizat **în unitățile lui proprii**:

| Plan | Unitate | Limită |
|---|---|---|
| CoinGecko Demo | apel | 10 000/lună |
| CoinMarketCap Basic | credit (1 per 200 monede) | 10 000/lună |
| CryptoQuant Basic | credit | 10 000/lună |
| NodeReal Free | unitate de calcul (300 per listă de deținători) | 10 000 000/lună |
| GoPlus Free | unitate de calcul | 150 000/lună, 30 000/zi |
| YouTube Data | unitate (100 per căutare) | 10 000/zi |

La **95 %** din orice limită, furnizorul intră în pauză preventivă până la resetare. Poarta
funcționează și **în timpul** rulării, nu doar la început: dacă headroom-ul se consumă la mijloc,
apelul următor este refuzat cu un motiv citibil, nu cu o eroare HTTP.

Registrul se rostogolește exact când o fac furnizorii (lunar pe UTC, zilnic pe UTC) și proiectează
ritmul de consum până la finalul lunii, ca să avertizeze înainte, nu după.

---

### Orizontul de 1000 cu bugete de zeci de apeluri: stratul rotativ

Cercetarea profundă nu mai este o listă scurtă: acoperă fiecare proiect eligibil (`deep.horizon`,
implicit 1000). Sursele se împart după cât de mult pot da la fiecare rulare:

| Strat | Surse | Pentru cine, la fiecare rulare |
|---|---|---|
| masiv | lumânări Binance / MEXC / Binance Alpha, DexScreener (30 contracte/apel), derivate, listele Alpha | toate proiectele |
| rotativ, static | GoPlus (TTL 7 zile), detalii CoinGecko (TTL 14 zile) | prioritatea, apoi ce lipsește sau a expirat |
| rotativ, măsurătoare | GeckoTerminal, GitHub, YouTube, grafic CoinGecko | prioritatea, apoi cine a fost măsurat cel mai demult |
| prioritate | liste de deținători (NodeReal / Solana RPC), Arkham | doar prioritatea, pentru că fluxurile cer aceleași portofele la rulări consecutive |

Diferența dintre *static* și *măsurătoare* este regula point-in-time aplicată unui cache
(`application/use-cases/deep-cache.js`): flagurile unui contract, owner-ul, LP-ul blocat, categoriile
și repository-ul se păstrează între rulări cu data citirii și alimentează riscul; numărul de
deținători, cota brută top 10, commit-urile și mențiunile nu sunt păstrate niciodată — un proiect
neîmprospătat în rularea curentă le raportează „necunoscut”. Altfel aceeași citire ar intra de două
ori în istoric, ar aplatiza norma proiectului și ar fabrica schimbări față de ea.

---

## 10. Cadența: scanare completă la 4 ore, puls la 15 minute

O scanare completă citește două universuri de agregator, lumânări, liste de deținători, securitatea
contractelor, dezvoltare și atenție. Rulată la fiecare 15 minute ar epuiza orice plan gratuit într-o zi.

Faptele care se mișcă în 15 minute sunt însă un subset mic și ieftin — preț, variație 24h, funding,
open interest — toate din endpoint-uri fără cheie plus un singur lot Coinalyze. Deci **pulsul**
reîmprospătează doar acele fapte, recalculează doar ce depinde de ele (blocul de poziționare al
Futures Radar și nota lui, lista de squeeze) și republică.

Tot ce derivă din scanarea completă **își păstrează marcajul de timp al acesteia**. Un puls care ar
recalcula un scor de pre-expansiune fără date proaspete de deținători, lichiditate sau normă ar fi un
număr diferit care se pretinde același. Dashboard-ul arată deci explicit ce este vechi de minute și ce
este vechi de ore, iar un test verifică faptul că scorurile, lista de schimbări, riscul și verdictul
**nu se mișcă** pe un puls.

Cost per puls: ~8 apeluri fără cheie plus cel mult 3 loturi Coinalyze. Nimic cu cuotă lunară nu este
atins, deci pulsul nu poate fi niciodată motivul pentru care un plan gratuit se epuizează.

---

## 11. Modelul în trei straturi al platformelor

Soluția tehnică enumeră platforme ale căror API-uri nu sunt toate gratuite. Niciuna nu a fost scoasă
din proiect; fiecare este încadrată în stratul care i se potrivește:

| Strat | Ce înseamnă | Exemple |
|---|---|---|
| **AUTO** | API public sau cu cont gratuit, apelat în cod | CoinGecko, MEXC, DexScreener, GoPlus, Solana RPC |
| **LINK** | interfața web gratuită, cu context precompletat per proiect | Arkham Intelligence, CoinGlass, Dune, exploratoare |
| **KEY_SLOT** | adaptor existent care se activează cu o cheie gratuită/trial | Arkham Intel API, NodeReal, Coinalyze, CryptoQuant |

Stratul LINK nu este un compromis: așa folosește un cercetător aceste platforme oricum. Un link care
deschide Arkham direct pe contractul token-ului este, pentru verificare manuală, mai util decât un
API apelat automat — și costă zero. Ce ar fi venit din API-ul plătit este fie reconstruit din surse
gratuite și **marcat ca model**, fie listat ca neacoperit în matricea de paritate.

Un `KEY_SLOT` liber nu rupe nimic: capabilitatea raportează `OPTIONAL_KEY`, paritatea scade la valoarea
ei permanentă, iar platforma rămâne accesibilă prin stratul LINK.

---

## 12. Contractul cu dashboard-ul

`data/latest.json` este singura interfață. Dashboard-ul nu calculează cercetare — o randează.
Documentul este validat la **fiecare** publicare față de `schema/latest.schema.json`, iar un snapshot
care nu respectă contractul nu ajunge pe Pages.

Schema face și muncă de conținut, nu doar de formă: cere ca fiecare furnizor să își declare planul,
ca fiecare cheie să fie descrisă ca `gratuit` sau `trial`, ca fiecare invalidator să spună ce
falsifică și unde se urmărește, și ca politica publicată să conțină `unknownIsBearish: false`,
`subscriptionsUsed: false`, `freeOnly: true`, `tradeExecution: false`.

Dimensiunea este ținută sub control prin bugete explicite, nu prin tăieri arbitrare: lumânările se
publică pentru primele 30 de rânduri (restul păstrează sparkline-ul); rândurile Small-Cap Radar au
trei niveluri de dovezi — `full` (dosarul complet: primele 24 plus toți candidații timpurii), `card`
(factori și invalidatorii principali, până la rândul 48) și `list` (verdict, teza pe scurt, primele
schimbări, până la rândul 120); catalogul de platforme apare o singură dată în `methodology`, cu
doar URL-urile per rând. Rezultat: ~3 MB brut, ~450 KB gzip, pe care GitHub Pages îl servește
comprimat.

**Restul orizontului** — fiecare proiect cercetat, câte un rând, și fiecare piață perpetuă — se
publică separat în `data/universe.json` (tablouri sub o listă de câmpuri, ~300 KB pentru 900 de
proiecte), validat față de `schema/universe.schema.json`. Dashboard-ul îl citește doar când se
deschide ecranul **Univers**, iar coloana `detail` spune pentru fiecare rând unde îi sunt dovezile
complete. Tabelul se scrie înaintea contractului, ca un cititor să nu găsească niciodată un
`latest.json` al cărui tabel aparține altei rulări.

---

## 13. Ce nu face, și de ce

- **Nu execută nimic.** Nu există endpoint de ordine sau de retragere nicăieri în `src/`, iar un test
  verifică asta la fiecare commit.
- **Nu cumpără date.** Lipsa unei capabilități este listată, nu mascată: flux de lichidări pe ordine
  în timp real și analiza fluxului X rămân neacoperite.
- **Nu pretinde certitudine dintr-un eșantion mic.** Sub 20 de intrări, track record-ul se raportează
  ca insuficient, cu interval Wilson 95 %, nu ca rată de succes.
- **Nu coboară pragurile ca să producă un rezultat.** Când niciun proiect nu îndeplinește toate cele
  trei condiții, ecranul spune asta și arată ce îi lipsește celui mai apropiat. O fereastră închisă
  este un rezultat, nu o eroare.
