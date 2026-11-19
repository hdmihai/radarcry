"""Depozit incremental al panelului: un singur fișier parquet (zstd) + meta.json.

În GitHub Actions directorul stă în .state/runners și e salvat pe ramura orfană `cri-state`
împreună cu restul stării radarului — persistență gratuită, fără bază de date.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from ..ports import PANEL_COLUMNS, empty_panel, ensure_columns

NUMERIC = ("open", "high", "low", "close", "volume", "mcap", "oi", "funding", "lsr", "top_lsr", "liq_long", "liq_short")


class ParquetPanelStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.panel_path = self.root / "panel.parquet"
        self.meta_path = self.root / "meta.json"

    def load(self) -> pd.DataFrame:
        if not self.panel_path.exists():
            return empty_panel()
        try:
            df = pd.read_parquet(self.panel_path)
        except Exception:  # fișier corupt — se reconstruiește din surse
            return empty_panel()
        df = ensure_columns(df)
        df["date"] = pd.to_datetime(df["date"], utc=True)
        return df[PANEL_COLUMNS]

    def save(self, panel: pd.DataFrame) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        out = panel[PANEL_COLUMNS].copy()
        for c in NUMERIC:
            out[c] = pd.to_numeric(out[c], errors="coerce").astype("float64")
        out["partial"] = out["partial"].fillna(False).astype(bool)
        tmp = self.root / "panel.parquet.tmp"
        out.to_parquet(tmp, index=False, compression="zstd")
        tmp.replace(self.panel_path)

    def load_meta(self) -> dict:
        try:
            return json.loads(self.meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def save_meta(self, meta: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


def upsert(panel: pd.DataFrame, fresh: pd.DataFrame | None, history_days: int, now: pd.Timestamp | None = None) -> pd.DataFrame:
    """Rândurile noi înlocuiesc rândurile vechi pentru aceeași (key, date); câmpurile de derivate
    pe care sursa nouă nu le are se păstrează din rândul vechi."""
    parts = [p for p in (panel, fresh) if p is not None and not p.empty]
    if not parts:
        return empty_panel()
    fresh = ensure_columns(fresh.copy())[PANEL_COLUMNS] if fresh is not None and not fresh.empty else None
    if fresh is None:
        merged = panel.copy()
    elif panel is None or panel.empty:
        merged = fresh
    else:
        both = pd.concat([panel.assign(_o=0), fresh.assign(_o=1)], ignore_index=True)
        both = both.sort_values(["key", "date", "_o"])
        # completează câmpurile lipsă din rândul nou cu cele din rândul vechi (aceeași zi)
        merged = both.groupby(["key", "date"], as_index=False, sort=False).agg(
            {c: "last" for c in PANEL_COLUMNS if c not in ("key", "date")})
    now = now or pd.Timestamp.now(tz="UTC")
    cutoff = now.normalize() - pd.Timedelta(days=history_days)
    merged = merged[merged["date"] >= cutoff]
    return ensure_columns(merged)[PANEL_COLUMNS].sort_values(["key", "date"]).reset_index(drop=True)
