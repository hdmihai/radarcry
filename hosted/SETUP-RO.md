# AI Assistant hostat pe GitHub — pașii de configurare

Ce obții: o pagină „AI Assistant” în dashboard, cu chat în text simplu, istoric de conversații și un asistent care
gândește cu un model gratuit, citește datele radarului, caută pe internet, cere o a doua opinie altor agenți și ține
minte ce a rezolvat. Totul rulează pe GitHub (Actions), în **repo-ul tău privat**; nu ai nevoie de telefon pornit
sau de server. Răspunsul durează de regulă 30–90 de secunde.

Cum funcționează: pagina trimite mesajul prin API-ul GitHub (`workflow_dispatch`), workflow-ul din repo-ul privat îl
rezolvă și salvează conversația în `memory/`, iar pagina așteaptă să apară răspunsul.

```
dashboard (GitHub Pages) ──token──► repo privat radarcry-agent ──► workflow „Asistent AI”
                                      memory/ (conversații, cazuri, lecții)      │
                                                                                 ├─ codul radarcry (repo public)
                                                                                 ├─ datele radarului (ramurile cri-agent, cri-state)
                                                                                 └─ Groq, Tavily (chei gratuite, ca secrete)
```

Timp total: circa 20 de minute.

## 1. Urcă soluția în repo-ul public `radarcry`

Din Termux (sau de pe calculator), în folderul `radarcry`:

```bash
unzip -o radarcry-asistent-ai.zip
npm run ci                 # trebuie să treacă toate testele
git add -A
git commit -m "AI Assistant: chat hostat pe GitHub, memorie, unelte, învățare"
git push
```

Dashboard-ul se reconstruiește singur prin workflow-ul de Pages pe care îl ai deja. Pagina „AI Assistant” apare în
meniul principal, după „Small-Cap Radar”.

## 2. Creează repo-ul PRIVAT

1. GitHub → **New repository**.
2. Nume: `radarcry-agent` (poți alege altul).
3. Alege **Private**. Nu bifa README, .gitignore sau licență.
4. **Create repository**.

Important: repo-ul trebuie să fie privat. Conversațiile tale se salvează în el, iar dashboard-ul refuză să se conecteze la
un repo public.

## 3. Pune scheletul în repo-ul privat

Scheletul este în `hosted/radarcry-agent/` (workflow-ul, scriptul de salvare, memoria de pornire). Din Termux:

```bash
cd ~
git clone https://github.com/CONTUL_TAU/radarcry-agent.git      # sau varianta SSH, cum folosești deja
cp -r radarcry/hosted/radarcry-agent/. radarcry-agent/          # punctul de la final copiază și folderul ascuns .github
cd radarcry-agent
ls -a                                                           # trebuie să vezi .github, memory, scripts
git add -A
git commit -m "Asistent AI: schelet"
git push -u origin main
```

Alternativ, dezarhivează `radarcry-agent-skeleton.zip` direct în folderul repo-ului privat clonat (conține și folderul ascuns `.github`).

Workflow-ul trebuie să fie pe ramura implicită (`main`), altfel GitHub nu îl poate porni din API.

Poți edita `memory/owner.md`: e „memoria de pornire” a asistentului despre tine și proiect (am pus ce mi-ai spus: stilul de
tranzacționare, preferințele, regulile proiectului). Ce scrii acolo ajunge în instrucțiunile modelului; nu pune chei sau
date financiare.

## 4. Cheile gratuite (ca secrete în repo-ul privat)

Creează conturi gratuite și copiază cheile:

| Serviciu | Rol | Unde | Obligatoriu |
|---|---|---|---|
| Groq | modelul care gândește | console.groq.com → API Keys | da |
| Tavily | căutare pe internet | app.tavily.com → API Keys | recomandat |
| OpenRouter | model de rezervă și a doua opinie | openrouter.ai → Keys | opțional |
| Exa | a doua sursă de căutare | exa.ai → API keys | opțional |

Apoi, în repo-ul **privat**: **Settings → Secrets and variables → Actions → New repository secret**. Creează, cu
numele exact:

- `GROQ_API_KEY`
- `TAVILY_API_KEY`
- `OPENROUTER_API_KEY` (opțional)
- `EXA_API_KEY` (opțional)

Dacă repo-ul tău public nu este `hdmihai/radarcry`, adaugă la fila **Variables** o variabilă `CODE_REPO` cu valoarea
`contul-tau/radarcry`. Opțional, `CODE_REF` (ramura sau eticheta din care se ia codul; implicit `main`).

Modelele folosite sunt în `agent/config.json`, secțiunea `assistant` (Groq `openai/gpt-oss-120b`, rezerva OpenRouter
`openrouter/free`). Planurile gratuite își schimbă des modelele și limitele: dacă un model dispare, schimbi numele acolo.

## 5. Tokenul pentru dashboard

Tokenul îl pune pagina în browserul tău (nu în cod) ca să pornească workflow-ul și să citească memoria. Fă-l cât se poate de
îngust:

