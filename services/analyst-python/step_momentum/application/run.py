"""Orchestrează: universul radarului → Gate (cu buget și cache) → regulile pure → documentul publicat."""
from __future__ import annotations

import time
from pathlib import Path

import pandas as pd

from ..adapters.cache import read_candles, write_candles
from ..adapters.synthetic import build_rows
from ..domain.rules import RULES, compute_step_momentum
from ..domain.universe import select_gate_assets
from ..domain.sectors import compute_sector_momentum
from .publish import clean

NOTES = (
    "Ecran de reguli pe lumânări de 1h și 4h. Nu este modelul LightGBM: acela rămâne la potențialii runneri pe 7 zile (data/runners.json), cu validare în afara eșantionului.",
    "Intră doar proiecte verificate de poarta de validitate, cu capitalizare 1–300 M$ și volum ≥ 500 000 $/zi, identificate pe Gate după preț, nu doar după simbol.",
    "O condiție fără date este necunoscută și iese din ponderare. Nu este numărată ca eșec și nu este tratată ca îndeplinită.",
    "Nu măsoară lift-ul de identificare și nu este sfat de tranzacționare. Cercetare.",
)
MAX_SIGNALS = 40


def _empty(now: pd.Timestamp, reasons: dict | None = None, note: str | None = None) -> dict:
    meta = {
        "universeRows": 0, "notVerified": 0, "outsideCap": 0, "thinVolume": 0,
        "priceUnconfirmed": 0, "notOnGate": 0, "withGate": 0, "futuresOnlyCount": 0,
        "evaluatedCount": 0, "signaledCount": 0, "deferredByBudget": 0,
        "insufficientHistory": 0, "missingCandles": 0, "oiUnavailable": 0,
    }
    if reasons:
        meta.update(reasons)
    notes = list(NOTES)
    if note:
        notes.append(note)
    return {
        "version": "1.0.0",
        "generatedAt": pd.Timestamp(now).tz_convert("UTC").isoformat() if pd.Timestamp(now).tzinfo else pd.Timestamp(now, tz="UTC").isoformat(),
        "method": "rules",
        "model": None,
        "notes": notes,
        "rules": [dict(r) for r in RULES],
        "stepMomentumMeta": meta,
        "stepMomentum": [],
    }


def _generated_at(now) -> str:
    ts = pd.Timestamp(now)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    else:
        ts = ts.tz_convert("UTC")
    return ts.isoformat()


def load_rows(universe_path: Path) -> list[dict]:
    from runners.adapters.radar import RadarFiles
    frame = RadarFiles(universe_path).assets()
    if frame is None or len(frame) == 0:
        return []
    rows = frame.to_dict(orient="records")
    for row in rows:
        for key, value in list(row.items()):
            try:
                if pd.isna(value):
                    row[key] = None
            except (TypeError, ValueError):
                continue
    return rows


def _cached_hourly(gate, cache_dir: Path | None, market: str, instrument: str, now: pd.Timestamp) -> pd.DataFrame:
    path = None
    cached = None
    if cache_dir is not None:
        path = Path(cache_dir) / "candles" / f"{market}_{instrument}.parquet"
        cached = read_candles(path)
    cutoff = pd.Timestamp(now)
    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")
    cutoff = cutoff.floor("1h")
    start = cutoff - pd.Timedelta(days=32)
    if cached is not None and len(cached):
        last = cached.index.max()
        if cutoff - last <= pd.Timedelta(hours=1):
            return cached[cached.index < cutoff]
        start = last - pd.Timedelta(hours=2)
    fresh = gate.hourly(market, instrument, start, cutoff + pd.Timedelta(hours=1))
    if fresh is None or len(fresh) == 0:
        frame = cached if cached is not None else pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    elif cached is None or len(cached) == 0:
        frame = fresh
    else:
        frame = pd.concat([cached, fresh])
        frame = frame[~frame.index.duplicated(keep="last")].sort_index()
    if len(frame):
        frame = frame[frame.index < cutoff]
        frame = frame[frame.index >= cutoff - pd.Timedelta(days=40)]
    if path is not None and len(frame):
        try:
            write_candles(path, frame)
        except (OSError, ValueError):
            pass
    return frame


