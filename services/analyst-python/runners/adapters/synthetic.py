"""Piață sintetică deterministă — pentru teste și pentru modul demo (fără rețea).

Tiparul plantat (cunoscut): compresie de volatilitate + funding negativ + OI în creștere +
volum anormal ⇒ în următoarele zile prețul urcă puternic (short squeeze). Testele verifică
faptul că factorii, regulile și modelul îl redescoperă.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def synthetic_panel(n_assets: int = 60, days: int = 420, seed: int = 5, end: pd.Timestamp | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    end = (end or pd.Timestamp.now(tz="UTC")).normalize() - pd.Timedelta(days=1)
    dates = pd.date_range(end=end, periods=days, freq="D", tz="UTC")
    rows, assets = [], []
    btc = 60000 * np.exp(np.cumsum(rng.normal(0, 0.02, days)))
    for d, c in zip(dates, btc):
        rows.append(("BTC", d, c, c * 1.01, c * 0.99, c, 2e10, 1.2e12, np.nan, np.nan, np.nan, np.nan, np.nan, np.nan))
    for i in range(n_assets):
        key = f"cg:syn-{i:03d}"
        supply = rng.uniform(5e6, 2e8)
        price = rng.uniform(0.05, 3.0)
        has_perp = i % 3 != 2
        r = rng.normal(-0.002, 0.045, days)
        vol_scale = rng.uniform(2e5, 5e6)
        v = vol_scale * np.exp(rng.normal(0, 0.35, days))
        fund = rng.normal(0.0001, 0.00012, days)
        oi = np.full(days, np.nan)
        if has_perp:
            oi = vol_scale * rng.uniform(0.3, 1.2) * np.exp(np.cumsum(rng.normal(0, 0.03, days)))
        k = 60
        while k < days - 20:
            if rng.random() < 0.035:
                # setup: 5 zile de compresie, apoi semnal la ziua s, explozie în s+1..s+5
                s = k + 5
                r[k:s] = rng.normal(0, 0.008, s - k)
                v[s] *= rng.uniform(3.0, 6.0)
                if has_perp:
                    fund[s - 2:s + 1] = -abs(rng.normal(0.0006, 0.0002, 3))
                    oi[s - 2:s + 1] *= np.array([1.15, 1.3, 1.5])
                r[s + 1:s + 6] = rng.normal(0.14, 0.05, 5)
                v[s + 1:s + 6] *= 5
                r[s + 6:s + 12] = rng.normal(-0.06, 0.03, 6)
                k = s + 14
            k += 1
        if i % 6 == 0:  # setup proaspăt în ultima zi (pentru demo: candidați „PRE”)
            s = days - 1
            r[s - 5:s] = rng.normal(0, 0.008, 5)
            v[s] *= 4.0
            if has_perp:
                fund[s - 2:s + 1] = -abs(rng.normal(0.0006, 0.0002, 3))
                oi[s - 2:s + 1] *= np.array([1.15, 1.3, 1.5])
        close = price * np.exp(np.cumsum(r))
        openp = np.concatenate([[close[0]], close[:-1]])
        high = np.maximum(openp, close) * (1 + np.abs(rng.normal(0, 0.02, days)))
        low = np.minimum(openp, close) * (1 - np.abs(rng.normal(0, 0.02, days)))
        for j, d in enumerate(dates):
            rows.append((key, d, openp[j], high[j], low[j], close[j], v[j], close[j] * supply,
                         oi[j], fund[j] if has_perp else np.nan, rng.uniform(0.6, 1.6) if has_perp else np.nan,
                         rng.uniform(0.7, 1.4) if has_perp else np.nan,
                         abs(rng.normal(2e4, 1e4)) if has_perp else np.nan, abs(rng.normal(2e4, 1e4)) if has_perp else np.nan))
        assets.append({"key": key, "symbol": f"SYN{i}", "name": f"Synthetic {i}", "chain": ["bsc", "solana", "ethereum", "base"][i % 4],
                       "price": close[-1], "marketCap": close[-1] * supply, "volume24h": v[-1], "alpha": "B" if i % 5 == 0 else "",
                       "perps": 2 if has_perp else 0, "spotList": ["G", "M"], "korean": i % 7 == 0, "spotVenues": 2})
    cols = ["key", "date", "open", "high", "low", "close", "volume", "mcap", "oi", "funding", "lsr", "top_lsr", "liq_long", "liq_short"]
    panel = pd.DataFrame(rows, columns=cols)
    panel["partial"] = False
    panel["src"] = "synthetic"
    return panel, pd.DataFrame(assets)
