// skypanel-emu — the desktop host for the firmware's render path.
//
// Everything that decides what a pixel should be lives in firmware/lib/render and is
// compiled here unchanged. This file only supplies the things the ESP32 would otherwise
// provide: a frame to draw (from the backend, a file, or a recorded scenario), a clock,
// and some buttons.

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "EmulatorDisplay.h"
#include "FrameParser.h"
#include "PosixHttpClient.h"
#include "Renderer.h"
#include "src/Clock.h"
#include "src/Gif.h"
#include "src/Png.h"
#include "src/WebView.h"

using namespace skypanel;

namespace {

struct Options {
  std::string backend;
  std::string framePath;
  std::string scenarioPath;
  std::string snapshotPath;
  std::string recordPath;
  double durationS = 10.0;
  double stepS = 2.0; ///< scenario advance interval, before --speed
  float speed = 1.0F;
  uint32_t snapshotTimeMs = 0;
  int fps = 30;
  int scale = 10;
  Pitch pitch = Pitch::P4;
  float gamma = 2.2F;
  int brightness = 255;
  bool bloom = false;
  int webPort = 0;
  bool headless = false;
};

void usage() {
  std::puts(
      "skypanel-emu — LED panel emulator running the firmware's own renderer\n"
      "\n"
      "Frame sources (pick one):\n"
      "  --backend URL        poll URL/api/frame (e.g. http://localhost:8000)\n"
      "  --frame FILE         render one static frame from a JSON file\n"
      "  --scenario FILE      replay a .jsonl file, one frame per line\n"
      "\n"
      "Output:\n"
      "  --snapshot OUT.png   render once headless and exit (for tests)\n"
      "  --record OUT.gif     record to an animated GIF and exit\n"
      "  --duration SECONDS   how long to record (default 10)\n"
      "  --web PORT           also serve a browser view at http://localhost:PORT\n"
      "\n"
      "Timing:\n"
      "  --speed N            run the clock N× faster (scenarios, scrolling)\n"
      "  --step SECONDS       scenario frame interval before --speed (default 2)\n"
      "  --time MS            freeze the clock; makes snapshots reproducible\n"
      "  --fps N              render rate (default 30)\n"
      "\n"
      "Panel simulation:\n"
      "  --pitch P3|P4        emitter size relative to the grid (default P4)\n"
      "  --scale N            screen pixels per LED (default 10)\n"
      "  --gamma G            driver gamma (default 2.2, matches the HUB75 library)\n"
      "  --brightness N       1-255, dimmed the way the driver dims (default 255)\n"
      "  --bloom              add the glow a camera sees; off for snapshots\n"
      "\n"
      "Keys: space/up = top button, left/right = front pair, s = screenshot,\n"
      "      b = bloom, p = pitch, [ ] = brightness, q/esc = quit\n");
}

bool readFile(const std::string &path, std::string &out) {
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    return false;
  }
  std::ostringstream buffer;
  buffer << file.rdbuf();
  out = buffer.str();
  return true;
}

std::vector<std::string> readScenario(const std::string &path) {
  std::vector<std::string> frames;
  std::ifstream file(path);
  std::string line;
  while (std::getline(file, line)) {
    // Blank lines and #-comments make hand-written scenarios readable.
    const size_t first = line.find_first_not_of(" \t\r\n");
    if (first == std::string::npos || line[first] == '#') {
      continue;
    }
    frames.push_back(line);
  }
  return frames;
}

bool wants(const char *arg, const char *name) { return std::strcmp(arg, name) == 0; }

