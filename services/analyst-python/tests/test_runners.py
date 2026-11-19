"""Modulul Potențiali runneri: corectitudine point-in-time, etichete, reguli, model, pipeline."""
import json

import numpy as np
import pandas as pd
import pytest

pytest.importorskip("sklearn")

from runners.adapters.gate import GateMarket, match_symbol
from runners.adapters.store import ParquetPanelStore, upsert
from runners.adapters.synthetic import synthetic_panel
from runners.application.pipeline import ASSET_KEYS, Settings, analyze, write_json
from runners.domain.catalog import FEATURE_KEYS, fmt
from runners.domain.features import build_features
from runners.domain.labels import add_labels
from runners.domain.model import walk_forward_splits
from runners.domain.rules import learn_rules, rule_mask

NOW = pd.Timestamp("2026-11-18T12:00:00Z")


@pytest.fixture(scope="module")
def market():
    return synthetic_panel(n_assets=30, days=360, seed=9, end=NOW)


def test_features_have_no_lookahead(market):
    panel, _ = market
    cut = panel["date"].max() - pd.Timedelta(days=20)
    a = build_features(panel)
    future = panel.copy()
    m = future["date"] > cut
    for c in ("open", "high", "low", "close"):
        future.loc[m, c] *= 3.0
    future.loc[m, "volume"] *= 10
    future.loc[m, "oi"] *= 5
    b = build_features(future)
    pa = a[a["date"] <= cut].set_index(["key", "date"])[FEATURE_KEYS].sort_index()
    pb = b[b["date"] <= cut].set_index(["key", "date"])[FEATURE_KEYS].sort_index()
    pd.testing.assert_frame_equal(pa, pb)


def test_forward_labels_use_next_days_only():
    dates = pd.date_range("2026-01-01", periods=12, freq="D", tz="UTC")
    close = np.array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], dtype=float)
    high = close.copy()
    high[4] = 2.0  # +100% intraday pe 5 ianuarie
    feats = pd.DataFrame({"key": "a", "date": dates, "close": close, "high": high, "volume": 1e6, "partial": False, "ret_1d": 0.0})
    df = add_labels(feats, horizon=3, target=0.5)
    y = df.set_index(df["date"].dt.day)["y"]
    assert y[2] == 1 and y[3] == 1 and y[4] == 1  # ziua 5 e în următoarele 3 zile
    assert y[5] == 0  # maximul zilei curente NU contează pentru eticheta ei
    assert y[1] == 0
    assert df["fwd_max"].iloc[-3:].isna().all()  # fără viitor complet → fără etichetă
    assert df["run_start"].sum() == 1


def test_walk_forward_splits_purge_and_embargo():
    dates = pd.Series(pd.date_range("2025-01-01", periods=400, freq="D", tz="UTC").repeat(5))
    splits = walk_forward_splits(dates, n_folds=4, horizon=7, embargo=7)
    assert len(splits) == 4
    for tr, te, a, _ in splits:
        assert dates[tr].max() <= a - pd.Timedelta(days=14)
        assert not (tr & te).any()


def test_rules_rediscover_planted_pattern(market):
    panel, _ = market
    df = add_labels(build_features(panel), 7, 0.5)
    lab = df[df["labeled"] & (df["key"] != "BTC")].sort_values("date")
    cut = lab["date"].quantile(0.75)
    rules, base = learn_rules(lab[lab["date"] < cut - pd.Timedelta(days=7)], lab[lab["date"] >= cut], ASSET_KEYS)
    assert rules, "nicio regulă găsită"
    used = {c[0] for r in rules[:5] for c in r["conds"]}
    assert used & {"funding_1d", "funding_3d", "oi_chg_1d", "oi_chg_7d", "vol_z30", "atr_ratio_7_30", "vol_ratio_3_14"}
    assert rules[0]["lift"] >= 2.0 and rules[0]["precision"] > base
    m = rule_mask(lab, [tuple(c) for c in rules[0]["conds"]])
    assert m.sum() > 0


