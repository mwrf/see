#include "Renderer.h"

#include <cstring>

#include "FrameParser.h"
#include "Text.h"

namespace skypanel {
namespace {

constexpr int16_t kStatusDotSize = 2;
constexpr int16_t kBarHeight = 2;
constexpr int16_t kBarReserve = 4;    ///< bar plus a blank row above it
constexpr int16_t kEtaReserve = 11;   ///< bar reserve plus a 5px ETA row and a gap
constexpr int16_t kMinGap = 1;

constexpr uint32_t kStatusLive = 0x00C000;
constexpr uint32_t kStatusStale = 0xC08000;
constexpr uint32_t kStatusOffline = 0xC00000;
constexpr uint32_t kBarTrack = 0x202020;
constexpr uint32_t kBarFill = 0x40A0FF;
constexpr uint32_t kEtaColour = 0x808080;

int16_t heightOf(LineStyle style) {
  return static_cast<int16_t>(Renderer::fontFor(style).height);
}

} // namespace

const BitmapFont &Renderer::fontFor(LineStyle style) {
  return style == LineStyle::Title ? FontMid : FontTiny;
}

Renderer::Renderer(int16_t width, int16_t height) : canvas_(width, height) {
  canvas_.fillScreen(0);
}

Layout Renderer::computeLayout(const DisplayFrame &frame, int16_t width, int16_t height) {
  Layout layout;
  layout.lineCount = frame.lineCount;

  int16_t reserved = 0;
  if (frame.hasProgress) {
    layout.hasBar = true;
    layout.hasEta = frame.eta[0] != '\0';
    reserved = layout.hasEta ? kEtaReserve : kBarReserve;
    layout.barY = static_cast<int16_t>(height - kBarHeight);
    layout.etaY = static_cast<int16_t>(height - kEtaReserve + 1);
  }

  const int16_t available = static_cast<int16_t>(height - reserved);

  int16_t textHeight = 0;
  for (uint8_t i = 0; i < frame.lineCount; ++i) {
    textHeight = static_cast<int16_t>(textHeight + heightOf(frame.lines[i].style));
  }

  // Distribute the slack as equal gaps above, between and below the lines. Centring the
  // block as a whole looks unbalanced when a 7px title sits over two 5px body lines.
  const int16_t slack = static_cast<int16_t>(available - textHeight);
  const int16_t slots = static_cast<int16_t>(frame.lineCount + 1);
  int16_t gap = slots > 0 ? static_cast<int16_t>(slack / slots) : 0;
  if (gap < kMinGap) {
    gap = kMinGap;
  }
  // Spread the leftover pixels across the topmost gaps rather than dumping them all
  // below the last line, which otherwise leaves the panel visibly bottom-heavy.
  int16_t remainder = static_cast<int16_t>(slack - gap * slots);
  if (remainder < 0) {
    remainder = 0;
  }

  int16_t y = static_cast<int16_t>(gap + (remainder > 0 ? 1 : 0));
  if (remainder > 0) {
    --remainder;
  }
  for (uint8_t i = 0; i < frame.lineCount; ++i) {
    layout.lineY[i] = y;
    // The status dot lives in the top-right corner; the first line yields those pixels
    // so a long airline name never scrolls underneath it.
    layout.lineViewport[i] =
        (i == 0) ? static_cast<int16_t>(width - kStatusDotSize - 1) : width;
    const int16_t extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) {
      --remainder;
    }
    y = static_cast<int16_t>(y + heightOf(frame.lines[i].style) + gap + extra);
  }
  return layout;
}

void Renderer::setFrame(const DisplayFrame &frame, uint32_t nowMs) {
  frame_ = frame;
  layout_ = computeLayout(frame_, canvas_.width(), canvas_.height());
  epochMs_ = nowMs;
}

bool Renderer::isAnimating() const {
  for (uint8_t i = 0; i < frame_.lineCount; ++i) {
    const FrameLine &line = frame_.lines[i];
    if (line.scroll != ScrollMode::Auto) {
      continue;
    }
    const int16_t w = text::width(fontFor(line.style), line.text.c_str());
    if (Scroller::overflows(w, layout_.lineViewport[i])) {
      return true;
    }
  }
  return false;
}

void Renderer::drawStatusDot() {
  uint32_t colour = kStatusOffline;
  switch (frame_.status) {
  case FrameStatus::Live:
    colour = kStatusLive;
    break;
  case FrameStatus::Stale:
    colour = kStatusStale;
    break;
  case FrameStatus::Offline:
    colour = kStatusOffline;
    break;
  }
  canvas_.fillRect(static_cast<int16_t>(canvas_.width() - kStatusDotSize), 0,
                   kStatusDotSize, kStatusDotSize, rgb565(colour));
}

void Renderer::drawProgress() {
  if (!layout_.hasBar) {
    return;
  }
  const int16_t width = canvas_.width();
  canvas_.fillRect(0, layout_.barY, width, kBarHeight, rgb565(kBarTrack));

  int16_t filled = static_cast<int16_t>(frame_.progressFraction * static_cast<float>(width));
  if (filled < 0) {
    filled = 0;
  }
  if (filled > width) {
    filled = width;
  }
  // A flight that has just departed should still show something, otherwise the bar
  // reads as "no data" rather than "0%".
  if (filled == 0 && frame_.progressFraction > 0.0F) {
    filled = 1;
  }
  if (filled > 0) {
    canvas_.fillRect(0, layout_.barY, filled, kBarHeight, rgb565(kBarFill));
  }

  if (layout_.hasEta) {
    TextBuffer eta;
    text::decode(frame_.eta, eta);
    const int16_t w = text::width(FontTiny, eta.c_str());
    text::draw(canvas_, FontTiny, static_cast<int16_t>(width - w), layout_.etaY,
               eta.c_str(), rgb565(kEtaColour));
  }
}

void Renderer::render(uint32_t nowMs) {
  canvas_.fillScreen(0);

  const uint32_t elapsed = nowMs >= epochMs_ ? nowMs - epochMs_ : 0;

  for (uint8_t i = 0; i < frame_.lineCount; ++i) {
    const FrameLine &line = frame_.lines[i];
    const BitmapFont &font = fontFor(line.style);
    const int16_t viewport = layout_.lineViewport[i];
    const int16_t textWidth = text::width(font, line.text.c_str());

    int16_t x = 0;
    if (line.scroll == ScrollMode::Auto) {
      x = static_cast<int16_t>(-scroller_.offset(textWidth, viewport, elapsed));
    }
    text::drawClipped(canvas_, font, x, layout_.lineY[i], line.text.c_str(),
                      rgb565(line.colour), 0, viewport);
  }

  drawProgress();
  drawStatusDot();
}

} // namespace skypanel
