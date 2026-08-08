"""The thing that actually runs: poll, enrich, select, build a frame.

Everything above this is a library; this is the object with a lifetime.  It
owns the source manager, the enrichment service, the settings file, the history
store and whatever tracking session is active, and it exposes exactly one
interesting method -- :meth:`current_frame` -- which the API and the device
both go through.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import UTC, datetime
from typing import Any

from .airports import AirportRegistry
from .colours import AirlineRegistry
from .enrich.adsbdb import AdsbdbClient
from .enrich.aeroapi import AeroApiClient
from .enrich.cache import CacheTTLs, EnrichmentCache
from .enrich.service import EnrichmentService
from .frame import build_frame, passes_filters, status_for_age
from .geo import within_radius
from .history import History
from .models import (
    Aircraft,
    DisplayFrame,
    EnrichedAircraft,
    FrameMode,
    FrameStatus,
    Progress,
)
from .settings import AppConfig, Settings
from .sources.base import SourceError
from .sources.manager import SourceManager
from .tracking import TrackingSession, compute_progress
from .units import radius_mi_to_nm

log = logging.getLogger(__name__)

#: How often to see whether a failed-over primary has come back.
RECHECK_INTERVAL_S = 120.0


class SkyPanelService:
    """Owns the poll loop and answers every API question about state."""

    def __init__(
        self,
        config: AppConfig | None = None,
        *,
        manager: SourceManager | None = None,
        enrichment: EnrichmentService | None = None,
        settings: Settings | None = None,
        history: History | None = None,
        airlines: AirlineRegistry | None = None,
        airports: AirportRegistry | None = None,
    ) -> None:
        self.config = config or AppConfig()
        self.settings = (
            settings if settings is not None else Settings.load(self.config.settings_file())
        )
        self.airlines = airlines if airlines is not None else _load_airlines()
        self.airports = airports if airports is not None else _load_airports()

        self.manager = manager or SourceManager(self.config.source)
        self.enrichment = enrichment or _build_enrichment(self.config, self.airlines, self.airports)
        self.history = history if history is not None else History(self.config.history_file())

        self.tracking: TrackingSession | None = None
        self.last_success_monotonic: float | None = None
        self.last_error: str | None = None
        self.last_aircraft: list[Aircraft] = []
        self.last_enriched: EnrichedAircraft | None = None
        self.frames_served = 0
        self._recheck_at = 0.0
        self._lock = asyncio.Lock()

    # -- lifecycle -------------------------------------------------------

    async def start(self) -> None:
        rows = self.enrichment.cache.warm()
        log.info("warmed enrichment cache with %d rows", rows)

    async def aclose(self) -> None:
        await self.manager.aclose()
        await self.enrichment.aclose()
        self.enrichment.cache.close()
        self.history.close()

    # -- polling ---------------------------------------------------------

    async def poll(self) -> list[Aircraft]:
        """Fetch from the active source, remembering the last good result."""
        radius_nm = radius_mi_to_nm(self.settings.scan_radius_mi)
        now = time.monotonic()
        if now >= self._recheck_at:
            self._recheck_at = now + RECHECK_INTERVAL_S
            await self.manager.recheck_primary(
                self.settings.home_lat, self.settings.home_lon, radius_nm
            )

        try:
            aircraft = await self.manager.fetch(
                self.settings.home_lat, self.settings.home_lon, radius_nm
            )
        except SourceError as exc:
            self.last_error = exc.diagnostic()
            raise

        self.last_error = None
        self.last_success_monotonic = time.monotonic()
        self.last_aircraft = aircraft
        return aircraft

    # -- frame construction ----------------------------------------------

    async def current_frame(self, *, now: datetime | None = None) -> DisplayFrame:
        """Poll, select a target, enrich it and render the semantic frame.

        Serialised with a lock so several device polls arriving at once cost
        one upstream fetch, not three.
        """
        async with self._lock:
            return await self._build(now or datetime.now(UTC))

    async def _build(self, now: datetime) -> DisplayFrame:
        self.frames_served += 1
        try:
            aircraft = await self.poll()
        except SourceError as exc:
            return DisplayFrame.error(_short_error(str(exc)), source=self.manager.active_name)

        status = self._status()
        if self.tracking is not None:
            frame = await self._tracking_frame(aircraft, now, status)
            if frame is not None:
                return frame

        candidate = await self._select_nearest(aircraft)
        self.last_enriched = candidate
        if candidate is not None:
            self.history.record(candidate)

        return build_frame(
            candidate,
            self.settings,
            source=self.manager.active_name,
            status=status,
            airports=self.airports,
            airlines=self.airlines,
            now=now,
        )

    async def _select_nearest(self, aircraft: list[Aircraft]) -> EnrichedAircraft | None:
        """Nearest target that passes the user's filters.

        Enrichment is per-candidate and lazy: we walk outward from the closest
        aircraft and stop at the first one the filters accept, so a sky full of
        GA traffic costs one lookup, not fifty.
        """
        in_range = within_radius(
            aircraft, self.settings.home_lat, self.settings.home_lon, self.settings.scan_radius_mi
        )
        for candidate, _distance in in_range:
            enriched = await self.enrichment.enrich(
                candidate,
                home_lat=self.settings.home_lat,
                home_lon=self.settings.home_lon,
            )
            if passes_filters(enriched, self.settings):
                return enriched
        return None

    async def _tracking_frame(
        self, aircraft: list[Aircraft], now: datetime, status: FrameStatus
    ) -> DisplayFrame | None:
        """Frame for the tracked flight, or ``None`` to fall back to nearest."""
        session = self.tracking
        assert session is not None

        match = next((ac for ac in aircraft if session.matches(ac, self.airlines)), None)
        if match is not None and match.has_position():
            enriched = await self.enrichment.enrich(
                match,
                home_lat=self.settings.home_lat,
                home_lon=self.settings.home_lon,
            )
            session.observe(enriched, now)
            self.last_enriched = enriched
            self.history.record(enriched)
            progress = compute_progress(session, enriched, self.airports, now=now)
            return build_frame(
                enriched,
                self.settings,
                source=self.manager.active_name,
                status=status,
                airports=self.airports,
                airlines=self.airlines,
                mode=FrameMode.TRACKING,
                progress=progress,
                now=now,
            )

        reason = session.should_end(now)
        if reason is not None:
            log.info("tracking of %s ended: %s", session.ident, reason)
            session.ended_reason = reason
            self.tracking = None
            return None

        #  Acquired before but out of range right now: hold the mode and say so
        #  rather than snapping back to a different aircraft mid-flight.
        return DisplayFrame(
            mode=FrameMode.TRACKING,
            source=self.manager.active_name,
            status=FrameStatus.STALE,
            generated_at=now,
            lines=[
                _searching_title(session),
                _searching_detail(session),
            ],
            progress=Progress(fraction=0.0) if session.acquired else None,
        )

    def _status(self) -> FrameStatus:
        if self.last_success_monotonic is None:
            return FrameStatus.OFFLINE
        age = time.monotonic() - self.last_success_monotonic
        return status_for_age(age, source_healthy=self.manager.last_error is None)

    # -- commands --------------------------------------------------------

    def start_tracking(self, ident: str, *, now: datetime | None = None) -> TrackingSession:
        session = TrackingSession(ident=ident.strip().upper(), started_at=now or datetime.now(UTC))
        self.tracking = session
        log.info("tracking %s", session.ident)
        return session

    def cancel_tracking(self) -> bool:
        if self.tracking is None:
            return False
        self.tracking.ended_reason = "cancelled"
        self.tracking = None
        return True

    def update_settings(self, updates: dict[str, Any]) -> Settings:
        self.settings = self.settings.merged(updates)
        self.settings.save(self.config.settings_file())
        return self.settings

    # -- introspection ---------------------------------------------------

    def health(self) -> dict[str, Any]:
        age = (
            time.monotonic() - self.last_success_monotonic
            if self.last_success_monotonic is not None
            else None
        )
        aeroapi = self.enrichment.aeroapi
        return {
            "ok": self.last_error is None and self.last_success_monotonic is not None,
            "active_source": self.manager.active_name,
            "sources": [
                {"name": s.name, "healthy": s.healthy, "active": s.active, "detail": s.detail}
                for s in self.manager.statuses()
            ],
            "last_poll_age_s": round(age, 1) if age is not None else None,
            "last_error": self.last_error,
            "frames_served": self.frames_served,
            "aircraft_in_view": len(self.last_aircraft),
            "cache": self.enrichment.cache.stats.to_json(),
            "enrichment": self.enrichment.stats.to_json(),
            "aeroapi_quota": aeroapi.quota_json() if aeroapi else None,
            "tracking": self.tracking.to_json() if self.tracking else None,
            "attribution": self.attribution(),
        }

    def attribution(self) -> str | None:
        """Provider credit for whichever source served the current frame.

        Only the aggregators carry one -- adsb.fi and adsb.lol both require it,
        and your own receiver requires nothing of you.
        """
        credit = getattr(self.manager.active, "attribution", None)
        return credit if isinstance(credit, str) and credit else None


def _searching_title(session: TrackingSession) -> Any:
    from .models import FrameLine, LineStyle, ScrollMode

    return FrameLine(
        text=session.ident,
        colour="#FFB000",
        style=LineStyle.TITLE,
        scroll=ScrollMode.AUTO,
    )


def _searching_detail(session: TrackingSession) -> Any:
    from .models import FrameLine, LineStyle

    text = "SEARCHING..." if not session.acquired else "OUT OF RANGE"
    return FrameLine(text=text, colour="#806000", style=LineStyle.BODY)


def _short_error(message: str) -> str:
    """Trim a diagnostic down to something that fits on a 64 px panel."""
    first = message.strip().splitlines()[0]
    return first[:40].upper() if first else "SOURCE ERROR"


def _load_airlines() -> AirlineRegistry:
    try:
        return AirlineRegistry.load()
    except (OSError, ValueError) as exc:
        log.warning("could not load airlines.json (%s); everything renders white", exc)
        return AirlineRegistry({})


def _load_airports() -> AirportRegistry:
    try:
        return AirportRegistry.load()
    except (OSError, ValueError) as exc:
        log.warning("could not load airports.csv (%s); routes show codes only", exc)
        return AirportRegistry([])


def _build_enrichment(
    config: AppConfig, airlines: AirlineRegistry, airports: AirportRegistry
) -> EnrichmentService:
    cache = EnrichmentCache(
        config.cache_file(),
        ttls=CacheTTLs(
            route_s=config.enrich.route_ttl_s,
            aircraft_s=config.enrich.aircraft_ttl_s,
            negative_s=config.enrich.negative_ttl_s,
        ),
    )
    adsbdb = AdsbdbClient(config.enrich.adsbdb_base_url) if config.enrich.adsbdb_enabled else None

    aeroapi: AeroApiClient | None = None
    api_key = os.environ.get("AEROAPI_KEY", "").strip()
    if config.enrich.aeroapi_enabled and api_key:
        aeroapi = AeroApiClient(
            api_key,
            cache,
            base_url=config.enrich.aeroapi_base_url,
            monthly_limit=config.enrich.aeroapi_monthly_limit,
        )
    elif config.enrich.aeroapi_enabled:
        log.warning("aeroapi_enabled is true but AEROAPI_KEY is unset; staying on adsbdb")

    return EnrichmentService(
        cache, adsbdb=adsbdb, aeroapi=aeroapi, airlines=airlines, airports=airports
    )