def test_pipeline_end_to_end_offline(market, tmp_path):
    panel, assets = market
    doc = analyze(panel, assets, [], Settings(references=[{"symbol": "SYN0"}, {"symbol": "SAMD"}]), NOW, {"mode": "test"})
    assert doc["metrics"]["auc"] > 0.8  # tiparul plantat e învățabil out-of-time
    assert doc["factors"] and doc["rules"] and doc["events"]
    assert doc["candidates"], "setup-urile plantate în ultima zi trebuie să apară"
    c = doc["candidates"][0]
    for k in ("symbol", "probability", "lift", "tier", "stage", "drivers", "factors", "rulesMatched", "similarTo", "risks"):
        assert k in c
    assert 0 <= c["probability"] <= 1
    assert c["factors"] and all("contribution" in f for f in c["factors"])
    refs = {r["symbol"]: r for r in doc["references"]}
    assert refs["SYN0"]["resolved"] and not refs["SAMD"]["resolved"]
    out = tmp_path / "runners.json"
    write_json(doc, out)
    back = json.loads(out.read_text(encoding="utf-8"))
    assert back["candidates"][0]["rank"] == 1


def test_store_roundtrip_and_upsert_keeps_derivatives(tmp_path):
    d = pd.Timestamp("2026-11-10", tz="UTC")
    old = pd.DataFrame({"key": ["a"], "date": [d], "open": [1.0], "high": [1.0], "low": [1.0], "close": [1.0], "volume": [5.0],
                        "mcap": [np.nan], "oi": [100.0], "funding": [-0.001], "lsr": [0.8], "top_lsr": [1.0],
                        "liq_long": [1.0], "liq_short": [2.0], "partial": [True], "src": ["gate"]})
    new = pd.DataFrame({"key": ["a"], "date": [d], "open": [1.0], "high": [1.2], "low": [0.9], "close": [1.1], "volume": [9.0],
                        "partial": [False], "src": ["cg"]})
    merged = upsert(old, new, 730, now=pd.Timestamp("2026-11-18", tz="UTC"))
    assert len(merged) == 1
    r = merged.iloc[0]
    assert r["close"] == 1.1 and r["oi"] == 100.0 and not r["partial"]
    store = ParquetPanelStore(tmp_path)
    store.save(merged)
    assert store.load().iloc[0]["funding"] == -0.001


def test_match_symbol_requires_price_agreement():
    pairs = {"EVAA_USDT": {}, "BR_USDT": {}}
    tickers = {"EVAA_USDT": 3.3, "BR_USDT": 0.05}
    assert match_symbol("evaa", 3.2, pairs, tickers) == "EVAA_USDT"
    assert match_symbol("BR", 0.9, pairs, tickers) is None  # alt token cu același simbol
    assert match_symbol("XYZ", 1.0, pairs, tickers) is None


class FakeHttp:
    def __init__(self, routes):
        self.routes = routes

    def get_json(self, url, params=None):
        for k, v in self.routes.items():
            if url.endswith(k):
                return v
        raise RuntimeError(url)


def test_gate_adapter_parses_candles_stats_and_funding():
    t = 1794873600
    gate = GateMarket(FakeHttp({
        "/spot/candlesticks": [[str(t), "2000", "1.1", "1.2", "0.9", "1.0", "1800", "true"], [str(t + 86400), "100", "1.2", "1.3", "1.1", "1.1", "90", "false"]],
        "/contract_stats": [{"time": t, "open_interest_usd": 5e6, "lsr_account": 0.4, "top_lsr_size": 1.3, "long_liq_usd": 10, "short_liq_usd": 60}],
        "/funding_rate": [{"t": t, "r": "-0.0002"}, {"t": t + 28800, "r": "-0.0004"}],
    }))
    df = gate.asset_history("EVAA_USDT", "EVAA_USDT", 1000, 365)
    assert list(df["partial"]) == [False, True]
    first = df.iloc[0]
    assert first["volume"] == 2000 and first["oi"] == 5e6 and first["liq_short"] == 60
    assert first["funding"] == pytest.approx(-0.0003)


def test_format_helpers():
    assert fmt("ret_7d", 0.5) == "+50.0%"
    assert fmt("funding_1d", -0.0001) == "-0.0100%/8h"
    assert fmt("log_mcap", 7.0) == "$10.0M"
    assert fmt("vol_z30", None) == "—"


def test_write_json_is_strict(tmp_path):
    out = tmp_path / "r.json"
    write_json({"a": float("nan"), "b": [np.float32(1.5), np.int64(2), np.bool_(True)], "c": pd.NA, "d": {"e": float("inf")}}, out)
    assert json.loads(out.read_text()) == {"a": None, "b": [1.5, 2, True], "c": None, "d": {"e": None}}
