"""Service loop, tracking, settings, history and the HTTP surface."""

from __future__ import annotations

import json
from datetime import time

import pytest
from fastapi.testclient import TestClient

from skypanel.app import create_app
from skypanel.config import EnrichConfig
from skypanel.enrich.adsbdb import AdsbdbClient
from skypanel.enrich.service import Enricher
from skypanel.history import History
from skypanel.http import HttpClient, RetryPolicy
from skypanel.models import Aircraft, Category, EnrichedAircraft, Route
from skypanel.service import PanelService
from skypanel.settings import Settings, SettingsStore
from skypanel.sources.manager import SourceManager
from skypanel.sources.mock import MockSource
from skypanel.tracking import Tracker

from .conftest import cassette


def build_service(config, settings_store, cache, fixture_dir, fixture="dublin_approach"):
    source = MockSource(fixture_dir)
    source.select(fixture)
    manager = SourceManager(config, sources={"mock": source})
    enricher = Enricher(
        EnrichConfig(),
        cache=cache,
        adsbdb=AdsbdbClient(
            "https://api.adsbdb.com",
            client=HttpClient(
                timeout_s=1.0,
                retry=RetryPolicy(attempts=1, base_delay_s=0.0, jitter=False),
                transport=cassette("adsbdb"),
            ),
        ),
    )
    return PanelService(
        config,
        settings=settings_store,
        sources=manager,
        enricher=enricher,
        cache=cache,
        history=History(":memory:"),
    )


@pytest.fixture
async def service(config, settings_store, cache, fixture_dir):
    svc = build_service(config, settings_store, cache, fixture_dir)
    yield svc
    await svc.aclose()


# ---------------------------------------------------------------------- service


async def test_poll_selects_the_nearest_aircraft(service):
    result = await service.poll_once()
    assert result.selected is not None
    # RYR1812 at 53.3901,-6.3120 is the closest in the Dublin approach fixture.
    assert result.selected.aircraft.callsign == "RYR1812"
    assert result.source == "mock"


async def test_frame_is_answered_from_memory_between_polls(service):
    await service.poll_once()
    first = service.current_frame()
    second = service.current_frame()
    assert first.lines[0].text == second.lines[0].text == "RYANAIR"


async def test_empty_sky_produces_an_empty_frame_not_an_error(
    config, settings_store, cache, fixture_dir
):
    svc = build_service(config, settings_store, cache, fixture_dir, fixture="empty_sky")
    await svc.poll_once()
    assert svc.current_frame().mode == "empty"
    await svc.aclose()


async def test_category_filter_skips_the_helicopter(config, settings_store, cache, fixture_dir):
    settings_store.update({"categories": ["airline"]})
    svc = build_service(config, settings_store, cache, fixture_dir, fixture="helicopter")
    await svc.poll_once()
    assert svc.selected is None
    assert svc.current_frame().mode == "empty"
    await svc.aclose()


async def test_scan_radius_limits_selection(config, settings_store, cache, fixture_dir):
    settings_store.update({"scan_radius": 2.0, "distance_unit": "mi"})
    svc = build_service(config, settings_store, cache, fixture_dir, fixture="single_distant")
    await svc.poll_once()
    assert svc.current_frame().mode == "empty"
    await svc.aclose()


async def test_history_records_what_flew_past(service):
    await service.poll_once()
    sightings = service.history.recent(hours=1)
    assert sightings and sightings[0].callsign == "RYR1812"
    assert sightings[0].airline == "Ryanair"


async def test_history_collapses_repeat_sightings(service):
    await service.poll_once()
    await service.poll_once()
    assert len(service.history.recent(hours=1)) == 1


async def test_health_reports_source_cache_and_quota(service):
    await service.poll_once()
    health = service.health()
    assert health["active_source"] == "mock"
    assert health["status"] == "live"
    assert health["cache"]["entries"] >= 1
    assert health["aeroapi"] == {"enabled": False}


async def test_rebuild_reflects_a_settings_change_without_another_poll(service):
    await service.poll_once()
    assert "FT" in service.current_frame().lines[2].text
    service.settings_store.update({"altitude_unit": "m"})
    assert "M" in service.rebuild().lines[2].text


# --------------------------------------------------------------------- tracking


def enriched_for(callsign="BAW832", *, lat=53.28, lon=-6.44, alt=11000.0, on_ground=False):
    return EnrichedAircraft(
        aircraft=Aircraft(
            hex="406a2f", callsign=callsign, lat=lat, lon=lon,
            alt_baro_ft=alt, gs_kt=301.0, on_ground=on_ground,
        ),
        route=Route(origin="DUB", destination="LHR", airline_icao="BAW"),
        traffic_category=Category.AIRLINE,
    )


def test_tracker_computes_progress_along_the_leg():
    tracker = Tracker()
    tracker.start("BAW832")
    state = tracker.update(enriched_for())
    assert state is not None
    assert 0.0 <= state.fraction < 0.2  # just departed Dublin


def test_tracker_matches_on_hex_after_the_callsign_drops_out():
    tracker = Tracker()
    tracker.start("BAW832")
    tracker.update(enriched_for())
    anonymous = Aircraft(hex="406a2f", callsign=None, lat=53.3, lon=-6.4)
    assert tracker.match([anonymous]) is anonymous


def test_tracker_detects_landing_and_pins_progress_to_full():
    tracker = Tracker()
    tracker.start("BAW832")
    state = tracker.update(enriched_for(lat=51.47, lon=-0.46, alt=300.0))
    assert state is not None and state.landed
    assert state.fraction == pytest.approx(1.0)


