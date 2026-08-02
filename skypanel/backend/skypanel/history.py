"""What flew past, for the dashboard.

One row per (hex, callsign) sighting, collapsed on repeat: an aircraft in range for ten
minutes is one row with a widening time span and a shrinking closest approach, not 120
rows. Kept in its own SQLite file so clearing history never risks the enrichment cache.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from .models import EnrichedAircraft

SCHEMA = """
CREATE TABLE IF NOT EXISTS sightings (
    id            INTEGER PRIMARY KEY,
    hex           TEXT NOT NULL,
    callsign      TEXT,
    airline       TEXT,
    airline_icao  TEXT,
    colour        TEXT,
    origin        TEXT,
    destination   TEXT,
    type_code     TEXT,
    registration  TEXT,
    category      TEXT,
    first_seen    REAL NOT NULL,
    last_seen     REAL NOT NULL,
    closest_nm    REAL,
    max_alt_ft    REAL
);
CREATE INDEX IF NOT EXISTS sightings_last_seen ON sightings (last_seen DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sightings_key ON sightings (hex, callsign, first_seen);
"""

#: A gap longer than this starts a new sighting rather than extending the old one.
SIGHTING_GAP_S = 900.0


@dataclass(frozen=True, slots=True)
class Sighting:
    hex: str
    callsign: str | None
    airline: str | None
    colour: str | None
    origin: str | None
    destination: str | None
    type_code: str | None
    registration: str | None
    category: str | None
    first_seen: float
    last_seen: float
    closest_nm: float | None
    max_alt_ft: float | None


class History:
    def __init__(self, path: Path | str = ":memory:", *, retain_days: float = 30.0) -> None:
        is_file = str(path) != ":memory:"
        if is_file:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        if is_file:
            self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        self._db.commit()
        self.retain_days = retain_days

    def record(self, enriched: EnrichedAircraft, *, now: float | None = None) -> None:
        now = now if now is not None else time.time()
        ac = enriched.aircraft
        callsign = ac.callsign
        row = self._db.execute(
            "SELECT id, closest_nm, max_alt_ft FROM sightings "
            "WHERE hex = ? AND callsign IS ? AND last_seen >= ? "
            "ORDER BY last_seen DESC LIMIT 1",
            (ac.hex, callsign, now - SIGHTING_GAP_S),
        ).fetchone()

        if row is None:
            self._db.execute(
                "INSERT INTO sightings (hex, callsign, airline, airline_icao, colour, origin, "
                "destination, type_code, registration, category, first_seen, last_seen, "
                "closest_nm, max_alt_ft) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    ac.hex,
                    callsign,
                    enriched.route.airline_name,
                    enriched.route.airline_icao,
                    enriched.airline_colour,
                    enriched.route.origin,
                    enriched.route.destination,
                    ac.type_code,
                    ac.registration,
                    str(enriched.traffic_category),
                    now,
                    now,
                    ac.distance_nm,
                    ac.alt_baro_ft,
                ),
            )
        else:
            closest = _min_opt(row["closest_nm"], ac.distance_nm)
            highest = _max_opt(row["max_alt_ft"], ac.alt_baro_ft)
            self._db.execute(
                "UPDATE sightings SET last_seen = ?, closest_nm = ?, max_alt_ft = ?, "
                "origin = COALESCE(origin, ?), destination = COALESCE(destination, ?), "
                "type_code = COALESCE(type_code, ?), airline = COALESCE(airline, ?) "
                "WHERE id = ?",
                (
                    now,
                    closest,
                    highest,
                    enriched.route.origin,
                    enriched.route.destination,
                    ac.type_code,
                    enriched.route.airline_name,
                    row["id"],
                ),
            )
        self._db.commit()

    def recent(self, hours: float = 24.0, limit: int = 500) -> list[Sighting]:
        since = time.time() - hours * 3600
        rows = self._db.execute(
            "SELECT * FROM sightings WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT ?",
            (since, limit),
        ).fetchall()
        return [
            Sighting(
                hex=r["hex"],
                callsign=r["callsign"],
                airline=r["airline"],
                colour=r["colour"],
                origin=r["origin"],
                destination=r["destination"],
                type_code=r["type_code"],
                registration=r["registration"],
                category=r["category"],
                first_seen=r["first_seen"],
                last_seen=r["last_seen"],
                closest_nm=r["closest_nm"],
                max_alt_ft=r["max_alt_ft"],
            )
            for r in rows
        ]

    def summary(self, hours: float = 24.0) -> dict[str, object]:
        since = time.time() - hours * 3600
        row = self._db.execute(
            "SELECT COUNT(*) AS sightings, COUNT(DISTINCT hex) AS airframes, "
            "MIN(closest_nm) AS closest FROM sightings WHERE last_seen >= ?",
            (since,),
        ).fetchone()
        top = self._db.execute(
            "SELECT COALESCE(airline, airline_icao, 'Unknown') AS name, COUNT(*) AS n "
            "FROM sightings WHERE last_seen >= ? GROUP BY name ORDER BY n DESC LIMIT 10",
            (since,),
        ).fetchall()
        return {
            "hours": hours,
            "sightings": row["sightings"] or 0,
            "airframes": row["airframes"] or 0,
            "closest_nm": row["closest"],
            "top_airlines": [{"name": r["name"], "count": r["n"]} for r in top],
        }

    def prune(self) -> int:
        cutoff = time.time() - self.retain_days * 86400
        cur = self._db.execute("DELETE FROM sightings WHERE last_seen < ?", (cutoff,))
        self._db.commit()
        return cur.rowcount

    def close(self) -> None:
        self._db.close()


def _min_opt(a: float | None, b: float | None) -> float | None:
    values = [v for v in (a, b) if v is not None]
    return min(values) if values else None


def _max_opt(a: float | None, b: float | None) -> float | None:
    values = [v for v in (a, b) if v is not None]
    return max(values) if values else None
