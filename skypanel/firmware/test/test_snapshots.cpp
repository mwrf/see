// Golden-image tests: the regression suite for fonts, layout, scrolling and
// colour handling.
//
// Each fixture is rendered headless through the real PanelApp -> Renderer ->
// PanelSim path and compared pixel-for-pixel against emulator/snapshots/. Any
// difference fails, because at 64x32 a one-pixel change is a legibility
// change.
//
// Comparison decodes both PNGs rather than diffing the files: byte equality
// would make the suite fail whenever zlib changes its tables, which has
// nothing to do with what the panel shows.
//
// To accept intended changes: `just approve-snapshots`, then read the diff.

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "FileHttpClient.h"
#include "Gif.h"
#include "IDisplay.h"
#include "PanelApp.h"
#include "PanelSim.h"
#include "Png.h"
#include "TestFramework.h"

using skypanel::FileHttpClient;
using skypanel::Image;
using skypanel::PanelApp;
using skypanel::PanelAppConfig;
using skypanel::PanelStyle;

namespace skypanel {

/// A display that keeps the simulated image and nothing else -- the same code
/// path EmulatorDisplay uses headless, without the SDL dependency.
class EmulatorDisplayStub : public IDisplay {
 public:
  explicit EmulatorDisplayStub(PanelStyle style) : style_(style) {}

  bool begin() override { return true; }
  void show(const GFXcanvas16 &canvas) override {
    image_ = renderPanel(canvas, style_);
  }
  void setBrightness(uint8_t value) override { style_.brightness = value; }
  void clear() override { image_ = Image(); }

  const Image &image() const { return image_; }

 private:
  PanelStyle style_;
  Image image_;
};

}  // namespace skypanel

namespace {

struct Snapshot {
  const char *fixture;
  const char *name;
  /// Virtual milliseconds to advance before capturing, so scrolling state is
  /// pinned as well as the static layout.
  uint32_t atMs;
};

const Snapshot kSnapshots[] = {
    {"ryanair.json", "ryanair", 0},
    {"ryanair.json", "ryanair-scrolled", 3000},
    {"aer-lingus.json", "aer-lingus", 0},
    {"british-airways.json", "british-airways", 0},
    {"british-airways.json", "british-airways-scrolled", 4000},
    {"cities.json", "cities", 0},
    {"metric.json", "metric", 0},
    {"military.json", "military", 0},
    {"helicopter.json", "helicopter", 0},
    {"no-route.json", "no-route", 0},
    {"empty.json", "empty", 0},
    {"error.json", "error", 0},
    {"tracking.json", "tracking", 0},
};

/// Fixed style for every snapshot: bloom off (it is a blur, and blurs make
/// diffs unreadable), scale 4 (large enough to see dot shape, small enough
/// that the goldens stay a few kilobytes).
PanelStyle snapshotStyle() {
  PanelStyle style;
  style.scale = 4;
  style.bloom = false;
  style.brightness = 255;
  return style;
}

std::string fixturePath(const char *name) {
  return std::string(SKYPANEL_FIXTURE_DIR) + "/" + name;
}

std::string goldenPath(const char *name) {
  return std::string(SKYPANEL_SNAPSHOT_DIR) + "/" + name + ".png";
}

bool approving() {
  const char *flag = std::getenv("SKYPANEL_APPROVE_SNAPSHOTS");
  return flag != nullptr && flag[0] == '1';
}

/// Render one fixture through the whole device path.
bool renderSnapshot(const Snapshot &snapshot, Image &out, std::string &error) {
  FileHttpClient http;
  if (!http.loadFrame(fixturePath(snapshot.fixture), error)) {
    return false;
  }

  skypanel::EmulatorDisplayStub display(snapshotStyle());
  PanelAppConfig config;
  config.frameIntervalMs = 33;
  PanelApp app(http, display, config);
  if (!app.begin()) {
    error = "display failed to start";
    return false;
  }

  app.tick(0);
  for (uint32_t t = 33; t <= snapshot.atMs; t += 33) {
    app.tick(t);
  }
  out = display.image();
  if (out.empty()) {
    error = "nothing was rendered";
    return false;
  }
  return true;
}

/// Count differing pixels, and describe the first one -- "3 pixels differ" is
/// far less useful than "at (17, 9): got #FF0000, expected #073590".
int comparePixels(const Image &actual, const Image &expected, std::string &detail) {
  if (actual.width != expected.width || actual.height != expected.height) {
    detail = "size " + std::to_string(actual.width) + "x" +
             std::to_string(actual.height) + " != " + std::to_string(expected.width) +
             "x" + std::to_string(expected.height);
    return -1;
  }
  int differing = 0;
  for (int y = 0; y < actual.height; ++y) {
    for (int x = 0; x < actual.width; ++x) {
      const std::size_t i = actual.index(x, y);
      if (actual.rgb[i] != expected.rgb[i] || actual.rgb[i + 1] != expected.rgb[i + 1] ||
          actual.rgb[i + 2] != expected.rgb[i + 2]) {
        if (differing == 0) {
          char buffer[160];
          std::snprintf(buffer, sizeof(buffer),
                        "first difference at (%d, %d): got #%02X%02X%02X, "
                        "expected #%02X%02X%02X",
                        x, y, actual.rgb[i], actual.rgb[i + 1], actual.rgb[i + 2],
                        expected.rgb[i], expected.rgb[i + 1], expected.rgb[i + 2]);
          detail = buffer;
        }
        ++differing;
      }
    }
  }
  return differing;
}

}  // namespace

