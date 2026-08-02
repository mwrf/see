#include "Provisioning.h"

namespace skypanel {

const char *const kProvisioningPage = R"HTML(<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SkyPanel setup</title>
<style>
body{margin:0;padding:1.5rem;background:#0d1117;color:#e6edf3;
     font:16px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
form{max-width:24rem;margin:0 auto;display:grid;gap:1rem}
h1{font-size:1.2rem;margin:0 0 .5rem}
label{display:block;font-size:.85rem;color:#8b949e;margin-bottom:.3rem}
input{width:100%;box-sizing:border-box;font:inherit;color:#e6edf3;background:#161b22;
      border:1px solid #30363d;border-radius:.45rem;padding:.6rem}
button{font:inherit;font-weight:600;background:#58a6ff;color:#04121f;border:0;
       border-radius:.45rem;padding:.7rem;cursor:pointer}
p{font-size:.8rem;color:#8b949e;margin:0}
.row{display:flex;gap:.5rem;align-items:center}
.row input{width:auto}
</style></head><body>
<form method="POST" action="/save">
  <h1>SkyPanel setup</h1>
  <div><label for="ssid">WiFi network</label>
    <input id="ssid" name="ssid" required autocapitalize="off" autocorrect="off"></div>
  <div><label for="pass">WiFi password</label>
    <input id="pass" name="pass" type="password" autocapitalize="off"></div>
  <div><label for="url">Backend address</label>
    <input id="url" name="url" placeholder="raspberrypi.local:8000" required
           autocapitalize="off" autocorrect="off">
    <p>Where the SkyPanel backend is running. The scheme is optional.</p></div>
  <label class="row"><input type="checkbox" name="fm6126a" value="1">
    Panel shows garbage (FM6126A driver chip)</label>
  <button type="submit">Save and restart</button>
  <p>Hold both front buttons for three seconds to come back here.</p>
</form></body></html>)HTML";

} // namespace skypanel

#ifdef ARDUINO_ARCH_ESP32

#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

#include <cstring>

namespace skypanel {
namespace {

DNSServer dns;
WebServer server(80);
Provisioning *active = nullptr;
DeviceConfig *target = nullptr;
bool *submittedFlag = nullptr;

void handleRoot() { server.send(200, "text/html", kProvisioningPage); }

void handleSave() {
  DeviceConfig config;
  std::snprintf(config.ssid, sizeof(config.ssid), "%s", server.arg("ssid").c_str());
  std::snprintf(config.password, sizeof(config.password), "%s", server.arg("pass").c_str());
  config.fm6126a = server.hasArg("fm6126a");

  if (!normaliseBackendUrl(server.arg("url").c_str(), config.backendUrl,
                           sizeof(config.backendUrl))) {
    server.send(400, "text/html",
                "<!doctype html><meta charset=utf-8><body style='font-family:system-ui'>"
                "<p>That backend address didn't look right. "
                "Try something like <code>raspberrypi.local:8000</code>.</p>"
                "<p><a href='/'>Back</a></p>");
    return;
  }
  if (config.ssid[0] == '\0') {
    server.send(400, "text/html", "<p>A WiFi network name is required. <a href='/'>Back</a>");
    return;
  }

  if (target != nullptr) {
    *target = config;
  }
  if (submittedFlag != nullptr) {
    *submittedFlag = true;
  }
  server.send(200, "text/html",
              "<!doctype html><meta charset=utf-8><body style='font-family:system-ui'>"
              "<p>Saved. The panel is restarting and will join your network.</p>");
}

/// Every unknown host resolves to us, which is what makes phones pop the portal open.
void handleCaptive() {
  server.sendHeader("Location", "http://192.168.4.1/", true);
  server.send(302, "text/plain", "");
}

} // namespace

bool Provisioning::begin(char *ssidOut, size_t ssidCapacity) {
  uint8_t mac[6] = {0};
  WiFi.softAPmacAddress(mac);
  char ssid[24];
  provisioningSsid(mac, ssid, sizeof(ssid));
  if (ssidOut != nullptr) {
    std::snprintf(ssidOut, ssidCapacity, "%s", ssid);
  }

  WiFi.mode(WIFI_AP);
  // Open network on purpose: a WPA passphrase the user has to be told out-of-band is a
  // worse experience than an AP that exists for two minutes and serves one form.
  if (!WiFi.softAP(ssid)) {
    return false;
  }
  dns.start(53, "*", WiFi.softAPIP());

  active = this;
  target = &pending_;
  submittedFlag = &submitted_;
  submitted_ = false;

  server.on("/", HTTP_GET, handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  // The URLs iOS and Android probe to decide whether a network has internet.
  server.on("/hotspot-detect.html", HTTP_GET, handleCaptive);
  server.on("/generate_204", HTTP_GET, handleCaptive);
  server.on("/ncsi.txt", HTTP_GET, handleCaptive);
  server.onNotFound(handleCaptive);
  server.begin();

  running_ = true;
  return true;
}

bool Provisioning::poll(DeviceConfig &config) {
  if (!running_) {
    return false;
  }
  dns.processNextRequest();
  server.handleClient();
  if (!submitted_) {
    return false;
  }
  config = pending_;
  return true;
}

void Provisioning::end() {
  if (!running_) {
    return;
  }
  server.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  running_ = false;
  active = nullptr;
  target = nullptr;
  submittedFlag = nullptr;
}

} // namespace skypanel

#else

namespace skypanel {

bool Provisioning::begin(char *, size_t) { return false; }
bool Provisioning::poll(DeviceConfig &) { return false; }
void Provisioning::end() {}

} // namespace skypanel

#endif
