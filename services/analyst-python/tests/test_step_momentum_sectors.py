"""Sectoare în Momentum în trepte: domeniu pur, adapter CoinGecko (HTTP fals), execuția cap-coadă, contractul.

Fără rețea. Păzește ce a scăpat într-un commit în care testele trecuseră local, dar producția nu putea rula:
dependențe în afara requirements-runners.txt, câmpuri în afara schemei, medii calculate pe un singur token.
"""
import ast
import json
import math
import sys
from pathlib import Path

import pandas as pd
import pytest

from step_momentum.adapters.coingecko_sectors import PAGE_SIZE, CoinGeckoSectorsClient
from step_momentum.adapters.synthetic import failing_market, passing_market
from step_momentum.application.run import SECTOR_CATEGORIES, execute, synthetic_document
from step_momentum.domain.rules import compute_step_momentum
from step_momentum.domain.sectors import build_sector_index, compute_sector_momentum, resolve_sectors

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT.parents[1] / "schema" / "step-momentum.schema.json").read_text(encoding="utf-8"))
NOW = pd.Timestamp("2026-11-20T12:00:00Z")


# ───────────────────────────── contract ─────────────────────────────
def assert_matches_schema(doc):
    """Schema are `additionalProperties: false` pe document și pe semnale: o cheie nouă fără schemă
    face `validate-snapshot.js --step-momentum` să pice, iar workflow-ul șterge data/step-momentum.json."""
    top = SCHEMA["properties"]
    assert set(doc) <= set(top), f"chei în afara schemei: {set(doc) - set(top)}"
    assert set(SCHEMA["required"]) <= set(doc)
    item = top["stepMomentum"]["items"]
    for signal in doc["stepMomentum"]:
        assert set(signal) <= set(item["properties"]), f"chei în afara schemei: {set(signal) - set(item['properties'])}"
        assert set(item["required"]) <= set(signal)
        assert all(isinstance(v, str) for v in signal["sectors"])
        assert set(signal.get("sectorMomentum", {})) <= set(signal["sectors"])
        assert all(isinstance(v, (int, float)) and math.isfinite(v) for v in signal.get("sectorMomentum", {}).values())
    json.dumps(doc, allow_nan=False)


def test_synthetic_document_matches_schema():
    assert_matches_schema(synthetic_document(NOW))


