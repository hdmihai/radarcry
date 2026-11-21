## Agent AI — eșuat

31 trecute · 4 atenționări · 1 eșecuri · 3 fără date sau în învățare (39 în total) — 2026-11-21T18:24:49.366Z

> - Starea generală: 39 de porti, 3 FAIL, 15 WARN, 15 LEARNING, 4 PASS. Problema principală este a doua: cadena de pulsuri cu 2.57/96 pe zi, cu 170 rulări în 7 zile.
> - Problema cea mai importantă: cadena de scanare cu 2.29/6 pe zi, cu 150 rulări în 7 zile, 38% de încălcări față de 6/zi promisă.
> - Alte probleme: cadena de pulsuri cu 2.57/96 pe zi, cadena de scanare cu 2.29/6 pe zi, identificare cu 2.71×, sonda cu 24.8 zile, furnizorii cu 18/20.
> - Eficiența: 82.9% realizat, 79.5% prospetime, 65.9% efectiva, 100% fiabilitate, 94.6% prospetime promis, 87.8% design, 12.5 puncte pentru cadena de programare și 9.9 pentru surse căzute.
> - Identificare: 2.71× lift, 100% timpuriu, 7.4% rata, 100% recall, 14 observații cu lift 3.74, 14 verdicturi, 12 incidente deschise, 48 incidente rezolvate, 9 remedieri, 0.33 skill, 0.011157 brier. Agentul a învățat și a aplicat recomandările.

<sub>scris de qwen2.5:3b (local), verificat cifră cu cifră</sub>

### Cod — CI la fiecare push (Node 22 și 24)

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | CI verde pe ultimul commit din main | verde | CI pe 2a7bae7 „fix(step-momentum): refoloseste HttpClient (zero requests) + mock Pieverse corect” a trecut în 2 joburi (Node 22 și 24). |
| ✅ | Sintaxă validă în toate fișierele JS | 248/248 | 248 de verificări trecute în CI pe 2a7bae7. |
| ✅ | Arhitectură hexagonală respectată | 7/7 | 7 verificări trecute în CI pe 2a7bae7. |
| ✅ | Doar surse gratuite: hosturi aprobate, niciun abonament | 2/2 | 2 verificări trecute în CI pe 2a7bae7. |
| ✅ | Exclusiv research: niciun endpoint de ordine sau retragere | 1/1 | 1 verificare trecută în CI pe 2a7bae7. |
| ✅ | Testele de domeniu | 148/148 | 148 de verificări trecute în CI pe 2a7bae7. |
| ✅ | Testele de aplicație și end-to-end | 68/68 | 68 de verificări trecute în CI pe 2a7bae7. |
| ✅ | Testele de adaptoare și scripturi | 59/59 | 59 de verificări trecute în CI pe 2a7bae7. |
| ✅ | Testele de interfață | 41/41 | 41 de verificări trecute în CI pe 2a7bae7. |
| ✅ | Testele agentului AI | 104/104 | 104 verificări trecute în CI pe 2a7bae7. |
| ✅ | Scanare DEMO offline, contract valid, site construit | trecut | Pasul „Offline DEMO scan, contract validation and site build” a trecut în 2 joburi. |
| ✅ | Pulsul păstrează contractul | trecut | Pasul „The pulse runs on top of the published snapshot without breaking the contract” a trecut în 2 joburi. |
| ✅ | Setul de etichete on-chain este prezent și clasifică | trecut | Pasul „The committed label dataset is present and classifies” a trecut în 2 joburi. |

### Rulare — fiecare scanare live

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | Ultima scanare live a reușit | reușită | Scanarea din 2026-11-21 14:57 UTC (push) s-a încheiat în 17.8 min. |
| ✅ | Contractul publicat respectă schema | trecut | Pasul „Validate the published contract” a trecut. |
| ✅ | Sursele obligatorii au răspuns | 2/2 | CoinGecko (univers), Lumânări 1D/4H: OK. |
| ⚠️ | Furnizorii gratuiți răspund | 18/20 | Cu probleme: Solana JSON-RPC (RATE_LIMITED, 0% istoric); GitHub (PARTIAL, 74% istoric). |
| ✅ | Bugetele planurilor gratuite | max 45.6% | Cel mai solicitat plan: CoinGecko Demo, 45.6% din luna proiectată. |
| ✅ | Poarta de validitate aplicată | 409/0/122 | 409 verificate, 0 în verificare, 122 respinse; niciun proiect respins în liste. |
| ✅ | Prognoza ≥100×: listă de învățare și rată de bază | 24 de câștigători confirmați | 24 de câștigători confirmați din istoricul zilnic; bază ≥100× de la prețul zilei 0.1626% (anual 0.636%, accesibil ~93.4 zile/an); validare în afara eșantionului: ≥20×: 38.5% în top 20%. |
| ✅ | Durata scanării în normă | 10.1 min | 10.1 min din 22; norma învățată 11.54 min. |
| ✅ | Universul în normă | 531 eligibile | 4061 unificate, 531 eligibile, 531 cercetate în profunzime; în normă. |
| ✅ | Starea cercetării salvată | 133 de rulări | cri-state conține snapshot-ul ultimei scanări (2026-11-21T14:58:47.986Z); 133 de rulări de la 2026-10-24. |
| ✅ | Site-ul publică ultimul snapshot | sincron | https://hdmihai.github.io/radarcry/ servește rularea din 2026-11-21T14:58:47.986Z. |
| ✅ | Prospețimea datelor | 3.4 h | Snapshot vechi de 3.4 h; ultimul puls 15:40 UTC. |
| ✅ | Nicio cheie în fișierele publicate | 3 fișiere | 3 fișiere publicate scanate (4188 KB): nicio cheie, niciun URL cu cheie. |

