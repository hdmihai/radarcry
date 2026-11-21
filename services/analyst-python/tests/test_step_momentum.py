"""Momentum în trepte: reguli pure, univers, parsare Gate, contract sintetic."""
import json
from pathlib import Path

import pandas as pd
import pytest

from step_momentum.adapters.gate import parse_contract_stats, parse_futures_rows, parse_spot_rows
from step_momentum.application.publish import clean
from step_momentum.application.run import synthetic_document
from step_momentum.domain.rules import (
    HOURS_14D,
    compute_step_momentum,
    pct_over_hours,
    qualifies,
    resample_4h,
)
from step_momentum.domain.universe import select_gate_assets
from step_momentum.adapters.synthetic import failing_market, passing_market

ROOT = Path(__file__).resolve().parents[1]
NOW = pd.Timestamp("2026-11-20T12:00:00Z")


def test_parser_matches_live_gate_shapes():
    spot = parse_spot_rows([["1795176000", "54947500.92", "61561.5", "61850.3", "61233", "61814.2", "893.22", "true"]])
    assert list(spot.iloc[0][["open", "high", "low", "close", "volume"]]) == [61814.2, 61850.3, 61233.0, 61561.5, 54947500.92]
    partial = parse_spot_rows([["1795176000", "1", "2", "3", "1", "1", "1", "false"]])
    assert partial.empty
    fut = parse_futures_rows([{"o": "61789.7", "v": 10, "t": 1795176000, "c": "61530.8", "l": "61136.7", "h": "61824.9"}])
    assert float(fut.iloc[0]["close"]) == 61530.8
    assert float(fut.iloc[0]["low"]) == 61136.7
    stats = parse_contract_stats([
        {"time": 1795176000, "open_interest_usd": 1000, "lsr_taker": 0.64},
        {"time": 1795179600, "open_interest_usd": 1100, "lsr_taker": 0.7},
    ])
    assert len(stats) == 2
    assert float(stats["open_interest_usd"].iloc[-1]) == 1100


def test_short_oi_history_is_unknown_not_false():
    token, market, oi = passing_market(NOW)
    short = oi.iloc[-24:].copy()
    result = compute_step_momentum(token, futures_stats=short, market1h=market)
    assert result["conditions"]["openInterestGrowth14dGt20pct"] is None
    assert result["conditions"]["openInterestFasterThanPrice"] is None
    # cele 5 condiții de preț rămân adevărate; lipsa OI nu scoate semnalul
    assert result["score"] == 5 and result["known"] == 5
    assert result["isStepMomentum"] is True


def test_full_conditions_and_low_not_close():
    token, market, oi = passing_market(NOW)
    result = compute_step_momentum(token, futures_stats=oi, market1h=market)
    assert result["isStepMomentum"] is True
    assert result["score"] == 7 and result["known"] == 7
    assert all(result["conditions"].values())
    # fitilul de 50 nu schimbă close-ul, dar scoate câștigul din banda 15–60
    wicked = token.copy()
    wicked.iloc[-10, wicked.columns.get_loc("low")] = 50.0
    wicked_result = compute_step_momentum(wicked, futures_stats=oi, market1h=market)
    assert wicked_result["conditions"]["gain15To60PctFrom20dLow"] is False
    assert 15 <= result["metrics"]["gainFrom20dLowPct"] <= 60
    assert wicked_result["metrics"]["gainFrom20dLowPct"] > 60


def test_flat_market_is_not_a_signal_and_4h_is_used():
    token, market = failing_market(NOW)
    result = compute_step_momentum(token, futures_stats=None, market1h=market)
    assert result["isStepMomentum"] is False
    assert result["conditions"]["risingLows"] is False
    assert result["conditions"]["openInterestGrowth14dGt20pct"] is None
    stepped = resample_4h(passing_market(NOW)[0])
    assert len(stepped) >= 12
    # fără 4h, minimele pe 1h încă urcă; un 4h care coboară anulează condiția
    token, market, oi = passing_market(NOW)
    bad_4h = resample_4h(token).copy()
    bad_4h.iloc[-6:, bad_4h.columns.get_loc("low")] = 1.0
    veto = compute_step_momentum(token, candles4h=bad_4h, futures_stats=oi, market1h=market)
    assert veto["conditions"]["risingLows"] is False


