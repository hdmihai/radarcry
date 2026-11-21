"""Adaptor pentru API-ul CoinGecko (categorii/sectoare)."""
import requests
import logging

log = logging.getLogger(__name__)

class CoinGeckoSectorsClient:
    def __init__(self, base_url="https://api.coingecko.com/api/v3"):
        self.base_url = base_url

    def build_sector_map(self, category_ids):
        """Returnează un dicționar {symbol: [sector1, sector2]}."""
        sector_map = {}
        for category in category_ids:
            try:
                res = requests.get(
                    f"{self.base_url}/coins/markets",
                    params={"vs_currency": "usd", "category": category, "per_page": 250, "page": 1},
                    timeout=30
                )
                if res.status_code != 200:
                    log.warning(f"CoinGecko API {res.status_code} pentru categoria {category}")
                    continue
                for coin in res.json():
                    symbol = coin["symbol"].upper()
                    if symbol not in sector_map:
                        sector_map[symbol] = []
                    if category not in sector_map[symbol]:
                        sector_map[symbol].append(category)
            except Exception as e:
                log.warning(f"Eroare la categoria {category}: {e}")
        return sector_map
