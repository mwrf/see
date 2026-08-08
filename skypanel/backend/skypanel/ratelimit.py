"""A token bucket, used to honour aggregator rate limits.

The clock is injectable so tests never have to sleep.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable


class TokenBucket:
    """Classic token bucket: ``rate`` tokens per second, ``capacity`` burst.

    :meth:`acquire` waits until a token is available; it is what the poller
    uses.  :meth:`try_acquire` never waits, so a caller that must not block --
    or a test asserting the bucket is empty -- can ask without joining the
    queue.
    """

    def __init__(
        self,
        rate: float = 1.0,
        capacity: float = 1.0,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if rate <= 0:
            raise ValueError("rate must be positive")
        self.rate = rate
        self.capacity = max(capacity, 1.0)
        self._clock = clock
        self._tokens = self.capacity
        self._updated = clock()
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        now = self._clock()
        elapsed = max(0.0, now - self._updated)
        self._updated = now
        self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)

    @property
    def tokens(self) -> float:
        self._refill()
        return self._tokens

    def try_acquire(self, amount: float = 1.0) -> bool:
        self._refill()
        if self._tokens >= amount:
            self._tokens -= amount
            return True
        return False

    async def acquire(self, amount: float = 1.0) -> float:
        """Block until ``amount`` tokens are available; return the wait in seconds."""
        waited = 0.0
        async with self._lock:
            while True:
                self._refill()
                if self._tokens >= amount:
                    self._tokens -= amount
                    return waited
                deficit = amount - self._tokens
                delay = deficit / self.rate
                waited += delay
                await asyncio.sleep(delay)
