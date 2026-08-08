"""The ``local`` source: your own dump1090 / readsb receiver on the LAN.

This is the preferred feed -- no rate limit, no auth, no TLS, 1 Hz updates and
sub-second latency.  The only real deployment problem is that every decoder
serves ``aircraft.json`` from a different path, so the source probes a list of
candidates once and then sticks with whichever answered.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from ..coerce import as_float as _as_float
from ..coerce import as_str as _as_str
from ..http import HttpClient, HttpError
from ..models import Aircraft
from .base import HealthTracker, SourceError

log = logging.getLogger(__name__)

#: Probed in order on first use.  ``{host}`` is substituted with the configured
#: host (which may include an explicit ``host:port``).
CANDIDATE_PATHS: tuple[str, ...] = (
    "http://{host}:8080/data/aircraft.json",
    "http://{host}:8080/skyaware/data/aircraft.json",
    "http://{host}:8080/tar1090/data/aircraft.json",
    "http://{host}/tar1090/data/aircraft.json",
)

#: Positions older than this are stale enough that the target may have moved
#: miles since; drop them rather than draw a lie.
MAX_SEEN_POS_S = 30.0

PROBE_HINT = (
    "none of the candidate aircraft.json paths responded with JSON. Check that the "
    "decoder is running and exposes a web interface (dump1090-fa: --write-json plus "
    "lighttpd; readsb: --write-json /run/readsb). Set source.local_path explicitly if "
    "your install uses a non-standard URL."
)


class LocalSource:
    """Polls a decoder's ``aircraft.json`` over plain HTTP."""

    name = "local"

    def __init__(
        self,
        host: str,
        *,
        path: str | None = None,
        client: HttpClient | None = None,
        max_seen_pos_s: float = MAX_SEEN_POS_S,
    ) -> None:
        self.host = host
        #: Explicit URL from config, or the winner of the probe once we have one.
        self.url: str | None = path
        self._configured_path = path
        self._client = client or HttpClient(timeout=2.0)
        self._health = HealthTracker()
        self._max_seen_pos_s = max_seen_pos_s
        self.probe_log: list[tuple[str, str]] = []

    @property
    def healthy(self) -> bool:
        return self._health.healthy

    @property
    def last_error(self) -> str | None:
        return self._health.last_error

    async def aclose(self) -> None:
        await self._client.aclose()

    def candidates(self) -> list[str]:
        if self._configured_path:
            return [self._configured_path]
        return [template.format(host=self.host) for template in CANDIDATE_PATHS]

    async def probe(self) -> str:
        """Find a working ``aircraft.json`` URL, remembering it for later polls."""
        if self.url:
            return self.url
        self.probe_log = []
        for candidate in self.candidates():
            try:
                payload = await self._client.get_json(candidate)
            except HttpError as exc:
                self.probe_log.append((candidate, str(exc)))
                continue
            if not _looks_like_aircraft_json(payload):
                self.probe_log.append((candidate, "JSON present but no 'aircraft' array"))
                continue
            log.info("local source resolved to %s", candidate)
            self.url = candidate
            return candidate

        detail = "\n".join(f"  {url}: {err}" for url, err in self.probe_log)
        raise SourceError(f"could not find aircraft.json on {self.host}\n{detail}", hint=PROBE_HINT)

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        """Return every usable target the decoder currently reports.

        A receiver only sees what it can hear, so ``radius_nm`` is not sent
        anywhere -- range filtering happens in :mod:`skypanel.geo`.
        """
        try:
            url = await self.probe()
            payload = await self._client.get_json(url)
        except (HttpError, SourceError) as exc:
            self._health.record_failure(str(exc))
            if isinstance(exc, SourceError):
                raise
            raise SourceError(
                f"local receiver poll failed: {exc}",
                hint="the decoder answered before but not now; check the service is still up",
            ) from exc

        aircraft = parse_aircraft_json(payload, max_seen_pos_s=self._max_seen_pos_s)
        self._health.record_success(time.monotonic())
        return aircraft


def _looks_like_aircraft_json(payload: Any) -> bool:
    return isinstance(payload, dict) and isinstance(payload.get("aircraft"), list)


def parse_aircraft_json(payload: Any, *, max_seen_pos_s: float = MAX_SEEN_POS_S) -> list[Aircraft]:
    """Convert a decoder's ``aircraft.json`` body into :class:`Aircraft` records.

    Handles the quirks the spec calls out: space-padded ``flight``, ``alt_baro``
    of ``"ground"``, optional ``t``/``r`` (only present with an aircraft DB
    loaded), missing positions, and stale ``seen_pos``.
    """
    if not _looks_like_aircraft_json(payload):
        raise SourceError(
            "aircraft.json did not contain an 'aircraft' array",
            hint="the URL probably points at a different service (a tar1090 index page, say)",
        )

    out: list[Aircraft] = []
    for entry in payload["aircraft"]:
        if not isinstance(entry, dict):
            continue
        parsed = _parse_entry(entry, max_seen_pos_s)
        if parsed is not None:
            out.append(parsed)
    return out


def _parse_entry(entry: dict[str, Any], max_seen_pos_s: float) -> Aircraft | None:
    hex_id = _as_str(entry.get("hex"))
    if not hex_id:
        return None

    lat, lon = _as_float(entry.get("lat")), _as_float(entry.get("lon"))
    if lat is None or lon is None:
        return None

    seen_pos = _as_float(entry.get("seen_pos"))
    if seen_pos is not None and seen_pos > max_seen_pos_s:
        return None

    return Aircraft(
        hex=hex_id.strip().lower(),
        callsign=_clean_callsign(entry.get("flight")),
        lat=lat,
        lon=lon,
        alt_baro_ft=_parse_altitude(entry),
        gs_kt=_as_float(entry.get("gs")),
        track_deg=_as_float(entry.get("track")),
        vert_rate=_as_float(entry.get("baro_rate") or entry.get("geom_rate")),
        squawk=_as_str(entry.get("squawk")),
        type_code=_as_str(entry.get("t")),
        registration=_as_str(entry.get("r")),
        category=_as_str(entry.get("category")),
        seen_pos_s=seen_pos,
    )


def _parse_altitude(entry: dict[str, Any]) -> float | None:
    """Prefer ``alt_baro``; it may be the literal string ``"ground"``."""
    raw = entry.get("alt_baro")
    if isinstance(raw, str):
        return 0.0 if raw.strip().lower() == "ground" else None
    value = _as_float(raw)
    if value is not None:
        return value
    return _as_float(entry.get("alt_geom"))


def _clean_callsign(raw: Any) -> str | None:
    """``"RYR1812 "`` -> ``"RYR1812"``; blank padding means "no callsign yet"."""
    text = _as_str(raw)
    if text is None:
        return None
    stripped = text.strip().upper()
    return stripped or None
