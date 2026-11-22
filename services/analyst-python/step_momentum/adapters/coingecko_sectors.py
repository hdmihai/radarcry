"""CoinGecko — apartenența monedelor la sectoare (categorii). Doar citire, fără ordine, fără cont obligatoriu.

`/coins/markets?category=<id>` întoarce monedele categoriei ordonate după capitalizare, câte 250 pe
pagină. Citirea unei categorii se oprește la prima dintre: ultima pagină, o pagină care coboară sub
capitalizarea minimă a universului (mai jos nu mai intră nimic pe ecran), plafonul de pagini sau termenul
primit. Fără cheie merge (limită mică, ~5–15 cereri/min); cu o cheie Demo gratuită
(COINGECKO_DEMO_API_KEY) limita urcă. Clientul HTTP este cel al proiectului (stdlib, reîncercări, backoff
și limitare de rată), ca la Gate: modulul nu are nicio dependență în afara celor din requirements-runners.txt.
"""
from __future__ import annotations

import logging
import os
import time

from runners.adapters.http import HttpClient

log = logging.getLogger(__name__)

BASE = "https://api.coingecko.com/api/v3"
PAGE_SIZE = 250
MAX_PAGES = 6


def _number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


class CoinGeckoSectorsClient:
    def __init__(self, http: HttpClient | None = None, api_key: str | None = None, base_url: str = BASE):
        key = api_key if api_key is not None else (os.environ.get("COINGECKO_DEMO_API_KEY") or "")
        headers = {"x-cg-demo-api-key": key} if key else {}
        self.http = http or HttpClient(rate=0.45 if key else 0.2, retries=2, headers=headers)
        self.base_url = base_url.rstrip("/")

    def fetch_members(self, categories, *, min_market_cap: float = 0.0, deadline: float | None = None, max_pages: int = MAX_PAGES) -> dict:
        """→ {"members": [{"id", "sector"}, …], "loaded": [categorie, …], "failed": [categorie, …]}.

        O categorie este `loaded` dacă a întors măcar o pagină cu monede și `failed` altfel (eroare de
        rețea, id necunoscut, termen expirat). Nu ridică excepții: sectoarele sunt un adaos, iar un
        sector necunoscut nu este un sector fals. `deadline` este un moment `time.monotonic()`.
        """
        members: list[dict] = []
        loaded: list[str] = []
        failed: list[str] = []
        for category in categories:
            pages = self._read_category(category, members, float(min_market_cap or 0.0), deadline, max_pages)
            (loaded if pages else failed).append(category)
        return {"members": members, "loaded": loaded, "failed": failed}

    def _read_category(self, category: str, members: list[dict], min_market_cap: float, deadline: float | None, max_pages: int) -> int:
        pages = 0
        for page in range(1, max(1, int(max_pages)) + 1):
            if deadline is not None and time.monotonic() > deadline:
                log.warning("CoinGecko %s: termenul a expirat înainte de pagina %d", category, page)
                break
            try:
                rows = self.http.get_json(f"{self.base_url}/coins/markets", {
                    "vs_currency": "usd",
                    "category": category,
                    "order": "market_cap_desc",
                    "per_page": PAGE_SIZE,
                    "page": page,
                    "sparkline": "false",
                })
            except Exception as err:  # noqa: BLE001 — granița cu rețeaua: orice eșec lasă sectorul necunoscut
                log.warning("CoinGecko %s, pagina %d: %s", category, page, err)
                break
            if not isinstance(rows, list) or not rows:
                if page == 1:
                    log.warning("CoinGecko %s: categorie goală sau necunoscută", category)
                break
            pages += 1
            for coin in rows:
                coin_id = coin.get("id") if isinstance(coin, dict) else None
                if coin_id:
                    members.append({"id": str(coin_id), "sector": category})
            tail = _number(rows[-1].get("market_cap")) if isinstance(rows[-1], dict) else None
            if len(rows) < PAGE_SIZE or tail is None or tail < min_market_cap:
                break
        return pages
