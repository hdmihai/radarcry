#!/usr/bin/env python3
"""
Transportul „spawn” al PythonBridge: o comandă pe proces, JSON pe stdin, JSON pe stdout.

  echo '{"closes":[...]}' | python cli.py series
  python cli.py health

Coduri de ieșire: 0 = ok, 2 = date respinse (validare/analiză), 1 = eroare internă.
Validarea folosește aceleași scheme Pydantic ca serverul FastAPI, deci cele două transporturi
au exact același contract.
"""
from __future__ import annotations

import json
import sys

from pydantic import ValidationError

import analyzer
from schemas import AssetPayload, SeriesPayload, UniversePayload


def run(command: str, body: dict) -> dict:
    if command == "health":
        return {"status": "ok", "service": "radarcry-analyst-python", "version": analyzer.VERSION, "transport": "spawn", "capabilities": ["asset", "universe", "series", "onchain"]}
    if command == "asset":
        return analyzer.analyze_asset(AssetPayload.model_validate(body).model_dump())
    if command == "universe":
        p = UniversePayload.model_validate(body)
        return analyzer.analyze_universe([a.model_dump() for a in p.assets], p.correlationThreshold)
    if command == "series":
        p = SeriesPayload.model_validate(body)
        return analyzer.analyze_series(p.closes, p.volumes, p.periodsPerYear, p.symbol)
    if command == "onchain":
        from adapters.onchain_web3 import Web3OnchainReader

        return Web3OnchainReader().token_facts(str(body.get("chain", "")).lower(), str(body.get("address", "")))
    raise ValueError(f"comandă necunoscută: {command}")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(json.dumps({"detail": "folosire: cli.py <health|asset|universe|series|onchain>"}))
        return 2
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        body = json.loads(raw) if raw.strip() else {}
        out = run(argv[1], body)
    except (ValidationError, analyzer.AnalysisError, ValueError, json.JSONDecodeError) as err:
        print(json.dumps({"detail": str(err)[:1000]}, ensure_ascii=False))
        return 2
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"detail": f"{type(err).__name__}: {err}"[:1000]}, ensure_ascii=False))
        return 1
    sys.stdout.write(json.dumps(out, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
