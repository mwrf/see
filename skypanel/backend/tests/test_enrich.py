from __future__ import annotations

import time

import pytest

from skypanel.config import EnrichConfig
from skypanel.enrich import airports
from skypanel.enrich.adsbdb import AdsbdbClient
from skypanel.enrich.aeroapi import AeroApiClient, QuotaExceeded
from skypanel.enrich.cache import Cache
from skypanel.enrich.service import Enricher, classify
from skypanel.http import HttpClient, RetryPolicy
from skypanel.models import Aircraft, Category

from .conftest import cassette


def client(name: str, **kwargs) -> HttpClient:
    return HttpClient(
        timeout_s=1.0,
        retry=RetryPolicy(attempts=1, base_delay_s=0.0, jitter=False),
        transport=cassette(name, **kwargs),
    )


def adsbdb(**kwargs) -> AdsbdbClient:
    return AdsbdbClient("https://api.adsbdb.com", client=client("adsbdb", **kwargs))


# ------------------------------------------------------------------------ cache


def test_cache_round_trips_and_expires(cache: Cache):
    cache.put("route", "RYR1812", {"origin": "DUB"}, ttl_s=60)
    assert cache.get("route", "RYR1812") == {"origin": "DUB"}
    cache.put("route", "OLD", {"origin": "X"}, ttl_s=-1)
    assert cache.get("route", "OLD") is Cache.MISS


def test_cache_distinguishes_a_miss_from_a_cached_negative(cache: Cache):
    assert cache.get("route", "NEVER") is Cache.MISS
    cache.put_negative("route", "RCH285", ttl_s=60)
    assert cache.get("route", "RCH285") is None  # cached "we looked, there's nothing"


def test_cache_warm_reloads_unexpired_entries(tmp_path):
    path = tmp_path / "cache.sqlite3"
    first = Cache(path)
    first.put("aircraft", "4ca7b5", {"type_code": "B738"}, ttl_s=3600)
    first.close()

    second = Cache(path)
    assert second.warm() == 1
    assert second.get("aircraft", "4ca7b5") == {"type_code": "B738"}
    second.close()


def test_cache_purges_expired_rows(cache: Cache):
    cache.put("route", "A", {"x": 1}, ttl_s=-1)
    cache.put("route", "B", {"x": 1}, ttl_s=600)
    assert cache.purge_expired() == 1
    assert cache.stats().entries == 1


def test_cache_counters_are_scoped_per_period(cache: Cache):
    assert cache.bump_counter("aeroapi_queries", "2026-08") == 1
    assert cache.bump_counter("aeroapi_queries", "2026-08") == 2
    assert cache.counter("aeroapi_queries", "2026-09") == 0


# ----------------------------------------------------------------------- adsbdb


async def test_adsbdb_returns_route_with_iata_flight_number():
    api = adsbdb()
    route = await api.callsign("RYR1812")
    assert route is not None
    assert (route.origin, route.destination) == ("DUB", "STN")
    assert route.origin_city == "Dublin"
    assert route.airline_icao == "RYR"
    assert route.flight_iata == "FR1812"
    await api.aclose()


async def test_adsbdb_unknown_callsign_is_none_not_an_error():
    api = adsbdb()
    assert await api.callsign("RCH285") is None
    await api.aclose()


async def test_adsbdb_aircraft_lookup_fills_type_and_registration():
    api = adsbdb()
    details = await api.aircraft("4ca7b5")
    assert details == {
        "type_code": "B738",
        "type_name": "737 800",
        "registration": "EI-DAA",
        "manufacturer": "Boeing",
    }
    await api.aclose()


# ---------------------------------------------------------------------- aeroapi


def aeroapi(cache: Cache, *, limit: int = 400) -> AeroApiClient:
    return AeroApiClient(
        "test-key",
        base_url="https://aeroapi.flightaware.com/aeroapi",
        cache=cache,
        monthly_limit=limit,
        client=client("aeroapi"),
    )


