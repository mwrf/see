"""Local probing, aggregator rate limiting and failover — all off the network."""

from __future__ import annotations

import httpx
import pytest

from skypanel.config import Config, SourceConfig
from skypanel.http import HttpClient, RetryPolicy, TokenBucket
from skypanel.models import Aircraft
from skypanel.sources.aggregator import AggregatorSource
from skypanel.sources.base import SourceError
from skypanel.sources.local import LocalSource
from skypanel.sources.manager import SourceManager
from skypanel.sources.mock import MockSource

from .conftest import cassette, sequence_transport

DUBLIN = (53.3498, -6.2603)


def local_client(name: str = "dump1090", **kwargs) -> HttpClient:
    return HttpClient(
        timeout_s=1.0,
        retry=RetryPolicy(attempts=1, base_delay_s=0.0, jitter=False),
        transport=cassette(name, **kwargs),
    )


# ------------------------------------------------------------------------ local


async def test_local_probes_candidates_in_order_until_one_answers():
    seen: list[str] = []
    source = LocalSource(
        "receiver.local", client=local_client(on_request=lambda r: seen.append(str(r.url)))
    )
    aircraft = await source.fetch(*DUBLIN, 60)

    assert source.url == "http://receiver.local:8080/tar1090/data/aircraft.json"
    assert seen[:3] == [
        "http://receiver.local:8080/data/aircraft.json",
        "http://receiver.local:8080/skyaware/data/aircraft.json",
        "http://receiver.local:8080/tar1090/data/aircraft.json",
    ]
    assert source.healthy
    assert aircraft
    await source.aclose()


async def test_local_remembers_the_working_path():
    calls: list[str] = []
    source = LocalSource(
        "receiver.local", client=local_client(on_request=lambda r: calls.append(str(r.url)))
    )
    await source.fetch(*DUBLIN, 60)
    before = len(calls)
    await source.fetch(*DUBLIN, 60)
    # Second poll is a single request, not another four-way probe.
    assert len(calls) - before == 1
    await source.aclose()


async def test_local_filters_by_radius():
    source = LocalSource("receiver.local", client=local_client())
    near = await source.fetch(*DUBLIN, 5)
    far = await source.fetch(*DUBLIN, 200)
    assert len(near) < len(far)
    await source.aclose()


async def test_local_drops_the_ground_aircraft_altitude_but_keeps_the_aircraft():
    source = LocalSource("receiver.local", client=local_client())
    aircraft = await source.fetch(*DUBLIN, 200)
    grounded = [ac for ac in aircraft if ac.on_ground]
    assert grounded and grounded[0].alt_baro_ft is None
    await source.aclose()


async def test_local_failure_carries_an_actionable_hint_not_a_traceback():
    source = LocalSource("receiver.local", client=local_client("dump1090_no_data"))
    with pytest.raises(SourceError) as exc_info:
        await source.fetch(*DUBLIN, 60)
    message = str(exc_info.value)
    assert "no aircraft.json found" in message
    assert "web interface" in message  # the hint, not a stack trace
    assert not source.healthy
    await source.aclose()


async def test_local_with_explicit_path_does_not_probe():
    calls: list[str] = []
    source = LocalSource(
        "receiver.local",
        path="http://{host}:8080/tar1090/data/aircraft.json",
        client=local_client(on_request=lambda r: calls.append(str(r.url))),
    )
    await source.fetch(*DUBLIN, 60)
    assert calls == ["http://receiver.local:8080/tar1090/data/aircraft.json"]
    await source.aclose()


# ------------------------------------------------------------------- aggregator


def aggregator(transport: httpx.MockTransport, **kwargs) -> AggregatorSource:
    client = HttpClient(
        timeout_s=1.0,
        retry=RetryPolicy(attempts=kwargs.pop("attempts", 2), base_delay_s=0.0, jitter=False),
        limiter=kwargs.pop("limiter", None),
        transport=transport,
    )
    return AggregatorSource("https://opendata.adsb.fi/api", client=client, **kwargs)


async def test_aggregator_parses_the_v2_ac_array_and_drops_stale_entries():
    source = aggregator(cassette("aggregator"))
    aircraft = await source.fetch(*DUBLIN, 30)
    assert {ac.hex for ac in aircraft} == {"4ca7b5", "406a2f"}  # the seen_pos=120 one is gone
    assert source.healthy
    await source.aclose()


async def test_aggregator_builds_the_documented_endpoint_shape():
    seen: list[str] = []
    source = aggregator(cassette("aggregator", on_request=lambda r: seen.append(str(r.url))))
    await source.fetch(*DUBLIN, 30)
    assert seen == ["https://opendata.adsb.fi/api/v2/lat/53.3498/lon/-6.2603/dist/30"]
    await source.aclose()


async def test_aggregator_clamps_the_radius_to_the_documented_250nm_maximum():
    seen: list[str] = []
    source = aggregator(cassette("aggregator", on_request=lambda r: seen.append(str(r.url))))
    with pytest.raises(SourceError):
        await source.fetch(*DUBLIN, 9000)
    assert seen[0].endswith("/dist/250")
    await source.aclose()


async def test_aggregator_serves_the_last_good_response_rather_than_blanking():
    ok = httpx.Response(200, json={"ac": [{"hex": "4ca7b5", "lat": 53.4, "lon": -6.3}]})
    source = aggregator(
        sequence_transport([ok, httpx.Response(500, json={})]), attempts=1
    )
    first = await source.fetch(*DUBLIN, 30)
    second = await source.fetch(*DUBLIN, 30)
    assert [ac.hex for ac in second] == [ac.hex for ac in first]
    assert source.serving_stale
    await source.aclose()


