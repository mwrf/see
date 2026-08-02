#include "Scroller.h"
#include "testing.h"

using namespace skypanel;

TEST(text_that_fits_never_moves) {
  Scroller scroller;
  CHECK(!Scroller::overflows(40, 64));
  CHECK_EQ(scroller.offset(40, 64, 0), 0);
  CHECK_EQ(scroller.offset(40, 64, 100000), 0);
  CHECK_EQ(scroller.cycleMs(40, 64), 0u);
}

TEST(overflowing_text_holds_then_travels_then_holds) {
  ScrollTiming timing;
  timing.holdStartMs = 1000;
  timing.holdEndMs = 1000;
  timing.pixelsPerSecond = 10;
  Scroller scroller(timing);

  const int16_t textWidth = 104; // 40 px of overflow
  const int16_t viewport = 64;
  const int16_t distance = 40;
  const uint32_t travel = 4000; // 40 px at 10 px/s

  CHECK_EQ(scroller.offset(textWidth, viewport, 0), 0);
  CHECK_EQ(scroller.offset(textWidth, viewport, 999), 0);
  CHECK_EQ(scroller.offset(textWidth, viewport, 1000), 0);
  CHECK_EQ(scroller.offset(textWidth, viewport, 1000 + travel / 2), distance / 2);
  CHECK_EQ(scroller.offset(textWidth, viewport, 1000 + travel), distance);
  CHECK_EQ(scroller.offset(textWidth, viewport, 1000 + travel + 500), distance);
  CHECK_EQ(scroller.cycleMs(textWidth, viewport), 1000u + travel + 1000u);
}

TEST(the_cycle_repeats) {
  Scroller scroller;
  const int16_t textWidth = 100;
  const int16_t viewport = 64;
  const uint32_t cycle = scroller.cycleMs(textWidth, viewport);
  CHECK_EQ(scroller.offset(textWidth, viewport, 0),
           scroller.offset(textWidth, viewport, cycle));
  CHECK_EQ(scroller.offset(textWidth, viewport, cycle / 2),
           scroller.offset(textWidth, viewport, cycle + cycle / 2));
}

TEST(the_offset_never_exceeds_the_overflow) {
  Scroller scroller;
  const int16_t textWidth = 200;
  const int16_t viewport = 64;
  for (uint32_t t = 0; t < 30000; t += 37) {
    const int16_t offset = scroller.offset(textWidth, viewport, t);
    CHECK(offset >= 0);
    CHECK(offset <= textWidth - viewport);
  }
}

TEST(the_offset_is_monotonic_within_the_travel_phase) {
  Scroller scroller;
  const int16_t textWidth = 140;
  const int16_t viewport = 64;
  int16_t previous = 0;
  const uint32_t start = scroller.timing().holdStartMs;
  const uint32_t end = scroller.cycleMs(textWidth, viewport) - scroller.timing().holdEndMs;
  for (uint32_t t = start; t <= end; t += 20) {
    const int16_t offset = scroller.offset(textWidth, viewport, t);
    CHECK(offset >= previous);
    previous = offset;
  }
}

TEST(a_longer_line_takes_longer_to_traverse) {
  Scroller scroller;
  CHECK(scroller.cycleMs(200, 64) > scroller.cycleMs(100, 64));
}

TEST(a_zero_speed_does_not_divide_by_zero) {
  ScrollTiming timing;
  timing.pixelsPerSecond = 0;
  Scroller scroller(timing);
  // No travel time: it holds at the head, then snaps straight to the tail.
  CHECK_EQ(scroller.offset(200, 64, 0), 0);
  CHECK_EQ(scroller.offset(200, 64, 1500), static_cast<int16_t>(200 - 64));
}
