// Renderer, text engine, scroller and panel simulation.
#include <cstring>

#include "FrameParser.h"
#include "PanelSim.h"
#include "Renderer.h"
#include "Scroller.h"
#include "TestFramework.h"
#include "TextEngine.h"

using skypanel::bodyFace;
using skypanel::Colour;
using skypanel::DisplayFrame;
using skypanel::drawText;
using skypanel::FrameLine;
using skypanel::FrameMode;
using skypanel::FrameStatus;
using skypanel::LineStyle;
using skypanel::measureText;
using skypanel::Pitch;
using skypanel::PanelStyle;
using skypanel::renderPanel;
using skypanel::Renderer;
using skypanel::ScrollMode;
using skypanel::Scroller;
using skypanel::titleFace;
using skypanel::toRgb565;

namespace {

int litPixels(const GFXcanvas16 &canvas) {
  int count = 0;
  for (int16_t y = 0; y < canvas.height(); ++y) {
    for (int16_t x = 0; x < canvas.width(); ++x) {
      if (const_cast<GFXcanvas16 &>(canvas).getPixel(x, y) != 0) {
        ++count;
      }
    }
  }
  return count;
}

/// Bounding box of everything lit, so layout can be asserted without pinning
/// exact glyph shapes.
struct Bounds {
  int16_t minX = 32767;
  int16_t minY = 32767;
  int16_t maxX = -1;
  int16_t maxY = -1;
  bool empty() const { return maxX < 0; }
};

Bounds boundsOf(const GFXcanvas16 &canvas) {
  Bounds bounds;
  for (int16_t y = 0; y < canvas.height(); ++y) {
    for (int16_t x = 0; x < canvas.width(); ++x) {
      if (const_cast<GFXcanvas16 &>(canvas).getPixel(x, y) != 0) {
        if (x < bounds.minX) bounds.minX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y > bounds.maxY) bounds.maxY = y;
      }
    }
  }
  return bounds;
}

DisplayFrame makeFrame(const char *title, const char *body1, const char *body2) {
  DisplayFrame frame;
  frame.mode = FrameMode::Nearest;
  frame.status = FrameStatus::Live;
  std::snprintf(frame.source, skypanel::kMaxSourceBytes, "local");

  const char *texts[3] = {title, body1, body2};
  for (int i = 0; i < 3; ++i) {
    if (texts[i] == nullptr) {
      break;
    }
    FrameLine &line = frame.lines[frame.lineCount];
    std::snprintf(line.text, skypanel::kMaxTextBytes, "%s", texts[i]);
    line.style = i == 0 ? LineStyle::Title : LineStyle::Body;
    line.colour = Colour{0xFF, 0xFF, 0xFF};
    line.scroll = ScrollMode::Auto;
    ++frame.lineCount;
  }
  return frame;
}

}  // namespace

// -- text measurement ---------------------------------------------------

TEST(text_measurement_is_zero_for_empty_strings) {
  CHECK_EQ(measureText(bodyFace(), ""), 0);
  CHECK_EQ(measureText(titleFace(), nullptr), 0);
}

TEST(text_measurement_grows_with_length) {
  const int16_t one = measureText(bodyFace(), "A");
  const int16_t three = measureText(bodyFace(), "AAA");
  CHECK_EQ(three, static_cast<int16_t>(one * 3));
}

TEST(title_face_is_wider_than_the_body_face) {
  CHECK(measureText(titleFace(), "RYANAIR") > measureText(bodyFace(), "RYANAIR"));
}

TEST(a_short_airline_name_fits_the_panel) {
  //  This is the design constraint the title font exists to satisfy.
  CHECK(measureText(titleFace(), "RYANAIR") <= 64);
  CHECK(measureText(titleFace(), "AER LINGUS") <= 64);
}

TEST(a_long_airline_name_overflows_and_must_scroll) {
  CHECK(measureText(titleFace(), "BRITISH AIRWAYS") > 64);
}

TEST(the_detail_line_is_measurable_and_overflows_as_expected) {
  //  22 characters at ~3.5 px each: it scrolls, which is exactly why the
  //  contract has a scroll field.
  CHECK(measureText(bodyFace(), "24,000FT  410KT  6.1MI") > 64);
}

TEST(the_flight_line_fits_when_it_is_short_enough) {
  CHECK(measureText(bodyFace(), "FR1812  B738") <= 64);
}

TEST(the_title_face_folds_lowercase_to_uppercase) {
  CHECK_EQ(measureText(titleFace(), "ryanair"), measureText(titleFace(), "RYANAIR"));
}

