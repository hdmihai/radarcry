import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _walk(seed: int, n: int, drift: float, vol: float, start: float = 1.0) -> list[float]:
    """Mers determinist (LCG), fără random: testele trebuie să fie reproductibile ca și domeniul."""
    x, out, p = seed, [], start
    for _ in range(n):
        x = (1103515245 * x + 12345) % 2**31
        u = x / 2**31 - 0.5
        p *= math.exp(drift + vol * u)
        out.append(round(p, 8))
    return out


@pytest.fixture
def walk():
    return _walk


@pytest.fixture
def asset_payload():
    def make(key="cg:test", seed=7, drift=0.004, vol=0.05, n=90, with_h4=True):
        closes = _walk(seed, n, drift, vol)
        t0 = 1_780_000_000
        d1 = [[t0 + i * 86400, c] for i, c in enumerate(closes)]
        h4 = []
        if with_h4:
            hc = _walk(seed + 1, 96, drift / 6, vol / 2)
            for i, c in enumerate(hc):
                h4.append([t0 + i * 14400, c * 0.99, c * 1.02, c * 0.97, c, 1000 + (i % 7) * 50 + (400 if i > 90 else 0)])
        return {
            "key": key,
            "symbol": key.split(":")[-1].upper()[:6],
            "chain": "bsc",
            "contract": "0x" + "1" * 40,
            "market": {"price": closes[-1], "marketCap": 4.0e7, "fdv": 1.2e8, "volume24h": 6.0e6},
            "series": {"d1": d1, "h4": h4, "sparkline": closes[-30:]},
            "scoreHistory": [{"at": f"2026-11-{i + 1:02d}T00:00:00Z", "score": 50 + i + (i % 3) * 2, "stage": "BASE", "price": closes[-10 + i]} for i in range(10)],
        }

    return make
