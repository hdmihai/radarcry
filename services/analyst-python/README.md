# radarcry · analyst-python

Microserviciu FastAPI pentru analiza cantitativă (Pandas, NumPy) și on-chain (Web3) a proiectelor
din radarul CRI. Este apelat de `services/api-node` prin `PythonBridge`, pe HTTP sau prin `cli.py`.

```
analyzer.py              domeniul: metrici, verdict cantitativ, analiză transversală — pur
ports.py                 OnchainPort (Protocol) + OnchainUnavailable
adapters/onchain_web3.py OnchainPort prin Web3.py pe RPC public PublicNode (fără cheie, doar citire)
schemas.py               contractul HTTP (Pydantic) — oglinda lui analystPayload din api-node
main.py                  adaptorul de intrare HTTP (FastAPI), create_app(onchain=…) pentru teste
cli.py                   transportul spawn: aceleași scheme, JSON pe stdin/stdout
tests/                   pytest: domeniu, puritate, HTTP, paritate cli ↔ http
```

## Ce calculează

Pe seria zilnică (90 de zile) când există, altfel 4H sau sparkline; volumul și ATR se iau din 4H
când seria zilnică are doar prețul de închidere (fiecare câmp spune sursa).

- randament 7/30/total, volatilitate anualizată și downside, Sharpe, Sortino
- VaR și CVaR 95% istorice, skew, kurtosis, drawdown maxim și curent
- tendință: pantă pe log(preț) și R², RSI 14, exponent Hurst
- comprimare: lățimea Bollinger și percentila ei istorică
- participare: volum recent ca z-scor robust (median/MAD), raport 7/30, pantă OBV
- ATR 14 %, poziția în range-ul pe 30 de perioade, turnover, FDV/MC
- `scoreAlignment`: corelația Spearman între schimbările scorului CRI și ale prețului
- universul: z-scoruri robuste și percentile transversale, clustere de corelație (componente
  conexe peste prag, fără SciPy), beta față de media echiponderată

**Scorul cantitativ** (0–100) = 30% tendință + 25% structură + 25% participare + 20% risc, ponderi
fixe. Familia fără date intră neutră (0,5) și scade încrederea. Este complementar scorului CRI.

## Rulare

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn main:app --reload --port 8000        # documentație: http://127.0.0.1:8000/docs
python -m pytest -q                          # 21 de teste
echo '{"closes":[1,1.1,1.05,1.2,1.25,1.3,1.28,1.4,1.5,1.45,1.6]}' | python cli.py series
```

Noduri RPC proprii (opțional): `RPC_ETHEREUM`, `RPC_BSC`, `RPC_BASE`, `RPC_ARBITRUM`, `RPC_POLYGON`,
`RPC_OPTIMISM`, `RPC_AVALANCHE`; timeout `RPC_TIMEOUT_S` (8). Adaptorul nu are nicio metodă care
semnează sau trimite tranzacții.

## Potențiali runneri (Top 7 zile)

Modulul `runners/` învață, din istoricul zilnic al tuturor tokenilor, ce factori apar înaintea unei creșteri de ≥ +50% în următoarele 7 zile (tipul EVAA, IRYS, BR) și scorează tokenii de azi.

```bash
pip install -r requirements-runners.txt
PYTHONPATH=. python -m runners run --data ../../data --state ../../.state/runners \
  --catalysts ../../.state/catalysts.json --config ../../config/runners.json --budget-minutes 8
python -m runners run --synthetic   # date sintetice, fără rețea
python -m runners run --offline     # doar panelul local
```

Arhitectură hexagonală: `domain/` (features fără look-ahead, etichete, factori Mann-Whitney + FDR, reguli tip skope-rules, LightGBM cu walk-forward purge + embargo și calibrare izotonică, TreeSHAP, similaritate cu referințele), `application/pipeline.py` (refresh incremental + analiză), `adapters/` (Gate.io public, CoinGecko keyless/Demo, fișierele radarului, panel Parquet).

Ieșire: `data/runners.json` (schema `schema/runners.schema.json`), servit de `GET /api/runners` și afișat în ecranul „Top 7 zile”. Rulat în GitHub Actions la fiecare 4 ore, cu starea păstrată pe ramura `cri-state`. Cheie opțională: `COINGECKO_DEMO_API_KEY`.

## Momentum în trepte

Modulul `step_momentum/` este un ecran de **reguli**, nu un al doilea LightGBM. Șapte condiții pe lumânări de 1h (structura confirmată și pe 4h) pentru proiectele deja verificate din `data/universe.json`, identificate pe Gate după preț. O condiție fără date rămâne necunoscută și iese din ponderare. Semnalul cere cel puțin 4 condiții măsurate și o fracție de îndeplinire ≥ 5/7.

```bash
pip install -r requirements-runners.txt
PYTHONPATH=. python -m step_momentum run --data ../../data --state ../../.state/step-momentum --budget-minutes 8
PYTHONPATH=. python -m step_momentum run --synthetic
```

Ieșire: `data/step-momentum.json` (schema `schema/step-momentum.schema.json`), `GET /api/step-momentum`, ecranul „Momentum în trepte”. Nu măsoară lift și nu înlocuiește `runners/`.
