## Agent AI — eșuat

32 trecute · 4 atenționări · 1 eșecuri · 2 fără date sau în învățare (39 în total) — 2026-11-28T16:19:36.477Z

> - Starea generală: 39 de porti, 3 FAIL, 2 WARN, 2 LEARNING, 10 UNKNOWN.
> - Cea mai importantă problemă: Sonda săptămânală a surselor gratuite (WARN), cu dovada că sursa este întârziată și remediul este să rulați-l manual.
> - Celelalte probleme: Cadența scanării complete (FAIL), Cadența pulsului (WARN), Eficiența identificării (WARN), Furnizorii gratuiți răspund (WARN).
> - Eficiența: 82.9% realizat, 94.6% prospețime, 63.6% efectiva, 87.8% design.
> - Radarul identifică 20% din mișcările (TIMPURIU față de univers), agentul a învățat 32 de norme, auto-evaluarea a sugerat 114 schimbări, skill-ul a crescut la 0.355.

<sub>scris de qwen2.5:3b (local), verificat cifră cu cifră</sub>

### Cod — CI la fiecare push (Node 22 și 24)

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | CI verde pe ultimul commit din main | verde | CI pe 7ef2f86 „feat(frontend): add Python research dashboard with discovery coverage” a trecut în 2 joburi (Node 22 și 24). |
| ✅ | Sintaxă validă în toate fișierele JS | 253/253 | 253 de verificări trecute în CI pe 7ef2f86. |
| ✅ | Arhitectură hexagonală respectată | 7/7 | 7 verificări trecute în CI pe 7ef2f86. |
| ✅ | Doar surse gratuite: hosturi aprobate, niciun abonament | 2/2 | 2 verificări trecute în CI pe 7ef2f86. |
| ✅ | Exclusiv research: niciun endpoint de ordine sau retragere | 1/1 | 1 verificare trecută în CI pe 7ef2f86. |
| ✅ | Testele de domeniu | 148/148 | 148 de verificări trecute în CI pe 7ef2f86. |
| ✅ | Testele de aplicație și end-to-end | 68/68 | 68 de verificări trecute în CI pe 7ef2f86. |
| ✅ | Testele de adaptoare și scripturi | 62/62 | 62 de verificări trecute în CI pe 7ef2f86. |
| ✅ | Testele de interfață | 53/53 | 53 de verificări trecute în CI pe 7ef2f86. |
| ✅ | Testele agentului AI | 104/104 | 104 verificări trecute în CI pe 7ef2f86. |
| ✅ | Scanare DEMO offline, contract valid, site construit | trecut | Pasul „Offline DEMO scan, contract validation and site build” a trecut în 2 joburi. |
| ✅ | Pulsul păstrează contractul | trecut | Pasul „The pulse runs on top of the published snapshot without breaking the contract” a trecut în 2 joburi. |
| ✅ | Setul de etichete on-chain este prezent și clasifică | trecut | Pasul „The committed label dataset is present and classifies” a trecut în 2 joburi. |

### Rulare — fiecare scanare live

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | Ultima scanare live a reușit | reușită | Scanarea din 2026-11-28 11:51 UTC (push) s-a încheiat în 23.5 min. |
| ✅ | Contractul publicat respectă schema | trecut | Pasul „Validate the published contract” a trecut. |
| ✅ | Sursele obligatorii au răspuns | 2/2 | CoinGecko (univers), Lumânări 1D/4H: OK. |
| ⚠️ | Furnizorii gratuiți răspund | 18/20 | Cu probleme: Solana JSON-RPC (RATE_LIMITED, 0% istoric); GitHub (PARTIAL, 74% istoric). |
| ✅ | Bugetele planurilor gratuite | max 45.6% | Cel mai solicitat plan: CoinGecko Demo, 45.6% din luna proiectată. |
| ✅ | Poarta de validitate aplicată | 376/1/102 | 376 verificate, 1 în verificare, 102 respinse; niciun proiect respins în liste. |
| ✅ | Prognoza ≥100×: listă de învățare și rată de bază | 23 de câștigători confirmați | 23 de câștigători confirmați din istoricul zilnic; bază ≥100× de la prețul zilei 0.1621% (anual 0.634%, accesibil ~93.4 zile/an); validare în afara eșantionului: ≥20×: 46.2% în top 20%. |
| ✅ | Durata scanării în normă | 9.8 min | 9.8 min din 22; norma învățată 11.125 min. |
| ✅ | Universul în normă | 479 eligibile | 3802 unificate, 479 eligibile, 479 cercetate în profunzime; în normă. |
| ✅ | Starea cercetării salvată | 162 de rulări | cri-state conține snapshot-ul ultimei scanări (2026-11-28T11:53:17.580Z); 162 de rulări de la 2026-10-24. |
| ✅ | Site-ul publică ultimul snapshot | sincron | https://hdmihai.github.io/radarcry/ servește rularea din 2026-11-28T11:53:17.580Z. |
| ✅ | Prospețimea datelor | 4.4 h | Snapshot vechi de 4.4 h; ultimul puls 14:05 UTC. |
| ✅ | Nicio cheie în fișierele publicate | 3 fișiere | 3 fișiere publicate scanate (4311 KB): nicio cheie, niciun URL cu cheie. |

