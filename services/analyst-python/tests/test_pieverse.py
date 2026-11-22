"""Regresie Pieverse: un proiect mic care urcă în trepte într-o piață slabă trebuie semnalat devreme.

Date sintetice, deterministe, fără rețea. Ultima lumânare: 2026-11-06 00:00 UTC (fereastra 3–6 nov).
Scenariul respectă toate cele 7 reguli, cu margini largi, ca verdictul să nu atârne de zgomot numeric:
  R1  token +20% pe 7 zile față de BTC −3,6% (supraperformanță ≈ 23,6 puncte, peste pragul de 15)
  R2  +32,5% față de minimul de 20 de zile (în banda 15–60%: treaptă, nu mișcare epuizată)
  R3  minime în urcare pe 1h și pe 4h
  R4  BTC pe minus pe 7 zile
  R5  volumul din ultimele 24h peste cele 24h precedente
  R6  open interest +75% pe 14 zile (prag 20%)
  R7  open interest crește mai repede decât prețul (+75% față de +26%)
"""
import numpy as np
import pandas as pd

from step_momentum.domain.rules import compute_step_momentum

BARS = 500


def _pieverse_like():
    dates = pd.date_range(end="2026-11-06 00:00", periods=BARS, freq="h", tz="UTC")
    i = np.arange(BARS)

    # BTC: scădere lentă și constantă (−3,6% pe ultimele 7 zile).
    market = pd.DataFrame({"close": 100.0 - 0.02 * i}, index=dates)

    # Token: bază lentă de la 10,0 la 11,0 (până la 7 zile înainte de final), apoi urcare până la 13,2.
    split = BARS - 1 - 168
    close = np.where(
        i <= split,
        10.0 + 1.0 * i / split,
        11.0 + 2.2 * (i - split) / (BARS - 1 - split),
    )
    token = pd.DataFrame({
        "open": close - 0.05,
        "high": close + 0.2,
        "low": close - 0.1,
        "close": close,
        "volume": 1000.0 + 10.0 * i,
    }, index=dates)

    # Open interest: crește mult mai repede decât prețul.
    oi = pd.DataFrame({
        "open_interest_usd": 10_000.0 * (1.0 + 0.0035 * i),
        "lsr_taker": 1.2,
    }, index=dates)
    return token, market, oi


def test_pieverse_detected_early():
    token, market, oi = _pieverse_like()
    result = compute_step_momentum(candles1h=token, futures_stats=oi, market1h=market)

    assert result is not None
    metrics = result["metrics"]
    # Marginile scenariului: dacă datele de test derivă, eșecul spune care condiție s-a mutat.
    assert metrics["outperformance7dPct"] > 15 + 5
    assert 15 + 5 < metrics["gainFrom20dLowPct"] < 60 - 5
    assert metrics["marketChange7dPct"] < 0
    assert metrics["openInterestChange14dPct"] > 20 + 20
    assert metrics["openInterestChange14dPct"] > metrics["priceChange14dPct"] + 20

    assert result["conditions"] == {
        "outperformance7dGt15pct": True,
        "gain15To60PctFrom20dLow": True,
        "risingLows": True,
        "marketDown7d": True,
        "volumeTrendUp": True,
        "openInterestGrowth14dGt20pct": True,
        "openInterestFasterThanPrice": True,
    }
    assert result["score"] == 7 and result["known"] == 7
    assert result["isStepMomentum"] is True, "Pieverse ar fi trebuit semnalat devreme"
