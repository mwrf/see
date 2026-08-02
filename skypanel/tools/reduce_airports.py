#!/usr/bin/env python3
"""Reduce the OurAirports database to the subset SkyPanel needs.

The full airports.csv is ~10 MB of 80,000 rows, most of them grass strips with
no IATA code. The panel needs ``ident,iata,municipality`` for airports that
scheduled traffic actually uses, plus coordinates so tracking mode can compute
a progress fraction.

    curl -LO https://davidmegginson.github.io/ourairports-data/airports.csv
    just reduce-airports airports.csv

OurAirports data is public domain.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

#: Types worth keeping. Heliports and closed fields never appear as the
#: origin or destination of a scheduled flight.
KEEP_TYPES = {"large_airport", "medium_airport"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="full OurAirports airports.csv")
    parser.add_argument("--out", type=Path, default=Path("backend/data/airports.csv"))
    parser.add_argument(
        "--require-iata",
        action="store_true",
        default=True,
        help="keep only airports with an IATA code (default)",
    )
    parser.add_argument("--all-types", action="store_true", help="keep small airports too")
    args = parser.parse_args(argv)

    if not args.source.exists():
        print(f"{args.source} not found; download it first:", file=sys.stderr)
        print(
            "  curl -LO https://davidmegginson.github.io/ourairports-data/airports.csv",
            file=sys.stderr,
        )
        return 1

    rows: list[tuple[str, str, str, str, str]] = []
    with args.source.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            kind = (row.get("type") or "").strip()
            if not args.all_types and kind not in KEEP_TYPES:
                continue
            ident = (row.get("ident") or "").strip().upper()
            city = (row.get("municipality") or "").strip()
            iata = (row.get("iata_code") or "").strip().upper()
            if not ident or not city:
                continue
            if args.require_iata and not iata:
                continue
            rows.append(
                (ident, iata, city, (row.get("latitude_deg") or "").strip(),
                 (row.get("longitude_deg") or "").strip())
            )

    rows.sort()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["ident", "iata", "municipality", "lat", "lon"])
        writer.writerows(rows)

    size_kb = args.out.stat().st_size / 1024
    print(f"wrote {len(rows)} airports to {args.out} ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