async def test_aeroapi_returns_schedule_and_eta(cache: Cache):
    api = aeroapi(cache)
    route = await api.flight("BAW832")
    assert route is not None
    assert (route.origin, route.destination) == ("DUB", "LHR")
    assert route.estimated_on is not None
    assert route.provider == "aeroapi"
    await api.aclose()


async def test_aeroapi_counts_every_query_against_the_month(cache: Cache):
    api = aeroapi(cache)
    await api.flight("BAW832")
    await api.flight("BAW832")
    assert api.queries_this_month() == 2
    assert api.quota_remaining() == 398
    await api.aclose()


async def test_aeroapi_refuses_to_fire_once_the_ceiling_is_reached(cache: Cache):
    api = aeroapi(cache, limit=1)
    await api.flight("BAW832")
    assert not api.available
    with pytest.raises(QuotaExceeded):
        await api.flight("BAW832")
    await api.aclose()


# --------------------------------------------------------------------- enricher


def enricher(cache: Cache, *, with_aeroapi: bool = False) -> Enricher:
    config = EnrichConfig(aeroapi_key="k" if with_aeroapi else None, negative_ttl_s=3600)
    return Enricher(
        config,
        cache=cache,
        adsbdb=adsbdb(),
        aeroapi=aeroapi(cache) if with_aeroapi else None,
    )


async def test_enricher_caches_so_a_second_poll_makes_no_request(cache: Cache):
    calls: list[str] = []
    api = AdsbdbClient(
        "https://api.adsbdb.com",
        client=client("adsbdb", on_request=lambda r: calls.append(str(r.url))),
    )
    enr = Enricher(EnrichConfig(), cache=cache, adsbdb=api)
    await enr.route_for("RYR1812")
    before = len(calls)
    await enr.route_for("RYR1812")
    assert len(calls) == before
    await enr.aclose()


async def test_enricher_caches_negative_lookups_for_unmatched_callsigns(cache: Cache):
    calls: list[str] = []
    api = AdsbdbClient(
        "https://api.adsbdb.com",
        client=client("adsbdb", on_request=lambda r: calls.append(str(r.url))),
    )
    enr = Enricher(EnrichConfig(), cache=cache, adsbdb=api)
    assert await enr.route_for("RCH285") is None
    assert await enr.route_for("RCH285") is None
    assert len(calls) == 1  # the military callsign is asked about exactly once
    await enr.aclose()


async def test_enricher_fills_colour_and_airline_name_from_the_local_table(cache: Cache):
    enr = enricher(cache)
    result = await enr.enrich(Aircraft(hex="4ca7b5", callsign="RYR1812", lat=53.4, lon=-6.3))
    assert result.airline_colour == "#073590"
    assert result.route.airline_name == "Ryanair"
    assert result.traffic_category is Category.AIRLINE
    await enr.aclose()


async def test_enricher_leaves_unknown_airlines_white(cache: Cache):
    enr = enricher(cache)
    result = await enr.enrich(Aircraft(hex="4d2210", callsign="N904TX", lat=53.4, lon=-6.2))
    assert result.airline_colour == "#ffffff"
    await enr.aclose()


async def test_enricher_survives_a_dead_provider(cache: Cache):
    class Broken(AdsbdbClient):
        async def callsign(self, callsign: str):
            raise RuntimeError("provider on fire")

        async def aircraft(self, hex_id: str):
            raise RuntimeError("provider on fire")

    enr = Enricher(EnrichConfig(), cache=cache, adsbdb=Broken(client=client("adsbdb")))
    result = await enr.enrich(Aircraft(hex="4ca7b5", callsign="RYR1812", lat=53.4, lon=-6.3))
    # No route, but still a usable frame: colour comes from the callsign prefix.
    assert result.route.origin is None
    assert result.airline_colour == "#073590"
    await enr.aclose()


