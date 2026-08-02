#include "EmulatorDisplay.h"

#include <cstdio>

#ifdef SKYPANEL_WITH_SDL
#include <SDL2/SDL.h>
#endif

namespace skypanel {

EmulatorDisplay::EmulatorDisplay(PanelStyle style, bool headless)
    : painter_(style), headless_(headless) {}

EmulatorDisplay::~EmulatorDisplay() { end(); }

bool EmulatorDisplay::begin() {
  if (headless_) {
    return true;
  }
#ifdef SKYPANEL_WITH_SDL
  if (SDL_Init(SDL_INIT_VIDEO) != 0) {
    error_ = SDL_GetError();
    return false;
  }
  // Nearest-neighbour: the painter has already decided what every screen pixel should
  // be, and letting SDL smooth it would undo the point of simulating the fill factor.
  SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "0");
  return true;
#else
  error_ = "built without SDL2; use --snapshot for headless rendering";
  return false;
#endif
}

void EmulatorDisplay::setBrightness(uint8_t brightness) {
  painter_.style().brightness = brightness;
}

void EmulatorDisplay::end() {
#ifdef SKYPANEL_WITH_SDL
  if (texture_ != nullptr) {
    SDL_DestroyTexture(texture_);
    texture_ = nullptr;
  }
  if (renderer_ != nullptr) {
    SDL_DestroyRenderer(renderer_);
    renderer_ = nullptr;
  }
  if (window_ != nullptr) {
    SDL_DestroyWindow(window_);
    window_ = nullptr;
    SDL_Quit();
  }
#endif
}

void EmulatorDisplay::updateTitle() {
#ifdef SKYPANEL_WITH_SDL
  if (window_ == nullptr) {
    return;
  }
  const uint32_t now = SDL_GetTicks();
  framesSinceTitle_++;
  if (now - lastTitleUpdateMs_ < 500) {
    return;
  }
  fps_ = static_cast<float>(framesSinceTitle_) * 1000.0F /
         static_cast<float>(now - lastTitleUpdateMs_);
  lastTitleUpdateMs_ = now;
  framesSinceTitle_ = 0;

  char title[192];
  std::snprintf(title, sizeof(title), "SkyPanel  %.0f fps  source: %s%s%s", fps_,
                sourceLabel_.c_str(), note_.empty() ? "" : "  |  ", note_.c_str());
  SDL_SetWindowTitle(window_, title);
#endif
}

void EmulatorDisplay::show(const GFXcanvas16 &canvas) {
  painter_.paint(canvas, image_);
  if (headless_) {
    return;
  }
#ifdef SKYPANEL_WITH_SDL
  if (window_ == nullptr) {
    window_ = SDL_CreateWindow("SkyPanel", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
                               image_.width, image_.height, SDL_WINDOW_SHOWN);
    if (window_ == nullptr) {
      error_ = SDL_GetError();
      quit_ = true;
      return;
    }
    renderer_ = SDL_CreateRenderer(window_, -1, SDL_RENDERER_ACCELERATED);
    if (renderer_ == nullptr) {
      renderer_ = SDL_CreateRenderer(window_, -1, SDL_RENDERER_SOFTWARE);
    }
  }
  if (texture_ == nullptr || textureWidth_ != image_.width ||
      textureHeight_ != image_.height) {
    if (texture_ != nullptr) {
      SDL_DestroyTexture(texture_);
    }
    texture_ = SDL_CreateTexture(renderer_, SDL_PIXELFORMAT_ABGR8888,
                                 SDL_TEXTUREACCESS_STREAMING, image_.width, image_.height);
    textureWidth_ = image_.width;
    textureHeight_ = image_.height;
    SDL_SetWindowSize(window_, image_.width, image_.height);
  }

  SDL_UpdateTexture(texture_, nullptr, image_.pixels.data(), image_.width * 4);
  SDL_RenderClear(renderer_);
  SDL_RenderCopy(renderer_, texture_, nullptr, nullptr);
  SDL_RenderPresent(renderer_);
  updateTitle();
#endif
}

Button EmulatorDisplay::pollInput() {
#ifdef SKYPANEL_WITH_SDL
  if (headless_) {
    return Button::None;
  }
  SDL_Event event;
  Button pressed = Button::None;
  while (SDL_PollEvent(&event) != 0) {
    if (event.type == SDL_QUIT) {
      quit_ = true;
      return Button::Quit;
    }
    if (event.type != SDL_KEYDOWN || event.key.repeat != 0) {
      continue;
    }
    switch (event.key.keysym.sym) {
    case SDLK_ESCAPE:
    case SDLK_q:
      quit_ = true;
      return Button::Quit;
    // The MatrixPortal S3's three buttons, in the order they sit on the board.
    case SDLK_SPACE:
    case SDLK_UP:
      pressed = Button::Top;
      break;
    case SDLK_LEFT:
      pressed = Button::FrontLeft;
      break;
    case SDLK_RIGHT:
      pressed = Button::FrontRight;
      break;
    case SDLK_s:
      pressed = Button::Screenshot;
      break;
    case SDLK_b:
      painter_.style().bloom = !painter_.style().bloom;
      break;
    case SDLK_p:
      painter_.style().pitch =
          painter_.style().pitch == Pitch::P4 ? Pitch::P3 : Pitch::P4;
      break;
    case SDLK_LEFTBRACKET:
      painter_.style().brightness =
          static_cast<uint8_t>(painter_.style().brightness > 16
                                   ? painter_.style().brightness - 16
                                   : 1);
      break;
    case SDLK_RIGHTBRACKET:
      painter_.style().brightness =
          static_cast<uint8_t>(painter_.style().brightness < 239
                                   ? painter_.style().brightness + 16
                                   : 255);
      break;
    default:
      break;
    }
  }
  return pressed;
#else
  return Button::None;
#endif
}

} // namespace skypanel
