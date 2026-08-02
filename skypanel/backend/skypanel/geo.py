"""Spherical geometry: distance, bearing, and picking the nearest aircraft."""

from __future__ import annotations

from math import asin, atan2, cos, degrees, radians, sin, sqrt

from .models import Aircraft

EARTH_RADIUS_NM = 3440.065
NM_PER_MILE = 0.868976
NM_PER_KM = 0.539957


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in nautical miles."""
    p1, p2 = radians(lat1), radians(lat2)
    dphi = p2 - p1
    dlambda = radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_NM * asin(sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, in degrees true."""
    p1, p2 = radians(lat1), radians(lat2)
    dlambda = radians(lon2 - lon1)
    y = sin(dlambda) * cos(p2)
    x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dlambda)
    return (degrees(atan2(y, x)) + 360.0) % 360.0


def compass_point(bearing: float) -> str:
    """16-point compass abbreviation for a bearing."""
    points = (
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    )  # fmt: skip
    return points[int((bearing % 360.0) / 22.5 + 0.5) % 16]


def annotate_distances(
    aircraft: list[Aircraft], home_lat: float, home_lon: float
) -> list[Aircraft]:
    """Fill `distance_nm` and `bearing_deg` on every aircraft that has a position."""
    for ac in aircraft:
        if ac.lat is None or ac.lon is None:
            continue
        ac.distance_nm = haversine_nm(home_lat, home_lon, ac.lat, ac.lon)
        ac.bearing_deg = bearing_deg(home_lat, home_lon, ac.lat, ac.lon)
    return aircraft


def nearest(
    aircraft: list[Aircraft],
    home_lat: float,
    home_lon: float,
    max_nm: float | None = None,
) -> Aircraft | None:
    """The closest aircraft with a position, optionally within `max_nm`.

    Ties are broken by hex so repeated calls over the same data are stable — the panel
    flickering between two equidistant aircraft looks like a bug even when it isn't.
    """
    annotate_distances(aircraft, home_lat, home_lon)
    candidates = [ac for ac in aircraft if ac.distance_nm is not None]
    if max_nm is not None:
        candidates = [
            ac for ac in candidates if ac.distance_nm is not None and ac.distance_nm <= max_nm
        ]
    if not candidates:
        return None
    return min(candidates, key=lambda ac: (ac.distance_nm or 0.0, ac.hex))


def great_circle_fraction(
    origin: tuple[float, float],
    destination: tuple[float, float],
    current: tuple[float, float],
) -> float:
    """How far along an origin→destination leg `current` is, clamped to 0..1.

    Uses along-track distance rather than straight ratios so a flight that has been
    vectored off the direct line doesn't jump backwards.
    """
    total = haversine_nm(*origin, *destination)
    if total <= 0.1:
        return 1.0
    flown = haversine_nm(*origin, *current)
    remaining = haversine_nm(*current, *destination)
    # Project onto the leg; the halves rarely sum to `total` exactly when off-track.
    fraction = (flown + (total - remaining)) / (2 * total)
    return max(0.0, min(1.0, fraction))
