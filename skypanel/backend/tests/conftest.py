from __future__ import annotations

import json
from pathlib import Path

import pytest

from skypanel.airports import AirportRegistry
from skypanel.colours import AirlineRegistry
from skypanel.enrich.cache import EnrichmentCache
from skypanel.enrich.service import EnrichmentService
from skypanel.history import History
from skypanel.models import Aircraft
from skypanel.service import SkyPanelService
from skypanel.settings import AppConfig, Settings, SourceConfig
from skypanel.sources.manager import SourceManager
from skypanel.sources.mock import MockSource

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "data" / "fixtures"

#: Home for every test: Dublin city centre, as in the default settings.
HOME_LAT, HOME_LON = 53.3498, -6.2603


@pytest.fixture
def fixture_dir() -> Path:
    return FIXTURE_DIR


@pytest.fixture
def fixture_json():
    def _load(name: str) -> dict:
        return json.loads((FIXTURE_DIR / name).read_text())

    return _load


@pytest.fixture
def airlines() -> AirlineRegistry:
    return AirlineRegistry.load()


@pytest.fixture
def airports() -> AirportRegistry:
    return AirportRegistry.load()


@pytest.fixture
def cache() -> EnrichmentCache:
    return EnrichmentCache(":memory:")


@pytest.fixture
def settings() -> Settings:
    return Settings(home_lat=HOME_LAT, home_lon=HOME_LON)


@pytest.fixture
def enrichment(cache, airlines, airports) -> EnrichmentService:
    """Enrichment with no providers: local data only, no I/O of any kind."""
    return EnrichmentService(cache, adsbdb=None, aeroapi=None, airlines=airlines, airports=airports)


@pytest.fixture
def mock_source() -> MockSource:
    #  speed=0 pins the fixture; tests step it explicitly with advance().
    return MockSource(FIXTURE_DIR, speed=0.0)


@pytest.fixture
def service(mock_source, enrichment, settings) -> SkyPanelService:
    manager = SourceManager(SourceConfig(mode="mock"), primary=mock_source, fallback=None)
    return SkyPanelService(
        AppConfig(),
        manager=manager,
        enrichment=enrichment,
        settings=settings,
        history=History(":memory:"),
        airlines=enrichment.airlines,
        airports=enrichment.airports,
    )


def aircraft(**kwargs) -> Aircraft:
    """A positioned aircraft near Dublin, with fields overridable per test."""
    base = {
        "hex": "4ca7b3",
        "callsign": "RYR1812",
        "lat": 53.3621,
        "lon": -6.1194,
        "alt_baro_ft": 24000.0,
        "gs_kt": 410.0,
        "track_deg": 87.0,
        "type_code": "B738",
        "registration": "EI-DYR",
        "seen_pos_s": 0.3,
    }
    base.update(kwargs)
    return Aircraft(**base)
