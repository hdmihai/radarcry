"""Reguli de momentum în trepte. Funcții pure: fără rețea, fără ceas, fără fișiere.

Șapte condiții. O condiție fără date iese `None` (necunoscut) și nu intră la numitor —
necunoscut nu înseamnă eșuat. Semnalul cere acoperire suficientă și aceeași bară de 5/7
pe condițiile cunoscute, nu un scor care pedepsește lipsa open-interest-ului.

Nu este un model. LightGBM rămâne în modulul `runners` (orizont 7 zile, validat out-of-time).
"""
from __future__ import annotations

import math

import pandas as pd

HOURS_7D = 168
HOURS_14D = 336
HOURS_20D = 480
MIN_BARS = HOURS_20D + 1
MIN_KNOWN = 4
# 5 din 7. Cu date lipsă, aceeași fracție pe condițiile cunoscute.
HIT_RATIO = 5 / 7

RULES = (
    {"id": "R1", "key": "outperformance7dGt15pct", "text": "Supraperformanță pe 7 zile față de BTC mai mare de 15 puncte procentuale."},
    {"id": "R2", "key": "gain15To60PctFrom20dLow", "text": "Câștig între 15% și 60% față de minimul ultimelor 20 de zile — treaptă, nu mișcare epuizată."},
    {"id": "R3", "key": "risingLows", "text": "Minime în urcare: pe 1h și, când există, confirmate pe 4h."},
    {"id": "R4", "key": "marketDown7d", "text": "BTC este pe minus în ultimele 7 zile (tărie relativă într-o piață slabă)."},
    {"id": "R5", "key": "volumeTrendUp", "text": "Volumul mediu din ultimele 24 de ore este peste cele 24 de ore precedente."},
    {"id": "R6", "key": "openInterestGrowth14dGt20pct", "text": "Open interest-ul în USD a crescut cu peste 20% în 14 zile."},
    {"id": "R7", "key": "openInterestFasterThanPrice", "text": "Open interest-ul crește mai repede decât prețul pe 14 zile."},
)


def _finite(value):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def pct_over_hours(series, hours: int):
    """Variație procentuală între ultima valoare și valoarea de acum `hours` ore.

    Cere un punct la cel mult 2 ore de țintă. O serie mai scurtă sau cu goluri
    întoarce None — nu o variație inventată pe ultimul punct disponibil.
    """
    if series is None:
        return None
    s = pd.to_numeric(series, errors="coerce").dropna().sort_index()
    if s.empty or not isinstance(s.index, pd.DatetimeIndex):
        return None
    end = s.index[-1]
    target = end - pd.Timedelta(hours=hours)
    prior = s.loc[:target]
    if prior.empty:
        return None
    prev_ts = prior.index[-1]
    if abs((target - prev_ts).total_seconds()) > 2 * 3600:
        return None
    prev = _finite(prior.iloc[-1])
    last = _finite(s.iloc[-1])
    if prev is None or last is None or prev == 0:
        return None
    return (last / prev - 1.0) * 100.0


def gain_from_20d_low(candles) -> float | None:
    """(ultimul close / minimul low-ului pe 20 de zile − 1), în procente.

    Folosește low-ul, nu close-ul: un fitil spune cât de jos a fost prețul.
    """
    if candles is None or len(candles) < HOURS_20D:
        return None
    window = candles.iloc[-HOURS_20D:]
    low = _finite(pd.to_numeric(window["low"], errors="coerce").min())
    last = _finite(candles["close"].iloc[-1])
    if low is None or last is None or low <= 0:
        return None
    return (last / low - 1.0) * 100.0


def rising_lows_1h(low) -> bool | None:
    """Minimul pe 48h de acum este peste minimul pe 48h de acum 49 de ore."""
    if low is None or len(low) < 48 + 49:
        return None
    recent = pd.to_numeric(low, errors="coerce").rolling(48).min()
    a = _finite(recent.iloc[-1])
    b = _finite(recent.iloc[-49])
    if a is None or b is None:
        return None
    return a > b


def rising_lows_4h(candles4h) -> bool | None:
    """Două trepte de câte 6 lumânări 4h (24h): minimul recent peste minimul precedent."""
    if candles4h is None or len(candles4h) < 12 or "low" not in candles4h:
        return None
    low = pd.to_numeric(candles4h["low"], errors="coerce").dropna()
    if len(low) < 12:
        return None
    a = _finite(low.iloc[-6:].min())
    b = _finite(low.iloc[-12:-6].min())
    if a is None or b is None:
        return None
    return a > b


