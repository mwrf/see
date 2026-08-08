#include "PanelSim.h"

#include <algorithm>
#include <cmath>

namespace skypanel {
namespace {

/// Cache the ramp: it is the same 256 entries for every pixel of every frame,
/// and pow() 200,000 times per frame is enough to be felt at --speed 4.
struct Ramp {
  float gamma = -1.0F;
  uint8_t brightness = 0;
  uint8_t table[256] = {};

  const uint8_t *get(float g, uint8_t b) {
    if (g != gamma || b != brightness) {
      gamma = g;
      brightness = b;
      const float scale = static_cast<float>(b) / 255.0F;
      for (int i = 0; i < 256; ++i) {
        const float linear = static_cast<float>(i) / 255.0F;
        const float corrected = std::pow(linear, g) * scale;
        table[i] = static_cast<uint8_t>(std::lround(corrected * 255.0F));
      }
    }
    return table;
  }
};

Ramp &ramp() {
  static Ramp instance;
  return instance;
}

void blend(uint8_t &channel, int addition) {
  channel = static_cast<uint8_t>(std::min(255, static_cast<int>(channel) + addition));
}

}  // namespace

void unpack565(uint16_t packed, uint8_t &r, uint8_t &g, uint8_t &b) {
  //  Replicating the top bits into the low ones is what the HUB75 driver does,
  //  and it matters: without it pure white (0xFFFF) would come out as 0xF8F8F8.
  const uint8_t r5 = static_cast<uint8_t>((packed >> 11) & 0x1F);
  const uint8_t g6 = static_cast<uint8_t>((packed >> 5) & 0x3F);
  const uint8_t b5 = static_cast<uint8_t>(packed & 0x1F);
  r = static_cast<uint8_t>((r5 << 3) | (r5 >> 2));
  g = static_cast<uint8_t>((g6 << 2) | (g6 >> 4));
  b = static_cast<uint8_t>((b5 << 3) | (b5 >> 2));
}

uint8_t applyRamp(uint8_t value, float gamma, uint8_t brightness) {
  return ramp().get(gamma, brightness)[value];
}

Image renderRaw(const GFXcanvas16 &canvas, const PanelStyle &style) {
  const int width = canvas.width();
  const int height = canvas.height();
  Image image(width, height);
  const uint8_t *table = ramp().get(style.gamma, style.brightness);
  const uint16_t *buffer = canvas.getBuffer();

  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      uint8_t r = 0;
      uint8_t g = 0;
      uint8_t b = 0;
      unpack565(buffer[static_cast<std::size_t>(y) * width + x], r, g, b);
      const std::size_t offset = image.index(x, y);
      image.rgb[offset] = table[r];
      image.rgb[offset + 1] = table[g];
      image.rgb[offset + 2] = table[b];
    }
  }
  return image;
}

Image renderPanel(const GFXcanvas16 &canvas, const PanelStyle &style) {
  const int panelWidth = canvas.width();
  const int panelHeight = canvas.height();
  const int scale = std::max(1, style.scale);

  Image image(panelWidth * scale, panelHeight * scale);
  std::fill(image.rgb.begin(), image.rgb.end(), style.backgroundLevel);

  const uint8_t *table = ramp().get(style.gamma, style.brightness);
  const uint16_t *buffer = canvas.getBuffer();

  //  Dot geometry, in on-screen pixels. The radius is generous enough that a
  //  scale of 1 still fills its cell, so --snapshot at scale 1 is exactly the
  //  canvas.
  const float radius = static_cast<float>(scale) * style.dotFill() * 0.5F;
  const float centre = static_cast<float>(scale - 1) * 0.5F;
  const float radiusSq = radius * radius;

  //  Gamma-corrected colour per LED, kept so the bloom pass does not have to
  //  unpack and re-ramp the whole canvas a second time. Two bytes per pixel of
  //  canvas becomes three, which at 64x32 is 6 KB -- nothing next to the
  //  scaled output it saves work on.
  std::vector<uint8_t> lit(static_cast<std::size_t>(panelWidth) * panelHeight * 3, 0);

  for (int py = 0; py < panelHeight; ++py) {
    for (int px = 0; px < panelWidth; ++px) {
      uint8_t r = 0;
      uint8_t g = 0;
      uint8_t b = 0;
      unpack565(buffer[static_cast<std::size_t>(py) * panelWidth + px], r, g, b);
      r = table[r];
      g = table[g];
      b = table[b];
      const std::size_t source = (static_cast<std::size_t>(py) * panelWidth + px) * 3;
      lit[source] = r;
      lit[source + 1] = g;
      lit[source + 2] = b;
      if (r == 0 && g == 0 && b == 0) {
        continue;  // unlit LEDs leave the substrate showing
      }

      for (int dy = 0; dy < scale; ++dy) {
        for (int dx = 0; dx < scale; ++dx) {
          if (style.roundedDots && scale > 2) {
            const float ox = static_cast<float>(dx) - centre;
            const float oy = static_cast<float>(dy) - centre;
            if (ox * ox + oy * oy > radiusSq) {
              continue;
            }
          }
          const std::size_t offset = image.index(px * scale + dx, py * scale + dy);
          image.rgb[offset] = r;
          image.rgb[offset + 1] = g;
          image.rgb[offset + 2] = b;
        }
      }
    }
  }

  if (!style.bloom) {
    return image;
  }

  //  Bloom is a cheap one-cell halo rather than a real blur: enough to judge
  //  whether two adjacent colours will smear into each other on the panel.
  //  It has to be a second pass because dots are written and halos are added,
  //  so a single pass would let a later dot erase an earlier neighbour's glow.
  //  Blended in place -- copying the scaled image first would cost 600 KB a
  //  frame at the default scale and buys nothing, since the pre-bloom image is
  //  never read again.
  const int halo = std::max(1, scale / 3);
  for (int py = 0; py < panelHeight; ++py) {
    for (int px = 0; px < panelWidth; ++px) {
      const std::size_t source = (static_cast<std::size_t>(py) * panelWidth + px) * 3;
      const uint8_t r = lit[source];
      const uint8_t g = lit[source + 1];
      const uint8_t b = lit[source + 2];
      if (r == 0 && g == 0 && b == 0) {
        continue;
      }
      const int addR = static_cast<int>(static_cast<float>(r) * style.bloomStrength);
      const int addG = static_cast<int>(static_cast<float>(g) * style.bloomStrength);
      const int addB = static_cast<int>(static_cast<float>(b) * style.bloomStrength);

      const int x0 = std::max(0, px * scale - halo);
      const int y0 = std::max(0, py * scale - halo);
      const int x1 = std::min(image.width - 1, (px + 1) * scale - 1 + halo);
      const int y1 = std::min(image.height - 1, (py + 1) * scale - 1 + halo);
      for (int y = y0; y <= y1; ++y) {
        for (int x = x0; x <= x1; ++x) {
          const std::size_t offset = image.index(x, y);
          blend(image.rgb[offset], addR);
          blend(image.rgb[offset + 1], addG);
          blend(image.rgb[offset + 2], addB);
        }
      }
    }
  }
  return image;
}

}  // namespace skypanel