### Cadență și programare

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ❌ | Cadența scanării complete | 2.14/6 pe zi | 15 rulări în 7 zile = 2.14/zi față de 6/zi promise de „17 */4 * * *” (36%); interval median 3.5 h, maxim 10.3 h. |
| ⚠️ | Cadența pulsului | 2.57/96 pe zi | 18 rulări în 7 zile = 2.57/zi față de 96/zi promise de „7,22,37,52 * * * *” (3%); interval median 3.1 h, maxim 9.3 h. |
| ✅ | Toate workflow-urile sunt active | 5/5 | Active: CI, Scan & deploy, Pulse, Probe surse, Actualizare etichete on-chain. |
| ✅ | Activitate în repository | 0 zile | Ultimul commit pe main: 2026-11-21 (acum 0 zile). |

### Verificări periodice

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ⚠️ | Sonda săptămânală a surselor gratuite | 25 zile | Ultima rulare acum 25 zile (așteptat: cel mult 8). |
| · | Actualizarea lunară a etichetelor on-chain | — | Workflow nou: așteaptă prima rulare programată. |

### Model și învățare

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| … | Calibrarea prognozei ≥100× / ≥20× | 1561 de prognoze | 4 cohorte, 1561 de prognoze; așteptate până acum 0.31 creșteri ≥20×, observate 0 — prea puține pentru un verdict. |
| … | Track record-ul semnalelor | 2 semnale | 2 semnale în cohorta „Stage 2 + Oportunitate > 80 + Risc < 60”, 2 deschise; nicio scadență nu are încă destule intrări pentru un verdict. |
| ⚠️ | Eficiența identificării: radarul indică proiectele corecte | TIMPURIU ×2.68 | 14117 observații din 113 scanări (701 proiecte), 544 de mișcări de +20% în 72 h; rata universului 3.9%. ID-1 trecut (×2.68) · ID-2 trecut (×2.02) · ID-3 trecut (ordonat) · ID-4 eșuat (×3.61) · ID-5 atenționare (0.4%). ID-4: Stage 3 (expansiune — târziu): 14.5% [9.9%–20.9%] din 110 observații (36 proiecte) au atins +30% în 7 zile, față de 4% în univers → lift 3.61; rezultat median la final -7%. Eticheta „târziu” ascunde proiecte care continuă să crească. ID-5: Candidat de research timpuriu (definiția de business): 15 observații, a semnalat 0.4% din 544 mișcări de +20% în 72 de ore (167 proiecte), prag 5%. |

### Agentul AI

| | Poartă | Valoare | Dovadă |
|---|---|---|---|
| ✅ | Memoria agentului | 172 de rulări | 172 de rulări ale agentului din 2026-10-31; 34/37 norme învățate; 12 incidente deschise, 48 rezolvate; 9 remedieri reținute. |
| ✅ | Narațiunea AI (model deschis local) | qwen2.5:3b | Rezumat scris de qwen2.5:3b, verificat: fiecare cifră se regăsește în fapte. |
| ✅ | Regulile fundamentale în memoria agentului | v1.0.0 · 21 reguli | Încărcate în memorie cu amprenta 7d5b11e8; în memorie din 2026-10-31: 15 trecute, 2 atenționări, 2 eșuate, 2 în învățare, 0 fără date. |
| ✅ | Auto-evaluarea capacității de învățare | skill 0.329 | Pe 167 de rulări (5534 de predicții): Brier 0.011036, față de 0.016444 pentru „ca data trecută” și 0.017245 pentru frecvența simplă → skill 0.329 pe 91 de schimbări de stare; curba de învățare: Brier scade cu 0.011596 de la prima fereastră; normele: 89.4% din 3131 valori noi în banda p10–p90 (ținta 80%). |

### Eficiență față de un desk profesional

Paritate 87.7% permanent · 92.8% cu chei gratuite · 82.9% realizat; prospețime 78.7% (promisă 94.6%); fiabilitate 100% → **eficiență efectivă 65.3%** (design 87.8%).

### Acțiuni

- pornit: pulse.yml — ultimul puls a pornit acum 2.7 h; cron-ul promite unul la 15 min
