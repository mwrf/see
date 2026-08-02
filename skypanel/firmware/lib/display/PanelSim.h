// Turning a canvas into something that looks like an actual LED matrix.
//
// This is the part that decides whether the emulator is useful or merely
// pretty. Three effects matter, in this order:
//
//  1. **Gamma.** The HUB75 driver applies a 2.2 gamma ramp to its PWM. A
//     simulator that blits linear values makes mid-tones look far brighter
//     than they will be, which is the single biggest cause of "looked fine in
//     the sim, unreadable on the panel". Applied first, always.
//  2. **Dot pitch.** Real pixels are discrete emitters with dark gaps between
//     them. Rendering each pixel as a rounded dot with a gap is what lets you
//     judge whether a 3 px font is actually legible.
//  3. **Bloom.** LEDs bleed into their neighbours. Useful for judging colour
//     choices, harmful for snapshot tests, so it is off by default.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include <Adafruit_GFX.h>

namespace skypanel {

/// Physical pitch of the panel being simulated. P3 panels have proportionally
/// smaller gaps than P4, which changes how much a thin font "fills in".
enum class Pitch : uint8_t { P3, P4 };

struct PanelStyle {
  /// On-screen pixels per LED.
  int scale = 10;
  Pitch pitch = Pitch::P4;
  /// 0-255, matching IDisplay::setBrightness.
  uint8_t brightness = 255;
  /// The HUB75 library's default.
  float gamma = 2.2F;
  bool roundedDots = true;
  bool bloom = false;
  float bloomStrength = 0.35F;
  /// Colour of the unlit substrate between dots.
  uint8_t backgroundLevel = 8;

  /// Fraction of each cell the lit dot covers.
  float dotFill() const { return pitch == Pitch::P3 ? 0.82F : 0.70F; }
};

/// An 8-bit RGB image. Deliberately plain: the PNG and GIF writers, the SDL
/// texture upload and the WebSocket broadcast all consume this.
struct Image {
  int width = 0;
  int height = 0;
  std::vector<uint8_t> rgb;  ///< width * height * 3, row-major

  Image() = default;
  Image(int w, int h) : width(w), height(h), rgb(static_cast<std::size_t>(w) * h * 3, 0) {}

  std::size_t index(int x, int y) const {
    return (static_cast<std::size_t>(y) * width + x) * 3;
  }
  bool empty() const { return width <= 0 || height <= 0; }
};

/// Expand a canvas into a simulated panel image.
Image renderPanel(const GFXcanvas16 &canvas, const PanelStyle &style);

/// Expand a canvas 1:1, with gamma and brightness but no dots. Used by the
/// WebSocket view, which draws its own dots in the browser.
Image renderRaw(const GFXcanvas16 &canvas, const PanelStyle &style);

/// The gamma+brightness ramp, exposed for tests and for the HUB75 driver
/// comparison in docs/EMULATOR.md.
uint8_t applyRamp(uint8_t value, float gamma, uint8_t brightness);

/// RGB565 -> RGB888, replicating the high bits the way real panels do.
void unpack565(uint16_t packed, uint8_t &r, uint8_t &g, uint8_t &b);

}  // namespace skypanel
