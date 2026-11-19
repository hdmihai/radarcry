"""Factori point-in-time: fiecare valoare la ziua t folosește DOAR date ≤ t.

Testul `test_no_lookahead` modifică viitorul și verifică că factorii trecutului nu se schimbă.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .catalog import FEATURE_KEYS

EPS = 1e-12


def _robust_z(x: pd.Series, window: int) -> pd.Series:
    """z robust al valorii de azi față de fereastra ANTERIOARĂ (mediană + MAD·1.4826)."""
    base = x.shift(1)
    med = base.rolling(window, min_periods=max(7, window // 3)).median()
    mad = (base - med).abs().rolling(window, min_periods=max(7, window // 3)).median() * 1.4826
    return (x - med) / mad.where(mad > EPS)


def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.where(dn > EPS)
    out = 100 - 100 / (1 + rs)
    return out.where(dn > EPS, 100.0).where(up.notna())


def _streak(up: pd.Series) -> pd.Series:
    grp = (~up).cumsum()
    return up.astype(int).groupby(grp).cumsum()


def _pct_rank_last(x: np.ndarray) -> float:
    last = x[-1]
    if np.isnan(last):
        return np.nan
    v = x[~np.isnan(x)]
    return float((v < last).sum() / max(1, len(v) - 1)) if len(v) > 1 else np.nan


def asset_features(g: pd.DataFrame) -> pd.DataFrame:
    """Factorii unui singur activ. `g` e sortat pe dată, calendar zilnic continuu."""
    c, h, l, o, v = g["close"], g["high"], g["low"], g["open"], g["volume"].fillna(0.0)
    f = pd.DataFrame(index=g.index)
    f["ret_1d"] = c / c.shift(1) - 1
    f["ret_3d"] = c / c.shift(3) - 1
    f["ret_7d"] = c / c.shift(7) - 1
    f["ret_30d"] = c / c.shift(30) - 1
    hi90 = h.rolling(90, min_periods=20).max()
    f["dist_high_90"] = c / hi90 - 1
    f["dd_ath"] = c / h.cummax() - 1
    lo30 = l.rolling(30, min_periods=10).min()
    hi30 = h.rolling(30, min_periods=10).max()
    f["rebound_low_30"] = c / lo30 - 1
    f["range_pos_30"] = (c - lo30) / (hi30 - lo30).where((hi30 - lo30) > EPS)
    f["days_since_low_90"] = c.rolling(90, min_periods=20).apply(lambda x: len(x) - 1 - int(np.nanargmin(x)), raw=True)
    sma = c.rolling(20, min_periods=15).mean()
    sd = c.rolling(20, min_periods=15).std()
    f["bb_width"] = 4 * sd / sma
    f["bb_width_pct90"] = f["bb_width"].rolling(90, min_periods=30).apply(_pct_rank_last, raw=True)
    tr = pd.concat([h - l, (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1) / c.shift(1)
    f["atr_ratio_7_30"] = tr.rolling(7, min_periods=5).mean() / tr.rolling(30, min_periods=15).mean()
    f["rsi_14"] = _rsi(c)
    up = c > c.shift(1)
    f["streak_up"] = _streak(up.fillna(False)).clip(upper=10)
    rng = (h - l).where((h - l) > EPS)
    f["close_loc"] = (c - l) / rng
    f["wick_up"] = (h - pd.concat([o, c], axis=1).max(axis=1)) / c
    lv = np.log1p(v)
    f["vol_z30"] = _robust_z(lv, 30)
    f["vol_ratio_7_30"] = v.rolling(7, min_periods=5).mean() / v.shift(7).rolling(30, min_periods=15).mean().where(lambda s: s > 0)
    f["vol_ratio_3_14"] = v.rolling(3, min_periods=2).mean() / v.shift(3).rolling(14, min_periods=7).mean().where(lambda s: s > 0)
    upv = (v * up).rolling(14, min_periods=7).sum()
    f["up_vol_share_14"] = upv / v.rolling(14, min_periods=7).sum().where(lambda s: s > 0)
    obv = (np.sign(c.diff()).fillna(0) * v).cumsum()
    f["obv_slope_14"] = (obv - obv.shift(14)) / (14 * v.rolling(14, min_periods=7).mean()).where(lambda s: s > 0)
    mcap = g["mcap"]
    f["turnover"] = v / mcap.where(mcap > 0)
    f["log_mcap"] = np.log10(mcap.where(mcap > 0))
    f["age_days"] = np.arange(len(g), dtype=float)
    oi = g["oi"].where(g["oi"] > 0)
    has = oi.notna()
    f["has_perp"] = has.astype(float)
    first = has.cummax()
    f["perp_age_days"] = first.astype(int).groupby((~first).cumsum()).cumsum().where(first).astype(float)
    f["oi_chg_1d"] = oi / oi.shift(1) - 1
    f["oi_chg_7d"] = oi / oi.shift(7) - 1
    f["oi_to_mcap"] = oi / mcap.where(mcap > 0)
    f["oi_to_vol"] = oi / v.where(v > 0)
    fund = g["funding"]
    f["funding_1d"] = fund
    f["funding_3d"] = fund.rolling(3, min_periods=1).mean().where(fund.notna())
    f["lsr"] = g["lsr"]
    f["top_lsr"] = g["top_lsr"]
    ls, ll = g["liq_short"], g["liq_long"]
    f["liq_short_z"] = _robust_z(np.log1p(ls), 30).where(ls.notna())
    f["liq_short_share"] = ls / (ls + ll).where((ls + ll) > 0)
    return f.replace([np.inf, -np.inf], np.nan)


def regularize(panel: pd.DataFrame) -> pd.DataFrame:
    """Calendar zilnic continuu per activ (zilele lipsă devin NaN, nu sunt inventate)."""
    out = []
    for key, g in panel.groupby("key", sort=False):
        g = g.sort_values("date").drop_duplicates("date", keep="last").set_index("date")
        idx = pd.date_range(g.index.min(), g.index.max(), freq="D", tz="UTC")
        g = g.reindex(idx)
        g["key"] = key
        g["partial"] = g["partial"].fillna(False).astype(bool)
        g.index.name = "date"
        out.append(g.reset_index())
    if not out:
        return panel.iloc[0:0]
    return pd.concat(out, ignore_index=True)


def build_features(panel: pd.DataFrame, market_key: str | None = "BTC") -> pd.DataFrame:
    """Panel → tabel de factori (key, date, factori…). Include factorii de regim de piață."""
    reg = regularize(panel)
    parts = []
    for _, g in reg.groupby("key", sort=False):
        g = g.reset_index(drop=True)
        f = asset_features(g)
        f.insert(0, "date", g["date"])
        f.insert(0, "key", g["key"].values)
        f["partial"] = g["partial"].values
        f["close"] = g["close"].values
        f["high"] = g["high"].values
        f["volume"] = g["volume"].values
        parts.append(f)
    feats = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["key", "date", *FEATURE_KEYS])
    if feats.empty:
        return feats
    assets = feats[feats["key"] != market_key]
    daily = assets.groupby("date").agg(mkt_ret_7d=("ret_7d", "median"), mkt_breadth=("ret_1d", lambda s: float((s > 0).mean()) if s.notna().any() else np.nan))
    feats = feats.merge(daily, left_on="date", right_index=True, how="left")
    btc = feats.loc[feats["key"] == market_key, ["date", "ret_7d"]].rename(columns={"ret_7d": "btc_ret_7d"})
    if not btc.empty:
        feats = feats.merge(btc, on="date", how="left")
    else:
        feats["btc_ret_7d"] = np.nan
    feats["rel_btc_7d"] = feats["ret_7d"] - feats["btc_ret_7d"]
    feats["rel_mkt_7d"] = feats["ret_7d"] - feats["mkt_ret_7d"]
    for k in FEATURE_KEYS:
        if k not in feats.columns:
            feats[k] = np.nan
    return feats