bool parseOptions(int argc, char **argv, Options &options) {
  for (int i = 1; i < argc; ++i) {
    const char *arg = argv[i];
    auto next = [&](const char *what) -> const char * {
      if (i + 1 >= argc) {
        std::fprintf(stderr, "%s needs a value\n", what);
        return nullptr;
      }
      return argv[++i];
    };

    if (wants(arg, "--help") || wants(arg, "-h")) {
      usage();
      return false;
    } else if (wants(arg, "--backend")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.backend = v;
    } else if (wants(arg, "--frame")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.framePath = v;
    } else if (wants(arg, "--scenario")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.scenarioPath = v;
    } else if (wants(arg, "--snapshot")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.snapshotPath = v;
      options.headless = true;
    } else if (wants(arg, "--record")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.recordPath = v;
      options.headless = true;
    } else if (wants(arg, "--duration")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.durationS = std::atof(v);
    } else if (wants(arg, "--step")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.stepS = std::atof(v);
    } else if (wants(arg, "--speed")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.speed = static_cast<float>(std::atof(v));
    } else if (wants(arg, "--time")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.snapshotTimeMs = static_cast<uint32_t>(std::atol(v));
    } else if (wants(arg, "--fps")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.fps = std::max(1, std::atoi(v));
    } else if (wants(arg, "--scale")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.scale = std::max(1, std::atoi(v));
    } else if (wants(arg, "--gamma")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.gamma = static_cast<float>(std::atof(v));
    } else if (wants(arg, "--brightness")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.brightness = std::clamp(std::atoi(v), 1, 255);
    } else if (wants(arg, "--pitch")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.pitch = (std::strcmp(v, "P3") == 0 || std::strcmp(v, "p3") == 0) ? Pitch::P3
                                                                              : Pitch::P4;
    } else if (wants(arg, "--bloom")) {
      options.bloom = true;
    } else if (wants(arg, "--web")) {
      const char *v = next(arg);
      if (v == nullptr) return false;
      options.webPort = std::atoi(v);
    } else if (wants(arg, "--headless")) {
      options.headless = true;
    } else {
      std::fprintf(stderr, "unknown option: %s (try --help)\n", arg);
      return false;
    }
  }
  return true;
}

/// Supplies frames from whichever source the user chose.
class FrameSource {
public:
  FrameSource(const Options &options) : options_(options) {
    if (!options.scenarioPath.empty()) {
      scenario_ = readScenario(options.scenarioPath);
    }
    http_.setTimeoutMs(2000);
  }

  const std::string &label() const { return label_; }
  const std::string &note() const { return note_; }
  const char *error() const { return error_.c_str(); }

  /// Fetch the frame that should be showing at `nowMs`. Returns false when nothing new
  /// is due — the caller keeps rendering the frame it already has.
  bool next(uint32_t nowMs, DisplayFrame &frame) {
    if (!options_.framePath.empty()) {
      if (loadedStatic_) {
        return false;
      }
      std::string json;
      if (!readFile(options_.framePath, json)) {
        error_ = "cannot read " + options_.framePath;
        return false;
      }
      loadedStatic_ = true;
      label_ = "file";
      return apply(json, frame);
    }

    if (!scenario_.empty()) {
      const uint32_t stepMs = static_cast<uint32_t>(options_.stepS * 1000.0);
      const size_t index = stepMs == 0 ? 0 : (nowMs / stepMs) % scenario_.size();
      if (loadedStatic_ && index == scenarioIndex_) {
        return false;
      }
      scenarioIndex_ = index;
      loadedStatic_ = true;
      label_ = "scenario";
      note_ = "frame " + std::to_string(index + 1) + "/" + std::to_string(scenario_.size());
      return apply(scenario_[index], frame);
    }

    if (!options_.backend.empty()) {
      if (loadedStatic_ && nowMs < nextPollMs_) {
        return false;
      }
      const std::string url = options_.backend + "/api/frame";
      const HttpResponse response = http_.get(url.c_str());
      if (!response.ok()) {
        error_ = response.status == 0
                     ? std::string("backend unreachable: ") + response.error
                     : "backend returned HTTP " + std::to_string(response.status);
        // Back off, but keep trying — the backend restarting shouldn't kill the panel.
        nextPollMs_ = nowMs + 2000;
        return false;
      }
      error_.clear();
      loadedStatic_ = true;
      if (!apply(response.body, frame)) {
        nextPollMs_ = nowMs + 2000;
        return false;
      }
      label_ = frame.source;
      nextPollMs_ = nowMs + static_cast<uint32_t>(frame.pollIntervalS * 1000.0F);
      return true;
    }

    error_ = "no frame source: pass --backend, --frame or --scenario";
    return false;
  }

private:
  const Options &options_;
  PosixHttpClient http_;
  std::vector<std::string> scenario_;
  size_t scenarioIndex_ = static_cast<size_t>(-1);
  bool loadedStatic_ = false;
  uint32_t nextPollMs_ = 0;
  std::string label_ = "none";
  std::string note_;
  std::string error_;

  bool apply(const std::string &json, DisplayFrame &frame) {
    const ParseResult result = parseFrame(json.c_str(), frame);
    if (!result.ok) {
      error_ = std::string("bad frame: ") + result.error;
      return false;
    }
    return true;
  }
};

} // namespace

