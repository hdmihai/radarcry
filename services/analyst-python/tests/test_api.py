"""Adaptorul HTTP (FastAPI) și transportul spawn (cli.py): același contract."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import create_app
from ports import OnchainUnavailable

ROOT = Path(__file__).resolve().parents[1]


class FakeOnchain:
    def chains(self):
        return ["bsc", "ethereum"]

    def token_facts(self, chain, address):
        if chain not in self.chains():
            raise ValueError(f"lanț nesuportat: {chain}")
        if address.endswith("dead"):
            raise OnchainUnavailable("nod indisponibil")
        return {"chain": chain, "address": address, "isContract": True, "decimals": 18, "totalSupply": "1000", "isErc20": True}


@pytest.fixture
def client():
    return TestClient(create_app(onchain=FakeOnchain()))


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and "asset" in body["capabilities"] and body["chains"] == ["bsc", "ethereum"]


def test_asset(client, asset_payload):
    r = client.post("/v1/analyze/asset", json=asset_payload())
    assert r.status_code == 200, r.text
    assert r.json()["verdict"]["band"] in {"FAVORABIL", "NEUTRU", "NEFAVORABIL"}


def test_asset_without_series_is_422(client):
    r = client.post("/v1/analyze/asset", json={"key": "cg:x"})
    assert r.status_code == 422
    assert "seriile" in r.json()["detail"]


def test_malformed_rows_are_422(client):
    r = client.post("/v1/analyze/asset", json={"key": "cg:x", "series": {"d1": [[1, 2, 3]]}})
    assert r.status_code == 422


def test_universe(client, asset_payload):
    assets = [asset_payload(key=f"cg:u{i}", seed=i + 1) for i in range(4)]
    r = client.post("/v1/analyze/universe", json={"assets": assets})
    assert r.status_code == 200, r.text
    assert r.json()["assets"] == 4


def test_series(client, walk):
    closes = walk(5, 40, 0.002, 0.03)
    r = client.post("/v1/analyze/series", json={"closes": closes, "symbol": "TST"})
    assert r.status_code == 200
    assert r.json()["metrics"]["points"] == 40
    bad = client.post("/v1/analyze/series", json={"closes": closes, "volumes": [1, 2]})
    assert bad.status_code == 422


def test_onchain(client):
    ok = client.get("/v1/onchain/bsc/0x" + "a" * 40)
    assert ok.status_code == 200 and ok.json()["isErc20"] is True
    assert client.get("/v1/onchain/solana/0x" + "a" * 40).status_code == 422
    assert client.get("/v1/onchain/bsc/0x" + "a" * 36 + "dead").status_code == 503


def _cli(cmd, body):
    p = subprocess.run([sys.executable, str(ROOT / "cli.py"), cmd], input=json.dumps(body), capture_output=True, text=True, cwd=ROOT, timeout=60)
    return p.returncode, json.loads(p.stdout)


def test_cli_matches_http(client, asset_payload):
    payload = asset_payload()
    code, out = _cli("asset", payload)
    assert code == 0
    assert out == client.post("/v1/analyze/asset", json=payload).json()


def test_cli_rejects_bad_input_with_code_2():
    code, out = _cli("asset", {"key": "cg:x"})
    assert code == 2 and "detail" in out
    code, out = _cli("nope", {})
    assert code == 2
