// Turns a 64x32 canvas into something that looks like an LED matrix.
//
// This is what makes the emulator honest, and it is shared by the SDL window, the PNG
// snapshots and the GIF recorder so all three agree pixel for pixel.
//
// Three things it gets right, in rough order of how often they cause "looked fine in the
// sim, unreadable on the panel":
//
//  1. Gamma and brightness, together. The ESP32-HUB75-MatrixPanel-I2S-DMA library maps
//     8-bit colour to PWM duty through a 2.2 gamma ramp, so the panel emits light ∝
//     v^2.2 — which is also what a monitor does with the same value. At full brightness
//     and the default ramp the two therefore cancel, and that is worth knowing rather
//     than assuming. Where they stop cancelling is what this models: a panel configured
//     *without* the gamma table (`--gamma 1`) shows mid-greys far brighter than a naive
//     blit suggests, and brightness is applied by the driver in light units, so 25%
//     brightness is emphatically not 25% of the pixel value. Dim secondary text lives
//     exactly in the range where both effects bite.
//  2. Pitch and fill factor. A real P4 module is a 4 mm grid of ~1.9 mm emitters. Drawing
//     each logical pixel as a full square makes 5px type look far more legible than it
//     is; drawing it as a dot with a gap tells you the truth.
//  3. Brightness. The driver scales the PWM duty cycle, which interacts with gamma —
//     halving brightness does not halve perceived output.

#pragma once

#include <Adafruit_GFX.h>

#include <cstdint>
#include <vector>

namespace skypanel {

enum class Pitch : uint8_t { P3, P4 };

struct PanelStyle {
  Pitch pitch = Pitch::P4;
  int scale = 10;            ///< screen pixels per LED cell
  float gamma = 2.2F;        ///< matches the HUB75 library default
  uint8_t brightness = 255;  ///< same scale as IDisplay::setBrightness
  bool bloom = false;        ///< off for snapshot tests: it is a look, not a measurement
  float bloomStrength = 0.45F;
  uint32_t background = 0x000000;

  /// Emitter diameter as a fraction of the cell. P3 modules pack the dies closer
  /// together relative to the pitch than P4 ones do.
  float fillFactor() const { return pitch == Pitch::P3 ? 0.72F : 0.58F; }
};

/// An RGBA8888 image, row-major, tightly packed.
struct Image {
  int width = 0;
  int height = 0;
  std::vector<uint8_t> pixels;

  size_t index(int x, int y) const {
    return (static_cast<size_t>(y) * static_cast<size_t>(width) + static_cast<size_t>(x)) * 4;
  }
};

class PanelPainter {
public:
  explicit PanelPainter(PanelStyle style = {}) : style_(style) {}

  PanelStyle &style() { return style_; }
  const PanelStyle &style() const { return style_; }

  int outputWidth(const GFXcanvas16 &canvas) const {
    return canvas.width() * style_.scale;
  }
  int outputHeight(const GFXcanvas16 &canvas) const {
    return canvas.height() * style_.scale;
  }

  /// Render the canvas into `out`, resizing it if necessary.
  void paint(const GFXcanvas16 &canvas, Image &out) const;

  /// The 8-bit sRGB an LED cell will actually emit, after brightness and gamma. Exposed
  /// because it is the number worth asserting on in a test.
  void emittedColour(uint16_t rgb565Value, uint8_t &r, uint8_t &g, uint8_t &b) const;

private:
  PanelStyle style_;

  void drawCell(Image &out, int cellX, int cellY, uint8_t r, uint8_t g, uint8_t b) const;
  void applyBloom(Image &out) const;
};

} // namespace skypanel
