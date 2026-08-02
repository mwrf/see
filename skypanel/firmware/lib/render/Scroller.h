// Horizontal scrolling for lines that overflow the panel.
//
// The offset is a pure function of elapsed time, which matters twice: the firmware can
// animate at 30 fps between five-second polls without keeping mutable state per line,
// and the snapshot tests can ask for "the frame at t = 2400 ms" and get the same pixels
// every run.
//
// The cycle is hold → travel → hold → snap back. Wrapping continuously reads worse at
// this size: by the time the tail of "TURKISH AIRLINES" leaves the panel the head is
// already back, and the eye has nothing to anchor on.

#pragma once

#include <cstdint>

namespace skypanel {

struct ScrollTiming {
  uint32_t holdStartMs = 1200; ///< pause with the head of the line visible
  uint32_t holdEndMs = 900;    ///< pause with the tail visible
  uint16_t pixelsPerSecond = 14;
};

class Scroller {
public:
  explicit Scroller(ScrollTiming timing = {}) : timing_(timing) {}

  /// Leftwards offset in pixels for a line of `textWidth` in a `viewport`-wide window.
  /// Always >= 0; always 0 when the text fits.
  int16_t offset(int16_t textWidth, int16_t viewport, uint32_t elapsedMs) const;

  /// True when this line would move at all — the renderer uses it to decide whether the
  /// panel needs redrawing between polls.
  static bool overflows(int16_t textWidth, int16_t viewport) {
    return textWidth > viewport;
  }

  /// Total length of one hold-travel-hold-snap cycle, for tests and for the emulator's
  /// "record one full loop" mode.
  uint32_t cycleMs(int16_t textWidth, int16_t viewport) const;

  const ScrollTiming &timing() const { return timing_; }

private:
  ScrollTiming timing_;
  uint32_t travelMs(int16_t distance) const;
};

} // namespace skypanel