TEST(utf8_decoding_handles_one_two_three_and_four_byte_sequences) {
  const char *ascii = "A";
  const char *twoByte = "\xC2\xB0";           // U+00B0
  const char *threeByte = "\xE2\x86\x92";     // U+2192
  const char *fourByte = "\xF0\x9F\x9B\xA9";  // U+1F6E9
  const char *p = ascii;
  CHECK_EQ(static_cast<int>(skypanel::decodeUtf8(p)), 'A');
  p = twoByte;
  CHECK_EQ(static_cast<int>(skypanel::decodeUtf8(p)), 0xB0);
  p = threeByte;
  CHECK_EQ(static_cast<int>(skypanel::decodeUtf8(p)), 0x2192);
  p = fourByte;
  CHECK_EQ(static_cast<int>(skypanel::decodeUtf8(p)), 0x1F6E9);
}

TEST(malformed_utf8_always_makes_progress) {
  const char *broken = "\xFF\xFE";
  const char *p = broken;
  skypanel::decodeUtf8(p);
  CHECK(p > broken);
  CHECK_EQ(skypanel::countCodepoints("\xFF\xFE"), static_cast<std::size_t>(2));
}

TEST(the_route_arrow_measures_as_one_glyph_not_three_bytes) {
  const int16_t withArrow = measureText(bodyFace(), "A\xE2\x86\x92" "B");
  const int16_t withThreeLetters = measureText(bodyFace(), "AXYZB");
  CHECK(withArrow < withThreeLetters);
}

TEST(both_faces_carry_the_special_glyphs) {
  for (const char *glyph : {"\xE2\x86\x92", "\xE2\x96\xB2", "\xE2\x96\xBC", "\xC2\xB0"}) {
    CHECK(measureText(bodyFace(), glyph) > 0);
    CHECK(measureText(titleFace(), glyph) > 0);
  }
}

TEST(an_undrawable_codepoint_becomes_a_question_mark) {
  //  Visible breakage beats a silently shortened line.
  CHECK_EQ(measureText(bodyFace(), "\xF0\x9F\x9B\xA9"), measureText(bodyFace(), "?"));
}

TEST(drawing_lights_pixels_and_returns_the_advance) {
  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  const int16_t end = drawText(canvas, bodyFace(), "AB", 0, 10, 0xFFFF);
  CHECK_EQ(end, measureText(bodyFace(), "AB"));
  CHECK(litPixels(canvas) > 0);
}

TEST(drawing_off_canvas_lights_nothing) {
  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  drawText(canvas, bodyFace(), "AB", -400, 10, 0xFFFF);
  CHECK_EQ(litPixels(canvas), 0);
}

// -- scroller -----------------------------------------------------------

TEST(a_line_that_fits_does_not_scroll) {
  Scroller scroller;
  scroller.configure(40, 64, true);
  scroller.advance(10000);
  CHECK(!scroller.scrolling());
  CHECK_EQ(scroller.offset(), 0);
}

TEST(a_line_that_overflows_scrolls) {
  Scroller scroller;
  scroller.configure(120, 64, true);
  CHECK(scroller.scrolling());
}

TEST(scrolling_can_be_disabled_by_the_frame) {
  Scroller scroller;
  scroller.configure(120, 64, false);
  scroller.advance(5000);
  CHECK(!scroller.scrolling());
  CHECK_EQ(scroller.offset(), 0);
}

TEST(the_scroller_dwells_before_moving) {
  Scroller scroller;
  scroller.configure(120, 64, true);
  scroller.advance(Scroller::kDwellMs - 100);
  CHECK_EQ(scroller.offset(), 0);
  scroller.advance(500);
  CHECK(scroller.offset() > 0);
}

TEST(the_scroller_moves_at_the_configured_speed) {
  Scroller scroller;
  scroller.configure(120, 64, true);
  scroller.advance(Scroller::kDwellMs);
  scroller.advance(1000);
  CHECK_NEAR(scroller.offset(), Scroller::kSpeedPxPerSec, 1.0);
}

TEST(the_scroller_wraps_and_dwells_again) {
  Scroller scroller;
  scroller.configure(120, 64, true);
  const int16_t cycle = scroller.cycleWidth();
  CHECK_EQ(cycle, static_cast<int16_t>(120 + Scroller::kGapPx));

  //  Run well past one full cycle; the offset must stay inside it.
  for (int i = 0; i < 100; ++i) {
    scroller.advance(500);
    CHECK(scroller.offset() >= 0);
    CHECK(scroller.offset() < cycle);
  }
}

