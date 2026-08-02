"""A rolling log of what flew past, for the dashboard.

One row per (hex, callsign) sighting, updated in place while the aircraft stays
in range so a single overflight is one row rather than three hundred.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .models import EnrichedAircraft

SCHEMA = """
CREATE TABLE IF NOT EXISTS sightings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    hex           TEXT NOT NULL,
    callsign      TEXT,
    registration  TEXT,
    type_code     TEXT,
    airline_code  TEXT,
    airline_name  TEXT,
    airline_colour TEXT,
    category      TEXT,
    origin        TEXT,
    destination   TEXT,
    first_seen    REAL NOT NULL,
    last_seen     REAL NOT NULL,
    closest_mi    REAL NOT NULL,
    max_alt_ft    REAL,
    peak_speed_kt REAL
);
CREATE INDEX IF NOT EXISTS sightings_last_seen ON sightings(last_seen);
CREATE INDEX IF NOT EXISTS sightings_hex ON sightings(hex, last_seen);
"""

#: A gap longer than this starts a new sighting rather than extending the old.
SIGHTING_GAP_S = 15 * 60


class History:
    """Append-and-update store of aircraft seen near home."""

    def __init__(
        self,
        path: Path | str = ":memory:",
        *,
        clock: Callable[[], float] = time.time,
        retention_days: int = 30,
    ) -> None:
        self.path = str(path)
        self._clock = clock
        self.retention_days = retention_days
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA)
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    def record(self, enriched: EnrichedAircraft) -> None:
        """Log a sighting, extending the current one when it is the same pass."""
        now = self._clock()
        ac = enriched.aircraft
        row = self._db.execute(
            "SELECT id, closest_mi, max_alt_ft, peak_speed_kt FROM sightings"
            " WHERE hex = ? AND last_seen >= ? ORDER BY last_seen DESC LIMIT 1",
            (ac.hex, now - SIGHTING_GAP_S),
        ).fetchone()

        if row is None:
            self._db.execute(
                "INSERT INTO sightings (hex, callsign, registration, type_code, airline_code,"
                " airline_name, airline_colour, category, origin, destination, first_seen,"
                " last_seen, closest_mi, max_alt_ft, peak_speed_kt)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ac.hex,
                    ac.callsign,
                    ac.registration,
                    ac.type_code,
                    enriched.airline_code,
                    enriched.airline_name,
                    enriched.airline_colour,
                    enriched.category,
                    enriched.route.origin,
                    enriched.route.destination,
                    now,
                    now,
                    enriched.distance_mi,
                    ac.alt_baro_ft,
                    ac.gs_kt,
                ),
            )
        else:
            self._db.execute(
                "UPDATE sightings SET last_seen = ?, closest_mi = ?, max_alt_ft = ?,"
                " peak_speed_kt = ?, callsign = COALESCE(?, callsign),"
                " registration = COALESCE(?, registration), type_code = COALESCE(?, type_code),"
                " airline_name = COALESCE(?, airline_name), origin = COALESCE(?, origin),"
                " destination = COALESCE(?, destination) WHERE id = ?",
                (
                    now,
                    min(row["closest_mi"], enriched.distance_mi),
                    _max_opt(row["max_alt_ft"], ac.alt_baro_ft),
                    _max_opt(row["peak_speed_kt"], ac.gs_kt),
                    ac.callsign,
                    ac.registration,
                    ac.type_code,
                    enriched.airline_name,
                    enriched.route.origin,
                    enriched.route.destination,
                    row["id"],
                ),
            )
        self._db.commit()

    def recent(self, hours: float = 24.0, limit: int = 500) -> list[dict[str, Any]]:
        cutoff = self._clock() - hours * 3600
        rows = self._db.execute(
            "SELECT * FROM sightings WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT ?",
            (cutoff, limit),
        ).fetchall()
        return [dict(row) for row in rows]

    def summary(self, hours: float = 24.0) -> dict[str, Any]:
        cutoff = self._clock() - hours * 3600
        row = self._db.execute(
            "SELECT COUNT(*) AS sightings, COUNT(DISTINCT hex) AS aircraft,"
            " MIN(closest_mi) AS closest, MAX(max_alt_ft) AS highest"
            " FROM sightings WHERE last_seen >= ?",
            (cutoff,),
        ).fetchone()
        top = self._db.execute(
            "SELECT airline_name, airline_colour, COUNT(*) AS n FROM sightings"
            " WHERE last_seen >= ? AND airline_name IS NOT NULL"
            " GROUP BY airline_name ORDER BY n DESC LIMIT 10",
            (cutoff,),
        ).fetchall()
        return {
            "hours": hours,
            "sightings": row["sightings"] or 0,
            "aircraft": row["aircraft"] or 0,
            "closest_mi": round(row["closest"], 2) if row["closest"] is not None else None,
            "highest_ft": row["highest"],
            "top_airlines": [dict(r) for r in top],
        }

    def prune(self) -> int:
        cutoff = self._clock() - self.retention_days * 86400
        cursor = self._db.execute("DELETE FROM sightings WHERE last_seen < ?", (cutoff,))
        self._db.commit()
        return cursor.rowcount


def _max_opt(current: float | None, candidate: float | None) -> float | None:
    if candidate is None:
        return current
    if current is None:
        return candidate
    return max(current, candidate)
