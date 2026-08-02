// skypanel-emu -- the simulated panel.
//
// This is the primary development target. It runs the firmware's PanelApp,
// its Renderer, its fonts and its scroller, compiled natively, and puts a
// simulated LED matrix in front of them. Nothing about the picture is
// approximated except the photons.
//
//   skypanel-emu --backend http://localhost:8000   # live
//   skypanel-emu --frame fixtures/ryanair.json     # one static frame
//   skypanel-emu --scenario fixtures/busy.jsonl --speed 4
//   skypanel-emu --snapshot out.png --frame X.json # headless, for tests
//   skypanel-emu --record out.gif --duration 30

#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>

#include "Buttons.h"
#include "EmulatorDisplay.h"
#include "FileHttpClient.h"
#include "Gif.h"
#include "PanelApp.h"
#include "PanelSim.h"
#include "Png.h"
#include "SocketHttpClient.h"
#include "WebSocketServer.h"

namespace {

using skypanel::ButtonEvent;
using skypanel::EmulatorDisplay;
using skypanel::FileHttpClient;
using skypanel::GifWriter;
using skypanel::PanelApp;
using skypanel::PanelAppConfig;
using skypanel::PanelStyle;
using skypanel::Pitch;
using skypanel::SocketHttpClient;
using skypanel::WebSocketServer;

struct Options {
  std::string backend;
  std::string framePath;
  std::string scenarioPath;
  std::string snapshotPath;
  std::string recordPath;

  float speed = 1.0F;
  /// Virtual milliseconds to advance before taking a snapshot -- how the
  /// golden tests capture a scrolling line mid-cycle.
  uint32_t snapshotAtMs = 0;
  float durationS = 10.0F;
  int fps = 30;
  uint32_t pollIntervalMs = 5000;

  PanelStyle style;
  int webPort = 0;
  bool headless = false;
  bool help = false;
};

void usage() {
  std::printf(
      "skypanel-emu -- SkyPanel's simulated LED panel\n"
      "\n"
      "Frame source (choose one):\n"
      "  --backend URL        poll a running backend (default "
      "http://localhost:8000)\n"
      "  --frame FILE         render one frame document, forever\n"
      "  --scenario FILE      render a JSON-Lines scenario, one frame per poll\n"
      "\n"
      "Output:\n"
      "  --snapshot FILE.png  render one frame headless and exit\n"
      "  --record FILE.gif    record an animation and exit\n"
      "  --web PORT           also serve a browser view on PORT\n"
      "  --headless           run without opening a window\n"
      "\n"
      "Timing:\n"
      "  --speed N            run the clock N times faster (default 1)\n"
      "  --at MS              virtual time to snapshot at (default 0)\n"
      "  --duration S         seconds to record (default 10)\n"
      "  --fps N              redraw rate (default 30)\n"
      "  --poll MS            backend poll interval (default 5000)\n"
      "\n"
      "Panel simulation:\n"
      "  --scale N            screen pixels per LED (default 10)\n"
      "  --pitch p3|p4        dot size relative to the gap (default p4)\n"
      "  --brightness 0-255   dims exactly as the HUB75 driver does\n"
      "  --gamma G            default 2.2, matching the driver\n"
      "  --bloom              LED glow; off by default so snapshots are exact\n"
      "  --no-dots            draw flat pixels instead of round LEDs\n"
      "\n"
      "Keys: space = top button, s = setup hold, [ / ] brightness, p = pitch,\n"
      "      b = bloom, q / Esc = quit\n");
}

bool parseArgs(int argc, char **argv, Options &options) {
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    const auto next = [&](const char *name) -> const char * {
      if (i + 1 >= argc) {
        std::fprintf(stderr, "%s needs a value\n", name);
        return nullptr;
      }
      return argv[++i];
    };

    if (arg == "-h" || arg == "--help") {
      options.help = true;
      return true;
    } else if (arg == "--backend") {
      const char *value = next("--backend");
      if (value == nullptr) return false;
      options.backend = value;
    } else if (arg == "--frame") {
      const char *value = next("--frame");
      if (value == nullptr) return false;
      options.framePath = value;
    } else if (arg == "--scenario") {
      const char *value = next("--scenario");
      if (value == nullptr) return false;
      options.scenarioPath = value;
    } else if (arg == "--snapshot") {
      const char *value = next("--snapshot");
      if (value == nullptr) return false;
      options.snapshotPath = value;
      options.headless = true;
    } else if (arg == "--record") {
      const char *value = next("--record");
      if (value == nullptr) return false;
      options.recordPath = value;
      options.headless = true;
    } else if (arg == "--speed") {
      const char *value = next("--speed");
      if (value == nullptr) return false;
      options.speed = std::strtof(value, nullptr);
    } else if (arg == "--at") {
      const char *value = next("--at");
      if (value == nullptr) return false;
      options.snapshotAtMs = static_cast<uint32_t>(std::strtoul(value, nullptr, 10));
    } else if (arg == "--duration") {
      const char *value = next("--duration");
      if (value == nullptr) return false;
      options.durationS = std::strtof(value, nullptr);
    } else if (arg == "--fps") {
      const char *value = next("--fps");
      if (value == nullptr) return false;
      options.fps = std::atoi(value);
    } else if (arg == "--poll") {
      const char *value = next("--poll");
      if (value == nullptr) return false;
      options.pollIntervalMs = static_cast<uint32_t>(std::strtoul(value, nullptr, 10));
    } else if (arg == "--scale") {
      const char *value = next("--scale");
      if (value == nullptr) return false;
      options.style.scale = std::atoi(value);
    } else if (arg == "--pitch") {
      const char *value = next("--pitch");
      if (value == nullptr) return false;
      options.style.pitch = std::strcmp(value, "p3") == 0 ? Pitch::P3 : Pitch::P4;
    } else if (arg == "--brightness") {
      const char *value = next("--brightness");
      if (value == nullptr) return false;
      options.style.brightness = static_cast<uint8_t>(std::atoi(value));
    } else if (arg == "--gamma") {
      const char *value = next("--gamma");
      if (value == nullptr) return false;
      options.style.gamma = std::strtof(value, nullptr);
    } else if (arg == "--bloom") {
      options.style.bloom = true;
    } else if (arg == "--no-dots") {
      options.style.roundedDots = false;
    } else if (arg == "--headless") {
      options.headless = true;
    } else if (arg == "--web") {
      const char *value = next("--web");
      if (value == nullptr) return false;
      options.webPort = std::atoi(value);
    } else {
      std::fprintf(stderr, "unknown option: %s\n", arg.c_str());
      return false;
    }
  }