async def test_aggregator_backs_off_on_429_then_succeeds():
    attempts = httpx.Response(429, json={}, headers={"Retry-After": "0"})
    ok = httpx.Response(200, json={"ac": [{"hex": "abc123", "lat": 53.4, "lon": -6.3}]})
    source = aggregator(sequence_transport([attempts, ok]), attempts=3)
    aircraft = await source.fetch(*DUBLIN, 30)
    assert [ac.hex for ac in aircraft] == ["abc123"]
    await source.aclose()


async def test_aggregator_rate_limit_hint_names_the_problem():
    source = aggregator(sequence_transport([httpx.Response(429, json={})]), attempts=1)
    with pytest.raises(SourceError) as exc_info:
        await source.fetch(*DUBLIN, 30)
    assert "rate limited" in str(exc_info.value)
    await source.aclose()


async def test_token_bucket_paces_requests_to_one_per_second():
    import asyncio

    bucket = TokenBucket(rate=1.0, capacity=1.0)
    loop = asyncio.get_running_loop()
    await bucket.acquire()  # consumes the burst token
    start = loop.time()
    await bucket.acquire()
    assert loop.time() - start >= 0.9


# ------------------------------------------------------------------------- mock


async def test_mock_replays_a_named_fixture(fixture_dir):
    source = MockSource(fixture_dir)
    source.select("single_distant")
    aircraft = await source.fetch(*DUBLIN, 200)
    assert len(aircraft) == 1 and aircraft[0].callsign == "DLH991"


async def test_mock_empty_sky_fixture_is_genuinely_empty(fixture_dir):
    source = MockSource(fixture_dir)
    source.select("empty_sky")
    assert await source.fetch(*DUBLIN, 200) == []


async def test_mock_covers_every_scenario_the_spec_requires(fixture_dir):
    source = MockSource(fixture_dir)
    assert {"dublin_approach", "single_distant", "empty_sky", "military", "helicopter",
            "no_route"} <= set(source.fixtures)


async def test_mock_hands_out_copies_so_callers_cannot_corrupt_the_fixture(fixture_dir):
    source = MockSource(fixture_dir)
    source.select("single_distant")
    first = await source.fetch(*DUBLIN, 200)
    first[0].distance_nm = 999.0
    second = await source.fetch(*DUBLIN, 200)
    assert second[0].distance_nm is None


async def test_mock_rejects_an_unknown_fixture_name(fixture_dir):
    source = MockSource(fixture_dir)
    with pytest.raises(SourceError):
        source.select("nope")


# ---------------------------------------------------------------------- manager


class FlakySource:
    name = "flaky"

    def __init__(self, *, fail: bool) -> None:
        self.fail = fail
        self.calls = 0
        self.healthy = not fail

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        self.calls += 1
        if self.fail:
            raise SourceError("receiver down", hint="check the antenna")
        return [Aircraft(hex="ok", lat=lat, lon=lon)]

    async def aclose(self) -> None:
        return None


async def test_manager_reports_which_feed_served_the_frame(config):
    manager = SourceManager(config)
    await manager.fetch(*DUBLIN, 50)
    assert manager.active == "mock"
    await manager.aclose()


async def test_manager_fails_over_from_local_to_aggregator():
    config = Config(source=SourceConfig(mode="local", failover=True))
    local, agg = FlakySource(fail=True), FlakySource(fail=False)
    manager = SourceManager(config, sources={"local": local, "aggregator": agg})

    aircraft = await manager.fetch(*DUBLIN, 50)
    assert aircraft and manager.active == "aggregator"
    assert agg.calls == 1

    # Once failed over it stays there rather than re-trying local every second.
    await manager.fetch(*DUBLIN, 50)
    assert local.calls == 1 and agg.calls == 2
    await manager.aclose()


async def test_manager_does_not_fail_over_when_disabled():
    config = Config(source=SourceConfig(mode="local", failover=False))
    manager = SourceManager(
        config, sources={"local": FlakySource(fail=True), "aggregator": FlakySource(fail=False)}
    )
    with pytest.raises(SourceError):
        await manager.fetch(*DUBLIN, 50)
    assert manager.active == "none"
    await manager.aclose()


async def test_manager_attributes_the_aggregator_when_it_is_serving():
    config = Config(source=SourceConfig(mode="aggregator", aggregator_provider="adsb_lol"))
    manager = SourceManager(config, sources={"aggregator": FlakySource(fail=False)})
    await manager.fetch(*DUBLIN, 50)
    attribution = manager.attribution()
    assert attribution is not None and "ODbL" in attribution
    await manager.aclose()


async def test_manager_gives_no_attribution_for_a_local_receiver():
    config = Config(source=SourceConfig(mode="local", failover=False))
    manager = SourceManager(config, sources={"local": FlakySource(fail=False)})
    await manager.fetch(*DUBLIN, 50)
    assert manager.attribution() is None
    await manager.aclose()


async def test_manager_surfaces_the_last_error_for_diagnostics():
    config = Config(source=SourceConfig(mode="local", failover=True))
    manager = SourceManager(
        config, sources={"local": FlakySource(fail=True), "aggregator": FlakySource(fail=False)}
    )
    await manager.fetch(*DUBLIN, 50)
    assert manager.last_error is not None and "check the antenna" in manager.last_error
    await manager.aclose()


def test_unknown_aggregator_provider_is_rejected_with_the_valid_list():
    config = Config(source=SourceConfig(aggregator_provider="not_a_provider"))
    with pytest.raises(ValueError, match="adsb_fi"):
        config.aggregator_base()
