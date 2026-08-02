// What the device remembers across a power cut: WiFi credentials and where the backend
// lives. Stored in NVS under a single namespace so a factory reset is one erase.
//
// The string handling is pure and lives here rather than in the provisioning portal,
// because "the user typed the backend URL with a trailing slash / without a scheme /
// with the port on the wrong side" is the most common way this goes wrong and it is
// worth having tests for.

#pragma once

#include <cstddef>
#include <cstdint>

namespace skypanel {

constexpr size_t kSsidLen = 33;
constexpr size_t kPassLen = 65;
constexpr size_t kUrlLen = 96;

struct DeviceConfig {
  char ssid[kSsidLen] = "";
  char password[kPassLen] = "";
  char backendUrl[kUrlLen] = "";
  bool fm6126a = false;

  bool provisioned() const { return ssid[0] != '\0' && backendUrl[0] != '\0'; }
};

/// Normalise whatever the user typed into something `IHttpClient::get` accepts:
/// adds the `http://` scheme, strips a trailing slash and any path, keeps an explicit
/// port. Returns false if there is nothing usable in it.
bool normaliseBackendUrl(const char *input, char *out, size_t capacity);

/// `SkyPanel-4F2A` — the last two bytes of the MAC, so two panels in one house don't
/// advertise the same network.
void provisioningSsid(const uint8_t mac[6], char *out, size_t capacity);

/// Load from NVS; returns false when nothing has been stored yet.
bool loadDeviceConfig(DeviceConfig &config);
bool saveDeviceConfig(const DeviceConfig &config);
void clearDeviceConfig();

} // namespace skypanel
