"""Public aggregator API.

adsb.fi, adsb.lol and airplanes.live all speak the ADSBExchange v2 response shape, so
one client covers all three with a configurable base URL. A token bucket holds us to
1 req/sec regardless of provider, and the last good response is kept so a failed poll
degrades to a stale frame rather than a blank panel.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from ..http import HttpClient, HttpError, RetryPolicy, TokenBucket
from ..models import Aircraft
from .base import SourceError, parse_aircraft_list

log = logging.getLogger(__name__)

MAX_RADIUS_NM = 250.0


class AggregatorSource:
    """ADSBExchange-v2-shaped public API with rate limiting and last-good caching."""

    name = "aggregator"

    def __init__(
        self,
        base_url: str,
        *,
        provider: str = "adsb_fi",
        client: HttpClient | None = None,
        max_age_s: float = 30.0,
        rate_per_s: float = 1.0,
        stale_after_s: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.provider = provider
        self.max_age_s = max_age_s
        self.stale_after_s = stale_after_s
        self._healthy = False
        self._last_good: list[Aircraft] = []
        self._last_good_at: float = 0.0
        self._client = client or HttpClient(
            timeout_s=6.0,
            retry=RetryPolicy(attempts=3, base_delay_s=1.0, max_delay_s=8.0),
            limiter=TokenBucket(rate_per_s),
        )

    @property
    def healthy(self) -> bool:
        return self._healthy

    @property
    def serving_stale(self) -> bool:
        """True when the most recent fetch fell back to the cached response."""
        return bool(self._last_good) and not self._healthy

    async def aclose(self) -> None:
        await self._client.aclose()

    def _url(self, lat: float, lon: float, radius_nm: float) -> str:
        radius = max(1.0, min(MAX_RADIUS_NM, radius_nm))
        return f"{self.base_url}/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/{radius:.0f}"

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        url = self._url(lat, lon, radius_nm)
        try:
            payload = await self._client.get_json(url)
        except HttpError as exc:
            self._healthy = False
            if self._last_good and (time.monotonic() - self._last_good_at) <= self.stale_after_s:
                log.warning("%s failed (%s); serving last good response", self.provider, exc)
                return list(self._last_good)
            raise SourceError(
                f"{self.provider} request failed: {exc}",
                hint=_hint_for(exc),
            ) from exc

        entries = _aircraft_array(payload)
        if entries is None:
            self._healthy = False
            raise SourceError(
                f"{self.provider} returned an unexpected payload",
                hint="expected an object with an `ac` array (ADSBExchange v2 shape)",
            )

        aircraft = parse_aircraft_list(entries, max_age_s=self.max_age_s)
        self._healthy = True
        self._last_good = list(aircraft)
        self._last_good_at = time.monotonic()
        return aircraft


def _aircraft_array(payload: Any) -> list[Any] | None:
    if not isinstance(payload, dict):
        return None
    for key in ("ac", "aircraft"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return None


def _hint_for(exc: HttpError) -> str:
    if exc.status == 429:
        return "rate limited; the client already backs off, but consider a longer poll interval"
    if exc.status in (401, 403):
        return "the provider rejected the request — check its current terms and any key requirement"
    return "check outbound network access and the provider's status page"
