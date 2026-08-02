"""Airline brand colours.

`data/airlines.json` maps ICAO operator code to a display name and a hex colour. It is
data, not code — use ``just add-airline`` (or `skypanel-airline`) to extend it.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DEFAULT_COLOUR = "#ffffff"
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


@dataclass(frozen=True, slots=True)
class Airline:
    icao: str
    name: str
    colour: str


def data_dir() -> Path:
    """The bundled `backend/data` directory."""
    return Path(__file__).resolve().parent.parent / "data"


@lru_cache(maxsize=1)
def _airlines() -> dict[str, Airline]:
    path = data_dir() / "airlines.json"
    if not path.exists():
        return {}
    raw: dict[str, dict[str, str]] = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, Airline] = {}
    for code, entry in raw.items():
        colour = entry.get("rgb", DEFAULT_COLOUR)
        if not _HEX_RE.match(colour):
            colour = DEFAULT_COLOUR
        out[code.upper()] = Airline(code.upper(), entry.get("name", code.upper()), colour)
    return out


def reload_airlines() -> None:
    """Drop the cache — used by the add-airline helper and by tests."""
    _airlines.cache_clear()


def lookup(icao: str | None) -> Airline | None:
    if not icao:
        return None
    return _airlines().get(icao.upper())


def colour_for(icao: str | None) -> str:
    """Brand colour for an operator code; white when unknown."""
    airline = lookup(icao)
    return airline.colour if airline else DEFAULT_COLOUR


def name_for(icao: str | None) -> str | None:
    airline = lookup(icao)
    return airline.name if airline else None


def operator_from_callsign(callsign: str | None) -> str | None:
    """The three-letter operator prefix of an ICAO callsign, e.g. ``RYR1812`` → ``RYR``.

    Returns None for tail numbers (``N123AB``, ``EI-DAA``) and for anything that
    doesn't look like ``AAA<digits>``.
    """
    if not callsign:
        return None
    cs = callsign.strip().upper()
    if len(cs) < 4 or "-" in cs:
        return None
    prefix, rest = cs[:3], cs[3:]
    if not prefix.isalpha() or not rest or not rest[0].isdigit():
        return None
    return prefix


def add_airline(icao: str, name: str, colour: str) -> None:
    """Write a new airline into `data/airlines.json`, keeping the file sorted."""
    if not _HEX_RE.match(colour):
        raise ValueError(f"colour must be #RRGGBB, got {colour!r}")
    path = data_dir() / "airlines.json"
    raw: dict[str, dict[str, str]] = (
        json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    )
    raw[icao.upper()] = {"name": name, "rgb": colour.lower()}
    ordered = dict(sorted(raw.items()))
    path.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    reload_airlines()


def dim(colour: str, factor: float) -> str:
    """Scale a hex colour towards black. Used for night mode and secondary lines."""
    if not _HEX_RE.match(colour):
        colour = DEFAULT_COLOUR
    r, g, b = (int(colour[i : i + 2], 16) for i in (1, 3, 5))
    scaled = tuple(max(0, min(255, round(c * factor))) for c in (r, g, b))
    return "#{:02x}{:02x}{:02x}".format(*scaled)
