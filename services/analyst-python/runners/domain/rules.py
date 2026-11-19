"""Reguli interpretabile „DACĂ … ȘI … ATUNCI runner”, în stilul skope-rules
(https://github.com/scikit-learn-contrib/skope-rules): arbori de decizie superficiali pe
eșantioane bootstrap, fiecare frunză cu rată mare de runneri devine o regulă, apoi regulile se
evaluează pe o perioadă de validare ulterioară (out-of-time) și se păstrează doar cele cu
precizie, suport și lift suficiente. Implementare proprie pe scikit-learn (pachetul original
nu mai e întreținut pentru versiunile noi).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeClassifier

from .catalog import fmt, label


def _round_sig(x: float, sig: int = 3) -> float:
    if x == 0 or not math.isfinite(x):
        return x
    return round(x, sig - int(math.floor(math.log10(abs(x)))) - 1)


def _paths(tree, names: list[str]) -> list[tuple[list[tuple[str, str, float]], float, int]]:
    t = tree.tree_
    out = []

    def walk(node, conds):
        if t.children_left[node] == -1:
            vals = t.value[node][0]
            out.append((conds, float(vals[1] / max(vals.sum(), 1e-12)), int(t.n_node_samples[node])))
            return
        f, thr = names[t.feature[node]], float(t.threshold[node])
        walk(t.children_left[node], conds + [(f, "<=", thr)])
        walk(t.children_right[node], conds + [(f, ">", thr)])

    walk(0, [])
    return out


def simplify(conds: list[tuple[str, str, float]]) -> list[tuple[str, str, float]]:
    best: dict[tuple[str, str], float] = {}
    for f, op, thr in conds:
        k = (f, op)
        best[k] = min(best.get(k, thr), thr) if op == "<=" else max(best.get(k, thr), thr)
    return [(f, op, _round_sig(t)) for (f, op), t in sorted(best.items())]


def rule_mask(X: pd.DataFrame, conds) -> np.ndarray:
    m = np.ones(len(X), dtype=bool)
    for f, op, thr in conds:
        col = X[f].to_numpy(dtype=float)
        with np.errstate(invalid="ignore"):
            m &= (col <= thr) if op == "<=" else (col > thr)
    return m  # NaN → False (comparațiile cu NaN sunt false)


def rule_text(conds) -> str:
    return " ȘI ".join(f"{label(f)} {'≤' if op == '<=' else '>'} {fmt(f, thr)}" for f, op, thr in conds)


def wilson_lower(p: float, n: int, z: float = 1.64) -> float:
    if n == 0:
        return 0.0
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (c - r) / d


def learn_rules(train: pd.DataFrame, valid: pd.DataFrame, keys: list[str], y: str = "y", n_trees: int = 40,
                depths=(2, 3), min_support: int = 25, min_lift: float = 1.8, top: int = 12, seed: int = 11) -> tuple[list[dict], float]:
    rng = np.random.default_rng(seed)
    Xtr = train[keys]
    fill = Xtr.median(numeric_only=True)
    Xf = Xtr.fillna(fill)
    ytr = train[y].to_numpy()
    base_valid = float(valid[y].mean()) if len(valid) else float(ytr.mean())
    candidates: dict[tuple, list] = {}
    n = len(Xf)
    if n < 200 or ytr.sum() < 10:
        return [], base_valid
    for i in range(n_trees):
        idx = rng.choice(n, size=min(n, 120000), replace=True)
        feats = rng.choice(len(keys), size=max(4, int(len(keys) * 0.6)), replace=False)
        names = [keys[j] for j in feats]
        d = depths[i % len(depths)]
        tree = DecisionTreeClassifier(max_depth=d, min_samples_leaf=max(40, n // 500), class_weight="balanced", random_state=int(rng.integers(1e9)))
        tree.fit(Xf.iloc[idx][names].to_numpy(), ytr[idx])
        for conds, purity, _ in _paths(tree, names):
            if purity < 0.6 or not conds:
                continue
            c = tuple(simplify(conds))
            candidates.setdefault(c, []).append(purity)
    out = []
    for conds in candidates:
        mt = rule_mask(train, conds)
        mv = rule_mask(valid, conds) if len(valid) else mt
        frame = valid if len(valid) else train
        sup = int(mv.sum())
        if sup < min_support:
            continue
        prec = float(frame[y].to_numpy()[mv].mean())
        lift = prec / base_valid if base_valid > 0 else 0.0
        if lift < min_lift:
            continue
        out.append({
            "conds": [list(c) for c in conds], "text": rule_text(conds),
            "precision": round(prec, 4), "lift": round(lift, 2), "support": sup,
            "recall": round(float(frame[y].to_numpy()[mv].sum() / max(1, frame[y].sum())), 4),
            "trainPrecision": round(float(train[y].to_numpy()[mt].mean()) if mt.any() else 0.0, 4),
            "score": wilson_lower(prec, sup) / max(base_valid, 1e-9),
        })
    # deduplicare: aceeași mulțime de factori → cea mai bună regulă
    best: dict[frozenset, dict] = {}
    for r in sorted(out, key=lambda r: -r["score"]):
        sig = frozenset((c[0], c[1]) for c in r["conds"])
        best.setdefault(sig, r)
    rules = sorted(best.values(), key=lambda r: -r["score"])[:top]
    for i, r in enumerate(rules):
        r["id"] = f"R{i + 1}"
        r["score"] = round(r["score"], 3)
    return rules, base_valid
