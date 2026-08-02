#include "PanelApp.h"

#include <cstdio>
#include <cstring>

#include "FrameParser.h"

namespace skypanel {
namespace {

void joinUrl(char *out, std::size_t capacity, const char *base, const char *path) {
  std::size_t length = std::strlen(base);
  //  Tolerate a trailing slash on the configured base URL; people paste it.
  while (length > 0 && base[length - 1] == '/') {
    --length;
  }
  std::snprintf(out, capacity, "%.*s%s", static_cast<int>(length), base, path);
}

}  // namespace

PanelApp::PanelApp(IHttpClient &http, IDisplay &display, const PanelAppConfig &config)
    : http_(http), display_(display), config_(config) {
  joinUrl(url_, sizeof(url_), config_.baseUrl, "/api/frame");
  http_.setTimeout(config_.pollIntervalMs > 4000 ? 4000 : config_.pollIntervalMs);
  renderer_.setFrame(makeErrorFrame("CONNECTING"));
}

bool PanelApp::begin() {
  if (!display_.begin()) {
    return false;
  }
  display_.setBrightness(config_.brightness);
  return true;
}

void PanelApp::setFrame(const DisplayFrame &frame) { renderer_.setFrame(frame); }

void PanelApp::tick(uint32_t nowMs) {
  //  Unsigned comparison against a deadline handles the millis() wrap without
  //  a special case: (now - deadline) stays small and positive after it.
  if (static_cast<int32_t>(nowMs - nextPollMs_) >= 0) {
    poll(nowMs);
    nextPollMs_ = nowMs + config_.pollIntervalMs;
  }

  if (static_cast<int32_t>(nowMs - nextFrameMs_) < 0) {
    return;
  }
  nextFrameMs_ = nowMs + config_.frameIntervalMs;

  renderer_.tick(nowMs);
  renderer_.render();
  display_.show(renderer_.canvas());
}

void PanelApp::poll(uint32_t nowMs) {
  ++pollCount_;
  const HttpResponse response = http_.get(url_, buffer_, kBufferBytes);
  if (!response.ok) {
    ++failureCount_;
    lastPollOk_ = false;
    //  Keep showing the last good frame briefly -- a single dropped poll on
    //  WiFi is routine -- but not indefinitely.
    if (!haveSuccess_ || (nowMs - lastSuccessMs_) >= config_.staleAfterMs) {
      renderer_.setFrame(makeErrorFrame(response.error[0] != '\0' ? response.error
                                                                 : "NO BACKEND"));
    }
    return;
  }

  DisplayFrame frame;
  const ParseResult parsed = parseFrame(response.body, frame);
  if (!parsed) {
    ++failureCount_;
    lastPollOk_ = false;
    renderer_.setFrame(makeErrorFrame("BAD FRAME"));
    return;
  }

  lastPollOk_ = true;
  haveSuccess_ = true;
  lastSuccessMs_ = nowMs;
  renderer_.setFrame(frame);
}

void PanelApp::onButton(ButtonEvent event, uint32_t nowMs) {
  switch (event) {
    case ButtonEvent::TopShort:
      //  Cycling the info lines is a display-side preference; the backend
      //  decides what the lines say, so all this does is ask for a fresh one.
      infoMode_ = static_cast<uint8_t>((infoMode_ + 1) % 3);
      requestPoll();
      break;
    case ButtonEvent::TopLong:
      requestPoll();
      break;
    case ButtonEvent::SetupHold:
      //  Provisioning is the firmware's business; from here it looks like a
      //  request to stop drawing.
      display_.clear();
      renderer_.setFrame(makeErrorFrame("SETUP MODE"));
      break;
    case ButtonEvent::None:
      break;
  }
  (void)nowMs;
}

}  // namespace skypanel
