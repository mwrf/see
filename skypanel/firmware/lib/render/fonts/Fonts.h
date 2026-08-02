// Bitmap faces for a 64x32 panel.
//
// Deliberately not `GFXfont`: at this size the glyphs need per-character widths and a
// one-pixel gap, and packing them as a flat row-per-byte table keeps the whole face
// under 800 bytes of flash with no offset arithmetic at draw time.
//
// See generate_fonts.py for the design rationale and the glyph art.

#pragma once

#include <cstdint>

namespace skypanel {

/// One character. `rows[i]` is a bitmask of row i, MSB = leftmost pixel.
struct Glyph {
  uint8_t width;
  uint8_t rows[8];
};

struct BitmapFont {
  const char *name;
  uint8_t height;
  uint8_t spacing; ///< blank columns inserted after each glyph
  uint8_t first;   ///< code point of glyphs[0]
  uint8_t count;
  const Glyph *glyphs;

  /// The glyph for `code`, or the space glyph when it is outside the face.
  const Glyph &glyph(uint8_t code) const {
    if (code < first || code >= first + count) {
      code = ' ';
    }
    return glyphs[code - first];
  }
};

/// 5 px tall. Body lines: route, telemetry, bearing. ~19 characters across 64 px.
extern const BitmapFont &FontTiny;

/// 7 px tall. The airline name. ~11 characters across 64 px.
extern const BitmapFont &FontMid;

} // namespace skypanel
