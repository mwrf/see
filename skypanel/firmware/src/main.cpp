// SkyPanel firmware — Adafruit MatrixPortal S3 driving a 64x32 HUB75 panel.
//
// This file is glue and nothing else. It owns WiFi, the poll timer, the buttons and the
// OTA check. Every decision about what appears on the panel was made by the backend and
// is executed by `Renderer`, which is the same code the emulator runs.
//
// The loop:
//   every `pollIntervalS` (from the frame itself)  →  GET /api/frame, parse, hand to
//                                                      the renderer
//   every frame at ~30 fps                         →  render and blit, so scrolling
//                                                      animates between polls

#include <Arduino.h>
#include <WiFi.h>

#include "Buttons.h"
#include "DeviceConfig.h"
#include "Esp32HttpClient.h"
#include "Frame.h"
#include "FrameParser.h"
#include "Hub75Display.h"
#include "Provisioning.h"
#include "Renderer.h"

#ifdef SKYPANEL_WITH_OTA
#include <esp32FOTA.hpp>
#endif

using namespace skypanel;

namespace {

// MatrixPortal S3: one button on top, two on the front edge.
constexpr uint8_t kPinButtonTop = 6;
constexpr uint8_t kPinButtonFrontLeft = 7;
constexpr uint8_t kPinButtonFrontRight = 8;

constexpr uint32_t kTargetFrameMs = 33;   // ~30 fps
constexpr uint32_t kWifiTimeoutMs = 20000;
constexpr uint32_t kOtaCheckMs = 6UL * 3600UL * 1000UL;

constexpr const char *kFirmwareVersion = "0.1.0";

DeviceConfig deviceConfig;
Hub75Display *display = nullptr;
Renderer renderer;
Esp32HttpClient http;
Buttons buttons;
Provisioning portal;

DisplayFrame frame;
char frameUrl[kUrlLen + 16] = "";
uint32_t nextPollMs = 0;
uint32_t nextOtaCheckMs = kOtaCheckMs;
uint32_t lastRenderMs = 0;
uint8_t infoLineOffset = 0;

/// Build a frame locally, without the backend. Used for boot, WiFi trouble and setup
/// mode — the panel should always be saying something.
void showLocalMessage(const char *title, const char *detail, uint32_t colour,
                      FrameStatus status) {
  DisplayFrame local;
  local.mode = FrameMode::Error;
  local.status = status;
  std::snprintf(local.source, sizeof(local.source), "device");

  text::decode(title, local.lines[0].text);
  local.lines[0].colour = colour;
  local.lines[0].style = LineStyle::Title;
  local.lines[0].scroll = ScrollMode::Auto;
  local.lineCount = 1;

  if (detail != nullptr && detail[0] != '\0') {
    text::decode(detail, local.lines[1].text);
    local.lines[1].colour = 0x808080;
    local.lines[1].style = LineStyle::Body;
    local.lines[1].scroll = ScrollMode::Auto;
    local.lineCount = 2;
  }

  frame = local;
  renderer.setFrame(frame, millis());
  renderer.render(millis());
  if (display != nullptr) {
    display->show(renderer.canvas());
  }
}

ButtonInput readButtons() {
  // The buttons pull to ground, so an active press reads LOW.
  return ButtonInput{
      digitalRead(kPinButtonTop) == LOW,
      digitalRead(kPinButtonFrontLeft) == LOW,
      digitalRead(kPinButtonFrontRight) == LOW,
  };
}

bool connectWifi() {
  showLocalMessage("CONNECTING", deviceConfig.ssid, 0x58A6FF, FrameStatus::Offline);
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("skypanel");
  // Sleep costs ~200 ms of latency on every poll and saves power we are not short of.
  WiFi.setSleep(false);
  WiFi.begin(deviceConfig.ssid, deviceConfig.password);

  const uint32_t deadline = millis() + kWifiTimeoutMs;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(200);
  }
  return WiFi.status() == WL_CONNECTED;
}

/// Drive the captive portal until the user submits, then persist and restart. Restart
/// rather than reconfigure in place: it is one code path instead of two, and setup
/// happens once.
[[noreturn]] void runProvisioning() {
  char ssid[24] = "SkyPanel";
  if (!portal.begin(ssid, sizeof(ssid))) {
    showLocalMessage("SETUP FAILED", "COULD NOT START AP", 0xFF4040, FrameStatus::Offline);
    delay(5000);
    ESP.restart();
  }

  char detail[64];
  std::snprintf(detail, sizeof(detail), "JOIN %s THEN 192.168.4.1", ssid);
  showLocalMessage("SETUP", detail, 0x58A6FF, FrameStatus::Offline);

  DeviceConfig submitted;
  while (true) {
    if (portal.poll(submitted)) {
      saveDeviceConfig(submitted);
      portal.end();
      showLocalMessage("SAVED", "RESTARTING", 0x3FB950, FrameStatus::Offline);
      delay(1500);
      ESP.restart();
    }
    // Keep animating so the panel doesn't look hung while someone finds their phone.
    const uint32_t now = millis();
    if (now - lastRenderMs >= kTargetFrameMs) {
      lastRenderMs = now;
      renderer.render(now);
      if (display != nullptr) {
        display->show(renderer.canvas());
      }
    }
    delay(2);
  }
}

