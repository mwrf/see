from __future__ import annotations

import pytest

from skypanel.config import AGGREGATOR_PROVIDERS, load_config

TOML = """
state_dir = "state"

[source]
mode = "local"
local_host = "pi.local"
failover = false

[enrich]
aeroapi_monthly_limit = 25

[server]
port = 9001
"""


def write(tmp_path, text: str):
    path = tmp_path / "config.toml"
    path.write_text(text, encoding="utf-8")
    return path


def test_config_loads_from_toml(tmp_path):
    config = load_config(write(tmp_path, TOML))
    assert config.source.mode == "local"
    assert config.source.local_host == "pi.local"
    assert config.source.failover is False
    assert config.enrich.aeroapi_monthly_limit == 25
    assert config.server.port == 9001
    assert config.state_dir.name == "state"


def test_environment_overrides_the_file(tmp_path, monkeypatch):
    monkeypatch.setenv("SKYPANEL_SOURCE_MODE", "mock")
    monkeypatch.setenv("SKYPANEL_LOCAL_HOST", "other.local")
    monkeypatch.setenv("SKYPANEL_PORT", "8123")
    config = load_config(write(tmp_path, TOML))
    assert config.source.mode == "mock"
    assert config.source.local_host == "other.local"
    assert config.server.port == 8123


def test_secrets_come_from_the_environment_only(tmp_path, monkeypatch):
    monkeypatch.delenv("AEROAPI_KEY", raising=False)
    assert load_config(write(tmp_path, TOML)).enrich.aeroapi_key is None
    monkeypatch.setenv("AEROAPI_KEY", "secret")
    assert load_config(write(tmp_path, TOML)).enrich.aeroapi_key == "secret"


def test_a_typo_in_source_mode_fails_at_startup(tmp_path):
    with pytest.raises(ValueError, match="unknown source mode"):
        load_config(write(tmp_path, '[source]\nmode = "locl"\n'))


def test_missing_config_file_yields_usable_defaults(tmp_path):
    config = load_config(tmp_path / "absent.toml")
    assert config.source.mode == "mock"
    assert config.server.port == 8000


def test_state_paths_hang_off_the_state_dir(tmp_path):
    config = load_config(write(tmp_path, TOML))
    assert config.settings_path.name == "settings.json"
    assert config.cache_path.parent == config.state_dir
    assert config.history_path.parent == config.state_dir


@pytest.mark.parametrize("provider", sorted(AGGREGATOR_PROVIDERS))
def test_every_provider_resolves_to_a_base_url_and_attribution(tmp_path, provider):
    config = load_config(write(tmp_path, f'[source]\naggregator_provider = "{provider}"\n'))
    assert config.aggregator_base().startswith("https://")
    assert config.attribution()
