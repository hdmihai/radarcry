"""
OnchainPort prin Web3.py, pe noduri RPC publice (fără cheie, doar citire).

Regula proiectului rămâne: doar surse publice sau cu cont gratuit. Nodurile implicite sunt
endpoint-urile publice PublicNode (același furnizor deja aprobat pentru Solana în motorul Node.js).
Orice nod poate fi înlocuit prin variabila de mediu RPC_<LANȚ>, de ex. RPC_BSC=https://...

Citește doar: bytecode (este contract?), name, symbol, decimals, totalSupply, blocul curent.
Nu există nicio metodă care semnează sau trimite tranzacții.
"""
from __future__ import annotations

import os
from typing import Any

from ports import OnchainUnavailable

DEFAULT_RPC = {
    "ethereum": "https://ethereum-rpc.publicnode.com",
    "bsc": "https://bsc-rpc.publicnode.com",
    "base": "https://base-rpc.publicnode.com",
    "arbitrum": "https://arbitrum-one-rpc.publicnode.com",
    "polygon": "https://polygon-bor-rpc.publicnode.com",
    "optimism": "https://optimism-rpc.publicnode.com",
    "avalanche": "https://avalanche-c-chain-rpc.publicnode.com",
}

ERC20_ABI = [
    {"constant": True, "inputs": [], "name": "name", "outputs": [{"name": "", "type": "string"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "symbol", "outputs": [{"name": "", "type": "string"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "decimals", "outputs": [{"name": "", "type": "uint8"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "totalSupply", "outputs": [{"name": "", "type": "uint256"}], "type": "function"},
]


class Web3OnchainReader:
    def __init__(self, rpc: dict[str, str] | None = None, timeout_s: float = 8.0):
        self.rpc = {**DEFAULT_RPC, **{k.lower(): v for k, v in (rpc or {}).items()}}
        for chain in list(self.rpc):
            override = os.environ.get(f"RPC_{chain.upper()}")
            if override:
                self.rpc[chain] = override
        self.timeout_s = timeout_s
        self._clients: dict[str, Any] = {}

    def chains(self) -> list[str]:
        return sorted(self.rpc)

    def _client(self, chain: str):
        if chain not in self.rpc:
            raise ValueError(f"lanț nesuportat: {chain}")
        if chain not in self._clients:
            try:
                from web3 import Web3  # import leneș: serviciul pornește și fără web3
            except ImportError as err:  # pragma: no cover - depinde de mediu
                raise OnchainUnavailable("pachetul web3 nu este instalat") from err
            self._clients[chain] = Web3(Web3.HTTPProvider(self.rpc[chain], request_kwargs={"timeout": self.timeout_s}))
        return self._clients[chain]

    def token_facts(self, chain: str, address: str) -> dict[str, Any]:
        w3 = self._client(chain)
        from web3 import Web3

        if not Web3.is_address(address):
            raise ValueError("adresă EVM invalidă")
        addr = Web3.to_checksum_address(address)
        try:
            code = w3.eth.get_code(addr)
            block = w3.eth.block_number
        except Exception as err:  # rețea / nod
            raise OnchainUnavailable(f"nodul RPC {chain} nu răspunde: {type(err).__name__}") from err
        facts: dict[str, Any] = {"chain": chain, "address": addr, "block": int(block), "isContract": len(code) > 0, "bytecodeSize": len(code)}
        if not facts["isContract"]:
            return facts
        token = w3.eth.contract(address=addr, abi=ERC20_ABI)
        for fn in ("name", "symbol", "decimals", "totalSupply"):
            try:
                facts[fn] = getattr(token.functions, fn)().call()
            except Exception:
                facts[fn] = None  # necunoscut, nu negativ
        if isinstance(facts.get("totalSupply"), int) and isinstance(facts.get("decimals"), int):
            facts["totalSupplyUnits"] = facts["totalSupply"] / (10 ** facts["decimals"])
            facts["totalSupply"] = str(facts["totalSupply"])  # uint256 nu încape în JSON number
        facts["isErc20"] = all(facts.get(k) is not None for k in ("decimals", "totalSupply"))
        return facts
