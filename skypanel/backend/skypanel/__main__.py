"""``python -m skypanel`` -- run the service, or poke it from the shell."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

from .app import create_app
from .service import SkyPanelService
from .settings import AppConfig


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="skypanel", description="SkyPanel backend")
    parser.add_argument("--config", type=Path, default=None, help="path to config.toml")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command")
    serve = sub.add_parser("serve", help="run the HTTP service (default)")
    #  Repeated on the subcommand as well as globally: "skypanel serve --port
    #  8123" is what people actually type, and argparse would otherwise reject
    #  it for being on the wrong side of the subcommand.
    serve.add_argument("--host", default=None)
    serve.add_argument("--port", type=int, default=None)
    sub.add_parser("frame", help="print one DisplayFrame as JSON and exit")
    sub.add_parser("probe", help="probe the configured local receiver and report what answered")

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    config = AppConfig.load(args.config)
    if args.host:
        config.server.host = args.host
    if args.port:
        config.server.port = args.port

    command = args.command or "serve"
    if command == "frame":
        return asyncio.run(_print_frame(config))
    if command == "probe":
        return asyncio.run(_probe(config))
    return _serve(config)


def _serve(config: AppConfig) -> int:
    import uvicorn

    uvicorn.run(create_app(config=config), host=config.server.host, port=config.server.port)
    return 0


async def _print_frame(config: AppConfig) -> int:
    service = SkyPanelService(config)
    await service.start()
    try:
        frame = await service.current_frame()
        print(json.dumps(frame.to_json(), indent=2))
        return 0 if frame.mode != "error" else 1
    finally:
        await service.aclose()


async def _probe(config: AppConfig) -> int:
    """Report which ``aircraft.json`` path answered -- the top support question."""
    from .sources.base import SourceError
    from .sources.local import LocalSource

    source = LocalSource(config.source.local_host, path=config.source.local_path)
    print(f"probing {config.source.local_host} ...")
    for candidate in source.candidates():
        print(f"  {candidate}")
    try:
        url = await source.probe()
    except SourceError as exc:
        print(f"\nno luck:\n{exc.diagnostic()}", file=sys.stderr)
        return 1
    finally:
        await source.aclose()
    print(f"\nfound it: {url}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
