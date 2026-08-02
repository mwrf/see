"""Fixture replay.

Loops over `backend/data/fixtures/*.json` — real aircraft.json snapshots captured from
a receiver. Every test uses this, and so does anyone working on the renderer with no
antenna in reach.
"""

from __future__ import annotations

import json
import time
from collections.abc import Sequence
from pathlib import Path

from ..colours import data_dir
from ..geo import haversine_nm
from ..models import Aircraft
from .base import SourceError, parse_aircraft_list


class MockSource:
    """Replays recorded snapshots on a loop at `speed`× real time."""

    name = "mock"

    def __init__(
        self,
        fixture_dir: Path | None = None,
        *,
        speed: float = 1.0,
        step_s: float = 5.0,
        max_age_s: float = 30.0,
        only: Sequence[str] | None = None,
    ) -> None:
        self.dir = fixture_dir or (data_dir() / "fixtures")
        self.speed = max(speed, 0.01)
        self.step_s = step_s
        self.max_age_s = max_age_s
        self._names: list[str] = []
        self._frames: list[list[Aircraft]] = []
        self._start = time.monotonic()
        self._forced: int | None = None
        self._load(only)

    def _load(self, only: Sequence[str] | None) -> None:
        if not self.dir.exists():
            raise SourceError(
                f"no fixture directory at {self.dir}",
                hint="record one with `just capture-fixtures` against a live receiver",
            )
        wanted = {name.removesuffix(".json") for name in only} if only else None
        for path in sorted(self.dir.glob("*.json")):
            if wanted is not None and path.stem not in wanted:
                continue
            payload = json.loads(path.read_text(encoding="utf-8"))
            entries = payload.get("aircraft", []) if isinstance(payload, dict) else payload
            # Fixtures are static snapshots, so `seen_pos` ageing would eventually empty
            # them; keep everything the recording contained.
            self._frames.append(parse_aircraft_list(entries, max_age_s=None))
            self._names.append(path.stem)
        if not self._frames:
            raise SourceError(
                f"no fixtures matched in {self.dir}",
                hint="expected *.json snapshots of a dump1090 aircraft.json response",
            )

    @property
    def healthy(self) -> bool:
        return True

    @property
    def fixtures(self) -> list[str]:
        return list(self._names)

    @property
    def current_fixture(self) -> str:
        return self._names[self._index()]

    def select(self, name: str) -> None:
        """Pin replay to one fixture — used by tests and by `--frame` style debugging."""
        stem = name.removesuffix(".json")
        if stem not in self._names:
            raise SourceError(f"no fixture named {stem!r}", hint=f"have: {', '.join(self._names)}")
        self._forced = self._names.index(stem)

    def resume(self) -> None:
        self._forced = None

    def _index(self) -> int:
        if self._forced is not None:
            return self._forced
        elapsed = (time.monotonic() - self._start) * self.speed
        return int(elapsed // self.step_s) % len(self._frames)

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        frame = self._frames[self._index()]
        # Copy: callers annotate distance/bearing in place and fixtures are reused.
        out: list[Aircraft] = []
        for ac in frame:
            if ac.lat is None or ac.lon is None:
                continue
            if haversine_nm(lat, lon, ac.lat, ac.lon) > radius_nm:
                continue
            out.append(_copy(ac))
        return out

    async def aclose(self) -> None:
        return None


def _copy(ac: Aircraft) -> Aircraft:
    return Aircraft(
        hex=ac.hex,
        callsign=ac.callsign,
        lat=ac.lat,
        lon=ac.lon,
        alt_baro_ft=ac.alt_baro_ft,
        gs_kt=ac.gs_kt,
        track_deg=ac.track_deg,
        vert_rate=ac.vert_rate,
        squawk=ac.squawk,
        type_code=ac.type_code,
        registration=ac.registration,
        category=ac.category,
        seen_pos_s=ac.seen_pos_s,
        on_ground=ac.on_ground,
    )
