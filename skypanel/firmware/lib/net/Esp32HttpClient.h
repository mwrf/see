// The device's HTTP client: Arduino HTTPClient over plain HTTP on the LAN.
#pragma once

#include "IHttpClient.h"

namespace skypanel {

class Esp32HttpClient : public IHttpClient {
 public:
  HttpResponse get(const char *url, char *buffer, std::size_t capacity) override;
  void setTimeout(uint32_t timeoutMs) override { timeoutMs_ = timeoutMs; }

 private:
  uint32_t timeoutMs_ = 4000;
};

}  // namespace skypanel
