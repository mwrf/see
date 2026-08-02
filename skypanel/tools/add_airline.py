#!/usr/bin/env python3
"""Add or update an entry in ``backend/data/airlines.json``.

The airline table is data, not code, so growing it should not need a patch:

    just add-airline EIN "Aer Lingus" "#008D7F" EI

The colour is checked against the panel's gamma ramp before it is written --
plenty of brand navies emit almost nothing on a real LED matrix, and it is
better to find that out here than after flashing.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from skypanel.colours import (  # noqa: E402
    MIN_PANEL_LEVEL,
    ensure_legible,
    normalise_colour,
    panel_level,
)

DATA_PATH = Path(__file__).resolve().parents[1] / "backend" / "data" / "airlines.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("code", help="three-letter ICAO operator code, e.g. EIN")
    parser.add_argument("name", help='display name, e.g. "Aer Lingus"')
    parser.add_argument("colour", help="brand colour, #RRGGBB")
    parser.add_argument("--iata", default="", help="IATA designator, e.g. EI")
    parser.add_argument("--path", type=Path, default=DATA_PATH)
    args = parser.parse_args(argv)

    code = args.code.strip().upper()
    if len(code) != 3 or not code.isalpha():
        print(f"{code!r} is not a three-letter ICAO code", file=sys.stderr)
        return 2

    colour = normalise_colour(args.colour)
    if colour == "#FFFFFF" and args.colour.strip().upper() not in ("#FFFFFF", "FFFFFF"):
        print(f"{args.colour!r} is not a valid colour", file=sys.stderr)
        return 2

    airlines = json.loads(args.path.read_text())
    existing = airlines.get(code)
    airlines[code] = {
        "name": args.name.strip(),
        "iata": args.iata.strip().upper(),
        "rgb": colour,
    }
    args.path.write_text(
        json.dumps(dict(sorted(airlines.items())), indent=2, ensure_ascii=False) + "\n"
    )

    action = "updated" if existing else "added"
    print(f"{action} {code}: {args.name} {colour}")

    emitted = panel_level(colour)
    if emitted < MIN_PANEL_LEVEL:
        lifted = ensure_legible(colour)
        print(
            f"\nnote: {colour} emits only {emitted}/255 on the panel after gamma.\n"
            f"      SkyPanel will render it as {lifted} so it stays readable.\n"
            f"      Preview it with: just show ryanair"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
