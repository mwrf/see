// The device's whole network surface: one plain-HTTP GET on the LAN.
//
// Kept behind an interface so the emulator can talk to a real backend over
// sockets, replay a JSON file, or return a canned error, all without the
// render path knowing which.
#pragma once

#include <cstddef>
#include <cstdint>

namespace skypanel {

struct HttpResponse {
  bool ok = false;
  int status = 0;
  /// Points into the caller-supplied buffer; valid until the next request.
  const char *body = "";
  std::size_t length = 0;
  const char *error = "";
};

class IHttpClient {
 public:
  virtual ~IHttpClient() = default;

  /// GET ``url`` into ``buffer``. The result is always NUL-terminated, so the
  /// body can go straight into the JSON parser.
  virtual HttpResponse get(const char *url, char *buffer, std::size_t capacity) = 0;

  /// Milliseconds before a request is abandoned. Short by design: a frame that
  /// arrives late is worse than a frame that is retried.
  virtual void setTimeout(uint32_t timeoutMs) = 0;
};

}  // namespace skypanel
