#include "PanelPainter.h"

#include <algorithm>
#include <cmath>

namespace skypanel {
namespace {

uint8_t clamp8(float v) {
  if (v <= 0.0F) {
    return 0;
  }
  if (v >= 255.0F) {
    return 255;
  }
  return static_cast<uint8_t>(v + 0.5F);
}

/// RGB565 → 8-bit per channel, replicating the high bits into the low ones. This is what
/// the HUB75 library does, and it matters: 0x1F becomes 0xFF, not 0xF8.
void expand565(uint16_t value, uint8_t &r, uint8_t &g, uint8_t &b) {
  const uint8_t r5 = static_cast<uint8_t>((value >> 11) & 0x1F);
  const uint8_t g6 = static_cast<uint8_t>((value >> 5) & 0x3F);
  const uint8_t b5 = static_cast<uint8_t>(value & 0x1F);
  r = static_cast<uint8_t>((r5 << 3) | (r5 >> 2));
  g = static_cast<uint8_t>((g6 << 2) | (g6 >> 4));
  b = static_cast<uint8_t>((b5 << 3) | (b5 >> 2));
}

} // namespace

void PanelPainter::emittedColour(uint16_t value, uint8_t &r, uint8_t &g, uint8_t &b) const {
  expand565(value, r, g, b);

  const float scale = static_cast<float>(style_.brightness) / 255.0F;
  const float inverseGamma = style_.gamma > 0.0F ? style_.gamma : 1.0F;

  auto channel = [&](uint8_t raw) {
    const float linear = std::pow(static_cast<float>(raw) / 255.0F, inverseGamma) * scale;
    // Back out of linear light for display on an sRGB-ish screen, so what the viewer
    // sees approximates what the eye sees off the panel.
    return clamp8(std::pow(linear, 1.0F / 2.2F) * 255.0F);
  };

  r = channel(r);
  g = channel(g);
  b = channel(b);
}

void PanelPainter::drawCell(Image &out, int cellX, int cellY, uint8_t r, uint8_t g,
                            uint8_t b) const {
  const int scale = style_.scale;
  const float radius = (static_cast<float>(scale) * style_.fillFactor()) / 2.0F;
  const float centre = static_cast<float>(scale) / 2.0F;
  const int originX = cellX * scale;
  const int originY = cellY * scale;

  for (int dy = 0; dy < scale; ++dy) {
    for (int dx = 0; dx < scale; ++dx) {
      const float px = static_cast<float>(dx) + 0.5F - centre;
      const float py = static_cast<float>(dy) + 0.5F - centre;
      const float distance = std::sqrt(px * px + py * py);

      // One pixel of feathering at the rim: a hard circle at scale 6 aliases into a
      // lumpy octagon and makes type look worse than it is.
      float coverage = radius + 0.5F - distance;
      coverage = std::clamp(coverage, 0.0F, 1.0F);
      if (coverage <= 0.0F) {
        continue;
      }

      const size_t i = out.index(originX + dx, originY + dy);
      auto blend = [&](size_t offset, uint8_t value) {
        const float existing = static_cast<float>(out.pixels[i + offset]);
        out.pixels[i + offset] =
            clamp8(existing + (static_cast<float>(value) - existing) * coverage);
      };
      blend(0, r);
      blend(1, g);
      blend(2, b);
    }
  }
}

void PanelPainter::applyBloom(Image &out) const {
  if (!style_.bloom || style_.bloomStrength <= 0.0F) {
    return;
  }
  // A cheap separable box blur added back over the original. Not physically motivated,
  // but it reproduces the halo a phone camera sees and makes screenshots look like
  // photographs of the panel rather than diagrams of it.
  const int radius = std::max(1, style_.scale / 2);
  std::vector<uint8_t> blurred(out.pixels.size(), 0);

  auto blurAxis = [&](const std::vector<uint8_t> &src, std::vector<uint8_t> &dst,
                      bool horizontal) {
    for (int y = 0; y < out.height; ++y) {
      for (int x = 0; x < out.width; ++x) {
        int sum[3] = {0, 0, 0};
        int n = 0;
        for (int k = -radius; k <= radius; ++k) {
          const int sx = horizontal ? std::clamp(x + k, 0, out.width - 1) : x;
          const int sy = horizontal ? y : std::clamp(y + k, 0, out.height - 1);
          const size_t si = out.index(sx, sy);
          sum[0] += src[si];
          sum[1] += src[si + 1];
          sum[2] += src[si + 2];
          ++n;
        }
        const size_t di = out.index(x, y);
        dst[di] = static_cast<uint8_t>(sum[0] / n);
        dst[di + 1] = static_cast<uint8_t>(sum[1] / n);
        dst[di + 2] = static_cast<uint8_t>(sum[2] / n);
        dst[di + 3] = 255;
      }
    }
  };

  std::vector<uint8_t> pass(out.pixels.size(), 0);
  blurAxis(out.pixels, pass, true);
  blurAxis(pass, blurred, false);

  for (size_t i = 0; i < out.pixels.size(); i += 4) {
    for (size_t c = 0; c < 3; ++c) {
      const float base = static_cast<float>(out.pixels[i + c]);
      const float glow = static_cast<float>(blurred[i + c]) * style_.bloomStrength;
      out.pixels[i + c] = clamp8(base + glow);
    }
  }
}

void PanelPainter::paint(const GFXcanvas16 &canvas, Image &out) const {
  const int width = outputWidth(canvas);
  const int height = outputHeight(canvas);
  if (out.width != width || out.height != height) {
    out.width = width;
    out.height = height;
    out.pixels.assign(static_cast<size_t>(width) * static_cast<size_t>(height) * 4, 0);
  }

  const uint8_t bgR = static_cast<uint8_t>((style_.background >> 16) & 0xFF);
  const uint8_t bgG = static_cast<uint8_t>((style_.background >> 8) & 0xFF);
  const uint8_t bgB = static_cast<uint8_t>(style_.background & 0xFF);
  for (size_t i = 0; i < out.pixels.size(); i += 4) {
    out.pixels[i] = bgR;
    out.pixels[i + 1] = bgG;
    out.pixels[i + 2] = bgB;
    out.pixels[i + 3] = 255;
  }

  const uint16_t *buffer = canvas.getBuffer();
  for (int y = 0; y < canvas.height(); ++y) {
    for (int x = 0; x < canvas.width(); ++x) {
      const uint16_t value = buffer[y * canvas.width() + x];
      uint8_t r = 0;
      uint8_t g = 0;
      uint8_t b = 0;
      emittedColour(value, r, g, b);
      if ((r | g | b) == 0) {
        continue; // an unlit LED is the background, not a black dot
      }
      drawCell(out, x, y, r, g, b);
    }
  }

  applyBloom(out);
}

} // namespace skypanel
