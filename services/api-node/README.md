# radarcry · api-node

Gateway Express peste contractul publicat de scanner (`data/latest.json`), cu analiza cantitativă
delegată microserviciului Python prin `PythonBridge`. Arhitectură hexagonală, verificată de
`test/architecture.test.js`.

```
src/
  domain/          radar.js (proiecție, filtre, sortare, payload pentru Python), errors.js — pur
  ports/           SnapshotPort · AnalystPort · CachePort · ClockPort + assertPort()
  application/     use-cases.js — orchestrează porturile, cache per rulare (runId)
  routes/          adaptorul de intrare HTTP: /api/radar, /api/analysis, /api/health
  middleware/      request id, CORS allow-list, rate limit, maparea erorilor de domeniu → HTTP
  services/        adaptoarele de ieșire:
                     PythonBridge.js        AnalystPort — http (FastAPI) sau spawn (cli.py)
                     SnapshotRepository.js  SnapshotPort — fișier local sau GitHub Pages
                     MemoryCache.js         CachePort — LRU cu TTL
  app.js           fabrica Express (primește use-case-urile gata cablate)
  config.js        singurul loc care citește process.env
  server.js        rădăcina de compoziție
```

Regula dependențelor: `domain → domain`, `application → domain + ports`, `routes → express`,
`services → domain + node:*`. Doar `server.js` le cunoaște pe toate.

## PythonBridge

| Mod | Când | Cum |
|---|---|---|
| `http` (implicit) | Docker, server | `fetch` JSON către `ANALYST_URL`, timeout per apel |
| `spawn` | GitHub Actions, laptop fără server Python | `python cli.py <comandă>`, JSON pe stdin/stdout; cod 2 = date respinse |

Reziliența stă în adaptor, nu în nucleu: reîncercări cu backoff pe erori tranzitorii (rețea, 502/503/504,
timeout), circuit breaker (`breakerThreshold` eșecuri → deschis `breakerCooldownMs`), iar erorile
analistului devin erori de domeniu (`INVALID_INPUT` → 400, `UPSTREAM` → 502, `UNAVAILABLE` → 503).

## Configurare

| Variabilă | Implicit |
|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` |
| `SNAPSHOT_SOURCE` | `<repo>/data/latest.json` dacă există, altfel `https://hdmihai.github.io/radarcry/data/latest.json` |
| `SNAPSHOT_TTL_MS` | `300000` (doar sursa HTTP) |
| `ANALYST_MODE` | `http` (sau `spawn`) |
| `ANALYST_URL` | `http://127.0.0.1:8000` |
| `ANALYST_TIMEOUT_MS` / `ANALYST_RETRIES` | `15000` / `2` |
| `PYTHON_BIN` | `python3` (modul spawn) |
| `CORS_ORIGINS` | `https://hdmihai.github.io` + previzualizări locale |
| `SERVE_FRONTEND` | `1` = servește și `frontend/` + `/data` (un singur origin, fără CORS) |
| `RATE_LIMIT_PER_MINUTE` | `120` |
| `TRUST_PROXY` | `0` |

## Rulare și teste

```bash
npm ci
npm start                                    # sau: npm run dev (watch)
npm test                                     # 34 de teste; integrarea reală se sare fără Python
ANALYST_PYTHON=$(which python) npm test      # + integrarea scanner → api-node → Python (35)
```

Exemple:

```bash
curl 'localhost:3000/api/radar?chain=bsc&minScore=60&sort=forecast20&limit=10'
curl 'localhost:3000/api/analysis/cg:zarlum-chain-987'
curl 'localhost:3000/api/analysis/universe?stage=BUILDING'
curl -X POST localhost:3000/api/analysis/series -H 'content-type: application/json' -d '{"closes":[1,1.1,1.05,1.2,1.25,1.3,1.28,1.4,1.5,1.45,1.6]}'
curl 'localhost:3000/api/analysis/onchain/bsc/0x55d398326f99059fF775485246999027B3197955'
```

Dashboard-ul de pe GitHub Pages folosește API-ul doar dacă îl configurezi: `?api=https://api-ul-tau`
în URL (se ține minte; `?api=off` îl uită) sau `<meta name="cri-api" content="https://…">` în
`frontend/index.html`. Adaugă originea paginii în `CORS_ORIGINS`.
