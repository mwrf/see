#include "Scroller.h"

namespace skypanel {

uint32_t Scroller::travelMs(int16_t distance) const {
  if (distance <= 0 || timing_.pixelsPerSecond == 0) {
    return 0;
  }
  return (static_cast<uint32_t>(distance) * 1000U) / timing_.pixelsPerSecond;
}

uint32_t Scroller::cycleMs(int16_t textWidth, int16_t viewport) const {
  if (!overflows(textWidth, viewport)) {
    return 0;
  }
  const int16_t distance = static_cast<int16_t>(textWidth - viewport);
  return timing_.holdStartMs + travelMs(distance) + timing_.holdEndMs;
}

int16_t Scroller::offset(int16_t textWidth, int16_t viewport, uint32_t elapsedMs) const {
  if (!overflows(textWidth, viewport)) {
    return 0;
  }
  const int16_t distance = static_cast<int16_t>(textWidth - viewport);
  const uint32_t travel = travelMs(distance);
  const uint32_t cycle = timing_.holdStartMs + travel + timing_.holdEndMs;
  const uint32_t t = elapsedMs % cycle;

  if (t < timing_.holdStartMs) {
    return 0;
  }
  if (t >= timing_.holdStartMs + travel) {
    return distance;
  }
  const uint32_t moved = t - timing_.holdStartMs;
  // Integer maths throughout: the ESP32 has an FPU but the render loop shouldn't need it.
  return static_cast<int16_t>((static_cast<uint32_t>(distance) * moved) / travel);
}

} // namespace skypanel
