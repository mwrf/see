"""Airport code → city and position, from an OurAirports subset.

`data/airports.csv` is reduced at build time from the full ~80 000-row OurAirports
export (most of which is grass strips) to the columns this project actually reads:
`ident,iata,municipality,latitude_deg,longitude_deg`. The spec called for the first
three; the coordinates are here because tracking mode needs the endpoints of the leg to
compute a progress fraction, and a second lookup table for that would be worse.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache

from ..colours import data_dir


@dataclass(frozen=True, slots=True)
class Airport:
    ident: str
    iata: str | None
    city: str | None
    lat: float | None
    lon: float | None

    @property
    def position(self) -> tuple[float, float] | None:
        if self.lat is None or self.lon is None:
            return None
        return self.lat, self.lon


@lru_cache(maxsize=1)
def _index() -> dict[str, Airport]:
    """IATA and ICAO identifiers share one dict; ICAO wins a collision."""
    path = data_dir() / "airports.csv"
    out: dict[str, Airport] = {}
    if not path.exists():
        return out
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            ident = (row.get("ident") or "").strip().upper()
            iata = (row.get("iata") or "").strip().upper() or None
            city = (row.get("municipality") or "").strip() or None
            airport = Airport(
                ident=ident,
                iata=iata,
                city=city,
                lat=_float(row.get("latitude_deg")),
                lon=_float(row.get("longitude_deg")),
            )
            if iata:
                out.setdefault(iata, airport)
            if ident:
                out[ident] = airport
    return out


def _float(raw: str | None) -> float | None:
    if raw is None or not raw.strip():
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def lookup(code: str | None) -> Airport | None:
    if not code:
        return None
    return _index().get(code.strip().upper())


def city_for(code: str | None) -> str | None:
    airport = lookup(code)
    return airport.city if airport else None


def position_for(code: str | None) -> tuple[float, float] | None:
    airport = lookup(code)
    return airport.position if airport else None


def reload() -> None:
    _index.cache_clear()
