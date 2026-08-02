"""Unit conversion and display formatting.

All of this happens server-side; the firmware receives finished strings.
"""

from __future__ import annotations

from typing import Literal

AltitudeUnit = Literal["ft", "m"]
SpeedUnit = Literal["kt", "mph", "kmh"]
DistanceUnit = Literal["mi", "km", "nm"]

_FT_PER_M = 3.280839895
_KT_TO_MPH = 1.150779
_KT_TO_KMH = 1.852
_NM_TO_MI = 1.150779
_NM_TO_KM = 1.852


def _thousands(value: int) -> str:
    return f"{value:,}"


def format_altitude(alt_ft: float | None, unit: AltitudeUnit, on_ground: bool = False) -> str:
    """``24,000FT`` / ``7,315M`` / ``GROUND``."""
    if on_ground:
        return "GROUND"
    if alt_ft is None:
        return "---"
    if unit == "m":
        return f"{_thousands(round(alt_ft / _FT_PER_M))}M"
    return f"{_thousands(round(alt_ft))}FT"


def format_speed(gs_kt: float | None, unit: SpeedUnit) -> str:
    """``410KT`` / ``472MPH`` / ``759KM/H``."""
    if gs_kt is None:
        return "---"
    if unit == "mph":
        return f"{round(gs_kt * _KT_TO_MPH)}MPH"
    if unit == "kmh":
        return f"{round(gs_kt * _KT_TO_KMH)}KM/H"
    return f"{round(gs_kt)}KT"


def format_distance(dist_nm: float | None, unit: DistanceUnit) -> str:
    """``6.1MI`` / ``9.8KM`` / ``5.3NM``. One decimal under 10, none above."""
    if dist_nm is None:
        return "---"
    value = convert_distance(dist_nm, unit)
    suffix = {"mi": "MI", "km": "KM", "nm": "NM"}[unit]
    if value < 10:
        return f"{value:.1f}{suffix}"
    return f"{round(value)}{suffix}"


def convert_distance(dist_nm: float, unit: DistanceUnit) -> float:
    if unit == "mi":
        return dist_nm * _NM_TO_MI
    if unit == "km":
        return dist_nm * _NM_TO_KM
    return dist_nm


def to_nm(value: float, unit: DistanceUnit) -> float:
    """Inverse of `convert_distance`, for turning a user's scan radius into NM."""
    if unit == "mi":
        return value / _NM_TO_MI
    if unit == "km":
        return value / _NM_TO_KM
    return value


def format_vertical_rate(vert_rate: float | None) -> str:
    """``↑1200`` / ``↓800`` / ``LEVEL``. The arrows are drawn as glyphs by the renderer."""
    if vert_rate is None:
        return ""
    if vert_rate > 200:
        return f"^{round(vert_rate)}"
    if vert_rate < -200:
        return f"v{round(abs(vert_rate))}"
    return "LEVEL"
