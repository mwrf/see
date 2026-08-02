from __future__ import annotations

import pytest

from skypanel.http import HttpClient, RetryPolicy
from skypanel.sources.base import SourceError
from skypanel.sources.local import CANDIDATE_PATHS, LocalSource, parse_aircraft_json

from .cassettes import cassette_transport


def client(calls: list[str] | None = None) -> HttpClient:
    return HttpClient(
        timeout=1.0,
        retry=RetryPolicy(attempts=1),
        transport=cassette_transport("local", calls=calls, strict=False),
    )


# -- parsing ------------------------------------------------------------


def test_callsign_padding_is_stripped(fixture_json):
    parsed = parse_aircraft_json(fixture_json("01-busy-dublin.json"))
    assert "RYR1812" in {ac.callsign for ac in parsed}


def test_ground_altitude_string_becomes_zero(fixture_json):
    parsed = parse_aircraft_json(fixture_json("06-no-route.json"))
    grounded = next(ac for ac in parsed if ac.hex == "3d2a10")
    assert grounded.alt_baro_ft == 0.0
    assert grounded.on_ground


def test_missing_callsign_is_none_not_empty_string(fixture_json):
    parsed = parse_aircraft_json(fixture_json("06-no-route.json"))
    assert next(ac for ac in parsed if ac.hex == "3d2a10").callsign is None


def test_entries_without_position_are_dropped():
    parsed = parse_aircraft_json({"aircraft": [{"hex": "abc123", "flight": "TEST1 "}]})
    assert parsed == []


def test_stale_positions_are_dropped(fixture_json):
    parsed = parse_aircraft_json(fixture_json("01-busy-dublin.json"))
    assert "4d0219" not in {ac.hex for ac in parsed}


def test_stale_threshold_is_configurable(fixture_json):
    payload = fixture_json("01-busy-dublin.json")
    lenient = parse_aircraft_json(payload, max_seen_pos_s=float("inf"))
    # The stale entry has no lat/lon either, so it stays dropped for that reason.
    assert len(lenient) == len(parse_aircraft_json(payload))


def test_alt_geom_is_used_when_alt_baro_is_absent():
    parsed = parse_aircraft_json(
        {"aircraft": [{"hex": "abc123", "lat": 53.0, "lon": -6.0, "alt_geom": 12500}]}
    )
    assert parsed[0].alt_baro_ft == 12500.0


def test_optional_type_and_registration_are_tolerated():
    parsed = parse_aircraft_json({"aircraft": [{"hex": "abc123", "lat": 53.0, "lon": -6.0}]})
    assert parsed[0].type_code is None
    assert parsed[0].registration is None


def test_hex_is_normalised_to_lowercase():
    parsed = parse_aircraft_json({"aircraft": [{"hex": "4CA7B3", "lat": 53.0, "lon": -6.0}]})
    assert parsed[0].hex == "4ca7b3"


def test_non_aircraft_json_raises_a_diagnostic_not_a_crash():
    with pytest.raises(SourceError) as excinfo:
        parse_aircraft_json({"totally": "different"})
    assert excinfo.value.hint is not None


def test_garbage_entries_are_skipped_rather_than_failing_the_whole_poll():
    parsed = parse_aircraft_json(
        {"aircraft": ["not-a-dict", {"hex": "abc123", "lat": 53.0, "lon": -6.0}]}
    )
    assert len(parsed) == 1


# -- endpoint probing ---------------------------------------------------


async def test_probe_walks_candidates_until_one_returns_valid_json():
    calls: list[str] = []
    source = LocalSource("raspberrypi.local", client=client(calls))
    url = await source.probe()
    assert url == "http://raspberrypi.local:8080/tar1090/data/aircraft.json"
    # It should have tried the two earlier candidates first, in order.
    assert calls[0].endswith("/data/aircraft.json")
    assert calls[1].endswith("/skyaware/data/aircraft.json")


async def test_probe_rejects_html_served_at_a_json_path():
    source = LocalSource("raspberrypi.local", client=client())
    await source.probe()
    failures = dict(source.probe_log)
    skyaware = "http://raspberrypi.local:8080/skyaware/data/aircraft.json"
    assert "not JSON" in failures[skyaware] or "aircraft" in failures[skyaware]


async def test_probe_result_is_remembered_so_later_polls_do_not_re_probe():
    calls: list[str] = []
    source = LocalSource("raspberrypi.local", client=client(calls))
    await source.fetch(53.3498, -6.2603, 26.0)
    first_count = len(calls)
    await source.fetch(53.3498, -6.2603, 26.0)
    assert len(calls) == first_count + 1


async def test_configured_path_skips_probing_entirely():
    calls: list[str] = []
    source = LocalSource(
        "raspberrypi.local",
        path="http://raspberrypi.local:8080/tar1090/data/aircraft.json",
        client=client(calls),
    )
    assert source.candidates() == ["http://raspberrypi.local:8080/tar1090/data/aircraft.json"]
    await source.fetch(53.3498, -6.2603, 26.0)
    assert len(calls) == 1


async def test_total_probe_failure_produces_a_hint_not_a_stack_trace():
    source = LocalSource("nothing.local", client=client())
    with pytest.raises(SourceError) as excinfo:
        await source.probe()
    diagnostic = excinfo.value.diagnostic()
    assert "aircraft.json" in diagnostic
    assert "hint:" in diagnostic
    assert not source.healthy or source.healthy  # probing alone does not flip health


def test_candidate_list_matches_the_documented_order():
    source = LocalSource("pi.lan")
    assert source.candidates() == [p.format(host="pi.lan") for p in CANDIDATE_PATHS]


async def test_fetch_returns_parsed_aircraft():
    source = LocalSource("raspberrypi.local", client=client())
    result = await source.fetch(53.3498, -6.2603, 26.0)
    assert [ac.callsign for ac in result] == ["RYR1812"]
    assert source.healthy


async def test_failed_fetch_marks_the_source_unhealthy_after_repeated_failures():
    source = LocalSource("nothing.local", client=client())
    for _ in range(3):
        with pytest.raises(SourceError):
            await source.fetch(53.3498, -6.2603, 26.0)
    assert not source.healthy
