"""The enrichment layer: everything ADS-B does not carry.

Order of operations for a callsign, and why:

1. **Cache** -- SQLite, warmed at startup.  A negative result is cached too, so
   an unmatched military callsign costs one lookup an hour, not one per poll.
2. **adsbdb** -- free and keyless, so it is the default and always tried first.
3. **AeroAPI** -- only when configured, only when the quota guard allows it,
   and only to *improve* a result (scheduled ETA, a route adsbdb lacked).

The service never raises on a provider failure.  A frame with no route is fine;
a frame that never arrives is not.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ..airports import AirportRegistry
from ..colours import AirlineRegistry, ensure_legible, operator_code
from ..geo import bearing_deg, haversine_mi
from ..models import Aircraft, EnrichedAircraft, Route
from .adsbdb import AdsbdbClient
from .aeroapi import AeroApiClient, QuotaExhausted
from .cache import EnrichmentCache
from .categorise import categorise

log = logging.getLogger(__name__)


@dataclass(slots=True)
class EnrichmentStats:
    adsbdb_calls: int = 0
    aeroapi_calls: int = 0
    aeroapi_skipped: int = 0

    def to_json(self) -> dict[str, int]:
        return {
            "adsbdb_calls": self.adsbdb_calls,
            "aeroapi_calls": self.aeroapi_calls,
            "aeroapi_skipped_quota": self.aeroapi_skipped,
        }


class EnrichmentService:
    """Adds airline, route, type and category to a raw :class:`Aircraft`."""

    def __init__(
        self,
        cache: EnrichmentCache,
        *,
        adsbdb: AdsbdbClient | None = None,
        aeroapi: AeroApiClient | None = None,
        airlines: AirlineRegistry | None = None,
        airports: AirportRegistry | None = None,
    ) -> None:
        self.cache = cache
        self.adsbdb = adsbdb
        self.aeroapi = aeroapi
        self.airlines = airlines or AirlineRegistry({})
        self.airports = airports or AirportRegistry([])
        self.stats = EnrichmentStats()

    async def aclose(self) -> None:
        if self.adsbdb:
            await self.adsbdb.aclose()
        if self.aeroapi:
            await self.aeroapi.aclose()

    # -- individual lookups ----------------------------------------------

    async def route_for(self, callsign: str | None) -> dict[str, Any] | None:
        """Route record for a callsign, from cache or a provider."""
        if not callsign:
            return None
        found, cached = self.cache.get("route", callsign)
        if found:
            return cached

        record: dict[str, Any] | None = None
        if self.adsbdb:
            self.stats.adsbdb_calls += 1
            record = await self.adsbdb.callsign(callsign)

        if self.aeroapi is not None:
            record = await self._augment_with_aeroapi(callsign, record)

        self.cache.put("route", callsign, record, provider="adsbdb" if record else None)
        return record

    async def _augment_with_aeroapi(
        self, callsign: str, record: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        """Spend an AeroAPI query only when it buys something adsbdb didn't.

        That means: no route at all, or a route with no ETA.  Everything else
        is already good enough for a 64-pixel-wide panel.
        """
        assert self.aeroapi is not None
        if (
            record is not None
            and record.get("origin")
            and record.get("destination")
            and record.get("eta")
        ):
            return record
        try:
            extra = await self.aeroapi.flight(callsign)
        except QuotaExhausted as exc:
            self.stats.aeroapi_skipped += 1
            log.info("%s", exc)
            return record
        self.stats.aeroapi_calls += 1
        if extra is None:
            return record
        merged = dict(record or {})
        for key, value in extra.items():
            if value not in (None, ""):
                merged.setdefault(key, value)
                if key in ("eta", "progress_percent", "departure"):
                    merged[key] = value
        merged["provider"] = "aeroapi"
        return merged

    async def aircraft_for(self, hex_id: str) -> dict[str, Any] | None:
        """Type/registration record for an ICAO address, from cache or adsbdb."""
        found, cached = self.cache.get("aircraft", hex_id)
        if found:
            return cached
        record: dict[str, Any] | None = None
        if self.adsbdb:
            self.stats.adsbdb_calls += 1
            record = await self.adsbdb.aircraft(hex_id)
        self.cache.put("aircraft", hex_id, record, provider="adsbdb" if record else None)
        return record

    # -- the whole picture -----------------------------------------------

    async def enrich(
        self,
        aircraft: Aircraft,
        *,
        home_lat: float,
        home_lon: float,
        prefer_cities: bool = False,
        lookup: bool = True,
    ) -> EnrichedAircraft:
        """Produce a fully-populated record for one target.

        ``lookup=False`` restricts the work to local data (airline table,
        categorisation, geometry), which is what the history writer wants.
        """
        assert aircraft.lat is not None and aircraft.lon is not None
        distance = haversine_mi(home_lat, home_lon, aircraft.lat, aircraft.lon)
        bearing = bearing_deg(home_lat, home_lon, aircraft.lat, aircraft.lon)

        enriched = EnrichedAircraft(
            aircraft=aircraft,
            distance_mi=distance,
            bearing_deg=bearing,
            category=categorise(aircraft, self.airlines),
        )

        route_record: dict[str, Any] | None = None
        if lookup:
            route_record = await self.route_for(aircraft.callsign)
            if not aircraft.type_code or not aircraft.registration:
                ac_record = await self.aircraft_for(aircraft.hex)
                if ac_record:
                    #  Backfilling onto the caller's Aircraft is deliberate: the
                    #  poller hands us the same objects every second, and a type
                    #  code that arrived from enrichment should not have to be
                    #  looked up again on the next frame.
                    aircraft.type_code = aircraft.type_code or _str(ac_record.get("type_code"))
                    aircraft.registration = aircraft.registration or _str(
                        ac_record.get("registration")
                    )
                    #  Re-run categorisation: a type code can turn "unknown"
                    #  into "helicopter".
                    enriched.category = categorise(aircraft, self.airlines)

        self._apply_airline(enriched, route_record)
        self._apply_route(enriched, route_record, prefer_cities=prefer_cities)
        return enriched

    def _apply_airline(self, enriched: EnrichedAircraft, record: dict[str, Any] | None) -> None:
        callsign = enriched.aircraft.callsign
        code = operator_code(callsign)
        if record and not code:
            code = _str(record.get("airline_icao"))

        airline = self.airlines.get(code)
        enriched.airline_code = code
        if airline:
            enriched.airline_name = airline.name
            enriched.airline_colour = ensure_legible(airline.colour)
        elif record and _str(record.get("airline_name")):
            #  We know who it is but have no brand colour: show the name in
            #  white rather than inventing a colour.
            enriched.airline_name = str(record["airline_name"]).upper()
            enriched.airline_colour = "#FFFFFF"

    def _apply_route(
        self, enriched: EnrichedAircraft, record: dict[str, Any] | None, *, prefer_cities: bool
    ) -> None:
        if not record:
            return
        origin = _str(record.get("origin")) or _str(record.get("origin_iata"))
        destination = _str(record.get("destination")) or _str(record.get("destination_iata"))
        enriched.route = Route(
            origin=self.airports.display(origin, prefer_city=False),
            destination=self.airports.display(destination, prefer_city=False),
            origin_city=_str(record.get("origin_city")) or self.airports.city(origin),
            destination_city=_str(record.get("destination_city"))
            or self.airports.city(destination),
            eta=_parse_dt(record.get("eta")),
            provider=_str(record.get("provider")) or "adsbdb",
        )


def _str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _parse_dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
