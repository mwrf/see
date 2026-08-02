from __future__ import annotations

from datetime import UTC, datetime

import pytest

from skypanel.frame import build_frame, matches_ident, passes_filters, status_for_age
from skypanel.models import (
    DisplayFrame,
    EnrichedAircraft,
    FrameMode,
    FrameStatus,
    Progress,
    Route,
)
from skypanel.settings import Settings

from .conftest import aircraft

NOW = datetime(2026, 8, 2, 9, 14, 3, tzinfo=UTC)


def enriched(**overrides) -> EnrichedAircraft:
    base = {
        "aircraft": aircraft(),
        "distance_mi": 6.13,
        "bearing_deg": 71.0,
        "airline_code": "RYR",
        "airline_name": "RYANAIR",
        "airline_colour": "#073590",
        "route": Route(
            origin="EIDW", destination="EGSS", origin_city="Dublin", destination_city="London"
        ),
        "category": "airline",
    }
    base.update(overrides)
    return EnrichedAircraft(**base)


def test_frame_matches_the_documented_contract(settings, airports, airlines):
    frame = build_frame(
        enriched(), settings, source="local", airports=airports, airlines=airlines, now=NOW
    ).to_json()
    assert frame["mode"] == "nearest"
    assert frame["source"] == "local"
    assert frame["generated_at"] == "2026-08-02T09:14:03Z"
    assert frame["status"] == "live"
    assert frame["progress"] is None
    assert [line["style"] for line in frame["lines"]] == ["title", "body", "body"]


def test_title_line_carries_the_airline_brand_colour(settings, airlines):
    frame = build_frame(enriched(), settings, source="local", airlines=airlines)
    assert frame.lines[0].text == "RYANAIR"
    assert frame.lines[0].colour == "#073590"


def test_flight_line_shows_iata_number_route_and_type(settings, airports, airlines):
    frame = build_frame(enriched(), settings, source="local", airports=airports, airlines=airlines)
    assert frame.lines[1].text == "FR1812  EIDW→EGSS  B738"


def test_detail_line_shows_altitude_speed_and_distance(settings, airlines):
    frame = build_frame(enriched(), settings, source="local", airlines=airlines)
    assert frame.lines[2].text == "24,000FT  410KT  6.1MI"


def test_detail_line_follows_the_configured_units(airlines):
    settings = Settings(altitude_unit="m", speed_unit="kmh", distance_unit="km")
    frame = build_frame(enriched(), settings, source="local", airlines=airlines)
    assert frame.lines[2].text == "7,315M  759KM/H  9.9KM"


def test_route_can_be_shown_as_city_names(airports, airlines):
    settings = Settings(route_display="cities")
    frame = build_frame(enriched(), settings, source="local", airports=airports, airlines=airlines)
    assert "DUBLIN→LONDON" in frame.lines[1].text


def test_city_display_falls_back_to_the_code_when_unknown(airports, airlines):
    settings = Settings(route_display="cities")
    target = enriched(route=Route(origin="EIDW", destination="ZZZZ"))
    frame = build_frame(target, settings, source="local", airports=airports, airlines=airlines)
    assert "ZZZZ" in frame.lines[1].text


def test_lines_can_be_switched_off_individually(settings, airlines):
    settings = settings.merged({"show_airline_line": False, "show_detail_line": False})
    frame = build_frame(enriched(), settings, source="local", airlines=airlines)
    assert len(frame.lines) == 1
    assert frame.lines[0].style == "body"


def test_switching_every_line_off_still_shows_something(settings, airlines):
    settings = settings.merged(
        {"show_airline_line": False, "show_flight_line": False, "show_detail_line": False}
    )
    frame = build_frame(enriched(), settings, source="local", airlines=airlines)
    assert frame.lines


def test_vertical_rate_is_optional(airlines):
    settings = Settings(show_vert_rate=True)
    target = enriched(aircraft=aircraft(vert_rate=1408))
    frame = build_frame(target, settings, source="local", airlines=airlines)
    assert "▲1,408FPM" in frame.lines[2].text


def test_empty_sky_produces_an_empty_frame_not_an_error(settings):
    frame = build_frame(None, settings, source="local")
    assert frame.mode == FrameMode.EMPTY
    assert "NO AIRCRAFT" in frame.lines[0].text
    assert "30.0MI" in frame.lines[1].text


def test_unknown_airline_falls_back_to_the_callsign(settings):
    target = enriched(airline_name=None, airline_colour="#FFFFFF")
    frame = build_frame(target, settings, source="local")
    assert frame.lines[0].text == "RYR1812"
    assert frame.lines[0].colour == "#FFFFFF"


