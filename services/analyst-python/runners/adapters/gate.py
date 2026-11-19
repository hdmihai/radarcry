"""Gate.io API v4 — public, fără cheie. Cea mai bogată sursă gratuită pentru small caps:

  · /spot/candlesticks              până la 1000 lumânări zilnice (≈ 2,7 ani)
  · /futures/usdt/contract_stats    OI USD, long/short (conturi, top traderi), lichidări long/short
  · /futures/usdt/funding_rate      istoric funding la 8h

Documentație: https://www.gate.com/docs/developers/apiv4/
"""
from __future__ import annotations

import time

import numpy as np
import pandas as pd

from .http import HttpClient

BASE = "https://api.gateio.ws/api/v4"


def _day(ts) -> pd.Timestamp:
    return pd.to_datetime(int(float(ts)), unit="s", utc=True).normalize()


class GateMarket:
    def __init__(self, http: HttpClient | None = None):
        self.http = http or HttpClient(rate=8.0)

    # --- listări -------------------------------------------------------------------------
    def spot_pairs(self) -> dict[str, dict]:
        rows = self.http.get_json(f"{BASE}/spot/currency_pairs")
        return {r["id"]: r for r in rows if r.get("quote") == "USDT" and r.get("trade_status") == "tradable"}

    def spot_tickers(self) -> dict[str, float]:
        out = {}
        for r in self.http.get_json(f"{BASE}/spot/tickers"):
            try:
                out[r["currency_pair"]] = float(r.get("last") or "nan")
            except (TypeError, ValueError):
                continue
        return out

    def futures_contracts(self) -> set[str]:
        rows = self.http.get_json(f"{BASE}/futures/usdt/contracts")
        return {r["name"] for r in rows if not r.get("in_delisting")}

    # --- istorice ------------------------------------------------------------------------
    def spot_daily(self, pair: str, limit: int = 1000) -> pd.DataFrame:
        rows = self.http.get_json(f"{BASE}/spot/candlesticks", {"currency_pair": pair, "interval": "1d", "limit": int(min(limit, 1000))})
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows).iloc[:, :8]
        df.columns = ["t", "volume", "close", "high", "low", "open", "base_volume", "closed"]
        out = pd.DataFrame({
            "date": [_day(t) for t in df["t"]],
            "open": df["open"].astype(float), "high": df["high"].astype(float),
            "low": df["low"].astype(float), "close": df["close"].astype(float),
            "volume": df["volume"].astype(float),
            "partial": df["closed"].astype(str).str.lower() != "true",
        })
        return out[out["close"] > 0]

    def futures_daily(self, contract: str, limit: int = 365) -> pd.DataFrame:
        rows = self.http.get_json(f"{BASE}/futures/usdt/contract_stats", {"contract": contract, "interval": "1d", "limit": int(min(limit, 365))})
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows)
        num = lambda c: pd.to_numeric(df.get(c, np.nan), errors="coerce")
        return pd.DataFrame({
            "date": [_day(t) for t in df["time"]],
            "oi": num("open_interest_usd"), "lsr": num("lsr_account"), "top_lsr": num("top_lsr_size"),
            "liq_long": num("long_liq_usd"), "liq_short": num("short_liq_usd"),
        })

    def funding_daily(self, contract: str, limit: int = 1000) -> pd.DataFrame:
        rows = self.http.get_json(f"{BASE}/futures/usdt/funding_rate", {"contract": contract, "limit": int(min(limit, 1000))})
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows)
        df["date"] = [_day(t) for t in df["t"]]
        df["funding"] = pd.to_numeric(df["r"], errors="coerce")
        return df.groupby("date", as_index=False)["funding"].mean()

    def asset_history(self, pair: str, contract: str | None, spot_limit: int, fut_limit: int) -> pd.DataFrame:
        """Spot + (opțional) derivate, unite pe zi. Lipsa derivatelor nu e o eroare."""
        spot = self.spot_daily(pair, spot_limit)
        if spot.empty:
            return spot
        if contract:
            try:
                fut = self.futures_daily(contract, fut_limit)
                if not fut.empty:
                    spot = spot.merge(fut, on="date", how="left")
                fund = self.funding_daily(contract, min(1000, fut_limit * 3))
                if not fund.empty:
                    spot = spot.merge(fund, on="date", how="left")
            except RuntimeError:
                pass
        spot["src"] = "gate"
        return spot


def match_symbol(symbol: str, price: float | None, pairs: dict, tickers: dict, tolerance: float = 0.25) -> str | None:
    """SYM_USDT doar dacă prețul Gate confirmă că e același token (simbolurile se repetă între proiecte)."""
    if not symbol:
        return None
    pair = f"{symbol.upper()}_USDT"
    if pair not in pairs:
        return None
    last = tickers.get(pair)
    if price and price > 0 and last and last > 0:
        if abs(last / price - 1) > tolerance:
            return None
    return pair


def now_s() -> float:
    return time.time()
