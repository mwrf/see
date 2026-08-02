"""The display-frame contract. These assertions are what the renderer is written against."""

from __future__ import annotations

from datetime import datetime, time

import pytest

from skypanel import frame as fb
from skypanel.models import Aircraft, Category, EnrichedAircraft, Route
from skypanel.settings import Settings
from skypanel.tracking import TrackingState


@pytest.fixture
def ryanair() -> EnrichedAircraft:
    return EnrichedAircraft(
        aircraft=Aircraft(
            hex="4ca7b5",
            callsign="RYR1812",
            lat=53.3901,
            lon=-6.3120,
            alt_baro_ft=24000,
            gs_kt=410,
            track_deg=282,
            vert_rate=-960,
            type_code="B738",
            registration="EI-DAA",
            distance_nm=5.3,
            bearing_deg=45.0,
        ),
        route=Route(
            origin="DUB",
            destination="STN",
            origin_city="Dublin",
            destination_city="London",
            airline_icao="RYR",
            airline_name="Ryanair",
            flight_iata="FR1812",
        ),
        airline_colour="#073590",
        traffic_category=Category.AIRLINE,
    )


def test_frame_matches_the_documented_shape(ryanair, settings):
    frame = fb.build_nearest(ryanair, settings, source="local")
    assert frame.mode == "nearest"
    assert frame.source == "local"
    assert frame.status == "live"
    assert frame.progress is None

    title, route, telemetry = frame.lines
    assert (title.text, title.colour, title.style, title.scroll) == (
        "RYANAIR", "#073590", "title", "auto"
    )
    assert route.text == "FR1812  DUB→STN  B738"
    assert telemetry.text == "24,000FT  410KT  6.1MI"


def test_frame_serialises_to_the_json_the_device_parses(ryanair, settings):
    payload = fb.build_nearest(ryanair, settings, source="local").model_dump(mode="json")
    assert set(payload) >= {"mode", "source", "generated_at", "lines", "progress", "status"}
    assert payload["lines"][0] == {
        "text": "RYANAIR", "colour": "#073590", "style": "title", "scroll": "auto"
    }


def test_units_are_applied_server_side(ryanair):
    metric = Settings(altitude_unit="m", speed_unit="kmh", distance_unit="km")
    frame = fb.build_nearest(ryanair, metric, source="local")
    assert frame.lines[2].text == "7,315M  759KM/H  9.8KM"


def test_route_can_be_shown_as_city_names(ryanair, settings):
    settings.route_display = "cities"
    frame = fb.build_nearest(ryanair, settings, source="local")
    assert frame.lines[1].text == "FR1812  Dublin→London  B738"


def test_line_selection_is_a_user_setting(ryanair, settings):
    settings.lines = ["airline", "telemetry"]
    frame = fb.build_nearest(ryanair, settings, source="local")
    assert [line.style for line in frame.lines] == ["title", "body"]
    assert "→" not in frame.lines[1].text


def test_bearing_line_says_where_to_look(ryanair, settings):
    settings.lines = ["bearing"]
    frame = fb.build_nearest(ryanair, settings, source="local")
    assert frame.lines[0].text == "NE 045  ↓960"


def test_unknown_airline_renders_white(settings):
    unknown = EnrichedAircraft(
        aircraft=Aircraft(hex="abc", callsign="N904TX", distance_nm=3.0),
        route=Route(),
        airline_colour="#ffffff",
    )
    frame = fb.build_nearest(unknown, settings, source="local")
    assert frame.lines[0].colour == "#ffffff"
    assert frame.lines[0].text == "N904TX"


def test_aircraft_with_no_route_still_produces_a_usable_frame(settings):
    enriched = EnrichedAircraft(
        aircraft=Aircraft(hex="abc", callsign="N904TX", alt_baro_ft=14000,
                          gs_kt=338, distance_nm=4.0, registration="N904TX"),
        route=Route(),
    )
    frame = fb.build_nearest(enriched, settings, source="local")
    assert frame.lines[1].text == "N904TX  N904TX"
    assert "---" not in frame.lines[2].text


def test_grounded_aircraft_reads_ground_not_zero_feet(ryanair, settings):
    ryanair.aircraft.on_ground = True
    ryanair.aircraft.alt_baro_ft = None
    frame = fb.build_nearest(ryanair, settings, source="local")
    assert frame.lines[2].text.startswith("GROUND")


def test_empty_frame_names_the_search_radius(settings):
    settings.scan_radius = 30
    settings.distance_unit = "mi"
    frame = fb.build_empty(settings, source="local")
    assert frame.mode == "empty"
    assert [line.text for line in frame.lines] == ["NO AIRCRAFT", "WITHIN 30MI"]


def test_error_frame_carries_the_hint_off_panel(settings):
    frame = fb.build_error("local receiver unreachable", settings, hint="check port 8080")
    assert frame.mode == "error"
    assert frame.status == "offline"
    assert frame.lines[0].text == "NO DATA"
    assert frame.note == "check port 8080"


def test_tracking_frame_carries_progress_and_eta(ryanair, settings):
    state = TrackingState(ident="RYR1812", fraction=0.62, eta_text="13:14")
    frame = fb.build_tracking(ryanair, settings, state, source="local")
    assert frame.mode == "tracking"
    assert frame.progress is not None
    assert frame.progress.fraction == pytest.approx(0.62)
    assert frame.progress.eta == "13:14"


def test_night_mode_dims_the_colours_as_well_as_the_driver(ryanair, monkeypatch):
    night = Settings(night_start=time(0, 0), night_end=time(23, 59))
    monkeypatch.setattr(fb, "_now", lambda: datetime(2026, 8, 2, 3, 0))
    frame = fb.build_nearest(ryanair, night, source="local")
    assert frame.lines[0].colour != "#073590"
    assert frame.brightness == night.night_brightness


def test_long_title_is_marked_for_scrolling(settings):
    enriched = EnrichedAircraft(
        aircraft=Aircraft(hex="abc", callsign="THY1", distance_nm=1.0),
        route=Route(airline_icao="THY", airline_name="Turkish Airlines"),
        airline_colour="#c70a0c",
    )
    frame = fb.build_nearest(enriched, settings, source="local")
    assert frame.lines[0].text == "TURKISH AIRLINES"
    assert frame.lines[0].scroll == "auto"


def test_device_hints_ride_along_so_the_panel_needs_one_request(ryanair, settings):
    settings.poll_interval_s = 7.0
    settings.brightness = 42
    frame = fb.build_nearest(ryanair, settings, source="local")
    assert frame.poll_interval_s == 7.0
    assert frame.brightness == 42
