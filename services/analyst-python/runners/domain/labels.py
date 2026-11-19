"""Etichete (viitorul) — folosite doar pentru învățare și evaluare, niciodată ca factori.

  fwd_max_7    = max(high[t+1 … t+H]) / close[t] − 1    (cât de sus a ajuns în următoarele H zile)
  fwd_close_7  = close[t+H] / close[t] − 1
  y            = fwd_max_7 ≥ ţintă   (implicit +50% în 7 zile — „runner”)
  run_start    = prima zi y=1 după ≥ H zile fără y=1 (ziua de dinaintea aprinderii)
  jump         = ret_1d ≥ prag (implicit +25% de pe o zi pe alta)
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def add_labels(feats: pd.DataFrame, horizon: int = 7, target: float = 0.5, jump: float = 0.25) -> pd.DataFrame:
    df = feats.sort_values(["key", "date"]).reset_index(drop=True)
    closed_high = df["high"].where(~df["partial"])
    closed_close = df["close"].where(~df["partial"])

    def fwd_max(s: pd.Series) -> pd.Series:
        r = s[::-1].rolling(horizon, min_periods=horizon).max()[::-1]
        return r.shift(-1)

    df["fwd_max"] = closed_high.groupby(df["key"]).transform(fwd_max) / df["close"] - 1
    df["fwd_close"] = closed_close.groupby(df["key"]).shift(-horizon) / df["close"] - 1
    labeled = df["fwd_max"].notna() & ~df["partial"]
    df["labeled"] = labeled
    df["y"] = np.where(labeled, (df["fwd_max"] >= target).astype(float), np.nan)
    prev_any = df.groupby("key")["y"].transform(lambda s: s.fillna(0).shift(1).rolling(horizon, min_periods=1).max())
    df["run_start"] = (df["y"] == 1) & (prev_any.fillna(0) == 0)
    df["jump"] = df["ret_1d"] >= jump
    return df


def events(df: pd.DataFrame, horizon: int = 7) -> pd.DataFrame:
    """Ziua dinaintea fiecărei aprinderi + câștigul maxim realizat după."""
    ev = df[df["run_start"]].copy()
    ev["gain"] = ev["fwd_max"]
    return ev
