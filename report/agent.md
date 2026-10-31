## Agent AI — atenționare

29 trecute · 4 atenționări · 0 eșecuri · 3 fără date sau în învățare (36 în total) — 2026-10-31T20:16:24.603Z

> Stare generală: atenționare — 29 de porți trecute, 4 atenționări, 0 eșecuri, 3 în învățare sau fără date (36 în total).
> Prioritatea 1 (atenționare): Cadența pulsului — 36 de rulări în 6.75 zile = 5.33/zi față de 96/zi promise de „7,22,37,52 * * * *” (6%); interval median 4.9 h, maxim 7.1 h. Remediu: GitHub rulează programările „best effort” și le sare la ore aglomerate; agentul completează cadența cu workflow_dispatch când nu rulează nimic, în limita zilnică din agent/config.json.
> Alte probleme: Cadența scanării complete (4.24/6 pe zi); Furnizorii gratuiți răspund (16/20); Narațiunea AI (model deschis local) (șablon).
> Eficiență față de un desk profesional: paritate 87.7% permanent, 92.8% cu chei gratuite, 82.9% realizat în ultima rulare; prospețime livrată 87.3% (promisă 94.6%), fiabilitate 96.6% — eficiență efectivă 69.9% față de ținta de design 87.8%. Cea mai mare pârghie: chei gratuite neconfigurate și surse căzute în ultima rulare (9.9 puncte).
> Învățare: 2 rulări ale agentului, 24 de norme învățate, 4 incidente deschise și 2 rezolvate, 3 remedieri reținute; 415 prognoze în registrul de calibrare.

<sub>șablon determinist — modelul local nu este disponibil în această rulare</sub>

### Cod — CI la fiecare push (Node 22 și 24)

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | CI verde pe ultimul commit din main | verde | CI pe 3e0bd0a „Aplică prognoza agent: subsistem agent autonom, model forecast 100×, view-uri Agent si Pro” a trecut în 2 joburi (Node 22 și 24). |
| ✅ | Sintaxă validă în toate fișierele JS | 181/181 | 181 de verificări trecute în CI pe 3e0bd0a. |
| ✅ | Arhitectură hexagonală respectată | 7/7 | 7 verificări trecute în CI pe 3e0bd0a. |
| ✅ | Doar surse gratuite: hosturi aprobate, niciun abonament | 2/2 | 2 verificări trecute în CI pe 3e0bd0a. |
| ✅ | Exclusiv research: niciun endpoint de ordine sau retragere | 1/1 | 1 verificare trecută în CI pe 3e0bd0a. |
| ✅ | Testele de domeniu | 143/143 | 143 de verificări trecute în CI pe 3e0bd0a. |
| ✅ | Testele de aplicație și end-to-end | 62/62 | 62 de verificări trecute în CI pe 3e0bd0a. |
| ✅ | Testele de adaptoare și scripturi | 59/59 | 59 de verificări trecute în CI pe 3e0bd0a. |
| ✅ | Testele de interfață | 18/18 | 18 verificări trecute în CI pe 3e0bd0a. |
| ✅ | Testele agentului AI | 30/30 | 30 de verificări trecute în CI pe 3e0bd0a. |
| ✅ | Scanare DEMO offline, contract valid, site construit | trecut | Pasul „Offline DEMO scan, contract validation and site build” a trecut în 2 joburi. |
| ✅ | Pulsul păstrează contractul | trecut | Pasul „The pulse runs on top of the published snapshot without breaking the contract” a trecut în 2 joburi. |
| ✅ | Setul de etichete on-chain este prezent și clasifică | trecut | Pasul „The committed label dataset is present and classifies” a trecut în 2 joburi. |

