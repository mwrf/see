"""Tracking mode: follow one flight instead of whatever happens to be closest.

The interesting parts are the progress fraction — computed along the great circle
between the scheduled endpoints, not as a naive distance ratio — and knowing when to
stop. A tracked flight ends by landing, and the panel should go back to `nearest` on its
own rather than sitting on a stale frame until someone notices.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

from .enrich import airports
from .geo import great_circle_fraction, haversine_nm
from .models import Aircraft, EnrichedAircraft

log = logging.getLogger(__name__)

#: Below this AGL-ish altitude, close to the destination, we call it landed.
LANDING_ALT_FT = 1500.0
LANDING_RADIUS_NM = 8.0

#: How long a tracked flight may go unseen before we give up on it.
LOST_AFTER_S = 300.0

#: How long the completed frame lingers before auto-returning to nearest.
LINGER_AFTER_LANDING_S = 60.0


@dataclass(slots=True)
class TrackingState:
    """Live state for the flight currently being tracked."""

    ident: str
    fraction: float = 0.0
    eta_text: str | None = None
    hex: str | None = None
    landed: bool = False
    last_seen_at: float | None = None
    landed_at: float | None = None
    started_at: float = field(default_factory=time.monotonic)

    @property
    def seen(self) -> bool:
        return self.last_seen_at is not None


class Tracker:
    """Owns at most one `TrackingState` and decides when it expires."""

    def __init__(self) -> None:
        self._state: TrackingState | None = None

    @property
    def state(self) -> TrackingState | None:
        return self._state

    @property
    def active(self) -> bool:
        return self._state is not None

    def start(self, ident: str) -> TrackingState:
        ident = ident.strip().upper()
        if not ident:
            raise ValueError("ident must not be empty")
        self._state = TrackingState(ident=ident)
        log.info("tracking %s", ident)
        return self._state

    def cancel(self) -> None:
        if self._state is not None:
            log.info("stopped tracking %s", self._state.ident)
        self._state = None

    def match(self, aircraft: list[Aircraft]) -> Aircraft | None:
        """Find the tracked flight in a poll's worth of aircraft.

        Matches on callsign or on the hex we locked onto earlier — a callsign can drop
        out of the ADS-B stream for a few sweeps while the airframe keeps reporting.
        """
        state = self._state
        if state is None:
            return None
        for ac in aircraft:
            if state.hex and ac.hex == state.hex:
                return ac
        for ac in aircraft:
            if ac.callsign and ac.callsign.replace(" ", "") == state.ident:
                return ac
        return None

    def update(
        self,
        enriched: EnrichedAircraft | None,
        *,
        now: float | None = None,
    ) -> TrackingState | None:
        """Fold one poll into the tracking state; returns None once tracking is over."""
        state = self._state
        if state is None:
            return None
        now = now if now is not None else time.monotonic()

        if enriched is None:
            expired_after_landing = (
                state.landed
                and state.landed_at is not None
                and now - state.landed_at >= LINGER_AFTER_LANDING_S
            )
            lost = (
                not state.landed
                and state.last_seen_at is not None
                and now - state.last_seen_at >= LOST_AFTER_S
            )
            if expired_after_landing:
                log.info("%s landed; returning to nearest", state.ident)
                self.cancel()
                return None
            if lost:
                log.info("%s lost for %.0fs; returning to nearest", state.ident, LOST_AFTER_S)
                self.cancel()
                return None
            return state

        ac = enriched.aircraft
        state.hex = ac.hex
        state.last_seen_at = now
        state.fraction = _fraction(enriched)
        state.eta_text = _eta_text(enriched)

        if _has_landed(enriched) and not state.landed:
            log.info("%s appears to have landed", state.ident)
            state.landed = True
            state.landed_at = now
            state.fraction = 1.0
        return state


def _fraction(enriched: EnrichedAircraft) -> float:
    """Progress along the leg, or a best guess when the endpoints aren't known."""
    ac = enriched.aircraft
    if ac.lat is None or ac.lon is None:
        return 0.0
    origin = airports.position_for(enriched.route.origin)
    destination = airports.position_for(enriched.route.destination)
    if origin is not None and destination is not None:
        return great_circle_fraction(origin, destination, (ac.lat, ac.lon))
    if destination is not None:
        # No origin: fall back to "how close to the destination", capped so a long-haul
        # flight doesn't read as 99% complete for eight hours.
        remaining = haversine_nm(ac.lat, ac.lon, *destination)
        return max(0.0, min(1.0, 1.0 - remaining / 400.0))
    return 0.0


def _eta_text(enriched: EnrichedAircraft) -> str | None:
    """Local ``HH:MM`` from the scheduled/estimated arrival, when a provider gave one."""
    route = enriched.route
    arrival = route.estimated_on or route.scheduled_on
    if arrival is None:
        return None
    if arrival.tzinfo is None:
        arrival = arrival.replace(tzinfo=UTC)
    return arrival.astimezone().strftime("%H:%M")


def _has_landed(enriched: EnrichedAircraft) -> bool:
    ac = enriched.aircraft
    if ac.on_ground:
        return True
    destination = airports.position_for(enriched.route.destination)
    if destination is None or ac.lat is None or ac.lon is None:
        return False
    if haversine_nm(ac.lat, ac.lon, *destination) > LANDING_RADIUS_NM:
        return False
    return ac.alt_baro_ft is not None and ac.alt_baro_ft <= LANDING_ALT_FT


def utc_now() -> datetime:
    return datetime.now(UTC)
