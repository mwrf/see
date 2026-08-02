// WiFi provisioning: a captive portal on 192.168.4.1.
//
// The device brings up an access point called SkyPanel-XXXX, answers every DNS
// query with its own address so any URL opens the setup page, and collects the
// WiFi credentials plus the backend URL. Two front buttons held for three
// seconds gets you back here.
//
// Compiled only for the ESP32; the native build gets a stub so DeviceConfig
// and main() still link.
#pragma once

#include "DeviceConfig.h"

namespace skypanel {

class Provisioning {
 public:
  explicit Provisioning(DeviceConfig &config);
  ~Provisioning();

  /// Start the access point, DNS responder and web server.
  bool begin();

  /// Service pending requests. Call in a tight loop.
  void loop();

  /// True once the user has submitted a form; ``config`` now holds their
  /// answers and the caller should persist and reboot.
  bool completed() const { return completed_; }

  /// The AP's own address, and where the portal is served.
  static const char *portalAddress() { return "192.168.4.1"; }

 private:
  DeviceConfig &config_;
  bool completed_ = false;
  void *impl_ = nullptr;
};

}  // namespace skypanel