def test_unknown_does_not_count_as_a_hit_or_a_miss_below_coverage():
    assert qualifies({"a": True, "b": True}) == (2, 2, False)  # acoperire prea mică
    hits, known, ok = qualifies({f"c{i}": True for i in range(5)} | {"x": None, "y": None})
    assert (hits, known, ok) == (5, 5, True)
    hits, known, ok = qualifies({f"c{i}": (i < 3) for i in range(5)} | {"x": None, "y": None})
    assert ok is False and hits == 3 and known == 5


def test_pct_over_hours_refuses_a_short_series():
    idx = pd.date_range("2026-11-01", periods=10, freq="1h", tz="UTC")
    series = pd.Series(range(10), index=idx, dtype=float)
    assert pct_over_hours(series, HOURS_14D) is None


def test_universe_keeps_verified_price_confirmed_gate_names_only():
    rows = [
        {"key": "a", "symbol": "AAA", "name": "Aaa", "price": 1, "marketCap": 20e6, "volume24h": 2e6, "valid": "V"},
        {"key": "b", "symbol": "BBB", "name": "B", "price": 1, "marketCap": 20e6, "volume24h": 2e6, "valid": "R"},
        {"key": "c", "symbol": "CCC", "name": "C", "price": 1, "marketCap": 20e6, "volume24h": 2e6, "valid": "P"},
        {"key": "d", "symbol": "DDD", "name": "D", "price": 2, "marketCap": 20e6, "volume24h": 3e6, "valid": "V"},
        {"key": "e", "symbol": "EEE", "name": "E", "price": 1, "marketCap": 20e6, "volume24h": 100, "valid": "V"},
        {"key": "f", "symbol": "FFF", "name": "F", "price": 1, "marketCap": 5e9, "volume24h": 2e6, "valid": "V"},
        {"key": "g", "symbol": "GGG", "name": "G", "price": 1, "marketCap": 20e6, "volume24h": 9e5, "valid": "V"},
        {"key": "h", "symbol": "HHH", "name": "H", "price": None, "marketCap": 20e6, "volume24h": 2e6, "valid": "V"},
        {"key": "a2", "symbol": "AAA", "name": "Aaa doi", "price": 1.2, "marketCap": 20e6, "volume24h": 8e6, "valid": "V"},
    ]
    spot = {"AAA_USDT": 1.01, "DDD_USDT": 4.0, "HHH_USDT": 3.0}
    futures = {"GGG_USDT": 1.02, "EEE_USDT": 1.0}
    chosen, reasons = select_gate_assets(rows, spot, futures)
    by = {c["key"]: c for c in chosen}
    assert set(by) == {"a", "g"}
    assert by["a"]["futuresOnly"] is False and by["a"]["gateSpotPair"] == "AAA_USDT"
    assert by["g"]["futuresOnly"] is True and by["g"]["gateFuturesContract"] == "GGG_USDT"
    assert reasons["notVerified"] == 2
    assert reasons["priceUnconfirmed"] >= 1
    assert reasons["thinVolume"] == 1 and reasons["outsideCap"] == 1
    # omonimul cu prețul mai departe (1.2 vs 1.01) nu ia perechea celui de la 1.0
    assert all(c["key"] != "a2" for c in chosen)


def test_synthetic_document_is_json_and_only_the_passing_name():
    doc = synthetic_document(NOW)
    json.dumps(doc, allow_nan=False)
    assert doc["method"] == "rules" and doc["model"] is None
    assert [row["symbol"] for row in doc["stepMomentum"]] == ["GOOD"]
    assert doc["stepMomentum"][0]["score"] == 7
    assert "LightGBM" in doc["notes"][0]
    # domeniul nu trage un model și nu vorbește cu rețeaua
    source = (ROOT / "step_momentum").read_text() if False else "\n".join(
        p.read_text() for p in (ROOT / "step_momentum").rglob("*.py")
    )
    domain = "\n".join(p.read_text() for p in (ROOT / "step_momentum" / "domain").rglob("*.py"))
    assert "import lightgbm" not in source.lower()
    assert "requests" not in source
    assert "/orders" not in source
    for line in domain.splitlines():
        stripped = line.strip()
        if stripped.startswith("import ") or stripped.startswith("from "):
            assert "urllib" not in stripped and "http" not in stripped.lower()


def test_publish_rejects_a_dataframe():
    with pytest.raises(TypeError):
        clean({"x": pd.DataFrame({"a": [1]})})
