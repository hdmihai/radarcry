## Agent AI — eșuat

31 trecute · 4 atenționări · 1 eșecuri · 3 fără date sau în învățare (39 în total) — 2026-11-07T10:39:30.669Z

> - Starea generală: 39 de porti, 3 FAIL, 21 WARN, 15 LEARNING, 2 UNKNOWN.
> - Cea mai importantă problemă: Cadena scanării complete, 2.14/6 pe zi, cu dovadă că cadena nu rulează la întâmplări, rezolvată prin utilizarea workflow_dispatch.
> - Celelalte probleme: Cadena pulsului, 2.43/96 pe zi; Eficiența identificării: radarul indică proiectele corecte, cu dovadă de 251 de mișcări de +20% în 72 h; Sonda săptămânală a surselor gratuite, cu dovadă de 17 rulări în 7 zile.
> - Eficiența față de un desk profesional: Paritate 87.7%, Prospețime 78.6%, Eficiență efectivă 63.4%, Pârghie 13.3.
> - Radarul identifică 251 de mișcări de +20% în 72 h, rata universului 4.2%, cu 96 de observații din 42 de scanări, agentul a învățat 32 de rulări, 23 de incidente rezolvate și 4 de remedieri.
> - Auto-evaluarea: 47 de rulări noteate, brier 0.018286, skill 0.298.

<sub>scris de qwen2.5:3b (local), verificat cifră cu cifră</sub>

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
| ✅ | Ultima scanare live a reușit | reușită | Scanarea din 2026-11-07 06:08 UTC (schedule) s-a încheiat în 11.9 min. |
| ✅ | Contractul publicat respectă schema | trecut | Pasul „Validate the published contract” a trecut. |
| ✅ | Sursele obligatorii au răspuns | 2/2 | CoinGecko (univers), Lumânări 1D/4H: OK. |
| ⚠️ | Furnizorii gratuiți răspund | 18/20 | Cu probleme: Solana JSON-RPC (RATE_LIMITED, 11% istoric); GitHub (PARTIAL, 77% istoric). |
| ✅ | Bugetele planurilor gratuite | max 37.2% | Cel mai solicitat plan: CoinGecko Demo, 37.2% din luna proiectată. |
| ✅ | Poarta de validitate aplicată | 379/0/108 | 379 verificate, 0 în verificare, 108 respinse; niciun proiect respins în liste. |
| ✅ | Prognoza ≥100×: listă de învățare și rată de bază | 25 de câștigători confirmați | 25 de câștigători confirmați din istoricul zilnic; bază ≥100× de la prețul zilei 0.1626% (anual 0.636%, accesibil ~93.4 zile/an); validare în afara eșantionului: ≥20×: 38.5% în top 20%. |
| ✅ | Durata scanării în normă | 10.1 min | 10.1 min din 22; norma învățată 11.985 min. |
| ✅ | Universul în normă | 487 eligibile | 4544 unificate, 487 eligibile, 487 cercetate în profunzime; în normă. |
| ✅ | Starea cercetării salvată | 64 de rulări | cri-state conține snapshot-ul ultimei scanări (2026-11-07T06:09:52.153Z); 64 de rulări de la 2026-10-24. |
| ✅ | Site-ul publică ultimul snapshot | sincron | https://hdmihai.github.io/radarcry/ servește rularea din 2026-11-07T06:09:52.153Z. |
| ✅ | Prospețimea datelor | 4.5 h | Snapshot vechi de 4.5 h; ultimul puls 06:32 UTC. |
| ✅ | Nicio cheie în fișierele publicate | 3 fișiere | 3 fișiere publicate scanate (3996 KB): nicio cheie, niciun URL cu cheie. |

