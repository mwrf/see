"""One HTTP client policy for the whole backend.

Every outbound call in SkyPanel goes through :class:`HttpClient`, which
guarantees three things the rest of the code then never has to think about:

* a hard timeout, so a wedged receiver can't stall the frame loop;
* a bounded retry with exponential backoff and jitter-free (deterministic)
  delays, so tests can assert on them;
* a single place to inject a transport, which is how the cassette tests keep
  the suite off the network.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from types import TracebackType
from typing import Any, Self

import httpx

from . import __version__

log = logging.getLogger(__name__)

USER_AGENT = f"SkyPanel/{__version__} (+https://github.com/mwrf/see; DIY ADS-B LED panel)"


class HttpError(Exception):
    """Any failure that survived the retry policy."""

    def __init__(self, message: str, *, status: int | None = None, url: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.url = url


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    """How hard to try before giving up.

    ``backoff_base`` seconds doubles per attempt.  429 responses honour a
    ``Retry-After`` header when the server sends one.
    """

    attempts: int = 3
    backoff_base: float = 0.5
    backoff_max: float = 8.0
    retry_statuses: frozenset[int] = frozenset({429, 500, 502, 503, 504})

    def delay_for(self, attempt: int) -> float:
        return min(self.backoff_max, self.backoff_base * float(2**attempt))


class HttpClient:
    """A thin, policy-carrying wrapper around ``httpx.AsyncClient``."""

    def __init__(
        self,
        *,
        timeout: float = 4.0,
        retry: RetryPolicy | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.retry = retry or RetryPolicy()
        merged = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        merged.update(headers or {})
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            transport=transport,
            headers=merged,
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
        """GET ``url`` and decode JSON, retrying per policy.

        Raises :class:`HttpError` rather than leaking httpx exceptions, so
        callers can present a diagnostic instead of a stack trace.
        """
        response = await self.get(url, **kwargs)
        try:
            return response.json()
        except ValueError as exc:
            preview = response.text[:120].replace("\n", " ")
            raise HttpError(
                f"response from {url} was not JSON: {preview!r}",
                status=response.status_code,
                url=url,
            ) from exc

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        last_error: str = "no attempts made"
        for attempt in range(self.retry.attempts):
            if attempt:
                await asyncio.sleep(self._sleep_for(attempt, None))
            try:
                response = await self._client.get(url, **kwargs)
            except httpx.TimeoutException:
                last_error = f"timed out after {self._client.timeout.read}s"
                continue
            except httpx.HTTPError as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                continue

            if response.status_code in self.retry.retry_statuses:
                last_error = f"HTTP {response.status_code}"
                retry_after = _retry_after(response)
                if attempt + 1 < self.retry.attempts:
                    await asyncio.sleep(self._sleep_for(attempt + 1, retry_after))
                continue
            if response.status_code >= 400:
                raise HttpError(
                    f"HTTP {response.status_code} from {url}", status=response.status_code, url=url
                )
            return response

        raise HttpError(f"{url} failed after {self.retry.attempts} attempts: {last_error}", url=url)

    def _sleep_for(self, attempt: int, retry_after: float | None) -> float:
        if retry_after is not None:
            return min(retry_after, self.retry.backoff_max)
        return self.retry.delay_for(attempt - 1 if attempt else 0)


def _retry_after(response: httpx.Response) -> float | None:
    raw = response.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None
