#!/usr/bin/env python3
"""Publish a firmware build for LAN-local OTA.

Copies the binary into the directory the backend serves and writes the
esp32FOTA manifest next to it. Keeping updates on the LAN means no internet
dependency, no TLS and no certificate to expire in three years.

    just release 2
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, required=True, help="firmware.bin to publish")
    parser.add_argument("--version", type=int, required=True, help="integer version")
    parser.add_argument("--out", type=Path, default=Path("firmware-releases"))
    parser.add_argument("--host", default="raspberrypi.local")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)

    if not args.bin.exists():
        print(f"{args.bin} not found -- run 'just firmware' first", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    name = f"skypanel-{args.version}.bin"
    shutil.copy2(args.bin, args.out / name)

    #  esp32FOTA compares "version" against the integer compiled into the
    #  firmware (OtaUpdater::kFirmwareVersion), so this must be bumped in both
    #  places or devices will never see the update.
    manifest = {
        "type": "skypanel",
        "version": args.version,
        "host": args.host,
        "port": args.port,
        "bin": f"/firmware/{name}",
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    size_kb = (args.out / name).stat().st_size / 1024
    print(f"published {name} ({size_kb:.0f} KB) as version {args.version}")
    print(f"manifest: {args.out / 'manifest.json'}")
    print("\nRemember to bump OtaUpdater::kFirmwareVersion in lib/net/Ota.h to match.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
