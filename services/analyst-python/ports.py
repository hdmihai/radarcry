"""Porturile analistului: ce are nevoie aplicația din exterior. Adaptoarele din adapters/ le implementează."""
from __future__ import annotations

from typing import Any, Protocol


class OnchainPort(Protocol):
    """Fapte on-chain despre un contract ERC-20 (doar citire, fără chei private, fără tranzacții)."""

    def chains(self) -> list[str]: ...

    def token_facts(self, chain: str, address: str) -> dict[str, Any]: ...


class OnchainUnavailable(RuntimeError):
    """Nodul RPC nu răspunde sau web3 nu este instalat (mapat la HTTP 503)."""