def execute(*, rows, gate, coingecko=None, now, budget_s: float = 8 * 60, cache_dir: Path | None = None) -> dict:
    now = pd.Timestamp(now)
    if now.tzinfo is None:
        now = now.tz_localize("UTC")
    sector_map = {}
    if coingecko:
        try:
            sector_map = coingecko.build_sector_map(["ai-agents", "bnb-chain-ecosystem", "meme-token"])
        except Exception:
            pass
    deadline = time.monotonic() + max(1.0, budget_s)
    spot_last = gate.spot_last()
    futures_last = gate.futures_last()
    selected, reasons = select_gate_assets(rows, spot_last, futures_last)
    doc = _empty(now, reasons)
    meta = doc["stepMomentumMeta"]
    meta["withGate"] = len(selected)
    meta["futuresOnlyCount"] = sum(1 for a in selected if a["futuresOnly"])
    if time.monotonic() > deadline:
        meta["deferredByBudget"] = len(selected)
        return clean(doc)
    market = _cached_hourly(gate, cache_dir, "spot", "BTC_USDT", now)
    signals = []
    for asset in selected:
        if time.monotonic() > deadline:
            meta["deferredByBudget"] += 1
            continue
        if asset["gateSpotPair"]:
            candles = _cached_hourly(gate, cache_dir, "spot", asset["gateSpotPair"], now)
            source = "gate:spot:candles:1h"
        else:
            candles = _cached_hourly(gate, cache_dir, "futures", asset["gateFuturesContract"], now)
            source = "gate:futures:candlesticks:1h"
        if candles is None or len(candles) == 0:
            meta["missingCandles"] += 1
            continue
        stats = None
        if asset["gateFuturesContract"]:
            if time.monotonic() > deadline:
                meta["deferredByBudget"] += 1
                continue
            stats = gate.contract_stats(asset["gateFuturesContract"])
            if stats is None or len(stats) == 0:
                stats = None
                meta["oiUnavailable"] += 1
        result = compute_step_momentum(candles, futures_stats=stats, market1h=market, price_source=source)
        if result is None:
            meta["insufficientHistory"] += 1
            continue
        meta["evaluatedCount"] += 1
        if not result["isStepMomentum"]:
            continue
        meta["signaledCount"] += 1
        sectors = sector_map.get(asset["symbol"].upper(), [])
        sector_mom = compute_sector_momentum(sector_map, {asset["symbol"].upper(): result["metrics"].get("tokenChange7dPct", 0) or 0})
        signals.append({
            "key": asset["key"],
            "symbol": asset["symbol"],
            "name": asset["name"],
            "marketCap": asset["marketCap"],
            "volume24h": asset["volume24h"],
            "gateSpotPair": asset["gateSpotPair"],
            "gateFuturesContract": asset["gateFuturesContract"],
            "futuresOnly": asset["futuresOnly"],
            "sectors": sectors,
            "sectorMomentum": sector_mom,
            **result,
        })
    signals.sort(key=lambda row: (-row["score"], -row["known"], row["symbol"]))
    doc["stepMomentum"] = signals[:MAX_SIGNALS]
    doc["generatedAt"] = _generated_at(now)
    return clean(doc)


def synthetic_document(now=None) -> dict:
    now = pd.Timestamp(now or "2026-11-20T12:00:00Z")
    _, built = build_rows(now)
    signals = []
    evaluated = 0
    for symbol, result, fut in built:
        if result is None:
            continue
        evaluated += 1
        if not result["isStepMomentum"]:
            continue
        signals.append({
            "key": f"syn:{symbol}",
            "symbol": symbol,
            "name": symbol,
            "marketCap": 20_000_000,
            "volume24h": 1_000_000,
            "gateSpotPair": None if fut else f"{symbol}_USDT",
            "gateFuturesContract": f"{symbol}_USDT" if fut else None,
            "futuresOnly": fut,
            "sectors": [],
            **result,
        })
    doc = _empty(now, {
        "universeRows": len(built),
        "withGate": len(built),
        "evaluatedCount": evaluated,
        "signaledCount": len(signals),
    }, note="Rulare sintetică, fără rețea.")
    doc["stepMomentum"] = signals
    doc["generatedAt"] = _generated_at(now)
    return clean(doc)
