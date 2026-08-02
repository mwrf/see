"""FlightAware AeroAPI v4 — optional, and metered.

Feeders get $10/month of query fees free, which is a few hundred calls. The quota is
therefore treated as precious: every call is counted against a per-month ceiling stored
in the cache, and once the ceiling is hit this client refuses to fire at all so the
caller degrades to adsbdb instead of running up a bill.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from ..http import HttpClient, HttpError, RetryPolicy
from ..models import Route
from .cache import Cache

log = logging.getLogger(__name__)

COUNTER_NAME = "aeroapi_queries"


class QuotaExceeded(Exception):
    """Raised when the configured monthly ceiling has already been reached."""


class AeroApiClient:
    """Scheduled origin/destination and ETA, behind a hard quota guard."""

    name = "aeroapi"

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = "https://aeroapi.flightaware.com/aeroapi",
        cache: Cache,
        monthly_limit: int = 400,
        client: HttpClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.cache = cache
        self.monthly_limit = monthly_limit
        self._client = client or HttpClient(
            timeout_s=6.0,
            retry=RetryPolicy(attempts=2, base_delay_s=1.0, max_delay_s=4.0),
            headers={"x-apikey": api_key},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------ quota

    @staticmethod
    def _period(now: datetime | None = None) -> str:
        return (now or datetime.now(UTC)).strftime("%Y-%m")

    def queries_this_month(self) -> int:
        return self.cache.counter(COUNTER_NAME, self._period())

    def quota_remaining(self) -> int:
        return max(0, self.monthly_limit - self.queries_this_month())

    @property
    def available(self) -> bool:
        return self.quota_remaining() > 0

    # ----------------------------------------------------------------- lookups

    async def flight(self, ident: str) -> Route | None:
        """Most recent flight for an ident. Counts against the monthly quota."""
        if not self.available:
            raise QuotaExceeded(
                f"AeroAPI monthly ceiling of {self.monthly_limit} reached; using adsbdb"
            )
        url = f"{self.base_url}/flights/{ident.strip().upper()}"
        self.cache.bump_counter(COUNTER_NAME, self._period())
        try:
            payload = await self._client.get_json(url)
        except HttpError as exc:
            if exc.status == 404:
                return None
            log.warning("aeroapi %s: %s", ident, exc)
            raise
        return _route_from(payload)


def _route_from(payload: Any) -> Route | None:
    if not isinstance(payload, dict):
        return None
    flights = payload.get("flights")
    if not isinstance(flights, list) or not flights:
        return None
    # AeroAPI returns newest first; the live leg is the one we want.
    flight = next((f for f in flights if isinstance(f, dict)), None)
    if flight is None:
        return None
    origin = _airport(flight.get("origin"))
    destination = _airport(flight.get("destination"))
    if origin is None and destination is None:
        return None
    operator = flight.get("operator_icao") or flight.get("operator")
    return Route(
        origin=origin[0] if origin else None,
        origin_city=origin[1] if origin else None,
        destination=destination[0] if destination else None,
        destination_city=destination[1] if destination else None,
        airline_icao=operator if isinstance(operator, str) else None,
        scheduled_off=_timestamp(flight.get("scheduled_off")),
        scheduled_on=_timestamp(flight.get("scheduled_on")),
        estimated_on=_timestamp(flight.get("estimated_on")),
        provider="aeroapi",
    )


def _airport(raw: Any) -> tuple[str, str | None] | None:
    if not isinstance(raw, dict):
        return None
    code = raw.get("code_iata") or raw.get("code_icao") or raw.get("code")
    if not isinstance(code, str) or not code.strip():
        return None
    city = raw.get("city")
    return code.strip().upper(), city.strip() if isinstance(city, str) and city.strip() else None


def _timestamp(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
