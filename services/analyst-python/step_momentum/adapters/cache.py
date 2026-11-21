"""Cache local de lumânări (Parquet), ca rerularea la 4 ore să ceară doar bara nouă."""
from __future__ import annotations

from pathlib import Path

import pandas as pd


def read_candles(path: Path) -> pd.DataFrame | None:
    if not path.exists():
        return None
    try:
        df = pd.read_parquet(path)
    except (OSError, ValueError):
        return None
    df.index = pd.to_datetime(df.index, utc=True)
    return df.sort_index()


def write_candles(path: Path, frame: pd.DataFrame) -> None:
    if frame is None or len(frame) == 0:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.sort_index().to_parquet(path)
