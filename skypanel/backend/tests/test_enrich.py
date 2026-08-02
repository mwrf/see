from __future__ import annotations

from datetime import UTC, datetime

import pytest

from skypanel.colours import MIN_PANEL_LEVEL, panel_level
from skypanel.enrich.adsbdb import AdsbdbClient
from skypanel.enrich.aeroapi import AeroApiClient, QuotaExhausted
from skypanel.enrich.cache import CacheTTLs, EnrichmentCache
from skypanel.enrich.categorise import categorise, is_emergency, is_military_hex
from skypanel.enrich.service import EnrichmentService
from skypanel.http import HttpClient, RetryPolicy

from .cassettes import cassette_transport
from .conftest import HOME_LAT, HOME_LON, aircraft


class FakeClock:
    def __init__(self, start: float = 1_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def adsbdb(calls: list[str] | None = None) -> AdsbdbClient:
    return AdsbdbClient(
        client=HttpClient(
            retry=RetryPolicy(attempts=1), transport=cassette_transport("adsbdb", calls=calls)
        )
    )


def aeroapi(
    cache: EnrichmentCache, *, limit: int = 10, calls: list[str] | None = None
) -> AeroApiClient:
    return AeroApiClient(
        "test-key",
        cache,
        monthly_limit=limit,
        client=HttpClient(
            retry=RetryPolicy(attempts=1), transport=cassette_transport("aeroapi", calls=calls)
        ),
    )


# -- cache --------------------------------------------------------------


def test_cache_miss_is_distinguishable_from_a_cached_negative(cache):
    assert cache.get("route", "NOPE1") == (False, None)
    cache.put("route", "NOPE1", None)
    assert cache.get("route", "NOPE1") == (True, None)


def test_cache_keys_are_case_insensitive(cache):
    cache.put("route", "ryr1812", {"origin": "EIDW"})
    found, payload = cache.get("route", "RYR1812")
    assert found and payload == {"origin": "EIDW"}


def test_route_entries_expire_after_twelve_hours():
    clock = FakeClock()
    cache = EnrichmentCache(":memory:", ttls=CacheTTLs(), clock=clock)
    cache.put("route", "RYR1812", {"origin": "EIDW"})
    clock.advance(11 * 3600)
    assert cache.get("route", "RYR1812")[0] is True
    clock.advance(2 * 3600)
    assert cache.get("route", "RYR1812")[0] is False


def test_aircraft_entries_last_thirty_days():
    clock = FakeClock()
    cache = EnrichmentCache(":memory:", clock=clock)
    cache.put("aircraft", "4CA7B3", {"type_code": "B738"})
    clock.advance(29 * 86400)
    assert cache.get("aircraft", "4CA7B3")[0] is True


def test_negative_lookups_expire_after_an_hour():
    clock = FakeClock()
    cache = EnrichmentCache(":memory:", clock=clock)
    cache.put("route", "RCH485", None)
    clock.advance(3000)
    assert cache.get("route", "RCH485")[0] is True
    clock.advance(1000)
    assert cache.get("route", "RCH485")[0] is False


def test_warm_loads_unexpired_rows_from_disk(tmp_path):
    path = tmp_path / "cache.sqlite"
    first = EnrichmentCache(path)
    first.put("route", "RYR1812", {"origin": "EIDW"})
    first.close()

    second = EnrichmentCache(path)
    assert second.warm() == 1
    assert second.get("route", "RYR1812")[1] == {"origin": "EIDW"}


def test_warm_drops_expired_rows(tmp_path):
    clock = FakeClock()
    path = tmp_path / "cache.sqlite"
    first = EnrichmentCache(path, clock=clock)
    first.put("route", "RYR1812", {"origin": "EIDW"})
    first.close()
    clock.advance(13 * 3600)
    assert EnrichmentCache(path, clock=clock).warm() == 0


def test_cache_stats_track_the_hit_rate(cache):
    cache.put("route", "A", {"x": 1})
    cache.get("route", "A")
    cache.get("route", "B")
    stats = cache.stats.to_json()
    assert stats["hits"] == 1 and stats["misses"] == 1 and stats["hit_rate_pct"] == 50


def test_counters_persist_and_reset(cache):
    assert cache.bump("queries") == 1
    assert cache.bump("queries", 4) == 5
    cache.reset_counter("queries")
    assert cache.counter("queries") == 0


# -- adsbdb -------------------------------------------------------------


async def test_adsbdb_returns_route_and_airline():
    record = await adsbdb().callsign("RYR1812")
    assert record is not None
    assert record["origin"] == "EIDW"
    assert record["destination"] == "EGSS"
    assert record["airline_name"] == "Ryanair"
    assert record["destination_city"] == "London"


async def test_adsbdb_404_is_an_unknown_callsign_not_a_failure():
    assert await adsbdb().callsign("RCH485") is None


async def test_adsbdb_aircraft_lookup_returns_type_and_registration():
    record = await adsbdb().aircraft("4ca7b3")
    assert record is not None
    assert record["type_code"] == "B738"
    assert record["registration"] == "EI-DYR"


async def test_adsbdb_error_string_body_is_treated_as_unknown():
    client = AdsbdbClient(
        client=HttpClient(
            retry=RetryPolicy(attempts=1), transport=cassette_transport("adsbdb", strict=False)
        )
    )
    assert await client.callsign("NOSUCH1") is None


# -- AeroAPI quota ------------------------------------------------------


async def test_aeroapi_returns_scheduled_route_and_eta(cache):
    record = await aeroapi(cache).flight("RYR1812")
    assert record is not None
    assert record["origin"] == "EIDW"
    assert record["eta"] == "2026-08-02T09:58:00Z"
    assert record["progress_percent"] == 62


async def test_every_aeroapi_query_is_counted(cache):
    client = aeroapi(cache)
    await client.flight("RYR1812")
    await client.flight("RYR1812")
    assert client.queries_used() == 2


async def test_a_404_still_costs_a_query(cache):
    client = aeroapi(cache)
    assert await client.flight("BAW23K") is None
    assert client.queries_used() == 1


async def test_quota_ceiling_stops_further_queries(cache):
    calls: list[str] = []
    client = aeroapi(cache, limit=1, calls=calls)
    await client.flight("RYR1812")
    with pytest.raises(QuotaExhausted):
        await client.flight("RYR1812")
    assert len(calls) == 1, "no request may be made once the ceiling is reached"


async def test_quota_resets_when_the_month_rolls_over(cache):
    client = aeroapi(cache, limit=1)
    await client.flight("RYR1812", now=datetime(2026, 8, 2, tzinfo=UTC))
    assert client.quota_remaining(datetime(2026, 8, 30, tzinfo=UTC)) == 0
    assert client.quota_remaining(datetime(2026, 9, 1, tzinfo=UTC)) == 1


def test_quota_json_reports_usage_for_healthz(cache):
    assert aeroapi(cache, limit=10).quota_json() == {
        "used": 0,
        "limit": 10,
        "remaining": 10,
        "exhausted": False,
    }


# -- categorisation -----------------------------------------------------


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({"callsign": "RYR1812"}, "airline"),
        ({"callsign": "RCH485", "hex": "ae1442", "type_code": "C17"}, "military"),
        ({"callsign": "IAC252", "hex": "4ca8ff", "type_code": None}, "military"),
        ({"callsign": "RCG116", "type_code": "S92", "category": "A7"}, "helicopter"),
        ({"callsign": "IRL112", "type_code": "H145", "category": None}, "helicopter"),
        ({"callsign": "EIDYR", "type_code": "C172"}, "ga"),
        ({"callsign": None, "type_code": None}, "unknown"),
    ],
)
def test_categorisation(kwargs, expected, airlines):
    assert categorise(aircraft(**kwargs), airlines) == expected


