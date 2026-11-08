# radarcry-agent (privat)

Memoria și workflow-ul AI Assistant-ului din radarcry. Pașii de configurare sunt în `hosted/SETUP-RO.md` din repo-ul public
radarcry. Acest repo trebuie să rămână **privat**: conține conversațiile tale.

- `.github/workflows/assistant.yml` — pornit din dashboard (workflow_dispatch) și săptămânal pentru lecții
- `memory/conversations/` — conversațiile; `memory/index.json` — lista pentru dashboard
- `memory/cases/` — cererile rezolvate (învățarea); `memory/lessons.md` — lecțiile aprobate de tine
- `memory/owner.md` — memoria de pornire despre tine și proiect (o poți edita)
- `scripts/commit-memory.sh` — salvează memoria chiar dacă două rulări se termină în același timp
