"""Pipeline-ul complet: refresh date (bugetat) → factori → etichete → factori comuni → reguli →
model (walk-forward) → similaritate → candidați → data/runners.json.
"""
from __future__ import annotations

import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from .. import __version__
from ..adapters.radar import SPOT_NAMES
from ..adapters.store import upsert
from ..domain.catalog import FEATURE_KEYS, MARKET_KEYS, fmt, label
from ..domain.factors import common_factors
from ..domain.features import build_features
from ..domain.labels import add_labels
from ..domain.model import RunnerModel
from ..domain.rules import learn_rules
from ..domain.scoring import explain, matched_rules, risks_of, stage_of, tier_of
from ..domain.similarity import Fingerprints, reference_events
from ..ports import empty_panel

MARKET_KEY = "BTC"
ASSET_KEYS = [k for k in FEATURE_KEYS if k not in MARKET_KEYS]


@dataclass
class Settings:
    horizon: int = 7
    target: float = 0.5
    jump: float = 0.25
    history_days: int = 730
    max_candidates: int = 40
    min_train_volume: float = 50_000.0
    references: list = field(default_factory=list)

    @classmethod
    def load(cls, path: Path | None) -> "Settings":
        doc = {}
        if path and Path(path).exists():
            doc = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(horizon=int(doc.get("horizonDays", 7)), target=float(doc.get("targetReturn", 0.5)),
                   jump=float(doc.get("jumpReturn", 0.25)), history_days=int(doc.get("historyDays", 730)),
                   max_candidates=int(doc.get("maxCandidates", 40)), references=list(doc.get("references", [])))


def _f(x, nd=4):
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) or math.isinf(v) else round(v, nd)


# ----------------------------------------------------------------------------------------- refresh
def refresh(panel: pd.DataFrame, assets: pd.DataFrame, settings: Settings, gate, cg, store, budget_s: float,
            now: pd.Timestamp | None = None, log=print) -> tuple[pd.DataFrame, dict]:
    """Aduce date noi în limita bugetului de timp; ce nu se termină acum se continuă la rularea următoare."""
    from ..adapters.gate import match_symbol

    t0 = time.monotonic()
    now = now or pd.Timestamp.now(tz="UTC")
    today = now.normalize()
    stats = {"gatePairs": 0, "gateFull": 0, "gateIncremental": 0, "coingecko": 0, "errors": 0, "skippedBudget": 0}
    try:
        pairs, tickers, contracts = gate.spot_pairs(), gate.spot_tickers(), gate.futures_contracts()
    except RuntimeError as err:
        log(f"runners: Gate indisponibil ({err}) — folosesc istoricul salvat")
        return panel, {**stats, "gateDown": True}
    last = panel.groupby("key")["date"].agg(["max", "count"]) if not panel.empty else pd.DataFrame(columns=["max", "count"])
    jobs = [(MARKET_KEY, "BTC_USDT", None, 0.0)]
    seen = {MARKET_KEY}
    gate_override = {str(r.get("symbol", "")).upper(): r.get("gate") for r in settings.references if r.get("gate")}
    for a in assets.itertuples(index=False):
        sym = str(getattr(a, "symbol", "") or "").upper()
        pair = match_symbol(sym, getattr(a, "price", None), pairs, tickers)
        if not pair and gate_override.get(sym) in pairs:
            pair = gate_override[sym]
        if pair and a.key not in seen:
            seen.add(a.key)
            jobs.append((a.key, pair, pair if pair in contracts else None, float(getattr(a, "volume24h", 0) or 0)))
    for r in settings.references:  # referințe care nu sunt (încă) în universul radarului
        key = r.get("key") or f"ref:{str(r.get('symbol', '')).lower()}"
        if key not in seen and r.get("gate") in pairs:
            seen.add(key)
            jobs.append((key, r["gate"], r["gate"] if r["gate"] in contracts else None, 0.0))
    stats["gatePairs"] = len(jobs)

    def mode(key):
        if key in last.index and last.loc[key, "count"] >= 60 and last.loc[key, "max"] >= today - pd.Timedelta(days=4):
            return "inc"
        return "full"

    jobs.sort(key=lambda j: (mode(j[0]) != "inc", -j[3]))
    full_days = min(1000, settings.history_days)

    def work(job):
        key, pair, contract, _ = job
        if time.monotonic() - t0 > budget_s:
            return key, None, "budget"
        m = mode(key)
        try:
            df = gate.asset_history(pair, contract, 20 if m == "inc" else full_days, 20 if m == "inc" else 365)
        except RuntimeError:
            return key, None, "error"
        if df is None or df.empty:
            return key, None, "error"
        df["key"] = key
        return key, df, m

    fresh = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for key, df, m in ex.map(work, jobs):
            if m == "budget":
                stats["skippedBudget"] += 1
            elif m == "error":
                stats["errors"] += 1
            else:
                stats["gateIncremental" if m == "inc" else "gateFull"] += 1
                fresh.append(df)
    # CoinGecko pentru ce nu e pe Gate, cele mai vechi primele, în limita bugetului de cereri
    if cg is not None:
        missing = [a for a in assets.itertuples(index=False) if a.key not in seen and str(a.key).startswith("cg:")]
        def staleness(a):
            return last.loc[a.key, "max"] if a.key in last.index else pd.Timestamp(0, tz="UTC")
        missing = [a for a in missing if staleness(a) < today - pd.Timedelta(days=1)]
        missing.sort(key=staleness)
        for a in missing[: cg.budget]:
            if time.monotonic() - t0 > budget_s:
                break
            try:
                df = cg.daily(a.key[3:], 365)
            except RuntimeError:
                stats["errors"] += 1
                continue
            if not df.empty:
                df["key"] = a.key
                fresh.append(df)
                stats["coingecko"] += 1
    stats["seconds"] = round(time.monotonic() - t0, 1)
    merged = upsert(panel, pd.concat(fresh, ignore_index=True) if fresh else None, settings.history_days, now)
    return merged, stats


