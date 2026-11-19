"""Catalogul factorilor: etichetă în română, unitate de afișare, familie, explicație."""
from __future__ import annotations

# key: (etichetă, format, familie, explicație)
#   format: pct (fracție → %), x (multiplicator), z (scor z), n (număr), rate8h (funding/8h), usd, bool
FEATURES: dict[str, tuple[str, str, str, str]] = {
    "ret_1d": ("Randament 1 zi", "pct", "preț", "Variația de ieri pe azi."),
    "ret_3d": ("Randament 3 zile", "pct", "preț", "Momentum foarte scurt."),
    "ret_7d": ("Randament 7 zile", "pct", "preț", "Cât a urcat deja în ultima săptămână — prea mult înseamnă intrare târzie."),
    "ret_30d": ("Randament 30 zile", "pct", "preț", "Tendința lunii; runnerii pornesc adesea după o lună slabă."),
    "rel_btc_7d": ("Forță relativă vs BTC (7z)", "pct", "preț", "Randament 7z minus randamentul BTC — rezistență când piața e slabă."),
    "rel_mkt_7d": ("Forță relativă vs piață (7z)", "pct", "preț", "Randament 7z minus mediana universului."),
    "dist_high_90": ("Distanța de maximul 90z", "pct", "structură", "Cât e sub maximul ultimelor 90 de zile."),
    "dd_ath": ("Drawdown de la ATH", "pct", "structură", "Cât e sub maximul istoric disponibil — capitulare = combustibil."),
    "rebound_low_30": ("Revenire de la minimul 30z", "pct", "structură", "Cât a urcat de la minimul lunii."),
    "range_pos_30": ("Poziția în range-ul 30z", "n", "structură", "0 = la minim, 1 = la maxim."),
    "days_since_low_90": ("Zile de la minimul 90z", "n", "structură", "Bază recentă (fund proaspăt) vs bază veche."),
    "bb_width": ("Lățime Bollinger (20z)", "pct", "volatilitate", "Volatilitate relativă; comprimarea precede expansiunea."),
    "bb_width_pct90": ("Compresie Bollinger (percentilă 90z)", "n", "volatilitate", "0 = cea mai strânsă bandă din 90 de zile."),
    "atr_ratio_7_30": ("ATR 7z / ATR 30z", "x", "volatilitate", "Expansiunea recentă a amplitudinii zilnice."),
    "rsi_14": ("RSI 14", "n", "momentum", "Peste 80 = supracumpărat (risc de inversare)."),
    "streak_up": ("Zile verzi consecutive", "n", "momentum", "Câte închideri pozitive la rând."),
    "close_loc": ("Închidere în range-ul zilei", "n", "momentum", "1 = închidere la maxim (cumpărători în control)."),
    "wick_up": ("Fitil superior", "pct", "momentum", "Respingere la maxim — semn de vânzare în forță."),
    "vol_z30": ("Volum anormal (z robust 30z)", "z", "volum", "Volumul de azi față de mediana și MAD-ul ultimelor 30 de zile."),
    "vol_ratio_7_30": ("Volum 7z / 30z", "x", "volum", "Acumulare: volum mediu recent față de luna anterioară."),
    "vol_ratio_3_14": ("Volum 3z / 14z", "x", "volum", "Accelerarea foarte recentă a volumului."),
    "up_vol_share_14": ("Volum în zile verzi (14z)", "pct", "volum", "Ponderea volumului tranzacționat în zilele de creștere."),
    "obv_slope_14": ("Pantă OBV (14z)", "n", "volum", "Presiunea netă de cumpărare normalizată."),
    "turnover": ("Turnover Gate (volum / market cap)", "pct", "volum", "Volumul zilnic al perechii Gate raportat la market cap (doar o parte din volumul total al pieței)."),
    "log_mcap": ("Market cap (log10 USD)", "n", "mărime", "Capitalizare estimată la acea zi; runnerii sunt de obicei $10M–$300M."),
    "age_days": ("Vechime pe piață (zile)", "n", "mărime", "Zile de la prima lumânare disponibilă (plafonat la ~1000)."),
    "has_perp": ("Are perpetual (futures)", "bool", "derivate", "Existența unui contract perpetual la acea dată."),
    "perp_age_days": ("Vechime perpetual (zile)", "n", "derivate", "Perpetual nou listat = squeeze frecvent."),
    "oi_chg_1d": ("OI variație 1 zi", "pct", "derivate", "Open interest nou intrat ieri."),
    "oi_chg_7d": ("OI variație 7 zile", "pct", "derivate", "Poziționare acumulată în ultima săptămână."),
    "oi_to_mcap": ("OI / market cap", "x", "derivate", "Levier față de mărime — mare = squeeze posibil în ambele direcții."),
    "oi_to_vol": ("OI / volum spot", "x", "derivate", "Cât din activitate e levier."),
    "funding_1d": ("Funding mediu (zi)", "rate8h", "derivate", "Negativ = short-urile plătesc (combustibil de short squeeze)."),
    "funding_3d": ("Funding mediu (3z)", "rate8h", "derivate", "Persistența poziționării short/long."),
    "lsr": ("Long/short (conturi)", "x", "derivate", "Sub 1 = majoritatea conturilor sunt short."),
    "top_lsr": ("Long/short top traderi (mărime)", "x", "derivate", "Poziționarea banilor mari."),
    "liq_short_z": ("Lichidări short anormale (z)", "z", "derivate", "Short-uri forțate să cumpere — mecanismul squeeze-ului."),
    "liq_short_share": ("Pondere lichidări short", "pct", "derivate", "Din totalul lichidărilor, cât sunt short."),
    "mkt_breadth": ("Lățimea pieței", "pct", "regim", "Ponderea activelor din univers pe plus în ziua respectivă."),
    "mkt_ret_7d": ("Piața pe 7 zile (mediană)", "pct", "regim", "Regimul pieței altcoin."),
    "btc_ret_7d": ("BTC pe 7 zile", "pct", "regim", "Regimul BTC."),
}

FEATURE_KEYS = list(FEATURES)

# Factori care descriu contextul pieței (identici pentru toate activele într-o zi) — utili pentru
# model, dar nu sunt „factori ai proiectului”, deci nu intră în regulile/fingerprint-urile per activ.
MARKET_KEYS = {"mkt_breadth", "mkt_ret_7d", "btc_ret_7d"}


def label(key: str) -> str:
    return FEATURES.get(key, (key,))[0]


def fmt(key: str, value) -> str:
    import math
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "—"
    kind = FEATURES.get(key, (None, "n"))[1]
    v = float(value)
    if kind == "pct":
        return f"{v * 100:+.1f}%" if key.startswith(("ret", "rel", "oi_chg", "mkt_ret", "btc", "dist", "dd")) else f"{v * 100:.1f}%"
    if kind == "x":
        return f"{v:.2f}×"
    if kind == "z":
        return f"{v:+.1f}σ"
    if kind == "rate8h":
        return f"{v * 100:+.4f}%/8h"
    if kind == "bool":
        return "da" if v >= 0.5 else "nu"
    if key in ("streak_up", "age_days", "perp_age_days", "days_since_low_90"):
        return f"{v:.0f}"
    if key == "log_mcap":
        return f"${10 ** v / 1e6:,.1f}M"
    if abs(v) >= 100:
        return f"{v:,.0f}"
    return f"{v:.2f}"
