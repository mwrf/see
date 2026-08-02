#include "Text.h"
#include "testing.h"

using namespace skypanel;

TEST(decode_passes_ascii_through) {
  TextBuffer out;
  CHECK_EQ(text::decode("RYANAIR", out), 7);
  CHECK_STREQ(out.c_str(), "RYANAIR");
}

TEST(decode_folds_lowercase_because_the_faces_are_uppercase_only) {
  TextBuffer out;
  text::decode("Dublin", out);
  CHECK_STREQ(out.c_str(), "DUBLIN");
}

TEST(decode_maps_the_frame_contracts_arrows_onto_font_slots) {
  TextBuffer out;
  text::decode("DUB\xE2\x86\x92STN", out); // DUB→STN
  CHECK_STREQ(out.c_str(), "DUB~STN");

  text::decode("\xE2\x86\x91""1200", out); // ↑1200
  CHECK_STREQ(out.c_str(), "{1200");

  text::decode("\xE2\x86\x93""960", out); // ↓960
  CHECK_STREQ(out.c_str(), "}960");
}

TEST(decode_strips_accents_from_city_names) {
  TextBuffer out;
  text::decode("M\xC3\xA1laga", out); // Málaga
  CHECK_STREQ(out.c_str(), "MALAGA");
  text::decode("Z\xC3\xBCrich", out); // Zürich
  CHECK_STREQ(out.c_str(), "ZURICH");
}

TEST(decode_replaces_unknown_codepoints_rather_than_desynchronising) {
  TextBuffer out;
  // The escapes are split because C hex escapes are greedy: "\xADB" is one escape.
  text::decode("A\xE4\xB8\xAD" "B", out); // A中B
  CHECK_STREQ(out.c_str(), "A?B");
}

TEST(decode_survives_malformed_utf8) {
  TextBuffer out;
  text::decode("A\xFF\xFE" "B", out);
  CHECK_EQ(out.length, 4); // two replacement characters, not a runaway read
}

TEST(decode_truncates_at_the_buffer_limit) {
  std::string huge(500, 'X');
  TextBuffer out;
  text::decode(huge.c_str(), out);
  CHECK_EQ(static_cast<size_t>(out.length), kMaxTextLen - 1);
  CHECK_EQ(out.data[out.length], '\0');
}

TEST(decode_of_null_is_empty) {
  TextBuffer out;
  CHECK_EQ(text::decode(nullptr, out), 0);
  CHECK(out.empty());
}

TEST(width_is_proportional_not_fixed_pitch) {
  // 'I' is narrower than 'M' in both faces; a fixed-pitch face would make these equal.
  CHECK(text::width(FontTiny, "I") < text::width(FontTiny, "M"));
  CHECK(text::width(FontMid, "I") < text::width(FontMid, "M"));
}

TEST(width_excludes_the_trailing_gap) {
  const int16_t one = text::width(FontTiny, "0");
  const int16_t two = text::width(FontTiny, "00");
  CHECK_EQ(two, static_cast<int16_t>(one * 2 + FontTiny.spacing));
}

TEST(width_of_empty_is_zero) {
  CHECK_EQ(text::width(FontTiny, ""), 0);
  CHECK_EQ(text::width(FontTiny, nullptr), 0);
}

TEST(the_faces_fit_the_lines_they_were_designed_for) {
  // These are the numbers that justify the hand-authored faces: the telemetry line has
  // to be readable without permanent scrolling, and a short airline name must not scroll.
  CHECK(text::width(FontTiny, "24,000FT  410KT  6.1MI") <= 90);
  CHECK(text::width(FontTiny, "FR1812  DUB~STN  B738") <= 84);
  CHECK(text::width(FontMid, "RYANAIR") <= 61);
  CHECK(text::width(FontMid, "AER LINGUS") <= 61);   // just fits, no scroll
  CHECK(text::width(FontMid, "TURKISH AIRLINES") > 61); // scrolls, as expected
}

