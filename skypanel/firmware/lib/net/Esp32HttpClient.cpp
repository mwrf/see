#include "Esp32HttpClient.h"

#ifdef ARDUINO_ARCH_ESP32

#include <HTTPClient.h>
#include <WiFi.h>

#include <cstdio>
#include <cstring>

namespace skypanel {

HttpResponse Esp32HttpClient::fail(const char *message) {
  std::snprintf(error_, sizeof(error_), "%s", message);
  failures_++;
  return HttpResponse{0, nullptr, 0, error_};
}

HttpResponse Esp32HttpClient::get(const char *url) {
  if (WiFi.status() != WL_CONNECTED) {
    return fail("wifi down");
  }

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(static_cast<uint16_t>(timeoutMs_));
  http.setConnectTimeout(static_cast<int32_t>(timeoutMs_));
  // The backend is a machine on the same LAN and the payload is tiny; reusing the
  // connection across a five-second poll interval buys nothing and holds a socket open.
  http.setReuse(false);

  if (!http.begin(client, url)) {
    return fail("bad URL");
  }
  const int status = http.GET();
  if (status <= 0) {
    const char *reason = HTTPClient::errorToString(status).c_str();
    http.end();
    return fail(reason == nullptr ? "request failed" : reason);
  }

  const int length = http.getSize();
  if (length > static_cast<int>(kHttpBufferSize) - 1) {
    http.end();
    return fail("response too large");
  }

  WiFiClient *stream = http.getStreamPtr();
  size_t at = 0;
  const uint32_t deadline = millis() + timeoutMs_;
  while (http.connected() && at + 1 < kHttpBufferSize && millis() < deadline) {
    const size_t available = stream->available();
    if (available == 0) {
      if (length >= 0 && at >= static_cast<size_t>(length)) {
        break;
      }
      delay(1);
      continue;
    }
    const int read = stream->readBytes(buffer_ + at,
                                       min(available, kHttpBufferSize - 1 - at));
    if (read <= 0) {
      break;
    }
    at += static_cast<size_t>(read);
  }
  buffer_[at] = '\0';
  http.end();

  if (at == 0) {
    return fail("empty response");
  }
  failures_ = 0;
  error_[0] = '\0';
  return HttpResponse{status, buffer_, at, ""};
}

} // namespace skypanel

#else

namespace skypanel {

HttpResponse Esp32HttpClient::fail(const char *message) {
  std::snprintf(error_, sizeof(error_), "%s", message);
  failures_++;
  return HttpResponse{0, nullptr, 0, error_};
}

/// Desktop stub: the emulator uses PosixHttpClient instead.
HttpResponse Esp32HttpClient::get(const char *) {
  return fail("Esp32HttpClient is not available off-device");
}

} // namespace skypanel

#endif
