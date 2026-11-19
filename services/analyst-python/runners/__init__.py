"""Potențiali runneri — modul de cercetare Python pentru ecranul „Top 7 zile”.

Arhitectură hexagonală, în același spirit ca restul radarului:

    domain/        logică pură (fără rețea, fără fișiere): factori point-in-time, etichete,
                   analiza factorilor comuni, reguli interpretabile, model, similaritate, scor
    ports.py       contractele pe care domeniul/aplicația le cer de la exterior
    adapters/      implementările porturilor: Gate (keyless), CoinGecko (keyless / cheie Demo),
                   fișierele radarului (universe.json, catalysts.json), depozit parquet, date sintetice
    application/   pipeline-ul care leagă totul și scrie data/runners.json

Rulare:  python -m runners run --data data --state .state/runners --config config/runners.json
"""

__version__ = "1.0.0"
