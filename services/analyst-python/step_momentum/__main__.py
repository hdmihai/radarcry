"""CLI: python -m step_momentum run [--data data] [--state .state/step-momentum] [--budget-minutes 8] [--synthetic]

Un eșec de rețea iese cu cod 1, ca workflow-ul să republice ultima listă bună.
`--synthetic` nu atinge rețeaua (demo, teste).
"""
from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

import pandas as pd

from .application.publish import write_json
from .application.run import execute, load_rows, synthetic_document
from .adapters.coingecko_sectors import CoinGeckoSectorsClient


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="step_momentum", description="Momentum în trepte — reguli Gate, cercetare radarcry")
    sub = ap.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("--data", default="data")
    run.add_argument("--state", default=".state/step-momentum")
    run.add_argument("--out", default=None)
    run.add_argument("--budget-minutes", type=float, default=8.0)
    run.add_argument("--synthetic", action="store_true")
    args = ap.parse_args(argv)

    data = Path(args.data)
    out = Path(args.out) if args.out else data / "step-momentum.json"
    state = Path(args.state)
    try:
        if args.synthetic:
            doc = synthetic_document()
        else:
            rows = load_rows(data / "universe.json")
            from .adapters.gate import GateStepClient
            doc = execute(
                rows=rows,
                gate=GateStepClient(),
                coingecko=CoinGeckoSectorsClient(),
                now=pd.Timestamp.now(tz="UTC"),
                budget_s=args.budget_minutes * 60,
                cache_dir=state,
            )
    except Exception as err:
        print(f"step_momentum: eșec: {err}", file=sys.stderr)
        traceback.print_exc()
        return 1
    write_json(doc, out)
    state.mkdir(parents=True, exist_ok=True)
    write_json(doc, state / "step-momentum.json")
    meta = doc["stepMomentumMeta"]
    print(
        f"step_momentum: evaluate {meta.get('evaluatedCount', 0)}, "
        f"semnalate {meta.get('signaledCount', 0)}, "
        f"amânate de buget {meta.get('deferredByBudget', 0)} → {out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
