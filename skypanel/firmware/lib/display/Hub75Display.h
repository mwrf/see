// The hardware `IDisplay`: a 64x32 HUB75 panel driven over I2S DMA.
//
// ESP32 only. The native build never compiles this file's body; `IDisplay` is the seam
// and `EmulatorDisplay` is the other side of it.

#pragma once

#include <cstdint>

#include "IDisplay.h"

namespace skypanel {

struct Hub75Pins {
  // The MatrixPortal S3's fixed HUB75 wiring. Change these only for a hand-wired panel.
  int8_t r1 = 42, g1 = 41, b1 = 40;
  int8_t r2 = 38, g2 = 39, b2 = 37;
  int8_t a = 45, b = 36, c = 48, d = 35, e = 21;
  int8_t lat = 47, oe = 14, clk = 2;
};

struct Hub75Config {
  uint16_t width = 64;
  uint16_t height = 32;
  uint8_t chain = 1;
  Hub75Pins pins;

  /// Panels built around an FM6126A driver chip need a register init sequence before
  /// they will show anything but noise. There is no way to detect this from software —
  /// if the panel shows garbage on first power-up, set this.
  bool fm6126a = false;

  /// The driver's colour depth. 8 bits is the library default; dropping to 6 buys back
  /// refresh rate on a chained setup at the cost of banding in gradients. Text-only
  /// content barely notices, but the default is left alone.
  uint8_t colourDepth = 8;

  uint8_t brightness = 60;

  /// Ceiling enforced in software. A 64x32 P4 panel can pull several amps on a bright
  /// full-screen frame; text is well under an amp, but nothing stops a future frame
  /// from being brighter than the supply can hold up.
  uint8_t maxBrightness = 160;
};

class Hub75Display : public IDisplay {
public:
  explicit Hub75Display(Hub75Config config = {}) : config_(config) {}
  ~Hub75Display() override;

  bool begin() override;
  void setBrightness(uint8_t brightness) override;
  void show(const GFXcanvas16 &canvas) override;
  void end() override;

  /// True if the last reset looked like a brownout rather than a clean boot.
  static bool lastResetWasBrownout();

  /// Cuts brightness hard. Called after a brownout reset so the panel comes back up in
  /// a state the supply can definitely hold.
  void enterSafeMode();

  bool inSafeMode() const { return safeMode_; }
  uint8_t brightness() const { return applied_; }

private:
  Hub75Config config_;
  bool safeMode_ = false;
  uint8_t applied_ = 0;
  void *panel_ = nullptr; ///< MatrixPanel_I2S_DMA*, opaque so the header stays portable
};

/// Brightness actually applied, after the configured ceiling and safe mode. Pure, and
/// therefore tested on the desktop.
uint8_t clampBrightness(uint8_t requested, uint8_t ceiling, bool safeMode);

/// The safe-mode ceiling: low enough that a sagging supply recovers.
constexpr uint8_t kSafeModeBrightness = 24;

} // namespace skypanel