  if (options.speed <= 0.0F) {
    std::fprintf(stderr, "--speed must be positive\n");
    return false;
  }
  if (options.fps <= 0) {
    std::fprintf(stderr, "--fps must be positive\n");
    return false;
  }
  if (options.backend.empty() && options.framePath.empty() &&
      options.scenarioPath.empty()) {
    options.backend = "http://localhost:8000";
  }
  return true;
}

ButtonEvent keyToButton(int key) {
  switch (key) {
    case ' ':
      return ButtonEvent::TopShort;
    case 's':
      return ButtonEvent::SetupHold;
    case '\r':
    case '\n':
      return ButtonEvent::TopLong;
    default:
      return ButtonEvent::None;
  }
}

uint32_t nowMillis() {
  using namespace std::chrono;
  static const auto start = steady_clock::now();
  return static_cast<uint32_t>(
      duration_cast<milliseconds>(steady_clock::now() - start).count());
}

int runSnapshot(const Options &options, PanelApp &app, EmulatorDisplay &display) {
  //  A snapshot is deterministic by construction: the app is ticked to exactly
  //  the requested virtual time, never to a wall clock.
  app.tick(0);
  if (options.snapshotAtMs > 0) {
    //  Step in frame-sized increments so the scroller sees the same sequence
    //  of deltas it would during a live run.
    const uint32_t step = 1000U / static_cast<uint32_t>(options.fps);
    for (uint32_t t = step; t <= options.snapshotAtMs; t += step) {
      app.tick(t);
    }
  }

  std::string error;
  if (!skypanel::writePng(options.snapshotPath, display.lastImage(), error)) {
    std::fprintf(stderr, "snapshot failed: %s\n", error.c_str());
    return 1;
  }
  std::printf("wrote %s (%dx%d)\n", options.snapshotPath.c_str(),
              display.lastImage().width, display.lastImage().height);
  return 0;
}

int runRecording(const Options &options, PanelApp &app, EmulatorDisplay &display) {
  GifWriter gif;
  std::string error;
  const int delayCs = 100 / options.fps > 0 ? 100 / options.fps : 1;

  const uint32_t step = 1000U / static_cast<uint32_t>(options.fps);
  const uint32_t total = static_cast<uint32_t>(options.durationS * 1000.0F);
  bool started = false;

  display.setFrameHook([&](const skypanel::Image &image) {
    if (!started) {
      if (!gif.begin(options.recordPath, image.width, image.height, delayCs, error)) {
        std::fprintf(stderr, "recording failed: %s\n", error.c_str());
        return;
      }
      started = true;
    }
    if (!gif.addFrame(image, error)) {
      std::fprintf(stderr, "recording failed: %s\n", error.c_str());
    }
  });

  for (uint32_t t = 0; t <= total; t += step) {
    app.tick(t);
  }
  display.setFrameHook(nullptr);

  if (!gif.finish(error)) {
    std::fprintf(stderr, "recording failed: %s\n", error.c_str());
    return 1;
  }
  std::printf("wrote %s (%d frames, %.1fs)\n", options.recordPath.c_str(),
              gif.frameCount(), static_cast<double>(options.durationS));
  return 0;
}

