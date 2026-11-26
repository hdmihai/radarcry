"""RadarCry research runner.

Reads:  data/latest.json
Writes: data/research/{momentum,liquidity}.json

Usage: PYTHONPATH=services/analyst-python python -m research [root]
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

from .momentum import compute_momentum
from .liquidity import compute_liquidity


def main(root: str = ".") -> int:
    root_p = Path(root)
    latest = root_p / "data" / "latest.json"
    if not latest.exists():
        print(f"[research] SKIP: {latest} missing", file=sys.stderr)
        return 0

    with latest.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    rows = payload.get("discovery", {}).get("rows", []) or []
    futures_rows = payload.get("futures", {}).get("rows", []) or []
    squeeze_list = payload.get("derivatives", {}).get("squeezeWatch", []) or []
    squeeze_by_sym = {s.get("symbol"): s for s in squeeze_list if s.get("symbol")}

    meta = {
        "schemaVersion": payload.get("schemaVersion"),
        "discoveryCount": len(rows),
        "futuresCount": len(futures_rows),
        "squeezeCount": len(squeeze_list),
    }

    momentum = compute_momentum(rows, squeeze_by_symbol=squeeze_by_sym)
    liquidity = compute_liquidity(rows, futures_rows, squeeze_by_sym)

    out_dir = root_p / "data" / "research"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "momentum.json").write_text(
        json.dumps({"meta": meta, "features": momentum}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (out_dir / "liquidity.json").write_text(
        json.dumps({"meta": meta, **liquidity}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    _summarize(meta, momentum, liquidity)
    return 0


def _summarize(meta, momentum, liquidity) -> None:
    n = len(momentum)
    if n == 0:
        print("[research] 0 coins — nothing computed")
        return
    outp = sum(1 for v in momentum.values() if v["outperformance7d"] is not None)
    comp = sum(1 for v in momentum.values() if v["momentumComposite"] is not None)
    bkind = next(iter(momentum.values())).get("benchmark") if momentum else None

    fd = liquidity.get("discovery", {})
    ff = liquidity.get("futures", {})
    agree_d = sum(1 for v in fd.values() if v["agreement"] is not None)
    agree_f = sum(1 for v in ff.values() if v["agreement"] is not None)

    print(f"[research] discovery={n} outperf7d={outp} comp={comp} benchmark={bkind}")
    print(f"[research] liquidity discovery={len(fd)} (agree={agree_d}) | futures={len(ff)} (agree={agree_f})")
    print("[research] wrote data/research/{momentum,liquidity}.json")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "."))
