#include "Hub75Display.h"

#if defined(ARDUINO_ARCH_ESP32)

#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <esp_system.h>

namespace skypanel {
namespace {

MatrixPanel_I2S_DMA *asPanel(void *handle) {
  return static_cast<MatrixPanel_I2S_DMA *>(handle);
}

}  // namespace

Hub75Display::Hub75Display(const Hub75Config &config) : config_(config) {}

Hub75Display::~Hub75Display() {
  if (panel_ != nullptr) {
    asPanel(panel_)->stopDMAoutput();
    delete asPanel(panel_);
  }
}

bool Hub75Display::begin() {
  HUB75_I2S_CFG::i2s_pins pins = {
      // MatrixPortal S3 pinout. Keep in step with docs/HARDWARE.md.
      42, 41, 40,  // R1, G1, B1
      38, 39, 37,  // R2, G2, B2
      45, 36, 48, 35,  // A, B, C, D
      -1,          // E (unused on a 1/16-scan 32-row panel)
      2, 47, 14,   // LAT, OE, CLK
  };

  HUB75_I2S_CFG config(config_.width, config_.height, config_.chain, pins);
  config.double_buff = config_.doubleBuffer;
  config.clkphase = config_.clockPhase != 0;
  //  Panels using the FM6126A driver chip stay dark until their registers are
  //  initialised; the library does that only when told which chip is fitted.
  config.driver = config_.fm6126a ? HUB75_I2S_CFG::FM6126A : HUB75_I2S_CFG::SHIFTREG;

  auto *panel = new MatrixPanel_I2S_DMA(config);
  if (!panel->begin()) {
    delete panel;
    return false;
  }
  panel_ = panel;
  setBrightness(config_.brightness);
  panel->clearScreen();
  return true;
}

void Hub75Display::show(const GFXcanvas16 &canvas) {
  if (panel_ == nullptr) {
    return;
  }
  auto *panel = asPanel(panel_);
  const uint16_t *buffer = canvas.getBuffer();
  const int16_t width = canvas.width();
  const int16_t height = canvas.height();

  //  drawPixel per pixel is 2048 calls for a 64x32 frame, which the S3 does in
  //  well under a millisecond -- far cheaper than the poll it follows, and it
  //  keeps this class free of any assumption about the driver's internal
  //  buffer layout.
  for (int16_t y = 0; y < height; ++y) {
    for (int16_t x = 0; x < width; ++x) {
      panel->drawPixel(x, y, buffer[static_cast<size_t>(y) * width + x]);
    }
  }
  if (config_.doubleBuffer) {
    panel->flipDMABuffer();
  }
}

void Hub75Display::setBrightness(uint8_t brightness) {
  if (panel_ == nullptr) {
    return;
  }
  asPanel(panel_)->setBrightness8(
      brightness > kMaxBrightness ? kMaxBrightness : brightness);
}

void Hub75Display::clear() {
  if (panel_ != nullptr) {
    asPanel(panel_)->clearScreen();
  }
}

bool Hub75Display::lastResetWasBrownout() {
  return esp_reset_reason() == ESP_RST_BROWNOUT;
}

}  // namespace skypanel

#else  // native build: the panel does not exist, but the class still must link

namespace skypanel {

Hub75Display::Hub75Display(const Hub75Config &config) : config_(config) {}
Hub75Display::~Hub75Display() = default;

bool Hub75Display::begin() { return false; }
void Hub75Display::show(const GFXcanvas16 &) {}
void Hub75Display::setBrightness(uint8_t) {}
void Hub75Display::clear() {}
bool Hub75Display::lastResetWasBrownout() { return false; }

}  // namespace skypanel

#endif
