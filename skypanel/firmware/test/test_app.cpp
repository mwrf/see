// PanelApp, the button debouncer, URL parsing and the file-backed client.
#include <cstring>
#include <string>

#include "Buttons.h"
#include "DeviceConfig.h"
#include "FileHttpClient.h"
#include "IDisplay.h"
#include "PanelApp.h"
#include "SocketHttpClient.h"
#include "TestFramework.h"

using skypanel::ButtonDebouncer;
using skypanel::ButtonEvent;
using skypanel::FileHttpClient;
using skypanel::HttpResponse;
using skypanel::IDisplay;
using skypanel::IHttpClient;
using skypanel::PanelApp;
using skypanel::PanelAppConfig;
using skypanel::SocketHttpClient;

namespace {

const char *kGoodFrame = R"({"mode":"nearest","source":"local","status":"live",
  "lines":[{"text":"RYANAIR","colour":"#073590","style":"title","scroll":"auto"}]})";

/// A client the test drives: it never touches a socket.
class FakeHttpClient : public IHttpClient {
 public:
  std::string body = kGoodFrame;
  bool succeed = true;
  int calls = 0;
  std::string lastUrl;

  HttpResponse get(const char *url, char *buffer, std::size_t capacity) override {
    ++calls;
    lastUrl = url;
    HttpResponse response;
    if (!succeed) {
      response.error = "NO BACKEND";
      return response;
    }
    std::snprintf(buffer, capacity, "%s", body.c_str());
    response.ok = true;
    response.status = 200;
    response.body = buffer;
    response.length = std::strlen(buffer);
    return response;
  }

  void setTimeout(uint32_t) override {}
};

class FakeDisplay : public IDisplay {
 public:
  int shows = 0;
  int clears = 0;
  uint8_t brightness = 0;
  bool beganOk = true;

  bool begin() override { return beganOk; }
  void show(const GFXcanvas16 &) override { ++shows; }
  void setBrightness(uint8_t value) override { brightness = value; }
  void clear() override { ++clears; }
};

PanelAppConfig testConfig() {
  PanelAppConfig config;
  std::snprintf(config.baseUrl, sizeof(config.baseUrl), "http://backend.local:8000");
  config.pollIntervalMs = 5000;
  config.frameIntervalMs = 33;
  return config;
}

}  // namespace

// -- PanelApp -----------------------------------------------------------

TEST(the_app_polls_the_frame_endpoint) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelApp app(http, display, testConfig());
  app.tick(0);
  CHECK_STR(http.lastUrl.c_str(), "http://backend.local:8000/api/frame");
}

TEST(a_trailing_slash_on_the_base_url_is_tolerated) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelAppConfig config = testConfig();
  std::snprintf(config.baseUrl, sizeof(config.baseUrl), "http://backend.local:8000/");
  PanelApp app(http, display, config);
  app.tick(0);
  CHECK_STR(http.lastUrl.c_str(), "http://backend.local:8000/api/frame");
}

TEST(a_successful_poll_becomes_the_rendered_frame) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelApp app(http, display, testConfig());
  app.tick(0);
  CHECK(app.lastPollOk());
  CHECK_STR(app.renderer().frame().lines[0].text, "RYANAIR");
  CHECK_STR(app.sourceLabel(), "local");
}

TEST(the_app_polls_on_its_interval_not_every_tick) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelApp app(http, display, testConfig());
  for (uint32_t t = 0; t <= 10100; t += 33) {
    app.tick(t);
  }
  //  One poll at 0 ms, and one each time the 5 s deadline passes.
  CHECK_EQ(http.calls, 3);
}

TEST(the_app_redraws_between_polls_so_scrolling_stays_smooth) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelApp app(http, display, testConfig());
  for (uint32_t t = 0; t < 1000; t += 33) {
    app.tick(t);
  }
  CHECK_EQ(http.calls, 1);
  CHECK(display.shows > 25);
}

TEST(a_failed_poll_keeps_the_last_good_frame_briefly) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelApp app(http, display, testConfig());
  app.tick(0);
  http.succeed = false;
  app.tick(5000);
  CHECK(!app.lastPollOk());
  //  A single dropped poll on WiFi is routine; do not panic the display.
  CHECK_STR(app.renderer().frame().lines[0].text, "RYANAIR");
}

TEST(a_long_outage_replaces_the_stale_aircraft_with_an_error) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelApp app(http, display, testConfig());
  app.tick(0);
  http.succeed = false;
  for (uint32_t t = 5000; t <= 90000; t += 5000) {
    app.tick(t);
  }
  CHECK(app.renderer().frame().mode == skypanel::FrameMode::Error);
  CHECK_STR(app.renderer().frame().lines[0].text, "NO BACKEND");
}

