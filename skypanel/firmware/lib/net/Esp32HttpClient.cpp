#include "Esp32HttpClient.h"

#if defined(ARDUINO_ARCH_ESP32)

#include <HTTPClient.h>
#include <WiFi.h>

#include <cstring>

namespace skypanel {

HttpResponse Esp32HttpClient::get(const char *url, char *buffer,
                                  std::size_t capacity) {
  HttpResponse response;
  if (buffer == nullptr || capacity == 0) {
    response.error = "no buffer";
    return response;
  }
  buffer[0] = '\0';

  if (WiFi.status() != WL_CONNECTED) {
    response.error = "WIFI DOWN";
    return response;
  }

  HTTPClient http;
  http.setTimeout(timeoutMs_);
  http.setConnectTimeout(static_cast<int32_t>(timeoutMs_));
  //  The backend is on the LAN, so redirects would mean a misconfiguration
  //  rather than something worth following.
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);

  if (!http.begin(url)) {
    response.error = "BAD URL";
    return response;
  }

  const int status = http.GET();
  response.status = status;
  if (status <= 0) {
    http.end();
    response.error = "NO BACKEND";
    return response;
  }
  if (status < 200 || status >= 300) {
    http.end();
    response.error = "BACKEND ERROR";
    return response;
  }

  //  Streaming into the caller's buffer avoids a second copy of the body,
  //  which matters when the frame arrives every few seconds and the heap has
  //  to stay unfragmented for weeks at a time.
  WiFiClient *stream = http.getStreamPtr();
  std::size_t total = 0;
  const uint32_t deadline = millis() + timeoutMs_;
  while (http.connected() && total + 1 < capacity && millis() < deadline) {
    const std::size_t available = static_cast<std::size_t>(stream->available());
    if (available == 0) {
      if (http.getSize() >= 0 && total >= static_cast<std::size_t>(http.getSize())) {
        break;
      }
      delay(1);
      continue;
    }
    const std::size_t room = capacity - 1 - total;
    const int read = stream->readBytes(buffer + total,
                                       available < room ? available : room);
    if (read <= 0) {
      break;
    }
    total += static_cast<std::size_t>(read);
  }
  buffer[total] = '\0';
  http.end();

  if (total == 0) {
    response.error = "EMPTY FRAME";
    return response;
  }
  response.body = buffer;
  response.length = total;
  response.ok = true;
  return response;
}

}  // namespace skypanel

#else

namespace skypanel {

HttpResponse Esp32HttpClient::get(const char *, char *buffer, std::size_t capacity) {
  if (buffer != nullptr && capacity > 0) {
    buffer[0] = '\0';
  }
  HttpResponse response;
  response.error = "Esp32HttpClient is only available on the device";
  return response;
}

}  // namespace skypanel

#endif
