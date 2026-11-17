"""Contractul HTTP al analistului (Pydantic). Oglindește domain/radar.js → analystPayload din api-node."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator


class Market(BaseModel):
    price: Optional[float] = None
    marketCap: Optional[float] = None
    fdv: Optional[float] = None
    volume24h: Optional[float] = None


class Series(BaseModel):
    d1: list[list[float]] = Field(default_factory=list, max_length=5000)
    h4: list[list[float]] = Field(default_factory=list, max_length=5000)
    sparkline: list[float] = Field(default_factory=list, max_length=5000)

    @field_validator("d1", "h4")
    @classmethod
    def ohlcv_rows(cls, rows: list[list[float]]) -> list[list[float]]:
        for r in rows:
            if len(r) != 2 and len(r) < 5:
                raise ValueError("fiecare rând are forma [t, close] sau [t, o, h, l, c, v]")
        return rows


class ScorePoint(BaseModel):
    at: Optional[str] = None
    score: Optional[float] = None
    stage: Optional[str] = None
    price: Optional[float] = None


class AssetPayload(BaseModel):
    key: str = Field(max_length=200)
    symbol: Optional[str] = Field(default=None, max_length=64)
    chain: Optional[str] = None
    contract: Optional[str] = None
    market: Market = Field(default_factory=Market)
    series: Series = Field(default_factory=Series)
    scoreHistory: list[ScorePoint] = Field(default_factory=list, max_length=2000)


class UniversePayload(BaseModel):
    assets: list[AssetPayload] = Field(min_length=3, max_length=500)
    correlationThreshold: float = Field(default=0.7, ge=0.3, le=0.99)


class SeriesPayload(BaseModel):
    closes: list[float] = Field(min_length=10, max_length=5000)
    volumes: Optional[list[float]] = None
    periodsPerYear: float = Field(default=365, ge=1, le=525600)
    symbol: Optional[str] = Field(default=None, max_length=32)
