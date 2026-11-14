## Agent AI — eșuat

29 trecute · 6 atenționări · 1 eșecuri · 3 fără date sau în învățare (39 în total) — 2026-11-14T14:28:29.439Z

> Stare generală: eșuat — 29 de porți trecute, 6 atenționări, 1 eșecuri, 3 în învățare sau fără date (39 în total).
> Prioritatea 1 (serios): Cadența scanării complete — 12 rulări în 7 zile = 1.71/zi față de 6/zi promise de „17 */4 * * *” (29%); interval median 5.7 h, maxim 8.8 h. Remediu: GitHub rulează programările „best effort” și le sare la ore aglomerate; agentul completează cadența cu workflow_dispatch când nu rulează nimic, în limita zilnică din agent/config.json. Data trecută s-a rezolvat prin commitul 5c6a691 („Aplică fix: elimină bias venue din similaritate, adaugă R:R live și late entry …”).
> Alte probleme: Cadența pulsului (2.57/96 pe zi); Eficiența identificării: radarul indică proiectele corecte (TIMPURIU ×2.92); Sonda săptămânală a surselor gratuite (17.8 zile); Prospețimea datelor (7.8 h); încă 2.
> Eficiență față de un desk profesional: paritate 87.7% permanent, 92.8% cu chei gratuite, 82.9% realizat în ultima rulare; prospețime livrată 75.9% (promisă 94.6%), fiabilitate 100% — eficiență efectivă 62.9% față de ținta de design 87.8%. Cea mai mare pârghie: programări sărite de GitHub (cadență sub cron) (15.5 puncte).
> Învățare: 105 rulări ale agentului, 32 de norme învățate, 9 incidente deschise și 36 rezolvate, 6 remedieri reținute; 1181 de prognoze în registrul de calibrare.
> Identificare (+20% în 72 h, 10158 de observații): banda TIMPURIU 11% față de 3.8% în univers (lift 2.92); verdictul de research timpuriu a prins 0% din 382 de mișcări.
> Auto-evaluare: 100 de rulări notate, Brier 0.013464 față de 0.020463 pentru regula naivă „ca data trecută”; skill 0.342 pe 68 de schimbări de stare.

<sub>șablon determinist — garda a respins textul modelului: cifre care nu apar în fapte: 0.013</sub>

### Cod — CI la fiecare push (Node 22 și 24)

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | CI verde pe ultimul commit din main | verde | CI pe 2c6def4 „Aplică probe fix: verdicturi ok/benign/limited/broken, pool Solana RPC cu failover, rate-l” a trecut în 2 joburi (Node 22 și 24). |
| ✅ | Sintaxă validă în toate fișierele JS | trecut | Pasul „Syntax + tests” a trecut (raportul pe grupe apare de la următoarea rulare CI). |
| ✅ | Arhitectură hexagonală respectată | trecut | Pasul „Syntax + tests” a trecut (raportul pe grupe apare de la următoarea rulare CI). |
| ✅ | Doar surse gratuite: hosturi aprobate, niciun abonament | trecut | Pasul „Syntax + tests” a trecut (raportul pe grupe apare de la următoarea rulare CI). |
| ✅ | Exclusiv research: niciun endpoint de ordine sau retragere | trecut | Pasul „Syntax + tests” a trecut (raportul pe grupe apare de la următoarea rulare CI). |
| ✅ | Testele de domeniu | trecut | Pasul „Syntax + tests” a trecut (raportul pe grupe apare de la următoarea rulare CI). |
| ✅ | Testele de aplicație și end-to-end | trecut | Pasul „Syntax + tests” a trecut (raportul pe grupe apare de la următoarea rulare CI). |
| ✅ | Testele de adaptoare și scripturi | trecut | Pasul „Syntax + tests” a trecut (raportul pe grupe apare de la următoarea rulare CI). |
| ✅ | Testele de interfață | trecut | Pasul „Syntax + tests” a trecut (raportul pe grupe apare de la următoarea rulare CI). |
| ✅ | Testele agentului AI | trecut | Pasul „Syntax + tests” a trecut (raportul pe grupe apare de la următoarea rulare CI). |
| ✅ | Scanare DEMO offline, contract valid, site construit | trecut | Pasul „Offline DEMO scan, contract validation and site build” a trecut în 2 joburi. |
| ✅ | Pulsul păstrează contractul | trecut | Pasul „The pulse runs on top of the published snapshot without breaking the contract” a trecut în 2 joburi. |
| ✅ | Setul de etichete on-chain este prezent și clasifică | trecut | Pasul „The committed label dataset is present and classifies” a trecut în 2 joburi. |