def test_step_momentum_runs_on_runners_requirements_only():
    """scan-and-deploy.yml instalează doar requirements-runners.txt (fără web3, deci fără `requests`)."""
    allowed = set(sys.stdlib_module_names) | {"pandas", "numpy", "step_momentum", "runners"}
    for path in sorted((ROOT / "step_momentum").rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            else:
                continue
            for name in names:
                assert name.split(".")[0] in allowed, f"{path.relative_to(ROOT)} importă {name}, care nu e în requirements-runners.txt"


# ───────────────────────────── domeniu ─────────────────────────────
def test_sectors_resolve_by_coingecko_id_never_by_symbol():
    index = build_sector_index([
        {"id": "good-a", "sector": "ai-agents"},
        {"id": "good-a", "sector": "meme-token"},
        {"id": "good-a", "sector": "ai-agents"},  # duplicat
        {"id": "", "sector": "ai-agents"},
        {"id": "x", "sector": ""},
        "nu-e-dict",
    ])
    assert index == {"good-a": ["ai-agents", "meme-token"]}
    assert resolve_sectors(index, "cg:good-a") == ["ai-agents", "meme-token"]
    assert resolve_sectors(index, "cg:altceva") == []
    assert resolve_sectors(index, "dex:bsc:0xabc") == []  # fără id CoinGecko, sectorul rămâne necunoscut
    # prefix străin, dar partea de id coincide cu un id CoinGecko: alt activ, nu are voie să moștenească sectorul
    assert resolve_sectors(index, "dex:bsc:good-a") == [] and resolve_sectors(index, "good-a") == []
    assert resolve_sectors(index, None) == [] and resolve_sectors({}, "cg:good-a") == []


def test_sector_momentum_is_the_mean_of_all_members_with_a_floor():
    sectors = {"a": ["ai"], "b": ["ai"], "c": ["ai", "meme"], "d": ["meme"], "e": ["ai"]}
    returns = {"a": 10.0, "b": 20.0, "c": 30.0, "d": 4.0, "e": float("nan")}
    out = compute_sector_momentum(sectors, returns)
    assert out == {"ai": 20.0}  # e (nefinit) iese din medie; meme are doar 2 membri
    assert compute_sector_momentum(sectors, returns, min_members=2) == {"ai": 20.0, "meme": 17.0}
    assert compute_sector_momentum({}, {}) == {} and compute_sector_momentum(None, None) == {}


# ───────────────────────────── adapter ─────────────────────────────
class FakeHttp:
    def __init__(self, pages=None, fail=()):
        self.pages, self.fail, self.calls = pages or {}, set(fail), []

    def get_json(self, url, params=None):
        params = dict(params or {})
        self.calls.append(params)
        if params.get("category") in self.fail:
            raise RuntimeError("GET /coins/markets: HTTP 429")
        pages = self.pages.get(params.get("category"), [])
        page = int(params.get("page", 1))
        return pages[page - 1] if page <= len(pages) else []


def _rows(prefix, count, market_cap=5e7):
    return [{"id": f"{prefix}{i}", "market_cap": market_cap} for i in range(count)]


def test_adapter_paginates_until_a_short_page():
    http = FakeHttp({"ai-agents": [_rows("p1-", PAGE_SIZE), _rows("p2-", 3)]})
    out = CoinGeckoSectorsClient(http=http).fetch_members(["ai-agents"], min_market_cap=1e6)
    assert len(out["members"]) == PAGE_SIZE + 3 and out["loaded"] == ["ai-agents"] and out["failed"] == []
    assert [c["page"] for c in http.calls] == [1, 2]
    assert http.calls[0]["category"] == "ai-agents" and http.calls[0]["order"] == "market_cap_desc"


def test_adapter_stops_below_the_universe_market_cap_floor():
    http = FakeHttp({"meme-token": [_rows("a", PAGE_SIZE, market_cap=5e5), _rows("b", PAGE_SIZE)]})
    out = CoinGeckoSectorsClient(http=http).fetch_members(["meme-token"], min_market_cap=1e6)
    assert len(http.calls) == 1 and len(out["members"]) == PAGE_SIZE


def test_adapter_failures_never_raise_and_are_reported():
    http = FakeHttp({"ai-agents": [_rows("a", 2)], "meme-token": [[]]}, fail={"binance-smart-chain"})
    out = CoinGeckoSectorsClient(http=http).fetch_members(["ai-agents", "binance-smart-chain", "meme-token"])
    assert out["loaded"] == ["ai-agents"]
    assert out["failed"] == ["binance-smart-chain", "meme-token"]  # eroare de rețea și categorie goală/necunoscută
    assert [m["id"] for m in out["members"]] == ["a0", "a1"]


def test_adapter_respects_an_expired_deadline_without_calling_out():
    http = FakeHttp({"ai-agents": [_rows("a", 2)]})
    out = CoinGeckoSectorsClient(http=http).fetch_members(["ai-agents"], deadline=-1.0)
    assert http.calls == [] and out["failed"] == ["ai-agents"] and out["members"] == []


def test_adapter_sends_the_free_demo_key_only_when_there_is_one():
    assert "x-cg-demo-api-key" not in CoinGeckoSectorsClient(api_key="").http.headers
    assert CoinGeckoSectorsClient(api_key="k").http.headers["x-cg-demo-api-key"] == "k"


# ───────────────────────────── execuția cap-coadă ─────────────────────────────
class FakeGate:
    def __init__(self, frames, last):
        self.frames, self.last = frames, last

    def spot_last(self):
        return self.last

    def futures_last(self):
        return {}

    def hourly(self, market, instrument, start, end):
        return self.frames[instrument]

    def contract_stats(self, contract):
        return None


def _universe():
    end = NOW - pd.Timedelta(hours=1)
    token, market, _ = passing_market(end)
    flat, _ = failing_market(end)
    symbols = {"GOODA": token, "GOODB": token, "GOODC": token, "FLATD": flat}
    gate = FakeGate({"BTC_USDT": market, **{f"{s}_USDT": f for s, f in symbols.items()}}, {f"{s}_USDT": 1.0 for s in symbols})
    rows = [
        {"key": f"cg:{s.lower()}", "symbol": s, "name": s.title(), "price": 1.0, "marketCap": 2e7, "volume24h": 2e6, "valid": "V"}
        for s in symbols
    ]
    change = compute_step_momentum(token, market1h=market)["metrics"]["tokenChange7dPct"]
    return rows, gate, change


def _coingecko(fail=()):
    pages = {
        "ai-agents": [[{"id": i, "market_cap": 5e7} for i in ("gooda", "goodb", "goodc", "flatd")]],
        "meme-token": [[{"id": "goodc", "market_cap": 5e7}]],
        "binance-smart-chain": [[{"id": "unrelated", "market_cap": 5e7}]],
    }
    return CoinGeckoSectorsClient(http=FakeHttp(pages, fail=fail))


def test_execute_attaches_sectors_with_a_mean_over_every_evaluated_member():
    rows, gate, change = _universe()
    assert change > 0
    doc = execute(rows=rows, gate=gate, coingecko=_coingecko(fail={"binance-smart-chain"}), now=NOW)
    by_symbol = {s["symbol"]: s for s in doc["stepMomentum"]}
    assert set(by_symbol) == {"GOODA", "GOODB", "GOODC"}  # FLATD este evaluat, nu semnalat
    assert doc["stepMomentumMeta"]["evaluatedCount"] == 4

    # ai-agents: 3 semnale + 1 evaluat fără semnal (randament 0) → media pe 4, nu pe un singur token
    expected = 3 * change / 4
    assert by_symbol["GOODA"]["sectors"] == ["ai-agents"]
    assert by_symbol["GOODA"]["sectorMomentum"] == pytest.approx({"ai-agents": expected})
    # meme-token are un singur membru evaluat: sectorul rămâne etichetat, dar fără medie
    assert by_symbol["GOODC"]["sectors"] == ["ai-agents", "meme-token"]
    assert by_symbol["GOODC"]["sectorMomentum"] == pytest.approx({"ai-agents": expected})

    meta = doc["stepMomentumMeta"]
    assert meta["sectorCategoriesLoaded"] == 2 and meta["sectorCategoriesFailed"] == 1
    assert any("binance-smart-chain" in note for note in doc["notes"])
    assert_matches_schema(doc)


def test_execute_survives_coingecko_being_down():
    rows, gate, _ = _universe()
    doc = execute(rows=rows, gate=gate, coingecko=_coingecko(fail=set(SECTOR_CATEGORIES)), now=NOW)
    assert len(doc["stepMomentum"]) == 3
    assert all(s["sectors"] == [] and s["sectorMomentum"] == {} for s in doc["stepMomentum"])
    assert doc["stepMomentumMeta"]["sectorCategoriesFailed"] == len(SECTOR_CATEGORIES)
    assert_matches_schema(doc)


def test_execute_without_a_sector_client_keeps_the_contract():
    rows, gate, _ = _universe()
    doc = execute(rows=rows, gate=gate, coingecko=None, now=NOW)
    assert len(doc["stepMomentum"]) == 3 and all(s["sectors"] == [] for s in doc["stepMomentum"])
    assert_matches_schema(doc)


def test_execute_makes_no_sector_calls_when_nothing_is_signaled():
    rows, gate, _ = _universe()
    only_flat = [r for r in rows if r["symbol"] == "FLATD"]
    client = _coingecko()
    doc = execute(rows=only_flat, gate=gate, coingecko=client, now=NOW)
    assert doc["stepMomentum"] == [] and client.http.calls == []
    assert_matches_schema(doc)
