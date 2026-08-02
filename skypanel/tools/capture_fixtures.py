#!/usr/bin/env python3
"""Record aircraft.json snapshots from a live receiver.

Fixtures are the backbone of the test suite, and hand-written ones are always
subtly wrong -- real receivers emit fields you did not expect and omit ones you
assumed. Capture from the real thing.

    just capture-fixtures raspberrypi.local 6 10

The interesting captures are the awkward ones: an empty sky at 4am, a military
callsign, a helicopter, an aircraft with no route match. Capture generously and
keep the ones that break something.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from skypanel.http import HttpClient  # noqa: E402
from skypanel.sources.base import SourceError  # noqa: E402
from skypanel.sources.local import LocalSource  # noqa: E402


async def capture(args: argparse.Namespace) -> int:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    client = HttpClient(timeout=4.0)
    source = LocalSource(args.host, path=args.path, client=client)
    try:
        url = await source.probe()
    except SourceError as exc:
        print(f"could not reach a receiver:\n{exc.diagnostic()}", file=sys.stderr)
        return 1
    print(f"capturing from {url}")

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    written = 0
    for index in range(args.count):
        try:
            payload = await client.get_json(url)
        except Exception as exc:  # noqa: BLE001 - a capture run should not die on one poll
            print(f"  poll {index + 1} failed: {exc}", file=sys.stderr)
            continue

        aircraft = payload.get("aircraft", []) if isinstance(payload, dict) else []
        payload["_comment"] = (
            f"Captured from {url} at {datetime.now(UTC).isoformat(timespec='seconds')}; "
            f"{len(aircraft)} targets. Rename this file to describe what it shows."
        )
        path = out / f"capture-{stamp}-{index + 1:02d}.json"
        path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")
        print(f"  {path.name}: {len(aircraft)} aircraft")
        written += 1

        if index + 1 < args.count:
            await asyncio.sleep(args.interval)

    await client.aclose()
    print(f"\nwrote {written} fixture(s) to {out}")
    print("Rename them to describe the scenario, e.g. 07-busy-evening.json")
    return 0 if written else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="raspberrypi.local")
    parser.add_argument("--path", default=None, help="explicit aircraft.json URL")
    parser.add_argument("--count", type=int, default=6)
    parser.add_argument("--interval", type=float, default=10.0, help="seconds between polls")
    parser.add_argument("--out", default="backend/data/fixtures")
    return asyncio.run(capture(parser.parse_args(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
