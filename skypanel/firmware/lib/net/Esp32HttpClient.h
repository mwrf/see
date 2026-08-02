// The device's `IHttpClient`, over the ESP32 WiFi stack.
//
// One blocking plain-HTTP GET to a host on the LAN, into a fixed buffer. No TLS: see
// IHttpClient.h for why.

#pragma once

#include "IHttpClient.h"

namespace skypanel {

/// A frame is under a kilobyte; this is generous and still fits comfortably in RAM.
constexpr size_t kHttpBufferSize = 4096;

class Esp32HttpClient : public IHttpClient {
public:
  HttpResponse get(const char *url) override;
  void setTimeoutMs(uint32_t timeoutMs) override { timeoutMs_ = timeoutMs; }

  /// Consecutive failures, so the caller can decide when to stop trusting the frame.
  uint16_t consecutiveFailures() const { return failures_; }

private:
  uint32_t timeoutMs_ = 3000;
  uint16_t failures_ = 0;
  char buffer_[kHttpBufferSize] = {0};
  char error_[96] = {0};

  HttpResponse fail(const char *message);
};

} // namespace skypanel
