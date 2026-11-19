"""Porturi (contracte) — ce cere aplicația de la lumea exterioară.

Domeniul lucrează cu un singur tip de date: *panelul zilnic*, un DataFrame lung cu coloanele

    key, date (UTC, zi), open, high, low, close, volume (USD), mcap (USD, poate lipsi),
    oi (USD), funding (rată medie / 8h), lsr (long/short conturi), top_lsr (top traderi, mărime),
    liq_long, liq_short (USD lichidați), partial (bool: lumânarea zilei în curs), src

Orice sursă care produce acest panel poate înlocui adaptoarele existente.
"""
from __future__ import annotations

from typing import Protocol, Iterable

import pandas as pd

PANEL_COLUMNS = [
    "key", "date", "open", "high", "low", "close", "volume", "mcap",
    "oi", "funding", "lsr", "top_lsr", "liq_long", "liq_short", "partial", "src",
]


class MarketHistoryPort(Protocol):
    """Lumânări zilnice spot (+ derivate opțional) pentru un activ."""

    def spot_daily(self, pair: str, limit: int) -> pd.DataFrame: ...
    def futures_daily(self, contract: str, limit: int) -> pd.DataFrame: ...
    def funding_daily(self, contract: str, limit: int) -> pd.DataFrame: ...


class PanelStorePort(Protocol):
    """Persistență incrementală a panelului între rulări (pe ramura cri-state în GitHub)."""

    def load(self) -> pd.DataFrame: ...
    def save(self, panel: pd.DataFrame) -> None: ...
    def load_meta(self) -> dict: ...
    def save_meta(self, meta: dict) -> None: ...


class RadarInputsPort(Protocol):
    """Universul și evenimentele publicate de scanerul Node."""

    def assets(self) -> pd.DataFrame: ...
    def catalysts(self) -> list[dict]: ...


def empty_panel() -> pd.DataFrame:
    df = pd.DataFrame({c: pd.Series(dtype="float64") for c in PANEL_COLUMNS})
    df["key"] = df["key"].astype("object")
    df["src"] = df["src"].astype("object")
    df["partial"] = df["partial"].astype("bool")
    df["date"] = pd.to_datetime(df["date"], utc=True)
    return df


def ensure_columns(df: pd.DataFrame, cols: Iterable[str] = PANEL_COLUMNS) -> pd.DataFrame:
    for c in cols:
        if c not in df.columns:
            df[c] = False if c == "partial" else (None if c in ("key", "src") else float("nan"))
    return df
