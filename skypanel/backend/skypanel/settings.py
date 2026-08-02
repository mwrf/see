"""Configuration and persisted user settings.

Two things live here and they are deliberately separate:

* :class:`AppConfig` -- deployment configuration read from ``config.toml``:
  which source to use, where the receiver is, which aggregator, cache paths.
  Changing it needs a restart.
* :class:`Settings` -- user preferences edited from the phone-friendly web UI
  and persisted as JSON.  Changing them takes effect on the device's next poll,
  which is why every unit choice and field selection lives here rather than in
  the firmware.
"""

from __future__ import annotations

import json
import os
import tomllib
from dataclasses import asdict, dataclass, field, fields
from datetime import time as dtime
from pathlib import Path
from typing import Any, Self, get_args, get_origin

from .units import AltitudeUnit, DistanceUnit, SpeedUnit

DEFAULT_CONFIG_PATH = Path(os.environ.get("SKYPANEL_CONFIG", "config.toml"))
DEFAULT_STATE_DIR = Path(
    os.environ.get("SKYPANEL_STATE_DIR", "~/.local/state/skypanel")
).expanduser()

CATEGORIES = ("airline", "military", "helicopter", "ga", "unknown")
LINE_KEYS = ("airline", "flight", "detail")


class SettingsError(ValueError):
    """A setting was rejected; the message is shown directly in the UI."""


@dataclass(slots=True)
class SourceConfig:
    mode: str = "auto"  # local | aggregator | mock | auto
    local_host: str = "raspberrypi.local"
    local_path: str | None = None
    aggregator_provider: str = "adsb_fi"
    failover: bool = True
    #: Seconds of continuous local unhealthiness before failover fires.
    failover_after_s: float = 60.0
    mock_speed: float = 1.0
    fixture_dir: str | None = None


@dataclass(slots=True)
class EnrichConfig:
    adsbdb_enabled: bool = True
    adsbdb_base_url: str = "https://api.adsbdb.com"
    aeroapi_enabled: bool = False
    aeroapi_base_url: str = "https://aeroapi.flightaware.com/aeroapi"
    #: Hard ceiling on billable AeroAPI queries per calendar month.  Feeders get
    #: $10/month free; at roughly $0.005 a query that is ~2000, so the default
    #: leaves headroom.
    aeroapi_monthly_limit: int = 1500
    cache_path: str = "skypanel-cache.sqlite"
    route_ttl_s: int = 12 * 3600
    aircraft_ttl_s: int = 30 * 86400
    negative_ttl_s: int = 3600


@dataclass(slots=True)
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 8000
    settings_path: str = ""
    history_path: str = ""
    firmware_dir: str = "firmware-releases"


@dataclass(slots=True)
class AppConfig:
    source: SourceConfig = field(default_factory=SourceConfig)
    enrich: EnrichConfig = field(default_factory=EnrichConfig)
    server: ServerConfig = field(default_factory=ServerConfig)

    @classmethod
    def load(cls, path: Path | None = None) -> Self:
        """Read ``config.toml`` if it exists, otherwise use defaults throughout."""
        target = path or DEFAULT_CONFIG_PATH
        config = cls()
        if not target.exists():
            return config
        raw = tomllib.loads(target.read_text())
        _apply_section(config.source, raw.get("source", {}))
        _apply_section(config.enrich, raw.get("enrich", {}))
        _apply_section(config.server, raw.get("server", {}))
        return config

    def state_dir(self) -> Path:
        DEFAULT_STATE_DIR.mkdir(parents=True, exist_ok=True)
        return DEFAULT_STATE_DIR

    def settings_file(self) -> Path:
        if self.server.settings_path:
            return Path(self.server.settings_path).expanduser()
        return self.state_dir() / "settings.json"

    def history_file(self) -> Path:
        if self.server.history_path:
            return Path(self.server.history_path).expanduser()
        return self.state_dir() / "history.sqlite"

    def cache_file(self) -> Path:
        candidate = Path(self.enrich.cache_path).expanduser()
        if candidate.is_absolute():
            return candidate
        return self.state_dir() / candidate


def _apply_section(target: Any, values: dict[str, Any]) -> None:
    known = {f.name for f in fields(target)}
    for key, value in values.items():
        if key in known:
            setattr(target, key, value)


