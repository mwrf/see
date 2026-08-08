"""Great-circle helpers and nearest-target selection."""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

from .models import Aircraft

EARTH_RADIUS_MI = 3958.7613
MI_PER_NM = 1.15077945


def haversine_mi(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in statute miles."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(math.sqrt(min(1.0, a)))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, in [0, 360)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_lambda = math.radians(lon2 - lon1)
    y = math.sin(d_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def within_radius(
    aircraft: Iterable[Aircraft], lat: float, lon: float, radius_mi: float
) -> list[tuple[Aircraft, float]]:
    """Pair each positioned aircraft with its distance, keeping those in range.

    Sorted nearest-first so callers can take ``[0]`` for the nearest target.
    """
    out: list[tuple[Aircraft, float]] = []
    for ac in aircraft:
        if ac.lat is None or ac.lon is None:
            continue
        distance = haversine_mi(lat, lon, ac.lat, ac.lon)
        if distance <= radius_mi:
            out.append((ac, distance))
    out.sort(key=lambda pair: pair[1])
    return out


def nearest(
    aircraft: Sequence[Aircraft], lat: float, lon: float, radius_mi: float
) -> tuple[Aircraft, float] | None:
    """The closest aircraft within ``radius_mi``, or ``None`` for an empty sky."""
    candidates = within_radius(aircraft, lat, lon, radius_mi)
    return candidates[0] if candidates else None
