"""Own receiver: dump1090 / dump1090-fa / readsb aircraft.json over the LAN.

No rate limit, no auth, no TLS. When this fails it is almost always the wrong path or a
decoder that isn't exposing a web interface, so failures carry a hint rather than a
traceback.
"""

from __future__ import annotations

import logging
from typing import Any

from ..geo import haversine_nm
from ..http import HttpClient, HttpError, RetryPolicy
from ..models import Aircraft
from .base import SourceError, parse_aircraft_list

log = logging.getLogger(__name__)

#: Probed in order on first use until one returns valid JSON with an `aircraft` array.
CANDIDATE_PATHS: tuple[str, ...] = (
    "http://{host}:8080/data/aircraft.json",  # dump1090 / dump1090-mutability
    "http://{host}:8080/skyaware/data/aircraft.json",  # dump1090-fa
    "http://{host}:8080/tar1090/data/aircraft.json",  # readsb / tar1090
    "http://{host}/tar1090/data/aircraft.json",
)

PROBE_HINT = (
    "checked the dump1090, skyaware and tar1090 paths on {host}. Confirm the decoder is "
    "running with a web interface (`lighttpd`/`tar1090`), that port 8080 is reachable "
    "from this machine, and set [source].local_path if it lives somewhere unusual"
)


class LocalSource:
    """Polls a JSON endpoint on the LAN at ~1 Hz."""

    name = "local"

    def __init__(
        self,
        host: str,
        *,
        path: str | None = None,
        client: HttpClient | None = None,
        max_age_s: float = 30.0,
    ) -> None:
        self.host = host
        self.max_age_s = max_age_s
        self._url: str | None = path.format(host=host) if path else None
        self._explicit = path is not None
        self._healthy = False
        self._client = client or HttpClient(
            timeout_s=2.0,
            retry=RetryPolicy(attempts=2, base_delay_s=0.2, max_delay_s=1.0),
        )

    @property
    def healthy(self) -> bool:
        return self._healthy

    @property
    def url(self) -> str | None:
        """The endpoint that answered, once probing has settled on one."""
        return self._url

    async def aclose(self) -> None:
        await self._client.aclose()

    async def probe(self) -> str:
        """Find a working aircraft.json URL, remembering it for subsequent polls."""
        if self._url is not None:
            return self._url
        tried: list[str] = []
        for template in CANDIDATE_PATHS:
            url = template.format(host=self.host)
            tried.append(url)
            try:
                payload = await self._client.get_json(url)
            except HttpError as exc:
                log.debug("probe %s: %s", url, exc)
                continue
            if _looks_like_aircraft_json(payload):
                log.info("local source resolved to %s", url)
                self._url = url
                return url
            log.debug("probe %s: 200 but no aircraft array", url)
        self._healthy = False
        raise SourceError(
            f"no aircraft.json found on {self.host}",
            hint=PROBE_HINT.format(host=self.host) + f" (tried: {', '.join(tried)})",
        )

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        url = await self.probe()
        try:
            payload = await self._client.get_json(url)
        except HttpError as exc:
            self._healthy = False
            if self._explicit:
                hint = f"configured path {url} did not answer"
            else:
                # A path that worked before can stop working after a decoder upgrade.
                self._url = None
                hint = "the endpoint stopped answering; will re-probe on the next poll"
            raise SourceError(f"local receiver unreachable: {exc}", hint=hint) from exc

        if not _looks_like_aircraft_json(payload):
            self._healthy = False
            raise SourceError(
                f"{url} returned JSON without an `aircraft` array",
                hint="this is usually a tar1090 index page rather than the data endpoint",
            )

        aircraft = parse_aircraft_list(payload["aircraft"], max_age_s=self.max_age_s)
        self._healthy = True
        return [ac for ac in aircraft if _within(ac, lat, lon, radius_nm)]


def _looks_like_aircraft_json(payload: Any) -> bool:
    return isinstance(payload, dict) and isinstance(payload.get("aircraft"), list)


def _within(ac: Aircraft, lat: float, lon: float, radius_nm: float) -> bool:
    if ac.lat is None or ac.lon is None:
        return False
    return haversine_nm(lat, lon, ac.lat, ac.lon) <= radius_nm
