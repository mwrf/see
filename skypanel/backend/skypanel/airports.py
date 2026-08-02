"""Airport code -> city, from an OurAirports subset (public domain).

``data/airports.csv`` holds only ``ident,iata,municipality`` because that is
all the panel needs and a 10 MB CSV has no business on a Pi's SD card.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "airports.csv"


@dataclass(frozen=True, slots=True)
class Airport:
    ident: str
    iata: str | None
    city: str
    #: Optional, and only used by tracking mode's progress bar.  The reduction
    #: script keeps these columns because a route with no endpoints cannot be
    #: turned into a completion fraction.
    lat: float | None = None
    lon: float | None = None

    @property
    def has_position(self) -> bool:
        return self.lat is not None and self.lon is not None


class AirportRegistry:
    """Lookup by ICAO ident or IATA code, whichever the provider handed us."""

    def __init__(self, airports: list[Airport]) -> None:
        self._by_ident = {a.ident: a for a in airports if a.ident}
        self._by_iata = {a.iata: a for a in airports if a.iata}

    def __len__(self) -> int:
        return len(self._by_ident)

    def get(self, code: str | None) -> Airport | None:
        if not code:
            return None
        key = code.strip().upper()
        return self._by_ident.get(key) or self._by_iata.get(key)

    def city(self, code: str | None) -> str | None:
        airport = self.get(code)
        return airport.city if airport else None

    def display(self, code: str | None, *, prefer_city: bool) -> str | None:
        """The string to put on the panel for an airport code.

        Falls back to the raw code when we have no city, so a missing row never
        blanks out half a route.
        """
        if not code:
            return None
        if not prefer_city:
            return code.strip().upper()
        return self.city(code) or code.strip().upper()

    @classmethod
    def load(cls, path: Path | None = None) -> AirportRegistry:
        target = path or DATA_PATH
        airports: list[Airport] = []
        with target.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                ident = (row.get("ident") or "").strip().upper()
                city = (row.get("municipality") or "").strip()
                if not ident or not city:
                    continue
                iata = (row.get("iata") or "").strip().upper() or None
                airports.append(
                    Airport(
                        ident=ident,
                        iata=iata,
                        city=city,
                        lat=_as_float(row.get("lat")),
                        lon=_as_float(row.get("lon")),
                    )
                )
        return cls(airports)


def _as_float(value: str | None) -> float | None:
    if value is None or not value.strip():
        return None
    try:
        return float(value)
    except ValueError:
        return None


@lru_cache(maxsize=1)
def default_registry() -> AirportRegistry:
    return AirportRegistry.load()
