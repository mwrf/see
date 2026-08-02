#include "Renderer.h"

#include <cstring>

#include "TextEngine.h"

namespace skypanel {
namespace {

/// Corner indicator colours. Deliberately dim: this is a status light, not
/// content, and at full brightness a single red pixel dominates the panel.
constexpr Colour kLiveColour{0x00, 0x50, 0x18};
constexpr Colour kStaleColour{0x60, 0x40, 0x00};
constexpr Colour kOfflineColour{0x70, 0x00, 0x00};

constexpr Colour kProgressTrack{0x18, 0x18, 0x1C};
constexpr Colour kProgressFill{0x30, 0x90, 0xFF};

const Face &faceFor(LineStyle style) {
  return style == LineStyle::Title ? titleFace() : bodyFace();
}

}  // namespace

Renderer::Renderer(int16_t width, int16_t height) : canvas_(width, height) {
  canvas_.fillScreen(0);
}

void Renderer::setFrame(const DisplayFrame &frame) {
  frame_ = frame;
  for (std::size_t i = 0; i < kMaxLines; ++i) {
    const char *text = i < frame_.lineCount ? frame_.lines[i].text : "";
    if (std::strncmp(previousText_[i], text, kMaxTextBytes) != 0) {
      scrollers_[i].reset();
      std::strncpy(previousText_[i], text, kMaxTextBytes - 1);
      previousText_[i][kMaxTextBytes - 1] = '\0';
    }
  }
  layout();
}

void Renderer::layout() {
  const int16_t available =
      static_cast<int16_t>(height() - (frame_.hasProgress ? kProgressReserve : 0));

  int16_t contentHeight = 0;
  for (std::size_t i = 0; i < frame_.lineCount; ++i) {
    const Face &face = faceFor(frame_.lines[i].style);
    contentHeight = static_cast<int16_t>(contentHeight + face.ascent);
    if (i + 1 < frame_.lineCount) {
      contentHeight = static_cast<int16_t>(contentHeight + kLineGap);
    }
  }

  int16_t y = static_cast<int16_t>((available - contentHeight) / 2);
  if (y < 0) {
    y = 0;
  }

  for (std::size_t i = 0; i < frame_.lineCount; ++i) {
    const FrameLine &line = frame_.lines[i];
    const Face &face = faceFor(line.style);
    layouts_[i].title = line.style == LineStyle::Title;
    layouts_[i].baselineY = static_cast<int16_t>(y + face.ascent);
    layouts_[i].textWidth = measureText(face, line.text);
    scrollers_[i].configure(layouts_[i].textWidth, width(),
                            line.scroll == ScrollMode::Auto);
    y = static_cast<int16_t>(y + face.ascent + kLineGap);
  }
}

void Renderer::tick(uint32_t nowMs) {
  if (!haveTick_) {
    lastTickMs_ = nowMs;
    haveTick_ = true;
    return;
  }
  //  Unsigned subtraction handles the 49-day millis() wrap correctly.
  const uint32_t delta = nowMs - lastTickMs_;
  lastTickMs_ = nowMs;
  for (std::size_t i = 0; i < frame_.lineCount; ++i) {
    scrollers_[i].advance(delta);
  }
}

bool Renderer::animating() const {
  for (std::size_t i = 0; i < frame_.lineCount; ++i) {
    if (scrollers_[i].scrolling()) {
      return true;
    }
  }
  return false;
}

void Renderer::render() {
  canvas_.fillScreen(0);
  for (std::size_t i = 0; i < frame_.lineCount; ++i) {
    drawLine(i);
  }
  if (frame_.hasProgress) {
    drawProgressBar();
  }
  drawStatusIndicator();
}

void Renderer::drawLine(std::size_t index) {
  const FrameLine &line = frame_.lines[index];
  const LineLayout &layout = layouts_[index];
  const Face &face = faceFor(line.style);
  const uint16_t colour = toRgb565(line.colour);
  const Scroller &scroller = scrollers_[index];

  if (!scroller.scrolling()) {
    //  Short lines are centred. Centring is worth the arithmetic: a
    //  left-aligned two-character altitude on a 64 px panel looks broken.
    const int16_t x = static_cast<int16_t>((width() - layout.textWidth) / 2);
    drawText(canvas_, face, line.text, x < 0 ? 0 : x, layout.baselineY, colour);
    return;
  }

  const int16_t offset = scroller.offset();
  drawText(canvas_, face, line.text, static_cast<int16_t>(-offset),
           layout.baselineY, colour);
  //  Second copy one cycle to the right, so the wrap has no visible seam.
  drawText(canvas_, face, line.text,
           static_cast<int16_t>(scroller.cycleWidth() - offset), layout.baselineY,
           colour);
}

void Renderer::drawStatusIndicator() {
  Colour colour;
  switch (frame_.status) {
    case FrameStatus::Live:
      colour = kLiveColour;
      break;
    case FrameStatus::Stale:
      colour = kStaleColour;
      break;
    case FrameStatus::Offline:
      colour = kOfflineColour;
      break;
  }

  const uint16_t packed = toRgb565(colour);
  //  A live panel gets a single pixel; anything worse gets a 2x2 block, so
  //  "something is wrong" is legible from across the room while "everything is
  //  fine" stays out of the way.
  if (frame_.status == FrameStatus::Live) {
    canvas_.drawPixel(static_cast<int16_t>(width() - 1), 0, packed);
    return;
  }
  canvas_.fillRect(static_cast<int16_t>(width() - 2), 0, 2, 2, packed);
}

void Renderer::drawProgressBar() {
  const int16_t barY = static_cast<int16_t>(height() - 3);
  const int16_t barWidth = static_cast<int16_t>(width() - 2);

  canvas_.drawFastHLine(1, barY, barWidth, toRgb565(kProgressTrack));

  float fraction = frame_.progress.fraction;
  if (fraction < 0.0F) fraction = 0.0F;
  if (fraction > 1.0F) fraction = 1.0F;

  int16_t filled = static_cast<int16_t>(fraction * static_cast<float>(barWidth) + 0.5F);
  //  Always show at least one lit pixel once tracking is under way, so the bar
  //  reads as "just departed" rather than "not working".
  if (filled <= 0 && fraction > 0.0F) {
    filled = 1;
  }
  if (filled > 0) {
    canvas_.drawFastHLine(1, barY, filled, toRgb565(kProgressFill));
  }
}

}  // namespace skypanel
