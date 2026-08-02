from __future__ import annotations

import httpx
import pytest

from skypanel.http import USER_AGENT, HttpClient, HttpError, RetryPolicy
from skypanel.ratelimit import TokenBucket

from .cassettes import sequence_transport


class FakeClock:
    """A monotonic clock the test drives by hand."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture(autouse=True)
def no_real_sleeping(monkeypatch):
    """Retry backoff must be exercised without actually waiting."""
    slept: list[float] = []

    async def fake_sleep(delay: float) -> None:
        slept.append(delay)

    monkeypatch.setattr("skypanel.http.asyncio.sleep", fake_sleep)
    return slept


async def test_user_agent_identifies_the_project():
    assert "SkyPanel" in USER_AGENT
    assert "http" in USER_AGENT


async def test_successful_get_returns_decoded_json():
    transport = sequence_transport([httpx.Response(200, json={"ok": True})])
    async with HttpClient(transport=transport) as client:
        assert await client.get_json("https://example.invalid/x") == {"ok": True}


async def test_retries_on_500_then_succeeds(no_real_sleeping):
    transport = sequence_transport([httpx.Response(503), httpx.Response(200, json={"ok": True})])
    async with HttpClient(transport=transport, retry=RetryPolicy(attempts=3)) as client:
        assert await client.get_json("https://example.invalid/x") == {"ok": True}
    assert no_real_sleeping, "a retry should have backed off before trying again"


async def test_gives_up_after_the_configured_attempts():
    calls: list[str] = []
    transport = sequence_transport([httpx.Response(503)], calls=calls)
    async with HttpClient(transport=transport, retry=RetryPolicy(attempts=2)) as client:
        with pytest.raises(HttpError) as excinfo:
            await client.get_json("https://example.invalid/x")
    assert len(calls) == 2
    assert "2 attempts" in str(excinfo.value)


async def test_client_errors_are_not_retried():
    calls: list[str] = []
    transport = sequence_transport([httpx.Response(404)], calls=calls)
    async with HttpClient(transport=transport, retry=RetryPolicy(attempts=3)) as client:
        with pytest.raises(HttpError) as excinfo:
            await client.get_json("https://example.invalid/x")
    assert len(calls) == 1
    assert excinfo.value.status == 404


async def test_retry_after_header_is_honoured(no_real_sleeping):
    transport = sequence_transport(
        [httpx.Response(429, headers={"Retry-After": "3"}), httpx.Response(200, json={})]
    )
    async with HttpClient(transport=transport, retry=RetryPolicy(attempts=3)) as client:
        await client.get_json("https://example.invalid/x")
    assert 3.0 in no_real_sleeping


async def test_non_json_body_raises_a_readable_error():
    transport = sequence_transport([httpx.Response(200, text="<html>nope</html>")])
    async with HttpClient(transport=transport) as client:
        with pytest.raises(HttpError) as excinfo:
            await client.get_json("https://example.invalid/x")
    assert "not JSON" in str(excinfo.value)


def test_backoff_doubles_and_is_capped():
    policy = RetryPolicy(backoff_base=1.0, backoff_max=4.0)
    assert [policy.delay_for(i) for i in range(5)] == [1.0, 2.0, 4.0, 4.0, 4.0]


# -- token bucket -------------------------------------------------------


def test_bucket_starts_full():
    bucket = TokenBucket(rate=1.0, capacity=1.0, clock=FakeClock())
    assert bucket.try_acquire() is True


def test_bucket_refuses_a_second_token_immediately():
    bucket = TokenBucket(rate=1.0, capacity=1.0, clock=FakeClock())
    assert bucket.try_acquire() is True
    assert bucket.try_acquire() is False


def test_bucket_refills_at_the_configured_rate():
    clock = FakeClock()
    bucket = TokenBucket(rate=1.0, capacity=1.0, clock=clock)
    bucket.try_acquire()
    clock.advance(0.5)
    assert bucket.try_acquire() is False
    clock.advance(0.5)
    assert bucket.try_acquire() is True


def test_bucket_never_exceeds_capacity():
    clock = FakeClock()
    bucket = TokenBucket(rate=1.0, capacity=1.0, clock=clock)
    clock.advance(100.0)
    assert bucket.tokens == 1.0


def test_bucket_rejects_a_non_positive_rate():
    with pytest.raises(ValueError):
        TokenBucket(rate=0.0)
