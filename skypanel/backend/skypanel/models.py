"""Core domain types.

`Aircraft` is the normalised shape every source produces. `DisplayFrame` is the
semantic contract the device consumes — it carries text and colour, never pixels.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class Category(StrEnum):
    """Broad traffic class, used for the user's filters."""

    AIRLINE = "airline"
    MILITARY = "military"
    HELICOPTER = "helicopter"
    GA = "ga"
    UNKNOWN = "unknown"


@dataclass(slots=True)
class Aircraft:
    """One aircraft as reported by a feed, normalised across sources.

    Field names follow the ADS-B vocabulary rather than the wire format, because the
    wire formats disagree with each other (`flight` vs `callsign`, `alt_baro` as either
    a number or the string ``"ground"``).
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
    on_ground: bool = False

    # Filled in by geo selection relative to the configured home position.
    distance_nm: float | None = None
    bearing_deg: float | None = None

    def has_position(self) -> bool:
        return self.lat is not None and self.lon is not None


@dataclass(slots=True)
class Route:
    """A callsign's origin/destination, as resolved by the enrichment layer."""

    origin: str | None = None
    destination: str | None = None
    origin_city: str | None = None
    destination_city: str | None = None
    airline_icao: str | None = None
    airline_name: str | None = None
    flight_iata: str | None = None
    """The number people recognise (``FR1812``) as opposed to the ICAO callsign."""
    scheduled_off: datetime | None = None
    scheduled_on: datetime | None = None
    estimated_on: datetime | None = None
    provider: str | None = None


@dataclass(slots=True)
class EnrichedAircraft:
    """An `Aircraft` plus everything the enrichment layer could find for it."""

    aircraft: Aircraft
    route: Route = field(default_factory=Route)
    type_name: str | None = None
    airline_colour: str = "#ffffff"
    traffic_category: Category = Category.UNKNOWN


# --------------------------------------------------------------------------- frame


FrameMode = Literal["nearest", "tracking", "empty", "error"]
FrameStatus = Literal["live", "stale", "offline"]
LineStyle = Literal["title", "body", "small"]
ScrollMode = Literal["none", "auto"]


class FrameLine(BaseModel):
    """One line of text with the colour and scroll behaviour the renderer should use."""

    text: str
    colour: str = "#ffffff"
    style: LineStyle = "body"
    scroll: ScrollMode = "none"


class Progress(BaseModel):
    """Flight completion, shown as a bar at the bottom of the panel in tracking mode."""

    fraction: float = Field(ge=0.0, le=1.0)
    eta: str | None = None


class DisplayFrame(BaseModel):
    """What `GET /api/frame` returns and the firmware renders verbatim."""

    mode: FrameMode = "empty"
    source: str = "none"
    generated_at: datetime
    lines: list[FrameLine] = Field(default_factory=list)
    progress: Progress | None = None
    status: FrameStatus = "offline"

    # Device hints. Not part of the rendering contract, but carried here so the panel
    # needs exactly one request per cycle rather than one for the frame and one for
    # settings it might have changed.
    brightness: int = 60
    poll_interval_s: float = 5.0

    # Free-form: attribution and diagnostics. Shown in the web UI and the emulator title
    # bar, never on the panel.
    note: str | None = None