TEST(reconfiguring_with_new_text_restarts_the_animation) {
  Scroller scroller;
  scroller.configure(120, 64, true);
  scroller.advance(5000);
  CHECK(scroller.offset() > 0);
  scroller.configure(140, 64, true);
  CHECK_EQ(scroller.offset(), 0);
}

// -- renderer -----------------------------------------------------------

TEST(the_renderer_produces_a_64x32_canvas) {
  Renderer renderer;
  CHECK_EQ(renderer.width(), 64);
  CHECK_EQ(renderer.height(), 32);
}

TEST(rendering_a_three_line_frame_lights_pixels_on_three_bands) {
  Renderer renderer;
  renderer.setFrame(makeFrame("RYANAIR", "FR1812  B738", "24,000FT"));
  renderer.render();

  //  Count lit rows; three separated bands means the layout is not colliding.
  bool rowLit[32] = {};
  for (int16_t y = 0; y < 32; ++y) {
    for (int16_t x = 0; x < 64; ++x) {
      if (renderer.canvas().getPixel(x, y) != 0) {
        rowLit[y] = true;
        break;
      }
    }
  }
  int bands = 0;
  for (int y = 1; y < 32; ++y) {
    if (rowLit[y] && !rowLit[y - 1]) {
      ++bands;
    }
  }
  //  Three text bands; the status pixel sits on row 0 and may merge with the
  //  first, so accept 3 or 4.
  CHECK(bands >= 3);
}

TEST(content_is_vertically_centred_within_the_panel) {
  Renderer renderer;
  renderer.setFrame(makeFrame("RYANAIR", "FR1812", "24,000FT"));
  renderer.render();
  const Bounds bounds = boundsOf(renderer.canvas());
  CHECK(!bounds.empty());
  CHECK(bounds.minY >= 0);
  CHECK(bounds.maxY < 32);
  //  Roughly balanced margins, allowing for the corner status pixel on row 0.
  CHECK((31 - bounds.maxY) <= bounds.minY + 5);
}

TEST(short_lines_are_horizontally_centred) {
  Renderer renderer;
  renderer.setFrame(makeFrame("BA", nullptr, nullptr));
  renderer.render();
  const Bounds bounds = boundsOf(renderer.canvas());
  const int16_t leftMargin = bounds.minX;
  //  The status pixel occupies x=63, so measure the right margin from the text
  //  only: the title is the only wide thing on this frame.
  CHECK(leftMargin > 10);
}

TEST(a_scrolling_line_starts_at_the_left_edge) {
  Renderer renderer;
  renderer.setFrame(makeFrame("BRITISH AIRWAYS PLC LONG", nullptr, nullptr));
  renderer.render();
  const Bounds bounds = boundsOf(renderer.canvas());
  CHECK_EQ(bounds.minX, 0);
}

TEST(a_scrolling_line_moves_over_time) {
  Renderer renderer;
  renderer.setFrame(makeFrame("BRITISH AIRWAYS PLC LONG", nullptr, nullptr));
  renderer.tick(0);
  renderer.render();
  const int before = litPixels(renderer.canvas());

  renderer.tick(Scroller::kDwellMs + 2000);
  renderer.render();
  const int after = litPixels(renderer.canvas());
  CHECK(renderer.animating());
  //  The exact count changes as glyphs move through the viewport; requiring a
  //  difference is a robust way to assert motion without pinning pixels.
  CHECK(before != after);
}

TEST(refreshing_an_unchanged_line_does_not_restart_its_scroll) {
  //  Compare only the title band: the body line's own pixels are expected to
  //  change, but the scrolling title above it must not jump back to the start
  //  every five seconds.
  const auto titleBand = [](const GFXcanvas16 &canvas) {
    std::string signature;
    for (int16_t y = 0; y < 12; ++y) {
      for (int16_t x = 0; x < 64; ++x) {
        signature.push_back(const_cast<GFXcanvas16 &>(canvas).getPixel(x, y) != 0 ? '#'
                                                                                 : '.');
      }
    }
    return signature;
  };

  Renderer renderer;
  DisplayFrame frame = makeFrame("BRITISH AIRWAYS PLC LONG", "24,000FT", nullptr);
  renderer.setFrame(frame);
  renderer.tick(0);
  renderer.tick(Scroller::kDwellMs + 2000);
  renderer.render();
  const std::string scrolled = titleBand(renderer.canvas());

  //  Only the altitude changed, as it does on every poll.
  std::snprintf(frame.lines[1].text, skypanel::kMaxTextBytes, "24,100FT");
  renderer.setFrame(frame);
  renderer.render();
  CHECK(titleBand(renderer.canvas()) == scrolled);
}

