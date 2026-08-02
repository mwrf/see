#include "DeviceConfig.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace skypanel {
namespace {

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; }

} // namespace

bool normaliseBackendUrl(const char *input, char *out, size_t capacity) {
  if (input == nullptr || out == nullptr || capacity == 0) {
    return false;
  }
  out[0] = '\0';

  // Trim.
  while (*input != '\0' && isSpace(*input)) {
    ++input;
  }
  size_t length = std::strlen(input);
  while (length > 0 && isSpace(input[length - 1])) {
    --length;
  }
  if (length == 0) {
    return false;
  }

  char work[kUrlLen * 2];
  if (length >= sizeof(work)) {
    return false;
  }
  std::memcpy(work, input, length);
  work[length] = '\0';

  // Strip the scheme; https is accepted from the user and downgraded, because the
  // device speaks plain HTTP to a host on the LAN and silently failing on a typed
  // "https://" would be baffling.
  char *host = work;
  if (std::strncmp(host, "http://", 7) == 0) {
    host += 7;
  } else if (std::strncmp(host, "https://", 8) == 0) {
    host += 8;
  }

  // Drop any path — the client appends `/api/frame` itself.
  char *slash = std::strchr(host, '/');
  if (slash != nullptr) {
    *slash = '\0';
  }
  if (*host == '\0') {
    return false;
  }

  // Validate the port if one was given, so a typo fails here rather than at poll time.
  char *colon = std::strchr(host, ':');
  if (colon != nullptr) {
    if (colon[1] == '\0') {
      *colon = '\0'; // "host:" — treat as no port
    } else {
      for (const char *p = colon + 1; *p != '\0'; ++p) {
        if (*p < '0' || *p > '9') {
          return false;
        }
      }
      const long port = std::strtol(colon + 1, nullptr, 10);
      if (port <= 0 || port > 65535) {
        return false;
      }
    }
  }

  const int written = std::snprintf(out, capacity, "http://%s", host);
  return written > 0 && static_cast<size_t>(written) < capacity;
}

void provisioningSsid(const uint8_t mac[6], char *out, size_t capacity) {
  std::snprintf(out, capacity, "SkyPanel-%02X%02X", mac[4], mac[5]);
}

} // namespace skypanel

// --------------------------------------------------------------------- storage

#ifdef ARDUINO_ARCH_ESP32

#include <Preferences.h>

namespace skypanel {
namespace {

constexpr const char *kNamespace = "skypanel";

} // namespace

bool loadDeviceConfig(DeviceConfig &config) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, true)) {
    return false;
  }
  prefs.getString("ssid", config.ssid, sizeof(config.ssid));
  prefs.getString("pass", config.password, sizeof(config.password));
  prefs.getString("url", config.backendUrl, sizeof(config.backendUrl));
  config.fm6126a = prefs.getBool("fm6126a", false);
  prefs.end();
  return config.provisioned();
}

bool saveDeviceConfig(const DeviceConfig &config) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) {
    return false;
  }
  prefs.putString("ssid", config.ssid);
  prefs.putString("pass", config.password);
  prefs.putString("url", config.backendUrl);
  prefs.putBool("fm6126a", config.fm6126a);
  prefs.end();
  return true;
}

void clearDeviceConfig() {
  Preferences prefs;
  if (prefs.begin(kNamespace, false)) {
    prefs.clear();
    prefs.end();
  }
}

} // namespace skypanel

#else

namespace skypanel {

// Desktop build: nothing is persisted. The emulator takes its backend URL from argv.
bool loadDeviceConfig(DeviceConfig &) { return false; }
bool saveDeviceConfig(const DeviceConfig &) { return false; }
void clearDeviceConfig() {}

} // namespace skypanel

#endif
