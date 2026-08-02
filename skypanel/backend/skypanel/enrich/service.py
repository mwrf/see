"""Enrichment orchestration: cache first, adsbdb next, AeroAPI only when it earns it.

Nothing here ever raises on a provider failure. A missing route means the panel shows
one line less; it should never mean the panel shows an error.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from datetime import datetime

from .. import colours
from ..config import EnrichConfig
from ..models import Aircraft, Category, EnrichedAircraft, Route
from . import airports
from .adsbdb import AdsbdbClient
from .aeroapi import AeroApiClient, QuotaExceeded
from .cache import Cache

log = logging.getLogger(__name__)

ROUTE_KIND = "route"
AIRCRAFT_KIND = "aircraft"

#: Squawks that mean "this is not a scheduled airliner". 7777 is military intercept.
MILITARY_SQUAWKS = frozenset({"7777"})

#: ADS-B emitter category A7 is rotorcraft; B* are gliders/balloons/ultralights.
HELICOPTER_CATEGORIES = frozenset({"A7"})

HELICOPTER_TYPES = frozenset(
    {"EC35", "EC45", "EC30", "EC20", "H125", "H135", "H145", "H155", "H175",
     "A109", "A139", "A169", "AS50", "AS55", "AS65", "B06", "B407", "B412", "B429",
     "R22", "R44", "R66", "S76", "S92", "AW09", "AW139", "AW169", "AW189", "MD90"}
)  # fmt: skip

#: Operator prefixes that are air forces and government fleets rather than airlines.
MILITARY_PREFIXES = frozenset(
    {"RCH", "RRR", "CFC", "IAM", "NATO", "ASY", "BAF", "CTM", "GAF", "HKY", "IRON",
     "KNIFE", "NAVY", "OMEN", "PAT", "RFR", "SHELL", "SPAR", "TARTN", "VIVI", "MMF"}
)  # fmt: skip


class Enricher:
    """Turns an `Aircraft` into an `EnrichedAircraft`, hitting the network sparingly."""

    def __init__(
        self,
        config: EnrichConfig,
        *,
        cache: Cache,
        adsbdb: AdsbdbClient | None = None,
        aeroapi: AeroApiClient | None = None,
    ) -> None:
        self.config = config
        self.cache = cache
        self.adsbdb = adsbdb if adsbdb is not None else AdsbdbClient(config.adsbdb_base)
        if aeroapi is not None:
            self.aeroapi: AeroApiClient | None = aeroapi
        elif config.aeroapi_key:
            self.aeroapi = AeroApiClient(
                config.aeroapi_key,
                base_url=config.aeroapi_base,
                cache=cache,
                monthly_limit=config.aeroapi_monthly_limit,
            )
        else:
            self.aeroapi = None

    async def aclose(self) -> None:
        await self.adsbdb.aclose()
        if self.aeroapi is not None:
            await self.aeroapi.aclose()

    # ------------------------------------------------------------------- route

    async def route_for(self, callsign: str | None) -> Route | None:
        if not callsign:
            return None
        key = callsign.strip().upper()
        cached = self.cache.get(ROUTE_KIND, key)
        if cached is not Cache.MISS:
            return _route_from_dict(cached) if cached else None

        route = await self._fetch_route(key)
        if route is None:
            self.cache.put_negative(ROUTE_KIND, key, self.config.negative_ttl_s)
            return None
        self.cache.put(ROUTE_KIND, key, _route_to_dict(route), self.config.route_ttl_s)
        return route

    async def _fetch_route(self, callsign: str) -> Route | None:
        """adsbdb is the default; AeroAPI only adds the scheduled times it alone has."""
        route: Route | None = None
        try:
            route = await self.adsbdb.callsign(callsign)
        except Exception as exc:
            log.warning("adsbdb route lookup for %s failed: %s", callsign, exc)

        if self.aeroapi is None:
            return route
        # Only spend quota when adsbdb came up short, or when we want an ETA.
        if route is not None and route.origin and route.destination:
            return route
        try:
            enhanced = await self.aeroapi.flight(callsign)
        except QuotaExceeded as exc:
            log.info("%s", exc)
            return route
        except Exception as exc:
            log.warning("aeroapi lookup for %s failed: %s", callsign, exc)
            return route
        return enhanced or route

    # ---------------------------------------------------------------- aircraft

    async def aircraft_details(self, hex_id: str) -> dict[str, str] | None:
        key = hex_id.strip().lower()
        cached = self.cache.get(AIRCRAFT_KIND, key)
        if cached is not Cache.MISS:
            return cached if cached else None
        try:
            details = await self.adsbdb.aircraft(key)
        except Exception as exc:
            log.warning("adsbdb aircraft lookup for %s failed: %s", key, exc)
            return None
        if details is None:
            self.cache.put_negative(AIRCRAFT_KIND, key, self.config.negative_ttl_s)
            return None
        self.cache.put(AIRCRAFT_KIND, key, details, self.config.aircraft_ttl_s)
        return details

    # ------------------------------------------------------------------- whole

    async def enrich(self, ac: Aircraft) -> EnrichedAircraft:
        route = await self.route_for(ac.callsign) or Route()

        # `t`/`r` come free from decoders with an aircraft DB; only ask if they didn't.
        type_name: str | None = None
        if not ac.type_code or not ac.registration:
            details = await self.aircraft_details(ac.hex)
            if details:
                ac.type_code = ac.type_code or details.get("type_code")
                ac.registration = ac.registration or details.get("registration")
                type_name = details.get("type_name")

        operator = route.airline_icao or colours.operator_from_callsign(ac.callsign)
        airline_name = colours.name_for(operator) or route.airline_name

        route.airline_icao = operator
        route.airline_name = airline_name
        route.origin_city = route.origin_city or airports.city_for(route.origin)
        route.destination_city = route.destination_city or airports.city_for(route.destination)

        return EnrichedAircraft(
            aircraft=ac,
            route=route,
            type_name=type_name,
            airline_colour=colours.colour_for(operator),
            traffic_category=classify(ac, operator),
        )


def classify(ac: Aircraft, operator: str | None) -> Category:
    """Bucket an aircraft for the user's category filters.

    Deliberately cheap and heuristic — it drives a checkbox, not a safety decision.
    """
    if ac.squawk in MILITARY_SQUAWKS:
        return Category.MILITARY
    callsign = (ac.callsign or "").upper()
    if operator and operator in MILITARY_PREFIXES:
        return Category.MILITARY
    if any(callsign.startswith(prefix) for prefix in MILITARY_PREFIXES):
        return Category.MILITARY
    if ac.category and ac.category.upper() in HELICOPTER_CATEGORIES:
        return Category.HELICOPTER
    if ac.type_code and ac.type_code.upper() in HELICOPTER_TYPES:
        return Category.HELICOPTER
    if operator and colours.lookup(operator) is not None:
        return Category.AIRLINE
    if operator is not None:
        return Category.AIRLINE
    if callsign and ("-" in callsign or callsign[0].isdigit() or _looks_like_tail(callsign)):
        return Category.GA
    return Category.UNKNOWN


def _looks_like_tail(callsign: str) -> bool:
    """`N123AB`, `EIABC`, `GBXYZ` — a registration flown as the callsign."""
    return len(callsign) <= 6 and any(ch.isdigit() for ch in callsign) and callsign[0].isalpha()


def _route_to_dict(route: Route) -> dict[str, object]:
    data = asdict(route)
    for key in ("scheduled_off", "scheduled_on", "estimated_on"):
        value = data.get(key)
        if isinstance(value, datetime):
            data[key] = value.isoformat()
    return data


def _route_from_dict(data: dict[str, object] | None) -> Route | None:
    if not data:
        return None
    parsed: dict[str, object] = dict(data)
    for key in ("scheduled_off", "scheduled_on", "estimated_on"):
        value = parsed.get(key)
        if isinstance(value, str):
            try:
                parsed[key] = datetime.fromisoformat(value)
            except ValueError:
                parsed[key] = None
    return Route(**parsed)  # type: ignore[arg-type]
