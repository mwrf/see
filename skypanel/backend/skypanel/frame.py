"""Builds the semantic `DisplayFrame`.

This is the whole of the display's business logic: which fields appear, in which units,
in which colour, in which order. The firmware knows none of it. Keeping the decisions
here is what lets the emulator be honest — it renders exactly the structure the panel
gets, because there is nothing else to render.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from . import colours, units
from .geo import compass_point
from .models import (
    DisplayFrame,
    EnrichedAircraft,
    FrameLine,
    FrameStatus,
    Progress,
)
from .settings import Settings

if TYPE_CHECKING:
    from .tracking import TrackingState

TITLE_COLOUR_FALLBACK = "#ffffff"
BODY_COLOUR = "#c8c8c8"
DIM_COLOUR = "#808080"
ERROR_COLOUR = "#ff4040"

#: The renderer draws these as dedicated glyphs; they are not in the 5x7 ASCII face.
ARROW = "→"
CLIMB = "↑"
DESCEND = "↓"


def _now() -> datetime:
    return datetime.now(UTC)


def _airline_line(enriched: EnrichedAircraft, settings: Settings) -> FrameLine:
    """The headline: operator name in its brand colour, falling back to the callsign."""
    route = enriched.route
    text = route.airline_name or colours.name_for(route.airline_icao)
    if not text:
        text = enriched.aircraft.callsign or enriched.aircraft.registration or "UNKNOWN"
    colour = enriched.airline_colour
    if colour == colours.DEFAULT_COLOUR:
        colour = TITLE_COLOUR_FALLBACK
    return FrameLine(
        text=text.upper(),
        colour=_night_adjust(colour, settings),
        style="title",
        scroll="auto",
    )


def _route_line(enriched: EnrichedAircraft, settings: Settings) -> FrameLine:
    """``FR1812  DUB→STN  B738`` — flight number, leg, and type."""
    ac = enriched.aircraft
    route = enriched.route
    parts: list[str] = []

    ident = route.flight_iata or ac.callsign
    if ident:
        parts.append(ident)

    if settings.route_display == "cities":
        origin = route.origin_city or route.origin
        destination = route.destination_city or route.destination
    else:
        origin = route.origin
        destination = route.destination
    if origin or destination:
        parts.append(f"{origin or '???'}{ARROW}{destination or '???'}")

    if ac.type_code:
        parts.append(ac.type_code)
    elif ac.registration:
        parts.append(ac.registration)

    return FrameLine(
        text="  ".join(parts) if parts else "NO ROUTE",
        colour=_night_adjust(BODY_COLOUR, settings),
        style="body",
        scroll="auto",
    )


def _telemetry_line(enriched: EnrichedAircraft, settings: Settings) -> FrameLine:
    """``24,000FT  410KT  6.1MI``."""
    ac = enriched.aircraft
    text = "  ".join(
        (
            units.format_altitude(ac.alt_baro_ft, settings.altitude_unit, ac.on_ground),
            units.format_speed(ac.gs_kt, settings.speed_unit),
            units.format_distance(ac.distance_nm, settings.distance_unit),
        )
    )
    return FrameLine(
        text=text,
        colour=_night_adjust(DIM_COLOUR, settings),
        style="body",
        scroll="auto",
    )


def _bearing_line(enriched: EnrichedAircraft, settings: Settings) -> FrameLine:
    """``NE 045  ↑1200`` — where to look, and whether it's climbing."""
    ac = enriched.aircraft
    parts: list[str] = []
    if ac.bearing_deg is not None:
        parts.append(f"{compass_point(ac.bearing_deg)} {round(ac.bearing_deg):03d}")
    vertical = units.format_vertical_rate(ac.vert_rate)
    if vertical:
        parts.append(vertical.replace("^", CLIMB).replace("v", DESCEND, 1))
    return FrameLine(
        text="  ".join(parts) if parts else "",
        colour=_night_adjust(DIM_COLOUR, settings),
        style="small",
        scroll="none",
    )


_BUILDERS = {
    "airline": _airline_line,
    "route": _route_line,
    "telemetry": _telemetry_line,
    "bearing": _bearing_line,
}


def _night_adjust(colour: str, settings: Settings) -> str:
    """Night mode dims the *content*, not just the panel.

    Cutting driver brightness alone crushes dark blues to black on a HUB75 panel, so
    the colours get scaled here too and the driver only takes the remaining step.
    """
    if not settings.is_night(_now().time()):
        return colour
    return colours.dim(colour, 0.6)


def build_lines(enriched: EnrichedAircraft, settings: Settings) -> list[FrameLine]:
    lines: list[FrameLine] = []
    for line_id in settings.lines:
        builder = _BUILDERS.get(line_id)
        if builder is None:
            continue
        line = builder(enriched, settings)
        if line.text:
            lines.append(line)
    return lines


def _envelope(settings: Settings, now: datetime) -> dict[str, object]:
    return {
        "generated_at": now,
        "brightness": settings.effective_brightness(now.time()),
        "poll_interval_s": settings.poll_interval_s,
    }


def build_nearest(
    enriched: EnrichedAircraft,
    settings: Settings,
    *,
    source: str,
    status: FrameStatus = "live",
    note: str | None = None,
    now: datetime | None = None,
) -> DisplayFrame:
    now = now or _now()
    return DisplayFrame(
        mode="nearest",
        source=source,
        lines=build_lines(enriched, settings),
        progress=None,
        status=status,
        note=note,
        **_envelope(settings, now),  # type: ignore[arg-type]
    )


def build_tracking(
    enriched: EnrichedAircraft,
    settings: Settings,
    tracking: TrackingState,
    *,
    source: str,
    status: FrameStatus = "live",
    note: str | None = None,
    now: datetime | None = None,
) -> DisplayFrame:
    now = now or _now()
    progress = Progress(fraction=tracking.fraction, eta=tracking.eta_text)
    return DisplayFrame(
        mode="tracking",
        source=source,
        lines=build_lines(enriched, settings),
        progress=progress,
        status=status,
        note=note,
        **_envelope(settings, now),  # type: ignore[arg-type]
    )


def build_empty(
    settings: Settings,
    *,
    source: str,
    status: FrameStatus = "live",
    note: str | None = None,
    now: datetime | None = None,
) -> DisplayFrame:
    """Nothing in range. Say so plainly rather than leaving the panel dark."""
    now = now or _now()
    return DisplayFrame(
        mode="empty",
        source=source,
        lines=[
            FrameLine(
                text="NO AIRCRAFT",
                colour=_night_adjust(DIM_COLOUR, settings),
                style="title",
                scroll="none",
            ),
            FrameLine(
                text=f"WITHIN {round(settings.scan_radius)}"
                f"{settings.distance_unit.upper()}",
                colour=_night_adjust(DIM_COLOUR, settings),
                style="body",
                scroll="none",
            ),
        ],
        status=status,
        note=note,
        **_envelope(settings, now),  # type: ignore[arg-type]
    )


def build_error(
    message: str,
    settings: Settings,
    *,
    source: str = "none",
    hint: str | None = None,
    now: datetime | None = None,
) -> DisplayFrame:
    """A feed is down. The panel says which, so the fix doesn't need a laptop."""
    now = now or _now()
    lines = [
        FrameLine(text="NO DATA", colour=ERROR_COLOUR, style="title", scroll="none"),
        FrameLine(text=message.upper(), colour=DIM_COLOUR, style="body", scroll="auto"),
    ]
    return DisplayFrame(
        mode="error",
        source=source,
        lines=lines,
        status="offline",
        note=hint,
        **_envelope(settings, now),  # type: ignore[arg-type]
    )
