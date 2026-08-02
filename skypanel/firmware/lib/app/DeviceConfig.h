// What the device remembers across reboots: WiFi credentials and the backend
// URL. Stored in NVS via Preferences on the ESP32; in memory on native, so the
// provisioning logic can be reasoned about without hardware.
#pragma once

#include <cstdint>

namespace skypanel {

struct DeviceConfig {
  char ssid[33] = {};
  char password[65] = {};
  char backendUrl[96] = "http://raspberrypi.local:8000";
  uint32_t pollIntervalMs = 5000;
  uint8_t brightness = 150;
  /// Panels built around the FM6126A driver chip need a register init
  /// sequence. Exposed in the portal because it cannot be detected.
  bool fm6126a = false;

  bool provisioned() const { return ssid[0] != '\0'; }
};

/// Load persisted config. Returns false when nothing has been stored yet, in
/// which case ``config`` keeps its defaults.
bool loadDeviceConfig(DeviceConfig &config);

/// Persist config. Returns false if the write failed.
bool saveDeviceConfig(const DeviceConfig &config);

/// Forget the credentials, which is what a setup-button hold does.
void clearDeviceConfig();

/// SSID for the provisioning access point: "SkyPanel-XXXX", where XXXX comes
/// from the MAC so two panels in one house do not collide.
const char *provisioningSsid();

}  // namespace skypanel
