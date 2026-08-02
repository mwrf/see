"""The interface every feed implements, plus the shared normalisation helpers.

`local` and `aggregator` speak different wire formats but share most of their quirks
(space-padded callsigns, `"ground"` as an altitude, optional type/registration), so the
field-level normalisation lives here rather than being written twice.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from ..models import Aircraft


class SourceError(Exception):
    """A feed failed in a way the operator can act on.

    Carries a human-readable `hint` because the common failures — wrong aircraft.json
    path, decoder without a web interface, provider rate limit — are configuration
    problems, and a stack trace is the wrong thing to show for those.
    """

    def __init__(self, message: str, *, hint: str | None = None) -> None:
        super().__init__(message)
        self.hint = hint

    def __str__(self) -> str:
        base = super().__str__()
        return f"{base} — {self.hint}" if self.hint else base


@runtime_checkable
class AircraftSource(Protocol):
    """A feed of nearby aircraft."""

    name: str

    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]:
        """Aircraft within `radius_nm` of the given point. May raise `SourceError`."""
        ...

    @property
    def healthy(self) -> bool:
        """False once the feed has failed and hasn't recovered."""
        ...

    async def aclose(self) -> None: ...


# ---------------------------------------------------------------- normalisation


def clean_callsign(raw: Any) -> str | None:
    """`flight` is fixed-width and space-padded in every dump1090 dialect."""
    if not isinstance(raw, str):
        return None
    cs = raw.strip().upper()
    return cs or None


def parse_altitude(entry: dict[str, Any]) -> tuple[float | None, bool]:
    """Return (altitude_ft, on_ground).

    `alt_baro` is preferred but can be the literal string ``"ground"``. `alt_geom` is
    the GNSS altitude and is the fallback when the barometric field is missing.
    """
    baro = entry.get("alt_baro")
    if isinstance(baro, str):
        if baro.strip().lower() == "ground":
            return None, True
        baro = _maybe_float(baro)
    if isinstance(baro, int | float):
        return float(baro), False
    geom = _maybe_float(entry.get("alt_geom"))
    return geom, False


def _maybe_float(value: Any) -> float | None:
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


def _maybe_str(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def parse_entry(entry: dict[str, Any]) -> Aircraft | None:
    """Turn one aircraft.json / ADSBExchange-v2 record into an `Aircraft`.

    Returns None when the record has no usable ICAO hex — everything else is optional
    and gets filled in by the enrichment layer if it can be.
    """
    hex_id = _maybe_str(entry.get("hex")) or _maybe_str(entry.get("icao"))
    if not hex_id:
        return None
    alt_ft, on_ground = parse_altitude(entry)
    return Aircraft(
        hex=hex_id.lower().lstrip("~"),
        callsign=clean_callsign(entry.get("flight") or entry.get("callsign")),
        lat=_maybe_float(entry.get("lat")),
        lon=_maybe_float(entry.get("lon")),
        alt_baro_ft=alt_ft,
        gs_kt=_maybe_float(entry.get("gs")),
        track_deg=_maybe_float(entry.get("track") or entry.get("true_heading")),
        vert_rate=_maybe_float(entry.get("baro_rate") or entry.get("geom_rate")),
        squawk=_maybe_str(entry.get("squawk")),
        # `t` and `r` are only present when the decoder has an aircraft database loaded.
        type_code=_maybe_str(entry.get("t")),
        registration=_maybe_str(entry.get("r")),
        category=_maybe_str(entry.get("category")),
        seen_pos_s=_maybe_float(entry.get("seen_pos")),
        on_ground=on_ground,
    )


def parse_aircraft_list(
    entries: list[Any], *, max_age_s: float | None = 30.0, require_position: bool = True
) -> list[Aircraft]:
    """Normalise a whole array, dropping records the display can't use.

    Positionless records and stale ones are dropped here rather than downstream so that
    "nearest aircraft" never picks something whose position is a minute old.
    """
    out: list[Aircraft] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        ac = parse_entry(entry)
        if ac is None:
            continue
        if require_position and not ac.has_position():
            continue
        if max_age_s is not None and ac.seen_pos_s is not None and ac.seen_pos_s > max_age_s:
            continue
        out.append(ac)
    return out