int runInteractive(const Options &options, PanelApp &app, EmulatorDisplay &display,
                   FileHttpClient *fileClient, WebSocketServer *web) {
  const uint32_t frameIntervalMs = 1000U / static_cast<uint32_t>(options.fps);
  uint32_t virtualMs = 0;
  uint32_t lastRealMs = nowMillis();

  while (display.running()) {
    const uint32_t realMs = nowMillis();
    const uint32_t elapsed = realMs - lastRealMs;
    lastRealMs = realMs;
    virtualMs += static_cast<uint32_t>(static_cast<float>(elapsed) * options.speed);

    if (fileClient != nullptr) {
      fileClient->setTime(virtualMs);
    }
    app.tick(virtualMs);
    display.setSourceLabel(app.sourceLabel());

    if (web != nullptr) {
      web->poll();
      web->broadcast(display.lastImage());
    }

    const int key = display.pollKey();
    if (key != 0) {
      const ButtonEvent event = keyToButton(key);
      if (event != ButtonEvent::None) {
        app.onButton(event, virtualMs);
      } else if (key == '[') {
        const int level = display.style().brightness > 16
                              ? display.style().brightness - 16
                              : 0;
        display.setBrightness(static_cast<uint8_t>(level));
      } else if (key == ']') {
        const int level = display.style().brightness < 239
                              ? display.style().brightness + 16
                              : 255;
        display.setBrightness(static_cast<uint8_t>(level));
      } else if (key == 'p') {
        display.style().pitch =
            display.style().pitch == Pitch::P3 ? Pitch::P4 : Pitch::P3;
      } else if (key == 'b') {
        display.style().bloom = !display.style().bloom;
      }
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(frameIntervalMs));
  }
  return 0;
}

}  // namespace

int main(int argc, char **argv) {
  Options options;
  if (!parseArgs(argc, argv, options)) {
    return 2;
  }
  if (options.help) {
    usage();
    return 0;
  }

  if (!options.headless && !EmulatorDisplay::hasWindow()) {
    std::fprintf(stderr,
                 "this build has no SDL2 support; use --snapshot or --record, or "
                 "rebuild with SDL2 installed\n");
    return 3;
  }

  EmulatorDisplay display(options.style, options.headless);

  FileHttpClient fileClient;
  SocketHttpClient socketClient;
  skypanel::IHttpClient *http = &socketClient;
  std::string error;

  if (!options.framePath.empty()) {
    if (!fileClient.loadFrame(options.framePath, error)) {
      std::fprintf(stderr, "%s\n", error.c_str());
      return 1;
    }
    http = &fileClient;
  } else if (!options.scenarioPath.empty()) {
    if (!fileClient.loadScenario(options.scenarioPath, error)) {
      std::fprintf(stderr, "%s\n", error.c_str());
      return 1;
    }
    fileClient.setStepMs(options.pollIntervalMs);
    http = &fileClient;
    std::printf("scenario: %zu frames\n", fileClient.frameCount());
  }

  PanelAppConfig config;
  std::snprintf(config.baseUrl, sizeof(config.baseUrl), "%s",
                options.backend.empty() ? "http://localhost:8000"
                                        : options.backend.c_str());
  config.pollIntervalMs = options.pollIntervalMs;
  config.frameIntervalMs = 1000U / static_cast<uint32_t>(options.fps);
  config.brightness = options.style.brightness;

  PanelApp app(*http, display, config);
  if (!app.begin()) {
    return 3;
  }

  if (!options.snapshotPath.empty()) {
    return runSnapshot(options, app, display);
  }
  if (!options.recordPath.empty()) {
    return runRecording(options, app, display);
  }

  WebSocketServer web;
  WebSocketServer *webPtr = nullptr;
  if (options.webPort > 0) {
    if (!web.start(options.webPort, error)) {
      std::fprintf(stderr, "%s\n", error.c_str());
      return 1;
    }
    webPtr = &web;
    std::printf("browser view: http://localhost:%d/\n", options.webPort);
  }

  return runInteractive(options, app, display,
                        http == &fileClient ? &fileClient : nullptr, webPtr);
}
