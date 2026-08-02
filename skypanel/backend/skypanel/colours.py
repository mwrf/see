"""Airline identity: ICAO code -> name and brand colour.

The mapping is *data* (``data/airlines.json``), not code, so adding an operator
is a one-line edit or a ``just add-airline`` invocation rather than a patch.
Unknown airlines render white -- deliberately, because a wrong brand colour
reads as a bug while white reads as "we don't know this one".
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from .paths import data_file

DATA_PATH = data_file("airlines.json")
UNKNOWN_COLOUR = "#FFFFFF"

#: A civil callsign is three letters of ICAO operator code followed by a flight
#: number that may carry a letter suffix: RYR1812, BAW23K, EIN12A.
CALLSIGN_RE = re.compile(r"^([A-Z]{3})(\d{1,4}[A-Z]{0,2})$")


@dataclass(frozen=True, slots=True)
class Airline:
    code: str
    name: str
    colour: str
    #: IATA designator, when the operator has one.  Used to show the flight
    #: number a passenger would recognise (FR1812) rather than the ICAO
    #: callsign the receiver hears (RYR1812).
    iata: str | None = None

    def to_json(self) -> dict[str, str | None]:
        return {"code": self.code, "name": self.name, "colour": self.colour, "iata": self.iata}


class AirlineRegistry:
    """In-memory view of ``airlines.json``."""

    def __init__(self, airlines: dict[str, Airline]) -> None:
        self._airlines = airlines

    def __len__(self) -> int:
        return len(self._airlines)

    def __contains__(self, code: str) -> bool:
        return code.strip().upper() in self._airlines

    def get(self, code: str | None) -> Airline | None:
        if not code:
            return None
        return self._airlines.get(code.strip().upper())

    def codes(self) -> list[str]:
        return sorted(self._airlines)

    def resolve(self, callsign: str | None) -> Airline | None:
        """Map a callsign to its operator, if the prefix is one we know."""
        code = operator_code(callsign)
        return self.get(code)

    def colour_for(self, callsign: str | None) -> str:
        airline = self.resolve(callsign)
        return airline.colour if airline else UNKNOWN_COLOUR

    @classmethod
    def load(cls, path: Path | None = None) -> AirlineRegistry:
        raw: Any = json.loads((path or DATA_PATH).read_text())
        if not isinstance(raw, dict):
            raise ValueError("airlines.json must be an object keyed by ICAO code")
        airlines: dict[str, Airline] = {}
        for code, entry in raw.items():
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name", code)).upper()
            colour = normalise_colour(str(entry.get("rgb", UNKNOWN_COLOUR)))
            raw_iata = entry.get("iata")
            iata = str(raw_iata).strip().upper() or None if raw_iata else None
            airlines[code.strip().upper()] = Airline(code.strip().upper(), name, colour, iata)
        return cls(airlines)


def operator_code(callsign: str | None) -> str | None:
    """Extract the three-letter ICAO operator code from a callsign."""
    if not callsign:
        return None
    match = CALLSIGN_RE.match(callsign.strip().upper())
    return match.group(1) if match else None


def flight_number(callsign: str | None) -> str | None:
    if not callsign:
        return None
    match = CALLSIGN_RE.match(callsign.strip().upper())
    return match.group(2) if match else None


def normalise_colour(value: str) -> str:
    """Accept ``#rgb``/``#rrggbb``/``rrggbb`` and return canonical ``#RRGGBB``."""
    text = value.strip().lstrip("#")
    if len(text) == 3 and all(c in "0123456789abcdefABCDEF" for c in text):
        text = "".join(c * 2 for c in text)
    if len(text) != 6 or any(c not in "0123456789abcdefABCDEF" for c in text):
        return UNKNOWN_COLOUR
    return "#" + text.upper()


def to_rgb(colour: str) -> tuple[int, int, int]:
    text = normalise_colour(colour).lstrip("#")
    return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)


def dim(colour: str, factor: float) -> str:
    """Scale a colour towards black; used for secondary lines."""

    def clamp(value: int) -> int:
        return max(0, min(255, round(value * factor)))

    r, g, b = to_rgb(colour)
    return f"#{clamp(r):02X}{clamp(g):02X}{clamp(b):02X}"


#: The gamma ramp the HUB75 driver applies to its PWM, reproduced by the
#: emulator. Everything sent to the panel is raised to this power before it
#: becomes light.
PANEL_GAMMA = 2.2

#: The brightness a title has to *actually* emit, on the same 0-255 scale, to
#: read across a room at typical panel brightness.
MIN_PANEL_LEVEL = 110


def required_linear(level: int, gamma: float = PANEL_GAMMA) -> int:
    """The value to send so the panel emits ``level``.

    The inverse of the driver's gamma ramp.  Worth spelling out, because the
    intuitive version of the check below -- comparing raw channel values
    against a threshold -- is wrong by a factor of three at the dark end, which
    is exactly where airline navies live.
    """
    clamped = max(0, min(255, level))
    linear: float = 255.0 * (clamped / 255.0) ** (1.0 / gamma)
    return round(linear)


def panel_level(colour: str, gamma: float = PANEL_GAMMA) -> int:
    """Peak brightness this colour will actually emit, after gamma."""
    emitted: float = 255.0 * (max(to_rgb(colour)) / 255.0) ** gamma
    return round(emitted)


def ensure_legible(
    colour: str, *, min_level: int = MIN_PANEL_LEVEL, gamma: float = PANEL_GAMMA
) -> str:
    """Lift dark brand colours so they survive the panel's gamma ramp.

    Ryanair's #073590 has a peak channel of 144, which sounds bright enough --
    but 144 through a 2.2 gamma emits 73, and several carriers' navies land
    under 30, which on a P4 panel is indistinguishable from off.  The emulator
    is what makes this visible; this function is the fix.

    All three channels scale by the same factor, so the hue is untouched and
    the colour still reads as that airline's blue.  Only the value changes.
    """
    r, g, b = to_rgb(colour)
    peak = max(r, g, b)
    floor = required_linear(min_level, gamma)
    if peak >= floor:
        return normalise_colour(colour)
    if peak == 0:
        #  Pure black would be invisible whatever we did to it.
        return "#FFFFFF"
    scale = floor / peak

    def lift(channel: int) -> int:
        return min(255, round(channel * scale))

    return f"#{lift(r):02X}{lift(g):02X}{lift(b):02X}"


@lru_cache(maxsize=1)
def default_registry() -> AirlineRegistry:
    return AirlineRegistry.load()
