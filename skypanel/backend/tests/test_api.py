from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from skypanel.app import create_app
from skypanel.models import Aircraft
from skypanel.settings import SourceConfig
from skypanel.sources.base import SourceError
from skypanel.sources.manager import SourceManager
from skypanel.sources.mock import MockSource


@pytest.fixture
def client(service, tmp_path):
    #  Point persisted settings at a temp file so POSTing does not write to the
    #  developer's real state directory.
    service.config.server.settings_path = str(tmp_path / "settings.json")
    with TestClient(create_app(service)) as test_client:
        yield test_client


def test_frame_endpoint_returns_the_documented_shape(client):
    body = client.get("/api/frame").json()
    assert set(body) == {"mode", "source", "generated_at", "lines", "progress", "status"}
    assert body["source"] == "mock"
    assert body["lines"]


def test_frame_endpoint_is_not_cached(client):
    assert client.get("/api/frame").headers["cache-control"] == "no-store"


def test_frame_reports_which_source_served_it(client):
    assert client.get("/api/frame").json()["source"] == "mock"


def test_nearest_endpoint_returns_the_full_enriched_record(client):
    body = client.get("/api/nearest").json()
    assert body["aircraft"]["hex"]
    assert "distance_mi" in body["aircraft"]
    assert "route" in body["aircraft"]


def test_aircraft_endpoint_lists_everything_in_range_nearest_first(client):
    body = client.get("/api/aircraft").json()
    distances = [ac["distance_mi"] for ac in body["aircraft"]]
    assert distances == sorted(distances)


def test_settings_get_returns_settings_and_ui_metadata(client):
    body = client.get("/api/settings").json()
    assert body["settings"]["scan_radius_mi"] == 30.0
    assert "adsb_fi" in body["meta"]["providers"]
    assert body["meta"]["airlines_known"] > 100


def test_settings_post_updates_and_persists(client, tmp_path):
    response = client.post("/api/settings", json={"speed_unit": "mph", "brightness": 20})
    assert response.status_code == 200
    assert response.json()["settings"]["speed_unit"] == "mph"
    assert (tmp_path / "settings.json").exists()
    assert client.get("/api/settings").json()["settings"]["brightness"] == 20


def test_settings_change_is_visible_in_the_very_next_frame(client):
    client.post("/api/settings", json={"altitude_unit": "m"})
    detail = client.get("/api/frame").json()["lines"][-1]["text"]
    assert "M " in detail or detail.endswith("M")


def test_invalid_settings_are_rejected_with_a_readable_message(client):
    response = client.post("/api/settings", json={"speed_unit": "furlongs"})
    assert response.status_code == 400
    assert "speed_unit" in response.json()["detail"]


def test_settings_accepts_a_form_post_from_the_web_page(client):
    response = client.post("/api/settings", data={"brightness": "42"})
    assert response.status_code == 200
    assert response.json()["settings"]["brightness"] == 42


def test_malformed_json_body_is_a_400_not_a_500(client):
    response = client.post(
        "/api/settings", content="{nope", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400


def test_track_endpoint_switches_the_frame_to_tracking_mode(client):
    assert client.post("/api/track", json={"ident": "RYR1812"}).status_code == 200
    assert client.get("/api/frame").json()["mode"] == "tracking"


def test_track_requires_an_ident(client):
    assert client.post("/api/track", json={}).status_code == 400


def test_track_cancel_returns_to_nearest_mode(client):
    client.post("/api/track", json={"ident": "RYR1812"})
    assert client.post("/api/track/cancel").json()["was_tracking"] is True
    assert client.get("/api/frame").json()["mode"] == "nearest"


def test_cancelling_when_not_tracking_is_harmless(client):
    assert client.post("/api/track/cancel").json()["was_tracking"] is False


def test_history_endpoint_summarises_what_has_been_seen(client):
    client.get("/api/frame")
    body = client.get("/api/history?hours=24").json()
    assert body["summary"]["aircraft"] >= 1
    assert body["sightings"]


def test_history_hours_are_clamped_to_something_sane(client):
    assert client.get("/api/history?hours=99999").json()["hours"] == 720.0


def test_healthz_reports_source_cache_and_quota(client):
    client.get("/api/frame")
    body = client.get("/healthz").json()
    assert body["ok"] is True
    assert body["active_source"] == "mock"
    assert "hit_rate_pct" in body["cache"]
    assert body["aeroapi_quota"] is None  # not configured in tests


def test_healthz_is_503_before_the_first_successful_poll(service):
    with TestClient(create_app(service)) as fresh:
        assert fresh.get("/healthz").status_code == 503


def test_settings_page_is_served_and_mentions_the_key_controls(client):
    html = client.get("/").text
    assert "SkyPanel" in html
    assert "scan_radius_mi" in html
    assert "viewport" in html  # usable on a phone


def test_dashboard_page_is_served(client):
    assert "SkyPanel history" in client.get("/dashboard").text


def test_airlines_endpoint_exposes_the_colour_table(client):
    body = client.get("/api/airlines").json()
    assert body["count"] > 100
    assert any(a["code"] == "RYR" for a in body["airlines"])


def test_firmware_manifest_is_served_even_when_no_build_exists(client):
    body = client.get("/api/firmware/manifest.json").json()
    assert body["type"] == "skypanel"


# -- failure behaviour --------------------------------------------------


class BrokenSource:
    name = "local"
    healthy = False
    last_error = "down"

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        raise SourceError("receiver unreachable", hint="check the decoder")

    async def aclose(self) -> None:
        return None


def test_a_dead_source_produces_an_error_frame_not_a_500(service):
    service.manager = SourceManager(
        SourceConfig(mode="local", failover=False), primary=BrokenSource(), fallback=None
    )
    with TestClient(create_app(service)) as broken:
        body = broken.get("/api/frame").json()
    assert body["mode"] == "error"
    assert body["status"] == "offline"
    assert body["lines"][0]["text"]


def test_attribution_is_shown_when_an_aggregator_serves_the_frame(service):
    from skypanel.http import HttpClient, RetryPolicy
    from skypanel.ratelimit import TokenBucket
    from skypanel.sources.aggregator import AggregatorSource

    from .cassettes import cassette_transport
    from .test_http import FakeClock

    aggregator = AggregatorSource(
        "adsb_fi",
        client=HttpClient(
            retry=RetryPolicy(attempts=1), transport=cassette_transport("aggregator")
        ),
        bucket=TokenBucket(rate=1000.0, capacity=1000.0, clock=FakeClock()),
    )
    service.manager = SourceManager(
        SourceConfig(mode="aggregator"), primary=aggregator, fallback=None
    )
    with TestClient(create_app(service)) as client:
        meta = client.get("/api/settings").json()["meta"]
    assert meta["attribution"] == "Data from adsb.fi"


def test_no_attribution_is_claimed_for_your_own_receiver(client):
    # A local receiver imposes no terms; showing a credit would be noise.
    assert client.get("/api/settings").json()["meta"]["attribution"] is None


def test_an_empty_sky_produces_an_empty_frame(service, fixture_dir):
    service.manager = SourceManager(
        SourceConfig(mode="mock"),
        primary=MockSource(fixture_dir / "03-empty-sky.json", speed=0.0),
        fallback=None,
    )
    with TestClient(create_app(service)) as empty:
        body = empty.get("/api/frame").json()
    assert body["mode"] == "empty"
    assert body["status"] == "live"
