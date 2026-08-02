// The seam between "what the panel shows" and "what the panel is".
//
// Everything above this line — Renderer, Scroller, Text, the fonts — is compiled
// identically for the ESP32 and the desktop. Everything below it is one of two things:
// a HUB75 matrix driven over I2S DMA, or an SDL2 window pretending to be one.

#pragma once

#include <Adafruit_GFX.h>

#include <cstdint>

namespace skypanel {

class IDisplay {
public:
  virtual ~IDisplay() = default;

  /// Bring the output up. False means the panel/window could not be created.
  virtual bool begin() = 0;

  /// 1–255, matching the HUB75 driver's scale.
  virtual void setBrightness(uint8_t brightness) = 0;

  /// Push a rendered canvas to the output.
  virtual void show(const GFXcanvas16 &canvas) = 0;

  /// True once the user has closed the emulator window. Always false on hardware.
  virtual bool shouldQuit() const { return false; }

  virtual void end() {}
};

} // namespace skypanel