TEST(an_unparseable_body_shows_a_specific_error) {
  FakeHttpClient http;
  FakeDisplay display;
  http.body = "<html>your captive portal here</html>";
  PanelApp app(http, display, testConfig());
  app.tick(0);
  CHECK_STR(app.renderer().frame().lines[0].text, "BAD FRAME");
  CHECK_EQ(static_cast<int>(app.failureCount()), 1);
}

TEST(the_app_recovers_when_the_backend_returns) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelApp app(http, display, testConfig());
  http.succeed = false;
  app.tick(0);
  CHECK(app.renderer().frame().mode == skypanel::FrameMode::Error);

  http.succeed = true;
  app.tick(5000);
  CHECK(app.lastPollOk());
  CHECK_STR(app.renderer().frame().lines[0].text, "RYANAIR");
}

TEST(a_failed_display_begin_is_reported) {
  FakeHttpClient http;
  FakeDisplay display;
  display.beganOk = false;
  PanelApp app(http, display, testConfig());
  CHECK(!app.begin());
}

TEST(begin_applies_the_configured_brightness) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelAppConfig config = testConfig();
  config.brightness = 77;
  PanelApp app(http, display, config);
  CHECK(app.begin());
  CHECK_EQ(static_cast<int>(display.brightness), 77);
}

TEST(the_top_button_forces_a_poll) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelApp app(http, display, testConfig());
  app.tick(0);
  CHECK_EQ(http.calls, 1);
  app.onButton(ButtonEvent::TopShort, 100);
  app.tick(133);
  CHECK_EQ(http.calls, 2);
}

TEST(the_setup_hold_blanks_the_panel) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelApp app(http, display, testConfig());
  app.tick(0);
  app.onButton(ButtonEvent::SetupHold, 100);
  CHECK_EQ(display.clears, 1);
  CHECK_STR(app.renderer().frame().lines[0].text, "SETUP MODE");
}

TEST(the_poll_schedule_survives_a_millis_wraparound) {
  FakeHttpClient http;
  FakeDisplay display;
  PanelApp app(http, display, testConfig());
  app.tick(0xFFFFF000);
  const int before = http.calls;
  //  ~9 s later, past the wrap.
  app.tick(0x00001300);
  CHECK_EQ(http.calls, before + 1);
}

// -- button debouncing --------------------------------------------------

TEST(a_bouncing_contact_produces_one_press) {
  ButtonDebouncer button;
  CHECK(!button.update(true, 0));   // candidate only
  CHECK(!button.update(false, 5));  // bounced back
  CHECK(!button.update(true, 10));
  CHECK(button.update(true, 40));   // stable for longer than the debounce
  CHECK(button.pressed());
}

TEST(a_release_is_debounced_too) {
  ButtonDebouncer button;
  button.update(true, 0);
  button.update(true, 40);
  CHECK(!button.update(false, 45));
  CHECK(button.update(false, 80));
  CHECK(!button.pressed());
}

TEST(a_long_press_is_distinguishable) {
  ButtonDebouncer button;
  button.update(true, 0);
  button.update(true, 40);
  CHECK(!button.isLongPress(300));
  CHECK(button.isLongPress(1000));
  CHECK_EQ(button.heldMs(1000), static_cast<uint32_t>(960));
}

TEST(a_released_button_reports_no_hold_time) {
  ButtonDebouncer button;
  CHECK_EQ(button.heldMs(5000), static_cast<uint32_t>(0));
}

// -- device configuration -----------------------------------------------

TEST(a_fresh_device_is_not_provisioned) {
  skypanel::clearDeviceConfig();
  skypanel::DeviceConfig config;
  CHECK(!skypanel::loadDeviceConfig(config));
  CHECK(!config.provisioned());
  //  Defaults survive a failed load, so the portal starts with sane values.
  CHECK_STR(config.backendUrl, "http://raspberrypi.local:8000");
}

TEST(saved_configuration_round_trips) {
  skypanel::clearDeviceConfig();
  skypanel::DeviceConfig saved;
  std::snprintf(saved.ssid, sizeof(saved.ssid), "Kitchen");
  std::snprintf(saved.password, sizeof(saved.password), "hunter2");
  std::snprintf(saved.backendUrl, sizeof(saved.backendUrl), "http://pi.lan:8000");
  saved.brightness = 90;
  saved.fm6126a = true;
  CHECK(skypanel::saveDeviceConfig(saved));

  skypanel::DeviceConfig loaded;
  CHECK(skypanel::loadDeviceConfig(loaded));
  CHECK(loaded.provisioned());
  CHECK_STR(loaded.ssid, "Kitchen");
  CHECK_STR(loaded.backendUrl, "http://pi.lan:8000");
  CHECK_EQ(static_cast<int>(loaded.brightness), 90);
  CHECK(loaded.fm6126a);
  skypanel::clearDeviceConfig();
}

