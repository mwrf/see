"""Where the bundled data files live.

Three layouts have to work, and hard-coding any one of them breaks the others:

* a source checkout, where the data sits at ``backend/data``;
* an installed wheel, where the build copies it to ``skypanel/data``;
* a container or a package that wants it somewhere else entirely, via
  ``SKYPANEL_DATA_DIR``.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

_PACKAGE_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def data_dir() -> Path:
    """The directory holding ``airlines.json``, ``airports.csv`` and fixtures."""
    override = os.environ.get("SKYPANEL_DATA_DIR", "").strip()
    if override:
        return Path(override).expanduser()

    candidates = (
        _PACKAGE_DIR / "data",  # installed wheel
        _PACKAGE_DIR.parent / "data",  # source checkout / editable install
    )
    for candidate in candidates:
        if candidate.is_dir():
            return candidate

    #  Return the checkout location anyway: callers surface a clear "could not
    #  load airlines.json" rather than a confusing missing-attribute error.
    return _PACKAGE_DIR.parent / "data"


def data_file(name: str) -> Path:
    return data_dir() / name