def test_military_hex_ranges():
    assert is_military_hex("ae1442") is True
    assert is_military_hex("4ca7b3") is False
    assert is_military_hex(None) is False
    assert is_military_hex("not-hex") is False


def test_emergency_squawks_are_flagged():
    assert is_emergency(aircraft(squawk="7700")) is True
    assert is_emergency(aircraft(squawk="6132")) is False


# -- the service --------------------------------------------------------


async def test_enrich_adds_airline_colour_route_and_distance(cache, airlines, airports):
    service = EnrichmentService(cache, adsbdb=adsbdb(), airlines=airlines, airports=airports)
    result = await service.enrich(aircraft(), home_lat=HOME_LAT, home_lon=HOME_LON)
    assert result.airline_name == "RYANAIR"
    #  Ryanair's #073590 lifted so it survives the panel's gamma ramp; hue is
    #  preserved, only the value changes.
    assert result.airline_colour == "#0840AE"
    assert panel_level(result.airline_colour) >= MIN_PANEL_LEVEL - 1
    assert result.route.origin == "EIDW"
    assert result.route.destination_city == "London"
    assert result.distance_mi == pytest.approx(6.1, abs=0.5)


async def test_second_enrichment_of_the_same_callsign_hits_the_cache(cache, airlines, airports):
    calls: list[str] = []
    service = EnrichmentService(cache, adsbdb=adsbdb(calls), airlines=airlines, airports=airports)
    await service.enrich(aircraft(), home_lat=HOME_LAT, home_lon=HOME_LON)
    before = len(calls)
    await service.enrich(aircraft(), home_lat=HOME_LAT, home_lon=HOME_LON)
    assert len(calls) == before


