"""De la probabilitate la listă: etapă, nivel, factori explicați, reguli potrivite, riscuri."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .catalog import FEATURES, fmt, label
from .rules import rule_mask


def stage_of(row) -> tuple[str, str]:
    r1, r3, r7 = (row.get(k) for k in ("ret_1d", "ret_3d", "ret_7d"))
    r1 = 0 if r1 is None or math.isnan(r1) else r1
    r3 = 0 if r3 is None or math.isnan(r3) else r3
    r7 = 0 if r7 is None or math.isnan(r7) else r7
    if r7 >= 0.8:
        return "EXTINS", "a urcat deja ≥80% în 7 zile — intrare târzie, risc mare de inversare"
    if r1 >= 0.15 or r3 >= 0.3:
        return "APRINDERE", "mișcarea a început (≥15% într-o zi sau ≥30% în 3 zile)"
    return "PRE", "încă neaprins — tiparul precede de obicei creșterea"


def tier_of(lift: float) -> str:
    return "A" if lift >= 4 else "B" if lift >= 2.5 else "C"


def risks_of(row, ctx: dict) -> list[dict]:
    out = []
    g = lambda k: row.get(k) if row.get(k) is not None and not (isinstance(row.get(k), float) and math.isnan(row.get(k))) else None
    if (g("rsi_14") or 0) > 80:
        out.append({"key": "rsi", "label": f"RSI {g('rsi_14'):.0f} — supracumpărat", "severity": "medium"})
    if (g("funding_1d") or 0) > 0.0005:
        out.append({"key": "crowded_longs", "label": f"Funding {fmt('funding_1d', g('funding_1d'))} — long-uri aglomerate", "severity": "medium"})
    if (g("ret_7d") or 0) >= 0.8:
        out.append({"key": "extended", "label": f"Deja {fmt('ret_7d', g('ret_7d'))} în 7 zile", "severity": "high"})
    if (g("wick_up") or 0) > 0.15:
        out.append({"key": "rejection", "label": "Fitil superior mare — vânzare la maxim", "severity": "medium"})
    vol = ctx.get("volume24h") or g("volume")
    if vol is not None and vol < 300_000:
        out.append({"key": "thin", "label": f"Lichiditate mică (${vol / 1e3:,.0f}k / 24h)", "severity": "high"})
    if (g("oi_to_mcap") or 0) > 0.5:
        out.append({"key": "leverage", "label": f"OI = {fmt('oi_to_mcap', g('oi_to_mcap'))} din market cap — levier extrem", "severity": "medium"})
    for c in ctx.get("catalysts", []):
        if c == "KRW_WARNING":
            out.append({"key": "krw_warning", "label": "Avertisment de investiții pe o bursă coreeană", "severity": "high"})
    out.append({"key": "unlock", "label": "Verifică manual deblocările de tokeni (sursa gratuită nu le include)", "severity": "info"})
    return out


def explain(row, contrib: np.ndarray, keys: list[str], profile: dict[str, dict]) -> list[dict]:
    """Toți factorii, sortați după impactul lor în probabilitate (TreeSHAP, log-odds)."""
    out = []
    for j, k in enumerate(keys):
        v = row.get(k)
        if v is None or (isinstance(v, float) and math.isnan(v)):
            continue
        prof = profile.get(k) or {}
        out.append({
            "key": k, "label": label(k), "family": FEATURES[k][2], "value": float(v), "text": fmt(k, v),
            "contribution": round(float(contrib[j]), 4),
            "runnersMedian": prof.get("runnersText"), "othersMedian": prof.get("othersText"),
            "auc": prof.get("auc"),
        })
    return sorted(out, key=lambda f: -abs(f["contribution"]))


def matched_rules(frame: pd.DataFrame, rules: list[dict]) -> list[list[str]]:
    hits = [[] for _ in range(len(frame))]
    for r in rules:
        m = rule_mask(frame, [tuple(c) for c in r["conds"]])
        for i in np.flatnonzero(m):
            hits[i].append(r["id"])
    return hits
