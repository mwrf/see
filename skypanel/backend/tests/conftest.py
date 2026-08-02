"""Shared fixtures.

Two rules the whole suite obeys: no test touches the network, and every external HTTP
interaction is served from a recorded cassette in `tests/cassettes/`. `cassette()`
builds an `httpx.MockTransport` from one, so the client under test is the real client —
retries, timeouts, token bucket and all — with only the socket replaced.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from skypanel.colours import data_dir, reload_airlines
from skypanel.config import Config, EnrichConfig, SourceConfig
from skypanel.enrich import airports
from skypanel.enrich.cache import Cache
from skypanel.history import History
from skypanel.settings import Settings, SettingsStore
from skypanel.sources.mock import MockSource

CASSETTE_DIR = Path(__file__).parent / "cassettes"


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail loudly if anything tries to open a real socket."""

    def _boom(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("a test tried to make a real network connection")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _boom)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _boom)
    # Starlette's TestClient rides on httpx2; block its real transports too.
    try:
        import httpx2
    except ImportError:
        return
    monkeypatch.setattr(httpx2.AsyncHTTPTransport, "handle_async_request", _boom)
    monkeypatch.setattr(httpx2.HTTPTransport, "handle_request", _boom)


@pytest.fixture(autouse=True)
def _fresh_data_caches() -> Iterator[None]:
    reload_airlines()
    airports.reload()
    yield
    reload_airlines()
    airports.reload()


def load_cassette(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((CASSETTE_DIR / f"{name}.json").read_text(encoding="utf-8"))
    return data


def cassette(
    name: str, *, on_request: Callable[[httpx.Request], None] | None = None
) -> httpx.MockTransport:
    """A transport that replays a recorded cassette.

    A cassette is `{"<METHOD> <url-or-suffix>": {"status": int, "json": ...}}`. URLs are
    matched by exact string first, then by suffix, so a cassette can be written against
    a path while the client under test uses a full base URL.
    """
    recorded = load_cassette(name)

    def handler(request: httpx.Request) -> httpx.Response:
        if on_request is not None:
            on_request(request)
        url = str(request.url)
        key = f"{request.method} {url}"
        entry = recorded.get(key)
        if entry is None:
            for recorded_key, value in recorded.items():
                method, _, suffix = recorded_key.partition(" ")
                if method == request.method and url.endswith(suffix):
                    entry = value
                    break
        if entry is None:
            return httpx.Response(404, json={"error": "not in cassette", "url": url})
        return httpx.Response(
            entry.get("status", 200),
            json=entry.get("json"),
            headers=entry.get("headers", {}),
            text=entry.get("text"),
        )

    return httpx.MockTransport(handler)


def sequence_transport(responses: list[httpx.Response]) -> httpx.MockTransport:
    """Replays a fixed list of responses in order, repeating the last one."""
    remaining = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        return remaining.pop(0) if len(remaining) > 1 else remaining[0]

    return httpx.MockTransport(handler)


@pytest.fixture
def cache() -> Iterator[Cache]:
    c = Cache(":memory:")
    yield c
    c.close()


@pytest.fixture
def history() -> Iterator[History]:
    h = History(":memory:")
    yield h
    h.close()


@pytest.fixture
def fixture_dir() -> Path:
    return data_dir() / "fixtures"


@pytest.fixture
def mock_source(fixture_dir: Path) -> MockSource:
    source = MockSource(fixture_dir)
    source.select("dublin_approach")
    return source


@pytest.fixture
def settings() -> Settings:
    """Dublin, defaults elsewhere — matches the bundled fixtures."""
    return Settings(home_lat=53.3498, home_lon=-6.2603)


@pytest.fixture
def settings_store(tmp_path: Path, settings: Settings) -> SettingsStore:
    store = SettingsStore(tmp_path / "settings.json")
    store.replace(settings)
    return store


@pytest.fixture
def config(tmp_path: Path, fixture_dir: Path) -> Config:
    return Config(
        source=SourceConfig(mode="mock", mock_fixture_dir=fixture_dir),
        enrich=EnrichConfig(aeroapi_key=None),
        state_dir=tmp_path,
    )
