"""RadarCry — Liquidity research (Faza 6, snapshot-based).

Două secțiuni:
- `discovery`: 120 altcoins, research-only (Node nu are score aici) → gaps
- `futures`:   40 majors, Node are `liquidity.score` → agreement real posibil

`agreement = |nodeScore/100 - researchComposite|` (0 = perfect acord).
"""
from __future__ import annotations
from typing import Optional


def _to_float(x) -> Optional[float]:
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return None if f != f else f


def _clamp01(x: Optional[float]) -> Optional[float]:
    return None if x is None else max(0.0, min(1.0, x))


def _market(r: dict) -> dict:
    return r.get("market") or r or {}


def _turnover(r: dict) -> Optional[float]:
    m = _market(r)
    t = _to_float(m.get("turnover"))
    if t is not None:
        return t
    vol = _to_float(m.get("volume") or m.get("volume24h"))
    mc = _to_float(m.get("marketCap"))
    if vol is not None and mc is not None and mc > 0:
        return vol / mc
    return None


def _score_turnover(t: Optional[float]) -> Optional[float]:
    return _clamp01(t / 0.30) if t is not None else None


def _score_oi_to_mcap(r: Optional[float]) -> Optional[float]:
    return _clamp01(r / 0.50) if r is not None else None


def _score_funding(f: Optional[float]) -> Optional[float]:
    return _clamp01(1.0 - abs(f) / 0.0003) if f is not None else None


_WEIGHTS = {"turnover": 0.40, "oiToMcap": 0.40, "funding": 0.20}


def _node_score(fr: Optional[dict]) -> Optional[int]:
    if not fr:
        return None
    raw = (fr.get("liquidity") or {}).get("score")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _features(r: dict, sq: dict, node_raw: Optional[int]) -> dict:
    turnover = _turnover(r)
    oi_to_mcap = _to_float(sq.get("oiToMcap"))
    funding = _to_float(sq.get("fundingAvg"))

    factors = {
        "turnover": _score_turnover(turnover),
        "oiToMcap": _score_oi_to_mcap(oi_to_mcap),
        "funding": _score_funding(funding),
    }
    present = {k: v for k, v in factors.items() if v is not None}
    if present:
        total_w = sum(_WEIGHTS[k] for k in present)
        composite = sum(_WEIGHTS[k] * v for k, v in present.items()) / total_w
    else:
        composite = None

    node_norm = (node_raw / 100.0) if node_raw is not None else None
    agreement = (
        abs(node_norm - composite)
        if (node_norm is not None and composite is not None) else None
    )

    gaps = []
    if node_raw is None:
        gaps.append("nodeFuturesScore")
    if composite is None:
        gaps.append("researchComposite")
    if agreement is None:
        gaps.append("agreement")

    return {
        "nodeFuturesScore": node_raw,
        "researchFactors": factors,
        "researchComposite": composite,
        "agreement": agreement,
        "gaps": gaps,
    }


def compute_liquidity(discovery_rows, futures_rows, squeeze_by_symbol=None) -> dict:
    squeeze = squeeze_by_symbol or {}
    futures_by_sym = {fr.get("symbol"): fr for fr in (futures_rows or []) if fr.get("symbol")}

    discovery_out = {}
    for r in discovery_rows or []:
        sym = r.get("symbol")
        if not sym:
            continue
        discovery_out[sym] = _features(r, squeeze.get(sym) or {}, None)

    futures_out = {}
    for r in futures_rows or []:
        sym = r.get("symbol")
        if not sym:
            continue
        futures_out[sym] = _features(r, squeeze.get(sym) or {}, _node_score(r))

    return {"discovery": discovery_out, "futures": futures_out}
