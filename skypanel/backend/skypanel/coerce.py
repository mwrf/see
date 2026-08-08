"""Turning whatever a feed sent us into the type we wanted.

Every upstream in this project is loosely typed JSON or CSV written by someone
else: a decoder that reports altitude as ``"ground"``, an aggregator that
sometimes sends a squawk as a number, an enrichment API that uses ``""`` where
it means "unknown". These two functions are the single place that judgement
lives, so a new edge case is fixed once rather than in each parser.
"""

from __future__ import annotations

from typing import Any


def as_float(value: Any) -> float | None:
    """A float, or ``None`` if the value cannot sensibly be one.

    Booleans are rejected deliberately: ``True`` is a valid ``float()``
    argument in Python and would silently become an altitude of 1.0.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def as_str(value: Any) -> str | None:
    """A stripped string, or ``None`` if it is empty or not string-like.

    Empty-after-stripping collapses to ``None`` because every upstream here
    uses blank padding to mean "no value" -- a callsign field of eight spaces
    is an aircraft that has not transmitted one yet, not an aircraft named
    "        ".
    """
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, int | float) and not isinstance(value, bool):
        return str(value)
    return None


def field_str(obj: Any, key: str) -> str | None:
    """``as_str`` of ``obj[key]``, tolerating ``obj`` not being a dict at all.

    Enrichment responses nest several levels deep and any level may be absent
    or null, so callers would otherwise need a guard per lookup.
    """
    return as_str(obj.get(key)) if isinstance(obj, dict) else None