@dataclass(slots=True)
class Settings:
    """Everything a user can change without touching a config file."""

    # Where the panel is.
    home_lat: float = 53.3498
    home_lon: float = -6.2603
    site_name: str = "Home"

    # Units.
    altitude_unit: AltitudeUnit = "ft"
    speed_unit: SpeedUnit = "kt"
    distance_unit: DistanceUnit = "mi"

    # Content.
    route_display: str = "codes"  # codes | cities
    show_airline_line: bool = True
    show_flight_line: bool = True
    show_detail_line: bool = True
    show_vert_rate: bool = False
    categories: list[str] = field(default_factory=lambda: list(CATEGORIES))

    # Selection.
    scan_radius_mi: float = 30.0
    min_altitude_ft: float = 0.0
    max_altitude_ft: float = 60000.0

    # Panel.
    brightness: int = 60
    night_brightness: int = 15
    night_start: str = "23:00"
    night_end: str = "07:00"
    poll_interval_s: int = 5

    def validate(self) -> None:
        if not -90.0 <= self.home_lat <= 90.0:
            raise SettingsError("home_lat must be between -90 and 90")
        if not -180.0 <= self.home_lon <= 180.0:
            raise SettingsError("home_lon must be between -180 and 180")
        if self.altitude_unit not in get_args(AltitudeUnit):
            raise SettingsError(f"altitude_unit must be one of {get_args(AltitudeUnit)}")
        if self.speed_unit not in get_args(SpeedUnit):
            raise SettingsError(f"speed_unit must be one of {get_args(SpeedUnit)}")
        if self.distance_unit not in get_args(DistanceUnit):
            raise SettingsError(f"distance_unit must be one of {get_args(DistanceUnit)}")
        if self.route_display not in ("codes", "cities"):
            raise SettingsError("route_display must be 'codes' or 'cities'")
        if not 1.0 <= self.scan_radius_mi <= 200.0:
            raise SettingsError("scan_radius_mi must be between 1 and 200")
        if not 1 <= self.poll_interval_s <= 300:
            raise SettingsError("poll_interval_s must be between 1 and 300")
        for name in ("brightness", "night_brightness"):
            value = getattr(self, name)
            if not 0 <= value <= 100:
                raise SettingsError(f"{name} must be between 0 and 100")
        unknown = set(self.categories) - set(CATEGORIES)
        if unknown:
            raise SettingsError(f"unknown categories: {', '.join(sorted(unknown))}")
        for name in ("night_start", "night_end"):
            parse_hhmm(getattr(self, name), name)
        if self.min_altitude_ft > self.max_altitude_ft:
            raise SettingsError("min_altitude_ft must not exceed max_altitude_ft")

    def is_night(self, now: dtime) -> bool:
        """True inside the night window, which may wrap past midnight."""
        start = parse_hhmm(self.night_start, "night_start")
        end = parse_hhmm(self.night_end, "night_end")
        if start == end:
            return False
        if start < end:
            return start <= now < end
        return now >= start or now < end

    def effective_brightness(self, now: dtime) -> int:
        return self.night_brightness if self.is_night(now) else self.brightness

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Self:
        """Build settings from a partial dict, rejecting unknown keys.

        Rejecting rather than ignoring matters: a typo in a POST body would
        otherwise silently do nothing and look like a backend bug.
        """
        known = {f.name: f for f in fields(cls)}
        unknown = set(data) - set(known)
        if unknown:
            raise SettingsError(f"unknown settings: {', '.join(sorted(unknown))}")
        instance = cls()
        for key, value in data.items():
            setattr(instance, key, _coerce(known[key].type, value, key))
        instance.validate()
        return instance

    def merged(self, updates: dict[str, Any]) -> Self:
        base = self.to_json()
        base.update(updates)
        return type(self).from_json(base)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.to_json(), indent=2, sort_keys=True) + "\n")
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> Self:
        if not path.exists():
            return cls()
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return cls()
        if not isinstance(data, dict):
            return cls()
        try:
            return cls.from_json(data)
        except SettingsError:
            # A settings file written by an older version may carry keys we no
            # longer know; salvage what still applies rather than resetting.
            known = {f.name for f in fields(cls)}
            return cls.from_json({k: v for k, v in data.items() if k in known})


def parse_hhmm(value: str, field_name: str = "time") -> dtime:
    parts = str(value).split(":")
    if len(parts) != 2:
        raise SettingsError(f"{field_name} must look like HH:MM")
    try:
        hour, minute = int(parts[0]), int(parts[1])
        return dtime(hour=hour, minute=minute)
    except ValueError as exc:
        raise SettingsError(f"{field_name} must be a valid HH:MM time") from exc


def _coerce(annotation: Any, value: Any, key: str) -> Any:
    """Best-effort conversion of JSON values into the declared field type.

    Form posts arrive as strings, so ``"true"`` has to become ``True`` and
    ``"30"`` has to become ``30.0`` without the caller caring.
    """
    text = str(annotation)
    if get_origin(annotation) is list or text.startswith("list"):
        if isinstance(value, str):
            return [item for item in (part.strip() for part in value.split(",")) if item]
        if isinstance(value, list):
            return [str(item) for item in value]
        raise SettingsError(f"{key} must be a list")
    if "bool" in text:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("1", "true", "yes", "on")
    if "int" in text and "float" not in text:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            raise SettingsError(f"{key} must be a whole number") from None
    if "float" in text:
        try:
            return float(value)
        except (TypeError, ValueError):
            raise SettingsError(f"{key} must be a number") from None
    return str(value)
