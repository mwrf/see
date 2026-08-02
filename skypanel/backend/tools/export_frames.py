#!/usr/bin/env python3
"""Render `emulator/fixtures/` from the backend's own fixtures.

The emulator's test frames are not hand-written JSON: they are produced by the real
frame builder from the real aircraft fixtures, so a change to units, colours or field
selection shows up in the golden images instead of silently diverging from them.

    uv run python tools/export_frames.py
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import ClassVar

from skypanel import frame as frame_builder
from skypanel.colours import data_dir
from skypanel.config import EnrichConfig
from skypanel.enrich.cache import Cache
from skypanel.enrich.service import Enricher
from skypanel.geo import annotate_distances, nearest
from skypanel.models import EnrichedAircraft, Route
from skypanel.settings import Settings
from skypanel.sources.mock import MockSource
from skypanel.tracking import TrackingState

OUT = Path(__file__).resolve().parents[2] / "emulator" / "fixtures"
HOME = (53.3498, -6.2603)
STAMP = datetime(2026, 8, 2, 9, 14, 3, tzinfo=UTC)


class OfflineEnricher(Enricher):
    """Enrichment without a network: routes come from a small canned table.

    The golden images have to be reproducible on a machine with no internet, so the
    handful of routes these fixtures need are spelled out rather than fetched.
    """

    ROUTES: ClassVar[dict[str, Route]] = {
        "RYR1812": Route(origin="DUB", destination="STN", airline_icao="RYR", flight_iata="FR1812"),
        "EIN122": Route(origin="DUB", destination="LHR", airline_icao="EIN", flight_iata="EI122"),
        "BAW832": Route(origin="DUB", destination="LHR", airline_icao="BAW", flight_iata="BA832"),
        "DLH991": Route(origin="MUC", destination="DUB", airline_icao="DLH", flight_iata="LH991"),
        "THY1957": Route(origin="IST", destination="DUB", airline_icao="THY", flight_iata="TK1957"),
    }

    async def route_for(self, callsign: str | None) -> Route | None:  # type: ignore[override]
        if not callsign:
            return None
        canned = self.ROUTES.get(callsign.strip().upper())
        # A copy: the enricher mutates the route it is handed.
        return replace(canned) if canned else None

    async def aircraft_details(self, hex_id: str) -> dict[str, str] | None:  # type: ignore[override]
        return None


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    settings = Settings(home_lat=HOME[0], home_lon=HOME[1])
    cache = Cache(":memory:")
    enricher = OfflineEnricher(EnrichConfig(), cache=cache)
    source = MockSource(data_dir() / "fixtures")

    written: list[str] = []

    async def selected(fixture: str) -> EnrichedAircraft | None:
        source.select(fixture)
        aircraft = await source.fetch(*HOME, 200.0)
        annotate_distances(aircraft, *HOME)
        pick = nearest(aircraft, *HOME)
        return await enricher.enrich(pick) if pick is not None else None

    def write(name: str, frame_obj: object) -> None:
        path = OUT / f"{name}.json"
        payload = frame_obj.model_dump(mode="json")  # type: ignore[attr-defined]
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        written.append(path.name)

    # One frame per scenario the spec asks the mock source to cover.
    for fixture, name in (
        ("dublin_approach", "ryanair"),
        ("single_distant", "distant"),
        ("military", "military"),
        ("helicopter", "helicopter"),
        ("no_route", "no_route"),
    ):
        enriched = await selected(fixture)
        assert enriched is not None, fixture
        write(name, frame_builder.build_nearest(enriched, settings, source="local", now=STAMP))

    write("empty", frame_builder.build_empty(settings, source="local", now=STAMP))
    write(
        "error",
        frame_builder.build_error(
            "local receiver unreachable",
            settings,
            source="local",
            hint="check that dump1090 is serving aircraft.json on port 8080",
            now=STAMP,
        ),
    )

    # Tracking, with a progress bar and an ETA.
    source.select("dublin_approach")
    aircraft = await source.fetch(*HOME, 200.0)
    annotate_distances(aircraft, *HOME)
    tracked = next(ac for ac in aircraft if ac.callsign == "BAW832")
    enriched = await enricher.enrich(tracked)
    write(
        "tracking",
        frame_builder.build_tracking(
            enriched,
            settings,
            TrackingState(ident="BAW832", fraction=0.62, eta_text="13:14"),
            source="local",
            now=STAMP,
        ),
    )

    # A long airline name, to exercise scrolling in the golden images.
    long_name = await selected("dublin_approach")
    assert long_name is not None
    long_name.route.airline_icao = "THY"
    long_name.route.airline_name = "Turkish Airlines"
    long_name.airline_colour = "#c70a0c"
    write("scrolling", frame_builder.build_nearest(long_name, settings, source="local", now=STAMP))

    # Metric units, to prove the unit setting reaches the panel.
    metric = Settings(
        home_lat=HOME[0],
        home_lon=HOME[1],
        altitude_unit="m",
        speed_unit="kmh",
        distance_unit="km",
        route_display="cities",
    )
    enriched = await selected("dublin_approach")
    assert enriched is not None
    write("metric", frame_builder.build_nearest(enriched, metric, source="aggregator", now=STAMP))

    # A scenario file: one frame per line, replayed by `--scenario`.
    scenario = OUT / "busy.jsonl"
    lines: list[str] = []
    for fixture in ("dublin_approach", "single_distant", "helicopter", "no_route", "military"):
        enriched = await selected(fixture)
        if enriched is None:
            continue
        frame = frame_builder.build_nearest(enriched, settings, source="local", now=STAMP)
        lines.append(json.dumps(frame.model_dump(mode="json"), separators=(",", ":")))
    lines.append(
        json.dumps(
            frame_builder.build_empty(settings, source="local", now=STAMP).model_dump(mode="json"),
            separators=(",", ":"),
        )
    )
    scenario.write_text("\n".join(lines) + "\n", encoding="utf-8")
    written.append(scenario.name)

    await enricher.aclose()
    cache.close()
    print(f"wrote {len(written)} files to {OUT}:")
    for name in written:
        print(f"  {name}")


if __name__ == "__main__":
    asyncio.run(main())
