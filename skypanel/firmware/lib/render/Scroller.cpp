#include "Scroller.h"

namespace skypanel {

void Scroller::configure(int16_t textWidth, int16_t viewportWidth, bool enabled) {
  const bool changed = textWidth != textWidth_ || viewportWidth != viewportWidth_;
  textWidth_ = textWidth;
  viewportWidth_ = viewportWidth;

  const bool overflows = enabled && textWidth > viewportWidth;
  if (changed || overflows != scrolling_) {
    scrolling_ = overflows;
    reset();
  }
  cycleWidth_ = scrolling_ ? static_cast<int16_t>(textWidth_ + kGapPx) : 0;
}

void Scroller::reset() {
  offsetPx_ = 0.0F;
  dwellRemainingMs_ = kDwellMs;
}

void Scroller::advance(uint32_t deltaMs) {
  if (!scrolling_ || deltaMs == 0 || cycleWidth_ <= 0) {
    return;
  }

  if (dwellRemainingMs_ > 0) {
    if (deltaMs <= dwellRemainingMs_) {
      dwellRemainingMs_ -= deltaMs;
      return;
    }
    deltaMs -= dwellRemainingMs_;
    dwellRemainingMs_ = 0;
  }

  offsetPx_ += kSpeedPxPerSec * (static_cast<float>(deltaMs) / 1000.0F);

  //  A completed cycle returns to the start and dwells again, which is what
  //  makes a long name readable on the second pass as well as the first.
  while (offsetPx_ >= static_cast<float>(cycleWidth_)) {
    offsetPx_ -= static_cast<float>(cycleWidth_);
    dwellRemainingMs_ = kDwellMs;
  }
}

}  // namespace skypanel
