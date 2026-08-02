#include "Hub75Display.h"

namespace skypanel {

uint8_t clampBrightness(uint8_t requested, uint8_t ceiling, bool safeMode) {
  if (safeMode) {
    return requested < kSafeModeBrightness ? requested : kSafeModeBrightness;
  }
  return requested < ceiling ? requested : ceiling;
}

} // namespace skypanel

// ---------------------------------------------------------------------------
// Everything below this line touches the ESP32 and is compiled only for it. The
// desktop build gets the pure helpers above and nothing else.
// ---------------------------------------------------------------------------

#ifdef ARDUINO_ARCH_ESP32

#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <esp_system.h>

namespace skypanel {
namespace {

MatrixPanel_I2S_DMA *as_panel(void *p) { return static_cast<MatrixPanel_I2S_DMA *>(p); }

} // namespace

Hub75Display::~Hub75Display() { end(); }

bool Hub75Display::lastResetWasBrownout() {
  return esp_reset_reason() == ESP_RST_BROWNOUT;
}

bool Hub75Display::begin() {
  HUB75_I2S_CFG::i2s_pins pins = {
      config_.pins.r1, config_.pins.g1, config_.pins.b1,
      config_.pins.r2, config_.pins.g2, config_.pins.b2,
      config_.pins.a,  config_.pins.b,  config_.pins.c,
      config_.pins.d,  config_.pins.e,  config_.pins.lat,
      config_.pins.oe, config_.pins.clk,
  };
  HUB75_I2S_CFG mxconfig(config_.width, config_.height, config_.chain, pins);
  mxconfig.double_buff = true;
  mxconfig.clkphase = false;
  if (config_.fm6126a) {
    mxconfig.driver = HUB75_I2S_CFG::FM6126A;
  }

  panel_ = new MatrixPanel_I2S_DMA(mxconfig);
  if (!as_panel(panel_)->begin()) {
    delete as_panel(panel_);
    panel_ = nullptr;
    return false;
  }
  as_panel(panel_)->setLatBlanking(2);

  // A brownout reset means the previous frame drew more than the supply could hold.
  // Come back dim; the operator can raise it once they have looked at the wiring.
  if (lastResetWasBrownout()) {
    enterSafeMode();
  }
  setBrightness(config_.brightness);
  as_panel(panel_)->clearScreen();
  return true;
}

void Hub75Display::enterSafeMode() { safeMode_ = true; }

void Hub75Display::setBrightness(uint8_t brightness) {
  applied_ = clampBrightness(brightness, config_.maxBrightness, safeMode_);
  if (panel_ != nullptr) {
    as_panel(panel_)->setBrightness8(applied_);
  }
}

void Hub75Display::show(const GFXcanvas16 &canvas) {
  if (panel_ == nullptr) {
    return;
  }
  MatrixPanel_I2S_DMA *panel = as_panel(panel_);
  const uint16_t *buffer = canvas.getBuffer();
  const int16_t width = canvas.width();
  const int16_t height = canvas.height();

  // drawPixel per cell rather than a bulk copy: the library owns its DMA buffer layout,
  // and at 2048 pixels this costs well under a millisecond.
  for (int16_t y = 0; y < height; ++y) {
    for (int16_t x = 0; x < width; ++x) {
      panel->drawPixel(x, y, buffer[y * width + x]);
    }
  }
  panel->flipDMABuffer();
}

void Hub75Display::end() {
  if (panel_ != nullptr) {
    as_panel(panel_)->stopDMAoutput();
    delete as_panel(panel_);
    panel_ = nullptr;
  }
}

} // namespace skypanel

#else

// Desktop build: the class exists so callers compile, but it never lights anything.
namespace skypanel {

Hub75Display::~Hub75Display() = default;
bool Hub75Display::lastResetWasBrownout() { return false; }
bool Hub75Display::begin() { return false; }
void Hub75Display::enterSafeMode() { safeMode_ = true; }
void Hub75Display::setBrightness(uint8_t brightness) {
  applied_ = clampBrightness(brightness, config_.maxBrightness, safeMode_);
}
void Hub75Display::show(const GFXcanvas16 &) {}
void Hub75Display::end() {}

} // namespace skypanel

#endif
