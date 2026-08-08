#include "EmulatorDisplay.h"

#include <cstdio>

#ifdef SKYPANEL_HAVE_SDL
#include <SDL2/SDL.h>
#endif

namespace skypanel {

#ifdef SKYPANEL_HAVE_SDL

struct EmulatorDisplay::Sdl {
  SDL_Window *window = nullptr;
  SDL_Renderer *renderer = nullptr;
  SDL_Texture *texture = nullptr;
  int textureWidth = 0;
  int textureHeight = 0;
};

bool EmulatorDisplay::hasWindow() { return true; }

#else

struct EmulatorDisplay::Sdl {};

bool EmulatorDisplay::hasWindow() { return false; }

#endif

EmulatorDisplay::EmulatorDisplay(PanelStyle style, bool headless)
    : style_(style), headless_(headless) {}

EmulatorDisplay::~EmulatorDisplay() {
#ifdef SKYPANEL_HAVE_SDL
  if (sdl_ != nullptr) {
    if (sdl_->texture != nullptr) SDL_DestroyTexture(sdl_->texture);
    if (sdl_->renderer != nullptr) SDL_DestroyRenderer(sdl_->renderer);
    if (sdl_->window != nullptr) SDL_DestroyWindow(sdl_->window);
    SDL_Quit();
  }
#endif
  delete sdl_;
}

bool EmulatorDisplay::begin() {
  if (headless_) {
    return true;
  }
#ifdef SKYPANEL_HAVE_SDL
  if (SDL_Init(SDL_INIT_VIDEO) != 0) {
    std::fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
    return false;
  }
  sdl_ = new Sdl();
  //  The window is sized on the first frame, once the panel geometry and
  //  scale are both known.
  sdl_->window = SDL_CreateWindow("SkyPanel", SDL_WINDOWPOS_CENTERED,
                                  SDL_WINDOWPOS_CENTERED, 640, 320,
                                  SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE);
  if (sdl_->window == nullptr) {
    std::fprintf(stderr, "SDL_CreateWindow failed: %s\n", SDL_GetError());
    return false;
  }
  sdl_->renderer = SDL_CreateRenderer(sdl_->window, -1, SDL_RENDERER_ACCELERATED);
  if (sdl_->renderer == nullptr) {
    sdl_->renderer = SDL_CreateRenderer(sdl_->window, -1, SDL_RENDERER_SOFTWARE);
  }
  if (sdl_->renderer == nullptr) {
    std::fprintf(stderr, "SDL_CreateRenderer failed: %s\n", SDL_GetError());
    return false;
  }
  return true;
#else
  std::fprintf(stderr,
               "this build has no SDL2; use --snapshot or --record for headless "
               "output, or rebuild with SDL2 installed\n");
  return false;
#endif
}

void EmulatorDisplay::show(const GFXcanvas16 &canvas) {
  lastImage_ = renderPanel(canvas, style_);
  if (headless_) {
    return;
  }

#ifdef SKYPANEL_HAVE_SDL
  if (sdl_ == nullptr || sdl_->renderer == nullptr) {
    return;
  }
  if (sdl_->texture == nullptr || sdl_->textureWidth != lastImage_.width ||
      sdl_->textureHeight != lastImage_.height) {
    if (sdl_->texture != nullptr) {
      SDL_DestroyTexture(sdl_->texture);
    }
    sdl_->texture = SDL_CreateTexture(sdl_->renderer, SDL_PIXELFORMAT_RGB24,
                                      SDL_TEXTUREACCESS_STREAMING,
                                      lastImage_.width, lastImage_.height);
    sdl_->textureWidth = lastImage_.width;
    sdl_->textureHeight = lastImage_.height;
    SDL_SetWindowSize(sdl_->window, lastImage_.width, lastImage_.height);
  }

  SDL_UpdateTexture(sdl_->texture, nullptr, lastImage_.rgb.data(),
                    lastImage_.width * 3);
  SDL_RenderClear(sdl_->renderer);
  SDL_RenderCopy(sdl_->renderer, sdl_->texture, nullptr, nullptr);
  SDL_RenderPresent(sdl_->renderer);

  ++framesSinceTitle_;
  const uint32_t now = SDL_GetTicks();
  if (now - lastTitleMs_ >= 500) {
    fps_ = static_cast<float>(framesSinceTitle_) * 1000.0F /
           static_cast<float>(now - lastTitleMs_);
    framesSinceTitle_ = 0;
    lastTitleMs_ = now;
    updateTitle();
  }
#endif
}

void EmulatorDisplay::updateTitle() {
#ifdef SKYPANEL_HAVE_SDL
  if (sdl_ == nullptr || sdl_->window == nullptr) {
    return;
  }
  char title[128];
  std::snprintf(title, sizeof(title), "SkyPanel  |  %.0f fps  |  source: %s  |  %s",
                static_cast<double>(fps_), sourceLabel_.c_str(),
                style_.pitch == Pitch::P3 ? "P3" : "P4");
  SDL_SetWindowTitle(sdl_->window, title);
#endif
}

void EmulatorDisplay::setBrightness(uint8_t brightness) {
  style_.brightness = brightness;
}

void EmulatorDisplay::clear() {
  lastImage_ = Image();
#ifdef SKYPANEL_HAVE_SDL
  if (sdl_ != nullptr && sdl_->renderer != nullptr) {
    SDL_SetRenderDrawColor(sdl_->renderer, 0, 0, 0, 255);
    SDL_RenderClear(sdl_->renderer);
    SDL_RenderPresent(sdl_->renderer);
  }
#endif
}

int EmulatorDisplay::pollKey() {
#ifdef SKYPANEL_HAVE_SDL
  if (sdl_ == nullptr) {
    return 0;
  }
  SDL_Event event;
  int key = 0;
  while (SDL_PollEvent(&event) != 0) {
    if (event.type == SDL_QUIT) {
      running_ = false;
    } else if (event.type == SDL_KEYDOWN) {
      const SDL_Keycode code = event.key.keysym.sym;
      if (code == SDLK_ESCAPE || code == SDLK_q) {
        running_ = false;
      }
      key = static_cast<int>(code);
    }
  }
  return key;
#else
  return 0;
#endif
}

}  // namespace skypanel
