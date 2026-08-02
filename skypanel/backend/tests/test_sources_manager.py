from __future__ import annotations

import pytest

from skypanel.models import Aircraft
from skypanel.settings import SourceConfig
from skypanel.sources.base import SourceError
from skypanel.sources.manager import SourceManager
from skypanel.sources.mock import MockSource

from .test_http import FakeClock


class FakeSource:
    """A source whose failures the test controls exactly."""

    def __init__(self, name: str, *, fails: bool = False) -> None:
        self.name = name
        self.fails = fails
        self.calls = 0
        self.last_error: str | None = None

    @property
    def healthy(self) -> bool:
        return not self.fails

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        self.calls += 1
        if self.fails:
            self.last_error = "boom"
            raise SourceError(f"{self.name} is down", hint="check the decoder")
        return [Aircraft(hex="abc123", lat=lat, lon=lon)]

    async def aclose(self) -> None:
        return None


def manager(mode: str, *, failover: bool = True, clock=None, primary=None, fallback=None):
    return SourceManager(
        SourceConfig(mode=mode, failover=failover, failover_after_s=60.0),
        clock=clock or FakeClock(),
        primary=primary or FakeSource("local"),
        fallback=fallback if fallback is not None else FakeSource("aggregator"),
    )


async def test_healthy_primary_is_used_and_reported():
    mgr = manager("local")
    await mgr.fetch(53.0, -6.0, 26.0)
    assert mgr.active_name == "local"


async def test_local_does_not_fail_over_before_the_grace_period():
    clock = FakeClock()
    mgr = manager("local", clock=clock, primary=FakeSource("local", fails=True))
    with pytest.raises(SourceError):
        await mgr.fetch(53.0, -6.0, 26.0)
    assert mgr.active_name == "local"


async def test_local_fails_over_after_sixty_seconds_unhealthy():
    clock = FakeClock()
    primary = FakeSource("local", fails=True)
    mgr = manager("local", clock=clock, primary=primary)
    with pytest.raises(SourceError):
        await mgr.fetch(53.0, -6.0, 26.0)
    clock.advance(61.0)
    result = await mgr.fetch(53.0, -6.0, 26.0)
    assert mgr.active_name == "aggregator"
    assert result


async def test_failover_disabled_means_the_error_propagates_forever():
    clock = FakeClock()
    mgr = manager(
        "local", failover=False, clock=clock, primary=FakeSource("local", fails=True), fallback=None
    )
    clock.advance(600.0)
    with pytest.raises(SourceError):
        await mgr.fetch(53.0, -6.0, 26.0)
    assert mgr.active_name == "local"


async def test_auto_mode_falls_back_on_the_very_first_failed_probe():
    mgr = manager("auto", primary=FakeSource("local", fails=True))
    result = await mgr.fetch(53.0, -6.0, 26.0)
    assert mgr.active_name == "aggregator"
    assert result


async def test_auto_mode_stays_on_the_fallback_until_the_primary_recovers():
    primary = FakeSource("local", fails=True)
    mgr = manager("auto", primary=primary)
    await mgr.fetch(53.0, -6.0, 26.0)
    await mgr.fetch(53.0, -6.0, 26.0)
    assert mgr.active_name == "aggregator"

    primary.fails = False
    assert await mgr.recheck_primary(53.0, -6.0, 26.0) is True
    assert mgr.active_name == "local"


async def test_recheck_is_a_no_op_when_not_failed_over():
    mgr = manager("local")
    assert await mgr.recheck_primary(53.0, -6.0, 26.0) is True
    assert mgr.active_name == "local"


async def test_recheck_reports_failure_without_switching_back():
    mgr = manager("auto", primary=FakeSource("local", fails=True))
    await mgr.fetch(53.0, -6.0, 26.0)
    assert await mgr.recheck_primary(53.0, -6.0, 26.0) is False
    assert mgr.active_name == "aggregator"


async def test_statuses_expose_which_source_served_the_frame():
    mgr = manager("local")
    await mgr.fetch(53.0, -6.0, 26.0)
    statuses = {s.name: s for s in mgr.statuses()}
    assert statuses["local"].active is True
    assert statuses["aggregator (fallback)"].active is False


async def test_mock_mode_has_no_fallback_configured():
    mgr = SourceManager(SourceConfig(mode="mock"), primary=MockSource(speed=0.0), fallback=None)
    assert mgr.fallback is None
    assert await mgr.fetch(53.3498, -6.2603, 26.0)


def test_unknown_mode_is_rejected():
    with pytest.raises(SourceError):
        SourceManager(SourceConfig(mode="telepathy"))
