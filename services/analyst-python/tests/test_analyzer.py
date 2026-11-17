"""Domeniul analistului: metrici corecte, determinism, necunoscut ≠ negativ."""
import ast
from pathlib import Path

import pandas as pd
import pytest

import analyzer

ROOT = Path(__file__).resolve().parents[1]


def test_robust_z_uses_median_and_mad():
    z = analyzer.robust_z(pd.Series([1.0, 2.0, 3.0, 4.0, 100.0]))
    assert z.iloc[2] == 0.0  # mediana
    assert z.iloc[4] > 20  # vârful nu lărgește norma
    flat = analyzer.robust_z(pd.Series([5.0, 5.0, 5.0]))
    assert flat.tolist() == [0.0, 0.0, 0.0]


def test_frame_accepts_both_row_shapes():
    short = analyzer.frame_from_ohlcv([[1_700_000_000, 2.0], [1_700_086_400, 2.5]])
    full = analyzer.frame_from_ohlcv([[1_700_000_000, 1, 2, 0.5, 1.5, 10]])
    assert list(short["close"]) == [2.0, 2.5] and short["volume"].isna().all()
    assert full["high"].iloc[0] == 2 and full["volume"].iloc[0] == 10


def test_series_metrics_on_a_clean_uptrend():
    closes = [100 * 1.01**i for i in range(60)]
    m = analyzer.series_metrics(pd.Series(closes))
    assert m["r2"] > 0.999 and m["slopePctPerPeriod"] == pytest.approx(1.0, rel=1e-6)
    assert m["maxDrawdownPct"] == 0 and m["currentDrawdownPct"] == 0
    assert m["rsi14"] == 100.0
    assert m["returnPct"]["p7"] == pytest.approx((1.01**7 - 1) * 100)


def test_drawdown_and_var_on_a_crash(walk):
    closes = walk(3, 80, 0.0, 0.04) + [x * 0.3 for x in walk(4, 20, -0.01, 0.04, start=walk(3, 80, 0.0, 0.04)[-1])]
    m = analyzer.series_metrics(pd.Series(closes))
    assert m["maxDrawdownPct"] < -60
    assert m["var95Pct"] < 0 and m["cvar95Pct"] <= m["var95Pct"]
    v = analyzer.quant_verdict(m)
    assert any("drawdown" in f for f in v["flags"])


def test_too_few_points_is_an_analysis_error():
    with pytest.raises(analyzer.AnalysisError):
        analyzer.series_metrics(pd.Series([1.0] * 5))
    with pytest.raises(analyzer.AnalysisError):
        analyzer.analyze_asset({"key": "x", "series": {}})


def test_asset_uses_d1_and_borrows_volume_from_h4(asset_payload):
    out = analyzer.analyze_asset(asset_payload())
    assert out["seriesUsed"] == "d1"
    assert out["metrics"]["volumeSource"] == "h4"
    assert out["metrics"]["atrSource"] == "h4"
    assert 0 <= out["verdict"]["quantScore"] <= 100
    assert out["verdict"]["band"] in {"FAVORABIL", "NEUTRU", "NEFAVORABIL"}
    assert out["scoreAlignment"] is not None


def test_unknown_volume_is_neutral_not_negative(asset_payload):
    out = analyzer.analyze_asset(asset_payload(with_h4=False))
    assert out["metrics"]["volumeZ"] is None
    assert out["verdict"]["components"]["participation"] == 0.5
    assert out["verdict"]["confidence"] < 1


def test_determinism(asset_payload):
    p = asset_payload()
    assert analyzer.analyze_asset(p) == analyzer.analyze_asset(p)


def test_universe_ranks_and_scores_match_single_asset(asset_payload):
    assets = [asset_payload(key=f"cg:a{i}", seed=10 + i, drift=0.001 * i) for i in range(6)]
    u = analyzer.analyze_universe(assets)
    assert u["assets"] == 6 and len(u["ranking"]) == 6
    scores = [r["quantScore"] for r in u["ranking"]]
    assert scores == sorted(scores, reverse=True)
    single = analyzer.analyze_asset(assets[0])["verdict"]["quantScore"]
    assert next(r for r in u["ranking"] if r["key"] == "cg:a0")["quantScore"] == single
    assert all(r["beta"] is not None for r in u["ranking"])


def test_universe_clusters_identical_movers(asset_payload):
    same = [asset_payload(key=f"cg:twin{i}", seed=42) for i in range(3)]
    other = [asset_payload(key=f"cg:solo{i}", seed=100 + i * 17) for i in range(3)]
    u = analyzer.analyze_universe(same + other)
    assert ["cg:twin0", "cg:twin1", "cg:twin2"] in u["clusters"]


def test_universe_needs_three_assets(asset_payload):
    with pytest.raises(analyzer.AnalysisError):
        analyzer.analyze_universe([asset_payload(key="cg:a"), {"key": "cg:empty", "series": {}}])


def test_domain_is_pure():
    """analyzer.py nu importă rețea, fișiere sau ceas — aceeași regulă ca src/domain în Node.js."""
    tree = ast.parse((ROOT / "analyzer.py").read_text(encoding="utf8"))
    imported = {(n.module if isinstance(n, ast.ImportFrom) else a.name).split(".")[0] for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in (n.names if isinstance(n, ast.Import) else [n])}
    assert imported <= {"__future__", "math", "typing", "numpy", "pandas"}, imported
    src = (ROOT / "analyzer.py").read_text(encoding="utf8")
    for banned in ("time.time(", "datetime.now(", "random.", "np.random", "open("):
        assert banned not in src, banned
