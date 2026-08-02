#include "DeviceConfig.h"
#include "Hub75Display.h"
#include "testing.h"

#include <cstring>

using namespace skypanel;

namespace {

std::string normalised(const char *input) {
  char out[kUrlLen] = "";
  return normaliseBackendUrl(input, out, sizeof(out)) ? std::string(out) : std::string("<invalid>");
}

} // namespace

TEST(the_backend_address_accepts_what_a_person_would_actually_type) {
  CHECK_EQ(normalised("raspberrypi.local:8000"), std::string("http://raspberrypi.local:8000"));
  CHECK_EQ(normalised("http://raspberrypi.local:8000"),
           std::string("http://raspberrypi.local:8000"));
  CHECK_EQ(normalised("192.168.1.20:8000"), std::string("http://192.168.1.20:8000"));
  CHECK_EQ(normalised("raspberrypi.local"), std::string("http://raspberrypi.local"));
}

TEST(the_backend_address_is_tidied_up) {
  // Trailing slash, a path, surrounding whitespace, an empty port.
  CHECK_EQ(normalised("http://pi.local:8000/"), std::string("http://pi.local:8000"));
  CHECK_EQ(normalised("http://pi.local:8000/api/frame"), std::string("http://pi.local:8000"));
  CHECK_EQ(normalised("  pi.local:8000  \n"), std::string("http://pi.local:8000"));
  CHECK_EQ(normalised("pi.local:"), std::string("http://pi.local"));
}

TEST(a_typed_https_address_is_downgraded_rather_than_rejected) {
  // The device speaks plain HTTP to a LAN host; silently failing on a typed https://
  // would be baffling, so accept it and drop the scheme.
  CHECK_EQ(normalised("https://pi.local:8000"), std::string("http://pi.local:8000"));
}

TEST(a_nonsense_backend_address_is_rejected_at_setup_not_at_poll_time) {
  CHECK_EQ(normalised(""), std::string("<invalid>"));
  CHECK_EQ(normalised("   "), std::string("<invalid>"));
  CHECK_EQ(normalised("http://"), std::string("<invalid>"));
  CHECK_EQ(normalised("pi.local:eight-thousand"), std::string("<invalid>"));
  CHECK_EQ(normalised("pi.local:99999"), std::string("<invalid>"));
  CHECK_EQ(normalised(nullptr), std::string("<invalid>"));
}

TEST(an_over_long_address_does_not_overflow_the_buffer) {
  std::string huge = "http://" + std::string(400, 'a') + ".local";
  char out[kUrlLen];
  std::memset(out, 0x7F, sizeof(out));
  CHECK(!normaliseBackendUrl(huge.c_str(), out, sizeof(out)));
  CHECK(std::strlen(out) < kUrlLen);
}

TEST(the_provisioning_ssid_is_unique_per_device) {
  const uint8_t a[6] = {0xF4, 0x12, 0xFA, 0x00, 0x4F, 0x2A};
  const uint8_t b[6] = {0xF4, 0x12, 0xFA, 0x00, 0x91, 0xC3};
  char first[24];
  char second[24];
  provisioningSsid(a, first, sizeof(first));
  provisioningSsid(b, second, sizeof(second));
  CHECK_STREQ(first, "SkyPanel-4F2A");
  CHECK_STREQ(second, "SkyPanel-91C3");
}

TEST(a_device_without_both_ssid_and_backend_is_not_provisioned) {
  DeviceConfig config;
  CHECK(!config.provisioned());
  std::snprintf(config.ssid, sizeof(config.ssid), "home");
  CHECK(!config.provisioned());
  std::snprintf(config.backendUrl, sizeof(config.backendUrl), "http://pi.local:8000");
  CHECK(config.provisioned());
}

// -------------------------------------------------------------------- brightness

TEST(brightness_is_capped_so_a_bright_frame_cannot_brown_out_the_supply) {
  CHECK_EQ(static_cast<int>(clampBrightness(60, 160, false)), 60);
  CHECK_EQ(static_cast<int>(clampBrightness(255, 160, false)), 160);
  CHECK_EQ(static_cast<int>(clampBrightness(160, 160, false)), 160);
}

TEST(safe_mode_after_a_brownout_overrides_the_requested_brightness) {
  CHECK_EQ(static_cast<int>(clampBrightness(255, 160, true)),
           static_cast<int>(kSafeModeBrightness));
  // Still honours a request that is already dimmer than safe mode.
  CHECK_EQ(static_cast<int>(clampBrightness(8, 160, true)), 8);
}

TEST(the_desktop_stub_panel_never_claims_to_have_started) {
  Hub75Display panel;
  CHECK(!panel.begin()); // there is no HUB75 on a laptop
  panel.enterSafeMode();
  panel.setBrightness(255);
  CHECK_EQ(static_cast<int>(panel.brightness()), static_cast<int>(kSafeModeBrightness));
}