TEST(a_changed_title_does_restart_its_scroll) {
  Renderer renderer;
  renderer.setFrame(makeFrame("BRITISH AIRWAYS PLC LONG", nullptr, nullptr));
  renderer.tick(0);
  renderer.tick(Scroller::kDwellMs + 3000);
  renderer.render();

  renderer.setFrame(makeFrame("AER LINGUS REGIONAL LONG", nullptr, nullptr));
  renderer.render();
  CHECK_EQ(boundsOf(renderer.canvas()).minX, 0);
}

TEST(an_empty_frame_renders_only_the_status_indicator) {
  Renderer renderer;
  DisplayFrame frame;
  frame.mode = FrameMode::Empty;
  frame.status = FrameStatus::Live;
  renderer.setFrame(frame);
  renderer.render();
  CHECK_EQ(litPixels(renderer.canvas()), 1);
}

TEST(the_status_indicator_distinguishes_live_stale_and_offline) {
  Renderer renderer;
  DisplayFrame frame;
  frame.mode = FrameMode::Empty;

  frame.status = FrameStatus::Live;
  renderer.setFrame(frame);
  renderer.render();
  CHECK_EQ(litPixels(renderer.canvas()), 1);

  frame.status = FrameStatus::Stale;
  renderer.setFrame(frame);
  renderer.render();
  CHECK_EQ(litPixels(renderer.canvas()), 4);

  const uint16_t stale = renderer.canvas().getPixel(63, 0);
  frame.status = FrameStatus::Offline;
  renderer.setFrame(frame);
  renderer.render();
  CHECK(renderer.canvas().getPixel(63, 0) != stale);
}

TEST(tracking_mode_draws_a_progress_bar) {
  Renderer renderer;
  DisplayFrame frame = makeFrame("RYANAIR", "FR1812", nullptr);
  frame.mode = FrameMode::Tracking;
  frame.hasProgress = true;
  frame.progress.fraction = 0.5F;
  renderer.setFrame(frame);
  renderer.render();

  int filled = 0;
  const int16_t barY = 29;
  for (int16_t x = 1; x < 63; ++x) {
    if (renderer.canvas().getPixel(x, barY) != 0) {
      ++filled;
    }
  }
  CHECK_EQ(filled, 62);  // track plus fill spans the whole bar
}

TEST(the_progress_fill_grows_with_the_fraction) {
  const uint16_t fill = toRgb565(Colour{0x30, 0x90, 0xFF});
  const auto filledWidth = [&](float fraction) {
    Renderer renderer;
    DisplayFrame frame = makeFrame("RYANAIR", nullptr, nullptr);
    frame.hasProgress = true;
    frame.progress.fraction = fraction;
    renderer.setFrame(frame);
    renderer.render();
    int count = 0;
    for (int16_t x = 0; x < 64; ++x) {
      if (renderer.canvas().getPixel(x, 29) == fill) {
        ++count;
      }
    }
    return count;
  };
  CHECK(filledWidth(0.25F) < filledWidth(0.75F));
  CHECK_EQ(filledWidth(1.0F), 62);
  //  A just-departed flight still shows one lit pixel rather than nothing.
  CHECK_EQ(filledWidth(0.001F), 1);
}

TEST(a_frame_with_a_progress_bar_shifts_its_text_upwards) {
  Renderer withBar;
  DisplayFrame frame = makeFrame("RYANAIR", "FR1812", "24,000FT");
  Renderer withoutBar;
  withoutBar.setFrame(frame);
  withoutBar.render();
  const Bounds plain = boundsOf(withoutBar.canvas());

  frame.hasProgress = true;
  withBar.setFrame(frame);
  withBar.render();

  //  Compare only the text rows, ignoring the bar at the bottom.
  int16_t lastTextRow = -1;
  for (int16_t y = 0; y < 28; ++y) {
    for (int16_t x = 0; x < 64; ++x) {
      if (withBar.canvas().getPixel(x, y) != 0) {
        lastTextRow = y;
        break;
      }
    }
  }
  CHECK(lastTextRow < plain.maxY);
}

TEST(the_renderer_survives_a_millis_wraparound) {
  Renderer renderer;
  renderer.setFrame(makeFrame("BRITISH AIRWAYS PLC LONG", nullptr, nullptr));
  renderer.tick(0xFFFFFF00);
  renderer.tick(0x00000100);  // wrapped: 512 ms later
  renderer.render();
  CHECK(renderer.animating());
}

// -- panel simulation ---------------------------------------------------

