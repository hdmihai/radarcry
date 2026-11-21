"""Gate.io API v4 — doar citire, endpoint-uri publice de piață. Fără ordine, fără cheie.

Lumânările spot sunt liste [t, volum quote, close, high, low, open, volum bază, închis].
Lumânările de perpetuu sunt obiecte {t, o, h, l, c, v, sum}. Aceeași formă internă.
"""
from __future__ import annotations

import pandas as pd

from runners.adapters.http import HttpClient

BASE = "https://api.gateio.ws/api/v4"


def _ts(value) -> pd.Timestamp:
    return pd.to_datetime(int(float(value)), unit="s", utc=True)


def parse_spot_rows(rows) -> pd.DataFrame:
    recs = []
    for row in rows or []:
        if not isinstance(row, (list, tuple)) or len(row) < 6:
            continue
        closed = True if len(row) < 8 else str(row[7]).lower() == "true"
        recs.append({
            "datetime": _ts(row[0]),
            "open": float(row[5]),
            "high": float(row[3]),
            "low": float(row[4]),
            "close": float(row[2]),
            "volume": float(row[1]),
            "closed": closed,
        })
    return _frame(recs)


def parse_futures_rows(rows) -> pd.DataFrame:
    recs = []
    for row in rows or []:
        if isinstance(row, dict):
            recs.append({
                "datetime": _ts(row["t"]),
                "open": float(row["o"]),
                "high": float(row["h"]),
                "low": float(row["l"]),
                "close": float(row["c"]),
                "volume": float(row.get("v") or 0),
                "closed": True,
            })
        elif isinstance(row, (list, tuple)) and len(row) >= 6:
            # același ordin ca la spot, dacă API-ul răspunde cu listă
            recs.append({
                "datetime": _ts(row[0]),
                "open": float(row[5]),
                "high": float(row[3]),
                "low": float(row[4]),
                "close": float(row[2]),
                "volume": float(row[1]),
                "closed": True,
            })
    return _frame(recs)


def parse_contract_stats(rows) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    frame = pd.DataFrame(rows)
    if "time" not in frame or "open_interest_usd" not in frame:
        return pd.DataFrame()
    frame["datetime"] = pd.to_datetime(pd.to_numeric(frame["time"], errors="coerce"), unit="s", utc=True)
    oi = pd.to_numeric(frame["open_interest_usd"], errors="coerce").to_numpy()
    lsr = pd.to_numeric(frame["lsr_taker"], errors="coerce").to_numpy() if "lsr_taker" in frame else float("nan")
    out = pd.DataFrame({
        "open_interest_usd": oi,
        "lsr_taker": lsr,
    }, index=pd.DatetimeIndex(frame["datetime"]))
    out = out[out.index.notna()]
    return out.groupby(level=0).last().sort_index()


def _frame(recs) -> pd.DataFrame:
    if not recs:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    df = pd.DataFrame(recs).dropna(subset=["datetime"]).sort_values("datetime")
    df = df[df["closed"]].drop(columns=["closed"])
    df = df.drop_duplicates("datetime", keep="last").set_index("datetime")
    df = df[(df["close"] > 0) & (df["low"] > 0)]
    return df[["open", "high", "low", "close", "volume"]]


class GateStepClient:
    def __init__(self, http: HttpClient | None = None):
        self.http = http or HttpClient(rate=6.0, timeout=25.0)

    def _get(self, path, params):
        try:
            return self.http.get_json(f"{BASE}{path}", params)
        except RuntimeError:
            return None

    def spot_last(self) -> dict[str, float]:
        rows = self._get("/spot/tickers", None)
        if rows is None:
            raise RuntimeError("Gate spot tickers indisponibil")
        out = {}
        for row in rows:
            pair = row.get("currency_pair")
            if not pair or not str(pair).endswith("_USDT"):
                continue
            try:
                out[pair] = float(row.get("last"))
            except (TypeError, ValueError):
                continue
        return out

    def futures_last(self) -> dict[str, float]:
        rows = self._get("/futures/usdt/contracts", None)
        if rows is None:
            raise RuntimeError("Gate futures contracts indisponibil")
        out = {}
        for row in rows:
            if row.get("in_delisting") or row.get("status") not in (None, "trading"):
                continue
            name = row.get("name")
            if not name or not str(name).endswith("_USDT"):
                continue
            try:
                out[name] = float(row.get("last_price"))
            except (TypeError, ValueError):
                continue
        return out

    def hourly(self, market: str, instrument: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
        rows = []
        cursor = int(start.timestamp())
        end_s = int(end.timestamp())
        while cursor < end_s:
            stop = min(cursor + 900 * 3600, end_s)
            if market == "spot":
                page = self._get("/spot/candlesticks", {
                    "currency_pair": instrument, "interval": "1h",
                    "from": cursor, "to": stop, "limit": 1000,
                })
            else:
                page = self._get("/futures/usdt/candlesticks", {
                    "contract": instrument, "interval": "1h",
                    "from": cursor, "to": stop,
                })
            if isinstance(page, list) and page:
                rows.extend(page)
            cursor = stop + 1
        frame = parse_spot_rows(rows) if market == "spot" else parse_futures_rows(rows)
        return frame

    def contract_stats(self, contract: str) -> pd.DataFrame:
        # 400 de ore acoperă 14 zile (336h) cu margine. limit=336 nu ajunge: variația
        # are nevoie de un punct *înainte* de fereastră.
        rows = self._get("/futures/usdt/contract_stats", {"contract": contract, "interval": "1h", "limit": 400})
        return parse_contract_stats(rows if isinstance(rows, list) else [])
