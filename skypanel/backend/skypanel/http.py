"""The one way this service makes outbound HTTP calls.

Every external request goes through `HttpClient`: it has a timeout, a bounded retry
policy with exponential backoff, a project `User-Agent`, and an optional token bucket
for providers that publish a rate limit. Tests inject an `httpx.MockTransport` here
rather than touching the network.
"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass
from types import TracebackType
from typing import Any, Self

import httpx

from . import __version__

log = logging.getLogger(__name__)

USER_AGENT = f"SkyPanel/{__version__} (+https://github.com/mwrf/see; DIY flight display)"

RETRY_STATUS = frozenset({429, 500, 502, 503, 504})


class HttpError(Exception):
    """Any outbound call that failed after the retry policy gave up."""

    def __init__(self, message: str, *, status: int | None = None, url: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.url = url


class TokenBucket:
    """Simple async token bucket. `rate` tokens per second, burst of `capacity`.

    Deliberately not a decorator: the aggregator's limit is per-provider, not
    per-callsite, so the bucket is owned by the client and shared by every request.
    """

    def __init__(self, rate: float, capacity: float | None = None) -> None:
        self.rate = rate
        self.capacity = capacity if capacity is not None else max(rate, 1.0)
        self._tokens = self.capacity
        self._updated = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        loop = asyncio.get_running_loop()
        async with self._lock:
            now = loop.time()
            if self._updated == 0.0:
                self._updated = now
            self._tokens = min(self.capacity, self._tokens + (now - self._updated) * self.rate)
            self._updated = now
            if self._tokens < 1.0:
                wait = (1.0 - self._tokens) / self.rate
                await asyncio.sleep(wait)
                self._tokens = 0.0
                self._updated = loop.time()
            else:
                self._tokens -= 1.0


@dataclass(slots=True)
class RetryPolicy:
    attempts: int = 3
    base_delay_s: float = 0.5
    max_delay_s: float = 8.0
    jitter: bool = True

    def delay_for(self, attempt: int) -> float:
        delay = min(self.max_delay_s, self.base_delay_s * (2.0**attempt))
        if self.jitter:
            delay *= 0.5 + random.random() / 2
        return delay


class HttpClient:
    """Thin wrapper over `httpx.AsyncClient` with the project's policies baked in."""

    def __init__(
        self,
        *,
        base_url: str = "",
        timeout_s: float = 4.0,
        retry: RetryPolicy | None = None,
        limiter: TokenBucket | None = None,
        headers: dict[str, str] | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.retry = retry or RetryPolicy()
        self.limiter = limiter
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(timeout_s),
            headers={"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})},
            transport=transport,
            follow_redirects=True,
        )

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def get_json(self, url: str, **kwargs: Any) -> Any:
        """GET and decode JSON, retrying transient failures.

        Raises `HttpError` on a non-retryable status, on exhausted retries, or when the
        body isn't JSON — the caller decides whether that's fatal or just a stale frame.
        """
        last: Exception | None = None
        for attempt in range(self.retry.attempts):
            if self.limiter is not None:
                await self.limiter.acquire()
            try:
                response = await self._client.get(url, **kwargs)
            except httpx.HTTPError as exc:
                last = exc
                log.debug("GET %s failed (%s), attempt %d", url, exc, attempt + 1)
            else:
                if response.status_code in RETRY_STATUS:
                    last = HttpError(
                        f"{response.status_code} from {url}",
                        status=response.status_code,
                        url=url,
                    )
                    retry_after = _retry_after(response)
                    if retry_after is not None and attempt + 1 < self.retry.attempts:
                        await asyncio.sleep(min(retry_after, self.retry.max_delay_s))
                        continue
                elif response.is_error:
                    raise HttpError(
                        f"{response.status_code} from {url}",
                        status=response.status_code,
                        url=url,
                    )
                else:
                    try:
                        return response.json()
                    except ValueError as exc:
                        raise HttpError(f"non-JSON body from {url}: {exc}", url=url) from exc
            if attempt + 1 < self.retry.attempts:
                await asyncio.sleep(self.retry.delay_for(attempt))

        status = last.status if isinstance(last, HttpError) else None
        raise HttpError(f"GET {url} failed after {self.retry.attempts} attempts: {last}",
                        status=status, url=url) from last


def _retry_after(response: httpx.Response) -> float | None:
    """Honour `Retry-After` when a provider sends one; it beats our own backoff."""
    raw = response.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        return None
