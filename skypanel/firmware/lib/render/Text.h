// Glyph drawing and measurement on an Adafruit_GFX canvas.
//
// Text arrives as UTF-8 from the backend. The faces are 5 and 7 pixels tall and cover
// ASCII only, so `decode()` folds the string into the font's code space first: lowercase
// becomes uppercase, the three arrow glyphs the frame contract uses (→ ↑ ↓) map onto the
// repurposed slots `~ { }`, and anything else non-ASCII becomes '?'.
//
// No Arduino `String` anywhere — this is the render path.

#pragma once

#include <Adafruit_GFX.h>

#include <cstddef>
#include <cstdint>

#include "fonts/Fonts.h"

namespace skypanel {

/// Longest line the panel will ever be asked to draw, including the terminator.
constexpr size_t kMaxTextLen = 128;

/// A fixed-capacity ASCII buffer. Sized for a panel line, not for general strings.
struct TextBuffer {
  char data[kMaxTextLen] = {0};
  uint8_t length = 0;

  void clear() {
    data[0] = '\0';
    length = 0;
  }
  bool empty() const { return length == 0; }
  const char *c_str() const { return data; }
};

namespace text {

/// UTF-8 → the font's code space. Returns the number of characters written.
uint8_t decode(const char *utf8, TextBuffer &out);

/// Pixel width of `s` in `font`, excluding the trailing inter-glyph gap.
int16_t width(const BitmapFont &font, const char *s);

/// Draw `s` with its top-left at (x, y). Pixels outside the canvas are clipped by GFX.
void draw(Adafruit_GFX &canvas, const BitmapFont &font, int16_t x, int16_t y,
          const char *s, uint16_t colour);

/// Draw only the columns in [clipLeft, clipRight). Used by the scroller so a moving
/// line cannot bleed into the margins.
void drawClipped(Adafruit_GFX &canvas, const BitmapFont &font, int16_t x, int16_t y,
                 const char *s, uint16_t colour, int16_t clipLeft, int16_t clipRight);

} // namespace text
} // namespace skypanel
