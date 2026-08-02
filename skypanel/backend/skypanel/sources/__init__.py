"""Interchangeable ADS-B data feeds."""

from .aggregator import PROVIDERS, AggregatorSource
from .base import AircraftSource, SourceError
from .local import LocalSource
from .manager import SourceManager, SourceStatus
from .mock import MockSource

__all__ = [
    "PROVIDERS",
    "AggregatorSource",
    "AircraftSource",
    "LocalSource",
    "MockSource",
    "SourceError",
    "SourceManager",
    "SourceStatus",
]