TEST(golden_snapshots_match) {
  const bool approve = approving();
  for (const Snapshot &snapshot : kSnapshots) {
    Image actual;
    std::string error;
    if (!renderSnapshot(snapshot, actual, error)) {
      skytest::reportFailure(__FILE__, __LINE__,
                             std::string(snapshot.name) + ": " + error);
      continue;
    }

    const std::string golden = goldenPath(snapshot.name);
    if (approve) {
      if (!skypanel::writePng(golden, actual, error)) {
        skytest::reportFailure(__FILE__, __LINE__,
                               std::string(snapshot.name) + ": " + error);
      } else {
        std::printf("  approved %s\n", snapshot.name);
      }
      continue;
    }

    Image expected;
    if (!skypanel::readPng(golden, expected, error)) {
      skytest::reportFailure(
          __FILE__, __LINE__,
          std::string(snapshot.name) + ": " + error + " (run 'just approve-snapshots')");
      continue;
    }

    std::string detail;
    const int differing = comparePixels(actual, expected, detail);
    if (differing != 0) {
      //  Write the rendering next to the golden so the change can be looked at
      //  rather than guessed at.
      std::string ignored;
      skypanel::writePng(std::string(SKYPANEL_SNAPSHOT_DIR) + "/" + snapshot.name +
                             ".actual.png",
                         actual, ignored);
      skytest::reportFailure(__FILE__, __LINE__,
                             std::string(snapshot.name) + ": " +
                                 (differing < 0 ? detail
                                                : std::to_string(differing) +
                                                      " pixels differ; " + detail) +
                                 "\n    wrote " + snapshot.name + ".actual.png");
    }
  }
}

TEST(png_round_trips_exactly) {
  Image image(7, 3);
  for (std::size_t i = 0; i < image.rgb.size(); ++i) {
    image.rgb[i] = static_cast<uint8_t>(i * 7);
  }

  const std::string path = "png_roundtrip_tmp.png";
  std::string error;
  CHECK(skypanel::writePng(path, image, error));

  Image decoded;
  CHECK(skypanel::readPng(path, decoded, error));
  CHECK_EQ(decoded.width, 7);
  CHECK_EQ(decoded.height, 3);
  CHECK(decoded.rgb == image.rgb);
  std::remove(path.c_str());
}

TEST(png_writing_refuses_an_empty_image) {
  std::string error;
  CHECK(!skypanel::writePng("should_not_exist.png", Image(), error));
}

TEST(png_reading_rejects_a_non_png) {
  const std::string path = "not_a_png_tmp.bin";
  FILE *file = std::fopen(path.c_str(), "wb");
  std::fputs("definitely not a PNG", file);
  std::fclose(file);

  Image image;
  std::string error;
  CHECK(!skypanel::readPng(path, image, error));
  std::remove(path.c_str());
}

TEST(gif_recording_produces_a_playable_file) {
  Image frame(8, 4);
  for (std::size_t i = 0; i < frame.rgb.size(); i += 3) {
    frame.rgb[i] = 0x30;
    frame.rgb[i + 1] = 0x90;
    frame.rgb[i + 2] = 0xFF;
  }

  const std::string path = "gif_tmp.gif";
  std::string error;
  {
    skypanel::GifWriter gif;
    CHECK(gif.begin(path, 8, 4, 5, error));
    for (int i = 0; i < 3; ++i) {
      CHECK(gif.addFrame(frame, error));
    }
    CHECK_EQ(gif.frameCount(), 3);
    CHECK(gif.finish(error));
  }

  FILE *file = std::fopen(path.c_str(), "rb");
  CHECK(file != nullptr);
  char header[7] = {};
  std::size_t read = 0;
  if (file != nullptr) {
    read = std::fread(header, 1, 6, file);
    std::fseek(file, -1, SEEK_END);
    const int trailer = std::fgetc(file);
    std::fclose(file);
    CHECK_EQ(trailer, 0x3B);
  }
  CHECK_EQ(read, static_cast<std::size_t>(6));
  CHECK_STR(header, "GIF89a");
  std::remove(path.c_str());
}

TEST(gif_rejects_a_frame_of_the_wrong_size) {
  const std::string path = "gif_bad_tmp.gif";
  std::string error;
  skypanel::GifWriter gif;
  CHECK(gif.begin(path, 8, 4, 5, error));
  CHECK(!gif.addFrame(Image(9, 4), error));
  CHECK(gif.finish(error));
  std::remove(path.c_str());
}
