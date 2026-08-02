"""Core data structures shared by every layer of the backend.

Two families live here:

* :class:`Aircraft` and :class:`EnrichedAircraft` -- what we know about a
  target, in raw ADS-B units (feet, knots, degrees).
* :class:`DisplayFrame` and :class:`FrameLine` -- the semantic contract with
  the firmware, described in section 5 of the specification.  Everything in a
  frame has already had user settings applied: units are formatted, colours are
  resolved, fields are selected.  The renderer only turns text into pixels.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal, Self

Category = Literal["airline", "military", "helicopter", "ga", "unknown"]


class FrameMode(StrEnum):
    """What the panel is currently showing."""

    NEAREST = "nearest"
    TRACKING = "tracking"
    EMPTY = "empty"
    ERROR = "error"


class FrameStatus(StrEnum):
    """Freshness indicator drawn in the corner of the panel."""

    LIVE = "live"
    STALE = "stale"
    OFFLINE = "offline"


class LineStyle(StrEnum):
    """Which face the renderer should use for a line."""

    TITLE = "title"
    BODY = "body"


class ScrollMode(StrEnum):
    NONE = "none"
    AUTO = "auto"


@dataclass(slots=True)
class Aircraft:
    """One ADS-B target, in the units the wire format uses.

    Every field except ``hex`` is optional because receivers report partial
    state constantly: a target may have a position but no callsign, or a
    callsign but no altitude for several seconds after acquisition.
    """

    hex: str
    callsign: str | None = None
    lat: float | None = None
    lon: float | None = None
    alt_baro_ft: float | None = None
    gs_kt: float | None = None
    track_deg: float | None = None
    vert_rate: float | None = None
    squawk: str | None = None
    type_code: str | None = None
    registration: str | None = None
    category: str | None = None
    seen_pos_s: float | None = None

    @property
    def on_ground(self) -> bool:
        return self.alt_baro_ft is not None and self.alt_baro_ft <= 0.0

    def has_position(self) -> bool:
        return self.lat is not None and self.lon is not None


@dataclass(slots=True)
class Route:
    """A callsign's origin/destination pair, as resolved by enrichment."""

    origin: str | None = None
    destination: str | None = None
    origin_city: str | None = None
    destination_city: str | None = None
    eta: datetime | None = None
    provider: str | None = None


@dataclass(slots=True)
class EnrichedAircraft:
    """An :class:`Aircraft` plus everything the enrichment layer could add."""

    aircraft: Aircraft
    distance_mi: float
    bearing_deg: float
    airline_code: str | None = None
    airline_name: str | None = None
    airline_colour: str = "#FFFFFF"
    route: Route = field(default_factory=Route)
    category: Category = "unknown"
    first_seen: datetime | None = None

    def to_json(self) -> dict[str, Any]:
        ac = self.aircraft
        return {
            "hex": ac.hex,
            "callsign": ac.callsign,
            "registration": ac.registration,
            "type_code": ac.type_code,
            "lat": ac.lat,
            "lon": ac.lon,
            "alt_baro_ft": ac.alt_baro_ft,
            "gs_kt": ac.gs_kt,
            "track_deg": ac.track_deg,
            "vert_rate": ac.vert_rate,
            "squawk": ac.squawk,
            "seen_pos_s": ac.seen_pos_s,
            "distance_mi": round(self.distance_mi, 2),
            "bearing_deg": round(self.bearing_deg, 1),
            "airline_code": self.airline_code,
            "airline_name": self.airline_name,
            "airline_colour": self.airline_colour,
            "category": self.category,
            "route": {
                "origin": self.route.origin,
                "destination": self.route.destination,
                "origin_city": self.route.origin_city,
                "destination_city": self.route.destination_city,
                "eta": self.route.eta.isoformat() if self.route.eta else None,
                "provider": self.route.provider,
            },
        }


@dataclass(slots=True)
class FrameLine:
    """One row of text on the panel."""

    text: str
    colour: str = "#FFFFFF"
    style: LineStyle = LineStyle.BODY
    scroll: ScrollMode = ScrollMode.NONE

    def to_json(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "colour": self.colour,
            "style": str(self.style),
            "scroll": str(self.scroll),
        }


@dataclass(slots=True)
class Progress:
    """Flight-completion state, only populated in tracking mode."""

    fraction: float
    eta: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {"fraction": round(self.fraction, 3), "eta": self.eta}


@dataclass(slots=True)
class DisplayFrame:
    """The complete payload of ``GET /api/frame``."""

    mode: FrameMode
    source: str
    lines: list[FrameLine] = field(default_factory=list)
    progress: Progress | None = None
    status: FrameStatus = FrameStatus.LIVE
    generated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_json(self) -> dict[str, Any]:
        return {
            "mode": str(self.mode),
            "source": self.source,
            "generated_at": _isoformat_z(self.generated_at),
            "lines": [line.to_json() for line in self.lines],
            "progress": self.progress.to_json() if self.progress else None,
            "status": str(self.status),
        }

    @classmethod
    def error(cls, message: str, source: str = "none") -> Self:
        return cls(
            mode=FrameMode.ERROR,
            source=source,
            status=FrameStatus.OFFLINE,
            lines=[FrameLine(text=message, colour="#FF4040", style=LineStyle.TITLE)],
        )


def _isoformat_z(value: datetime) -> str:
    """Render a datetime as RFC 3339 with a ``Z`` suffix.

    The firmware only ever displays this, but keeping the format stable makes
    golden-frame fixtures diffable.
    """
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
