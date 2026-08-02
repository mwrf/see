#include "TextEngine.h"

#include <Fonts/TomThumb.h>

#include "fonts/SkyPanel7.h"

namespace skypanel {
namespace {

// -- extra glyphs -------------------------------------------------------
//
// Drawn to match each face's weight. The body versions are 5 rows to sit on
// TomThumb's cap height; the title versions are 7.

// clang-format off
const uint8_t kBodyArrowRight[] = {
    0b00100000,
    0b00010000,
    0b11111000,
    0b00010000,
    0b00100000,
};
const uint8_t kBodyTriangleUp[] = {
    0b00100000,
    0b01110000,
    0b11111000,
    0b00000000,
    0b00000000,
};
const uint8_t kBodyTriangleDown[] = {
    0b00000000,
    0b00000000,
    0b11111000,
    0b01110000,
    0b00100000,
};
const uint8_t kBodyDegree[] = {
    0b11100000,
    0b10100000,
    0b11100000,
    0b00000000,
    0b00000000,
};

const uint8_t kTitleArrowRight[] = {
    0b00010000,
    0b00001000,
    0b11111100,
    0b11111100,
    0b00001000,
    0b00010000,
};
const uint8_t kTitleTriangleUp[] = {
    0b00010000,
    0b00111000,
    0b01111100,
    0b11111110,
    0b00000000,
    0b00000000,
};
const uint8_t kTitleTriangleDown[] = {
    0b00000000,
    0b00000000,
    0b11111110,
    0b01111100,
    0b00111000,
    0b00010000,
};
const uint8_t kTitleDegree[] = {
    0b11100000,
    0b10100000,
    0b11100000,
    0b00000000,
    0b00000000,
    0b00000000,
};
// clang-format on

constexpr uint32_t kArrowRight = 0x2192;   // →
constexpr uint32_t kTriangleUp = 0x25B2;   // ▲
constexpr uint32_t kTriangleDown = 0x25BC; // ▼
constexpr uint32_t kDegree = 0x00B0;       // °
constexpr uint32_t kReplacement = 0xFFFD;

const SpecialGlyph kBodySpecials[] = {
    {kArrowRight, 5, 5, 6, -5, kBodyArrowRight},
    {kTriangleUp, 5, 5, 6, -5, kBodyTriangleUp},
    {kTriangleDown, 5, 5, 6, -5, kBodyTriangleDown},
    {kDegree, 3, 5, 4, -5, kBodyDegree},
};

const SpecialGlyph kTitleSpecials[] = {
    {kArrowRight, 7, 6, 8, -7, kTitleArrowRight},
    {kTriangleUp, 7, 6, 8, -7, kTitleTriangleUp},
    {kTriangleDown, 7, 6, 8, -7, kTitleTriangleDown},
    {kDegree, 3, 6, 4, -7, kTitleDegree},
};

const SpecialGlyph *findSpecial(const Face &face, uint32_t codepoint) {
  for (std::size_t i = 0; i < face.specialCount; ++i) {
    if (face.specials[i].codepoint == codepoint) {
      return &face.specials[i];
    }
  }
  return nullptr;
}

/// Map a code point onto a glyph index in the face's GFXfont, or -1.
int glyphIndex(const Face &face, uint32_t codepoint) {
  if (face.font == nullptr) {
    return -1;
  }
  if (face.foldToUpper && codepoint >= 'a' && codepoint <= 'z') {
    codepoint -= 32;
  }
  const uint16_t first = face.font->first;
  const uint16_t last = face.font->last;
  if (codepoint < first || codepoint > last) {
    return -1;
  }
  return static_cast<int>(codepoint - first);
}

const GFXglyph *glyphAt(const Face &face, int index) {
  return &(reinterpret_cast<GFXglyph *>(face.font->glyph))[index];
}

/// A code point we cannot draw becomes '?' so the failure is visible on the
/// panel instead of silently shortening the line.
uint32_t substitute(const Face &face, uint32_t codepoint) {
  if (findSpecial(face, codepoint) != nullptr || glyphIndex(face, codepoint) >= 0) {
    return codepoint;
  }
  if (codepoint == ' ') {
    return ' ';
  }
  return glyphIndex(face, '?') >= 0 ? '?' : 0;
}

void drawSpecial(Adafruit_GFX &canvas, const SpecialGlyph &glyph, int16_t x,
                 int16_t baselineY, uint16_t colour) {
  for (uint8_t row = 0; row < glyph.height; ++row) {
    const uint8_t bits = glyph.rows[row];
    for (uint8_t column = 0; column < glyph.width; ++column) {
      if ((bits << column) & 0x80) {
        canvas.drawPixel(static_cast<int16_t>(x + column),
                         static_cast<int16_t>(baselineY + glyph.yOffset + row),
                         colour);
      }
    }
  }
}

void drawGfxGlyph(Adafruit_GFX &canvas, const Face &face, int index, int16_t x,
                  int16_t baselineY, uint16_t colour) {
  const GFXglyph *glyph = glyphAt(face, index);
  const uint8_t *bitmap = reinterpret_cast<uint8_t *>(face.font->bitmap);
  uint16_t offset = glyph->bitmapOffset;
  uint8_t bits = 0;
  uint8_t bit = 0;

  for (uint8_t row = 0; row < glyph->height; ++row) {
    for (uint8_t column = 0; column < glyph->width; ++column) {
      if (bit == 0) {
        bits = bitmap[offset++];
        bit = 8;
      }
      if (bits & 0x80) {
        canvas.drawPixel(static_cast<int16_t>(x + glyph->xOffset + column),
                         static_cast<int16_t>(baselineY + glyph->yOffset + row),
                         colour);
      }
      bits <<= 1;
      --bit;
    }
  }
}

Face makeTitleFace() {
  Face face;
  face.font = &SkyPanel7;
  face.specials = kTitleSpecials;
  face.specialCount = sizeof(kTitleSpecials) / sizeof(kTitleSpecials[0]);
  face.ascent = 7;
  face.foldToUpper = true;
  return face;
}

Face makeBodyFace() {
  Face face;
  face.font = &TomThumb;
  face.specials = kBodySpecials;
  face.specialCount = sizeof(kBodySpecials) / sizeof(kBodySpecials[0]);
  face.ascent = 5;
  face.foldToUpper = false;
  return face;
}

}  // namespace

const Face &titleFace() {
  static const Face face = makeTitleFace();
  return face;
}

const Face &bodyFace() {
  static const Face face = makeBodyFace();
  return face;
}

uint32_t decodeUtf8(const char *&p) {
  const auto byte = [&](int index) {
    return static_cast<uint8_t>(p[index]);
  };
  const uint8_t lead = byte(0);

  if (lead < 0x80) {
    ++p;
    return lead;
  }
  const auto isContinuation = [](uint8_t c) { return (c & 0xC0) == 0x80; };

  if ((lead & 0xE0) == 0xC0 && isContinuation(byte(1))) {
    const uint32_t code = ((lead & 0x1FU) << 6) | (byte(1) & 0x3FU);
    p += 2;
    return code;
  }
  if ((lead & 0xF0) == 0xE0 && isContinuation(byte(1)) && isContinuation(byte(2))) {
    const uint32_t code =
        ((lead & 0x0FU) << 12) | ((byte(1) & 0x3FU) << 6) | (byte(2) & 0x3FU);
    p += 3;
    return code;
  }
  if ((lead & 0xF8) == 0xF0 && isContinuation(byte(1)) && isContinuation(byte(2)) &&
      isContinuation(byte(3))) {
    const uint32_t code = ((lead & 0x07U) << 18) | ((byte(1) & 0x3FU) << 12) |
                          ((byte(2) & 0x3FU) << 6) | (byte(3) & 0x3FU);
    p += 4;
    return code;
  }

  ++p;  // malformed: consume one byte so callers always make progress
  return kReplacement;
}

int16_t measureText(const Face &face, const char *text) {
  if (text == nullptr) {
    return 0;
  }
  int16_t width = 0;
  const char *p = text;
  while (*p != '\0') {
    const uint32_t codepoint = substitute(face, decodeUtf8(p));
    if (codepoint == 0) {
      continue;
    }
    if (const SpecialGlyph *special = findSpecial(face, codepoint)) {
      width = static_cast<int16_t>(width + special->advance);
      continue;
    }
    const int index = glyphIndex(face, codepoint);
    if (index >= 0) {
      width = static_cast<int16_t>(width + glyphAt(face, index)->xAdvance);
    }
  }
  return width;
}

int16_t drawText(Adafruit_GFX &canvas, const Face &face, const char *text,
                 int16_t x, int16_t baselineY, uint16_t colour) {
  if (text == nullptr) {
    return x;
  }
  const char *p = text;
  const int16_t canvasWidth = canvas.width();

  while (*p != '\0') {
    const uint32_t codepoint = substitute(face, decodeUtf8(p));
    if (codepoint == 0) {
      continue;
    }

    if (const SpecialGlyph *special = findSpecial(face, codepoint)) {
      //  Skip glyphs entirely off-canvas; scrolling lines spend most of their
      //  time there and drawPixel would clip them one pixel at a time.
      if (x + special->width > 0 && x < canvasWidth) {
        drawSpecial(canvas, *special, x, baselineY, colour);
      }
      x = static_cast<int16_t>(x + special->advance);
      continue;
    }

    const int index = glyphIndex(face, codepoint);
    if (index < 0) {
      continue;
    }
    const GFXglyph *glyph = glyphAt(face, index);
    if (x + glyph->xOffset + glyph->width > 0 && x < canvasWidth) {
      drawGfxGlyph(canvas, face, index, x, baselineY, colour);
    }
    x = static_cast<int16_t>(x + glyph->xAdvance);
  }
  return x;
}

std::size_t countCodepoints(const char *text) {
  if (text == nullptr) {
    return 0;
  }
  std::size_t count = 0;
  const char *p = text;
  while (*p != '\0') {
    decodeUtf8(p);
    ++count;
  }
  return count;
}

}  // namespace skypanel
