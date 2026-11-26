import pytest
from research.momentum import compute_momentum, _composite_momentum


def _row(symbol, h24=None, d7=None, d30=None, turnover=None, earliness=None):
    r = {"symbol": symbol, "market": {"change": {"h24": h24, "d7": d7, "d30": d30}}}
    if turnover is not None:
        r["market"]["turnover"] = turnover
    if earliness is not None:
        r["changed"] = {"earliness": earliness}
    return r


def test_outperformance_vs_btc_when_present():
    rows = [_row("BTC", d7=2.0), _row("ETH", d7=5.0)]
    out = compute_momentum(rows)
    assert out["ETH"]["benchmark"] == "BTC"
    assert out["ETH"]["outperformance7d"] == pytest.approx(3.0)
    assert out["BTC"]["outperformance7d"] == pytest.approx(0.0)


def test_benchmark_fallback_to_median():
    rows = [_row("A", d7=1.0), _row("B", d7=2.0), _row("C", d7=3.0)]
    out = compute_momentum(rows)
    assert out["A"]["benchmark"] == "crossSectionalMedian"
    assert out["A"]["benchmarkValue"] == 2.0
    assert out["A"]["outperformance7d"] == pytest.approx(-1.0)
    assert out["C"]["outperformance7d"] == pytest.approx(1.0)


def test_single_coin_self_benchmark():
    out = compute_momentum([_row("X", d7=5.0)])
    assert out["X"]["benchmark"] == "crossSectionalMedian"
    assert out["X"]["benchmarkValue"] == 5.0
    assert out["X"]["outperformance7d"] == pytest.approx(0.0)


def test_composite_weights():
    c = _composite_momentum({"change": {"h24": 1, "d7": 2, "d30": 3}})
    assert c == pytest.approx(0.2 * 1 + 0.5 * 2 + 0.3 * 3)
    assert _composite_momentum({"change": {"d7": 4}}) == pytest.approx(4.0)
    assert _composite_momentum({"change": {}}) is None


def test_impossible_fields_in_gaps():
    out = compute_momentum([_row("BTC", d7=1.0), _row("X", d7=2.0)])
    for f in ("gainFrom20dLow", "risingLows", "volumeTrendUp", "openInterestChange14d"):
        assert f in out["X"]["gaps"]


def test_oi_enrichment_from_squeeze():
    squeeze = {"X": {"oiChangePct": 12.5}}
    out = compute_momentum([_row("BTC", d7=1), _row("X", d7=2)], squeeze_by_symbol=squeeze)
    assert out["X"]["oiChangePct"] == 12.5
    assert "oiChangePct" not in out["X"]["gaps"]


def test_oi_gap_when_no_squeeze():
    out = compute_momentum([_row("X", d7=2)])
    assert out["X"]["oiChangePct"] is None
    assert "oiChangePct" in out["X"]["gaps"]