### Rulare — fiecare scanare live

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | Ultima scanare live a reușit | reușită | Scanarea din 2026-11-14 06:37 UTC (schedule) s-a încheiat în 13.9 min. |
| ✅ | Contractul publicat respectă schema | trecut | Pasul „Validate the published contract” a trecut. |
| ✅ | Sursele obligatorii au răspuns | 2/2 | CoinGecko (univers), Lumânări 1D/4H: OK. |
| ⚠️ | Furnizorii gratuiți răspund | 18/20 | Cu probleme: Solana JSON-RPC (RATE_LIMITED, 7% istoric); GitHub (PARTIAL, 76% istoric). |
| ✅ | Bugetele planurilor gratuite | max 44.6% | Cel mai solicitat plan: CoinGecko Demo, 44.6% din luna proiectată. |
| ✅ | Poarta de validitate aplicată | 387/1/115 | 387 verificate, 1 în verificare, 115 respinse; niciun proiect respins în liste. |
| ✅ | Prognoza ≥100×: listă de învățare și rată de bază | 25 de câștigători confirmați | 25 de câștigători confirmați din istoricul zilnic; bază ≥100× de la prețul zilei 0.156% (anual 0.61%, accesibil ~93.4 zile/an); validare în afara eșantionului: ≥20×: 38.5% în top 20%. |
| ✅ | Durata scanării în normă | 12.3 min | 12.3 min din 22; norma învățată 12.09 min. |
| ✅ | Universul în normă | 503 eligibile | 4396 unificate, 503 eligibile, 503 cercetate în profunzime; în normă. |
| ✅ | Starea cercetării salvată | 95 de rulări | cri-state conține snapshot-ul ultimei scanări (2026-11-14T06:38:45.859Z); 95 de rulări de la 2026-10-24. |
| ✅ | Site-ul publică ultimul snapshot | sincron | https://hdmihai.github.io/radarcry/ servește rularea din 2026-11-14T06:38:45.859Z. |
| ⚠️ | Prospețimea datelor | 7.8 h | Ultima scanare are 7.8 h (cadență promisă 4 h). |
| ✅ | Nicio cheie în fișierele publicate | 3 fișiere | 3 fișiere publicate scanate (4043 KB): nicio cheie, niciun URL cu cheie. |

### Cadență și programare

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ❌ | Cadența scanării complete | 1.71/6 pe zi | 12 rulări în 7 zile = 1.71/zi față de 6/zi promise de „17 */4 * * *” (29%); interval median 5.7 h, maxim 8.8 h. |
| ⚠️ | Cadența pulsului | 2.57/96 pe zi | 18 rulări în 7 zile = 2.57/zi față de 96/zi promise de „7,22,37,52 * * * *” (3%); interval median 3.9 h, maxim 8.7 h. |
| ✅ | Toate workflow-urile sunt active | 5/5 | Active: CI, Scan & deploy, Pulse, Probe surse, Actualizare etichete on-chain. |
| ✅ | Activitate în repository | 5.3 zile | Ultimul commit pe main: 2026-11-09 (acum 5.3 zile). |

### Verificări periodice

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ⚠️ | Sonda săptămânală a surselor gratuite | 17.8 zile | Ultima rulare acum 17.8 zile (așteptat: cel mult 8). |
| · | Actualizarea lunară a etichetelor on-chain | — | Workflow nou: așteaptă prima rulare programată. |

### Model și învățare

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| … | Calibrarea prognozei ≥100× / ≥20× | 1181 de prognoze | 3 cohorte, 1181 de prognoze; așteptate până acum 0.18 creșteri ≥20×, observate 0 — prea puține pentru un verdict. |
| … | Track record-ul semnalelor | 1 semnal | 1 semnal în cohorta „Stage 2 + Oportunitate > 80 + Risc < 60”, 1 deschise; nicio scadență nu are încă destule intrări pentru un verdict. |
| ⚠️ | Eficiența identificării: radarul indică proiectele corecte | TIMPURIU ×2.92 | 10158 de observații din 78 de scanări (724 de proiecte), 382 de mișcări de +20% în 72 h; rata universului 3.8%. ID-1 trecut (×2.92) · ID-2 trecut (×1.82) · ID-3 trecut (ordonat) · ID-4 eșuat (×3.82) · ID-5 atenționare (0%). ID-4: Stage 3 (expansiune — târziu): 15.5% [9.7%–23.8%] din 71 observații (29 proiecte) au atins +30% în 7 zile, față de 4.1% în univers → lift 3.82; rezultat median la final -10.2%. Eticheta „târziu” ascunde proiecte care continuă să crească. ID-5: Candidat de research timpuriu (definiția de business): 10 observații, a semnalat 0% din 382 mișcări de +20% în 72 de ore (129 proiecte), prag 5%. |

### Agentul AI

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | Memoria agentului | 105 rulări | 105 rulări ale agentului din 2026-10-31; 34/37 norme învățate; 8 incidente deschise, 36 rezolvate; 6 remedieri reținute. |
| ⚠️ | Narațiunea AI (model deschis local) | șablon | Șablon determinist: garda a respins textul modelului: cifre care nu apar în fapte: 0.013. |
| ✅ | Regulile fundamentale în memoria agentului | v1.0.0 · 21 reguli | Încărcate în memorie cu amprenta 7d5b11e8; în memorie din 2026-10-31: 15 trecute, 2 atenționări, 2 eșuate, 2 în învățare, 0 fără date. |
| ✅ | Auto-evaluarea capacității de învățare | skill 0.342 | Pe 100 de rulări (3323 de predicții): Brier 0.013464, față de 0.020463 pentru „ca data trecută” și 0.018945 pentru frecvența simplă → skill 0.342 pe 68 de schimbări de stare; curba de învățare: Brier scade cu 0.007602 de la prima fereastră; normele: 89.9% din 1942 valori noi în banda p10–p90 (ținta 80%). |

### Eficiență față de un desk profesional

Paritate 87.7% permanent · 92.8% cu chei gratuite · 82.9% realizat; prospețime 75.9% (promisă 94.6%); fiabilitate 100% → **eficiență efectivă 62.9%** (design 87.8%).

### Acțiuni

- pornit: scan-and-deploy.yml — ultima scanare a pornit acum 7.8 h; cron-ul promite una la 4 h, iar GitHub a sărit programarea
