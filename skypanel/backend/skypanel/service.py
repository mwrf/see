"""The service object: one poll loop, one current frame, everything else hangs off it.

`poll_once()` is the whole cycle — fetch, filter, select, enrich, build — and it is
callable directly, which is how the tests drive it. The background loop exists only to
call it on a timer so the device's poll is always answered from memory.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass
from typing import Any

from . import frame as frame_builder
from .config import Config
from .enrich.cache import Cache
from .enrich.service import Enricher
from .history import History
from .models import Aircraft, Category, DisplayFrame, EnrichedAircraft, FrameStatus
from .settings import Settings, SettingsStore
from .sources import SourceManager
from .sources.base import SourceError
from .tracking import Tracker, TrackingState
from .units import to_nm

log = logging.getLogger(__name__)

#: Frames older than this are marked `stale`; older still and the device shows offline.
STALE_AFTER_S = 20.0
OFFLINE_AFTER_S = 60.0


@dataclass(slots=True)
class PollResult:
    aircraft: list[Aircraft]
    selected: EnrichedAircraft | None
    source: str
    error: str | None = None


class PanelService:
    """Owns the sources, the enrichment cache, tracking state and the current frame."""

    def __init__(
        self,
        config: Config,
        *,
        settings: SettingsStore | None = None,
        sources: SourceManager | None = None,
        enricher: Enricher | None = None,
        cache: Cache | None = None,
        history: History | None = None,
    ) -> None:
        self.config = config
        self.settings_store = settings or SettingsStore(config.settings_path)
        self.cache = cache or Cache(config.cache_path)
        self.sources = sources or SourceManager(config)
        self.enricher = enricher or Enricher(config.enrich, cache=self.cache)
        self.history = history or History(config.history_path)
        self.tracker = Tracker()

        self._frame: DisplayFrame | None = None
        self._last_ok_at: float | None = None
        self._selected: EnrichedAircraft | None = None
        self._tracked: EnrichedAircraft | None = None
        self._last_aircraft: list[Aircraft] = []
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------ config

    @property
    def settings(self) -> Settings:
        return self.settings_store.current

    def radius_nm(self) -> float:
        return to_nm(self.settings.scan_radius, self.settings.distance_unit)

    # ------------------------------------------------------------------- cycle

    async def poll_once(self) -> PollResult:
        """One full fetch → select → enrich → build cycle. Never raises for feed errors."""
        settings = self.settings
        async with self._lock:
            try:
                aircraft = await self.sources.fetch(
                    settings.home_lat, settings.home_lon, self.radius_nm()
                )
            except SourceError as exc:
                self._on_error(exc)
                return PollResult([], None, self.sources.active, str(exc))

            self._last_aircraft = aircraft
            selected, is_tracked = await self._select(aircraft)
            self._selected = selected
            self._last_ok_at = time.monotonic()

            if selected is not None:
                self.history.record(selected)

            self._frame = self._build(selected, is_tracked=is_tracked)
            return PollResult(aircraft, selected, self.sources.active)

    async def _select(self, aircraft: list[Aircraft]) -> tuple[EnrichedAircraft | None, bool]:
        """Pick the aircraft to show: the tracked one if any, otherwise the nearest."""
        settings = self.settings
        from .geo import annotate_distances, nearest  # local import keeps geo dependency-free

        annotate_distances(aircraft, settings.home_lat, settings.home_lon)

        if self.tracker.active:
            match = self.tracker.match(aircraft)
            enriched = await self.enricher.enrich(match) if match is not None else None
            state = self.tracker.update(enriched)
            if state is not None:
                if enriched is not None:
                    self._tracked = enriched
                # Keep the last known position while the flight is briefly out of range,
                # but never fall back to whatever was on screen before: showing a
                # different airline under this flight's progress bar is worse than
                # admitting we haven't found it yet.
                return (self._tracked if state.seen else None), True

        allowed = set(settings.categories)
        candidates = aircraft
        if allowed != set(Category):
            # Classification needs enrichment, which is expensive, so filter cheaply
            # first and only enrich down the sorted list until one passes.
            candidates = sorted(aircraft, key=lambda ac: (ac.distance_nm or 1e9, ac.hex))
            for ac in candidates[:12]:
                enriched = await self.enricher.enrich(ac)
                if enriched.traffic_category in allowed:
                    return enriched, False
            return None, False

        pick = nearest(aircraft, settings.home_lat, settings.home_lon, self.radius_nm())
        if pick is None:
            return None, False
        return await self.enricher.enrich(pick), False

    def _build(self, selected: EnrichedAircraft | None, *, is_tracked: bool) -> DisplayFrame:
        settings = self.settings
        source = self.sources.active
        note = self.sources.attribution()
        status = self._status()

        if is_tracked and self.tracker.state is not None:
            if selected is not None:
                return frame_builder.build_tracking(
                    selected, settings, self.tracker.state, source=source, status=status, note=note
                )
            return frame_builder.build_searching(
                self.tracker.state.ident, settings, source=source, status=status, note=note
            )
        if selected is None:
            return frame_builder.build_empty(settings, source=source, status=status, note=note)
        return frame_builder.build_nearest(
            selected, settings, source=source, status=status, note=note
        )

    def _status(self) -> FrameStatus:
        if self._last_ok_at is None:
            return "offline"
        age = time.monotonic() - self._last_ok_at
        if age > OFFLINE_AFTER_S:
            return "offline"
        if age > STALE_AFTER_S:
            return "stale"
        return "live"

    def _on_error(self, exc: SourceError) -> None:
        log.warning("poll failed: %s", exc)
        status = self._status()
        if status == "offline" or self._frame is None:
            self._frame = frame_builder.build_error(
                str(exc).split(" — ")[0],
                self.settings,
                source=self.sources.active,
                hint=exc.hint,
            )
        else:
            # Keep the last good content but tell the device it is no longer live.
            self._frame = self._frame.model_copy(update={"status": status})

    # -------------------------------------------------------------------- read

    def current_frame(self) -> DisplayFrame:
        """The frame the device should render right now."""
        if self._frame is None:
            return frame_builder.build_empty(
                self.settings, source=self.sources.active, status="offline"
            )
        # Age the status even if no poll has run since the frame was built.
        return self._frame.model_copy(update={"status": self._status()})

    @property
    def selected(self) -> EnrichedAircraft | None:
        return self._selected

    @property
    def last_aircraft(self) -> list[Aircraft]:
        return list(self._last_aircraft)

    # ---------------------------------------------------------------- tracking

    def start_tracking(self, ident: str) -> TrackingState:
        """Begin tracking `ident`, forgetting any aircraft tracked before it."""
        self._tracked = None
        return self.tracker.start(ident)

    def stop_tracking(self) -> None:
        self._tracked = None
        self.tracker.cancel()

    def rebuild(self) -> DisplayFrame:
        """Re-render the current selection, e.g. after a settings change."""
        self._frame = self._build(self._selected, is_tracked=self.tracker.active)
        return self.current_frame()

    def health(self) -> dict[str, Any]:
        stats = self.cache.stats()
        aeroapi = self.enricher.aeroapi
        return {
            "status": self._status(),
            "active_source": self.sources.active,
            "sources": [
                {
                    "name": s.name,
                    "healthy": s.healthy,
                    "detail": s.detail,
                    "attribution": s.attribution,
                }
                for s in self.sources.status()
            ],
            "last_error": self.sources.last_error,
            "aircraft_in_range": len(self._last_aircraft),
            "cache": {
                "entries": stats.entries,
                "negative": stats.negative,
                "expired": stats.expired,
                "hits": stats.hits,
                "misses": stats.misses,
            },
            "aeroapi": (
                {
                    "enabled": True,
                    "used_this_month": aeroapi.queries_this_month(),
                    "monthly_limit": aeroapi.monthly_limit,
                    "remaining": aeroapi.quota_remaining(),
                }
                if aeroapi is not None
                else {"enabled": False}
            ),
            "tracking": (
                {
                    "ident": self.tracker.state.ident,
                    "fraction": self.tracker.state.fraction,
                    "landed": self.tracker.state.landed,
                }
                if self.tracker.state is not None
                else None
            ),
        }

    # --------------------------------------------------------------- lifecycle

    async def start(self) -> None:
        self.cache.warm()
        self.cache.purge_expired()
        self.history.prune()
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="skypanel-poll")

    async def _loop(self) -> None:
        interval = max(0.5, self.config.source.poll_interval_s)
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("unexpected error in poll loop")
            await asyncio.sleep(interval)

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self.sources.aclose()
        await self.enricher.aclose()
        self.cache.close()
        self.history.close()
