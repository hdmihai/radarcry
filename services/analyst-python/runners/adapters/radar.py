"""Intrările publicate de scanerul Node: data/universe.json (orizontul complet de cercetare) și
.state/catalysts.json (evenimente: listări noi, OI_SURGE, KRW_WARNING …)."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

SPOT_NAMES = {"B": "Binance", "M": "MEXC", "G": "Gate", "O": "OKX", "T": "Bitget", "U": "Upbit", "H": "Bithumb"}


def _read(path: Path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return None


class RadarFiles:
    def __init__(self, universe: Path | None, catalysts: Path | None = None):
        self.universe_path = universe
        self.catalysts_path = catalysts

    def assets(self) -> pd.DataFrame:
        doc = _read(self.universe_path) if self.universe_path else None
        table = (doc or {}).get("assets") or {}
        fields, rows = table.get("fields") or [], table.get("rows") or []
        if not fields or not rows:
            return pd.DataFrame(columns=["key", "symbol", "name", "chain", "price", "marketCap", "volume24h", "spotList", "korean", "spotVenues"])
        df = pd.DataFrame(rows, columns=fields)
        spot = df["spot"] if "spot" in df.columns else pd.Series([""] * len(df))
        df["spotList"] = spot.fillna("").astype(str).str.split(",").apply(lambda xs: [x for x in xs if x])
        df["korean"] = df["spotList"].apply(lambda xs: bool({"U", "H"} & set(xs)))
        df["spotVenues"] = df["spotList"].apply(len)
        return df

    def catalysts(self) -> list[dict]:
        doc = _read(self.catalysts_path) if self.catalysts_path else None
        if isinstance(doc, dict):
            doc = doc.get("events") or doc.get("items") or []
        return doc if isinstance(doc, list) else []
