from __future__ import annotations

import pytest

from skypanel.sources.base import SourceError
from skypanel.sources.mock import MockSource

from .test_http import FakeClock

HOME = (53.3498, -6.2603, 26.0)


def test_all_six_required_scenarios_are_present(fixture_dir):
    names = {p.name for p in fixture_dir.glob("*.json")}
    expected = {
        "01-busy-dublin.json",
        "02-single-distant.json",
        "03-empty-sky.json",
        "04-military.json",
        "05-helicopter.json",
        "06-no-route.json",
    }
    assert expected <= names


async def test_replay_advances_through_every_fixture(fixture_dir):
    source = MockSource(fixture_dir, speed=0.0)
    seen = []
    for _ in range(source.frame_count):
        seen.append(await source.fetch(*HOME))
        source.advance()
    assert len(seen) == source.frame_count


async def test_replay_loops_back_to_the_start(fixture_dir):
    source = MockSource(fixture_dir, speed=0.0)
    first = await source.fetch(*HOME)
    for _ in range(source.frame_count):
        source.advance()
    assert [ac.hex for ac in await source.fetch(*HOME)] == [ac.hex for ac in first]


async def test_speed_drives_the_frame_index_from_the_clock(fixture_dir):
    clock = FakeClock()
    source = MockSource(fixture_dir, speed=4.0, clock=clock)
    await source.fetch(*HOME)
    assert source.index == 0
    clock.advance(0.25)
    await source.fetch(*HOME)
    assert source.index == 1


async def test_a_single_fixture_file_can_be_replayed(fixture_dir):
    source = MockSource(fixture_dir / "03-empty-sky.json", speed=0.0)
    assert await source.fetch(*HOME) == []


async def test_empty_sky_fixture_is_empty_not_an_error(fixture_dir):
    source = MockSource(fixture_dir / "03-empty-sky.json", speed=0.0)
    assert await source.fetch(*HOME) == []
    assert source.healthy


def test_a_fixture_directory_with_nothing_in_it_is_a_clear_error(tmp_path):
    with pytest.raises(SourceError) as excinfo:
        MockSource(tmp_path, speed=0.0)
    assert "capture-fixtures" in (excinfo.value.hint or "")


async def test_mock_is_always_healthy(fixture_dir):
    assert MockSource(fixture_dir, speed=0.0).healthy