def test_no_callsign_falls_back_to_registration_then_hex(settings):
    target = enriched(aircraft=aircraft(callsign=None), airline_name=None)
    assert build_frame(target, settings, source="local").lines[0].text == "EI-DYR"

    bare = enriched(aircraft=aircraft(callsign=None, registration=None), airline_name=None)
    assert build_frame(bare, settings, source="local").lines[0].text == "4CA7B3"


def test_military_targets_are_marked_when_the_operator_is_unknown(settings):
    target = enriched(
        aircraft=aircraft(hex="ae1442", callsign="RCH485", type_code="C17"),
        airline_name=None,
        category="military",
    )
    assert build_frame(target, settings, source="local").lines[0].text == "MIL RCH485"


def test_missing_route_leaves_the_rest_of_the_flight_line_intact(settings, airlines):
    target = enriched(route=Route())
    frame = build_frame(target, settings, source="local", airlines=airlines)
    assert frame.lines[1].text == "FR1812  B738"


def test_a_flight_line_with_nothing_at_all_says_so(settings):
    target = enriched(
        aircraft=aircraft(callsign=None, registration=None, type_code=None),
        route=Route(),
        airline_name=None,
    )
    frame = build_frame(target, settings, source="local")
    assert frame.lines[1].text == "4CA7B3"


def test_ground_altitude_is_rendered_as_a_word(settings, airlines):
    target = enriched(aircraft=aircraft(alt_baro_ft=0.0))
    frame = build_frame(target, settings, source="local", airlines=airlines)
    assert frame.lines[2].text.startswith("GROUND")


def test_scroll_is_auto_so_the_renderer_decides_from_pixel_width(settings, airlines):
    frame = build_frame(enriched(), settings, source="local", airlines=airlines)
    assert all(line.scroll == "auto" for line in frame.lines)


def test_tracking_mode_carries_progress(settings, airlines):
    frame = build_frame(
        enriched(),
        settings,
        source="local",
        airlines=airlines,
        mode=FrameMode.TRACKING,
        progress=Progress(fraction=0.62, eta="13:14"),
    )
    assert frame.to_json()["progress"] == {"fraction": 0.62, "eta": "13:14"}
    assert frame.to_json()["mode"] == "tracking"


def test_error_frames_are_frames_not_exceptions():
    frame = DisplayFrame.error("RECEIVER DOWN")
    assert frame.mode == FrameMode.ERROR
    assert frame.status == FrameStatus.OFFLINE
    assert frame.lines[0].text == "RECEIVER DOWN"


@pytest.mark.parametrize(
    ("age", "expected"),
    [
        (0.0, FrameStatus.LIVE),
        (14.0, FrameStatus.LIVE),
        (20.0, FrameStatus.STALE),
        (90.0, FrameStatus.OFFLINE),
    ],
)
def test_status_indicator_tracks_frame_age(age, expected):
    assert status_for_age(age) == expected


def test_unhealthy_source_is_offline_regardless_of_age():
    assert status_for_age(0.0, source_healthy=False) == FrameStatus.OFFLINE


# -- filters ------------------------------------------------------------


def test_category_filter_excludes_unwanted_traffic(settings):
    settings = settings.merged({"categories": ["airline"]})
    assert passes_filters(enriched(), settings) is True
    assert passes_filters(enriched(category="ga"), settings) is False


def test_altitude_filter_bounds_the_selection(settings):
    settings = settings.merged({"min_altitude_ft": 10000, "max_altitude_ft": 20000})
    assert passes_filters(enriched(), settings) is False
    low = enriched(aircraft=aircraft(alt_baro_ft=15000))
    assert passes_filters(low, settings) is True


def test_aircraft_with_no_altitude_are_not_filtered_out(settings):
    settings = settings.merged({"min_altitude_ft": 10000})
    assert passes_filters(enriched(aircraft=aircraft(alt_baro_ft=None)), settings) is True


# -- ident matching -----------------------------------------------------


@pytest.mark.parametrize("ident", ["RYR1812", "ryr1812", "EI-DYR", "eidyr", "4CA7B3"])
def test_ident_matching_accepts_what_the_receiver_shows(ident, airlines):
    assert matches_ident(aircraft(), ident, airlines) is True


def test_ident_matching_accepts_the_iata_flight_number(airlines):
    assert matches_ident(aircraft(), "FR1812", airlines) is True


def test_ident_matching_rejects_a_different_flight(airlines):
    assert matches_ident(aircraft(), "FR1813", airlines) is False
    assert matches_ident(aircraft(), "BA1812", airlines) is False
