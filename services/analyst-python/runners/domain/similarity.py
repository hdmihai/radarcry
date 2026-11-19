"""Similaritate cu runnerii istorici (k-nearest neighbours pe „amprente”).

Amprenta unui runner = factorii lui în ziua DINAINTEA aprinderii. Factorii sunt scalați robust
(mediană / IQR, tăiați la ±4) și ponderați cu puterea lor discriminativă din analiza factorilor
comuni, ca distanța să conteze pe ce separă cu adevărat runnerii de restul.
Referințele din config/runners.json (EVAA, IRYS, BR …) primesc o amprentă dedicată: ziua dinaintea
celei mai mari creșteri pe 7 zile din istoricul lor recent (sau data fixată în config).
"""
from __future__ import annotations

import numpy as np
import pandas as pd


class Fingerprints:
    def __init__(self, keys: list[str], weights: dict[str, float] | None = None):
        self.keys = keys
        self.w = np.array([max(0.05, (weights or {}).get(k, 0.5)) for k in keys])
        self.w = self.w / self.w.sum() * len(keys)
        self.center = None
        self.scale = None

    def fit(self, population: pd.DataFrame, ref_size: int = 1500, seed: int = 4) -> "Fingerprints":
        X = population[self.keys]
        self.center = X.median()
        iqr = X.quantile(0.75) - X.quantile(0.25)
        self.scale = iqr.where(iqr > 1e-9, X.std().where(X.std() > 1e-9, 1.0))
        # eșantion de referință: similaritatea se exprimă ca „mai aproape decât X% din univers”
        sample = population.sample(min(len(population), ref_size), random_state=seed)
        self.P = self.transform(sample)
        return self

    def transform(self, frame: pd.DataFrame) -> np.ndarray:
        Z = ((frame[self.keys] - self.center) / self.scale).clip(-4, 4)
        return Z.to_numpy(dtype=float)

    def distance(self, A: np.ndarray, B: np.ndarray) -> np.ndarray:
        """Matrice |A|×|B| de distanțe ponderate (media pătratelor); factorii lipsă se ignoră."""
        out = np.full((len(A), len(B)), np.nan)
        for i, a in enumerate(A):
            d = B - a
            ok = ~np.isnan(d)
            cnt = (ok * self.w).sum(axis=1)
            sq = np.where(ok, d * d, 0.0) @ self.w
            out[i] = np.where(cnt > len(self.keys) * 0.35, sq / np.maximum(cnt, 1e-9), np.nan)
        return out

    def similarity(self, A: np.ndarray, B: np.ndarray) -> np.ndarray:
        """Similaritate percentilă în [0,1]: 0.9 = A e mai aproape de B decât 90% din univers."""
        if len(A) == 0 or len(B) == 0:
            return np.zeros((len(A), len(B)))
        dAB = self.distance(A, B)
        dPB = np.sort(self.distance(self.P, B), axis=0)  # |P|×|B|, distribuția distanțelor față de B
        out = np.zeros_like(dAB)
        for j in range(len(B)):
            col = dPB[:, j]
            col = col[~np.isnan(col)]
            if not len(col):
                continue
            rank = np.searchsorted(col, np.nan_to_num(dAB[:, j], nan=np.inf), side="left")
            out[:, j] = 1.0 - rank / len(col)
        return np.clip(out, 0.0, 1.0)


def reference_events(df: pd.DataFrame, refs: list[dict], key_of: dict[str, str], lookback_days: int = 60,
                     target: float = 0.5) -> list[dict]:
    """Pentru fiecare referință: cea mai mare creștere RECENTĂ (ultimele `lookback_days` zile, cu
    fwd_max ≥ ținta); dacă nu există, cea mai mare din tot istoricul. `date` din config o fixează."""
    out = []
    end = df["date"].max()
    for r in refs:
        key = key_of.get(r.get("symbol", "").upper()) or r.get("key")
        sub = df[(df["key"] == key) & df["fwd_max"].notna()] if key else df.iloc[0:0]
        if r.get("date"):
            sub = sub[sub["date"] == pd.Timestamp(r["date"], tz="UTC")]
        else:
            recent = sub[(sub["date"] >= end - pd.Timedelta(days=lookback_days)) & (sub["fwd_max"] >= target)]
            sub = recent if not recent.empty else sub
        if sub.empty:
            out.append({**r, "resolved": False, "key": key})
            continue
        row = sub.loc[sub["fwd_max"].idxmax()]
        out.append({**r, "resolved": True, "key": key, "date": row["date"].date().isoformat(),
                    "gain": float(row["fwd_max"]), "_row": row})
    return out
