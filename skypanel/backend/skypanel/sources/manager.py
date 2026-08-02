"""Picks which feed serves each poll, and fails over when one goes quiet.

`auto` probes local at startup and falls back permanently unless it recovers; explicit
`local` with `failover = true` behaves the same way once local has been unhealthy for
`failover_after_s`. Whichever feed produced the current data is always reported, because
the licence terms of the aggregators require attribution and because "why is it wrong"
usually starts with "which feed was that".
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from ..config import Config
from ..models import Aircraft
from .aggregator import AggregatorSource
from .base import AircraftSource, SourceError
from .local import LocalSource
from .mock import MockSource

log = logging.getLogger(__name__)


@dataclass(slots=True)
class SourceStatus:
    name: str
    healthy: bool
    detail: str | None = None
    attribution: str | None = None


class SourceManager:
    """Owns the configured sources and routes each fetch to the right one."""

    def __init__(self, config: Config, *, sources: dict[str, AircraftSource] | None = None) -> None:
        self.config = config
        self._sources: dict[str, AircraftSource] = sources or {}
        self._active: str = "none"
        self._unhealthy_since: float | None = None
        self._failed_over = False
        self._last_error: str | None = None

    # ------------------------------------------------------------------ wiring

    def _build(self, kind: str) -> AircraftSource:
        cfg = self.config.source
        if kind == "local":
            return LocalSource(cfg.local_host, path=cfg.local_path)
        if kind == "aggregator":
            return AggregatorSource(self.config.aggregator_base(), provider=cfg.aggregator_provider)
        if kind == "mock":
            return MockSource(cfg.mock_fixture_dir, speed=cfg.mock_speed)
        raise ValueError(f"unknown source kind {kind!r}")

    def source(self, kind: str) -> AircraftSource:
        if kind not in self._sources:
            self._sources[kind] = self._build(kind)
        return self._sources[kind]

    # ------------------------------------------------------------------ policy

    def _preferred(self) -> str:
        mode = self.config.source.mode
        if mode in ("mock", "aggregator"):
            return mode
        if mode == "auto":
            return "aggregator" if self._failed_over else "local"
        # mode == "local"
        if self._failed_over and self.config.source.failover:
            return "aggregator"
        return "local"

    def _note_failure(self, kind: str, error: Exception) -> None:
        self._last_error = str(error)
        if kind != "local":
            return
        now = time.monotonic()
        if self._unhealthy_since is None:
            self._unhealthy_since = now
        elapsed = now - self._unhealthy_since
        allow_failover = self.config.source.failover or self.config.source.mode == "auto"
        if allow_failover and elapsed >= self.config.source.failover_after_s:
            if not self._failed_over:
                log.warning(
                    "local source unhealthy for %.0fs; failing over to %s",
                    elapsed,
                    self.config.source.aggregator_provider,
                )
            self._failed_over = True

    def _note_success(self, kind: str) -> None:
        self._last_error = None
        if kind == "local":
            self._unhealthy_since = None
            if self._failed_over:
                log.info("local source recovered; switching back")
            self._failed_over = False

    # ------------------------------------------------------------------- fetch

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        """Fetch from the preferred feed, falling back once if it errors.

        On startup in `auto` mode the very first local failure fails over immediately
        rather than waiting out the timer — otherwise a receiver-less install shows an
        empty panel for its first minute.
        """
        kind = self._preferred()
        try:
            aircraft = await self.source(kind).fetch(lat, lon, radius_nm)
        except SourceError as exc:
            self._note_failure(kind, exc)
            fallback = self._fallback_for(kind)
            if fallback is None:
                self._active = "none"
                raise
            log.warning("%s failed (%s); trying %s", kind, exc, fallback)
            try:
                aircraft = await self.source(fallback).fetch(lat, lon, radius_nm)
            except SourceError:
                self._active = "none"
                raise
            self._active = fallback
            self._failed_over = True
            return aircraft
        self._note_success(kind)
        self._active = kind
        return aircraft

    def _fallback_for(self, kind: str) -> str | None:
        if kind != "local":
            return None
        if self.config.source.mode == "auto":
            return "aggregator"
        return "aggregator" if self.config.source.failover else None

    # ------------------------------------------------------------------ status

    @property
    def active(self) -> str:
        """Name of the feed that served the most recent frame."""
        return self._active

    def attribution(self) -> str | None:
        """Provider credit, when the active feed's terms require one."""
        return self.config.attribution() if self._active == "aggregator" else None

    def status(self) -> list[SourceStatus]:
        out: list[SourceStatus] = []
        for kind, source in sorted(self._sources.items()):
            detail = None
            if isinstance(source, LocalSource):
                detail = source.url
            elif isinstance(source, AggregatorSource):
                detail = source.provider
            elif isinstance(source, MockSource):
                detail = source.current_fixture
            out.append(
                SourceStatus(
                    name=kind,
                    healthy=source.healthy,
                    detail=detail,
                    attribution=self.config.attribution() if kind == "aggregator" else None,
                )
            )
        return out

    @property
    def last_error(self) -> str | None:
        return self._last_error

    async def aclose(self) -> None:
        for source in self._sources.values():
            await source.aclose()
        self._sources.clear()
