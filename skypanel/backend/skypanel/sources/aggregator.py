"""The ``aggregator`` source: a public crowd-sourced ADS-B API.

adsb.fi, adsb.lol and airplanes.live all speak the ADSBExchange v2 response
shape, so one client covers all three with a configurable base URL.  Because
these are volunteer-funded services we are deliberately polite: a hard 1 req/s
token bucket, an identifying User-Agent, exponential backoff on 429, and a
last-good response cache so a throttled poll never blanks the panel.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from ..coerce import as_float as _as_float
from ..coerce import as_str as _as_str
from ..http import HttpClient, HttpError, RetryPolicy
from ..models import Aircraft
from ..ratelimit import TokenBucket
from .base import HealthTracker, SourceError

log = logging.getLogger(__name__)

MAX_RADIUS_NM = 250.0


@dataclass(frozen=True, slots=True)
class Provider:
    key: str
    label: str
    base_url: str
    attribution: str
    licence: str
    rate_per_sec: float = 1.0


PROVIDERS: dict[str, Provider] = {
    "adsb_fi": Provider(
        key="adsb_fi",
        label="adsb.fi",
        base_url="https://opendata.adsb.fi/api",
        attribution="Data from adsb.fi",
        licence="Non-commercial use; attribution required",
    ),
    "adsb_lol": Provider(
        key="adsb_lol",
        label="adsb.lol",
        base_url="https://api.adsb.lol",
        attribution="Data from adsb.lol",
        licence="ODbL 1.0",
    ),
    "airplanes_live": Provider(
        key="airplanes_live",
        label="airplanes.live",
        base_url="https://api.airplanes.live/v2",
        attribution="Data from airplanes.live",
        licence="Check current terms before enabling",
    ),
}


class AggregatorSource:
    """Polls one of the public v2-shaped endpoints."""

    name = "aggregator"

    def __init__(
        self,
        provider: str = "adsb_fi",
        *,
        client: HttpClient | None = None,
        bucket: TokenBucket | None = None,
    ) -> None:
        try:
            self.provider = PROVIDERS[provider]
        except KeyError:
            known = ", ".join(sorted(PROVIDERS))
            raise SourceError(
                f"unknown aggregator provider {provider!r}", hint=f"choose one of: {known}"
            ) from None
        self._client = client or HttpClient(
            timeout=6.0, retry=RetryPolicy(attempts=3, backoff_base=1.0, backoff_max=30.0)
        )
        self._bucket = bucket or TokenBucket(rate=self.provider.rate_per_sec, capacity=1.0)
        self._health = HealthTracker()
        #: Last successful response, replayed when a poll fails.
        self._last_good: list[Aircraft] = []

    @property
    def healthy(self) -> bool:
        return self._health.healthy

    @property
    def last_error(self) -> str | None:
        return self._health.last_error

    @property
    def attribution(self) -> str:
        return self.provider.attribution

    async def aclose(self) -> None:
        await self._client.aclose()

    def url_for(self, lat: float, lon: float, radius_nm: float) -> str:
        radius = max(1.0, min(MAX_RADIUS_NM, radius_nm))
        base = self.provider.base_url.rstrip("/")
        return f"{base}/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/{radius:.0f}"

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        """Fetch targets, falling back to the cached response on any failure."""
        await self._bucket.acquire()
        url = self.url_for(lat, lon, radius_nm)
        try:
            payload = await self._client.get_json(url)
        except HttpError as exc:
            self._health.record_failure(str(exc))
            if self._last_good:
                log.warning(
                    "%s poll failed (%s); serving cached response", self.provider.label, exc
                )
                return list(self._last_good)
            raise SourceError(
                f"{self.provider.label} poll failed: {exc}",
                hint="public aggregators throttle aggressively; "
                "a local receiver avoids this entirely",
            ) from exc

        aircraft = parse_v2_response(payload)
        self._last_good = aircraft
        self._health.record_success(time.monotonic())
        return list(aircraft)


def parse_v2_response(payload: Any) -> list[Aircraft]:
    """Parse an ADSBExchange-v2-shaped body.

    Targets live under ``ac``.  Some providers return ``aircraft`` instead, so
    both are accepted.  Field semantics match ``aircraft.json`` closely enough
    that the quirks are the same: padded ``flight``, ``"ground"`` altitude.
    """
    if not isinstance(payload, dict):
        raise SourceError("aggregator response was not a JSON object")
    raw = payload.get("ac")
    if raw is None:
        raw = payload.get("aircraft")
    if not isinstance(raw, list):
        raise SourceError(
            "aggregator response had no 'ac' array",
            hint="the provider may have changed its response shape or returned an error body",
        )

    out: list[Aircraft] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        parsed = _parse_v2_entry(entry)
        if parsed is not None:
            out.append(parsed)
    return out


def _parse_v2_entry(entry: dict[str, Any]) -> Aircraft | None:
    hex_id = _as_str(entry.get("hex"))
    if not hex_id:
        return None
    lat, lon = _as_float(entry.get("lat")), _as_float(entry.get("lon"))
    if lat is None or lon is None:
        return None

    alt_raw = entry.get("alt_baro")
    if isinstance(alt_raw, str):
        alt = 0.0 if alt_raw.strip().lower() == "ground" else None
    else:
        alt = _as_float(alt_raw)
    if alt is None:
        alt = _as_float(entry.get("alt_geom"))

    flight = _as_str(entry.get("flight"))
    return Aircraft(
        hex=hex_id.strip().lower(),
        callsign=flight.strip().upper() if flight else None,
        lat=lat,
        lon=lon,
        alt_baro_ft=alt,
        gs_kt=_as_float(entry.get("gs")),
        track_deg=_as_float(entry.get("track")),
        vert_rate=_as_float(entry.get("baro_rate") or entry.get("geom_rate")),
        squawk=_as_str(entry.get("squawk")),
        type_code=_as_str(entry.get("t")),
        registration=_as_str(entry.get("r")),
        category=_as_str(entry.get("category")),
        seen_pos_s=_as_float(entry.get("seen_pos")),
    )
