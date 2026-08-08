// An IDisplay that draws to an SDL2 window -- or to nothing at all.
//
// The headless path is not a lesser mode: it is what --snapshot and the golden
// tests use, and it runs the identical PanelSim code the window does. SDL is
// therefore an optional link-time dependency (SKYPANEL_HAVE_SDL), so the
// snapshot suite builds and runs on a machine with no display libraries.
#pragma once

#include <string>

#include "IDisplay.h"
#include "PanelSim.h"

namespace skypanel {

class EmulatorDisplay : public IDisplay {
 public:
  explicit EmulatorDisplay(PanelStyle style = {}, bool headless = false);
  ~EmulatorDisplay() override;

  bool begin() override;
  void show(const GFXcanvas16 &canvas) override;
  void setBrightness(uint8_t brightness) override;
  void clear() override;
  bool running() const override { return running_; }

  /// True when SDL2 was compiled in. False means only headless mode works.
  static bool hasWindow();

  /// Shown in the window title, alongside the FPS counter.
  void setSourceLabel(const std::string &label) { sourceLabel_ = label; }

  /// The most recent simulated frame. Both --snapshot and --record read it
  /// after ticking the app, which also covers the ticks where the app decided
  /// nothing needed redrawing.
  const Image &lastImage() const { return lastImage_; }

  PanelStyle &style() { return style_; }
  const PanelStyle &style() const { return style_; }

  /// Poll the window's event queue. Returns the key pressed this call, or 0.
  /// Keyboard input is mapped onto the physical buttons by the caller.
  int pollKey();

  float fps() const { return fps_; }

 private:
  void updateTitle();

  PanelStyle style_;
  bool headless_ = false;
  bool running_ = true;
  Image lastImage_;
  std::string sourceLabel_ = "?";
  float fps_ = 0.0F;
  int framesSinceTitle_ = 0;
  uint32_t lastTitleMs_ = 0;

  struct Sdl;
  Sdl *sdl_ = nullptr;
};

}  // namespace skypanel
