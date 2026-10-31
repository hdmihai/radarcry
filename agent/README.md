# Agentul AI de calitate

Modul separat al CRI Radar: monitorizează gratuit toate porțile de calitate ale proiectului și învață
din istoricul lui. Nu importă nimic din `src/` (un test de arhitectură o verifică) — citește doar ce
publică scannerul (ramura `cri-state`), ce înregistrează GitHub (rulări, joburi, adnotări, deploy-uri)
și prețurile publice CoinGecko, fără cheie.

```
domain/        pur, determinist: porți, cron și cadență, norme robuste, incidente și remedieri,
               calibrarea prognozei, eficiență, auto-reparare, narațiune și gardă
application/   observe → learn → analyze / narrate / act, prin porturi
adapters/      API GitHub, fișiere de stare și memorie, Pages, prețuri publice, Ollama local, simulator
main.js        rădăcina de compoziție
config.json    praguri, limite de auto-reparare, model, calibrare
```

## Rulare

```bash
npm run agent:demo                       # pe istoricul simulat → data/agent.json (fără rețea)
GITHUB_REPOSITORY=owner/repo npm run agent   # pe repository-ul real, doar citire fără token
node agent/main.js analyze --memory .agent --state .state --out .agent/report
node agent/main.js narrate --memory .agent --out .agent/report   # cu Ollama pe 127.0.0.1:11434
node agent/main.js act --memory .agent --out .agent/report --dry-run
```

În GitHub Actions rulează din `.github/workflows/agent.yml` după fiecare CI, scanare, sondă și
actualizare de etichete, plus orar; memoria și raportul se salvează pe ramura `cri-agent`, iar
scanarea și pulsul publică raportul în ecranul **Agent AI** al dashboard-ului.

## Ce poate face și ce nu

- Citește: rulările workflow-urilor, joburile, adnotările CI (raportul porților), deploy-urile Pages,
  snapshot-ul publicat, prețurile publice.
- Scrie: `workflow_dispatch` pentru o scanare sau un puls sărit de GitHub (cel mult 4 / 8 pe 24 h,
  niciodată după două eșecuri la rând sau peste 85 % din cota unui plan gratuit) și o singură problemă
  GitHub cât timp există porți serioase sau critice eșuate.
- Nu poate: anula, șterge, relua cu alți parametri, face merge, modifica cod sau conținut.

Variabile opționale (Settings → Secrets and variables → Actions → Variables): `CRI_AGENT_LLM=off`,
`CRI_AGENT_MODEL` (implicit `qwen2.5:3b`), `CRI_AGENT_HEAL=off`, `CRI_AGENT_ISSUES=off`,
`CRI_AGENT_NARRATE=always|never`.
