// WiFi provisioning: a captive portal at 192.168.4.1 on an open `SkyPanel-XXXX` AP.
//
// The panel itself shows the SSID and the address while the portal is up, which is the
// point of putting a display on the thing. Hold both front buttons for three seconds to
// come back here after the first setup.

#pragma once

#include <cstdint>

#include "DeviceConfig.h"

namespace skypanel {

/// The setup page. Kept as a single self-contained string: the device has no filesystem
/// mounted in this mode and a phone on an open AP with no internet will not fetch
/// anything external.
extern const char *const kProvisioningPage;

class Provisioning {
public:
  /// Bring up the AP, DNS catch-all and web server. Returns the SSID that was created.
  bool begin(char *ssidOut, size_t ssidCapacity);

  /// Service the portal. Returns true once the user has submitted a valid form, with
  /// the result in `config`.
  bool poll(DeviceConfig &config);

  void end();

  bool running() const { return running_; }

private:
  bool running_ = false;
  bool submitted_ = false;
  DeviceConfig pending_;
};

} // namespace skypanel
