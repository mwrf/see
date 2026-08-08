"""adsbdb.com -- the free, no-key enrichment provider, and our default.

Two endpoints matter:

* ``GET /v0/callsign/{callsign}`` -> operator (airline) plus origin/destination
* ``GET /v0/aircraft/{hex}``      -> ICAO type code and registration

adsbdb answers ``404`` with ``{"response": "unknown callsign"}`` for anything it
does not know, which is common for military and GA traffic; the caller turns
that into a cached negative.
"""

from __future__ import annotations

import logging
from typing import Any

from ..coerce import field_str as _get
from ..http import HttpClient, HttpError

log = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.adsbdb.com"


class AdsbdbClient:
    """Typed access to the two adsbdb endpoints we use."""

    name = "adsbdb"

    def __init__(
        self, base_url: str = DEFAULT_BASE_URL, *, client: HttpClient | None = None
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = client or HttpClient(timeout=5.0)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def callsign(self, callsign: str) -> dict[str, Any] | None:
        """Route and operator for a callsign, or ``None`` if unknown."""
        url = f"{self.base_url}/v0/callsign/{callsign.strip().upper()}"
        payload = await self._get(url)
        if payload is None:
            return None
        return _parse_callsign(payload)

    async def aircraft(self, hex_id: str) -> dict[str, Any] | None:
        """Type code and registration for an ICAO 24-bit address."""
        url = f"{self.base_url}/v0/aircraft/{hex_id.strip().upper()}"
        payload = await self._get(url)
        if payload is None:
            return None
        return _parse_aircraft(payload)

    async def _get(self, url: str) -> Any:
        try:
            return await self._client.get_json(url)
        except HttpError as exc:
            if exc.status == 404:
                return None  # a genuine "we don't know", not a failure
            log.debug("adsbdb lookup failed: %s", exc)
            return None


def _parse_callsign(payload: Any) -> dict[str, Any] | None:
    response = _response_body(payload)
    if response is None:
        return None
    flightroute = response.get("flightroute")
    if not isinstance(flightroute, dict):
        return None

    airline = flightroute.get("airline")
    origin = flightroute.get("origin")
    destination = flightroute.get("destination")
    result = {
        "airline_name": _get(airline, "name"),
        "airline_icao": _get(airline, "icao"),
        "airline_iata": _get(airline, "iata"),
        "origin": _get(origin, "icao_code"),
        "origin_iata": _get(origin, "iata_code"),
        "origin_city": _get(origin, "municipality"),
        "destination": _get(destination, "icao_code"),
        "destination_iata": _get(destination, "iata_code"),
        "destination_city": _get(destination, "municipality"),
    }
    return result if any(value for value in result.values()) else None


def _parse_aircraft(payload: Any) -> dict[str, Any] | None:
    response = _response_body(payload)
    if response is None:
        return None
    aircraft = response.get("aircraft")
    if not isinstance(aircraft, dict):
        return None
    result = {
        "type_code": aircraft.get("icao_type") or aircraft.get("type"),
        "type_name": aircraft.get("type"),
        "registration": aircraft.get("registration"),
        "manufacturer": aircraft.get("manufacturer"),
        "operator": aircraft.get("registered_owner"),
        "operator_icao": aircraft.get("registered_owner_operator_flag_code"),
    }
    return result if any(value for value in result.values()) else None


def _response_body(payload: Any) -> dict[str, Any] | None:
    """adsbdb wraps everything in ``{"response": ...}``; errors put a string there."""
    if not isinstance(payload, dict):
        return None
    response = payload.get("response")
    return response if isinstance(response, dict) else None
