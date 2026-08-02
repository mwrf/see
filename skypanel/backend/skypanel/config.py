"""Deployment configuration: which feed, which host, which keys, where state lives.

Read from `config.toml` (searched next to the backend, then `$SKYPANEL_CONFIG`) and
overlaid with environment variables. Secrets come from the environment only — never
from the TOML file, which is checked in.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

SourceMode = Literal["local", "aggregator", "mock", "auto"]

AGGREGATOR_PROVIDERS: dict[str, str] = {
    "adsb_fi": "https://opendata.adsb.fi/api",
    "adsb_lol": "https://api.adsb.lol",
    "airplanes_live": "https://api.airplanes.live/v2",
}

AGGREGATOR_ATTRIBUTION: dict[str, str] = {
    "adsb_fi": "Data by adsb.fi — non-commercial use, attribution required",
    "adsb_lol": "Data by adsb.lol — ODbL",
    "airplanes_live": "Data by airplanes.live",
}


@dataclass(slots=True)
class SourceConfig:
    mode: SourceMode = "mock"
    local_host: str = "raspberrypi.local"
    local_path: str | None = None
    """Explicit aircraft.json path; when None the client probes the known candidates."""
    aggregator_provider: str = "adsb_fi"
    failover: bool = True
    failover_after_s: float = 60.0
    poll_interval_s: float = 1.0
    mock_fixture_dir: Path | None = None
    mock_speed: float = 1.0


ADSBDB_BASE = "https://api.adsbdb.com"
AEROAPI_BASE = "https://aeroapi.flightaware.com/aeroapi"


@dataclass(slots=True)
class EnrichConfig:
    adsbdb_base: str = ADSBDB_BASE
    aeroapi_base: str = AEROAPI_BASE
    aeroapi_key: str | None = None
    aeroapi_monthly_limit: int = 400
    """Hard ceiling on AeroAPI calls per calendar month; degrade to adsbdb when hit."""
    route_ttl_s: int = 12 * 3600
    aircraft_ttl_s: int = 30 * 86400
    negative_ttl_s: int = 3600


@dataclass(slots=True)
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 8000
    firmware_manifest: str | None = None


@dataclass(slots=True)
class Config:
    source: SourceConfig = field(default_factory=SourceConfig)
    enrich: EnrichConfig = field(default_factory=EnrichConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    state_dir: Path = field(default_factory=lambda: Path("var"))

    @property
    def settings_path(self) -> Path:
        return self.state_dir / "settings.json"

    @property
    def cache_path(self) -> Path:
        return self.state_dir / "cache.sqlite3"

    @property
    def history_path(self) -> Path:
        return self.state_dir / "history.sqlite3"

    def aggregator_base(self) -> str:
        provider = self.source.aggregator_provider
        if provider not in AGGREGATOR_PROVIDERS:
            raise ValueError(
                f"unknown aggregator provider {provider!r}; "
                f"expected one of {sorted(AGGREGATOR_PROVIDERS)}"
            )
        return AGGREGATOR_PROVIDERS[provider]

    def attribution(self) -> str | None:
        return AGGREGATOR_ATTRIBUTION.get(self.source.aggregator_provider)


def _default_config_path() -> Path | None:
    env = os.environ.get("SKYPANEL_CONFIG")
    if env:
        return Path(env)
    candidate = Path(__file__).resolve().parent.parent / "config.toml"
    return candidate if candidate.exists() else None


def _section(raw: dict[str, Any], name: str) -> dict[str, Any]:
    value = raw.get(name, {})
    return value if isinstance(value, dict) else {}


SOURCE_MODES: frozenset[str] = frozenset({"local", "aggregator", "mock", "auto"})


def _source_mode(raw: Any) -> SourceMode:
    """Validate at load time so a typo is a startup error, not a mystery empty panel."""
    if raw not in SOURCE_MODES:
        raise ValueError(f"unknown source mode {raw!r}; expected one of {sorted(SOURCE_MODES)}")
    mode: SourceMode = raw
    return mode


def load_config(path: Path | None = None) -> Config:
    """Build a `Config` from TOML plus environment overrides."""
    path = path if path is not None else _default_config_path()
    raw: dict[str, Any] = {}
    if path is not None and path.exists():
        raw = tomllib.loads(path.read_text(encoding="utf-8"))

    src = _section(raw, "source")
    enr = _section(raw, "enrich")
    srv = _section(raw, "server")

    source = SourceConfig(
        mode=_source_mode(os.environ.get("SKYPANEL_SOURCE_MODE", src.get("mode", "mock"))),
        local_host=os.environ.get(
            "SKYPANEL_LOCAL_HOST", src.get("local_host", "raspberrypi.local")
        ),
        local_path=src.get("local_path"),
        aggregator_provider=os.environ.get(
            "SKYPANEL_AGGREGATOR", src.get("aggregator_provider", "adsb_fi")
        ),
        failover=bool(src.get("failover", True)),
        failover_after_s=float(src.get("failover_after_s", 60.0)),
        poll_interval_s=float(src.get("poll_interval_s", 1.0)),
        mock_fixture_dir=Path(src["mock_fixture_dir"]) if src.get("mock_fixture_dir") else None,
        mock_speed=float(src.get("mock_speed", 1.0)),
    )

    enrich = EnrichConfig(
        adsbdb_base=enr.get("adsbdb_base", ADSBDB_BASE),
        aeroapi_base=enr.get("aeroapi_base", AEROAPI_BASE),
        aeroapi_key=os.environ.get("AEROAPI_KEY") or None,
        aeroapi_monthly_limit=int(enr.get("aeroapi_monthly_limit", 400)),
        route_ttl_s=int(enr.get("route_ttl_s", 12 * 3600)),
        aircraft_ttl_s=int(enr.get("aircraft_ttl_s", 30 * 86400)),
        negative_ttl_s=int(enr.get("negative_ttl_s", 3600)),
    )

    server = ServerConfig(
        host=os.environ.get("SKYPANEL_HOST", srv.get("host", "0.0.0.0")),
        port=int(os.environ.get("SKYPANEL_PORT", srv.get("port", 8000))),
        firmware_manifest=srv.get("firmware_manifest"),
    )

    state_dir = Path(os.environ.get("SKYPANEL_STATE_DIR", raw.get("state_dir", "var")))
    return Config(source=source, enrich=enrich, server=server, state_dir=state_dir)
