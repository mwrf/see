// Over-the-air updates, served by the SkyPanel backend on the LAN.
//
// esp32FOTA checks a JSON manifest and, if the advertised version is newer,
// downloads and flashes it. Pointing it at the backend rather than at GitHub
// keeps updates local: no internet, no TLS, no certificate expiry to trip over
// in three years' time.
//
// Manifest (GET /api/firmware/manifest.json):
//   {"type": "skypanel", "version": 2, "host": "raspberrypi.local",
//    "port": 8000, "bin": "/firmware/skypanel-2.bin"}
#pragma once

#include <cstdint>

namespace skypanel {

class OtaUpdater {
 public:
  /// Checked against the manifest's "version". Bump on every release.
  static constexpr int kFirmwareVersion = 1;

  /// Check no more often than this. Updates are not urgent, and a device that
  /// hammers the backend for a manifest is a device with a bug.
  static constexpr uint32_t kCheckIntervalMs = 6UL * 3600UL * 1000UL;

  explicit OtaUpdater(const char *manifestUrl);
  ~OtaUpdater();

  /// Check if due. Returns true if an update was found and flashed, in which
  /// case the device reboots and this never returns to the caller.
  bool maybeUpdate(uint32_t nowMs);

  /// Force a check now, ignoring the interval.
  bool checkNow();

 private:
  const char *manifestUrl_;
  uint32_t nextCheckMs_ = 60000;  // first check a minute after boot
  void *impl_ = nullptr;
};

}  // namespace skypanel
