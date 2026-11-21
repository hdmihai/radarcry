"""Regresie Pieverse — mock cu structura reală (3-6 nov): preț în trepte crescătoare,
OI accelerat exponențial, piață în scădere. Toate cele 7 condiții trebuie True.

De ce 4 faze, nu 3:
  risingLows pe 4h compară minimul ultimelor 24h cu cel din următoarele 24h înainte.
  Cu doar 3 faze, bara 4h care traversează granița 2/3 are low amestecat, iar strict >  eșuează.
  4 faze crescătoare (9.9 → 10.9 → 11.9 → 14.9) garantează că fereastra 4h recentă
  e strict peste fereastra precedentă.
"""
import pandas as pd
from step_momentum.domain.rules import compute_step_momentum


def test_pieverse_detected_early():
    dates = pd.date_range(end="2026-11-06 00:00", periods=500, freq="h", tz="UTC")

    # BTC scade liniar: 100 → 90 (piață în scădere pe 7 zile)
    market_close = [100.0 - i * 0.02 for i in range(500)]
    market_df = pd.DataFrame({"close": market_close}, index=dates)

    # Token: 4 faze crescătoare (minime strict în urcare, preț comprimat sub nivel apoi accelerat)
    # F1 i=  0..299:  close 10.0, low 9.9,  vol 1000
    # F2 i=300..399:  close 11.0, low 10.9, vol 1500
    # F3 i=400..449:  close 12.0, low 11.9, vol 2000
    # F4 i=450..499:  close 15.0, low 14.9, vol 3000
    close_prices, low_prices, high_prices, open_prices, volume = [], [], [], [], []
    for i in range(500):
        if i < 300:
            c, l, v = 10.0, 9.9, 1000.0
        elif i < 400:
            c, l, v = 11.0, 10.9, 1500.0
        elif i < 450:
            c, l, v = 12.0, 11.9, 2000.0
        else:
            c, l, v = 15.0, 14.9, 3000.0
        close_prices.append(c)
        low_prices.append(l)
        high_prices.append(c + 0.1)
        open_prices.append(c - 0.05)
        volume.append(v)

    token_df = pd.DataFrame({
        "close": close_prices, "low": low_prices, "high": high_prices,
        "open": open_prices, "volume": volume,
    }, index=dates)

    # OI exponențial: +174% pe 14 zile, mult peste preț (~+50% pe 14 zile)
    oi_series = [10000.0 * (1.003 ** i) for i in range(500)]
    oi_df = pd.DataFrame({"open_interest_usd": oi_series, "lsr_taker": [1.2] * 500}, index=dates)

    result = compute_step_momentum(candles1h=token_df, futures_stats=oi_df, market1h=market_df)

    assert result is not None
    assert result["isStepMomentum"] is True, "Tokenul ar fi trebuit semnalat"
    # Toate cele 7 condiții trebuie să fie True pe acest mock
    for key, val in result["conditions"].items():
        assert val is True, f"Condiția {key} ar fi trebuit True, dar e {val}"
    assert result["known"] == 7, f"toate condițiile trebuie măsurabile, dar known={result['known']}"
    assert result["score"] == 7
