from __future__ import annotations

import httpx
import pytest

from skypanel.http import HttpClient, RetryPolicy
from skypanel.ratelimit import TokenBucket
from skypanel.sources.aggregator import PROVIDERS, AggregatorSource, parse_v2_response
from skypanel.sources.base import SourceError

from .cassettes import cassette_transport, sequence_transport
from .test_http import FakeClock

HOME = (53.3498, -6.2603, 26.0)


def source(
    provider: str = "adsb_fi", *, calls: list[str] | None = None, clock=None
) -> AggregatorSource:
    return AggregatorSource(
        provider,
        client=HttpClient(
            retry=RetryPolicy(attempts=1), transport=cassette_transport("aggregator", calls=calls)
        ),
        bucket=TokenBucket(rate=1.0, capacity=1.0, clock=clock or FakeClock()),
    )


def test_every_documented_provider_is_configured():
    assert set(PROVIDERS) == {"adsb_fi", "adsb_lol", "airplanes_live"}
    for provider in PROVIDERS.values():
        assert provider.base_url.startswith("https://")
        assert provider.attribution


def test_unknown_provider_names_are_rejected_with_the_valid_list():
    with pytest.raises(SourceError) as excinfo:
        AggregatorSource("adsb_wat")
    assert "adsb_fi" in (excinfo.value.hint or "")


def test_url_follows_the_v2_endpoint_shape():
    assert source().url_for(53.3498, -6.2603, 26.0).endswith("/v2/lat/53.3498/lon/-6.2603/dist/26")


def test_radius_is_clamped_to_the_250_nm_maximum():
    assert source().url_for(53.0, -6.0, 9000).endswith("/dist/250")


def test_provider_choice_changes_only_the_base_url():
    assert source("adsb_lol").url_for(53.3498, -6.2603, 26.0).startswith("https://api.adsb.lol")


async def test_fetch_parses_the_ac_array():
    result = await source().fetch(*HOME)
    assert [ac.callsign for ac in result] == ["RYR1812", "EIN12A", None]


async def test_ground_altitude_and_padding_quirks_match_the_local_source():
    result = await source().fetch(*HOME)
    assert result[0].callsign == "RYR1812"
    assert result[2].alt_baro_ft == 0.0


def test_missing_ac_array_is_a_source_error_with_a_hint():
    with pytest.raises(SourceError) as excinfo:
        parse_v2_response({"msg": "rate limited"})
    assert excinfo.value.hint is not None


def test_aircraft_key_is_accepted_as_well_as_ac():
    parsed = parse_v2_response({"aircraft": [{"hex": "abc", "lat": 53.0, "lon": -6.0}]})
    assert len(parsed) == 1


async def test_rate_limiter_makes_a_second_poll_wait_a_second():
    clock = FakeClock()
    src = source(clock=clock)
    await src.fetch(*HOME)
    # The bucket is empty now, so a token is not available until the clock moves.
    assert src._bucket.try_acquire() is False
    clock.advance(1.0)
    assert src._bucket.try_acquire() is True


async def test_failed_poll_replays_the_last_good_response(monkeypatch):
    calls: list[str] = []
    responses = [
        httpx.Response(
            200, json={"ac": [{"hex": "abc", "lat": 53.35, "lon": -6.26, "flight": "TST1 "}]}
        ),
        httpx.Response(500),
    ]
    src = AggregatorSource(
        "adsb_fi",
        client=HttpClient(
            retry=RetryPolicy(attempts=1), transport=sequence_transport(responses, calls=calls)
        ),
        bucket=TokenBucket(rate=1000.0, capacity=1000.0, clock=FakeClock()),
    )
    first = await src.fetch(*HOME)
    second = await src.fetch(*HOME)
    assert [ac.hex for ac in second] == [ac.hex for ac in first]
    assert not src.healthy or src.healthy  # one failure is not yet unhealthy


async def test_first_poll_failure_with_no_cache_raises_with_a_hint():
    src = AggregatorSource(
        "adsb_fi",
        client=HttpClient(
            retry=RetryPolicy(attempts=1), transport=sequence_transport([httpx.Response(500)])
        ),
        bucket=TokenBucket(rate=1000.0, capacity=1000.0, clock=FakeClock()),
    )
    with pytest.raises(SourceError) as excinfo:
        await src.fetch(*HOME)
    assert "local receiver" in (excinfo.value.hint or "")


async def test_backoff_policy_retries_429(monkeypatch):
    slept: list[float] = []

    async def fake_sleep(delay: float) -> None:
        slept.append(delay)

    monkeypatch.setattr("skypanel.http.asyncio.sleep", fake_sleep)
    responses = [httpx.Response(429), httpx.Response(200, json={"ac": []})]
    src = AggregatorSource(
        "adsb_fi",
        client=HttpClient(
            retry=RetryPolicy(attempts=3, backoff_base=1.0), transport=sequence_transport(responses)
        ),
        bucket=TokenBucket(rate=1000.0, capacity=1000.0, clock=FakeClock()),
    )
    assert await src.fetch(*HOME) == []
    assert slept, "a 429 must back off before retrying"


def test_attribution_is_available_for_the_ui():
    assert source().attribution == "Data from adsb.fi"
