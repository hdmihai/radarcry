"""Calcule pure pentru momentum-ul pe sectoare."""
def compute_sector_momentum(sector_map, symbol_returns):
    """Calculează media randamentelor pe fiecare sector.
    
    symbol_returns: dict {symbol: randament_procentual}
    Returnează: dict {sector: media_randamentelor}
    """
    sector_returns = {}
    for symbol, sectors in sector_map.items():
        ret = symbol_returns.get(symbol)
        if ret is None:
            continue
        for sector in sectors:
            if sector not in sector_returns:
                sector_returns[sector] = []
            sector_returns[sector].append(ret)
            
    return {sector: sum(vals) / len(vals) for sector, vals in sector_returns.items()}
