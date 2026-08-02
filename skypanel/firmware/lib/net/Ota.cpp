#include "Ota.h"

#if defined(ARDUINO_ARCH_ESP32)

#include <esp32FOTA.hpp>

namespace skypanel {
namespace {

esp32FOTA *asFota(void *handle) { return static_cast<esp32FOTA *>(handle); }

}  // namespace

OtaUpdater::OtaUpdater(const char *manifestUrl) : manifestUrl_(manifestUrl) {
  auto *fota = new esp32FOTA("skypanel", kFirmwareVersion);
  fota->setManifestURL(manifestUrl_);
  //  Plain HTTP on the LAN by design; see the note in Ota.h.
  fota->useDeviceID = false;
  impl_ = fota;
}

OtaUpdater::~OtaUpdater() { delete asFota(impl_); }

bool OtaUpdater::checkNow() {
  if (impl_ == nullptr) {
    return false;
  }
  if (!asFota(impl_)->execHTTPcheck()) {
    return false;
  }
  //  execOTA() flashes and reboots; if it returns, it failed.
  asFota(impl_)->execOTA();
  return false;
}

bool OtaUpdater::maybeUpdate(uint32_t nowMs) {
  if (static_cast<int32_t>(nowMs - nextCheckMs_) < 0) {
    return false;
  }
  nextCheckMs_ = nowMs + kCheckIntervalMs;
  return checkNow();
}

}  // namespace skypanel

#else

namespace skypanel {

OtaUpdater::OtaUpdater(const char *manifestUrl) : manifestUrl_(manifestUrl) {}
OtaUpdater::~OtaUpdater() = default;
bool OtaUpdater::checkNow() { return false; }
bool OtaUpdater::maybeUpdate(uint32_t) { return false; }

}  // namespace skypanel

#endif
