#include "Text.h"

namespace skypanel {
namespace text {
namespace {

/// The three arrows the frame contract uses, mapped onto the repurposed font slots.
struct ArrowMapping {
  uint32_t codepoint;
  char slot;
};

constexpr ArrowMapping kArrows[] = {
    {0x2192, '~'}, // → route separator
    {0x2191, '{'}, // ↑ climb
    {0x2193, '}'}, // ↓ descend
    {0x2022, '`'}, // • bullet
    {0x00B0, 'o'}, // ° degrees — no dedicated glyph, 'o' reads correctly at 5px
};

/// Decode one UTF-8 sequence. Advances `i` past it. Returns U+FFFD on a malformed byte
/// rather than desynchronising the rest of the line.
uint32_t nextCodepoint(const char *s, size_t &i) {
  const auto b0 = static_cast<uint8_t>(s[i]);
  if (b0 < 0x80) {
    i += 1;
    return b0;
  }
  auto cont = [&](size_t offset) -> uint32_t {
    return static_cast<uint8_t>(s[i + offset]) & 0x3FU;
  };
  auto isCont = [&](size_t offset) {
    return (static_cast<uint8_t>(s[i + offset]) & 0xC0U) == 0x80U;
  };
  if ((b0 & 0xE0U) == 0xC0U && isCont(1)) {
    const uint32_t cp = ((b0 & 0x1FU) << 6) | cont(1);
    i += 2;
    return cp;
  }
  if ((b0 & 0xF0U) == 0xE0U && isCont(1) && isCont(2)) {
    const uint32_t cp = ((b0 & 0x0FU) << 12) | (cont(1) << 6) | cont(2);
    i += 3;
    return cp;
  }
  if ((b0 & 0xF8U) == 0xF0U && isCont(1) && isCont(2) && isCont(3)) {
    const uint32_t cp = ((b0 & 0x07U) << 18) | (cont(1) << 12) | (cont(2) << 6) | cont(3);
    i += 4;
    return cp;
  }
  i += 1;
  return 0xFFFDU;
}

char foldToFont(uint32_t cp) {
  for (const auto &arrow : kArrows) {
    if (arrow.codepoint == cp) {
      return arrow.slot;
    }
  }
  if (cp >= 'a' && cp <= 'z') {
    return static_cast<char>(cp - 'a' + 'A');
  }
  if (cp >= 0x20 && cp <= 0x7E) {
    return static_cast<char>(cp);
  }
  // Latin-1 letters with diacritics appear in city names (Málaga, Zürich). Strip the
  // accent rather than printing '?' — the panel is uppercase ASCII by design.
  switch (cp) {
  case 0x00C0: case 0x00C1: case 0x00C2: case 0x00C3: case 0x00C4: case 0x00C5:
  case 0x00E0: case 0x00E1: case 0x00E2: case 0x00E3: case 0x00E4: case 0x00E5:
    return 'A';
  case 0x00C8: case 0x00C9: case 0x00CA: case 0x00CB:
  case 0x00E8: case 0x00E9: case 0x00EA: case 0x00EB:
    return 'E';
  case 0x00CC: case 0x00CD: case 0x00CE: case 0x00CF:
  case 0x00EC: case 0x00ED: case 0x00EE: case 0x00EF:
    return 'I';
  case 0x00D2: case 0x00D3: case 0x00D4: case 0x00D5: case 0x00D6:
  case 0x00F2: case 0x00F3: case 0x00F4: case 0x00F5: case 0x00F6:
    return 'O';
  case 0x00D9: case 0x00DA: case 0x00DB: case 0x00DC:
  case 0x00F9: case 0x00FA: case 0x00FB: case 0x00FC:
    return 'U';
  case 0x00D1: case 0x00F1:
    return 'N';
  case 0x00C7: case 0x00E7:
    return 'C';
  default:
    return '?';
  }
}

} // namespace

uint8_t decode(const char *utf8, TextBuffer &out) {
  out.clear();
  if (utf8 == nullptr) {
    return 0;
  }
  size_t i = 0;
  while (utf8[i] != '\0' && static_cast<size_t>(out.length) + 1 < kMaxTextLen) {
    const uint32_t cp = nextCodepoint(utf8, i);
    out.data[out.length++] = foldToFont(cp);
  }
  out.data[out.length] = '\0';
  return out.length;
}

int16_t width(const BitmapFont &font, const char *s) {
  if (s == nullptr || *s == '\0') {
    return 0;
  }
  int16_t total = 0;
  for (size_t i = 0; s[i] != '\0'; ++i) {
    total += font.glyph(static_cast<uint8_t>(s[i])).width + font.spacing;
  }
  return static_cast<int16_t>(total - font.spacing);
}

void drawClipped(Adafruit_GFX &canvas, const BitmapFont &font, int16_t x, int16_t y,
                 const char *s, uint16_t colour, int16_t clipLeft, int16_t clipRight) {
  if (s == nullptr) {
    return;
  }
  int16_t penX = x;
  for (size_t i = 0; s[i] != '\0'; ++i) {
    const Glyph &glyph = font.glyph(static_cast<uint8_t>(s[i]));
    const int16_t advance = static_cast<int16_t>(glyph.width + font.spacing);
    // Skip glyphs entirely outside the window — at 30 fps this matters on the ESP32.
    if (penX + glyph.width <= clipLeft) {
      penX += advance;
      continue;
    }
    if (penX >= clipRight) {
      return;
    }
    for (uint8_t row = 0; row < font.height; ++row) {
      const uint8_t bits = glyph.rows[row];
      if (bits == 0) {
        continue;
      }
      for (uint8_t col = 0; col < glyph.width; ++col) {
        if ((bits & (0x80U >> col)) == 0) {
          continue;
        }
        const int16_t px = static_cast<int16_t>(penX + col);
        if (px < clipLeft || px >= clipRight) {
          continue;
        }
        canvas.drawPixel(px, static_cast<int16_t>(y + row), colour);
      }
    }
    penX += advance;
  }
}

void draw(Adafruit_GFX &canvas, const BitmapFont &font, int16_t x, int16_t y,
          const char *s, uint16_t colour) {
  drawClipped(canvas, font, x, y, s, colour, 0, canvas.width());
}

} // namespace text
} // namespace skypanel
