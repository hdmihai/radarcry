"""
CRI Radar — analistul cantitativ (domeniu pur).

Reguli, aceleași ca în motorul Node.js (src/domain):
  * zero I/O: nu citește fișiere, nu face cereri de rețea, nu citește ceasul;
  * determinism: aceleași date de intrare dau mereu același rezultat (nicio sursă aleatoare);
  * necunoscut ≠ negativ: o metrică ce nu se poate calcula este None, nu 0.

Intrare: payload-ul construit de api-node (domain/radar.js → analystPayload):
  { key, symbol, chain, contract, market{...},
    series{ d1:[[t,o,h,l,c,v],...], h4:[...], sparkline:[...] }, scoreHistory:[{at,score,stage,price}] }

Ieșire: metrici cantitative (Pandas/NumPy) + un scor cantitativ complementar scorului CRI.
Scorul acesta NU înlocuiește verdictul radarului: îl confirmă sau îl contrazice, cu motivele scrise.
"""
from __future__ import annotations

import math
from typing import Any, Iterable

import numpy as np
import pandas as pd

VERSION = "1.0.0"
MIN_POINTS = 20
EPS = 1e-12


class AnalysisError(ValueError):
    """Date insuficiente sau invalide pentru analiză (mapat la HTTP 422)."""


# ───────────────────────────── utilitare ─────────────────────────────


