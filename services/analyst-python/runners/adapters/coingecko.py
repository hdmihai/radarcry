"""CoinGecko — fallback pentru activele care nu au pereche pe Gate.

Fără cheie merge (limită mică, ~5–15 cereri/min); cu o cheie Demo gratuită
(COINGECKO_DEMO_API_KEY) limita urcă la 30/min și 10.000/lună. Date: preț de închidere,
volum total, market cap — zilnic, 365 de zile (high/low nu există în acest endpoint, deci
se aproximează cu închiderea, iar factorii care cer high/low devin mai conservatori).
"""
from __future__ import annotations

import os

import pandas as pd

from .http import HttpClient

BASE = "https://api.coingecko.com/api/v3"


class CoinGeckoHistory:
    def __init__(self, api_key: str | None = None, http: HttpClient | None = None):
        self.api_key = api_key if api_key is not None else (os.environ.get("COINGECKO_DEMO_API_KEY") or "")
        headers = {"x-cg-demo-api-key": self.api_key} if self.api_key else {}
        self.http = http or HttpClient(rate=0.45 if self.api_key else 0.2, retries=2, headers=headers)

    @property
    def budget(self) -> int:
        return 120 if self.api_key else 18

    def daily(self, coin_id: str, days: int = 365) -> pd.DataFrame:
        doc = self.http.get_json(f"{BASE}/coins/{coin_id}/market_chart", {"vs_currency": "usd", "days": int(days), "interval": "daily"})
        prices = doc.get("prices") or []
        if not prices:
            return pd.DataFrame()
        df = pd.DataFrame(prices, columns=["ms", "close"])
        df["volume"] = pd.DataFrame(doc.get("total_volumes") or [[0, None]] * len(df)).iloc[:, 1].values[: len(df)]
        df["mcap"] = pd.DataFrame(doc.get("market_caps") or [[0, None]] * len(df)).iloc[:, 1].values[: len(df)]
        df["date"] = pd.to_datetime(df["ms"], unit="ms", utc=True).dt.normalize()
        df = df.drop_duplicates("date", keep="last")
        today = pd.Timestamp.now(tz="UTC").normalize()
        df["partial"] = df["date"] >= today
        df["open"] = df["close"].shift(1).fillna(df["close"])
        df["high"] = df[["open", "close"]].max(axis=1)
        df["low"] = df[["open", "close"]].min(axis=1)
        df["src"] = "cg"
        return df[["date", "open", "high", "low", "close", "volume", "mcap", "partial", "src"]]
