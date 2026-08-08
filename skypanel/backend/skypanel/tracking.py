"""Tracking mode: follow one flight until it lands.

Nearest-aircraft mode is what the panel does all day; tracking is what you
switch it to when someone you know is in the air.  The interesting parts are
the progress fraction (three ways to compute it, in descending order of
accuracy) and knowing when to give up and go back to nearest.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from .airports import AirportRegistry
from .colours import AirlineRegistry
from .frame import matches_ident
from .geo import haversine_mi
from .models import Aircraft, EnrichedAircraft, Progress

#: Below this the aircraft is on approach; combined with a descent it means the
#: flight is effectively over.
LANDING_ALT_FT = 500.0

#: Stop tracking after this long without a position report.  Aircraft leave
#: receiver range routinely, so this is generous.
LOST_AFTER = timedelta(minutes=10)

#: ...unless we last saw it low and descending, in which case it landed.
LANDED_LOST_AFTER = timedelta(minutes=2)


@dataclass(slots=True)
class TrackingSession:
    """The flight the user asked to follow."""

    ident: str
    started_at: datetime
    last_seen_at: datetime | None = None
    last_altitude_ft: float | None = None
    last_vert_rate: float | None = None
    origin: str | None = None
    destination: str | None = None
    total_route_mi: float | None = None
    acquired: bool = False
    ended_reason: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "ident": self.ident,
            "started_at": self.started_at.isoformat(),
            "last_seen_at": self.last_seen_at.isoformat() if self.last_seen_at else None,
            "acquired": self.acquired,
            "origin": self.origin,
            "destination": self.destination,
            "total_route_mi": round(self.total_route_mi, 1) if self.total_route_mi else None,
            "ended_reason": self.ended_reason,
        }

    def matches(self, aircraft: Aircraft, airlines: AirlineRegistry | None = None) -> bool:
        return matches_ident(aircraft, self.ident, airlines)

    def observe(self, enriched: EnrichedAircraft, now: datetime) -> None:
        """Record a sighting so landing detection has something to work with."""
        ac = enriched.aircraft
        self.acquired = True
        self.last_seen_at = now
        self.last_altitude_ft = ac.alt_baro_ft
        self.last_vert_rate = ac.vert_rate
        self.origin = enriched.route.origin or self.origin
        self.destination = enriched.route.destination or self.destination

    def has_landed(self) -> bool:
        """True once the target is on the ground, or was low and descending."""
        if self.last_altitude_ft is None:
            return False
        if self.last_altitude_ft <= 0.0:
            return True
        descending = self.last_vert_rate is not None and self.last_vert_rate < -100
        return self.last_altitude_ft <= LANDING_ALT_FT and descending

    def should_end(self, now: datetime) -> str | None:
        """Reason to leave tracking mode, or ``None`` to keep going."""
        if self.has_landed():
            return "landed"
        if self.last_seen_at is None:
            #  Never acquired: give the user a while in case the flight has not
            #  taken off yet, then stop.
            return "not-found" if now - self.started_at > LOST_AFTER else None
        gap = now - self.last_seen_at
        if self.last_altitude_ft is not None and self.last_altitude_ft <= LANDING_ALT_FT:
            return "landed" if gap > LANDED_LOST_AFTER else None
        return "lost" if gap > LOST_AFTER else None


def compute_progress(
    session: TrackingSession,
    enriched: EnrichedAircraft,
    airports: AirportRegistry | None,
    *,
    now: datetime | None = None,
) -> Progress | None:
    """Completion fraction for the progress bar.

    Three strategies, best first:

    1. A provider-supplied ``progress_percent`` (AeroAPI knows the schedule).
    2. Geometry: how far along the origin-destination great circle we are.
       Needs coordinates for both airports.
    3. Time: elapsed since departure over total scheduled duration.

    Returns ``None`` when none of them apply, which the renderer draws as a
    frame with no bar rather than a bar stuck at zero.
    """
    stamp = now or datetime.now(UTC)
    eta_text = _eta_text(enriched, stamp)

    fraction = _geometric_fraction(session, enriched, airports)
    if fraction is None:
        fraction = _temporal_fraction(session, enriched, stamp)
    if fraction is None:
        return Progress(fraction=0.0, eta=eta_text) if eta_text else None
    return Progress(fraction=max(0.0, min(1.0, fraction)), eta=eta_text)


def _geometric_fraction(
    session: TrackingSession, enriched: EnrichedAircraft, airports: AirportRegistry | None
) -> float | None:
    if airports is None:
        return None
    ac = enriched.aircraft
    if ac.lat is None or ac.lon is None:
        return None
    origin = airports.get(enriched.route.origin or session.origin)
    destination = airports.get(enriched.route.destination or session.destination)
    if (
        origin is None
        or destination is None
        or not origin.has_position
        or not destination.has_position
    ):
        return None
    assert origin.lat is not None and origin.lon is not None
    assert destination.lat is not None and destination.lon is not None

    total = haversine_mi(origin.lat, origin.lon, destination.lat, destination.lon)
    if total < 1.0:
        return None
    session.total_route_mi = total
    remaining = haversine_mi(ac.lat, ac.lon, destination.lat, destination.lon)
    return 1.0 - (remaining / total)


def _temporal_fraction(
    session: TrackingSession, enriched: EnrichedAircraft, now: datetime
) -> float | None:
    eta = enriched.route.eta
    if eta is None or session.last_seen_at is None:
        return None
    start = session.started_at
    total = (eta - start).total_seconds()
    if total <= 0:
        return None
    return (now - start).total_seconds() / total


def _eta_text(enriched: EnrichedAircraft, now: datetime) -> str | None:
    eta = enriched.route.eta
    if eta is None:
        return None
    return eta.astimezone(now.tzinfo or UTC).strftime("%H:%M")
