// Marquee state for one line of text.
//
// Two decisions worth stating, because both are visible on the panel:
//
//  * A line only scrolls when it genuinely overflows. "RYANAIR" sitting still
//    while "BRITISH AIRWAYS" marches past is the point; scrolling everything
//    makes the panel exhausting to look at.
//  * There is a dwell at the start of each cycle. Without it the first word is
//    already moving by the time your eye lands on it, and short overflows (one
//    or two characters) become unreadable.
//
// The scroller is driven by elapsed milliseconds rather than frame counts, so
// the animation runs at the same speed whether the device manages 30 fps or
// the emulator is running at --speed 4.
#pragma once

#include <cstdint>

namespace skypanel {

class Scroller {
 public:
  /// Pixels per second. Slow enough to read a callsign, fast enough that a
  /// long airline name completes a cycle between two 5 s polls.
  static constexpr float kSpeedPxPerSec = 14.0F;
  /// Pause at the start of each cycle.
  static constexpr uint32_t kDwellMs = 1200;
  /// Blank columns between the end of the text and its repeat.
  static constexpr int16_t kGapPx = 12;

  /// Set up for a line. Resets the animation when the text width changes, so
  /// a new aircraft always starts reading from the beginning.
  void configure(int16_t textWidth, int16_t viewportWidth, bool enabled);

  void reset();

  /// Advance by ``deltaMs``. Safe to call with 0.
  void advance(uint32_t deltaMs);

  /// Pixels the text should be shifted left. Always 0 when not overflowing.
  int16_t offset() const { return static_cast<int16_t>(offsetPx_); }

  /// True when the line overflows and is therefore animating.
  bool scrolling() const { return scrolling_; }

  /// Length of one full cycle, in pixels; the caller draws a second copy of
  /// the text this far to the right to make the wrap seamless.
  int16_t cycleWidth() const { return cycleWidth_; }

 private:
  int16_t textWidth_ = 0;
  int16_t viewportWidth_ = 0;
  int16_t cycleWidth_ = 0;
  bool scrolling_ = false;
  float offsetPx_ = 0.0F;
  uint32_t dwellRemainingMs_ = kDwellMs;
};

}  // namespace skypanel
