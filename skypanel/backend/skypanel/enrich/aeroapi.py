"""FlightAware AeroAPI v4 -- optional, metered, and treated as precious.

Feeders get $10/month of query fees free, so this client refuses to spend past
a configurable monthly ceiling and degrades to adsbdb when it hits it.  The
counter lives in the enrichment cache so it survives restarts, and resets when
the calendar month changes.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from ..coerce import field_str as _field
from ..http import HttpClient, HttpError
from .cache import EnrichmentCache

log = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://aeroapi.flightaware.com/aeroapi"
COUNTER_NAME = "aeroapi_queries"
MONTH_MARKER = "aeroapi_month"


class QuotaExhausted(RuntimeError):
    """The configured monthly ceiling has been reached."""


class AeroApiClient:
    """Scheduled-route lookups, behind a hard monthly query ceiling."""

    name = "aeroapi"

    def __init__(
        self,
        api_key: str,
        cache: EnrichmentCache,
        *,
        base_url: str = DEFAULT_BASE_URL,
        monthly_limit: int = 1500,
        client: HttpClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.monthly_limit = monthly_limit
        self._cache = cache
        self._client = client or HttpClient(timeout=8.0, headers={"x-apikey": api_key})

    async def aclose(self) -> None:
        await self._client.aclose()

    # -- quota -----------------------------------------------------------

    def _roll_month(self, now: datetime) -> None:
        """Zero the counter when the calendar month changes."""
        marker = now.strftime("%Y%m")
        stored = self._cache.counter(MONTH_MARKER)
        if stored != int(marker):
            self._cache.reset_counter(COUNTER_NAME)
            self._cache.reset_counter(MONTH_MARKER)
            self._cache.bump(MONTH_MARKER, int(marker))

    def queries_used(self, now: datetime | None = None) -> int:
        self._roll_month(now or datetime.now(UTC))
        return self._cache.counter(COUNTER_NAME)

    def quota_remaining(self, now: datetime | None = None) -> int:
        return max(0, self.monthly_limit - self.queries_used(now))

    @property
    def available(self) -> bool:
        return self.quota_remaining() > 0

    def quota_json(self) -> dict[str, Any]:
        used = self.queries_used()
        return {
            "used": used,
            "limit": self.monthly_limit,
            "remaining": max(0, self.monthly_limit - used),
            "exhausted": used >= self.monthly_limit,
        }

    # -- lookups ---------------------------------------------------------

    async def flight(self, ident: str, *, now: datetime | None = None) -> dict[str, Any] | None:
        """Scheduled origin/destination and ETA for a flight ident.

        Raises :class:`QuotaExhausted` rather than silently spending money, so
        the enrichment service can fall back deliberately.
        """
        stamp = now or datetime.now(UTC)
        if self.quota_remaining(stamp) <= 0:
            raise QuotaExhausted(
                f"AeroAPI monthly ceiling of {self.monthly_limit} queries reached; using adsbdb"
            )

        url = f"{self.base_url}/flights/{ident.strip().upper()}"
        try:
            payload = await self._client.get_json(url, params={"max_pages": 1})
        except HttpError as exc:
            if exc.status == 404:
                self._cache.bump(COUNTER_NAME)
                return None
            log.warning("AeroAPI lookup for %s failed: %s", ident, exc)
            return None
        self._cache.bump(COUNTER_NAME)
        return _parse_flights(payload)


def _parse_flights(payload: Any) -> dict[str, Any] | None:
    """Pick the most relevant flight from an AeroAPI ``/flights`` response.

    The API returns recent and scheduled legs; the one in the air (or the next
    to depart) is the one on the panel, so prefer an entry with an actual
    departure time.
    """
    if not isinstance(payload, dict):
        return None
    flights = payload.get("flights")
    if not isinstance(flights, list) or not flights:
        return None

    chosen: dict[str, Any] | None = None
    for entry in flights:
        if not isinstance(entry, dict):
            continue
        if entry.get("actual_off") and not entry.get("actual_on"):
            chosen = entry
            break
        if chosen is None:
            chosen = entry
    if chosen is None:
        return None

    origin, destination = chosen.get("origin"), chosen.get("destination")
    return {
        "origin": _code(origin),
        "origin_city": _field(origin, "city"),
        "destination": _code(destination),
        "destination_city": _field(destination, "city"),
        "eta": chosen.get("estimated_in") or chosen.get("scheduled_in"),
        "departure": chosen.get("actual_off")
        or chosen.get("estimated_off")
        or chosen.get("scheduled_off"),
        "airline_icao": chosen.get("operator_icao") or chosen.get("operator"),
        "type_code": chosen.get("aircraft_type"),
        "progress_percent": chosen.get("progress_percent"),
    }


def _code(obj: Any) -> str | None:
    if isinstance(obj, dict):
        for key in ("code_icao", "code", "code_iata"):
            value = obj.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip().upper()
    return None