1. GitHub → fotografia ta → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner**: contul tău. **Expiration**: 90 de zile.
3. **Repository access → Only select repositories** → doar `radarcry-agent`.
4. **Repository permissions**:
   - **Actions: Read and write** (pornește workflow-ul și vede starea rulării)
   - **Contents: Read-only** (citește conversațiile)
   - **Metadata: Read-only** (se adaugă automat)
   - nimic altceva.
5. **Generate token** și copiază-l (se arată o singură dată).

Cu acest token, cineva care ți l-ar fura ar putea porni workflow-ul și citi memoria asistentului, atât. Nu poate scrie în cod
sau în alte repo-uri. Dacă ți se pare că a ieșit la iveală: șterge-l din aceeași pagină.

## 6. Conectează pagina

1. Deschide dashboard-ul → **AI Assistant**.
2. Mod: **GitHub (recomandat)**.
3. **Repo privat**: `contul-tau/radarcry-agent`.
4. **Token GitHub**: lipește tokenul.
5. **Conectează**. Lângă titlu apare „conectat la GitHub”.
6. Scrie „cum stă radarul?”. Prima rulare durează mai mult (pornirea jobului, descărcarea codului); vezi pe ecran
   „în coadă”, apoi „agentul lucrează” și timpul scurs.

Verificare în GitHub: repo-ul privat → **Actions → Asistent AI**: rularea trebuie să fie verde, iar în `memory/` apare un
commit „asistent: chat …” cu conversația.

## 7. Cum învață

- Sub fiecare răspuns ai **👍 Bun** și **👎 Greșit**. Fiecare cerere rezolvată se salvează ca „caz”; la o cerere
  asemănătoare, asistentul vede cazurile aprobate ca exemple și cele respinse ca greșeli de evitat.
- În fiecare **luni dimineața** (și când pornești manual workflow-ul cu `op = learn`) asistentul își redactează „lecții” din
  cazuri. Ele apar în meniul din stânga, la **Lecții propuse de asistent**, și **nu au niciun efect până nu apeși
  „Aprobă lecțiile”**. Așa nu își poate întări singur greșelile.
- Ștergerea unei conversații nu șterge ce a învățat din ea.

## 8. Limite și costuri (toate gratuite, verifică la înscriere, se pot schimba)

- GitHub Actions în repo privat, cont Free: 2.000 de minute pe lună. Un mesaj consumă de regulă 1–3 minute, deci circa 700–1.500
  de mesaje pe lună.
- Groq, plan gratuit: circa 30 de cereri pe minut, 1.000 pe zi și 8.000 de tokeni pe minut pe modelul mare. Cercetările lungi
  pot fi lente; asistentul așteaptă limita, apoi încearcă rezerva.
- Tavily: 1.000 de căutări pe lună.
- Dacă niciun model nu răspunde, asistentul răspunde din raportul lui (agentul de până acum) și îți spune asta în semnătură.

## 9. Siguranță

- Modelul nu vede cheile: ele sunt doar în mediul jobului, iar textul de pe internet este tratat ca date, nu ca instrucțiuni.
- Cifrele din răspunsuri trebuie să vină din unelte; altfel se cere o corectură, iar ce rămâne neverificat este marcat.
- Nu execută ordine și nu dă sfaturi de investiții. Nu poate modifica codul.
- Workflow-ul rulează codul din ramura `main` a repo-ului tău public, cu secretele repo-ului privat. Păstrează 2FA pe cont; pentru
  și mai multă stricteță, pune în variabila `CODE_REF` o etichetă sau un commit verificat.
- Jurnalele rulărilor sunt private, pentru că repo-ul este privat.

## 10. Dacă ceva nu merge

| Ce vezi | Cauza probabilă |
|---|---|
| „tokenul GitHub este greșit sau a expirat” | token copiat incomplet sau expirat; generează altul |
| „tokenul nu are permisiunea cerută” | lipsește Actions: scriere sau Contents: citire; sau limita API |
| „repo-ul nu există sau tokenul nu îl vede” | numele repo-ului greșit, sau tokenul nu are acces la acel repo |
| „repo-ul este PUBLIC” | fă repo-ul privat (Settings → Danger zone → Change visibility) |
| „workflow-ul assistant.yml lipsește sau nu are workflow_dispatch” | scheletul nu e pe ramura implicită, sau `.github/workflows/` nu a fost copiat |
| „jobul GitHub s-a încheiat cu failure” | deschide linkul din eroare și citește jurnalul; de obicei lipsește un secret sau `CODE_REPO` e greșit |
| răspunsul se semnează „răspuns din raportul meu” | modelul nu a răspuns: lipsește `GROQ_API_KEY` sau s-a atins limita gratuită |
| „GitHub nu a răspuns în timpul alocat” | jobul e încă în coadă sau a eșuat: vezi Actions în repo-ul privat |

## 11. Așteptări realiste

Modelele gratuite nu egalează Claude, mai ales la raționamente lungi. Asistentul compensează cu unelte, surse și o a doua
opinie, dar poate greși. Tratează-l ca pe un cercetător junior rapid, nu ca pe un oracol.