# ----------------------------------------------------------------------------------------- analyze
def _extrapolate_partial(panel: pd.DataFrame, now: pd.Timestamp) -> pd.DataFrame:
    """Lumânarea zilei în curs: volumul și lichidările se proiectează la 24h (minim 4h scurse)."""
    p = panel.copy()
    m = p["partial"].fillna(False).astype(bool)
    if m.any():
        hours = np.clip((now - p.loc[m, "date"]).dt.total_seconds() / 3600.0, 4.0, 24.0)
        for c in ("volume", "liq_long", "liq_short"):
            p.loc[m, c] = p.loc[m, c] * (24.0 / hours)
    return p


def _fill_mcap(panel: pd.DataFrame, assets: pd.DataFrame) -> pd.DataFrame:
    """Market cap istoric ≈ preț × ofertă circulantă curentă (unde sursa nu dă market cap)."""
    if assets.empty or "marketCap" not in assets.columns:
        return panel
    a = assets.dropna(subset=["marketCap", "price"])
    a = a[(a["price"] > 0) & (a["marketCap"] > 0)]
    supply = dict(zip(a["key"], a["marketCap"] / a["price"]))
    p = panel.copy()
    est = p["close"] * p["key"].map(supply)
    p["mcap"] = p["mcap"].where(p["mcap"] > 0, est)
    return p


def _s(x):
    return x if isinstance(x, str) and x else None


