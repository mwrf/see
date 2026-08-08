from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from skypanel.history import History
from skypanel.models import EnrichedAircraft, Route
from skypanel.tracking import TrackingSession, compute_progress

from .conftest import aircraft

START = datetime(2026, 8, 2, 9, 0, 0, tzinfo=UTC)


def session(**kwargs) -> TrackingSession:
    base = {"ident": "FR1812", "started_at": START}
    base.update(kwargs)
    return TrackingSession(**base)


def enriched(**overrides) -> EnrichedAircraft:
    base = {
        "aircraft": aircraft(),
        "distance_mi": 6.13,
        "bearing_deg": 71.0,
        "airline_code": "RYR",
        "airline_name": "RYANAIR",
        "route": Route(origin="EIDW", destination="EGSS"),
        "category": "airline",
    }
    base.update(overrides)
    return EnrichedAircraft(**base)


# -- session lifecycle --------------------------------------------------


def test_session_matches_the_flight_by_several_identifiers(airlines):
    s = session()
    assert s.matches(aircraft(), airlines) is True
    assert s.matches(aircraft(callsign="BAW23K", registration=None), airlines) is False


def test_observing_a_sighting_records_state():
    s = session()
    s.observe(enriched(), START)
    assert s.acquired is True
    assert s.last_seen_at == START
    assert s.destination == "EGSS"


def test_a_never_acquired_flight_gives_up_after_ten_minutes():
    s = session()
    assert s.should_end(START + timedelta(minutes=5)) is None
    assert s.should_end(START + timedelta(minutes=11)) == "not-found"


def test_an_aircraft_on_the_ground_has_landed():
    s = session()
    s.observe(enriched(aircraft=aircraft(alt_baro_ft=0.0)), START)
    assert s.has_landed() is True
    assert s.should_end(START) == "landed"


def test_low_and_descending_counts_as_landed():
    s = session()
    s.observe(enriched(aircraft=aircraft(alt_baro_ft=400.0, vert_rate=-640)), START)
    assert s.should_end(START) == "landed"


def test_low_but_climbing_is_a_departure_not_a_landing():
    s = session()
    s.observe(enriched(aircraft=aircraft(alt_baro_ft=400.0, vert_rate=900)), START)
    assert s.should_end(START) is None


def test_a_cruising_flight_that_leaves_range_is_lost_not_landed():
    s = session()
    s.observe(enriched(), START)
    assert s.should_end(START + timedelta(minutes=5)) is None
    assert s.should_end(START + timedelta(minutes=11)) == "lost"


def test_a_low_flight_that_vanishes_is_assumed_to_have_landed():
    s = session()
    s.observe(enriched(aircraft=aircraft(alt_baro_ft=300.0, vert_rate=0)), START)
    assert s.should_end(START + timedelta(minutes=3)) == "landed"


# -- progress -----------------------------------------------------------


def test_progress_is_computed_from_route_geometry(airports):
    #  Dublin to Stansted; the aircraft in the fixture is just east of Dublin,
    #  so it should be near the start of the route.
    progress = compute_progress(session(), enriched(), airports, now=START)
    assert progress is not None
    assert 0.0 <= progress.fraction <= 0.25


def test_progress_reaches_one_at_the_destination(airports):
    stansted = aircraft(lat=51.885, lon=0.235)
    progress = compute_progress(session(), enriched(aircraft=stansted), airports, now=START)
    assert progress is not None
    assert progress.fraction == pytest.approx(1.0, abs=0.01)


def test_progress_is_clamped_to_the_zero_one_range(airports):
    beyond = aircraft(lat=51.0, lon=3.0)  # overshot the destination
    progress = compute_progress(session(), enriched(aircraft=beyond), airports, now=START)
    assert progress is not None
    assert 0.0 <= progress.fraction <= 1.0


def test_progress_falls_back_to_time_when_airports_are_unknown(airports):
    route = Route(origin="ZZZZ", destination="YYYY", eta=START + timedelta(hours=1))
    s = session()
    s.observe(enriched(route=route), START)
    progress = compute_progress(
        s, enriched(route=route), airports, now=START + timedelta(minutes=30)
    )
    assert progress is not None
    assert progress.fraction == pytest.approx(0.5, abs=0.01)


def test_progress_is_none_when_nothing_is_known(airports):
    assert compute_progress(session(), enriched(route=Route()), airports, now=START) is None


def test_eta_is_formatted_as_wall_clock(airports):
    route = Route(origin="EIDW", destination="EGSS", eta=datetime(2026, 8, 2, 13, 14, tzinfo=UTC))
    progress = compute_progress(session(), enriched(route=route), airports, now=START)
    assert progress is not None and progress.eta == "13:14"


# -- history ------------------------------------------------------------


class FakeClock:
    def __init__(self, start: float = 1_754_126_043.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_repeated_sightings_of_one_pass_become_a_single_row():
    clock = FakeClock()
    history = History(":memory:", clock=clock)
    for _ in range(20):
        history.record(enriched())
        clock.advance(5)
    assert len(history.recent(24)) == 1


def test_a_later_pass_starts_a_new_row():
    clock = FakeClock()
    history = History(":memory:", clock=clock)
    history.record(enriched())
    clock.advance(3600)
    history.record(enriched())
    assert len(history.recent(24)) == 2


def test_closest_approach_is_the_minimum_seen():
    clock = FakeClock()
    history = History(":memory:", clock=clock)
    history.record(enriched(distance_mi=12.0))
    clock.advance(5)
    history.record(enriched(distance_mi=3.2))
    clock.advance(5)
    history.record(enriched(distance_mi=9.0))
    assert history.recent(24)[0]["closest_mi"] == pytest.approx(3.2)


def test_summary_counts_distinct_aircraft():
    history = History(":memory:")
    history.record(enriched())
    history.record(enriched(aircraft=aircraft(hex="4008f2", callsign="BAW23K")))
    summary = history.summary(24)
    assert summary["aircraft"] == 2
    assert summary["top_airlines"][0]["airline_name"] == "RYANAIR"


def test_history_window_excludes_older_rows():
    clock = FakeClock()
    history = History(":memory:", clock=clock)
    history.record(enriched())
    clock.advance(7200)
    assert history.recent(hours=1) == []
    assert len(history.recent(hours=24)) == 1


def test_pruning_drops_rows_past_the_retention_window():
    clock = FakeClock()
    history = History(":memory:", clock=clock, retention_days=1)
    history.record(enriched())
    clock.advance(2 * 86400)
    assert history.prune() == 1
    assert history.recent(hours=24 * 30) == []


def test_late_arriving_fields_backfill_the_row():
    clock = FakeClock()
    history = History(":memory:", clock=clock)
    history.record(enriched(aircraft=aircraft(type_code=None), route=Route()))
    clock.advance(5)
    history.record(enriched())
    row = history.recent(24)[0]
    assert row["type_code"] == "B738"
    assert row["destination"] == "EGSS"
