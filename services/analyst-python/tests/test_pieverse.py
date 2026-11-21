import pandas as pd
import pytest
from step_momentum.domain.rules import compute_step_momentum

def test_pieverse_detected_early():
    # Generăm 500 de ore de date sintetice (peste 20 zile)
    dates = pd.date_range(end="2026-11-06 00:00", periods=500, freq="h", tz="UTC")
    
    # Piața (BTC) este în scădere pe 7 zile
    market_df = pd.DataFrame({"close": [100.0 - i*0.02 for i in range(500)]}, index=dates)
    
    # Tokenul: creștere constantă (outperformance), minime în urcare, volum în creștere
    close_prices = [10.0 + i*0.05 for i in range(500)] 
    low_prices = [c - 0.1 for c in close_prices]
    volume = [1000 + i*10 for i in range(500)]
    
    token_df = pd.DataFrame({
        "close": close_prices,
        "low": low_prices,
        "high": [c + 0.2 for c in close_prices],
        "open": [c - 0.05 for c in close_prices],
        "volume": volume
    }, index=dates)
    
    # OI în creștere accelerată (mai rapid decât prețul)
    oi_df = pd.DataFrame({
        "open_interest_usd": [10000 + i*50 for i in range(500)],
        "lsr_taker": [1.2] * 500
    }, index=dates)
    
    result = compute_step_momentum(
        candles1h=token_df,
        futures_stats=oi_df,
        market1h=market_df
    )
    
    assert result is not None
    assert result["isStepMomentum"] is True, "Tokenul ar fi trebuit semnalat"
    assert result["conditions"]["outperformance7dGt15pct"]
    assert result["conditions"]["openInterestGrowth14dGt20pct"]
    assert result["conditions"]["openInterestFasterThanPrice"]
