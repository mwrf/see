// SkyPanel firmware for the Adafruit MatrixPortal S3.
//
// The device does four things: join WiFi, poll one URL, draw, and read
// buttons. Everything else -- which aircraft, what units, which colour, what
// the lines say -- is decided by the backend, because a Pi can hold an airline
// database and an ESP32 cannot.
//
// The interesting logic all lives in lib/, compiled identically for the
// emulator; this file is the hardware wiring and nothing more.

#include <Arduino.h>
#include <WiFi.h>

#include "Buttons.h"
#include "DeviceConfig.h"
#include "Esp32HttpClient.h"
#include "Hub75Display.h"
#include "Ota.h"
#include "PanelApp.h"
#include "Provisioning.h"

using namespace skypanel;

namespace {

// -- pins --------------------------------------------------------------
//
// MatrixPortal S3: one button on top, two on the front edge. Keep in step
// with docs/HARDWARE.md.
constexpr uint8_t kButtonTop = 6;
constexpr uint8_t kButtonUp = 7;
constexpr uint8_t kButtonDown = 8;

/// Both front buttons held this long re-enters provisioning.
constexpr uint32_t kSetupHoldMs = 3000;

/// How long to wait for WiFi before giving up and showing the portal.
constexpr uint32_t kWifiTimeoutMs = 20000;

DeviceConfig g_config;
Hub75Display *g_display = nullptr;
Esp32HttpClient g_http;
PanelApp *g_app = nullptr;
OtaUpdater *g_ota = nullptr;
char g_manifestUrl[128] = {};

ButtonDebouncer g_top;
ButtonDebouncer g_up;
ButtonDebouncer g_down;
uint32_t g_frontHeldSinceMs = 0;

/// Show a single line of status while the panel has no frame to draw.
void showStatus(const char *message, Colour colour = Colour{0x60, 0x60, 0x60}) {
  if (g_display == nullptr) {
    return;
  }
  static Renderer renderer;
  DisplayFrame frame = makeErrorFrame(message);
  frame.lines[0].colour = colour;
  renderer.setFrame(frame);
  renderer.render();
  g_display->show(renderer.canvas());
}

bool connectWifi() {
  if (!g_config.provisioned()) {
    return false;
  }
  showStatus("CONNECTING");
  WiFi.mode(WIFI_STA);
  //  A stable hostname makes the device findable on the LAN, which matters
  //  when the backend is on the same network and someone is debugging.
  WiFi.setHostname("skypanel");
  WiFi.begin(g_config.ssid, g_config.password);

  const uint32_t deadline = millis() + kWifiTimeoutMs;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(200);
  }
  if (WiFi.status() != WL_CONNECTED) {
    showStatus("WIFI FAILED", Colour{0xFF, 0x40, 0x40});
    return false;
  }
  Serial.printf("WiFi connected: %s\n", WiFi.localIP().toString().c_str());
  return true;
}

/// Run the captive portal until the user submits credentials, then reboot into
/// the normal path.
[[noreturn]] void runProvisioning() {
  Provisioning portal(g_config);
  showStatus(provisioningSsid(), Colour{0x30, 0x90, 0xFF});
  portal.begin();

  while (true) {
    portal.loop();
    if (portal.completed()) {
      saveDeviceConfig(g_config);
      showStatus("SAVED", Colour{0x30, 0xC0, 0x60});
      delay(1500);
      ESP.restart();
    }
    delay(10);
  }
}

/// Both front buttons held together is the documented way back into setup.
bool setupRequested(uint32_t now) {
  const bool both = g_up.pressed() && g_down.pressed();
  if (!both) {
    g_frontHeldSinceMs = 0;
    return false;
  }
  if (g_frontHeldSinceMs == 0) {
    g_frontHeldSinceMs = now;
    return false;
  }
  return (now - g_frontHeldSinceMs) >= kSetupHoldMs;
}

void pollButtons(uint32_t now) {
  //  Buttons are wired active-low with internal pull-ups.
  const bool topPressed = digitalRead(kButtonTop) == LOW;
  const bool wasPressed = g_top.pressed();
  if (g_top.update(topPressed, now) && wasPressed && !g_top.pressed()) {
    //  Classify on release, so a long press is not also reported as a short one.
    g_app->onButton(g_top.isLongPress(now) ? ButtonEvent::TopLong : ButtonEvent::TopShort,
                    now);
  }

  g_up.update(digitalRead(kButtonUp) == LOW, now);
  g_down.update(digitalRead(kButtonDown) == LOW, now);
  if (setupRequested(now)) {
    g_app->onButton(ButtonEvent::SetupHold, now);
    clearDeviceConfig();
    delay(200);
    ESP.restart();
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(kButtonTop, INPUT_PULLUP);
  pinMode(kButtonUp, INPUT_PULLUP);
  pinMode(kButtonDown, INPUT_PULLUP);

  loadDeviceConfig(g_config);

  Hub75Config panelConfig;
  panelConfig.fm6126a = g_config.fm6126a;
  panelConfig.brightness = g_config.brightness;
  g_display = new Hub75Display(panelConfig);
  if (!g_display->begin()) {
    //  Nothing to show it on, so the serial log is the only channel left.
    Serial.println("HUB75 init failed -- check the ribbon cable and power");
  }

  //  A brownout reset means the supply sagged, almost always because a bright
  //  frame pulled more current than the PSU could hold. Say so on the panel:
  //  the alternative is a reboot loop with no explanation.
  if (Hub75Display::lastResetWasBrownout()) {
    Serial.println("last reset was a brownout; capping brightness");
    g_config.brightness = 80;
    g_display->setBrightness(g_config.brightness);
    showStatus("POWER SAG", Colour{0xFF, 0xA0, 0x00});
    delay(2500);
  }

  if (!g_config.provisioned() || !connectWifi()) {
    runProvisioning();  // does not return
  }

  PanelAppConfig appConfig;
  std::snprintf(appConfig.baseUrl, sizeof(appConfig.baseUrl), "%s", g_config.backendUrl);
  appConfig.pollIntervalMs = g_config.pollIntervalMs;
  appConfig.frameIntervalMs = 33;  // ~30 fps, enough for a 14 px/s marquee
  appConfig.brightness = g_config.brightness;

  g_app = new PanelApp(g_http, *g_display, appConfig);
  g_app->begin();

  std::snprintf(g_manifestUrl, sizeof(g_manifestUrl), "%s/api/firmware/manifest.json",
                g_config.backendUrl);
  g_ota = new OtaUpdater(g_manifestUrl);

  Serial.printf("polling %s every %u ms\n", g_config.backendUrl,
                static_cast<unsigned>(g_config.pollIntervalMs));
}

void loop() {
  const uint32_t now = millis();
  pollButtons(now);
  g_app->tick(now);

  //  WiFi drops happen; reconnect rather than sitting on an error frame
  //  forever. PanelApp keeps showing the last good frame in the meantime.
  static uint32_t nextWifiCheckMs = 0;
  if (static_cast<int32_t>(now - nextWifiCheckMs) >= 0) {
    nextWifiCheckMs = now + 10000;
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi dropped; reconnecting");
      WiFi.reconnect();
    }
  }

  //  OTA last: it is the only thing here that can block for seconds, and it
  //  only ever does so a few times a day.
  if (WiFi.status() == WL_CONNECTED && g_ota != nullptr) {
    g_ota->maybeUpdate(now);
  }

  delay(2);
}
