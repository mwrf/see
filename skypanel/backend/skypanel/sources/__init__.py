"""Aircraft data feeds. Each implements `AircraftSource`; the choice is config."""

from .base import AircraftSource, SourceError
from .manager import SourceManager

__all__ = ["AircraftSource", "SourceError", "SourceManager"]
