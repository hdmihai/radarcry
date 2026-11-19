"""Ce au în comun runnerii: fiecare factor, comparat între ziua dinaintea aprinderii (run_start)
și restul zilelor fără runner.

  · AUC univariat (Mann–Whitney U / n1·n2): 0.5 = nicio diferență, >0.5 = mai mare la runneri
  · p-value Mann–Whitney + corecție Benjamini–Hochberg (FDR) — câți factori sunt „reali”
  · medianele celor două grupuri și pragul de decilă cu cel mai mare lift
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import mannwhitneyu

from .catalog import FEATURES, fmt, label


def benjamini_hochberg(p: np.ndarray) -> np.ndarray:
    p = np.asarray(p, dtype=float)
    n = len(p)
    order = np.argsort(p)
    ranked = p[order] * n / (np.arange(n) + 1)
    q = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(n)
    out[order] = np.clip(q, 0, 1)
    return out


def decile_lift(x: pd.Series, y: pd.Series, direction: int) -> tuple[float | None, float | None, float | None]:
    """Pragul (decila) care maximizează rata de runneri pe partea „bună” a factorului."""
    ok = x.notna()
    x, y = x[ok], y[ok]
    if len(x) < 200 or y.sum() < 5:
        return None, None, None
    base = y.mean()
    best = (None, None, None)
    for q in (0.1, 0.2, 0.3, 0.7, 0.8, 0.9):
        thr = float(x.quantile(q))
        side = x >= thr if direction > 0 else x <= thr
        if side.sum() < 50 or (direction > 0 and q < 0.5) or (direction < 0 and q > 0.5):
            continue
        rate = y[side].mean()
        lift = rate / base if base > 0 else None
        if lift and (best[1] is None or lift > best[1]):
            best = (thr, lift, float(side.mean()))
    return best


def common_factors(df: pd.DataFrame, keys: list[str], max_neg: int = 60000, seed: int = 7) -> list[dict]:
    lab = df[df["labeled"]]
    pos = lab[lab["run_start"]]
    neg = lab[lab["y"] == 0]
    if len(neg) > max_neg:
        neg = neg.sample(max_neg, random_state=seed)
    if len(pos) < 5:
        return []
    rows = []
    for k in keys:
        a, b = pos[k].dropna(), neg[k].dropna()
        if len(a) < 5 or len(b) < 50:
            continue
        u, p = mannwhitneyu(a, b, alternative="two-sided")
        auc = float(u / (len(a) * len(b)))
        direction = 1 if auc >= 0.5 else -1
        sample = pd.concat([pos[[k]].assign(_y=1.0), neg[[k]].assign(_y=0.0)])
        thr, lift, share = decile_lift(sample[k], sample["_y"], direction)
        rows.append({
            "key": k, "label": label(k), "family": FEATURES[k][2], "hint": FEATURES[k][3],
            "auc": round(auc, 4), "strength": round(abs(auc - 0.5) * 2, 4), "direction": "mai mare" if direction > 0 else "mai mic",
            "runners": float(a.median()), "others": float(b.median()),
            "runnersText": fmt(k, a.median()), "othersText": fmt(k, b.median()),
            "threshold": thr, "thresholdText": fmt(k, thr) if thr is not None else None,
            "lift": round(lift, 2) if lift else None, "share": round(share, 3) if share else None,
            "p": float(p), "nRunners": int(len(a)),
        })
    if not rows:
        return []
    q = benjamini_hochberg(np.array([r["p"] for r in rows]))
    for r, qq in zip(rows, q):
        r["q"] = float(qq)
        r["significant"] = bool(qq < 0.05)
        r.pop("p")
    return sorted(rows, key=lambda r: -r["strength"])
