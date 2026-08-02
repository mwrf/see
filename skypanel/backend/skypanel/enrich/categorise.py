"""Work out what kind of aircraft we are looking at.

The category drives the user's filters ("don't show me GA circuits") so it has
to be cheap and work from the raw ADS-B fields alone -- enrichment may not have
answered yet when the first frame goes out.

Signals, in order of trustworthiness:

1. ADS-B emitter category ``A7`` is rotorcraft, straight from the transponder.
2. ICAO 24-bit address ranges permanently allocated to military operators.
3. Type code, when the decoder has an aircraft database loaded.
4. Callsign shape: ``RYR1812`` is an operator code plus flight number,
   ``EI-DYR`` or ``N737BA`` is a registration flying as itself.
"""

from __future__ import annotations

import re

from ..colours import AirlineRegistry, operator_code
from ..models import Aircraft, Category

#: ICAO 24-bit blocks reserved for military use, as (low, high) inclusive.
MILITARY_HEX_RANGES: tuple[tuple[int, int], ...] = (
    (0xADF7C8, 0xAFFFFF),  # United States military
    (0xAE0000, 0xAEFFFF),  # United States military (USAF/USN block)
    (0x43C000, 0x43CFFF),  # United Kingdom military
    (0x3B7000, 0x3BFFFF),  # France military
    (0x3EA000, 0x3EBFFF),  # Germany military
    (0x33FF00, 0x33FFFF),  # Italy military
    (0x3F4000, 0x3FBFFF),  # Germany military (secondary)
    (0x7CF800, 0x7CFAFF),  # Australia military
    (0xC20000, 0xC3FFFF),  # Canada military
)

#: Callsign prefixes used by military and state operators.
MILITARY_CALLSIGN_PREFIXES: frozenset[str] = frozenset(
    {
        "RCH",  # US Air Mobility Command "Reach"
        "RRR",  # RAF "Ascot"/"Rafair"
        "CFC",  # Canadian Forces
        "NATO",
        "IAC",  # Irish Air Corps
        "GAF",  # German Air Force
        "FAF",  # French Air Force
        "BAF",  # Belgian Air Force
        "HAF",  # Hellenic Air Force
        "NAF",  # Netherlands Air Force
        "SVF",  # Swedish Air Force
        "PLF",  # Polish Air Force
        "AME",  # US Navy
        "CNV",  # US Navy "Convoy"
        "RFR",  # RAF air-to-air refuelling
        "ASY",  # Royal Navy
        "TARTAN",
    }
)

MILITARY_TYPE_CODES: frozenset[str] = frozenset(
    {
        "A400",
        "C17",
        "C130",
        "C30J",
        "K35R",
        "P8",
        "E3TF",
        "F15",
        "F16",
        "F35",
        "EUFI",
        "H60",
        "RC135",
    }
)

HELICOPTER_TYPE_CODES: frozenset[str] = frozenset(
    {
        "EC35",
        "EC45",
        "EC30",
        "EC20",
        "EC55",
        "EC75",
        "H145",
        "H135",
        "H125",
        "H160",
        "A109",
        "A119",
        "A139",
        "AW139",
        "AW169",
        "AW189",
        "B06",
        "B407",
        "B412",
        "B429",
        "R22",
        "R44",
        "R66",
        "S76",
        "S92",
        "AS50",
        "AS55",
        "AS65",
        "S64",
        "H60",
        "UH1",
    }
)

#: A registration flying as its own callsign: EIDYR, GABCD, N737BA, DEABC.
REGISTRATION_RE = re.compile(r"^[A-Z]{1,2}\d{0,5}[A-Z]{0,4}$")

#: Squawk 7700/7600/7500 are emergencies, not a category, but worth surfacing.
EMERGENCY_SQUAWKS: frozenset[str] = frozenset({"7500", "7600", "7700"})


def is_military_hex(hex_id: str | None) -> bool:
    if not hex_id:
        return False
    try:
        value = int(hex_id.strip(), 16)
    except ValueError:
        return False
    return any(low <= value <= high for low, high in MILITARY_HEX_RANGES)


def is_emergency(aircraft: Aircraft) -> bool:
    return bool(aircraft.squawk and aircraft.squawk.strip() in EMERGENCY_SQUAWKS)


def categorise(aircraft: Aircraft, registry: AirlineRegistry | None = None) -> Category:
    """Best-effort classification of a target."""
    callsign = (aircraft.callsign or "").strip().upper()
    type_code = (aircraft.type_code or "").strip().upper()

    if (aircraft.category or "").strip().upper() == "A7":
        return "helicopter"
    if type_code and type_code in HELICOPTER_TYPE_CODES:
        return "helicopter"

    if is_military_hex(aircraft.hex):
        return "military"
    if type_code and type_code in MILITARY_TYPE_CODES:
        return "military"
    if callsign and _military_callsign(callsign):
        return "military"

    if callsign:
        code = operator_code(callsign)
        if code:
            #  A known operator is definitive; an unknown three-letter prefix
            #  with a flight number is still almost certainly commercial.
            if registry is None or code in registry:
                return "airline"
            return "airline"
        if REGISTRATION_RE.match(callsign):
            return "ga"

    return "unknown"


def _military_callsign(callsign: str) -> bool:
    if callsign in MILITARY_CALLSIGN_PREFIXES:
        return True
    for prefix in MILITARY_CALLSIGN_PREFIXES:
        if callsign.startswith(prefix) and callsign[len(prefix) :].isdigit():
            return True
    return False
