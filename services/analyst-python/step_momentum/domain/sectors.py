"""Sectoare și momentum pe sectoare. Funcții pure: fără rețea, fără ceas, fără fișiere.

Un sector este o categorie CoinGecko (de exemplu `ai-agents`). Identitatea unui activ este cheia lui
din univers (`cg:<id CoinGecko>`), nu simbolul: două monede pot avea același simbol, iar un sector
atribuit după simbol ar fi o etichetă greșită. Fără identitate sigură, sectorul rămâne necunoscut.

Momentumul unui sector este media randamentelor pe 7 zile ale membrilor lui evaluați în rularea
curentă (toți cei evaluați, nu doar cei semnalați, care sunt un subset ales după aceleași reguli).
Apare doar cu cel puțin `MIN_SECTOR_MEMBERS` membri: media unui singur token nu spune nimic despre sector.
"""
from __future__ import annotations

import math

MIN_SECTOR_MEMBERS = 3
CG_PREFIX = "cg:"


def _finite(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def build_sector_index(members) -> dict[str, list[str]]:
    """members: iterabil de {"id": <id CoinGecko>, "sector": <categorie>} → {id: [sector, …]}."""
    index: dict[str, list[str]] = {}
    for member in members or []:
        if not isinstance(member, dict):
            continue
        coin_id = str(member.get("id") or "").strip()
        sector = str(member.get("sector") or "").strip()
        if not coin_id or not sector:
            continue
        sectors = index.setdefault(coin_id, [])
        if sector not in sectors:
            sectors.append(sector)
    return index


def resolve_sectors(index, key) -> list[str]:
    """Sectoarele unui activ după cheia din univers; `[]` când cheia nu e `cg:<id>` sau id-ul nu e în index."""
    if not index or not isinstance(key, str) or not key.startswith(CG_PREFIX):
        return []
    return list(index.get(key[len(CG_PREFIX):], []))


def compute_sector_momentum(sectors_by_asset, returns_by_asset, *, min_members: int = MIN_SECTOR_MEMBERS) -> dict[str, float]:
    """Media randamentelor pe sector → {sector: medie}, doar pentru sectoarele cu cel puțin `min_members` membri.

    sectors_by_asset: {cheie activ: [sector, …]}; returns_by_asset: {cheie activ: randament %}.
    Randamentele lipsă sau nefinite ies din medie; nu sunt numărate ca zero.
    """
    buckets: dict[str, list[float]] = {}
    for key, sectors in (sectors_by_asset or {}).items():
        value = _finite((returns_by_asset or {}).get(key))
        if value is None:
            continue
        for sector in dict.fromkeys(sectors or []):
            buckets.setdefault(sector, []).append(value)
    floor = max(1, int(min_members))
    return {sector: sum(values) / len(values) for sector, values in sorted(buckets.items()) if len(values) >= floor}
