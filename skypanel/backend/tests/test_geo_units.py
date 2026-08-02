from __future__ import annotations

import pytest

from skypanel import units
from skypanel.geo import (
    bearing_deg,
    compass_point,
    great_circle_fraction,
    haversine_nm,
    nearest,
)
from skypanel.models import Aircraft

DUB = (53.4213, -6.2701)
LHR = (51.4706, -0.4619)


def test_haversine_matches_published_leg():
    # Dublin–Heathrow is ~243 NM great circle.
    assert haversine_nm(*DUB, *LHR) == pytest.approx(243, abs=4)


def test_haversine_is_symmetric_and_zero_at_a_point():
    assert haversine_nm(*DUB, *DUB) == pytest.approx(0.0)
    assert haversine_nm(*DUB, *LHR) == pytest.approx(haversine_nm(*LHR, *DUB))


def test_bearing_dublin_to_heathrow_is_east_southeast():
    assert bearing_deg(*DUB, *LHR) == pytest.approx(116.5, abs=1.0)
    assert compass_point(bearing_deg(*DUB, *LHR)) == "ESE"


@pytest.mark.parametrize(
    ("deg", "point"),
    [(0, "N"), (45, "NE"), (90, "E"), (180, "S"), (270, "W"), (350, "N"), (360, "N")],
)
def test_compass_point(deg, point):
    assert compass_point(deg) == point


def test_nearest_picks_closest_and_annotates():
    home = (53.3498, -6.2603)
    far = Aircraft(hex="aaa", lat=54.0, lon=-6.2)
    close = Aircraft(hex="bbb", lat=53.36, lon=-6.26)
    pick = nearest([far, close], *home)
    assert pick is close
    assert close.distance_nm is not None and close.distance_nm < 1.0
    assert far.distance_nm is not None


def test_nearest_honours_radius_and_ignores_positionless():
    home = (53.3498, -6.2603)
    aircraft = [Aircraft(hex="nopos"), Aircraft(hex="far", lat=55.0, lon=-6.2)]
    assert nearest(aircraft, *home, max_nm=10) is None
    assert nearest(aircraft, *home) is not None


def test_nearest_breaks_ties_by_hex_so_the_panel_does_not_flicker():
    home = (53.0, -6.0)
    a = Aircraft(hex="bbbb", lat=53.1, lon=-6.0)
    b = Aircraft(hex="aaaa", lat=53.1, lon=-6.0)
    assert nearest([a, b], *home) is b
    assert nearest([b, a], *home) is b


def test_great_circle_fraction_endpoints_and_midpoint():
    assert great_circle_fraction(DUB, LHR, DUB) == pytest.approx(0.0, abs=0.01)
    assert great_circle_fraction(DUB, LHR, LHR) == pytest.approx(1.0, abs=0.01)
    mid = ((DUB[0] + LHR[0]) / 2, (DUB[1] + LHR[1]) / 2)
    assert great_circle_fraction(DUB, LHR, mid) == pytest.approx(0.5, abs=0.02)


def test_great_circle_fraction_is_clamped_when_off_track():
    beyond = (49.0, 2.5)  # past Heathrow, over Paris
    assert 0.0 <= great_circle_fraction(DUB, LHR, beyond) <= 1.0


# ------------------------------------------------------------------------- units


@pytest.mark.parametrize(
    ("alt", "unit", "ground", "expected"),
    [
        (24000, "ft", False, "24,000FT"),
        (24000, "m", False, "7,315M"),
        (None, "ft", False, "---"),
        (0, "ft", True, "GROUND"),
        (900, "ft", False, "900FT"),
    ],
)
def test_format_altitude(alt, unit, ground, expected):
    assert units.format_altitude(alt, unit, ground) == expected


@pytest.mark.parametrize(
    ("kt", "unit", "expected"),
    [(410, "kt", "410KT"), (410, "mph", "472MPH"), (410, "kmh", "759KM/H"), (None, "kt", "---")],
)
def test_format_speed(kt, unit, expected):
    assert units.format_speed(kt, unit) == expected


@pytest.mark.parametrize(
    ("nm", "unit", "expected"),
    [(5.3, "mi", "6.1MI"), (5.3, "km", "9.8KM"), (5.3, "nm", "5.3NM"), (40, "nm", "40NM")],
)
def test_format_distance(nm, unit, expected):
    assert units.format_distance(nm, unit) == expected


def test_distance_round_trips_through_nm():
    assert units.to_nm(units.convert_distance(12.5, "km"), "km") == pytest.approx(12.5)
    assert units.to_nm(units.convert_distance(12.5, "mi"), "mi") == pytest.approx(12.5)


@pytest.mark.parametrize(
    ("rate", "expected"), [(1200, "^1200"), (-800, "v800"), (10, "LEVEL"), (None, "")]
)
def test_format_vertical_rate(rate, expected):
    assert units.format_vertical_rate(rate) == expected
