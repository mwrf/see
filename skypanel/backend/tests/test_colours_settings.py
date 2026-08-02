from __future__ import annotations

import json
from datetime import time as dtime

import pytest

from skypanel.airports import AirportRegistry
from skypanel.colours import (
    MIN_PANEL_LEVEL,
    dim,
    ensure_legible,
    flight_number,
    normalise_colour,
    operator_code,
    panel_level,
    required_linear,
    to_rgb,
)
from skypanel.settings import AppConfig, Settings, SettingsError, parse_hhmm

# -- airline data -------------------------------------------------------


def test_airline_table_covers_the_main_european_operators(airlines):
    assert len(airlines) >= 150
    for code in ("RYR", "EIN", "BAW", "EZY", "DLH", "AFR", "KLM", "WZZ", "AAL", "UAE"):
        assert code in airlines, code


def test_every_colour_in_the_data_file_is_valid_hex(airlines):
    for code in airlines.codes():
        airline = airlines.get(code)
        assert airline is not None
        assert normalise_colour(airline.colour) == airline.colour


def test_airline_data_file_is_valid_json_and_keyed_by_icao_code():
    from skypanel.colours import DATA_PATH

    raw = json.loads(DATA_PATH.read_text())
    assert all(len(code) == 3 and code.isalpha() for code in raw)


def test_ryanair_resolves_to_its_brand_blue(airlines):
    assert airlines.colour_for("RYR1812") == "#073590"


def test_unknown_airlines_render_white(airlines):
    assert airlines.colour_for("XYZ1234") == "#FFFFFF"
    assert airlines.colour_for(None) == "#FFFFFF"


@pytest.mark.parametrize(
    ("callsign", "code", "number"),
    [
        ("RYR1812", "RYR", "1812"),
        ("BAW23K", "BAW", "23K"),
        ("EZY83UK", "EZY", "83UK"),
        ("EIDYR", None, None),
        ("", None, None),
        (None, None, None),
    ],
)
def test_callsign_decomposition(callsign, code, number):
    assert operator_code(callsign) == code
    assert flight_number(callsign) == number


@pytest.mark.parametrize(
    ("value", "expected"),
    [("#073590", "#073590"), ("073590", "#073590"), ("#f00", "#FF0000"), ("nonsense", "#FFFFFF")],
)
def test_colour_normalisation(value, expected):
    assert normalise_colour(value) == expected


def test_to_rgb_round_trips():
    assert to_rgb("#073590") == (7, 53, 144)


def test_dim_scales_towards_black():
    assert dim("#FFFFFF", 0.5) == "#808080"
    assert dim("#FFFFFF", 0.0) == "#000000"


def test_very_dark_brand_colours_are_lifted_so_they_read_on_the_panel():
    lifted = ensure_legible("#05164D")  # Lufthansa navy
    # Hue is preserved: blue still dominates.
    r, g, b = to_rgb(lifted)
    assert b > r and b > g


@pytest.mark.parametrize("brand", ["#05164D", "#0B1560", "#073590", "#11397E", "#003268"])
def test_dark_brand_colours_emit_enough_light_after_gamma(brand):
    # The check that matters is post-gamma: a peak channel of 144 sounds
    # bright and emits 73, which on a P4 panel is barely there.
    assert panel_level(brand) < MIN_PANEL_LEVEL, "fixture should be a dark colour"
    assert panel_level(ensure_legible(brand)) >= MIN_PANEL_LEVEL - 1


def test_required_linear_inverts_the_gamma_ramp():
    for level in (32, 110, 200, 255):
        assert abs(panel_level(f"#{required_linear(level):02X}0000") - level) <= 1


def test_ensure_legible_leaves_bright_colours_alone():
    assert ensure_legible("#FF6600") == "#FF6600"
    assert ensure_legible("#FFFFFF") == "#FFFFFF"


def test_pure_black_becomes_white_rather_than_invisible():
    assert ensure_legible("#000000") == "#FFFFFF"


# -- airports -----------------------------------------------------------


def test_airport_lookup_by_icao_and_iata(airports):
    assert airports.city("EIDW") == "Dublin"
    assert airports.city("DUB") == "Dublin"


def test_airport_display_falls_back_to_the_code_when_the_city_is_unknown(airports):
    assert airports.display("ZZZZ", prefer_city=True) == "ZZZZ"
    assert airports.display(None, prefer_city=True) is None


def test_airport_subset_carries_coordinates_for_the_progress_bar(airports):
    dublin = airports.get("EIDW")
    assert dublin is not None and dublin.has_position


