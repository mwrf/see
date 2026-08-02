"""The ``mock`` source: replay recorded fixtures, forever, offline.

Every test in the suite uses this.  It is also what you develop the renderer
against on a laptop with no receiver in sight.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from ..models import Aircraft
from ..paths import data_dir
from .base import SourceError
from .local import parse_aircraft_json

DEFAULT_FIXTURE_DIR = data_dir() / "fixtures"


class MockSource:
    """Cycles through fixture files at ``1 / speed`` seconds per frame."""

    name = "mock"

    def __init__(
        self,
        fixtures: Sequence[Path] | Path | None = None,
        *,
        speed: float = 1.0,
        loop: bool = True,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.speed = max(0.0, speed)
        self.loop = loop
        self._clock = clock
        self._start = clock()
        self._frames = _load_fixtures(fixtures)
        if not self._frames:
            raise SourceError(
                "mock source has no fixtures to replay",
                hint=f"put aircraft.json snapshots in {DEFAULT_FIXTURE_DIR}, "
                "or run 'just capture-fixtures' against a live receiver",
            )
        self.index = 0

    @property
    def healthy(self) -> bool:
        return True

    @property
    def frame_count(self) -> int:
        return len(self._frames)

    async def aclose(self) -> None:
        return None

    def _advance(self) -> int:
        """Pick the frame the fake clock says we should be on."""
        if self.speed == 0.0:
            return self.index
        elapsed = self._clock() - self._start
        step = int(elapsed * self.speed)
        if not self.loop:
            return min(step, len(self._frames) - 1)
        return step % len(self._frames)

    def advance(self, frames: int = 1) -> None:
        """Step manually; used by tests that do not want a clock at all."""
        self.index = (self.index + frames) % len(self._frames)
        self.speed = 0.0

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        if self.speed:
            self.index = self._advance()
        return list(self._frames[self.index])


def _load_fixtures(fixtures: Sequence[Path] | Path | None) -> list[list[Aircraft]]:
    paths = _resolve_paths(fixtures)
    frames: list[list[Aircraft]] = []
    for path in paths:
        payload: Any = json.loads(path.read_text())
        frames.append(parse_aircraft_json(payload, max_seen_pos_s=float("inf")))
    return frames


def _resolve_paths(fixtures: Sequence[Path] | Path | None) -> list[Path]:
    if fixtures is None:
        return sorted(DEFAULT_FIXTURE_DIR.glob("*.json"))
    if isinstance(fixtures, Path):
        if fixtures.is_dir():
            return sorted(fixtures.glob("*.json"))
        return [fixtures]
    return [Path(p) for p in fixtures]
