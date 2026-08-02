"""A three-file cassette layer, so no test ever touches the network.

A cassette is a JSON file mapping a URL (or a URL prefix) to a recorded
response.  :func:`cassette_transport` turns one into an ``httpx`` transport,
which is the only injection point :class:`skypanel.http.HttpClient` exposes.

Recording is deliberately manual: the fixtures under ``cassettes/`` were
trimmed by hand from real provider responses, because a verbatim capture of an
adsbdb reply is 4 KB of fields we never read.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

CASSETTE_DIR = Path(__file__).parent / "cassettes"


class CassetteMiss(AssertionError):
    """A test tried to reach a URL the cassette does not cover."""


def load_cassette(name: str) -> dict[str, Any]:
    path = CASSETTE_DIR / f"{name}.json"
    data: Any = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError(f"cassette {name} must be a JSON object")
    return data


def cassette_transport(
    name: str, *, calls: list[str] | None = None, strict: bool = True
) -> httpx.MockTransport:
    """Build a transport that replays ``name``.

    ``calls`` is appended to with every requested URL, which is how the rate
    limit and quota tests assert that a call did *not* happen.
    """
    cassette = load_cassette(name)
    entries: dict[str, Any] = cassette.get("entries", cassette)

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if calls is not None:
            calls.append(url)
        entry = entries.get(url)
        if entry is None:
            #  Fall back to prefix matching so tests do not have to spell out
            #  every query-string permutation.
            for key, value in entries.items():
                if url.startswith(key):
                    entry = value
                    break
        if entry is None:
            if strict:
                known = "\n  ".join(sorted(entries))
                raise CassetteMiss(f"no cassette entry for {url}\nknown:\n  {known}")
            return httpx.Response(404, json={"error": "not in cassette"})

        status = int(entry.get("status", 200))
        headers = {str(k): str(v) for k, v in entry.get("headers", {}).items()}
        if "json" in entry:
            return httpx.Response(status, json=entry["json"], headers=headers)
        return httpx.Response(status, text=str(entry.get("text", "")), headers=headers)

    return httpx.MockTransport(handler)


def sequence_transport(
    responses: list[httpx.Response], *, calls: list[str] | None = None
) -> httpx.MockTransport:
    """Replay a fixed sequence, repeating the last response once exhausted.

    Used for retry/backoff tests where the same URL must answer differently on
    successive attempts.
    """
    index = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal index
        if calls is not None:
            calls.append(str(request.url))
        response = responses[min(index, len(responses) - 1)]
        index += 1
        return httpx.Response(
            response.status_code,
            content=response.content,
            headers=response.headers,
        )

    return httpx.MockTransport(handler)
