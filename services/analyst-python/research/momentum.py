"""RadarCry — Momentum research (Faza 6, snapshot-based).

HONEST NOTE: briefing-ul original presupunea time series inexistente în latest.json.
Câmpurile care ar necesita istoric sunt None + listate în `gaps`.

Benchmark outperformance7d: BTC dacă e prezent în rows, altfel cross-sectional
median al `change.d7` (mai robust științific, fallback garantat funcțional).
"""
from __future__ import annotations
from typing import Any, Iterable, Optional


def _to_float(x: Any) -> Optional[float]:
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return None if f != f else f


def _get_nested(d: dict, *path, default=None):
    cur = d
    for p in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(p)
        if cur is None:
            return default
    return cur


def _market(r: dict) -> dict:
    """discovery.rows are nested (r['market']); futures.rows are flat."""
    return r.get("market") or r or {}


def _find_benchmark(rows: list, symbol: str) -> Optional[dict]:
    sym = symbol.upper()
    aliases = {"BTC": {"BTC", "WBTC"}, "ETH": {"ETH", "WETH"}}.get(sym, {sym})
    for r in rows:
        if (r.get("symbol") or "").upper() in aliases:
            return r
    return None


def _median(vals: Iterable[Optional[float]]) -> Optional[float]:
    v = sorted(x for x in vals if x is not None)
    if not v:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2.0


def _composite_momentum(market: dict) -> Optional[float]:
    ch = (market or {}).get("change") or {}
    parts = [(_to_float(ch.get("h24")), 0.2),
             (_to_float(ch.get("d7")), 0.5),
             (_to_float(ch.get("d30")), 0.3)]
    num = den = 0.0
    for v, w in parts:
        if v is not None:
            num += v * w
            den += w
    return num / den if den > 0 else None


_IMPOSSIBLE_WITHOUT_HISTORY = (
    "gainFrom20dLow", "risingLows", "volumeTrendUp", "openInterestChange14d",
)


def _resolve_benchmark(rows: list, symbol: str):
    bench = _find_benchmark(rows, symbol)
    if bench is not None:
        v = _to_float(_get_nested(bench, "market", "change", "d7"))
        if v is None:
            v = _to_float(_get_nested(bench, "change", "d7"))
        if v is not None:
            return v, symbol
    all_d7 = [_to_float(_get_nested(_market(r), "change", "d7")) for r in rows]
    return _median(all_d7), "crossSectionalMedian"


def compute_momentum(
    rows: Iterable[dict],
    squeeze_by_symbol: Optional[dict] = None,
    benchmark_symbol: str = "BTC",
) -> dict:
    rows = list(rows or [])
    squeeze_by_symbol = squeeze_by_symbol or {}

    benchmark_value, benchmark_kind = _resolve_benchmark(rows, benchmark_symbol)

    out = {}
    for r in rows:
        sym = r.get("symbol")
        if not sym:
            continue
        market = _market(r)
        changed = r.get("changed") or {}

        d7 = _to_float(_get_nested(market, "change", "d7"))
        outperf = (d7 - benchmark_value) if (d7 is not None and benchmark_value is not None) else None
        composite = _composite_momentum(market)
        turnover = _to_float(market.get("turnover"))
        earliness = _to_float(changed.get("earliness"))
        sq = squeeze_by_symbol.get(sym) or {}
        oi_change = _to_float(sq.get("oiChangePct"))

        gaps = []
        if outperf is None:
            gaps.append("outperformance7d")
        if composite is None:
            gaps.append("momentumComposite")
        if oi_change is None:
            gaps.append("oiChangePct")
        gaps.extend(_IMPOSSIBLE_WITHOUT_HISTORY)

        out[sym] = {
            "outperformance7d": outperf,
            "momentumComposite": composite,
            "turnover": turnover,
            "earliness": earliness,
            "oiChangePct": oi_change,
            "benchmark": benchmark_kind,
            "benchmarkValue": benchmark_value,
            "gaps": gaps,
        }
    return out