void pollFrame() {
  const HttpResponse response = http.get(frameUrl);
  if (!response.ok()) {
    // Don't blank the panel: mark the existing frame stale and try again shortly. Only
    // after several consecutive failures is it worth telling the user.
    if (http.consecutiveFailures() >= 4) {
      showLocalMessage("NO BACKEND", response.error, 0xFF4040, FrameStatus::Offline);
      nextPollMs = millis() + 5000;
      return;
    }
    frame.status = FrameStatus::Stale;
    renderer.setFrame(frame, millis());
    nextPollMs = millis() + 2000;
    return;
  }

  DisplayFrame parsed;
  const ParseResult result = parseFrame(response.body, parsed);
  if (!result.ok) {
    Serial.printf("frame parse failed: %s\n", result.error);
    nextPollMs = millis() + 5000;
    return;
  }

  frame = parsed;
  renderer.setFrame(frame, millis());
  if (display != nullptr) {
    display->setBrightness(frame.brightness);
  }
  nextPollMs = millis() + static_cast<uint32_t>(frame.pollIntervalS * 1000.0F);
}

void checkOta() {
#ifdef SKYPANEL_WITH_OTA
  char manifest[kUrlLen + 32];
  std::snprintf(manifest, sizeof(manifest), "%s/firmware/manifest.json",
                deviceConfig.backendUrl);
  // The manifest is served by the backend, so an update never leaves the LAN.
  esp32FOTA fota("skypanel-s3", kFirmwareVersion);
  fota.setManifestURL(manifest);
  if (fota.execHTTPcheck()) {
    showLocalMessage("UPDATING", "DO NOT UNPLUG", 0xD29922, FrameStatus::Offline);
    fota.execOTA();
  }
#endif
  nextOtaCheckMs = millis() + kOtaCheckMs;
}

void handleButtons(uint32_t now) {
  switch (buttons.update(now, readButtons())) {
  case ButtonEvent::EnterSetup:
    portal.end();
    runProvisioning();
    break;

  case ButtonEvent::CancelTracking: {
    // Fire-and-forget: the backend owns tracking state, and the next poll will show the
    // result. A failure here is not worth interrupting the display for.
    char url[kUrlLen + 24];
    std::snprintf(url, sizeof(url), "%s/api/track/cancel", deviceConfig.backendUrl);
    http.get(url);
    nextPollMs = now;
    break;
  }

  case ButtonEvent::CycleLines:
    // Rotate which line is on top, so the telemetry can be read without waiting for a
    // scroll to come round.
    if (frame.lineCount > 1) {
      infoLineOffset = static_cast<uint8_t>((infoLineOffset + 1) % frame.lineCount);
      DisplayFrame rotated = frame;
      for (uint8_t i = 0; i < frame.lineCount; ++i) {
        rotated.lines[i] = frame.lines[(i + infoLineOffset) % frame.lineCount];
      }
      renderer.setFrame(rotated, now);
    }
    break;

  case ButtonEvent::None:
    break;
  }
}

} // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("SkyPanel %s\n", kFirmwareVersion);

  pinMode(kPinButtonTop, INPUT_PULLUP);
  pinMode(kPinButtonFrontLeft, INPUT_PULLUP);
  pinMode(kPinButtonFrontRight, INPUT_PULLUP);

  const bool provisioned = loadDeviceConfig(deviceConfig);

  Hub75Config panelConfig;
  panelConfig.fm6126a = deviceConfig.fm6126a;
  display = new Hub75Display(panelConfig);
  if (!display->begin()) {
    Serial.println("panel init failed");
  }
  if (Hub75Display::lastResetWasBrownout()) {
    // The supply sagged hard enough to reset us. Come back dim and say so, because the
    // fix is a better PSU and the symptom otherwise looks like a software crash.
    Serial.println("brownout reset — entering safe mode");
    showLocalMessage("BROWNOUT", "CHECK 5V SUPPLY", 0xD29922, FrameStatus::Offline);
    delay(2500);
  }

  // Both front buttons at boot is the escape hatch when the stored WiFi is wrong.
  const ButtonInput atBoot = readButtons();
  if (!provisioned || (atBoot.frontLeft && atBoot.frontRight)) {
    runProvisioning();
  }

  if (!connectWifi()) {
    showLocalMessage("NO WIFI", deviceConfig.ssid, 0xFF4040, FrameStatus::Offline);
    delay(4000);
    runProvisioning();
  }

  std::snprintf(frameUrl, sizeof(frameUrl), "%s/api/frame", deviceConfig.backendUrl);
  Serial.printf("polling %s\n", frameUrl);
  http.setTimeoutMs(3000);
  showLocalMessage("SKYPANEL", WiFi.localIP().toString().c_str(), 0x58A6FF,
                   FrameStatus::Offline);
  nextPollMs = millis() + 500;
}

void loop() {
  const uint32_t now = millis();

  handleButtons(now);

  if (WiFi.status() != WL_CONNECTED) {
    // The stack reconnects on its own; just stop polling until it does.
    frame.status = FrameStatus::Offline;
    nextPollMs = now + 1000;
  } else if (static_cast<int32_t>(now - nextPollMs) >= 0) {
    pollFrame();
  }

  if (static_cast<int32_t>(now - nextOtaCheckMs) >= 0 && WiFi.status() == WL_CONNECTED) {
    checkOta();
  }

  if (now - lastRenderMs >= kTargetFrameMs) {
    lastRenderMs = now;
    renderer.render(now);
    display->show(renderer.canvas());
  }

  // Yield rather than spin: the WiFi stack shares this core.
  delay(2);
}
