"""The wire-format quirks the spec calls out, pinned one by one."""

from __future__ import annotations

import pytest

from skypanel.sources.base import (
    clean_callsign,
    parse_aircraft_list,
    parse_altitude,
    parse_entry,
)


def test_callsign_is_space_padded_on_the_wire():
    assert clean_callsign("RYR1812 ") == "RYR1812"
    assert clean_callsign("  ") is None
    assert clean_callsign(None) is None
    assert clean_callsign(1812) is None


def test_alt_baro_can_be_the_string_ground():
    alt, on_ground = parse_altitude({"alt_baro": "ground"})
    assert alt is None and on_ground is True


def test_alt_geom_is_the_fallback_when_baro_is_missing():
    alt, on_ground = parse_altitude({"alt_geom": 12500})
    assert alt == 12500.0 and on_ground is False


def test_alt_baro_wins_over_alt_geom():
    alt, _ = parse_altitude({"alt_baro": 11000, "alt_geom": 11350})
    assert alt == 11000.0


def test_type_and_registration_are_optional():
    ac = parse_entry({"hex": "4ca7b5", "flight": "RYR1812 ", "lat": 53.4, "lon": -6.3})
    assert ac is not None
    assert ac.type_code is None and ac.registration is None
    assert ac.callsign == "RYR1812"


def test_entry_without_hex_is_dropped():
    assert parse_entry({"flight": "GHOST1", "lat": 1, "lon": 2}) is None


def test_tisb_hex_prefix_is_stripped():
    ac = parse_entry({"hex": "~4ca7b5", "lat": 1.0, "lon": 2.0})
    assert ac is not None and ac.hex == "4ca7b5"


def test_positionless_and_stale_entries_are_dropped():
    entries = [
        {"hex": "a", "lat": 1.0, "lon": 2.0, "seen_pos": 1.0},
        {"hex": "b", "seen_pos": 1.0},  # no position
        {"hex": "c", "lat": 1.0, "lon": 2.0, "seen_pos": 45.0},  # too old
    ]
    assert [ac.hex for ac in parse_aircraft_list(entries, max_age_s=30.0)] == ["a"]


def test_max_age_none_keeps_everything_with_a_position():
    entries = [{"hex": "c", "lat": 1.0, "lon": 2.0, "seen_pos": 900.0}]
    assert len(parse_aircraft_list(entries, max_age_s=None)) == 1


def test_non_dict_entries_are_ignored_rather_than_raising():
    assert parse_aircraft_list([None, "nope", 42, {"hex": "a", "lat": 1.0, "lon": 2.0}]) != []


@pytest.mark.parametrize("value", ["not-a-number", True, {}, []])
def test_junk_numeric_fields_become_none(value):
    ac = parse_entry({"hex": "abc", "lat": 1.0, "lon": 2.0, "gs": value})
    assert ac is not None and ac.gs_kt is None
