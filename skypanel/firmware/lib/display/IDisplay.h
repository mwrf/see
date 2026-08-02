// The only thing the render path knows about hardware.
//
// One method matters: show(). Everything above it produces a GFXcanvas16 and
// hands it over; whether those pixels end up on a HUB75 panel, in an SDL
// window or in a PNG is the implementation's problem.
#pragma once

#include <Adafruit_GFX.h>

#include <cstdint>

namespace skypanel {

class IDisplay {
 public:
  virtual ~IDisplay() = default;

  /// Prepare the device. Returns false if the panel or window cannot be
  /// brought up, so main() can report it rather than drawing into the void.
  virtual bool begin() = 0;

  /// Blit a finished canvas.
  virtual void show(const GFXcanvas16 &canvas) = 0;

  /// 0-255. Both the HUB75 driver and the emulator dim the same way, so a
  /// brightness that reads well in the emulator reads well on the panel.
  virtual void setBrightness(uint8_t brightness) = 0;

  /// Blank the panel without tearing it down (night mode, shutdown).
  virtual void clear() = 0;

  /// False once the user has closed the emulator window; always true on
  /// hardware.
  virtual bool running() const { return true; }
};

}  // namespace skypanel