def _context(assets: pd.DataFrame, catalysts: list[dict], now: pd.Timestamp) -> dict[str, dict]:
    recent = {}
    cutoff = now - pd.Timedelta(days=7)
    for c in catalysts:
        try:
            t = pd.Timestamp(c.get("observedAt"))
        except (TypeError, ValueError):
            continue
        if t.tzinfo is None:
            t = t.tz_localize("UTC")
        if t >= cutoff and c.get("assetKey"):
            recent.setdefault(c["assetKey"], []).append(c.get("type"))
    out = {}
    for a in assets.to_dict("records"):
        out[a["key"]] = {
            "symbol": _s(a.get("symbol")), "name": _s(a.get("name")), "chain": _s(a.get("chain")),
            "price": _f(a.get("price"), 10), "marketCap": _f(a.get("marketCap"), 0), "volume24h": _f(a.get("volume24h"), 0),
            "alpha": _s(a.get("alpha")) or "", "perps": int(a.get("perps") or 0) if not pd.isna(a.get("perps")) else 0,
            "korean": bool(a.get("korean")), "spot": [SPOT_NAMES.get(x, x) for x in (a.get("spotList") or [])],
            "catalysts": sorted(set(recent.get(a["key"], []))),
        }
    return out


CATALYST_LABEL = {
    "TRENDING_ENTRY": "intrat în trending CoinGecko", "RANK_JUMP": "salt în clasament", "VOLUME_SPIKE": "explozie de turnover",
    "OI_SURGE": "explozie de open interest", "FUNDING_FLIP_NEGATIVE": "funding întors negativ", "NEW_PERP": "perpetual nou",
    "NEW_MEXC_SPOT": "listare nouă MEXC", "NEW_BINANCE_SPOT": "listare nouă Binance", "NEW_BITHUMB_KRW": "listare nouă Bithumb (KRW)",
    "NEW_UPBIT_KRW": "listare nouă Upbit (KRW)", "NEW_GATE_ALPHA": "intrat în Gate Alpha", "NEW_BINANCE_ALPHA": "intrat în Binance Alpha",
    "KRW_WARNING": "avertisment bursă coreeană",
}