### Cadență și programare

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ❌ | Cadența scanării complete | 2.29/6 pe zi | 16 rulări în 7 zile = 2.29/zi față de 6/zi promise de „17 */4 * * *” (38%); interval median 4.7 h, maxim 9.6 h. |
| ⚠️ | Cadența pulsului | 2.57/96 pe zi | 18 rulări în 7 zile = 2.57/zi față de 96/zi promise de „7,22,37,52 * * * *” (3%); interval median 3.4 h, maxim 8 h. |
| ✅ | Toate workflow-urile sunt active | 5/5 | Active: CI, Scan & deploy, Pulse, Probe surse, Actualizare etichete on-chain. |
| ✅ | Activitate în repository | 5.6 zile | Ultimul commit pe main: 2026-11-01 (acum 5.6 zile). |

### Verificări periodice

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ⚠️ | Sonda săptămânală a surselor gratuite | 10.6 zile | Ultima rulare acum 10.6 zile (așteptat: cel mult 8). |
| · | Actualizarea lunară a etichetelor on-chain | — | Workflow nou: așteaptă prima rulare programată. |

### Model și învățare

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| … | Calibrarea prognozei ≥100× / ≥20× | 791 de prognoze | 2 cohorte, 791 de prognoze; așteptate până acum 0.07 creșteri ≥20×, observate 0 — prea puține pentru un verdict. |
| … | Track record-ul semnalelor | 1 semnal | 1 semnal în cohorta „Stage 2 + Oportunitate > 80 + Risc < 60”, 1 deschise; nicio scadență nu are încă destule intrări pentru un verdict. |
| ⚠️ | Eficiența identificării: radarul indică proiectele corecte | TIMPURIU ×2.21 | 6495 de observații din 43 de scanări (678 de proiecte), 274 de mișcări de +20% în 72 h; rata universului 4.2%. ID-1 trecut (×2.21) · ID-2 trecut (×1.36) · ID-3 trecut (ordonat) · ID-4 atenționare (×1.46) · ID-5 atenționare (0%). ID-4: Stage 3 (expansiune — târziu): 5.9% [2%–16.3%] din 34 observații (18 proiecte) au atins +30% în 7 zile, față de 4% în univers → lift 1.46; rezultat median la final -13.8%. Eticheta nu descurajează suficient (prag lift ≤ 1.2, median ≤ 0). ID-5: Candidat de research timpuriu (definiția de business): 9 observații, a semnalat 0% din 274 mișcări de +20% în 72 de ore (98 proiecte), prag 5%. |

### Agentul AI

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | Memoria agentului | 55 de rulări | 55 de rulări ale agentului din 2026-10-31; 34/37 norme învățate; 5 incidente deschise, 23 rezolvate; 4 remedieri reținute. |
| ✅ | Narațiunea AI (model deschis local) | qwen2.5:3b | Rezumat scris de qwen2.5:3b, verificat: fiecare cifră se regăsește în fapte. |
| ✅ | Regulile fundamentale în memoria agentului | v1.0.0 · 21 reguli | Încărcate în memorie cu amprenta 7d5b11e8; în memorie din 2026-10-31: 15 trecute, 3 atenționări, 1 eșuată, 2 în învățare, 0 fără date. |
| ✅ | Auto-evaluarea capacității de învățare | skill 0.293 | Pe 50 de rulări (1673 de predicții): Brier 0.017314, față de 0.024507 pentru „ca data trecută” și 0.020587 pentru frecvența simplă → skill 0.293 pe 41 de schimbări de stare; curba de învățare: Brier scade cu 0.001006 de la prima fereastră; normele: 91% din 982 valori noi în banda p10–p90 (ținta 80%). |

### Eficiență față de un desk profesional

Paritate 87.7% permanent · 92.8% cu chei gratuite · 82.9% realizat; prospețime 79.5% (promisă 94.6%); fiabilitate 97.4% → **eficiență efectivă 64.2%** (design 87.8%).

### Acțiuni

- pornit: scan-and-deploy.yml — ultima scanare a pornit acum 4.5 h; cron-ul promite una la 4 h, iar GitHub a sărit programarea