def rising_lows(candles1h, candles4h) -> bool | None:
    """1h obligatoriu când poate fi măsurat; 4h confirmă când există, nu pedepsește lipsa lui."""
    on_1h = rising_lows_1h(None if candles1h is None else candles1h["low"])
    on_4h = rising_lows_4h(candles4h)
    if on_1h is None and on_4h is None:
        return None
    if on_4h is None:
        return on_1h
    if on_1h is None:
        return on_4h
    return bool(on_1h and on_4h)


def volume_trend_ratio(volume) -> float | None:
    if volume is None or len(volume) < 48:
        return None
    v = pd.to_numeric(volume, errors="coerce")
    recent = _finite(v.iloc[-24:].mean())
    previous = _finite(v.iloc[-48:-24].mean())
    if recent is None or previous is None or previous == 0:
        return None
    return recent / previous


def _oi_series(futures_stats):
    if futures_stats is None or len(futures_stats) == 0 or "open_interest_usd" not in futures_stats:
        return None
    series = pd.to_numeric(futures_stats["open_interest_usd"], errors="coerce")
    series.index = futures_stats.index
    return series


def last_long_short_taker(futures_stats):
    """Informativ. Nu este o condiție: nu exista un prag în regulă, deci nu inventăm unul."""
    if futures_stats is None or len(futures_stats) == 0 or "lsr_taker" not in futures_stats:
        return None
    series = pd.to_numeric(futures_stats["lsr_taker"], errors="coerce").dropna()
    if series.empty:
        return None
    return _finite(series.iloc[-1])


def qualifies(conditions: dict) -> tuple[int, int, bool]:
    known_vals = [v for v in conditions.values() if v is not None]
    hits = sum(1 for v in known_vals if v is True)
    known = len(known_vals)
    ok = known >= MIN_KNOWN and (hits / known) >= HIT_RATIO
    return hits, known, bool(ok)


def resample_4h(candles):
    if candles is None or len(candles) == 0:
        return candles
    counts = candles["close"].resample("4h").count()
    out = candles.resample("4h").agg({
        "open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum",
    })
    out = out[counts.reindex(out.index).fillna(0) >= 4]
    return out.dropna(subset=["close"])


def compute_step_momentum(candles1h, candles4h=None, futures_stats=None, market1h=None, *, price_source="gate:spot:candles:1h"):
    """None doar când lumânările tokenului nu acoperă 20 de zile. Restul poate fi necunoscut."""
    if candles1h is None or len(candles1h) < MIN_BARS:
        return None
    if candles4h is None:
        candles4h = resample_4h(candles1h)

    token_7d = pct_over_hours(candles1h["close"], HOURS_7D)
    market_7d = None if market1h is None or len(market1h) == 0 else pct_over_hours(market1h["close"], HOURS_7D)
    outperformance = None if token_7d is None or market_7d is None else token_7d - market_7d
    gain = gain_from_20d_low(candles1h)
    volume_ratio = volume_trend_ratio(candles1h["volume"])
    oi = _oi_series(futures_stats)
    oi_change = None if oi is None else pct_over_hours(oi, HOURS_14D)
    price_14d = pct_over_hours(candles1h["close"], HOURS_14D)

    conditions = {
        "outperformance7dGt15pct": None if outperformance is None else outperformance > 15,
        "gain15To60PctFrom20dLow": None if gain is None else 15 <= gain <= 60,
        "risingLows": rising_lows(candles1h, candles4h),
        "marketDown7d": None if market_7d is None else market_7d < 0,
        "volumeTrendUp": None if volume_ratio is None else volume_ratio > 1,
        "openInterestGrowth14dGt20pct": None if oi_change is None else oi_change > 20,
        "openInterestFasterThanPrice": (
            None if oi_change is None or price_14d is None else oi_change > price_14d
        ),
    }
    hits, known, ok = qualifies(conditions)
    return {
        "score": hits,
        "known": known,
        "isStepMomentum": ok,
        "conditions": conditions,
        "metrics": {
            "tokenChange7dPct": token_7d,
            "marketChange7dPct": market_7d,
            "outperformance7dPct": outperformance,
            "gainFrom20dLowPct": gain,
            "openInterestChange14dPct": oi_change,
            "priceChange14dPct": price_14d,
            "volumeTrendRatio": volume_ratio,
            "longShortTaker": last_long_short_taker(futures_stats),
        },
        "sources": {
            "price": price_source,
            "benchmark": None if market_7d is None else "gate:spot:BTC_USDT:1h",
            "openInterest": None if oi_change is None else "gate:futures:contract_stats:1h",
            "structure4h": "resample:1h→4h",
        },
    }