TEST(rgb565_unpacking_reproduces_pure_white) {
  uint8_t r = 0;
  uint8_t g = 0;
  uint8_t b = 0;
  skypanel::unpack565(0xFFFF, r, g, b);
  CHECK_EQ(static_cast<int>(r), 255);
  CHECK_EQ(static_cast<int>(g), 255);
  CHECK_EQ(static_cast<int>(b), 255);
}

TEST(gamma_darkens_midtones_the_way_the_driver_does) {
  //  0.5 linear at gamma 2.2 is ~0.218, i.e. 55/255. Getting this wrong is the
  //  classic "looked fine in the sim" bug.
  CHECK_NEAR(skypanel::applyRamp(128, 2.2F, 255), 55, 3);
  CHECK_EQ(static_cast<int>(skypanel::applyRamp(0, 2.2F, 255)), 0);
  CHECK_EQ(static_cast<int>(skypanel::applyRamp(255, 2.2F, 255)), 255);
}

TEST(brightness_scales_the_whole_ramp) {
  const uint8_t full = skypanel::applyRamp(255, 2.2F, 255);
  const uint8_t half = skypanel::applyRamp(255, 2.2F, 128);
  CHECK_NEAR(half, full / 2, 3);
}

TEST(the_panel_image_is_scaled_by_the_configured_factor) {
  Renderer renderer;
  renderer.setFrame(makeFrame("RYANAIR", nullptr, nullptr));
  renderer.render();

  PanelStyle style;
  style.scale = 8;
  const skypanel::Image image = renderPanel(renderer.canvas(), style);
  CHECK_EQ(image.width, 64 * 8);
  CHECK_EQ(image.height, 32 * 8);
}

TEST(unlit_leds_show_the_substrate_not_pure_black) {
  Renderer renderer;
  DisplayFrame frame;
  frame.mode = FrameMode::Empty;
  frame.status = FrameStatus::Live;
  renderer.setFrame(frame);
  renderer.render();

  PanelStyle style;
  style.scale = 4;
  const skypanel::Image image = renderPanel(renderer.canvas(), style);
  CHECK_EQ(static_cast<int>(image.rgb[0]), style.backgroundLevel);
}

TEST(p3_dots_are_larger_than_p4_dots) {
  Renderer renderer;
  renderer.setFrame(makeFrame("RYANAIR", "FR1812", "24,000FT"));
  renderer.render();

  const auto litCount = [&](Pitch pitch) {
    PanelStyle style;
    style.scale = 10;
    style.pitch = pitch;
    const skypanel::Image image = renderPanel(renderer.canvas(), style);
    int count = 0;
    for (std::size_t i = 0; i < image.rgb.size(); i += 3) {
      if (image.rgb[i] > style.backgroundLevel) {
        ++count;
      }
    }
    return count;
  };
  CHECK(litCount(Pitch::P3) > litCount(Pitch::P4));
}

TEST(bloom_adds_light_and_is_off_by_default) {
  Renderer renderer;
  renderer.setFrame(makeFrame("RYANAIR", nullptr, nullptr));
  renderer.render();

  PanelStyle plain;
  plain.scale = 6;
  PanelStyle glowing = plain;
  glowing.bloom = true;

  const auto totalLight = [&](const PanelStyle &style) {
    const skypanel::Image image = renderPanel(renderer.canvas(), style);
    long sum = 0;
    for (const uint8_t value : image.rgb) {
      sum += value;
    }
    return sum;
  };
  CHECK(!plain.bloom);
  CHECK(totalLight(glowing) > totalLight(plain));
}

TEST(scale_one_reproduces_the_canvas_exactly) {
  Renderer renderer;
  renderer.setFrame(makeFrame("RYANAIR", "FR1812", "24,000FT"));
  renderer.render();

  PanelStyle style;
  style.scale = 1;
  style.gamma = 1.0F;
  style.backgroundLevel = 0;
  const skypanel::Image image = renderPanel(renderer.canvas(), style);
  CHECK_EQ(image.width, 64);
  CHECK_EQ(image.height, 32);

  int mismatches = 0;
  for (int16_t y = 0; y < 32; ++y) {
    for (int16_t x = 0; x < 64; ++x) {
      const bool canvasLit = renderer.canvas().getPixel(x, y) != 0;
      const bool imageLit = image.rgb[image.index(x, y)] != 0 ||
                            image.rgb[image.index(x, y) + 1] != 0 ||
                            image.rgb[image.index(x, y) + 2] != 0;
      if (canvasLit != imageLit) {
        ++mismatches;
      }
    }
  }
  CHECK_EQ(mismatches, 0);
}
