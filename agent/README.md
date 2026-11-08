# Agentul AI de calitate

Modul separat al CRI Radar: monitorizează gratuit toate porțile de calitate ale proiectului, învață
din istoricul lui, măsoară cât de bine identifică radarul proiectele care cresc, judecă prognoza după
reguli fundamentale scrise, se autoevaluează și răspunde proprietarului — cu diagnoze și, la cerere, cu
cod propus ca pull request. Nu importă nimic din `src/` (un test de arhitectură o verifică) — citește
doar ce publică scannerul (ramura `cri-state`), ce înregistrează GitHub (rulări, joburi, adnotări,
deploy-uri, propriile pull requesturi) și prețurile publice CoinGecko, fără cheie.

```
domain/        pur, determinist: porți, cron și cadență, norme robuste, incidente și remedieri,
               calibrarea prognozei, eficiență, eficiența identificării (identification.js),
               regulile fundamentale (rules.js), auto-evaluarea (selfeval.js), auto-reparare,
               narațiune și gardă, înțelegerea limbajului natural (intent.js), formele scurte
               (commands.js), răspunsurile (chat.js) în text simplu (plain.js), căutarea în
               documentație (retrieval.js), politica de patch (patch.js), chei (secrets.js)
application/   observe → learn → analyze / narrate / act, și chat, prin porturi
adapters/      API GitHub, fișiere de stare, memorie și cunoaștere, Pages, prețuri publice, Ollama
               local, spațiul de lucru git al comenzii de cod (workspace.js), simulator
knowledge/     rules.json — regulile fundamentale de evaluare și monitorizare
main.js        rădăcina de compoziție
config.json    praguri, limite de auto-reparare, modele, calibrare, identificare, chat
```

## Rulare

```bash
npm run agent:demo                       # 30 de rulări reluate pe istoricul simulat → data/agent.json (fără rețea)
GITHUB_REPOSITORY=owner/repo npm run agent   # pe repository-ul real, doar citire fără token
node agent/main.js analyze --memory .agent --state .state --out .agent/report
node agent/main.js narrate --memory .agent --out .agent/report   # cu Ollama pe 127.0.0.1:11434
node agent/main.js act --memory .agent --out .agent/report --dry-run
```

În GitHub Actions rulează din `.github/workflows/agent.yml` după fiecare CI, scanare, sondă și
actualizare de etichete, plus orar; memoria și raportul se salvează pe ramura `cri-agent`, iar
scanarea și pulsul publică raportul în ecranul **Agent AI** al dashboard-ului.

## Vorbește cu el — în cuvintele tale

```bash
npm run agent:sync                                 # memoria (.agent) și starea cercetării (.state) din GitHub
npm run agent:chat -- "cum stă radarul?"           # o întrebare, cum ți-ar veni s-o pui
npm run agent:chat                                 # o conversație (Termux inclus): după un răspuns, „de ce?”
npm run agent:chat:demo -- "ce s-a schimbat de ieri?"   # pe istoricul simulat
npm run agent:chat -- --write "scrie un test pentru …"  # cod local, pe un clone curat, cu Ollama
```

Înțelegerea (`domain/intent.js`) e deterministă — indicii cântărite pentru fiecare intenție (stare,
schimbări, diagnoză, semnale, eficiență, prognoză, reguli, învățare, pornirea unui workflow, cod, ajutor,
întrebare liberă) și entitățile din frază (rulare, workflow, poartă, regulă, simbol, interval) — cu
diacritice opționale; o continuare scurtă („de ce?”, „detalii”) își ia subiectul din mesajul anterior.
Doar o frază neclară ajunge la modelul local, care o încadrează în același vocabular. Răspunsurile
(`domain/chat.js`) sunt text simplu (`domain/plain.js`): propoziții, numere românești, ora din
`config.json` (`chat.timeZone`), fără Markdown.

Pe GitHub: orice mesaj într-o problemă al cărei titlu începe cu „Agent” (sau cu eticheta `agent`) și,
în rest, un comentariu care începe cu `/agent` (`.github/workflows/agent-chat.yml`; răspunde doar
proprietarului și colaboratorilor). O cerere de cod rulează modelul și testele în jobul `think`, al cărui
token doar citește; jobul `reply` nu execută nimic din repository, verifică diff-ul din nou și deschide
pull requestul pe o ramură `agent/…`.

## Ce poate face și ce nu

- Citește: rulările workflow-urilor, joburile, adnotările CI (raportul porților), deploy-urile Pages,
  snapshot-ul publicat și istoricul scanărilor, prețurile publice, propriile pull requesturi.