### Cadență și programare

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ❌ | Cadența scanării complete | 1.86/6 pe zi | 13 rulări în 7 zile = 1.86/zi față de 6/zi promise de „17 */4 * * *” (31%); interval median 4.1 h, maxim 13.3 h. |
| ⚠️ | Cadența pulsului | 2.29/96 pe zi | 16 rulări în 7 zile = 2.29/zi față de 96/zi promise de „7,22,37,52 * * * *” (2%); interval median 3.5 h, maxim 9.8 h. |
| ✅ | Toate workflow-urile sunt active | 5/5 | Active: CI, Scan & deploy, Pulse, Probe surse, Actualizare etichete on-chain. |
| ✅ | Activitate în repository | 0.2 zile | Ultimul commit pe main: 2026-11-28 (acum 0.2 zile). |

### Verificări periodice

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ⚠️ | Sonda săptămânală a surselor gratuite | 31.9 zile | Ultima rulare acum 31.9 zile (așteptat: cel mult 8). |
| ✅ | Actualizarea lunară a etichetelor on-chain | success | Ultima rulare 2026-11-28 (workflow_dispatch): success. |

### Model și învățare

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| … | Calibrarea prognozei ≥100× / ≥20× | 1927 de prognoze | 5 cohorte, 1927 de prognoze; așteptate până acum 0.46 creșteri ≥20×, observate 0 — prea puține pentru un verdict. |
| … | Track record-ul semnalelor | 2 semnale | 2 semnale în cohorta „Stage 2 + Oportunitate > 80 + Risc < 60”, 2 deschise; nicio scadență nu are încă destule intrări pentru un verdict. |
| ⚠️ | Eficiența identificării: radarul indică proiectele corecte | TIMPURIU ×2.47 | 15478 de observații din 129 de scanări (712 proiecte), 604 mișcări de +20% în 72 h; rata universului 3.9%. ID-1 trecut (×2.47) · ID-2 trecut (×2.09) · ID-3 trecut (ordonat) · ID-4 eșuat (×4.53) · ID-5 atenționare (0.3%). ID-4: Stage 3 (expansiune — târziu): 19.3% [13.8%–26.2%] din 109 observații (32 proiecte) au atins +30% în 7 zile, față de 4.2% în univers → lift 4.53; rezultat median la final -5.2%. Eticheta „târziu” ascunde proiecte care continuă să crească. ID-5: Candidat de research timpuriu (definiția de business): 13 observații, a semnalat 0.3% din 604 mișcări de +20% în 72 de ore (193 proiecte), prag 5%. |

### Agentul AI

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | Memoria agentului | 218 rulări | 218 rulări ale agentului din 2026-10-31; 34/37 norme învățate; 14 incidente deschise, 59 rezolvate; 8 remedieri reținute. |
| ✅ | Narațiunea AI (model deschis local) | qwen2.5:3b | Rezumat scris de qwen2.5:3b, verificat: fiecare cifră se regăsește în fapte. |
| ✅ | Regulile fundamentale în memoria agentului | v1.0.0 · 21 reguli | Încărcate în memorie cu amprenta 7d5b11e8; în memorie din 2026-10-31: 16 trecute, 1 atenționare, 2 eșuate, 2 în învățare, 0 fără date. |
| ✅ | Auto-evaluarea capacității de învățare | skill 0.355 | Pe 213 rulări (7070 de predicții): Brier 0.010405, față de 0.016124 pentru „ca data trecută” și 0.017857 pentru frecvența simplă → skill 0.355 pe 114 schimbări de stare; curba de învățare: Brier scade cu 0.008719 de la prima fereastră; normele: 89.1% din 4027 valori noi în banda p10–p90 (ținta 80%). |

### Eficiență față de un desk profesional

Paritate 87.7% permanent · 92.8% cu chei gratuite · 82.9% realizat; prospețime 76.7% (promisă 94.6%); fiabilitate 100% → **eficiență efectivă 63.6%** (design 87.8%).

### Acțiuni

- pornit: pulse.yml — ultimul puls a pornit acum 2.2 h; cron-ul promite unul la 15 min
