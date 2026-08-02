"""Unit conversion and display formatting.

All conversion happens server-side so the firmware never has to know what a
knot is.  Each formatter returns the string exactly as it should appear on the
panel, including its unit suffix, because character count drives whether a line
needs to scroll.
"""

from __future__ import annotations

from typing import Literal

AltitudeUnit = Literal["ft", "m"]
SpeedUnit = Literal["kt", "mph", "kmh"]
DistanceUnit = Literal["mi", "km"]

FT_PER_M = 3.280839895
KT_TO_MPH = 1.15077945
KT_TO_KMH = 1.852
MI_TO_KM = 1.609344


def _thousands(value: int) -> str:
    return f"{value:,}"


def format_altitude(
    feet: float | None, unit: AltitudeUnit = "ft", *, on_ground: bool = False
) -> str:
    """``24,000FT`` / ``7,315M`` / ``GROUND``."""
    if on_ground:
        return "GROUND"
    if feet is None:
        return "----"
    if unit == "m":
        return f"{_thousands(round(feet / FT_PER_M))}M"
    return f"{_thousands(round(feet))}FT"


def format_speed(knots: float | None, unit: SpeedUnit = "kt") -> str:
    """``410KT`` / ``472MPH`` / ``759KM/H``."""
    if knots is None:
        return "----"
    if unit == "mph":
        return f"{round(knots * KT_TO_MPH)}MPH"
    if unit == "kmh":
        return f"{round(knots * KT_TO_KMH)}KM/H"
    return f"{round(knots)}KT"


def format_distance(miles: float | None, unit: DistanceUnit = "mi") -> str:
    """``6.1MI`` / ``9.8KM``.

    One decimal below 100, none above, so the string never grows past 6
    characters.
    """
    if miles is None:
        return "----"
    value = miles * MI_TO_KM if unit == "km" else miles
    suffix = "KM" if unit == "km" else "MI"
    if value < 100:
        return f"{value:.1f}{suffix}"
    return f"{round(value)}{suffix}"


def format_vert_rate(fpm: float | None, unit: AltitudeUnit = "ft") -> str:
    """Signed climb rate with an up/down arrow, or an empty string when level.

    The arrows are U+25B2/U+25BC; the renderer maps them onto dedicated glyphs.
    """
    if fpm is None or abs(fpm) < 100:
        return ""
    arrow = "▲" if fpm > 0 else "▼"
    magnitude = abs(fpm)
    if unit == "m":
        return f"{arrow}{round(magnitude / FT_PER_M)}M/M"
    return f"{arrow}{_thousands(round(magnitude))}FPM"


def radius_mi_to_nm(radius_mi: float) -> float:
    return radius_mi / KT_TO_MPH


def nm_to_mi(nm: float) -> float:
    return nm * KT_TO_MPH
