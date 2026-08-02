"""Source selection and failover.

The manager owns the ``mode`` semantics from section 3.4 of the spec:

* ``local`` / ``aggregator`` / ``mock`` -- use exactly that source.  With
  ``failover = true``, ``local`` still falls back to the aggregator once the
  receiver has been unhealthy for ``failover_after_s``.
* ``auto`` -- probe local at startup; if it does not answer, fall back to the
  aggregator *permanently* unless local later recovers.

Whichever source served the current frame is always reported, because "which
feed am I actually looking at" is the first question anyone asks when the
numbers look wrong.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from ..models import Aircraft
from ..settings import SourceConfig
from .aggregator import AggregatorSource
from .base import AircraftSource, SourceError
from .local import LocalSource
from .mock import MockSource

log = logging.getLogger(__name__)


@dataclass(slots=True)
class SourceStatus:
    name: str
    healthy: bool
    active: bool
    detail: str | None = None


class SourceManager:
    """Holds the configured sources and decides which one serves each poll."""

    def __init__(
        self,
        config: SourceConfig,
        *,
        clock: Callable[[], float] = time.monotonic,
        primary: AircraftSource | None = None,
        fallback: AircraftSource | None = None,
    ) -> None:
        self.config = config
        self._clock = clock
        self._primary = primary if primary is not None else _build_primary(config)
        self._fallback = fallback if fallback is not None else _build_fallback(config)
        self._active: AircraftSource = self._primary
        self._unhealthy_since: float | None = None
        self._failed_over = False
        self.last_error: str | None = None

    @property
    def active(self) -> AircraftSource:
        """The source that served, or will serve, the current frame."""
        return self._active

    @property
    def active_name(self) -> str:
        return self._active.name

    @property
    def primary(self) -> AircraftSource:
        return self._primary

    @property
    def fallback(self) -> AircraftSource | None:
        return self._fallback

    def statuses(self) -> list[SourceStatus]:
        out = [
            SourceStatus(
                name=self._primary.name,
                healthy=self._primary.healthy,
                active=self._active is self._primary,
                detail=getattr(self._primary, "last_error", None),
            )
        ]
        if self._fallback is not None:
            out.append(
                SourceStatus(
                    name=f"{self._fallback.name} (fallback)",
                    healthy=self._fallback.healthy,
                    active=self._active is self._fallback,
                    detail=getattr(self._fallback, "last_error", None),
                )
            )
        return out

    async def aclose(self) -> None:
        await self._primary.aclose()
        if self._fallback is not None and self._fallback is not self._primary:
            await self._fallback.aclose()

    def _failover_enabled(self) -> bool:
        if self._fallback is None:
            return False
        return self.config.failover or self.config.mode == "auto"

    def _note_failure(self, error: str) -> None:
        self.last_error = error
        if self._unhealthy_since is None:
            self._unhealthy_since = self._clock()

    def _should_fail_over(self) -> bool:
        if not self._failover_enabled() or self._unhealthy_since is None:
            return False
        #  In auto mode the very first failed probe is enough: there is no point
        #  waiting a minute at startup for a receiver that clearly is not there.
        threshold = (
            0.0
            if self.config.mode == "auto" and not self._failed_over
            else self.config.failover_after_s
        )
        return (self._clock() - self._unhealthy_since) >= threshold

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        """Poll the active source, failing over (or recovering) as needed."""
        try:
            aircraft = await self._active.fetch(lat, lon, radius_nm)
        except SourceError as exc:
            detail = exc.diagnostic()
            log.warning("%s source failed: %s", self._active.name, detail)
            self._note_failure(detail)
            if self._active is self._primary and self._should_fail_over():
                assert self._fallback is not None
                log.warning("failing over to %s", self._fallback.name)
                self._active = self._fallback
                self._failed_over = True
                return await self._fetch_fallback(lat, lon, radius_nm)
            raise

        if self._active is self._primary:
            self._unhealthy_since = None
            self.last_error = None
        return aircraft

    async def _fetch_fallback(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        assert self._fallback is not None
        try:
            return await self._fallback.fetch(lat, lon, radius_nm)
        except SourceError as exc:
            self.last_error = exc.diagnostic()
            raise

    async def recheck_primary(self, lat: float, lon: float, radius_nm: float) -> bool:
        """Try the primary again; on success, move back to it.

        Called on a slow timer by the poller so a receiver that comes back from
        a reboot is picked up without restarting the service.
        """
        if not self._failed_over:
            return True
        try:
            await self._primary.fetch(lat, lon, radius_nm)
        except SourceError:
            return False
        log.info("primary source %s recovered", self._primary.name)
        self._active = self._primary
        self._failed_over = False
        self._unhealthy_since = None
        self.last_error = None
        return True


def _build_primary(config: SourceConfig) -> AircraftSource:
    mode = config.mode
    if mode in ("local", "auto"):
        return LocalSource(config.local_host, path=config.local_path)
    if mode == "aggregator":
        return AggregatorSource(config.aggregator_provider)
    if mode == "mock":
        fixtures = Path(config.fixture_dir) if config.fixture_dir else None
        return MockSource(fixtures, speed=config.mock_speed)
    raise SourceError(
        f"unknown source mode {mode!r}", hint="valid modes are: local, aggregator, mock, auto"
    )


def _build_fallback(config: SourceConfig) -> AircraftSource | None:
    if config.mode in ("local", "auto") and (config.failover or config.mode == "auto"):
        return AggregatorSource(config.aggregator_provider)
    return None
