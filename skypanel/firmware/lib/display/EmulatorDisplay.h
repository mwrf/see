// The desktop `IDisplay`: an SDL2 window that pretends to be a HUB75 panel.
//
// Also runs headless, which is how the snapshot tests work — same `PanelPainter`, same
// pixels, no window server required.

#pragma once

#include <cstdint>
#include <string>

#include "IDisplay.h"
#include "PanelPainter.h"

struct SDL_Window;
struct SDL_Renderer;
struct SDL_Texture;

namespace skypanel {

/// Physical buttons, mapped to the keyboard in the emulator.
enum class Button : uint8_t { None, Top, FrontLeft, FrontRight, Quit, Screenshot };

class EmulatorDisplay : public IDisplay {
public:
  EmulatorDisplay(PanelStyle style = {}, bool headless = false);
  ~EmulatorDisplay() override;

  EmulatorDisplay(const EmulatorDisplay &) = delete;
  EmulatorDisplay &operator=(const EmulatorDisplay &) = delete;

  bool begin() override;
  void setBrightness(uint8_t brightness) override;
  void show(const GFXcanvas16 &canvas) override;
  bool shouldQuit() const override { return quit_; }
  void end() override;

  /// Drain the event queue; returns the button the user pressed this tick, if any.
  Button pollInput();

  /// Shown in the window title alongside the frame rate.
  void setSourceLabel(const std::string &label) { sourceLabel_ = label; }
  void setNote(const std::string &note) { note_ = note; }

  PanelPainter &painter() { return painter_; }
  const Image &lastImage() const { return image_; }
  const char *error() const { return error_.c_str(); }

private:
  PanelPainter painter_;
  Image image_;
  bool headless_;
  bool quit_ = false;
  std::string sourceLabel_ = "none";
  std::string note_;
  std::string error_;

  SDL_Window *window_ = nullptr;
  SDL_Renderer *renderer_ = nullptr;
  SDL_Texture *texture_ = nullptr;
  int textureWidth_ = 0;
  int textureHeight_ = 0;

  uint32_t lastTitleUpdateMs_ = 0;
  uint32_t framesSinceTitle_ = 0;
  float fps_ = 0.0F;

  void updateTitle();
};

} // namespace skypanel