def analyze(panel: pd.DataFrame, assets: pd.DataFrame, catalysts: list[dict], settings: Settings,
            now: pd.Timestamp | None = None, sources: dict | None = None) -> dict:
    now = now or pd.Timestamp.now(tz="UTC")
    H = settings.horizon
    p = _fill_mcap(_extrapolate_partial(panel, now), assets)
    feats = build_features(p, MARKET_KEY)
    df = add_labels(feats, H, settings.target, settings.jump)
    df = df[df["key"] != MARKET_KEY].reset_index(drop=True)
    lab = df[df["labeled"] & (df["volume"] >= settings.min_train_volume)].copy()
    doc = {
        "version": __version__, "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "horizonDays": H, "target": {"fwdMaxReturn": settings.target, "jumpReturn": settings.jump,
                                       "definition": f"runner = maximul din următoarele {H} zile ≥ +{settings.target * 100:.0f}% peste închiderea zilei"},
        "universe": {"assets": int(df["key"].nunique()), "rows": int(len(df)), "labeledRows": int(len(lab)),
                     "from": df["date"].min().date().isoformat() if len(df) else None, "to": df["date"].max().date().isoformat() if len(df) else None},
        "sources": sources or {}, "metrics": {}, "factors": [], "rules": [], "references": [], "events": [], "candidates": [],
        "importance": [], "notes": [],
    }
    if len(lab) < 500 or lab["y"].sum() < 15:
        doc["notes"].append("Istoric insuficient pentru învățare — lista se completează pe măsură ce panelul crește.")
        return doc
    lab = lab.sort_values("date")
    doc["universe"]["runnerDays"] = int(lab["y"].sum())
    doc["universe"]["runnerEvents"] = int(lab["run_start"].sum())
    doc["universe"]["baseRate"] = round(float(lab["y"].mean()), 4)

    # 1) factorii comuni
    factors = common_factors(lab, ASSET_KEYS)
    profile = {f["key"]: f for f in factors}
    doc["factors"] = [{k: (_f(v) if isinstance(v, float) else v) for k, v in f.items()} for f in factors]

    # 2) reguli (antrenare pe 75% din zile, validare out-of-time pe ultimele 25%, cu embargo H)
    dates = np.array(sorted(lab["date"].unique()))
    cut = pd.Timestamp(dates[int(len(dates) * 0.75)])
    train = lab[lab["date"] < cut - pd.Timedelta(days=H)]
    valid = lab[lab["date"] >= cut]
    rules, _ = learn_rules(train, valid, ASSET_KEYS)
    doc["rules"] = rules

    # 3) model walk-forward
    model = RunnerModel(FEATURE_KEYS, horizon=H, embargo=H).fit(lab)
    doc["metrics"] = model.metrics
    doc["importance"] = [{**i, "label": label(i["key"])} for i in model.importance()[:20]]
    base = max(model.metrics.get("baseRate", model.base_rate) or model.base_rate, 1e-6)

    # 4) amprente
    fp_keys = [f["key"] for f in factors[:14]] or ASSET_KEYS[:14]
    fp = Fingerprints(fp_keys, {f["key"]: f["strength"] for f in factors}).fit(lab.sample(min(len(lab), 50000), random_state=1))
    ev = lab[lab["run_start"]].copy()
    E = fp.transform(ev)
    key_of = {}
    if not assets.empty:
        for a in assets.itertuples(index=False):
            key_of.setdefault(str(a.symbol).upper(), a.key)
    for r in settings.references:
        if r.get("key"):
            key_of[str(r.get("symbol", "")).upper()] = r["key"]
    full_lab = df[df["labeled"]]
    refs = reference_events(full_lab, settings.references, key_of, target=settings.target)
    ref_rows = [r for r in refs if r.get("resolved")]
    R = fp.transform(pd.DataFrame([r["_row"] for r in ref_rows])) if ref_rows else np.zeros((0, len(fp_keys)))

    # 5) candidații curenți: ultimul rând per activ, recent
    latest = df.sort_values("date").groupby("key").tail(1)
    latest = latest[latest["date"] >= now.normalize() - pd.Timedelta(days=2)].reset_index(drop=True)
    ctx = _context(assets, catalysts, now)
    if latest.empty:
        doc["notes"].append("Nicio lumânare recentă în panel.")
        return doc
    prob = model.predict(latest)
    contrib = model.contributions(latest)
    hits = matched_rules(latest, rules)
    C = fp.transform(latest)
    sim_ev = fp.similarity(C, E) if len(E) else np.zeros((len(latest), 0))
    sim_ref = fp.similarity(C, R) if len(R) else np.zeros((len(latest), 0))
    ev_keys, ev_dates, ev_gain = ev["key"].to_numpy(), ev["date"].to_numpy(), ev["fwd_max"].to_numpy()
    rows = []
    for i, row in latest.iterrows():
        lift = float(prob[i] / base)
        rdict = row.to_dict()
        c = ctx.get(row["key"], {})
        if (c.get("volume24h") or row.get("volume") or 0) < 100_000:
            continue
        if lift < 1.5 and len(hits[i]) < 2:
            continue
        stage, stage_why = stage_of(rdict)
        order = np.argsort(-sim_ev[i])
        nn = []
        for j in order:
            if ev_keys[j] == row["key"]:
                continue
            nn.append({"key": ev_keys[j], "symbol": (ctx.get(ev_keys[j]) or {}).get("symbol") or ev_keys[j],
                       "date": pd.Timestamp(ev_dates[j]).date().isoformat(), "gain": _f(ev_gain[j], 3), "similarity": _f(sim_ev[i, j], 3)})
            if len(nn) == 3:
                break
        refsim = [{"symbol": r["symbol"], "date": r["date"], "gain": _f(r["gain"], 3), "similarity": _f(sim_ref[i, j], 3)}
                  for j, r in enumerate(ref_rows) if r["key"] != row["key"]]
        all_f = explain(rdict, contrib[i], FEATURE_KEYS, profile)
        rows.append({
            "key": row["key"], "symbol": c.get("symbol") or row["key"], "name": c.get("name"), "chain": c.get("chain"),
            "price": c.get("price") or _f(row["close"], 10), "marketCap": c.get("marketCap"), "volume24h": c.get("volume24h"),
            "asOf": row["date"].date().isoformat(), "partialDay": bool(row["partial"]),
            "probability": _f(prob[i]), "lift": _f(lift, 2), "tier": tier_of(lift), "stage": stage, "stageWhy": stage_why,
            "drivers": [f for f in all_f if f["contribution"] > 0][:6],
            "headwinds": [f for f in all_f if f["contribution"] < 0][:4],
            "factors": all_f, "rulesMatched": hits[i], "similarTo": nn, "references": refsim,
            "context": {"alpha": c.get("alpha"), "perps": c.get("perps"), "korean": c.get("korean"), "spot": c.get("spot"),
                        "catalysts": [CATALYST_LABEL.get(t, t) for t in c.get("catalysts", [])]},
            "risks": risks_of(rdict, c),
            "_sort": (stage == "EXTINS", -prob[i], -len(hits[i])),
        })
    # cei deja „extinși” (≥80% în 7 zile) rămân vizibili, dar după cei care n-au plecat încă
    rows.sort(key=lambda r: r["_sort"])
    for n, r in enumerate(rows[: settings.max_candidates], 1):
        r.pop("_sort")
        r["rank"] = n
    doc["candidates"] = rows[: settings.max_candidates]

    # 6) referințe + evenimente recente (ce au avut în comun)
    pop = lab.sample(min(len(lab), 50000), random_state=2)
    sign = {f["key"]: (1 if f["auc"] >= 0.5 else -1, f["strength"]) for f in factors}

    def distinctive(row, n=6):
        out = []
        for k, (sg, st) in sign.items():
            v = row.get(k)
            if v is None or (isinstance(v, float) and math.isnan(v)):
                continue
            pct = float((pop[k] < v).mean())
            score = (pct - 0.5) * sg * st
            if score > 0:
                out.append({"key": k, "label": label(k), "text": fmt(k, v), "percentile": round(pct * 100), "score": round(score, 4)})
        return sorted(out, key=lambda x: -x["score"])[:n]

    for r in refs:
        item = {k: v for k, v in r.items() if not k.startswith("_")}
        if r.get("resolved"):
            item["factors"] = distinctive(r["_row"].to_dict(), 8)
        doc["references"].append(item)
    recent = ev[ev["date"] >= ev["date"].max() - pd.Timedelta(days=60)].sort_values("date", ascending=False).head(25)
    for _, e in recent.iterrows():
        c = ctx.get(e["key"], {})
        doc["events"].append({"key": e["key"], "symbol": c.get("symbol") or e["key"], "name": c.get("name"),
                              "date": e["date"].date().isoformat(), "gain": _f(e["fwd_max"], 3),
                              "jumpNextDays": bool(df[(df["key"] == e["key"]) & (df["date"] > e["date"]) & (df["date"] <= e["date"] + pd.Timedelta(days=H))]["jump"].any()),
                              "factors": distinctive(e.to_dict())})
    if not any(r.get("resolved") for r in refs if str(r.get("symbol")).upper() == "SAMD"):
        doc["notes"].append("SAMD nu a putut fi identificat pe sursele gratuite (Gate/CoinGecko) — completează cheia în config/runners.json.")
    doc["notes"].append("Probabilități calibrate out-of-time; nu sunt recomandări de investiții. Deblocările de tokeni nu sunt în sursele gratuite — verifică-le manual.")
    return doc


def clean(o):
    """JSON strict: NaN/inf → null, tipuri numpy/pandas → tipuri Python (recursiv)."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (bool, np.bool_)):
        return bool(o)
    if isinstance(o, (int, np.integer)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        v = float(o)
        return None if math.isnan(v) or math.isinf(v) else v
    if o is None or isinstance(o, str):
        return o
    if isinstance(o, pd.Timestamp):
        return o.isoformat()
    try:
        if pd.isna(o):
            return None
    except (TypeError, ValueError):
        pass
    return str(o)


def write_json(doc: dict, path: Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(clean(doc), ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    tmp.replace(path)
