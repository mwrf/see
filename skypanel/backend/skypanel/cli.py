"""Console entry points: run the server, record fixtures, extend the airline table."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

from . import colours
from .config import load_config
from .http import HttpClient
from .sources.local import CANDIDATE_PATHS


def serve() -> None:
    """`skypanel-serve` — run the FastAPI app with uvicorn."""
    import uvicorn

    parser = argparse.ArgumentParser(prog="skypanel-serve", description="Run the SkyPanel backend")
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    config = load_config(args.config)
    from .app import create_app

    uvicorn.run(
        create_app(config) if not args.reload else "skypanel.app:create_app",
        factory=args.reload,
        host=args.host or config.server.host,
        port=args.port or config.server.port,
        reload=args.reload,
        log_level="debug" if args.verbose else "info",
    )


def capture_fixtures() -> None:
    """`skypanel-capture` — record aircraft.json snapshots from a live receiver.

    Fixtures are the backbone of the test suite, so capture is a first-class task
    rather than something you do by hand with curl.
    """
    parser = argparse.ArgumentParser(
        prog="skypanel-capture", description="Record aircraft.json snapshots for the mock source"
    )
    parser.add_argument("--host", default=None, help="receiver hostname (default: from config)")
    parser.add_argument("--url", default=None, help="explicit aircraft.json URL")
    parser.add_argument("--name", required=True, help="fixture name, e.g. dublin_approach")
    parser.add_argument("--count", type=int, default=1, help="snapshots to take")
    parser.add_argument("--interval", type=float, default=5.0, help="seconds between snapshots")
    parser.add_argument("--out", type=Path, default=None, help="output directory")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    config = load_config()
    host = args.host or config.source.local_host
    out_dir = args.out or (colours.data_dir() / "fixtures")
    out_dir.mkdir(parents=True, exist_ok=True)

    async def run() -> int:
        async with HttpClient(timeout_s=4.0) as client:
            url = args.url
            if url is None:
                for template in CANDIDATE_PATHS:
                    candidate = template.format(host=host)
                    try:
                        payload = await client.get_json(candidate)
                    except Exception:
                        continue
                    if isinstance(payload, dict) and isinstance(payload.get("aircraft"), list):
                        url = candidate
                        break
            if url is None:
                print(f"no aircraft.json found on {host}", file=sys.stderr)
                return 1

            print(f"capturing from {url}")
            for i in range(args.count):
                payload = await client.get_json(url)
                suffix = "" if args.count == 1 else f"_{i:02d}"
                path = out_dir / f"{args.name}{suffix}.json"
                payload.setdefault("captured_at", datetime.now(UTC).isoformat())
                path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
                n = len(payload.get("aircraft", []))
                print(f"  {path.name}: {n} aircraft")
                if i + 1 < args.count:
                    await asyncio.sleep(args.interval)
        return 0

    raise SystemExit(asyncio.run(run()))


def add_airline() -> None:
    """`skypanel-airline RYR "Ryanair" "#073590"` — extend the colour table."""
    parser = argparse.ArgumentParser(
        prog="skypanel-airline", description="Add or update an airline brand colour"
    )
    parser.add_argument("icao", help="ICAO operator code, e.g. RYR")
    parser.add_argument("name", help="display name, e.g. Ryanair")
    parser.add_argument("colour", help="brand colour as #RRGGBB")
    args = parser.parse_args()
    try:
        colours.add_airline(args.icao, args.name, args.colour)
    except ValueError as exc:
        raise SystemExit(f"error: {exc}") from exc
    print(f"{args.icao.upper()} = {args.name} {args.colour.lower()}")