def _f(x: Any, nd: int = 6) -> float | None:
    """Float finit, rotunjit, sau None (necunoscut)."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return round(v, nd)


def robust_z(values: pd.Series) -> pd.Series:
    """Z-scor robust: (x − median) / (1.4826 × MAD) — aceeași normă ca motorul Node.js."""
    med = values.median()
    mad = (values - med).abs().median()
    scale = 1.4826 * mad
    if not np.isfinite(scale) or scale < EPS:
        return pd.Series(np.where(values.notna(), 0.0, np.nan), index=values.index)
    return (values - med) / scale


def frame_from_ohlcv(rows: Iterable[Iterable[float]]) -> pd.DataFrame:
    """[[tSec, o, h, l, c, v], ...] sau [[tSec, close], ...] → DataFrame indexat pe timp (UTC), sortat, fără duplicate."""
    data = []
    for r in rows:
        r = list(r)
        if len(r) == 2:  # [t, close] — seria zilnică publicată de venue
            data.append([r[0], np.nan, np.nan, np.nan, r[1], np.nan])
        elif len(r) >= 5:
            data.append((r + [np.nan])[:6])
    if not data:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    df = pd.DataFrame(data, columns=["t", "open", "high", "low", "close", "volume"])
    df = df.dropna(subset=["t", "close"])
    df = df[df["close"] > 0]
    df["t"] = pd.to_datetime(df["t"].astype("int64"), unit="s", utc=True)
    df = df.drop_duplicates("t", keep="last").set_index("t").sort_index()
    return df.astype(float)


# ───────────────────────────── metrici pe serie ─────────────────────────────


def rsi(close: pd.Series, period: int = 14) -> float | None:
    if len(close) <= period:
        return None
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    g, lo = gain.iloc[-1], loss.iloc[-1]
    if lo < EPS:
        return 100.0 if g > EPS else 50.0
    return float(100 - 100 / (1 + g / lo))


def trend(close: pd.Series, window: int = 30) -> dict[str, float | None]:
    """Regresie liniară pe log(preț): pantă pe perioadă (%) și R² (cât de curată e tendința)."""
    y = np.log(close.tail(window).to_numpy())
    if len(y) < 10:
        return {"slopePctPerPeriod": None, "r2": None}
    x = np.arange(len(y), dtype=float)
    slope, intercept = np.polyfit(x, y, 1)
    fit = slope * x + intercept
    ss_res = float(np.sum((y - fit) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > EPS else 0.0
    return {"slopePctPerPeriod": (math.exp(slope) - 1) * 100, "r2": r2}


def hurst(close: pd.Series, max_lag: int = 20) -> float | None:
    """Exponentul Hurst (varianța diferențelor pe lag-uri): >0.5 persistent, <0.5 revenire la medie."""
    x = np.log(close.to_numpy())
    lags = [lag for lag in range(2, max_lag) if lag < len(x) // 2]
    if len(lags) < 5:
        return None
    tau = [np.std(x[lag:] - x[:-lag]) for lag in lags]
    if min(tau) < EPS:
        return None
    slope = np.polyfit(np.log(lags), np.log(tau), 1)[0]
    return float(slope)


def drawdowns(close: pd.Series) -> dict[str, float | None]:
    peak = close.cummax()
    dd = close / peak - 1
    return {"maxDrawdownPct": float(dd.min() * 100), "currentDrawdownPct": float(dd.iloc[-1] * 100)}


def squeeze(close: pd.Series, window: int = 20) -> dict[str, float | None]:
    """Lățimea benzilor Bollinger și percentila ei istorică (mic = comprimare înaintea unei mișcări)."""
    if len(close) < window + 5:
        return {"bandwidth": None, "bandwidthPercentile": None}
    ma = close.rolling(window).mean()
    sd = close.rolling(window).std(ddof=0)
    bw = (4 * sd / ma).dropna()
    if bw.empty:
        return {"bandwidth": None, "bandwidthPercentile": None}
    pct = float((bw <= bw.iloc[-1]).mean() * 100)
    return {"bandwidth": float(bw.iloc[-1]), "bandwidthPercentile": pct}


def volume_profile(volume: pd.Series | None, close: pd.Series) -> dict[str, float | None]:
    if volume is None or volume.dropna().size < MIN_POINTS or float(volume.sum()) <= 0:
        return {"volumeZ": None, "volumeTrend": None, "obvSlope": None}
    v = volume.fillna(0)
    recent = float(v.tail(3).mean())
    base = v.iloc[:-3]
    med = float(base.median())
    mad = float((base - med).abs().median()) * 1.4826
    vz = (recent - med) / mad if mad > EPS else None
    vt = float(v.tail(7).mean() / v.tail(30).mean()) if float(v.tail(30).mean()) > EPS else None
    obv = (np.sign(close.diff().fillna(0)) * v).cumsum()
    tail = obv.tail(30).to_numpy()
    obv_slope = None
    if len(tail) >= 10 and float(np.abs(tail).max()) > EPS:
        obv_slope = float(np.polyfit(np.arange(len(tail)), tail / np.abs(tail).max(), 1)[0])
    return {"volumeZ": vz, "volumeTrend": vt, "obvSlope": obv_slope}


def atr_pct(df: pd.DataFrame, period: int = 14) -> float | None:
    if len(df) <= period or df[["high", "low"]].isna().any().any():
        return None
    prev = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(), (df["low"] - prev).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / period, adjust=False).mean().iloc[-1]
    return float(atr / df["close"].iloc[-1] * 100)


def series_metrics(close: pd.Series, volume: pd.Series | None = None, periods_per_year: float = 365.0) -> dict[str, Any]:
    """Toate metricile care se pot calcula dintr-o serie de prețuri (și, opțional, volume)."""
    close = close.astype(float).dropna()
    close = close[close > 0]
    if len(close) < MIN_POINTS:
        raise AnalysisError(f"prea puține puncte de preț ({len(close)} < {MIN_POINTS})")
    ret = np.log(close).diff().dropna()
    ann = math.sqrt(periods_per_year)
    mu, sd = float(ret.mean()), float(ret.std(ddof=1))
    downside = ret[ret < 0]
    dsd = float(downside.std(ddof=1)) if len(downside) > 1 else None
    q05 = float(ret.quantile(0.05))
    tail = ret[ret <= q05]

    def change(n: int) -> float | None:
        return float((close.iloc[-1] / close.iloc[-1 - n] - 1) * 100) if len(close) > n else None

    out: dict[str, Any] = {
        "points": int(len(close)),
        "last": float(close.iloc[-1]),
        "returnPct": {"p7": change(7), "p30": change(30), "total": float((close.iloc[-1] / close.iloc[0] - 1) * 100)},
        "volatilityAnnPct": sd * ann * 100 if sd > 0 else 0.0,
        "downsideVolAnnPct": dsd * ann * 100 if dsd else None,
        "sharpe": (mu / sd) * ann if sd > EPS else None,
        "sortino": (mu / dsd) * ann if dsd and dsd > EPS else None,
        "var95Pct": (math.exp(q05) - 1) * 100,
        "cvar95Pct": (math.exp(float(tail.mean())) - 1) * 100 if len(tail) else None,
        "skew": float(ret.skew()) if len(ret) > 3 else None,
        "kurtosis": float(ret.kurt()) if len(ret) > 4 else None,
        "rsi14": rsi(close),
        "hurst": hurst(close),
        **drawdowns(close),
        **trend(close),
        **squeeze(close),
        **volume_profile(volume.reindex(close.index) if volume is not None else None, close),
    }
    return out


# ───────────────────────────── verdict cantitativ ─────────────────────────────


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


def quant_verdict(m: dict[str, Any]) -> dict[str, Any]:
    """
    Scor 0–100 din patru familii, fiecare 0–1, cu ponderi fixe și scrise (fără optimizare ascunsă):
      tendință (30%)  pantă pozitivă × R²
      structură (25%) comprimare Bollinger + persistență Hurst
      participare (25%) volum peste normă + OBV în creștere
      risc (20%)      penalizare pentru drawdown adânc și volatilitate extremă
    Familia fără date intră cu 0.5 (neutru) și scade încrederea — necunoscut nu este negativ.
    """
    signals: list[str] = []
    flags: list[str] = []
    known = 0

    slope, r2 = m.get("slopePctPerPeriod"), m.get("r2")
    if slope is not None and r2 is not None:
        known += 1
        t = _clip01(0.5 + slope * 2) * (0.4 + 0.6 * _clip01(r2))
        if slope > 0 and r2 > 0.5:
            signals.append(f"tendință ascendentă curată (R² {r2:.2f})")
        elif slope < 0 and r2 > 0.5:
            flags.append(f"tendință descendentă curată (R² {r2:.2f})")
    else:
        t = 0.5

    bwp, h = m.get("bandwidthPercentile"), m.get("hurst")
    if bwp is not None:
        known += 1
        s = 0.6 * _clip01(1 - bwp / 100) + 0.4 * (_clip01((h - 0.3) / 0.4) if h is not None else 0.5)
        if bwp <= 20:
            signals.append(f"volatilitate comprimată (percentila {bwp:.0f} a lățimii Bollinger)")
    else:
        s = 0.5

    vz, obv = m.get("volumeZ"), m.get("obvSlope")
    if vz is not None or obv is not None:
        known += 1
        p = 0.6 * (_clip01(0.5 + vz / 6) if vz is not None else 0.5) + 0.4 * (_clip01(0.5 + obv * 25) if obv is not None else 0.5)
        if vz is not None and vz >= 2:
            signals.append(f"volum peste normă (z robust {vz:.1f})")
        if obv is not None and obv > 0.01 and (slope or 0) <= 0:
            signals.append("acumulare: OBV crește fără ca prețul să crească")
    else:
        p = 0.5

    mdd, vol = m.get("maxDrawdownPct"), m.get("volatilityAnnPct")
    known += 1
    r = 1.0
    if mdd is not None and mdd < -60:
        r -= 0.4
        flags.append(f"drawdown maxim {mdd:.0f}%")
    if vol is not None and vol > 250:
        r -= 0.3
        flags.append(f"volatilitate anualizată extremă ({vol:.0f}%)")
    rsi14 = m.get("rsi14")
    if rsi14 is not None and rsi14 >= 80:
        r -= 0.2
        flags.append(f"supracumpărat (RSI {rsi14:.0f})")
    r = _clip01(r)

    score = 100 * (0.30 * t + 0.25 * s + 0.25 * p + 0.20 * r)
    band = "FAVORABIL" if score >= 65 else "NEUTRU" if score >= 45 else "NEFAVORABIL"
    return {
        "quantScore": round(score, 1),
        "band": band,
        "components": {"trend": round(t, 3), "structure": round(s, 3), "participation": round(p, 3), "risk": round(r, 3)},
        "confidence": round(known / 4, 2),
        "signals": signals,
        "flags": flags,
        "note": "Scor cantitativ complementar scorului CRI, calculat doar din preț și volum. Cercetare, nu sfat financiar.",
    }


def score_alignment(history: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Cât de mult a urmat prețul scorul CRI în istoricul publicat (corelația Spearman a schimbărilor)."""
    rows = [h for h in history if h.get("score") is not None and h.get("price")]
    if len(rows) < 6:
        return None
    df = pd.DataFrame(rows)
    d = pd.DataFrame({"score": df["score"].astype(float).diff(), "price": np.log(df["price"].astype(float)).diff()}).dropna()
    if len(d) < 5 or d["score"].std() < EPS or d["price"].std() < EPS:
        return None
    rho = float(d["score"].rank().corr(d["price"].rank()))
    return {"spearman": round(rho, 3), "points": int(len(d)), "reading": "scorul și prețul se mișcă împreună" if rho > 0.3 else "scorul anticipează sau diverge de preț" if rho < -0.3 else "fără relație clară"}


