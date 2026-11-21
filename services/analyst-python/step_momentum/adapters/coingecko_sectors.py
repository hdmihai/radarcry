"""CoinGecko API v3 — categorii/sectoare. Doar citire, fără cheie.

Folosește HttpClient-ul proiectului (runners.adapters.http), la fel ca gate.py:
zero dependențe externe, rate limiting integrat, retry pe 429.
"""
from __future__ import annotations

from runners.adapters.http import HttpClient

BASE = "https://api.coingecko.com/api/v3"


class CoinGeckoSectorsClient:
    def __init__(self, http: HttpClient | None = None):
        # CoinGecko demo: ~30 req/min; 2 req/s e sigur.
        self.http = http or HttpClient(rate=2.0, timeout=25.0)

    def _get(self, path, params):
        try:
            return self.http.get_json(f"{BASE}{path}", params)
        except RuntimeError:
            return None

    def build_sector_map(self, category_ids):
        """{symbol: [categorie, ...]} — CoinGecko categories → symbol → listă."""
        sector_map: dict[str, list[str]] = {}
        for category in category_ids:
            rows = self._get("/coins/markets", {
                "vs_currency": "usd",
                "category": category,
                "per_page": 250,
                "page": 1,
            })
            if not isinstance(rows, list):
                continue
            for coin in rows:
                symbol = str(coin.get("symbol") or "").upper()
                if not symbol:
                    continue
                bucket = sector_map.setdefault(symbol, [])
                if category not in bucket:
                    bucket.append(category)
        return sector_map
