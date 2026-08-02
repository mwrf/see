// The device's whole behaviour, minus the hardware.
//
// Poll the backend on a timer, parse, hand the frame to the renderer, redraw
// at ~30 fps so scrolling stays smooth between polls, and react to buttons.
// The firmware wires this to a HUB75 panel and an ESP32 HTTP client; the
// emulator wires it to an SDL window and a socket client. Neither adds
// behaviour of its own, which is the point: what you debug on a laptop is what
// runs on the device.
#pragma once

#include <cstddef>
#include <cstdint>

#include "Buttons.h"
#include "DisplayFrame.h"
#include "IDisplay.h"
#include "IHttpClient.h"
#include "Renderer.h"

namespace skypanel {

struct PanelAppConfig {
  /// Backend base URL, e.g. "http://raspberrypi.local:8000".
  char baseUrl[96] = "http://localhost:8000";
  uint32_t pollIntervalMs = 5000;
  /// Redraw rate between polls. 30 fps is smooth enough for a 14 px/s
  /// marquee and leaves the ESP32 idle most of the time.
  uint32_t frameIntervalMs = 33;
  uint8_t brightness = 150;
  /// After this long with no successful poll, replace the stale aircraft with
  /// an honest error rather than leaving a lie on the panel.
  uint32_t staleAfterMs = 60000;
};

class PanelApp {
 public:
  /// Frame bodies are small; 4 KB is several times the largest realistic one
  /// and still nothing on an S3.
  static constexpr std::size_t kBufferBytes = 4096;

  PanelApp(IHttpClient &http, IDisplay &display, const PanelAppConfig &config = {});

  /// Bring up the display. Returns false if the panel/window failed.
  bool begin();

  /// Drive one iteration. Polls if due, redraws if due. Cheap to call in a
  /// tight loop.
  void tick(uint32_t nowMs);

  /// Force a poll on the next tick.
  void requestPoll() { nextPollMs_ = 0; }

  void onButton(ButtonEvent event, uint32_t nowMs);

  const Renderer &renderer() const { return renderer_; }
  Renderer &renderer() { return renderer_; }

  /// Which source produced the frame currently on screen ("local", "mock"...).
  const char *sourceLabel() const { return renderer_.frame().source; }

  uint32_t pollCount() const { return pollCount_; }
  uint32_t failureCount() const { return failureCount_; }
  bool lastPollOk() const { return lastPollOk_; }

  /// Replace the frame directly, bypassing HTTP. Used by --frame and
  /// --scenario, and by the tests.
  void setFrame(const DisplayFrame &frame);

  PanelAppConfig &config() { return config_; }

 private:
  void poll(uint32_t nowMs);

  IHttpClient &http_;
  IDisplay &display_;
  PanelAppConfig config_;
  Renderer renderer_;

  uint32_t nextPollMs_ = 0;
  uint32_t nextFrameMs_ = 0;
  uint32_t lastSuccessMs_ = 0;
  bool haveSuccess_ = false;
  bool lastPollOk_ = false;
  uint32_t pollCount_ = 0;
  uint32_t failureCount_ = 0;
  /// Cycles which line the top button emphasises; reserved for the info-line
  /// cycling described in the hardware spec.
  uint8_t infoMode_ = 0;

  char buffer_[kBufferBytes] = {};
  char url_[128] = {};
};

}  // namespace skypanel
