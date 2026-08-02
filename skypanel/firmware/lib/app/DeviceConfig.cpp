#include "DeviceConfig.h"

#include <cstdio>
#include <cstring>

#if defined(ARDUINO_ARCH_ESP32)
#include <Preferences.h>
#include <WiFi.h>
#endif

namespace skypanel {
namespace {

constexpr const char *kNamespace = "skypanel";

#if !defined(ARDUINO_ARCH_ESP32)
//  Native builds keep the config in memory: enough for the provisioning logic
//  to be exercised in tests without pretending to have flash.
DeviceConfig &nativeStore() {
  static DeviceConfig store;
  return store;
}
bool nativeStored = false;
#endif

}  // namespace

#if defined(ARDUINO_ARCH_ESP32)

bool loadDeviceConfig(DeviceConfig &config) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, true)) {
    return false;
  }
  if (!prefs.isKey("ssid")) {
    prefs.end();
    return false;
  }
  prefs.getString("ssid", config.ssid, sizeof(config.ssid));
  prefs.getString("pass", config.password, sizeof(config.password));
  prefs.getString("url", config.backendUrl, sizeof(config.backendUrl));
  config.pollIntervalMs = prefs.getUInt("poll", config.pollIntervalMs);
  config.brightness = static_cast<uint8_t>(prefs.getUChar("bright", config.brightness));
  config.fm6126a = prefs.getBool("fm6126a", config.fm6126a);
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
  prefs.putUInt("poll", config.pollIntervalMs);
  prefs.putUChar("bright", config.brightness);
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

const char *provisioningSsid() {
  static char ssid[24] = {};
  if (ssid[0] == '\0') {
    uint8_t mac[6] = {};
    WiFi.macAddress(mac);
    std::snprintf(ssid, sizeof(ssid), "SkyPanel-%02X%02X", mac[4], mac[5]);
  }
  return ssid;
}

#else

bool loadDeviceConfig(DeviceConfig &config) {
  if (!nativeStored) {
    return false;
  }
  config = nativeStore();
  return config.provisioned();
}

bool saveDeviceConfig(const DeviceConfig &config) {
  nativeStore() = config;
  nativeStored = true;
  return true;
}

void clearDeviceConfig() {
  nativeStore() = DeviceConfig{};
  nativeStored = false;
}

const char *provisioningSsid() { return "SkyPanel-0000"; }

#endif

}  // namespace skypanel
