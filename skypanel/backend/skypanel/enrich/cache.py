"""SQLite-backed enrichment cache with per-record-type TTLs.

One file, three record kinds, one table.  The important behaviour is the
*negative* cache: an unmatched military callsign must not be re-queried on
every poll, so a miss is stored too, with a short TTL.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

RecordKind = Literal["route", "aircraft"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS enrichment (
    kind      TEXT NOT NULL,
    key       TEXT NOT NULL,
    payload   TEXT,          -- NULL means a recorded negative lookup
    provider  TEXT,
    stored_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    PRIMARY KEY (kind, key)
);
CREATE INDEX IF NOT EXISTS enrichment_expiry ON enrichment(expires_at);

CREATE TABLE IF NOT EXISTS counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
);
"""


@dataclass(frozen=True, slots=True)
class CacheTTLs:
    route_s: int = 12 * 3600
    aircraft_s: int = 30 * 86400
    negative_s: int = 3600

    def for_kind(self, kind: RecordKind, *, negative: bool) -> int:
        if negative:
            return self.negative_s
        return self.route_s if kind == "route" else self.aircraft_s


@dataclass(slots=True)
class CacheStats:
    hits: int = 0
    misses: int = 0
    negative_hits: int = 0
    writes: int = 0
    rows: int = 0

    def to_json(self) -> dict[str, int]:
        total = self.hits + self.misses
        return {
            "hits": self.hits,
            "misses": self.misses,
            "negative_hits": self.negative_hits,
            "writes": self.writes,
            "rows": self.rows,
            "hit_rate_pct": round(100.0 * self.hits / total) if total else 0,
        }


class EnrichmentCache:
    """A tiny persistent key/value store with expiry and a query counter."""

    def __init__(
        self,
        path: Path | str = ":memory:",
        *,
        ttls: CacheTTLs | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.path = str(path)
        self.ttls = ttls or CacheTTLs()
        self._clock = clock
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA)
        self._db.commit()
        self.stats = CacheStats()
        self._memo: dict[tuple[str, str], tuple[float, dict[str, Any] | None]] = {}

    def close(self) -> None:
        self._db.close()

    # -- warm-up ---------------------------------------------------------

    def warm(self) -> int:
        """Load unexpired rows into memory at startup.

        The working set is a few hundred callsigns; holding it in a dict keeps
        the frame loop off the disk entirely.
        """
        self.purge_expired()
        now = self._clock()
        rows = self._db.execute(
            "SELECT kind, key, payload, expires_at FROM enrichment WHERE expires_at > ?", (now,)
        ).fetchall()
        self._memo = {
            (row["kind"], row["key"]): (
                row["expires_at"],
                json.loads(row["payload"]) if row["payload"] is not None else None,
            )
            for row in rows
        }
        self.stats.rows = len(self._memo)
        return len(self._memo)

    def purge_expired(self) -> int:
        cursor = self._db.execute("DELETE FROM enrichment WHERE expires_at <= ?", (self._clock(),))
        self._db.commit()
        return cursor.rowcount

    # -- reads and writes ------------------------------------------------

    def get(self, kind: RecordKind, key: str) -> tuple[bool, dict[str, Any] | None]:
        """Return ``(found, payload)``.

        ``(True, None)`` is a cached negative -- we looked, and there is no
        route for this callsign.  ``(False, None)`` is a genuine miss.
        """
        norm = _normalise(key)
        now = self._clock()
        memo = self._memo.get((kind, norm))
        if memo is not None:
            expires_at, payload = memo
            if expires_at > now:
                self._record_hit(payload)
                return True, payload
            del self._memo[(kind, norm)]

        row = self._db.execute(
            "SELECT payload, expires_at FROM enrichment WHERE kind = ? AND key = ?", (kind, norm)
        ).fetchone()
        if row is None or row["expires_at"] <= now:
            self.stats.misses += 1
            return False, None

        payload = json.loads(row["payload"]) if row["payload"] is not None else None
        self._memo[(kind, norm)] = (row["expires_at"], payload)
        self._record_hit(payload)
        return True, payload

    def _record_hit(self, payload: dict[str, Any] | None) -> None:
        self.stats.hits += 1
        if payload is None:
            self.stats.negative_hits += 1

    def put(
        self,
        kind: RecordKind,
        key: str,
        payload: dict[str, Any] | None,
        *,
        provider: str | None = None,
        ttl_s: int | None = None,
    ) -> None:
        norm = _normalise(key)
        ttl = ttl_s if ttl_s is not None else self.ttls.for_kind(kind, negative=payload is None)
        now = self._clock()
        expires_at = now + ttl
        self._db.execute(
            "INSERT OR REPLACE INTO enrichment"
            " (kind, key, payload, provider, stored_at, expires_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                kind,
                norm,
                json.dumps(payload) if payload is not None else None,
                provider,
                now,
                expires_at,
            ),
        )
        self._db.commit()
        self._memo[(kind, norm)] = (expires_at, payload)
        self.stats.writes += 1
        self.stats.rows = len(self._memo)

    # -- counters --------------------------------------------------------

    def bump(self, name: str, amount: int = 1) -> int:
        self._db.execute(
            "INSERT INTO counters (name, value) VALUES (?, ?)"
            " ON CONFLICT(name) DO UPDATE SET value = value + excluded.value",
            (name, amount),
        )
        self._db.commit()
        return self.counter(name)

    def counter(self, name: str) -> int:
        row = self._db.execute("SELECT value FROM counters WHERE name = ?", (name,)).fetchone()
        return int(row["value"]) if row else 0

    def reset_counter(self, name: str) -> None:
        self._db.execute("INSERT OR REPLACE INTO counters (name, value) VALUES (?, 0)", (name,))
        self._db.commit()


def _normalise(key: str) -> str:
    return key.strip().upper()