- Scrie: `workflow_dispatch` pentru o scanare sau un puls sărit de GitHub (cel mult 4 / 8 pe 24 h,
  niciodată după două eșecuri la rând sau peste 85 % din cota unui plan gratuit), o singură problemă
  GitHub cât timp există porți serioase sau critice eșuate, răspunsurile în text simplu la mesajele
  proprietarului și, doar când el cere cod, un pull request pe o ramură `agent/…`. Din conversație nu
  pornește workflow-uri: la „pornește o scanare” explică limitele și cum se pornește manual.
- Nu poate: anula, șterge, relua cu alți parametri, face merge, scrie în main, atinge workflow-urile sau
  testele de arhitectură.

## Regulile fundamentale

`knowledge/rules.json`: 6 principii, 5 reguli de identificare (ID-1…ID-5), 7 de prognoză (FC-1…FC-7) și
3 de monitorizare (MON-1…MON-3). Fiecare are textul în română și o verificare tipizată pe care agentul o
rulează la fiecare trecere. Versiunea și amprenta lor intră în memorie; o schimbare a regulilor este
înregistrată cu ora ei; verdictul fiecărei reguli se păstrează pe rulare. Pragurile de business nu se
schimbă automat: agentul recomandă, proprietarul decide printr-un commit.

## Auto-evaluarea

La fiecare rulare agentul prezice, pentru fiecare poartă, probabilitatea ca ea să ceară atenție la
rularea următoare (lanț cu două stări învățat pe poartă, cu prior adunat pe tot proiectul) și își
notează predicțiile la rularea următoare cu scorul Brier, față de „ca data trecută” și de frecvența
simplă. Verdictul (regula MON-1, poarta `agent.learning`) vine după 24 de rulări notate; cât timp nu se
schimbă nimic, regula naivă este imbatabilă, deci comparația se face cu frecvența simplă. Tot aici:
cât din valorile noi cad în normele învățate și câte propuneri de cod au fost acceptate.

Variabile opționale (Settings → Secrets and variables → Actions → Variables): `CRI_AGENT_LLM=off`,
`CRI_AGENT_MODEL` (implicit `qwen2.5:3b`), `CRI_AGENT_CODE_MODEL` (implicit `qwen2.5-coder:7b`),
`CRI_AGENT_HEAL=off`, `CRI_AGENT_ISSUES=off`, `CRI_AGENT_NARRATE=always|never`.

## Chat în dashboard (tab-ul „Chat Agent”)

```bash
npm run build && npm run agent:serve      # apoi deschide http://127.0.0.1:8787/#/chat (Termux inclus)
npm run agent:serve:demo                  # aceeași pagină, pe datele demo
```

`agent/adapters/http.js` este adaptorul de intrare: un server local (127.0.0.1) cu API-ul conversațiilor și, cu
`--dist`, dashboard-ul însuși, deci totul e pe o singură adresă. Tab-ul scrie în câmpul de text, arată puncte de
„se gândește” plus pașii agentului în timp real, apoi răspunsul în aceeași conversație. Meniul din stânga listează
istoricul (căutare, fixare, redenumire, descărcare .txt, ștergere). Istoricul se salvează automat ca fișiere în
`<memorie>/conversations/` (`.agent/conversations`), iar agentul îl caută: „ce am discutat despre LAB?” răspunde din
conversațiile salvate, iar o întrebare liberă primește, când e cazul, schimbul anterior apropiat.

Siguranță: serverul ascultă doar pe bucla locală; orice cerere cu `Origin` străin primește 403 (o pagină de pe alt site
nu îl poate folosi), scrierile cer `application/json`, corpurile sunt limitate, iar în afara buclei locale se cere
`CRI_AGENT_TOKEN`. Pagina de pe GitHub Pages se poate conecta la `127.0.0.1` în Chrome și Firefox (adresa se poate schimba
din „Conexiune”); în Safari deschide direct adresa locală.

## AI Assistant hostat pe GitHub (pagina „AI Assistant”)

Un asistent cu model de limbaj (Groq gratuit, rezervă OpenRouter) care folosește unelte: datele radarului, documentația,
memoria proprie, căutare pe internet (Tavily, Exa), citirea paginilor (Jina Reader) și o a doua opinie de la alte modele.
Rulează în workflow-ul unui repo privat (`hosted/radarcry-agent`), pornit din dashboard prin `workflow_dispatch`; memoria
(conversații, cazuri rezolvate, lecții aprobate) stă în `memory/` din acel repo. Fără model, răspunde agentul determinist.

- Cod: `agent/domain/assistant.js` (instrucțiuni, unelte, garduri), `agent/application/assistant.js` (bucla de unelte și
  operațiile chat/patch/delete/feedback/learn/approve), `agent/adapters/llm-openai.js`, `web-search.js`, `cases-fs.js`, `notes-fs.js`.
- Comandă: `ASSIST_OP=chat ASSIST_CONVERSATION=… ASSIST_MESSAGE=… ASSIST_TEXT=… node agent/main.js assist --mem-dir <dir>`.
- Configurare pas cu pas: `hosted/SETUP-RO.md`.
