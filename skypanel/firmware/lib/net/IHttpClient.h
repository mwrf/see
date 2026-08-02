// The other seam. Above it, `main.cpp` asks for a frame; below it, either an ESP32
// WiFiClient or a desktop socket.
//
// Plain HTTP only, and deliberately so: the device talks to a backend on the same LAN,
// and TLS on an ESP32 costs ~40 KB of heap and several seconds of handshake per poll for
// no benefit against a machine in the next room.

#pragma once

#include <cstddef>
#include <cstdint>

namespace skypanel {

struct HttpResponse {
  int status = 0;
  const char *body = nullptr;
  size_t length = 0;
  const char *error = "";

  bool ok() const { return status >= 200 && status < 300; }
};

class IHttpClient {
public:
  virtual ~IHttpClient() = default;

  /// GET `url` (http://host[:port]/path). The returned body points into storage owned
  /// by the client and stays valid until the next call.
  virtual HttpResponse get(const char *url) = 0;

  virtual void setTimeoutMs(uint32_t timeoutMs) = 0;
};

} // namespace skypanel