### Rulare — fiecare scanare live

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | Ultima scanare live a reușit | reușită | Scanarea din 2026-10-31 20:01 UTC (schedule) s-a încheiat în 14.3 min. |
| ✅ | Contractul publicat respectă schema | trecut | Pasul „Validate the published contract” a trecut. |
| ✅ | Sursele obligatorii au răspuns | 2/2 | CoinGecko (univers), Lumânări 1D/4H: OK. |
| ⚠️ | Furnizorii gratuiți răspund | 16/20 | Cu probleme: GeckoTerminal (OK, 83% istoric); GoPlus Security (OK, 74% istoric); Solana JSON-RPC (RATE_LIMITED, 23% istoric); GitHub (PARTIAL, 78% istoric). |
| ✅ | Bugetele planurilor gratuite | max 15.7% | Cel mai solicitat plan: CoinGecko Demo, 15.7% din luna proiectată. |
| ✅ | Poarta de validitate aplicată | 401/0/81 | 401 verificate, 0 în verificare, 81 respinse; niciun proiect respins în liste. |
| ✅ | Prognoza ≥100×: listă de învățare și rată de bază | 8 confirmați | 8 câștigători confirmați din istoricul zilnic; rata de bază ≥100×: 0.45% (0.202–1%). |
| ✅ | Durata scanării în normă | 12.9 min | 12.9 min din 22; norma se învață (2 rulări). |
| ✅ | Universul în normă | 482 eligibile | 4537 unificate, 482 eligibile, 482 cercetate în profunzime. |
| ✅ | Starea cercetării salvată | 30 de rulări | cri-state conține snapshot-ul ultimei scanări (2026-10-31T20:02:43.964Z); 30 de rulări de la 2026-10-24. |
| ✅ | Site-ul publică ultimul snapshot | sincron | https://hdmihai.github.io/radarcry/ servește rularea din 2026-10-31T20:02:43.964Z. |
| ✅ | Prospețimea datelor | 0.2 h | Snapshot vechi de 0.2 h. |
| ✅ | Nicio cheie în fișierele publicate | 3 fișiere | 3 fișiere publicate scanate (3965 KB): nicio cheie, niciun URL cu cheie. |

### Cadență și programare

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ⚠️ | Cadența scanării complete | 4.31/6 pe zi | 30 de rulări în 6.96 zile = 4.31/zi față de 6/zi promise de „17 */4 * * *” (72%); interval median 5.9 h, maxim 10.3 h. |
| ⚠️ | Cadența pulsului | 5.53/96 pe zi | 38 de rulări în 6.88 zile = 5.53/zi față de 96/zi promise de „7,22,37,52 * * * *” (6%); interval median 4.8 h, maxim 7.1 h. |
| ✅ | Toate workflow-urile sunt active | 5/5 | Active: CI, Scan & deploy, Pulse, Probe surse, Actualizare etichete on-chain. |
| ✅ | Activitate în repository | 0.1 zile | Ultimul commit pe main: 2026-10-31 (acum 0.1 zile). |

### Verificări periodice

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | Sonda săptămânală a surselor gratuite | success | Ultima rulare 2026-10-27 (workflow_dispatch): success. |
| · | Actualizarea lunară a etichetelor on-chain | — | Workflow nou: așteaptă prima rulare programată. |

### Model și învățare

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| … | Calibrarea prognozei ≥100× / ≥20× | 415 prognoze | 1 cohortă, 415 prognoze; așteptate până acum 0 creșteri ≥20×, observate 0 — prea puține pentru un verdict. |
| … | Track record-ul semnalelor | 1 semnal | 1 semnal în cohorta „Stage 2 + Oportunitate > 80 + Risc < 60”, 1 deschise; nicio scadență nu are încă destule intrări pentru un verdict. |

### Agentul AI

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | Memoria agentului | 3 rulări | 3 rulări ale agentului din 2026-10-31; 26/36 norme învățate; 4 incidente deschise, 2 rezolvate; 3 remedieri reținute. |
| ⚠️ | Narațiunea AI (model deschis local) | șablon | Modelul local nu a putut fi folosit (modelul local nu este disponibil în această rulare); rezumatul vine din șablonul determinist. |

### Eficiență față de un desk profesional

Paritate 87.7% permanent · 92.8% cu chei gratuite · 82.9% realizat; prospețime 87.5% (promisă 94.6%); fiabilitate 96.7% → **eficiență efectivă 70.1%** (design 87.8%).
