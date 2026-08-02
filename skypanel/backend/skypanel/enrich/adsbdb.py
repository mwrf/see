"""adsbdb.com — free, no key, the default enrichment provider.

`GET /v0/callsign/{callsign}` gives airline and route; `GET /v0/aircraft/{hex}` gives
type and registration. Responses are wrapped in a `response` object, and a miss is a
404 with `{"response": "unknown callsign"}` rather than an empty success.
"""

from __future__ import annotations

import logging
from typing import Any

from ..http import HttpClient, HttpError, RetryPolicy
from ..models import Route

log = logging.getLogger(__name__)


class AdsbdbClient:
    """Route and aircraft lookups against adsbdb."""

    name = "adsbdb"

    def __init__(
        self, base_url: str = "https://api.adsbdb.com", *, client: HttpClient | None = None
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = client or HttpClient(
            timeout_s=4.0, retry=RetryPolicy(attempts=2, base_delay_s=0.5, max_delay_s=4.0)
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def callsign(self, callsign: str) -> Route | None:
        """Route for a callsign, or None when adsbdb doesn't know it."""
        url = f"{self.base_url}/v0/callsign/{callsign.strip().upper()}"
        try:
            payload = await self._client.get_json(url)
        except HttpError as exc:
            if exc.status == 404:
                return None
            log.debug("adsbdb callsign %s: %s", callsign, exc)
            raise
        return _route_from(payload)

    async def aircraft(self, hex_id: str) -> dict[str, str] | None:
        """`{"type_code", "type_name", "registration"}` for an ICAO hex, or None."""
        url = f"{self.base_url}/v0/aircraft/{hex_id.strip().lower()}"
        try:
            payload = await self._client.get_json(url)
        except HttpError as exc:
            if exc.status == 404:
                return None
            log.debug("adsbdb aircraft %s: %s", hex_id, exc)
            raise
        return _aircraft_from(payload)


def _response(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    body = payload.get("response")
    return body if isinstance(body, dict) else None


def _route_from(payload: Any) -> Route | None:
    body = _response(payload)
    if body is None:
        return None
    flightroute = body.get("flightroute")
    if not isinstance(flightroute, dict):
        return None
    origin = _airport(flightroute.get("origin"))
    destination = _airport(flightroute.get("destination"))
    airline = flightroute.get("airline")
    airline_icao = airline.get("icao") if isinstance(airline, dict) else None
    airline_name = airline.get("name") if isinstance(airline, dict) else None
    iata = flightroute.get("callsign_iata")
    if origin is None and destination is None and not airline_icao:
        return None
    return Route(
        flight_iata=iata.strip().upper() if isinstance(iata, str) and iata.strip() else None,
        origin=origin[0] if origin else None,
        origin_city=origin[1] if origin else None,
        destination=destination[0] if destination else None,
        destination_city=destination[1] if destination else None,
        airline_icao=airline_icao,
        airline_name=airline_name,
        provider="adsbdb",
    )


def _airport(raw: Any) -> tuple[str, str | None] | None:
    """(code, city). Prefer IATA — it's what people read on a boarding pass."""
    if not isinstance(raw, dict):
        return None
    code = raw.get("iata_code") or raw.get("icao_code")
    if not isinstance(code, str) or not code.strip():
        return None
    municipality = raw.get("municipality")
    city = municipality.strip() if isinstance(municipality, str) and municipality.strip() else None
    return code.strip().upper(), city


def _aircraft_from(payload: Any) -> dict[str, str] | None:
    body = _response(payload)
    if body is None:
        return None
    aircraft = body.get("aircraft")
    if not isinstance(aircraft, dict):
        return None
    out: dict[str, str] = {}
    for src, dst in (
        ("icao_type", "type_code"),
        ("type", "type_name"),
        ("registration", "registration"),
        ("manufacturer", "manufacturer"),
    ):
        value = aircraft.get(src)
        if isinstance(value, str) and value.strip():
            out[dst] = value.strip()
    return out or None
