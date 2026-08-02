// Measuring and drawing text, one code point at a time.
//
// Adafruit_GFX can print strings, but not the way SkyPanel needs to: it has no
// measurement that accounts for glyphs outside a font's contiguous range, and
// the route arrow (U+2192) plus the climb/descent markers (U+25B2/U+25BC) are
// exactly that. Rather than mangle those server-side into ASCII -- which would
// waste three precious columns on "->" -- the engine decodes UTF-8 and falls
// back to a small table of purpose-drawn glyphs.
//
// Measurement and drawing share one walk, so a string can never measure
// differently from how it draws. That equality is what makes "scroll only if
// the string overflows 64 px" correct rather than approximately correct.
#pragma once

#include <Adafruit_GFX.h>

#include <cstddef>
#include <cstdint>

namespace skypanel {

/// A glyph the base font does not carry, drawn from a row bitmap (MSB first,
/// so a maximum width of 8 -- ample for a 64 px panel).
struct SpecialGlyph {
  uint32_t codepoint;
  uint8_t width;
  uint8_t height;
  uint8_t advance;
  int8_t yOffset;  ///< Top row relative to the baseline; negative is above.
  const uint8_t *rows;
};

/// A typeface as the renderer sees it: a GFXfont plus its extras.
struct Face {
  const GFXfont *font = nullptr;
  const SpecialGlyph *specials = nullptr;
  std::size_t specialCount = 0;
  /// Rows the face occupies above its baseline. Used for layout, not drawing.
  uint8_t ascent = 5;
  /// Title art is uppercase-only; fold anything else rather than dropping it.
  bool foldToUpper = false;
};

/// The two faces SkyPanel renders with. Chosen for 64 px: see docs/FONTS.md.
const Face &titleFace();
const Face &bodyFace();

/// Decode one UTF-8 code point, advancing ``p``. Invalid bytes decode as
/// U+FFFD and consume one byte, so a corrupt string cannot loop forever.
uint32_t decodeUtf8(const char *&p);

/// Total advance width of ``text`` in pixels.
int16_t measureText(const Face &face, const char *text);

/// Draw ``text`` with its left edge at ``x`` and its baseline at ``baselineY``.
/// Returns the x coordinate just past the last glyph.
int16_t drawText(Adafruit_GFX &canvas, const Face &face, const char *text,
                 int16_t x, int16_t baselineY, uint16_t colour);

/// Count code points (not bytes) -- used only by diagnostics and tests.
std::size_t countCodepoints(const char *text);

}  // namespace skypanel
