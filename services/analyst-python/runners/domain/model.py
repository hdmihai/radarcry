"""Modelul de probabilitate: gradient boosting pe factori point-in-time.

  · LightGBM (https://lightgbm.readthedocs.io) — același tip de model folosit implicit de FreqAI
    în Freqtrade; fallback scikit-learn HistGradientBoosting dacă LightGBM lipsește
  · validare walk-forward cu purjare + embargo (López de Prado, „Advances in Financial Machine
    Learning”, cap. 7): antrenarea se oprește cu orizont + embargo zile înainte de fiecare bloc de
    test, deci etichetele de antrenare nu ating perioada evaluată
  · calibrare izotonică pe predicțiile out-of-fold → probabilități interpretabile
  · contribuții per factor (TreeSHAP nativ din LightGBM, pred_contrib) → „de ce” pentru fiecare candidat
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

try:  # pragma: no cover - depinde de mediu
    import lightgbm as lgb
except Exception:  # pragma: no cover
    lgb = None


def _new_model(pos_weight: float, seed: int = 3):
    if lgb is not None:
        return lgb.LGBMClassifier(
            n_estimators=350, learning_rate=0.04, num_leaves=15, max_depth=-1,
            min_child_samples=60, subsample=0.8, subsample_freq=1, colsample_bytree=0.7,
            reg_lambda=2.0, scale_pos_weight=pos_weight, random_state=seed, verbose=-1, n_jobs=-1,
        )
    from sklearn.ensemble import HistGradientBoostingClassifier
    return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=60,
                                          l2_regularization=2.0, class_weight="balanced", random_state=seed)


def engine_name() -> str:
    return f"LightGBM {lgb.__version__}" if lgb is not None else "scikit-learn HistGradientBoosting"


def walk_forward_splits(dates: pd.Series, n_folds: int, horizon: int, embargo: int, test_share: float = 0.5):
    """Blocuri de test consecutive în a doua parte a istoricului; antrenare pe tot ce se termină
    cu horizon+embargo zile înainte de începutul blocului (expanding window, fără viitor)."""
    uniq = np.array(sorted(pd.unique(dates)))
    if len(uniq) < 60:
        return []
    start = int(len(uniq) * (1 - test_share))
    blocks = np.array_split(uniq[start:], n_folds)
    out = []
    for b in blocks:
        if len(b) == 0:
            continue
        gap = pd.Timedelta(days=horizon + embargo)
        train_end = pd.Timestamp(b[0]) - gap
        tr = dates < train_end
        te = (dates >= b[0]) & (dates <= b[-1])
        if tr.sum() > 500 and te.sum() > 100:
            out.append((tr.to_numpy(), te.to_numpy(), pd.Timestamp(b[0]), pd.Timestamp(b[-1])))
    return out


def precision_at_k_daily(frame: pd.DataFrame, k: int = 10) -> float:
    vals = []
    for _, g in frame.groupby("date"):
        if g["y"].notna().sum() < k:
            continue
        top = g.nlargest(k, "p")
        vals.append(top["y"].mean())
    return float(np.mean(vals)) if vals else float("nan")


class RunnerModel:
    def __init__(self, keys: list[str], horizon: int = 7, embargo: int = 7, n_folds: int = 4):
        self.keys = keys
        self.horizon = horizon
        self.embargo = embargo
        self.n_folds = n_folds
        self.model = None
        self.calibrator = None
        self.metrics: dict = {}
        self.base_rate = float("nan")

    def _fit(self, X: pd.DataFrame, y: np.ndarray):
        pos = max(1.0, float(y.sum()))
        w = float(np.clip((len(y) - pos) / pos, 1.0, 25.0))
        m = _new_model(w)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            m.fit(X, y)
        return m

    @staticmethod
    def _raw(m, X):
        return m.predict_proba(X)[:, 1]

    def fit(self, lab: pd.DataFrame) -> "RunnerModel":
        lab = lab.sort_values("date").reset_index(drop=True)
        X, y = lab[self.keys], lab["y"].to_numpy().astype(int)
        self.base_rate = float(y.mean())
        oof_idx, oof_raw, folds = [], [], []
        for tr, te, a, b in walk_forward_splits(lab["date"], self.n_folds, self.horizon, self.embargo):
            if y[tr].sum() < 10 or y[te].sum() < 3:
                continue
            m = self._fit(X[tr], y[tr])
            p = self._raw(m, X[te])
            idx = np.flatnonzero(te)
            oof_idx.append(idx)
            oof_raw.append(p)
            yy = y[te]
            fr = pd.DataFrame({"date": lab["date"].to_numpy()[te], "y": yy, "p": p})
            folds.append({
                "from": a.date().isoformat(), "to": b.date().isoformat(), "n": int(te.sum()), "runners": int(yy.sum()),
                "auc": round(float(roc_auc_score(yy, p)), 4), "prAuc": round(float(average_precision_score(yy, p)), 4),
                "baseRate": round(float(yy.mean()), 4), "precisionAt10": round(precision_at_k_daily(fr, 10), 4),
            })
        if oof_idx:
            idx = np.concatenate(oof_idx)
            raw = np.concatenate(oof_raw)
            yy = y[idx]
            self.calibrator = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(raw, yy)
            cal = self.calibrator.predict(raw)
            fr = pd.DataFrame({"date": lab["date"].to_numpy()[idx], "y": yy, "p": raw})
            top = fr.nlargest(max(1, len(fr) // 100), "p")
            self.metrics = {
                "validation": "walk-forward, purjare + embargo",
                "folds": folds,
                "auc": round(float(roc_auc_score(yy, raw)), 4),
                "prAuc": round(float(average_precision_score(yy, raw)), 4),
                "brier": round(float(brier_score_loss(yy, cal)), 4),
                "baseRate": round(float(yy.mean()), 4),
                "precisionAt10": round(precision_at_k_daily(fr, 10), 4),
                "precisionTop1pct": round(float(top["y"].mean()), 4),
                "liftTop1pct": round(float(top["y"].mean() / max(yy.mean(), 1e-9)), 2),
                "oosRows": int(len(idx)),
            }
        else:
            self.metrics = {"validation": "insuficiente date pentru validare out-of-time", "folds": []}
        self.model = self._fit(X, y)
        self.metrics.update({"engine": engine_name(), "trainRows": int(len(lab)), "trainRunners": int(y.sum()),
                             "trainFrom": lab["date"].min().date().isoformat(), "trainTo": lab["date"].max().date().isoformat()})
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        raw = self._raw(self.model, X[self.keys])
        return self.calibrator.predict(raw) if self.calibrator is not None else raw

    def contributions(self, X: pd.DataFrame) -> np.ndarray:
        """Contribuții log-odds per factor (ultima coloană = bias eliminată)."""
        X = X[self.keys]
        if lgb is not None and hasattr(self.model, "booster_"):
            return np.asarray(self.model.predict(X, pred_contrib=True))[:, :-1]
        # fallback: diferența de log-odds când factorul e înlocuit cu mediana
        base = np.clip(self._raw(self.model, X), 1e-6, 1 - 1e-6)
        lo = np.log(base / (1 - base))
        med = X.median()
        out = np.zeros((len(X), len(self.keys)))
        for j, k in enumerate(self.keys):
            Z = X.copy()
            Z[k] = med[k]
            p = np.clip(self._raw(self.model, Z), 1e-6, 1 - 1e-6)
            out[:, j] = lo - np.log(p / (1 - p))
        return out

    def importance(self) -> list[dict]:
        if lgb is not None and hasattr(self.model, "booster_"):
            gain = self.model.booster_.feature_importance(importance_type="gain")
            tot = gain.sum() or 1.0
            return sorted(({"key": k, "share": round(float(g / tot), 4)} for k, g in zip(self.keys, gain)), key=lambda r: -r["share"])
        return []