def test_airport_registry_tolerates_rows_without_a_city(tmp_path):
    path = tmp_path / "a.csv"
    path.write_text("ident,iata,municipality\nEIDW,DUB,Dublin\nXXXX,,\n")
    registry = AirportRegistry.load(path)
    assert len(registry) == 1


# -- settings -----------------------------------------------------------


def test_defaults_are_valid():
    Settings().validate()


def test_partial_update_keeps_other_values():
    updated = Settings().merged({"speed_unit": "mph"})
    assert updated.speed_unit == "mph"
    assert updated.altitude_unit == "ft"


@pytest.mark.parametrize(
    "updates",
    [
        {"home_lat": 91.0},
        {"home_lon": -181.0},
        {"speed_unit": "furlongs"},
        {"distance_unit": "leagues"},
        {"route_display": "hieroglyphs"},
        {"scan_radius_mi": 0.5},
        {"scan_radius_mi": 500},
        {"poll_interval_s": 0},
        {"brightness": 120},
        {"categories": ["airline", "ufo"]},
        {"night_start": "25:00"},
        {"night_start": "nope"},
        {"min_altitude_ft": 40000, "max_altitude_ft": 1000},
    ],
)
def test_invalid_settings_are_rejected(updates):
    with pytest.raises(SettingsError):
        Settings().merged(updates)


def test_unknown_keys_are_rejected_rather_than_silently_ignored():
    with pytest.raises(SettingsError) as excinfo:
        Settings().merged({"brightnes": 50})
    assert "brightnes" in str(excinfo.value)


def test_form_post_strings_are_coerced_to_the_right_types():
    updated = Settings().merged(
        {
            "brightness": "75",
            "scan_radius_mi": "45.5",
            "show_vert_rate": "on",
            "categories": "airline,military",
        }
    )
    assert updated.brightness == 75
    assert updated.scan_radius_mi == 45.5
    assert updated.show_vert_rate is True
    assert updated.categories == ["airline", "military"]


def test_unchecked_html_checkbox_reads_as_false():
    assert Settings().merged({"show_vert_rate": "false"}).show_vert_rate is False


def test_settings_round_trip_through_disk(tmp_path):
    path = tmp_path / "settings.json"
    original = Settings().merged({"site_name": "Shed roof", "brightness": 33})
    original.save(path)
    assert Settings.load(path).to_json() == original.to_json()


def test_missing_settings_file_yields_defaults(tmp_path):
    assert Settings.load(tmp_path / "absent.json").to_json() == Settings().to_json()


def test_corrupt_settings_file_yields_defaults_rather_than_crashing(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text("{not json")
    assert Settings.load(path).brightness == Settings().brightness


def test_settings_file_from_an_older_version_keeps_what_still_applies(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"brightness": 22, "obsolete_option": True}))
    assert Settings.load(path).brightness == 22


@pytest.mark.parametrize(
    ("now", "expected"),
    [(dtime(23, 30), True), (dtime(3, 0), True), (dtime(6, 59), True), (dtime(12, 0), False)],
)
def test_night_window_wraps_past_midnight(now, expected):
    assert Settings().is_night(now) is expected


def test_daytime_window_that_does_not_wrap():
    settings = Settings().merged({"night_start": "01:00", "night_end": "05:00"})
    assert settings.is_night(dtime(3, 0)) is True
    assert settings.is_night(dtime(23, 0)) is False


def test_equal_start_and_end_disables_night_mode():
    settings = Settings().merged({"night_start": "00:00", "night_end": "00:00"})
    assert settings.is_night(dtime(3, 0)) is False


def test_effective_brightness_dims_at_night():
    settings = Settings()
    assert settings.effective_brightness(dtime(2, 0)) == settings.night_brightness
    assert settings.effective_brightness(dtime(14, 0)) == settings.brightness


def test_parse_hhmm_accepts_valid_times():
    assert parse_hhmm("07:05") == dtime(7, 5)


# -- app config ---------------------------------------------------------


def test_config_defaults_apply_when_there_is_no_toml(tmp_path):
    config = AppConfig.load(tmp_path / "absent.toml")
    assert config.source.mode == "auto"
    assert config.enrich.adsbdb_enabled is True


def test_config_toml_overrides_the_documented_source_section(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text(
        '[source]\nmode = "local"\nlocal_host = "pi.lan"\n'
        'aggregator_provider = "adsb_lol"\nfailover = false\n'
    )
    config = AppConfig.load(path)
    assert config.source.mode == "local"
    assert config.source.local_host == "pi.lan"
    assert config.source.aggregator_provider == "adsb_lol"
    assert config.source.failover is False


def test_unknown_toml_keys_are_ignored_rather_than_fatal(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('[source]\nmode = "mock"\nspeculative_option = 1\n')
    assert AppConfig.load(path).source.mode == "mock"
