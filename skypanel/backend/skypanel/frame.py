"""Build the semantic :class:`DisplayFrame` the firmware renders.

This module is the whole reason the emulator can be honest: every decision that
depends on user settings -- units, code-vs-city routes, which lines to show,
what colour an airline is -- is made here, server-side, and the result is plain
text plus a hex colour.  The renderer downstream has no policy at all.
"""

from __future__ import annotations

from datetime import UTC, datetime

from .airports import AirportRegistry
from .colours import AirlineRegistry, dim, flight_number
from .models import (
    Aircraft,
    DisplayFrame,
    EnrichedAircraft,
    FrameLine,
    FrameMode,
    FrameStatus,
    LineStyle,
    Progress,
    ScrollMode,
)
from .settings import Settings
from .units import format_altitude, format_distance, format_speed, format_vert_rate

#: Line colours, chosen post-gamma rather than by eye: #C8C8C8 emits 151 and
#: #808080 emits 55, which is the deliberate hierarchy between the flight line
#: and the numbers below it.  See colours.panel_level.
BODY_COLOUR = "#C8C8C8"
DETAIL_COLOUR = "#808080"
#: An empty sky should be quiet but not invisible; a raw #404060 emits 30,
#: which on a P4 panel is indistinguishable from off.
EMPTY_COLOUR = "#7070A8"
ARROW = "→"

#: A frame older than this is drawn with the "stale" corner indicator.
STALE_AFTER_S = 15.0
OFFLINE_AFTER_S = 60.0


def build_frame(
    enriched: EnrichedAircraft | None,
    settings: Settings,
    *,
    source: str,
    status: FrameStatus = FrameStatus.LIVE,
    airports: AirportRegistry | None = None,
    airlines: AirlineRegistry | None = None,
    mode: FrameMode = FrameMode.NEAREST,
    progress: Progress | None = None,
    now: datetime | None = None,
) -> DisplayFrame:
    """Turn one enriched target (or an empty sky) into a frame."""
    generated_at = now or datetime.now(UTC)
    if enriched is None:
        return DisplayFrame(
            mode=FrameMode.EMPTY,
            source=source,
            status=status,
            generated_at=generated_at,
            lines=[
                FrameLine(text="NO AIRCRAFT", colour=EMPTY_COLOUR, style=LineStyle.TITLE),
                FrameLine(
                    text="WITHIN "
                    + format_distance(settings.scan_radius_mi, settings.distance_unit),
                    colour=dim(EMPTY_COLOUR, 0.7),
                    style=LineStyle.BODY,
                ),
            ],
        )

    lines: list[FrameLine] = []
    if settings.show_airline_line:
        lines.append(_title_line(enriched))
    if settings.show_flight_line:
        lines.append(_flight_line(enriched, settings, airports, airlines))
    if settings.show_detail_line:
        lines.append(_detail_line(enriched, settings))

    if not lines:
        #  The user switched every line off; show something rather than a black
        #  panel that looks like a crash.
        lines.append(_flight_line(enriched, settings, airports, airlines))

    return DisplayFrame(
        mode=mode,
        source=source,
        status=status,
        generated_at=generated_at,
        lines=lines,
        progress=progress,
    )


def _title_line(enriched: EnrichedAircraft) -> FrameLine:
    """Airline name in its brand colour; identity fallbacks when unknown."""
    text = enriched.airline_name
    if not text:
        ac = enriched.aircraft
        text = ac.callsign or ac.registration or ac.hex.upper()
    if enriched.category == "military" and not enriched.airline_name:
        text = f"MIL {text}"
    return FrameLine(
        text=text.upper(),
        colour=enriched.airline_colour,
        style=LineStyle.TITLE,
        scroll=ScrollMode.AUTO,
    )


def _flight_line(
    enriched: EnrichedAircraft,
    settings: Settings,
    airports: AirportRegistry | None,
    airlines: AirlineRegistry | None,
) -> FrameLine:
    """``FR1812  DUB->STN  B738`` -- ident, route, type, whichever we have."""
    parts: list[str] = []
    ident = _display_ident(enriched, airlines)
    if ident:
        parts.append(ident)

    route = _route_text(enriched, settings, airports)
    if route:
        parts.append(route)

    type_code = enriched.aircraft.type_code
    if type_code:
        parts.append(type_code.upper())

    return FrameLine(
        text="  ".join(parts) if parts else "NO FLIGHT DATA",
        colour=BODY_COLOUR,
        style=LineStyle.BODY,
        scroll=ScrollMode.AUTO,
    )