def test_tracker_returns_to_nearest_after_landing_lingers():
    tracker = Tracker()
    tracker.start("BAW832")
    tracker.update(enriched_for(lat=51.47, lon=-0.46, alt=300.0), now=0.0)
    assert tracker.update(None, now=30.0) is not None  # still lingering
    assert tracker.update(None, now=120.0) is None  # gone
    assert not tracker.active


def test_tracker_gives_up_on_a_flight_that_vanishes():
    tracker = Tracker()
    tracker.start("BAW832")
    tracker.update(enriched_for(), now=0.0)
    assert tracker.update(None, now=100.0) is not None
    assert tracker.update(None, now=400.0) is None


def test_tracker_rejects_an_empty_ident():
    with pytest.raises(ValueError, match="ident"):
        Tracker().start("   ")


# --------------------------------------------------------------------- settings


def test_settings_round_trip_through_disk(tmp_path):
    path = tmp_path / "settings.json"
    store = SettingsStore(path)
    store.update({"altitude_unit": "m", "brightness": 33})
    assert SettingsStore(path).current.altitude_unit == "m"
    assert SettingsStore(path).current.brightness == 33


def test_settings_recover_from_a_corrupt_file(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text("{ this is not json", encoding="utf-8")
    assert SettingsStore(path).current.altitude_unit == "ft"


def test_settings_reject_an_empty_line_list():
    with pytest.raises(ValueError, match="at least one line"):
        Settings(lines=[])


def test_settings_deduplicate_lines_but_keep_order():
    assert Settings(lines=["route", "airline", "route"]).lines == ["route", "airline"]


@pytest.mark.parametrize(
    ("now", "expected"),
    [(time(23, 30), True), (time(3, 0), True), (time(12, 0), False), (time(7, 0), False)],
)
def test_night_window_wraps_past_midnight(now, expected):
    s = Settings(night_start=time(23, 0), night_end=time(7, 0))
    assert s.is_night(now) is expected


def test_daytime_window_does_not_wrap():
    s = Settings(night_start=time(1, 0), night_end=time(5, 0))
    assert s.is_night(time(3, 0)) and not s.is_night(time(23, 0))


def test_scan_radius_is_bounded_to_the_supported_range():
    with pytest.raises(ValueError):
        Settings(scan_radius=500)


# -------------------------------------------------------------------------- API


@pytest.fixture
def client(config, settings_store, cache, fixture_dir):
    service = build_service(config, settings_store, cache, fixture_dir)
    app = create_app(config, service=service)
    with TestClient(app) as test_client:
        yield test_client


def test_api_frame_is_the_documented_contract(client):
    body = client.get("/api/frame").json()
    assert body["mode"] in {"nearest", "empty", "tracking", "error"}
    assert body["source"] == "mock"
    assert body["lines"][0]["style"] == "title"
    assert set(body["lines"][0]) == {"text", "colour", "style", "scroll"}


def test_api_nearest_returns_the_full_enriched_record(client):
    body = client.get("/api/nearest").json()
    assert body["aircraft"]["callsign"] == "RYR1812"
    assert body["route"]["destination"] == "STN"
    assert body["airline_colour"] == "#073590"


def test_api_settings_get_and_patch(client):
    assert client.get("/api/settings").json()["speed_unit"] == "kt"
    updated = client.post("/api/settings", json={"speed_unit": "mph"})
    assert updated.status_code == 200
    assert updated.json()["speed_unit"] == "mph"
    assert "MPH" in client.get("/api/frame").json()["lines"][2]["text"]


def test_api_settings_rejects_invalid_values(client):
    assert client.post("/api/settings", json={"scan_radius": 9000}).status_code == 422
    assert client.post("/api/settings", json={"lines": []}).status_code == 422


def test_api_track_and_cancel(client):
    started = client.post("/api/track", json={"ident": "BAW832"})
    assert started.status_code == 200 and started.json()["tracking"] == "BAW832"
    assert client.get("/api/frame").json()["mode"] == "tracking"

    client.post("/api/track/cancel")
    assert client.get("/api/frame").json()["mode"] == "nearest"


def test_api_track_requires_an_ident(client):
    assert client.post("/api/track", json={}).status_code == 422


def test_api_history_summarises_and_lists(client):
    client.get("/api/frame")
    body = client.get("/api/history?hours=24").json()
    assert body["summary"]["hours"] == 24
    assert isinstance(body["sightings"], list)


def test_api_healthz_reports_the_feed(client):
    body = client.get("/healthz").json()
    assert body["active_source"] == "mock"
    assert any(s["name"] == "mock" for s in body["sources"])


def test_api_serves_the_settings_page_and_dashboard(client):
    for path in ("/", "/history"):
        response = client.get(path)
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert "viewport" in response.text  # usable on a phone


def test_api_aircraft_lists_everything_in_range(client):
    body = client.get("/api/aircraft").json()
    assert body["count"] >= 1
    assert body["aircraft"][0]["hex"]


def test_firmware_manifest_404s_when_none_is_configured(client):
    assert client.get("/firmware/manifest.json").status_code == 404


def test_frame_json_is_small_enough_for_an_esp32_to_parse(client):
    # The firmware parses this into a fixed buffer; keep an eye on the size.
    assert len(json.dumps(client.get("/api/frame").json())) < 1024
