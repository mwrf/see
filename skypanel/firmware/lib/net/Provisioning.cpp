#include "Provisioning.h"

#if defined(ARDUINO_ARCH_ESP32)

#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

#include <cstring>

namespace skypanel {
namespace {

struct PortalImpl {
  DNSServer dns;
  WebServer server{80};
};

PortalImpl *asImpl(void *handle) { return static_cast<PortalImpl *>(handle); }

/// The setup page. Deliberately one self-contained string with no external
/// assets: a captive portal that tries to load a CDN stylesheet shows a blank
/// page, because the device it is running on has no internet yet.
const char *kPage = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SkyPanel setup</title><style>
:root{color-scheme:dark}
body{margin:0;padding:1.2rem;background:#101216;color:#e8ecf2;
 font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
h1{font-size:1.2rem;margin:0 0 1rem}
label{display:block;margin:.9rem 0 .25rem;color:#9aa5b4;font-size:.85rem}
input,select{width:100%;box-sizing:border-box;padding:.7rem;font-size:1rem;
 background:#0d1015;color:#e8ecf2;border:1px solid #262c36;border-radius:8px}
button{width:100%;margin-top:1.4rem;padding:.9rem;font-size:1rem;font-weight:600;
 border:0;border-radius:10px;background:#4da3ff;color:#06101c}
p{color:#9aa5b4;font-size:.8rem;line-height:1.5}
</style></head><body>
<h1>SkyPanel setup</h1>
<form method="POST" action="/save">
<label for="ssid">WiFi network</label>
<input id="ssid" name="ssid" list="networks" required autofocus>
<datalist id="networks">%NETWORKS%</datalist>
<label for="pass">WiFi password</label>
<input id="pass" name="pass" type="password">
<label for="url">Backend URL</label>
<input id="url" name="url" value="%URL%" required>
<p>The address of the SkyPanel backend on your network, for example
http://raspberrypi.local:8000</p>
<label for="bright">Brightness (0-255)</label>
<input id="bright" name="bright" type="number" min="0" max="255" value="%BRIGHT%">
<label for="fm6126a">Panel driver chip</label>
<select id="fm6126a" name="fm6126a">
<option value="0">Standard shift register</option>
<option value="1" %FMSEL%>FM6126A</option>
</select>
<p>If the panel shows garbage or stays dark, try FM6126A.</p>
<button type="submit">Save and restart</button>
</form></body></html>)HTML";

String buildPage(const DeviceConfig &config) {
  String page(kPage);

  String networks;
  const int found = WiFi.scanNetworks();
  for (int i = 0; i < found && i < 20; ++i) {
    networks += "<option value=\"" + WiFi.SSID(i) + "\">";
  }
  page.replace("%NETWORKS%", networks);
  page.replace("%URL%", config.backendUrl);
  page.replace("%BRIGHT%", String(config.brightness));
  page.replace("%FMSEL%", config.fm6126a ? "selected" : "");
  return page;
}

void copyArg(char *dest, size_t capacity, const String &value) {
  std::snprintf(dest, capacity, "%s", value.c_str());
}

}  // namespace

Provisioning::Provisioning(DeviceConfig &config) : config_(config) {}

Provisioning::~Provisioning() {
  if (impl_ != nullptr) {
    asImpl(impl_)->server.stop();
    asImpl(impl_)->dns.stop();
    delete asImpl(impl_);
  }
}

bool Provisioning::begin() {
  auto *impl = new PortalImpl();
  impl_ = impl;

  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(provisioningSsid())) {
    return false;
  }
  //  Answer every DNS query with our own address: that is what makes phones
  //  pop the "sign in to network" sheet instead of leaving the user to type an
  //  IP address they were never told.
  impl->dns.start(53, "*", WiFi.softAPIP());

  impl->server.on("/", [this, impl]() {
    impl->server.send(200, "text/html", buildPage(config_));
  });

  impl->server.on("/save", HTTP_POST, [this, impl]() {
    copyArg(config_.ssid, sizeof(config_.ssid), impl->server.arg("ssid"));
    copyArg(config_.password, sizeof(config_.password), impl->server.arg("pass"));
    copyArg(config_.backendUrl, sizeof(config_.backendUrl), impl->server.arg("url"));
    const int brightness = impl->server.arg("bright").toInt();
    config_.brightness = static_cast<uint8_t>(brightness < 0 ? 0
                                              : brightness > 255 ? 255
                                                                 : brightness);
    config_.fm6126a = impl->server.arg("fm6126a") == "1";

    impl->server.send(200, "text/html",
                      "<!doctype html><meta charset=utf-8>"
                      "<body style='background:#101216;color:#e8ecf2;font-family:sans-serif;"
                      "padding:2rem'><h1>Saved</h1><p>SkyPanel is restarting.</p>");
    completed_ = true;
  });

  //  Captive-portal probes hit well-known paths; sending the setup page for
  //  everything is what triggers the sign-in sheet on iOS and Android alike.
  impl->server.onNotFound([this, impl]() {
    impl->server.send(200, "text/html", buildPage(config_));
  });

  impl->server.begin();
  return true;
}

void Provisioning::loop() {
  if (impl_ == nullptr) {
    return;
  }
  asImpl(impl_)->dns.processNextRequest();
  asImpl(impl_)->server.handleClient();
}

}  // namespace skypanel

#else  // native: provisioning has no meaning, but must still link

namespace skypanel {

Provisioning::Provisioning(DeviceConfig &config) : config_(config) {}
Provisioning::~Provisioning() = default;
bool Provisioning::begin() { return false; }
void Provisioning::loop() {}

}  // namespace skypanel

#endif