def _display_ident(enriched: EnrichedAircraft, airlines: AirlineRegistry | None) -> str | None:
    """Prefer the IATA-style flight number travellers recognise.

    ``RYR1812`` becomes ``FR1812`` when we know Ryanair's IATA code; otherwise
    the ICAO callsign stands, and a registration stands in for both when there
    is no callsign at all.
    """
    ac = enriched.aircraft
    if not ac.callsign:
        return ac.registration or ac.hex.upper()
    number = flight_number(ac.callsign)
    airline = airlines.get(enriched.airline_code) if airlines else None
    if number and airline and airline.iata:
        return f"{airline.iata}{number}"
    return ac.callsign


def _route_text(
    enriched: EnrichedAircraft, settings: Settings, airports: AirportRegistry | None
) -> str | None:
    route = enriched.route
    prefer_cities = settings.route_display == "cities"

    def render(code: str | None, city: str | None) -> str | None:
        """City name if the user asked for one and we have it; code otherwise."""
        if prefer_cities:
            if city:
                return city.upper()
            if airports is not None:
                resolved = airports.city(code)
                if resolved:
                    return resolved.upper()
        return code.upper() if code else None

    origin = render(route.origin, route.origin_city)
    destination = render(route.destination, route.destination_city)
    if origin and destination:
        return f"{origin}{ARROW}{destination}"
    if destination:
        return f"{ARROW}{destination}"
    if origin:
        return f"{origin}{ARROW}"
    return None


def _detail_line(enriched: EnrichedAircraft, settings: Settings) -> FrameLine:
    """``24,000FT  410KT  6.1MI`` in the configured units."""
    ac = enriched.aircraft
    parts = [
        format_altitude(ac.alt_baro_ft, settings.altitude_unit, on_ground=ac.on_ground),
        format_speed(ac.gs_kt, settings.speed_unit),
        format_distance(enriched.distance_mi, settings.distance_unit),
    ]
    if settings.show_vert_rate:
        vert = format_vert_rate(ac.vert_rate, settings.altitude_unit)
        if vert:
            parts.append(vert)
    return FrameLine(
        text="  ".join(parts),
        colour=DETAIL_COLOUR,
        style=LineStyle.BODY,
        scroll=ScrollMode.AUTO,
    )


def status_for_age(age_s: float, *, source_healthy: bool = True) -> FrameStatus:
    """Map the age of the last successful poll onto the corner indicator."""
    if not source_healthy or age_s >= OFFLINE_AFTER_S:
        return FrameStatus.OFFLINE
    if age_s >= STALE_AFTER_S:
        return FrameStatus.STALE
    return FrameStatus.LIVE


def passes_filters(enriched: EnrichedAircraft, settings: Settings) -> bool:
    """Apply the user's category and altitude filters to a candidate."""
    if enriched.category not in settings.categories:
        return False
    alt = enriched.aircraft.alt_baro_ft
    if alt is None:
        return True
    return settings.min_altitude_ft <= alt <= settings.max_altitude_ft


def matches_ident(aircraft: Aircraft, ident: str, airlines: AirlineRegistry | None = None) -> bool:
    """Does this target answer to ``ident``?

    Users type what they see on a departure board (``BA249``) or what the
    receiver shows (``BAW249``), and either should work, as should a
    registration or hex.
    """
    target = ident.strip().upper().replace("-", "")
    candidates = {
        (aircraft.callsign or "").strip().upper(),
        (aircraft.registration or "").strip().upper().replace("-", ""),
        aircraft.hex.strip().upper(),
    }
    if target in candidates:
        return True

    #  IATA-style: strip the airline prefix off both sides and compare numbers.
    number = "".join(c for c in target if c.isdigit())
    if not number:
        return False
    callsign = (aircraft.callsign or "").strip().upper()
    callsign_number = "".join(c for c in callsign if c.isdigit())
    if not callsign_number or callsign_number != number:
        return False
    return _prefix_compatible(target, callsign, airlines)


def _prefix_compatible(target: str, callsign: str, airlines: AirlineRegistry | None) -> bool:
    """``BA249`` should match ``BAW249``: same operator, different designator."""
    target_prefix = "".join(c for c in target if c.isalpha())
    callsign_prefix = "".join(c for c in callsign if c.isalpha())
    if not target_prefix or not callsign_prefix:
        return False
    airline = airlines.get(callsign_prefix[:3]) if airlines else None
    if airline is not None and airline.iata == target_prefix:
        return True
    return target_prefix == callsign_prefix[: len(target_prefix)]
