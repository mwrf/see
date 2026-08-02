"""User settings: what the panel shows and in which units.

These are the knobs exposed in the web UI and over `POST /api/settings`. They are
persisted as JSON next to the cache so a restart doesn't reset the display.
Deployment-level configuration (which feed, which host, API keys) lives in `config.py`.
"""

from __future__ import annotations

import logging
from datetime import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .models import Category
from .units import AltitudeUnit, DistanceUnit, SpeedUnit

log = logging.getLogger(__name__)

RouteDisplay = Literal["codes", "cities"]
LineId = Literal["airline", "route", "telemetry", "bearing"]

DEFAULT_LINES: list[LineId] = ["airline", "route", "telemetry"]


class Settings(BaseModel):
    """Everything a user can change without touching a config file."""

    # Where the panel is.
    home_lat: float = Field(default=53.3498, ge=-90, le=90)
    home_lon: float = Field(default=-6.2603, ge=-180, le=180)

    # Units.
    altitude_unit: AltitudeUnit = "ft"
    speed_unit: SpeedUnit = "kt"
    distance_unit: DistanceUnit = "mi"

    # Content.
    route_display: RouteDisplay = "codes"
    lines: list[LineId] = Field(default_factory=lambda: DEFAULT_LINES.copy())
    categories: list[Category] = Field(
        default_factory=lambda: [
            Category.AIRLINE,
            Category.MILITARY,
            Category.HELICOPTER,
            Category.GA,
            Category.UNKNOWN,
        ]
    )

    # Scan.
    scan_radius: float = Field(default=30.0, ge=1.0, le=200.0)
    """In `distance_unit`, per the spec's 1–200 mi range."""
    max_age_s: float = Field(default=30.0, ge=1.0, le=300.0)

    # Panel.
    brightness: int = Field(default=60, ge=1, le=255)
    night_brightness: int = Field(default=12, ge=1, le=255)
    night_start: time = time(23, 0)
    night_end: time = time(7, 0)
    poll_interval_s: float = Field(default=5.0, ge=1.0, le=120.0)

    @field_validator("lines")
    @classmethod
    def _at_least_one_line(cls, v: list[LineId]) -> list[LineId]:
        if not v:
            raise ValueError("at least one line must be enabled")
        # Preserve the caller's order but drop duplicates.
        return list(dict.fromkeys(v))

    @field_validator("categories")
    @classmethod
    def _at_least_one_category(cls, v: list[Category]) -> list[Category]:
        if not v:
            raise ValueError("at least one category must be enabled")
        return list(dict.fromkeys(v))

    def is_night(self, now: time) -> bool:
        """True inside the night window, which may wrap past midnight."""
        if self.night_start == self.night_end:
            return False
        if self.night_start < self.night_end:
            return self.night_start <= now < self.night_end
        return now >= self.night_start or now < self.night_end

    def effective_brightness(self, now: time) -> int:
        return self.night_brightness if self.is_night(now) else self.brightness


class SettingsStore:
    """Load/save `Settings` as a JSON file, tolerating a corrupt or absent file."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._settings = self._load()

    def _load(self) -> Settings:
        if not self.path.exists():
            return Settings()
        try:
            return Settings.model_validate_json(self.path.read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            log.warning("settings at %s unreadable (%s); falling back to defaults", self.path, exc)
            return Settings()

    @property
    def current(self) -> Settings:
        return self._settings

    def replace(self, settings: Settings) -> Settings:
        self._settings = settings
        self.save()
        return self._settings

    def update(self, patch: dict[str, object]) -> Settings:
        """Apply a partial update, validating the merged result."""
        merged = self._settings.model_dump(mode="json") | patch
        self._settings = Settings.model_validate(merged)
        self.save()
        return self._settings

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(self._settings.model_dump_json(indent=2), encoding="utf-8")
        tmp.replace(self.path)
