// DisplayFrame → GFXcanvas16.
//
// This is the shared code the whole project is arranged around. It compiles for the
// ESP32-S3 and for the desktop from the same source, and it knows nothing about how the
// canvas is eventually shown: `IDisplay` takes it from here, to a HUB75 panel or to an
// SDL2 window. Anything that looks right in the emulator looks the same on the panel
// because there is only one of these.

#pragma once

#include <Adafruit_GFX.h>

#include <cstdint>

#include "Frame.h"
#include "Scroller.h"

namespace skypanel {

/// Where each element ends up. Exposed so tests can assert on layout without pixels.
struct Layout {
  int16_t lineY[kMaxLines] = {0, 0, 0, 0};
  int16_t lineViewport[kMaxLines] = {0, 0, 0, 0};
  uint8_t lineCount = 0;
  bool hasBar = false;
  int16_t barY = 0;
  bool hasEta = false;
  int16_t etaY = 0;
};

class Renderer {
public:
  Renderer(int16_t width = kPanelWidth, int16_t height = kPanelHeight);

  /// Replace the frame being displayed. Resets the scroll animation to the top of its
  /// cycle so a new aircraft always starts by showing the head of its name.
  void setFrame(const DisplayFrame &frame, uint32_t nowMs = 0);

  /// Draw the current frame as it should appear at `nowMs`.
  void render(uint32_t nowMs);

  /// True when the frame contains a line that is mid-scroll, i.e. the panel needs to be
  /// redrawn even though no new data has arrived.
  bool isAnimating() const;

  GFXcanvas16 &canvas() { return canvas_; }
  const GFXcanvas16 &canvas() const { return canvas_; }
  const DisplayFrame &frame() const { return frame_; }
  const Layout &layout() const { return layout_; }

  /// Visible for testing: recomputes `layout()` for the current frame.
  static Layout computeLayout(const DisplayFrame &frame, int16_t width, int16_t height);

  static const BitmapFont &fontFor(LineStyle style);

private:
  GFXcanvas16 canvas_;
  DisplayFrame frame_;
  Layout layout_;
  Scroller scroller_;
  uint32_t epochMs_ = 0;

  void drawStatusDot();
  void drawProgress();
};

} // namespace skypanel
