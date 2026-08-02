// A tiny blocking HTTP/1.1 client over POSIX sockets, for the native build.
//
// Plain HTTP only, which is the whole point: the device talks to a backend on
// the same LAN, so there is no TLS stack, no certificate store and no clock
// dependency. On the desktop this replaces the ESP32's HTTPClient with the
// same behaviour, including the timeout, so the emulator exercises the real
// failure modes (connection refused, slow backend, truncated body).
#pragma once

#include <string>

#include "IHttpClient.h"

namespace skypanel {

class SocketHttpClient : public IHttpClient {
 public:
  HttpResponse get(const char *url, char *buffer, std::size_t capacity) override;
  void setTimeout(uint32_t timeoutMs) override { timeoutMs_ = timeoutMs; }

  /// Split "http://host:port/path" into its parts. Exposed for tests, because
  /// URL parsing is where this sort of client usually goes wrong.
  static bool parseUrl(const char *url, std::string &host, int &port,
                       std::string &path);

 private:
  uint32_t timeoutMs_ = 4000;
  std::string error_;
};

}  // namespace skypanel