TEST(clearing_configuration_returns_the_device_to_setup) {
  skypanel::DeviceConfig saved;
  std::snprintf(saved.ssid, sizeof(saved.ssid), "Kitchen");
  skypanel::saveDeviceConfig(saved);
  skypanel::clearDeviceConfig();

  skypanel::DeviceConfig loaded;
  CHECK(!skypanel::loadDeviceConfig(loaded));
}

TEST(the_provisioning_ssid_is_recognisable) {
  CHECK(std::strncmp(skypanel::provisioningSsid(), "SkyPanel-", 9) == 0);
}

// -- URL parsing --------------------------------------------------------

TEST(url_parsing_handles_host_port_and_path) {
  std::string host;
  std::string path;
  int port = 0;
  CHECK(SocketHttpClient::parseUrl("http://pi.local:8000/api/frame", host, port, path));
  CHECK_STR(host.c_str(), "pi.local");
  CHECK_EQ(port, 8000);
  CHECK_STR(path.c_str(), "/api/frame");
}

TEST(url_parsing_defaults_the_port_and_path) {
  std::string host;
  std::string path;
  int port = 0;
  CHECK(SocketHttpClient::parseUrl("http://pi.local", host, port, path));
  CHECK_EQ(port, 80);
  CHECK_STR(path.c_str(), "/");
}

TEST(url_parsing_rejects_what_the_device_cannot_speak) {
  std::string host;
  std::string path;
  int port = 0;
  //  No TLS on the device: the backend is on the LAN by design.
  CHECK(!SocketHttpClient::parseUrl("https://pi.local/api/frame", host, port, path));
  CHECK(!SocketHttpClient::parseUrl("pi.local/api/frame", host, port, path));
  CHECK(!SocketHttpClient::parseUrl("http://", host, port, path));
  CHECK(!SocketHttpClient::parseUrl("http://pi.local:99999/", host, port, path));
  CHECK(!SocketHttpClient::parseUrl(nullptr, host, port, path));
}

// -- file-backed client -------------------------------------------------

TEST(the_file_client_reports_a_missing_file) {
  FileHttpClient client;
  std::string error;
  CHECK(!client.loadFrame("/nonexistent/frame.json", error));
  CHECK(!error.empty());
}

TEST(the_file_client_serves_a_loaded_frame) {
  //  Written next to the test binary so the suite needs no fixture path.
  const std::string path = "test_frame_tmp.json";
  FILE *file = std::fopen(path.c_str(), "w");
  std::fputs(kGoodFrame, file);
  std::fclose(file);

  FileHttpClient client;
  std::string error;
  CHECK(client.loadFrame(path, error));
  CHECK_EQ(client.frameCount(), static_cast<std::size_t>(1));

  char buffer[4096];
  const HttpResponse response = client.get("http://ignored/", buffer, sizeof(buffer));
  CHECK(response.ok);
  CHECK(std::strstr(response.body, "RYANAIR") != nullptr);
  std::remove(path.c_str());
}

TEST(the_file_client_advances_through_a_scenario_on_the_virtual_clock) {
  const std::string path = "test_scenario_tmp.jsonl";
  FILE *file = std::fopen(path.c_str(), "w");
  std::fputs(
      R"({"mode":"nearest","source":"a","status":"live","lines":[{"text":"ONE","colour":"#fff","style":"title"}]})"
      "\n"
      "# a comment line, skipped\n"
      "\n"
      R"({"mode":"nearest","source":"b","status":"live","lines":[{"text":"TWO","colour":"#fff","style":"title"}]})"
      "\n",
      file);
  std::fclose(file);

  FileHttpClient client;
  std::string error;
  CHECK(client.loadScenario(path, error));
  CHECK_EQ(client.frameCount(), static_cast<std::size_t>(2));
  client.setStepMs(1000);

  char buffer[4096];
  client.setTime(0);
  CHECK(std::strstr(client.get("u", buffer, sizeof(buffer)).body, "ONE") != nullptr);
  client.setTime(1000);
  CHECK(std::strstr(client.get("u", buffer, sizeof(buffer)).body, "TWO") != nullptr);
  //  Looping is the default, so it comes back around.
  client.setTime(2000);
  CHECK(std::strstr(client.get("u", buffer, sizeof(buffer)).body, "ONE") != nullptr);
  std::remove(path.c_str());
}

TEST(the_file_client_refuses_a_body_larger_than_the_device_buffer) {
  const std::string path = "test_big_tmp.json";
  FILE *file = std::fopen(path.c_str(), "w");
  std::string huge(9000, 'x');
  std::fputs(huge.c_str(), file);
  std::fclose(file);

  FileHttpClient client;
  std::string error;
  CHECK(client.loadFrame(path, error));
  char buffer[1024];
  CHECK(!client.get("u", buffer, sizeof(buffer)).ok);
  std::remove(path.c_str());
}
