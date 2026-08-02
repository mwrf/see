// DisplayFrame -> GFXcanvas16. The one renderer, shared by both targets.
//
// This class is the whole reason the emulator can be trusted: the firmware
// blits the canvas to a HUB75 panel, the emulator blits it to an SDL window or
// a PNG, and neither of them draws a single pixel of its own. If it looks
// right in the emulator it is right on the panel.
//
// It owns no I/O, no clock and no network. Time arrives as a millisecond
// counter so the emulator can run it at 4x and the tests can run it at exactly
// the millisecond they care about.
#pragma once

#include <Adafruit_GFX.h>

#include <cstdint>

#include "DisplayFrame.h"
#include "Scroller.h"

namespace skypanel {

class Renderer {
 public:
  static constexpr int16_t kDefaultWidth = 64;
  static constexpr int16_t kDefaultHeight = 32;
  /// Rows reserved at the bottom for the tracking-mode progress bar.
  static constexpr int16_t kProgressReserve = 5;
  /// Vertical space between rendered lines.
  static constexpr int16_t kLineGap = 3;

  explicit Renderer(int16_t width = kDefaultWidth, int16_t height = kDefaultHeight);

  /// Replace the frame. Scroll positions restart only for lines whose text
  /// actually changed, so a refreshed altitude does not jerk the airline name
  /// back to the beginning every five seconds.
  void setFrame(const DisplayFrame &frame);

  const DisplayFrame &frame() const { return frame_; }

  /// Advance animation to an absolute time. The first call establishes the
  /// baseline and advances nothing.
  void tick(uint32_t nowMs);

  /// Draw the current frame into the canvas.
  void render();

  GFXcanvas16 &canvas() { return canvas_; }
  const GFXcanvas16 &canvas() const { return canvas_; }

  int16_t width() const { return canvas_.width(); }
  int16_t height() const { return canvas_.height(); }

  /// True if any line is currently animating -- the firmware uses this to
  /// decide whether it needs to keep redrawing between polls.
  bool animating() const;

 private:
  struct LineLayout {
    int16_t baselineY = 0;
    int16_t textWidth = 0;
    bool title = false;
  };

  void layout();
  void drawLine(std::size_t index);
  void drawStatusIndicator();
  void drawProgressBar();

  GFXcanvas16 canvas_;
  DisplayFrame frame_;
  LineLayout layouts_[kMaxLines];
  Scroller scrollers_[kMaxLines];
  char previousText_[kMaxLines][kMaxTextBytes] = {};
  uint32_t lastTickMs_ = 0;
  bool haveTick_ = false;
};

}  // namespace skypanel
