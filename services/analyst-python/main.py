"""
CRI Radar — analist Python (FastAPI). Adaptorul de intrare HTTP peste analyzer.py.

  GET  /health                         starea serviciului și capabilitățile
  POST /v1/analyze/asset               metrici cantitative + verdict pentru un proiect
  POST /v1/analyze/universe            rang transversal, clustere de corelație, beta
  POST /v1/analyze/series              serie arbitrară de prețuri
  GET  /v1/onchain/{chain}/{address}   fapte ERC-20 citite prin Web3 (RPC public)

Rulare locală:  uvicorn main:app --host 127.0.0.1 --port 8000
Documentație interactivă: http://127.0.0.1:8000/docs
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool

import analyzer
from adapters.onchain_web3 import Web3OnchainReader
from ports import OnchainPort, OnchainUnavailable
from schemas import AssetPayload, SeriesPayload, UniversePayload


def create_app(onchain: OnchainPort | None = None) -> FastAPI:
    reader: OnchainPort = onchain or Web3OnchainReader(timeout_s=float(os.environ.get("RPC_TIMEOUT_S", "8")))
    app = FastAPI(
        title="CRI Radar — analyst-python",
        version=analyzer.VERSION,
        description="Analiză cantitativă (Pandas) și on-chain (Web3) pentru radarul CRI. Cercetare, nu sfat financiar.",
    )

    def domain_call(fn, *args, **kwargs) -> Any:
        try:
            return fn(*args, **kwargs)
        except analyzer.AnalysisError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err

    @app.get("/health")
    def health() -> dict[str, Any]:
        try:
            import web3  # noqa: F401

            web3_ok = True
        except ImportError:  # pragma: no cover
            web3_ok = False
        return {
            "status": "ok",
            "service": "radarcry-analyst-python",
            "version": analyzer.VERSION,
            "capabilities": ["asset", "universe", "series"] + (["onchain"] if web3_ok else []),
            "chains": reader.chains(),
        }

    @app.post("/v1/analyze/asset")
    async def analyze_asset(payload: AssetPayload) -> dict[str, Any]:
        return await run_in_threadpool(domain_call, analyzer.analyze_asset, payload.model_dump())

    @app.post("/v1/analyze/universe")
    async def analyze_universe(payload: UniversePayload) -> dict[str, Any]:
        assets = [a.model_dump() for a in payload.assets]
        return await run_in_threadpool(domain_call, analyzer.analyze_universe, assets, payload.correlationThreshold)

    @app.post("/v1/analyze/series")
    async def analyze_series(payload: SeriesPayload) -> dict[str, Any]:
        if payload.volumes is not None and len(payload.volumes) != len(payload.closes):
            raise HTTPException(status_code=422, detail="volumes trebuie să aibă aceeași lungime ca closes")
        return await run_in_threadpool(domain_call, analyzer.analyze_series, payload.closes, payload.volumes, payload.periodsPerYear, payload.symbol)

    @app.get("/v1/onchain/{chain}/{address}")
    async def onchain_facts(chain: str, address: str) -> dict[str, Any]:
        try:
            return await run_in_threadpool(reader.token_facts, chain.lower(), address)
        except ValueError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err
        except OnchainUnavailable as err:
            raise HTTPException(status_code=503, detail=str(err)) from err

    return app


app = create_app()
