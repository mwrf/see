#!/usr/bin/env python3
"""Golden-image tests for the renderer.

Each case renders a frame headless through the real emulator binary — the same
`Renderer`, `PanelPainter` and PNG writer the SDL window uses — and compares it against
a committed PNG. Any pixel difference fails.

This is the regression suite for fonts, layout, scrolling and colour handling: those are
the things that are easy to break and impossible to review in a diff.

    python3 tools/snapshots.py            # check
    python3 tools/snapshots.py --approve  # accept the current output as correct
    python3 tools/snapshots.py --list     # show the cases

On failure, `<name>.actual.png` and `<name>.diff.png` are written next to the golden so
the change can be looked at rather than guessed at.
"""

from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_DIR = ROOT / "emulator" / "snapshots"
FIXTURE_DIR = ROOT / "emulator" / "fixtures"
MANIFEST = SNAPSHOT_DIR / "manifest.json"
DEFAULT_BINARY = ROOT / "emulator" / "build" / "skypanel-emu"


# ------------------------------------------------------------------ PNG helpers


def decode_png(path: Path) -> tuple[int, int, bytes]:
    """Minimal RGBA8 PNG reader. The emulator writes filter-0 rows, but all five
    filters are handled so an approved file from another tool still compares."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    width = height = 0
    idat = bytearray()
    i = 8
    while i < len(data):
        (length,) = struct.unpack(">I", data[i : i + 4])
        kind = data[i + 4 : i + 8]
        body = data[i + 8 : i + 8 + length]
        if kind == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", body[:10])
            if depth != 8 or colour != 6:
                raise ValueError(f"{path}: expected 8-bit RGBA")
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        i += 12 + length

    raw = zlib.decompress(bytes(idat))
    stride = width * 4
    out = bytearray()
    previous = bytearray(stride)
    at = 0
    for _ in range(height):
        filter_type = raw[at]
        at += 1
        line = bytearray(raw[at : at + stride])
        at += stride
        for x in range(stride):
            left = line[x - 4] if x >= 4 else 0
            up = previous[x]
            up_left = previous[x - 4] if x >= 4 else 0
            if filter_type == 1:
                line[x] = (line[x] + left) & 0xFF
            elif filter_type == 2:
                line[x] = (line[x] + up) & 0xFF
            elif filter_type == 3:
                line[x] = (line[x] + (left + up) // 2) & 0xFF
            elif filter_type == 4:
                p = left + up - up_left
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - up_left)
                predictor = left if (pa <= pb and pa <= pc) else (up if pb <= pc else up_left)
                line[x] = (line[x] + predictor) & 0xFF
        out += line
        previous = line
    return width, height, bytes(out)


def encode_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    raw = b"".join(b"\x00" + pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height))

    def chunk(kind: bytes, body: bytes) -> bytes:
        payload = kind + body
        return struct.pack(">I", len(body)) + payload + struct.pack(">I", zlib.crc32(payload))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def diff_image(golden: bytes, actual: bytes, width: int, height: int) -> tuple[int, bytes]:
    """Count differing pixels and build a visualisation: magenta where they differ,
    the golden dimmed to 25% where they agree."""
    out = bytearray(len(golden))
    differing = 0
    for i in range(0, len(golden), 4):
        if golden[i : i + 3] != actual[i : i + 3]:
            differing += 1
            out[i : i + 4] = b"\xff\x00\xff\xff"
        else:
            out[i] = golden[i] // 4
            out[i + 1] = golden[i + 1] // 4
            out[i + 2] = golden[i + 2] // 4
            out[i + 3] = 255
    return differing, bytes(out)


# ----------------------------------------------------------------------- cases


def load_cases() -> list[dict[str, object]]:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))["cases"]


def render(binary: Path, case: dict[str, object], out: Path) -> None:
    command: list[str] = [str(binary), "--snapshot", str(out)]
    if "frame" in case:
        command += ["--frame", str(FIXTURE_DIR / str(case["frame"]))]
    elif "scenario" in case:
        command += ["--scenario", str(FIXTURE_DIR / str(case["scenario"]))]
    command += ["--time", str(case.get("time_ms", 0))]
    command += ["--scale", str(case.get("scale", 6))]
    command += ["--brightness", str(case.get("brightness", 255))]
    command += ["--gamma", str(case.get("gamma", 2.2))]
    command += ["--pitch", str(case.get("pitch", "P4"))]
    if case.get("bloom"):
        command.append("--bloom")

    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"{case['name']}: emulator failed\n{result.stderr.strip()}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--approve", action="store_true", help="accept the current output")
    parser.add_argument("--list", action="store_true", help="list the cases and exit")
    parser.add_argument("--binary", type=Path, default=DEFAULT_BINARY)
    parser.add_argument("--filter", default="", help="only cases whose name contains this")
    args = parser.parse_args()

    cases = [c for c in load_cases() if args.filter in str(c["name"])]
    if args.list:
        for case in cases:
            source = case.get("frame") or case.get("scenario")
            print(f"{case['name']:24s} {source}  t={case.get('time_ms', 0)}ms")
        return 0

    if not args.binary.exists():
        print(f"emulator binary not found at {args.binary}", file=sys.stderr)
        print("build it first:  cmake -B emulator/build -S emulator && "
              "cmake --build emulator/build", file=sys.stderr)
        return 2

    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    approved = 0

    with tempfile.TemporaryDirectory() as tmp:
        for case in cases:
            name = str(case["name"])
            actual_path = Path(tmp) / f"{name}.png"
            render(args.binary, case, actual_path)
            golden_path = SNAPSHOT_DIR / f"{name}.png"

            if args.approve or not golden_path.exists():
                golden_path.write_bytes(actual_path.read_bytes())
                approved += 1
                verb = "approved" if args.approve else "created"
                print(f"  {verb:9s} {name}")
                continue

            gw, gh, golden = decode_png(golden_path)
            aw, ah, actual = decode_png(actual_path)
            if (gw, gh) != (aw, ah):
                failures.append(f"{name}: size changed {gw}x{gh} -> {aw}x{ah}")
                continue
            if golden == actual:
                print(f"  ok        {name}")
                continue

            differing, visual = diff_image(golden, actual, gw, gh)
            encode_png(SNAPSHOT_DIR / f"{name}.actual.png", aw, ah, actual)
            encode_png(SNAPSHOT_DIR / f"{name}.diff.png", gw, gh, visual)
            failures.append(
                f"{name}: {differing} pixel(s) differ "
                f"(see snapshots/{name}.diff.png)"
            )
            print(f"  FAIL      {name}  {differing} pixel(s)")

    if approved:
        print(f"\n{approved} snapshot(s) written to {SNAPSHOT_DIR}")
    if failures:
        print(f"\n{len(failures)} snapshot(s) differ:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        print("\nIf the change is intended:  just approve-snapshots", file=sys.stderr)
        return 1
    if not approved:
        print(f"\nall {len(cases)} snapshots match")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