TEST(digits_are_tabular_so_telemetry_does_not_jitter) {
  const int16_t zero = text::width(FontTiny, "0");
  for (char c = '1'; c <= '9'; ++c) {
    const char s[2] = {c, '\0'};
    CHECK_EQ(text::width(FontTiny, s), zero);
  }
  const int16_t midZero = text::width(FontMid, "0");
  for (char c = '1'; c <= '9'; ++c) {
    const char s[2] = {c, '\0'};
    CHECK_EQ(text::width(FontMid, s), midZero);
  }
}

TEST(every_printable_ascii_has_a_glyph_in_both_faces) {
  for (uint8_t code = 0x20; code <= 0x7E; ++code) {
    const Glyph &tiny = FontTiny.glyph(code);
    const Glyph &mid = FontMid.glyph(code);
    CHECK(tiny.width >= 1 && tiny.width <= 5);
    CHECK(mid.width >= 1 && mid.width <= 5);
  }
}

TEST(letters_and_digits_actually_have_ink) {
  auto hasInk = [](const BitmapFont &font, uint8_t code) {
    const Glyph &glyph = font.glyph(code);
    for (uint8_t row = 0; row < font.height; ++row) {
      if (glyph.rows[row] != 0) {
        return true;
      }
    }
    return false;
  };
  for (uint8_t code = '0'; code <= '9'; ++code) {
    CHECK(hasInk(FontTiny, code));
    CHECK(hasInk(FontMid, code));
  }
  for (uint8_t code = 'A'; code <= 'Z'; ++code) {
    CHECK(hasInk(FontTiny, code));
    CHECK(hasInk(FontMid, code));
  }
}

TEST(glyph_ink_stays_inside_its_declared_width) {
  // A glyph whose bits extend past `width` would overlap its neighbour on the panel.
  for (uint8_t code = 0x20; code <= 0x7E; ++code) {
    for (const BitmapFont *font : {&FontTiny, &FontMid}) {
      const Glyph &glyph = font->glyph(code);
      const uint8_t mask = static_cast<uint8_t>(0xFF >> glyph.width);
      for (uint8_t row = 0; row < font->height; ++row) {
        CHECK_EQ(static_cast<int>(glyph.rows[row] & mask), 0);
      }
    }
  }
}

TEST(out_of_range_codes_fall_back_to_space) {
  CHECK_EQ(FontTiny.glyph(0x01).width, FontTiny.glyph(' ').width);
  CHECK_EQ(FontMid.glyph(0xFF).width, FontMid.glyph(' ').width);
}

TEST(draw_puts_ink_on_the_canvas) {
  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  text::draw(canvas, FontTiny, 0, 0, "A", 0xF800);

  int lit = 0;
  for (int y = 0; y < 5; ++y) {
    for (int x = 0; x < 4; ++x) {
      if (canvas.getPixel(x, y) != 0) {
        lit++;
      }
    }
  }
  CHECK_EQ(lit, 10); // the 3x5 'A' has ten lit cells
}

TEST(draw_clipped_respects_its_window) {
  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  text::drawClipped(canvas, FontTiny, 0, 0, "MMMMMMMMMMMMMMMMMMMM", 0xFFFF, 0, 20);
  for (int y = 0; y < 5; ++y) {
    for (int x = 20; x < 64; ++x) {
      CHECK_EQ(static_cast<int>(canvas.getPixel(x, y)), 0);
    }
  }
}

TEST(draw_clipped_handles_a_negative_origin_for_scrolling) {
  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  text::drawClipped(canvas, FontTiny, -30, 0, "ABCDEFGHIJKLMNOP", 0xFFFF, 0, 64);
  bool anyLit = false;
  for (int y = 0; y < 5 && !anyLit; ++y) {
    for (int x = 0; x < 64; ++x) {
      if (canvas.getPixel(x, y) != 0) {
        anyLit = true;
        break;
      }
    }
  }
  CHECK(anyLit);
}