async def test_unmatched_military_callsign_is_only_queried_once(cache, airlines, airports):
    calls: list[str] = []
    service = EnrichmentService(cache, adsbdb=adsbdb(calls), airlines=airlines, airports=airports)
    mil = aircraft(hex="ae1442", callsign="RCH485", type_code="C17", registration="05-5148")
    for _ in range(5):
        await service.enrich(mil, home_lat=HOME_LAT, home_lon=HOME_LON)
    assert len([c for c in calls if "callsign" in c]) == 1


async def test_type_code_from_enrichment_can_reclassify_as_helicopter(cache, airlines, airports):
    service = EnrichmentService(cache, adsbdb=adsbdb(), airlines=airlines, airports=airports)
    unknown_type = aircraft(hex="4ca44d", callsign="IRL112", type_code=None, registration=None)
    result = await service.enrich(unknown_type, home_lat=HOME_LAT, home_lon=HOME_LON)
    assert result.aircraft.type_code == "H145"
    assert result.category == "helicopter"


async def test_unknown_airline_renders_white(cache, airports):
    from skypanel.colours import AirlineRegistry

    service = EnrichmentService(cache, adsbdb=None, airlines=AirlineRegistry({}), airports=airports)
    result = await service.enrich(aircraft(), home_lat=HOME_LAT, home_lon=HOME_LON)
    assert result.airline_colour == "#FFFFFF"


async def test_aeroapi_is_not_spent_when_adsbdb_already_has_a_full_route(cache, airlines, airports):
    calls: list[str] = []
    service = EnrichmentService(
        cache,
        adsbdb=adsbdb(),
        aeroapi=aeroapi(cache, calls=calls),
        airlines=airlines,
        airports=airports,
    )
    #  adsbdb gives origin+destination but no ETA, so one query is justified.
    await service.enrich(aircraft(), home_lat=HOME_LAT, home_lon=HOME_LON)
    assert len(calls) == 1
    assert service.stats.aeroapi_calls == 1


async def test_service_degrades_to_adsbdb_when_the_quota_is_gone(cache, airlines, airports):
    service = EnrichmentService(
        cache,
        adsbdb=adsbdb(),
        aeroapi=aeroapi(cache, limit=0),
        airlines=airlines,
        airports=airports,
    )
    result = await service.enrich(aircraft(), home_lat=HOME_LAT, home_lon=HOME_LON)
    assert result.route.origin == "EIDW"
    assert service.stats.aeroapi_skipped == 1


async def test_enrichment_without_providers_still_produces_geometry(enrichment):
    result = await enrichment.enrich(aircraft(), home_lat=HOME_LAT, home_lon=HOME_LON)
    assert result.distance_mi > 0
    assert result.bearing_deg >= 0
    assert result.airline_name == "RYANAIR"  # from the local airline table alone
