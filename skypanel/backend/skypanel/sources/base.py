"""The one interface every data feed implements."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..models import Aircraft


class SourceError(Exception):
    """A feed failed in a way the operator needs to read.

    Carries a ``hint`` because the overwhelmingly common local-receiver failure
    is a wrong path or a decoder with no web interface, and a stack trace tells
    nobody that.
    """

    def __init__(self, message: str, *, hint: str | None = None) -> None:
        super().__init__(message)
        self.hint = hint

    def diagnostic(self) -> str:
        return f"{self}\n  hint: {self.hint}" if self.hint else str(self)


@runtime_checkable
class AircraftSource(Protocol):
    """A pollable source of ADS-B targets."""

    name: str

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        """Return every target the source knows about within ``radius_nm``."""
        ...

    @property
    def healthy(self) -> bool:
        """False once the source has failed often enough to warrant failover."""
        ...

    async def aclose(self) -> None: ...


class HealthTracker:
    """Shared health bookkeeping for the concrete sources.

    A source is unhealthy after ``threshold`` consecutive failures and becomes
    healthy again on the first success, which is what makes ``auto`` mode's
    "fall back permanently unless it recovers" rule expressible.
    """

    def __init__(self, threshold: int = 3) -> None:
        self.threshold = threshold
        self.consecutive_failures = 0
        self.last_error: str | None = None
        self.last_success_monotonic: float | None = None

    @property
    def healthy(self) -> bool:
        return self.consecutive_failures < self.threshold

    def record_success(self, now: float) -> None:
        self.consecutive_failures = 0
        self.last_error = None
        self.last_success_monotonic = now

    def record_failure(self, error: str) -> None:
        self.consecutive_failures += 1
        self.last_error = error