int main(int argc, char **argv) {
  Options options;
  if (!parseOptions(argc, argv, options)) {
    return argc > 1 ? 2 : 0;
  }
  if (options.backend.empty() && options.framePath.empty() && options.scenarioPath.empty()) {
    std::fprintf(stderr, "nothing to display: pass --backend, --frame or --scenario\n");
    return 2;
  }

  PanelStyle style;
  style.pitch = options.pitch;
  style.scale = options.scale;
  style.gamma = options.gamma;
  style.brightness = static_cast<uint8_t>(options.brightness);
  style.bloom = options.bloom;

  Renderer renderer;
  EmulatorDisplay display(style, options.headless);
  if (!display.begin()) {
    std::fprintf(stderr, "display: %s\n", display.error());
    return 1;
  }

  Clock clock(options.speed);
  FrameSource source(options);
  DisplayFrame frame;

  WebView web;
  if (options.webPort > 0 && !web.start(options.webPort)) {
    std::fprintf(stderr, "web view: %s\n", web.error());
  } else if (options.webPort > 0) {
    std::printf("browser view on http://localhost:%d\n", options.webPort);
  }

  // ---------------------------------------------------------------- snapshot
  if (!options.snapshotPath.empty()) {
    clock.freeze(options.snapshotTimeMs);
    if (!source.next(clock.nowMs(), frame)) {
      std::fprintf(stderr, "%s\n", source.error());
      return 1;
    }
    renderer.setFrame(frame, 0);
    renderer.render(clock.nowMs());
    display.show(renderer.canvas());

    std::string error;
    if (!writePng(display.lastImage(), options.snapshotPath, error)) {
      std::fprintf(stderr, "snapshot: %s\n", error.c_str());
      return 1;
    }
    std::printf("wrote %s (%dx%d)\n", options.snapshotPath.c_str(),
                display.lastImage().width, display.lastImage().height);
    return 0;
  }

  // ------------------------------------------------------------------ record
  if (!options.recordPath.empty()) {
    const int fps = options.fps;
    const uint32_t stepMs = static_cast<uint32_t>(1000 / fps);
    const int total = static_cast<int>(options.durationS * fps);
    clock.freeze(0);

    GifWriter gif;
    std::string error;
    bool opened = false;

    for (int i = 0; i < total; ++i) {
      DisplayFrame candidate = frame;
      if (source.next(clock.nowMs(), candidate)) {
        frame = candidate;
        renderer.setFrame(frame, clock.nowMs());
      }
      renderer.render(clock.nowMs());
      display.show(renderer.canvas());

      if (!opened) {
        const Image &image = display.lastImage();
        if (!gif.open(options.recordPath, image.width, image.height,
                      static_cast<uint16_t>(100 / fps), error)) {
          std::fprintf(stderr, "record: %s\n", error.c_str());
          return 1;
        }
        opened = true;
      }
      if (!gif.addFrame(display.lastImage(), error)) {
        std::fprintf(stderr, "record: %s\n", error.c_str());
        return 1;
      }
      clock.advance(stepMs);
    }
    if (!gif.close(error)) {
      std::fprintf(stderr, "record: %s\n", error.c_str());
      return 1;
    }
    std::printf("wrote %s (%d frames at %d fps)\n", options.recordPath.c_str(),
                gif.frameCount(), fps);
    return 0;
  }

  // -------------------------------------------------------------------- live
  const auto framePeriod = std::chrono::milliseconds(1000 / options.fps);
  std::string lastError;

  while (!display.shouldQuit()) {
    const auto tickStart = std::chrono::steady_clock::now();
    const uint32_t now = clock.nowMs();

    DisplayFrame candidate = frame;
    if (source.next(now, candidate)) {
      frame = candidate;
      renderer.setFrame(frame, now);
      display.setBrightness(frame.brightness);
    }
    if (std::strlen(source.error()) != 0 && lastError != source.error()) {
      lastError = source.error();
      std::fprintf(stderr, "%s\n", lastError.c_str());
    }

    renderer.render(now);
    display.setSourceLabel(source.label());
    display.setNote(source.note());
    display.show(renderer.canvas());
    web.broadcast(frame, display.lastImage());

    switch (display.pollInput()) {
    case Button::Top:
      std::puts("[button] top — cancel tracking / cycle info lines");
      break;
    case Button::FrontLeft:
    case Button::FrontRight:
      std::puts("[button] front — hold both for 3 s on hardware to re-enter setup");
      break;
    case Button::Screenshot: {
      std::string error;
      if (writePng(display.lastImage(), "skypanel-screenshot.png", error)) {
        std::puts("wrote skypanel-screenshot.png");
      } else {
        std::fprintf(stderr, "screenshot: %s\n", error.c_str());
      }
      break;
    }
    default:
      break;
    }

    std::this_thread::sleep_until(tickStart + framePeriod);
  }

  web.stop();
  display.end();
  return 0;
}
