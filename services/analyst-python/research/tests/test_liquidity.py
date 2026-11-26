import pytest
from research.liquidity import compute_liquidity, _score_turnover, _score_funding


def test_discovery_section_no_node_score():
    out = compute_liquidity([{"symbol": "X", "market": {"turnover": 0.1}}], [])
    assert "X" in out["discovery"]
    assert out["discovery"]["X"]["nodeFuturesScore"] is None
    assert "nodeFuturesScore" in out["discovery"]["X"]["gaps"]


def test_futures_volume_dict_yields_no_composite():
    """Real-world: volume is {'score': 56, 'reasons': [...]}, not a number."""
    futures = [{
        "symbol": "AGT",
        "volume": {"score": 56, "reasons": ["ATR 6.5%/zi — interval lucrabil"]},
        "marketCap": 185_774_184,
        "liquidity": {"score": 88},
    }]
    out = compute_liquidity([], futures)
    agt = out["futures"]["AGT"]
    assert agt["nodeFuturesScore"] == 88
    assert agt["researchComposite"] is None
    assert "researchComposite" in agt["gaps"]


def test_futures_numeric_volume_computes_composite():
    futures = [{"symbol": "X", "volume": 15_000_000, "marketCap": 100_000_000,
                "liquidity": {"score": 50}}]
    out = compute_liquidity([], futures)
    # turnover 0.15 / 0.30 = 0.5
    assert out["futures"]["X"]["researchComposite"] == pytest.approx(0.5, abs=0.01)


def test_squeeze_enrichment_provides_agreement():
    futures = [{"symbol": "X", "liquidity": {"score": 80}}]
    squeeze = {"X": {"oiToMcap": 0.25, "fundingAvg": 0.0}}
    out = compute_liquidity([], futures, squeeze)
    x = out["futures"]["X"]
    assert x["researchComposite"] is not None
    assert x["agreement"] is not None
    # oiToMcap 0.25/0.50=0.5, funding 0.0→1.0, weights .4/.4/.2 total .6
    # composite = (.4*.5 + .2*1.0)/.6 = 0.6667; agreement = |0.8 - 0.6667| ≈ 0.133
    assert x["agreement"] == pytest.approx(0.133, abs=0.01)


def test_clamp_bounds():
    assert _score_turnover(0.0) == 0.0
    assert _score_turnover(0.30) == 1.0
    assert _score_turnover(1.0) == 1.0
    assert _score_funding(0.0) == 1.0
    assert _score_funding(0.001) == 0.0