async def test_enricher_spends_aeroapi_quota_only_when_adsbdb_falls_short(cache: Cache):
    enr = enricher(cache, with_aeroapi=True)
    await enr.route_for("RYR1812")  # adsbdb has the full route
    assert enr.aeroapi is not None and enr.aeroapi.queries_this_month() == 0
    await enr.aclose()


async def test_enricher_backfills_type_from_the_enrichment_layer(cache: Cache):
    enr = enricher(cache)
    result = await enr.enrich(Aircraft(hex="4ca7b5", callsign="RYR1812", lat=53.4, lon=-6.3))
    assert result.aircraft.type_code == "B738"
    assert result.aircraft.registration == "EI-DAA"
    await enr.aclose()


async def test_enricher_does_not_ask_when_the_decoder_already_knows(cache: Cache):
    calls: list[str] = []
    api = AdsbdbClient(
        "https://api.adsbdb.com",
        client=client("adsbdb", on_request=lambda r: calls.append(str(r.url))),
    )
    enr = Enricher(EnrichConfig(), cache=cache, adsbdb=api)
    await enr.enrich(
        Aircraft(hex="4ca7b5", callsign="RYR1812", lat=53.4, lon=-6.3,
                 type_code="B738", registration="EI-DAA")
    )
    assert not any("/aircraft/" in url for url in calls)
    await enr.aclose()


# --------------------------------------------------------------- classification


@pytest.mark.parametrize(
    ("aircraft", "operator", "expected"),
    [
        (Aircraft(hex="a", callsign="RYR1812"), "RYR", Category.AIRLINE),
        (Aircraft(hex="b", callsign="RCH285"), None, Category.MILITARY),
        (Aircraft(hex="c", callsign="X", squawk="7777"), None, Category.MILITARY),
        (Aircraft(hex="d", callsign="IRISH112", category="A7"), None, Category.HELICOPTER),
        (Aircraft(hex="e", callsign="HELI1", type_code="EC35"), None, Category.HELICOPTER),
        (Aircraft(hex="f", callsign="N904TX"), None, Category.GA),
        (Aircraft(hex="g", callsign=None), None, Category.UNKNOWN),
    ],
)
def test_classify(aircraft, operator, expected):
    assert classify(aircraft, operator) is expected


# --------------------------------------------------------------------- airports


def test_airports_resolve_city_by_iata_and_icao():
    assert airports.city_for("DUB") == "Dublin"
    assert airports.city_for("EIDW") == "Dublin"
    assert airports.city_for("ZZZZ") is None
    assert airports.city_for(None) is None


def test_airports_expose_positions_for_tracking_progress():
    position = airports.position_for("STN")
    assert position is not None
    assert position[0] == pytest.approx(51.885, abs=0.01)


def test_cache_stats_track_hits_and_misses(cache: Cache):
    cache.put("route", "A", {"x": 1}, ttl_s=60)
    cache.get("route", "A")
    cache.get("route", "B")
    stats = cache.stats()
    assert stats.hits == 1 and stats.misses == 1
    assert stats.entries == 1


def test_cache_negative_entries_are_counted_separately(cache: Cache):
    cache.put("route", "A", {"x": 1}, ttl_s=60)
    cache.put_negative("route", "B", ttl_s=60)
    assert cache.stats().negative == 1


def test_cache_survives_a_restart(tmp_path):
    path = tmp_path / "c.sqlite3"
    first = Cache(path)
    first.put("route", "A", {"origin": "DUB"}, ttl_s=3600)
    first.close()
    second = Cache(path)
    assert second.get("route", "A") == {"origin": "DUB"}
    second.close()


def test_cache_ttl_is_honoured_across_the_warm_layer(cache: Cache):
    cache.put("route", "A", {"x": 1}, ttl_s=0.05)
    assert cache.get("route", "A") == {"x": 1}
    time.sleep(0.08)
    assert cache.get("route", "A") is Cache.MISS
