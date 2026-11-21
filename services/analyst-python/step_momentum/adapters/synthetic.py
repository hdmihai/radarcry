"""O piață mică, deterministă, pentru demo și pentru testul de contract — fără rețea."""
from __future__ import annotations

import pandas as pd

from ..domain.rules import compute_step_momentum


def _index(n, end):
    return pd.date_range(end - pd.Timedelta(hours=n - 1), periods=n, freq="1h", tz="UTC")


def passing_market(end: pd.Timestamp, n: int = 500):
    """Token care îndeplinește toate cele 7 condiții față de un BTC pe minus."""
    idx = _index(n, end)
    close = [100.0] * n
    # 20 de zile de minim la 80, apoi urcare monotonă pe ultima săptămână până la 100.
    for i in range(300, 332):
        close[i] = 80.0
    span = n - 332
    for i in range(332, n):
        close[i] = 80.0 + 20.0 * (i - 331) / span
    volume = [100.0] * n
    for i in range(n - 24, n):
        volume[i] = 200.0
    token = pd.DataFrame({
        "open": close, "high": [c * 1.01 for c in close], "low": close, "close": close, "volume": volume,
    }, index=idx)
    btc_close = [100.0] * n
    for i in range(n - 168, n):
        btc_close[i] = 100.0 - 10.0 * (i - (n - 169)) / 168
    market = pd.DataFrame({"close": btc_close}, index=idx)
    oi_idx = idx[-400:]
    oi = pd.DataFrame({
        "open_interest_usd": [100.0] * 400,
        "lsr_taker": [1.1] * 400,
    }, index=oi_idx)
    oi.iloc[-1, oi.columns.get_loc("open_interest_usd")] = 140.0
    return token, market, oi


def failing_market(end: pd.Timestamp, n: int = 500):
    idx = _index(n, end)
    close = [100.0] * n
    token = pd.DataFrame({
        "open": close, "high": close, "low": close, "close": close, "volume": [100.0] * n,
    }, index=idx)
    market = pd.DataFrame({"close": [100.0] * n}, index=idx)
    return token, market


def build_rows(end: pd.Timestamp):
    good, market, oi = passing_market(end)
    bad, _ = failing_market(end)
    rows = []
    for symbol, candles, stats, fut in (
        ("GOOD", good, oi, False),
        ("FLAT", bad, None, False),
    ):
        result = compute_step_momentum(
            candles, futures_stats=stats, market1h=market,
            price_source="synthetic",
        )
        rows.append((symbol, result, fut))
    return market, rows
