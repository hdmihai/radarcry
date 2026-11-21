"""Cine are voie pe ecranul Momentum în trepte.

Listele CRI nu primesc întreg catalogul Gate. Intră un proiect doar dacă:
  · poarta de validitate l-a verificat (`valid == V`; P și R rămân pe ecranul Validare);
  · capitalizarea este între 1 și 300 milioane $, volumul pe 24h ≥ 500 000 $;
  · perechea Gate (spot sau perpetuu USDT) confirmă identitatea prin preț, nu doar prin simbol.
Două proiecte nu pot împărți aceeași pereche: rămâne potrivirea mai strânsă.
"""
from __future__ import annotations

import math

MCAP_MIN = 1_000_000
MCAP_MAX = 300_000_000
VOL_MIN = 500_000
PRICE_TOLERANCE = 0.25


def _num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _match(symbol, price, lasts, tolerance=PRICE_TOLERANCE):
    """Perechea SYM_USDT doar dacă prețul Gate stă la cel mult `tolerance` de prețul radarului."""
    if not symbol or price is None or price <= 0:
        return None
    pair = f"{str(symbol).upper()}_USDT"
    last = _num(lasts.get(pair) if lasts else None)
    if last is None or last <= 0:
        return None
    if abs(last / price - 1) > tolerance:
        return None
    return pair


def _closeness(price, last):
    if price is None or last is None or price <= 0 or last <= 0:
        return 1e9
    return abs(last / price - 1)


def select_gate_assets(rows, spot_last, futures_last) -> tuple[list[dict], dict]:
    reasons = {
        "universeRows": 0,
        "notVerified": 0,
        "outsideCap": 0,
        "thinVolume": 0,
        "priceUnconfirmed": 0,
        "notOnGate": 0,
    }
    chosen = []
    seen = {}
    for row in rows or []:
        reasons["universeRows"] += 1
        if not isinstance(row, dict):
            reasons["notVerified"] += 1
            continue
        if row.get("valid") != "V":
            reasons["notVerified"] += 1
            continue
        mcap = _num(row.get("marketCap"))
        vol = _num(row.get("volume24h"))
        if mcap is None or mcap < MCAP_MIN or mcap > MCAP_MAX:
            reasons["outsideCap"] += 1
            continue
        if vol is None or vol < VOL_MIN:
            reasons["thinVolume"] += 1
            continue
        price = _num(row.get("price"))
        symbol = row.get("symbol")
        spot = _match(symbol, price, spot_last)
        fut = _match(symbol, price, futures_last)
        if spot is None and fut is None:
            # Simbolul există pe Gate, dar la alt preț: omonim, nu același token.
            pair = f"{str(symbol or '').upper()}_USDT"
            on_book = (spot_last and pair in spot_last) or (futures_last and pair in futures_last)
            reasons["priceUnconfirmed" if on_book or price is None else "notOnGate"] += 1
            continue
        item = {
            "key": row.get("key"),
            "symbol": str(symbol or "").upper(),
            "name": row.get("name") or "",
            "price": price,
            "marketCap": mcap,
            "volume24h": vol,
            "gateSpotPair": spot,
            "gateFuturesContract": fut,
            "futuresOnly": spot is None,
        }
        ident = spot or fut
        prev = seen.get(ident)
        if prev is None:
            seen[ident] = item
            continue
        last = _num((spot_last or {}).get(spot) if spot else (futures_last or {}).get(fut))
        prev_last = _num((spot_last or {}).get(prev["gateSpotPair"]) if prev["gateSpotPair"] else (futures_last or {}).get(prev["gateFuturesContract"]))
        if _closeness(price, last) < _closeness(prev["price"], prev_last):
            seen[ident] = item
    chosen = sorted(seen.values(), key=lambda a: (-a["volume24h"], a["symbol"]))
    return chosen, reasons