def _pick_series(series: dict[str, Any]) -> tuple[str, pd.DataFrame | None, pd.Series, float]:
    d1 = frame_from_ohlcv(series.get("d1") or [])
    if len(d1) >= MIN_POINTS:
        return "d1", d1, d1["close"], 365.0
    h4 = frame_from_ohlcv(series.get("h4") or [])
    if len(h4) >= MIN_POINTS:
        return "h4", h4, h4["close"], 365.0 * 6
    spark = [x for x in (series.get("sparkline") or []) if isinstance(x, (int, float)) and x > 0]
    if len(spark) >= MIN_POINTS:
        return "sparkline", None, pd.Series(spark, dtype=float), 365.0
    raise AnalysisError("lipsesc seriile de preț (d1, h4 sau sparkline cu cel puțin 20 de puncte)")


def _clean(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (float, np.floating)):
        return _f(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    return obj


def _asset_metrics(payload: dict[str, Any]) -> tuple[str, pd.Series, dict[str, Any]]:
    """Metricile unui proiect — aceeași funcție pentru /asset și /universe, deci același scor."""
    series = payload.get("series") or {}
    used, df, close, ppy = _pick_series(series)
    volume = df["volume"] if df is not None and "volume" in df else None
    m = series_metrics(close, volume, ppy)
    m["volumeSource"] = used if m.get("volumeZ") is not None or m.get("obvSlope") is not None else None
    m["atrPct14"] = atr_pct(df) if df is not None else None
    m["atrSource"] = used if m["atrPct14"] is not None else None
    # Seria zilnică [t, close] nu are volum și nici high/low: participarea și ATR se iau din h4,
    # care le are complete. Fiecare câmp spune din ce serie provine.
    if used == "d1":
        h4 = frame_from_ohlcv(series.get("h4") or [])
        if len(h4) >= MIN_POINTS:
            if m.get("volumeZ") is None and m.get("obvSlope") is None:
                vp = volume_profile(h4["volume"], h4["close"])
                if any(v is not None for v in vp.values()):
                    m.update(vp)
                    m["volumeSource"] = "h4"
            if m["atrPct14"] is None:
                m["atrPct14"] = atr_pct(h4)
                m["atrSource"] = "h4" if m["atrPct14"] is not None else None
    if df is not None:
        hi = float(df["high"].tail(30).max()) if df["high"].notna().any() else float(close.tail(30).max())
        lo = float(df["low"].tail(30).min()) if df["low"].notna().any() else float(close.tail(30).min())
    else:
        hi, lo = float(close.tail(30).max()), float(close.tail(30).min())
    m["rangePosition30"] = (float(close.iloc[-1]) - lo) / (hi - lo) if hi - lo > EPS else None
    return used, close, m


def analyze_asset(payload: dict[str, Any]) -> dict[str, Any]:
    """Analiza completă a unui proiect."""
    used, _close, m = _asset_metrics(payload)
    market = payload.get("market") or {}
    mc, vol24 = market.get("marketCap"), market.get("volume24h")
    liquidity = {"turnover": (vol24 / mc) if mc and vol24 is not None and mc > 0 else None, "fdvToMcap": (market["fdv"] / mc) if mc and market.get("fdv") else None}
    return _clean(
        {
            "version": VERSION,
            "key": payload.get("key"),
            "symbol": payload.get("symbol"),
            "seriesUsed": used,
            "metrics": m,
            "liquidity": liquidity,
            "verdict": quant_verdict(m),
            "scoreAlignment": score_alignment(payload.get("scoreHistory") or []),
        }
    )


def analyze_series(closes: list[float], volumes: list[float] | None = None, periods_per_year: float = 365.0, symbol: str | None = None) -> dict[str, Any]:
    close = pd.Series(closes, dtype=float)
    vol = pd.Series(volumes, dtype=float) if volumes is not None else None
    m = series_metrics(close, vol, periods_per_year)
    return _clean({"version": VERSION, "symbol": symbol, "metrics": m, "verdict": quant_verdict(m)})


# ───────────────────────────── analiză transversală ─────────────────────────────


def _clusters(corr: pd.DataFrame, threshold: float) -> list[list[str]]:
    """Componente conexe în graful „corelație ≥ prag” — deterministe, fără SciPy."""
    keys = list(corr.columns)
    seen: set[str] = set()
    groups: list[list[str]] = []
    for k in keys:
        if k in seen:
            continue
        stack, comp = [k], []
        seen.add(k)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for other in keys:
                if other not in seen and corr.at[cur, other] >= threshold:
                    seen.add(other)
                    stack.append(other)
        if len(comp) > 1:
            groups.append(sorted(comp))
    return sorted(groups, key=lambda g: (-len(g), g))


def analyze_universe(assets: list[dict[str, Any]], corr_threshold: float = 0.7) -> dict[str, Any]:
    """
    Rang transversal: fiecare proiect față de restul radarului din aceeași rulare.
      * z-scoruri robuste (median/MAD) pentru randament, volatilitate, volum;
      * corelațiile randamentelor zilnice aliniate pe timp → clustere (proiecte care se mișcă la fel);
      * beta față de media echiponderată a universului.
    """
    rows, returns, errors = [], {}, []
    for a in assets:
        key = a.get("key") or a.get("symbol")
        try:
            used, close, m = _asset_metrics(a)
            v = quant_verdict(m)
            rows.append({"key": key, "symbol": a.get("symbol"), "seriesUsed": used, "quantScore": v["quantScore"], "band": v["band"], "return30": m["returnPct"]["p30"], "volatility": m["volatilityAnnPct"], "volumeSurge": m.get("volumeZ"), "maxDrawdown": m["maxDrawdownPct"], "sharpe": m.get("sharpe")})
            if used == "d1":
                returns[key] = np.log(close).diff()
        except AnalysisError as err:
            errors.append({"key": key, "error": str(err)})
    if len(rows) < 3:
        raise AnalysisError(f"analiza transversală cere cel puțin 3 proiecte analizabile (am {len(rows)})")

    df = pd.DataFrame(rows).set_index("key")
    for col in ["return30", "volatility", "volumeSurge", "quantScore"]:
        df[f"{col}Z"] = robust_z(df[col].astype(float))
        df[f"{col}Pct"] = df[col].astype(float).rank(pct=True) * 100

    clusters: list[list[str]] = []
    betas: dict[str, float | None] = {}
    rets = pd.DataFrame(returns).dropna(how="all")
    if rets.shape[1] >= 3 and rets.shape[0] >= MIN_POINTS:
        raw = rets.corr(min_periods=MIN_POINTS).fillna(0.0).to_numpy(copy=True)
        np.fill_diagonal(raw, 1.0)
        corr = pd.DataFrame(raw, index=rets.columns, columns=rets.columns)
        clusters = _clusters(corr, corr_threshold)
        market = rets.mean(axis=1)
        mv = float(market.var())
        for k in rets.columns:
            pair = pd.concat([rets[k], market], axis=1).dropna()
            betas[k] = float(pair.iloc[:, 0].cov(pair.iloc[:, 1]) / mv) if mv > EPS and len(pair) >= MIN_POINTS else None
    df["beta"] = pd.Series(betas)

    ranked = df.sort_values(["quantScore", "symbol"], ascending=[False, True])
    outliers = ranked[(ranked["volumeSurgeZ"].abs() >= 3) | (ranked["return30Z"].abs() >= 3)].index.tolist()
    items = [{"key": k, **{c: (None if pd.isna(v) else v) for c, v in r.items()}} for k, r in ranked.iterrows()]
    return _clean(
        {
            "version": VERSION,
            "assets": len(rows),
            "skipped": errors,
            "ranking": items,
            "top": [i["key"] for i in items[:10]],
            "outliers": outliers,
            "clusters": clusters,
            "correlationThreshold": corr_threshold,
            "bands": ranked["band"].value_counts().to_dict(),
        }
    )
