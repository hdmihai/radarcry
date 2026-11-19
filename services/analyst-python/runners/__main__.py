"""CLI:  python -m runners run [--data data] [--state .state/runners] [--config config/runners.json]
                              [--budget-minutes 8] [--offline] [--synthetic]
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import pandas as pd

from .adapters.radar import RadarFiles
from .adapters.store import ParquetPanelStore
from .application.pipeline import Settings, analyze, refresh, write_json


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="runners", description="Potențiali runneri pe 7 zile — cercetare Python pentru radarcry")
    sub = ap.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("--data", default="data")
    run.add_argument("--state", default=".state/runners")
    run.add_argument("--catalysts", default=".state/catalysts.json")
    run.add_argument("--config", default="config/runners.json")
    run.add_argument("--out", default=None)
    run.add_argument("--budget-minutes", type=float, default=8.0)
    run.add_argument("--offline", action="store_true", help="fără rețea: doar istoricul salvat")
    run.add_argument("--synthetic", action="store_true", help="piață sintetică (demo/teste)")
    a = ap.parse_args(argv)

    data = Path(a.data)
    out = Path(a.out) if a.out else data / "runners.json"
    settings = Settings.load(Path(a.config))
    store = ParquetPanelStore(Path(a.state))
    now = pd.Timestamp.now(tz="UTC")
    if a.synthetic:
        from .adapters.synthetic import synthetic_panel
        panel, assets = synthetic_panel(end=now)
        catalysts, stats = [], {"mode": "synthetic"}
        sources = {"mode": "synthetic"}
    else:
        radar = RadarFiles(data / "universe.json", Path(a.catalysts))
        assets, catalysts = radar.assets(), radar.catalysts()
        panel = store.load()
        stats = {"mode": "offline"}
        if not a.offline:
            from .adapters.coingecko import CoinGeckoHistory
            from .adapters.gate import GateMarket
            cg = CoinGeckoHistory()
            panel, stats = refresh(panel, assets, settings, GateMarket(), cg, store, a.budget_minutes * 60, now)
            stats["coingeckoKey"] = bool(cg.api_key)
            store.save(panel)
            meta = store.load_meta()
            meta.update({"lastRefresh": now.isoformat(), "lastStats": stats})
            store.save_meta(meta)
        sources = {"mode": "live" if not a.offline else "offline", "refresh": stats,
                   "providers": ["Gate.io API v4 (spot, futures stats, funding) — fără cheie",
                                 "CoinGecko market_chart — fallback (cheie Demo opțională)",
                                 "radarcry universe.json + catalysts.json"]}
    print(f"runners: panel {len(panel)} rânduri, {panel['key'].nunique() if len(panel) else 0} active · {stats}")
    doc = analyze(panel, assets, catalysts, settings, now, sources)
    write_json(doc, out)
    if not a.synthetic:
        Path(a.state).mkdir(parents=True, exist_ok=True)
        shutil.copyfile(out, Path(a.state) / "runners.json")
    m = doc.get("metrics", {})
    print(f"runners: {len(doc['candidates'])} candidați · AUC OOS {m.get('auc')} · PR-AUC {m.get('prAuc')} · "
          f"precizie@10 {m.get('precisionAt10')} · bază {m.get('baseRate')} · {len(doc['rules'])} reguli → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
