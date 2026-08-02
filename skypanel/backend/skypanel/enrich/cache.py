"""A single-file SQLite cache with a TTL per record type.

Negative results are cached too — a military callsign that adsbdb has never heard of
would otherwise be re-queried on every poll, which is both rude and slow.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    kind       TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT,           -- JSON payload, NULL for a negative result
    expires_at REAL NOT NULL,
    stored_at  REAL NOT NULL,
    PRIMARY KEY (kind, key)
);
CREATE INDEX IF NOT EXISTS entries_expiry ON entries (expires_at);

CREATE TABLE IF NOT EXISTS counters (
    name   TEXT NOT NULL,
    period TEXT NOT NULL,
    value  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (name, period)
);
"""


@dataclass(frozen=True, slots=True)
class CacheStats:
    entries: int
    negative: int
    expired: int
    hits: int
    misses: int


class Cache:
    """Synchronous by design — SQLite is fast enough here that async adds only risk."""

    MISS = object()
    """Sentinel distinguishing "not cached" from a cached negative (`None`)."""

    def __init__(self, path: Path | str = ":memory:") -> None:
        self.path = path
        is_file = str(path) != ":memory:"
        if is_file:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        if is_file:
            self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        self._db.commit()
        self.hits = 0
        self.misses = 0
        self._warm: dict[tuple[str, str], tuple[Any, float]] = {}

    # ------------------------------------------------------------------- reads

    def get(self, kind: str, key: str) -> Any:
        """Return the cached value, `None` for a cached negative, or `Cache.MISS`."""
        now = time.time()
        warmed = self._warm.get((kind, key))
        if warmed is not None:
            value, expires = warmed
            if expires > now:
                self.hits += 1
                return value
            del self._warm[(kind, key)]

        row = self._db.execute(
            "SELECT value, expires_at FROM entries WHERE kind = ? AND key = ?", (kind, key)
        ).fetchone()
        if row is None or row["expires_at"] <= now:
            self.misses += 1
            return Cache.MISS
        self.hits += 1
        value = json.loads(row["value"]) if row["value"] is not None else None
        self._warm[(kind, key)] = (value, row["expires_at"])
        return value

    # ------------------------------------------------------------------ writes

    def put(self, kind: str, key: str, value: Any, ttl_s: float) -> None:
        now = time.time()
        expires = now + ttl_s
        encoded = None if value is None else json.dumps(value, separators=(",", ":"))
        self._db.execute(
            "INSERT INTO entries (kind, key, value, expires_at, stored_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT (kind, key) DO UPDATE SET "
            "value = excluded.value, expires_at = excluded.expires_at, "
            "stored_at = excluded.stored_at",
            (kind, key, encoded, expires, now),
        )
        self._db.commit()
        self._warm[(kind, key)] = (value, expires)

    def put_negative(self, kind: str, key: str, ttl_s: float) -> None:
        """Remember that a lookup found nothing, so we stop asking for a while."""
        self.put(kind, key, None, ttl_s)

    # --------------------------------------------------------------- lifecycle

    def warm(self, limit: int = 2000) -> int:
        """Pull unexpired entries into memory at startup so the first frames are fast."""
        now = time.time()
        rows = self._db.execute(
            "SELECT kind, key, value, expires_at FROM entries WHERE expires_at > ? "
            "ORDER BY stored_at DESC LIMIT ?",
            (now, limit),
        ).fetchall()
        self._warm = {
            (r["kind"], r["key"]): (
                json.loads(r["value"]) if r["value"] is not None else None,
                r["expires_at"],
            )
            for r in rows
        }
        log.info("cache warmed with %d entries", len(self._warm))
        return len(self._warm)

    def purge_expired(self) -> int:
        cur = self._db.execute("DELETE FROM entries WHERE expires_at <= ?", (time.time(),))
        self._db.commit()
        return cur.rowcount

    def stats(self) -> CacheStats:
        now = time.time()
        row = self._db.execute(
            "SELECT COUNT(*) AS total, "
            "SUM(CASE WHEN value IS NULL THEN 1 ELSE 0 END) AS negative, "
            "SUM(CASE WHEN expires_at <= ? THEN 1 ELSE 0 END) AS expired FROM entries",
            (now,),
        ).fetchone()
        return CacheStats(
            entries=row["total"] or 0,
            negative=row["negative"] or 0,
            expired=row["expired"] or 0,
            hits=self.hits,
            misses=self.misses,
        )

    # ---------------------------------------------------------------- counters

    def bump_counter(self, name: str, period: str, by: int = 1) -> int:
        """Increment a period-scoped counter and return the new value.

        Used for the AeroAPI monthly quota; `period` is a ``YYYY-MM`` string, so a new
        month simply starts a new row and the old ones stay as a record.
        """
        self._db.execute(
            "INSERT INTO counters (name, period, value) VALUES (?, ?, ?) "
            "ON CONFLICT (name, period) DO UPDATE SET value = value + excluded.value",
            (name, period, by),
        )
        self._db.commit()
        return self.counter(name, period)

    def counter(self, name: str, period: str) -> int:
        row = self._db.execute(
            "SELECT value FROM counters WHERE name = ? AND period = ?", (name, period)
        ).fetchone()
        return int(row["value"]) if row else 0

    def close(self) -> None:
        self._db.close()
