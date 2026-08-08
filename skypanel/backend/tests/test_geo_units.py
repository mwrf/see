from __future__ import annotations

import math

import pytest

from skypanel.geo import bearing_deg, haversine_mi, nearest, within_radius
from skypanel.units import (
    format_altitude,
    format_distance,
    format_speed,
    format_vert_rate,
    nm_to_mi,
    radius_mi_to_nm,
)

from .conftest import HOME_LAT, HOME_LON, aircraft

DUBLIN = (53.3498, -6.2603)
LONDON = (51.5072, -0.1276)


def test_haversine_matches_known_distance():
    # Dublin to London is ~288 statute miles great-circle.
    assert haversine_mi(*DUBLIN, *LONDON) == pytest.approx(288, abs=3)


def test_haversine_is_zero_for_identical_points():
    assert haversine_mi(*DUBLIN, *DUBLIN) == 0.0


def test_haversine_is_symmetric():
    assert haversine_mi(*DUBLIN, *LONDON) == pytest.approx(haversine_mi(*LONDON, *DUBLIN))


def test_bearing_dublin_to_london_is_east_southeast():
    assert bearing_deg(*DUBLIN, *LONDON) == pytest.approx(112, abs=3)


def test_bearing_due_north_is_zero():
    assert bearing_deg(53.0, -6.0, 54.0, -6.0) == pytest.approx(0.0, abs=0.01)


def test_within_radius_sorts_nearest_first_and_drops_far_targets():
    close = aircraft(hex="aaa", lat=53.36, lon=-6.25)
    far = aircraft(hex="bbb", lat=54.50, lon=-6.25)
    mid = aircraft(hex="ccc", lat=53.55, lon=-6.25)
    result = within_radius([far, mid, close], HOME_LAT, HOME_LON, radius_mi=30)
    assert [ac.hex for ac, _ in result] == ["aaa", "ccc"]


def test_within_radius_ignores_aircraft_without_position():
    positionless = aircraft(hex="ddd", lat=None, lon=None)
    assert within_radius([positionless], HOME_LAT, HOME_LON, 100) == []


def test_nearest_returns_none_for_empty_sky():
    assert nearest([], HOME_LAT, HOME_LON, 30) is None


@pytest.mark.parametrize(
    ("feet", "unit", "expected"),
    [
        (24000, "ft", "24,000FT"),
        (24000, "m", "7,315M"),
        (900, "ft", "900FT"),
        (None, "ft", "----"),
    ],
)
def test_format_altitude(feet, unit, expected):
    assert format_altitude(feet, unit) == expected


def test_format_altitude_on_ground():
    assert format_altitude(0, "ft", on_ground=True) == "GROUND"


@pytest.mark.parametrize(
    ("knots", "unit", "expected"),
    [(410, "kt", "410KT"), (410, "mph", "472MPH"), (410, "kmh", "759KM/H"), (None, "kt", "----")],
)
def test_format_speed(knots, unit, expected):
    assert format_speed(knots, unit) == expected


@pytest.mark.parametrize(
    ("miles", "unit", "expected"),
    [(6.13, "mi", "6.1MI"), (6.13, "km", "9.9KM"), (142.0, "mi", "142MI"), (None, "mi", "----")],
)
def test_format_distance(miles, unit, expected):
    assert format_distance(miles, unit) == expected


def test_distance_never_exceeds_six_characters():
    for miles in (0.0, 0.05, 9.99, 99.94, 100.0, 199.9):
        assert len(format_distance(miles, "km")) <= 6


def test_format_vert_rate_is_blank_when_level():
    assert format_vert_rate(50) == ""
    assert format_vert_rate(None) == ""


def test_format_vert_rate_marks_direction():
    assert format_vert_rate(1408).startswith("▲")
    assert format_vert_rate(-768).startswith("▼")


def test_radius_round_trips_between_miles_and_nautical_miles():
    assert nm_to_mi(radius_mi_to_nm(30.0)) == pytest.approx(30.0)


def test_nautical_miles_are_longer_than_statute_miles():
    assert radius_mi_to_nm(100.0) < 100.0
    assert math.isclose(nm_to_mi(1.0), 1.15077945)
