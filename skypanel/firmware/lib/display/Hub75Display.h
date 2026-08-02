// The real panel: a 64x32 HUB75 matrix driven by the ESP32's I2S DMA engine.
//
// Compiled only for the esp32s3 environment; the native build stops at the
// #ifdef so the emulator never needs the driver headers.
#pragma once

#include <cstdint>

#include "IDisplay.h"

namespace skypanel {

struct Hub75Config {
  uint16_t width = 64;
  uint16_t height = 32;
  uint8_t chain = 1;

  /// Panels built around the FM6126A driver chip need a register init
  /// sequence; without it they show garbage or nothing at all. There is no
  /// way to detect it at runtime, so it is a config flag -- and it is the
  /// first thing to try when a new panel looks broken.
  bool fm6126a = false;

  /// Double-buffer so a half-drawn frame is never scanned out. Costs another
  /// framebuffer in DMA-capable RAM, which the S3 can afford at 64x32.
  bool doubleBuffer = true;

  /// I2S clock. 10-15 MHz suits a single 64x32 panel; higher rates reduce
  /// flicker but can produce ghosting on long ribbon cables.
  uint8_t clockPhase = 1;

  /// Starting brightness, 0-255. Capped by kMaxBrightness -- see the note in
  /// setBrightness().
  uint8_t brightness = 150;
};

class Hub75Display : public IDisplay {
 public:
  /// A 64x32 P4 panel showing text draws well under 1 A, but a full-white
  /// frame can pull several amps and brown out a USB-C supply -- which on an
  /// ESP32 shows up as a mysterious reboot loop rather than a dim panel. The
  /// cap keeps the worst case inside what a 5 V/3 A supply can hold up.
  static constexpr uint8_t kMaxBrightness = 200;

  explicit Hub75Display(const Hub75Config &config = {});
  ~Hub75Display() override;

  bool begin() override;
  void show(const GFXcanvas16 &canvas) override;
  void setBrightness(uint8_t brightness) override;
  void clear() override;

  /// True if the last reset looked like a supply sag rather than a clean boot
  /// or a crash. Surfaced on the panel so the cause is visible without a
  /// serial cable.
  static bool lastResetWasBrownout();

 private:
  Hub75Config config_;
  void *panel_ = nullptr;  // MatrixPanel_I2S_DMA, kept opaque in the header
};

}  // namespace skypanel
