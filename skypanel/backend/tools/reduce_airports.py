#!/usr/bin/env python3
"""Reduce a full OurAirports export to the columns SkyPanel reads.

    just reduce-airports ~/Downloads/airports.csv

The upstream file is ~80 000 rows and 20 columns, most of it grass strips and 12 fields
this project never touches. This keeps `ident,iata,municipality,latitude_deg,
longitude_deg` for airports that have both an IATA code and a city name — the two things
the display and the tracking progress bar actually need.

The bundled `data/airports.csv` was hand-reduced because the build machine could not
reach ourairports.com; re-run this against a fresh download to widen the coverage.

OurAirports data is public domain: https://ourairports.com/data/
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

KEEP_TYPES = {"large_airport", "medium_airport"}
COLUMNS = ["ident", "iata", "municipality", "latitude_deg", "longitude_deg"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("source", type=Path, help="the OurAirports airports.csv")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "airports.csv",
    )
    parser.add_argument(
        "--all-types",
        action="store_true",
        help="keep small airports and heliports too (much larger file)",
    )
    args = parser.parse_args()

    kept = 0
    with (
        args.source.open(newline="", encoding="utf-8") as src,
        args.out.open("w", newline="", encoding="utf-8") as dst,
    ):
        reader = csv.DictReader(src)
        writer = csv.writer(dst)
        writer.writerow(COLUMNS)
        for row in reader:
            if not args.all_types and row.get("type") not in KEEP_TYPES:
                continue
            iata = (row.get("iata_code") or "").strip()
            city = (row.get("municipality") or "").strip()
            if not iata or not city:
                continue
            writer.writerow(
                [
                    (row.get("ident") or "").strip(),
                    iata,
                    city,
                    (row.get("latitude_deg") or "").strip(),
                    (row.get("longitude_deg") or "").strip(),
                ]
            )
            kept += 1

    print(f"wrote {kept} airports to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
