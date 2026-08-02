#include "PanelPainter.h"
#include "testing.h"

using namespace skypanel;

namespace {

PanelStyle plainStyle(int scale = 8) {
  PanelStyle style;
  style.scale = scale;
  style.bloom = false;
  style.brightness = 255;
  return style;
}

} // namespace

TEST(painter_output_is_the_canvas_scaled_up) {
  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  PanelPainter painter(plainStyle(8));
  Image image;
  painter.paint(canvas, image);
  CHECK_EQ(image.width, 512);
  CHECK_EQ(image.height, 256);
  CHECK_EQ(image.pixels.size(), static_cast<size_t>(512 * 256 * 4));
}

TEST(an_unlit_led_is_background_not_a_black_dot) {
  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  PanelPainter painter(plainStyle());
  Image image;
  painter.paint(canvas, image);
  for (size_t i = 0; i < image.pixels.size(); i += 4) {
    CHECK_EQ(static_cast<int>(image.pixels[i]), 0);
  }
}

TEST(a_lit_led_becomes_a_dot_with_a_gap_around_it) {
  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  canvas.drawPixel(0, 0, 0xFFFF);

  PanelPainter painter(plainStyle(10));
  Image image;
  painter.paint(canvas, image);

  // Centre of the cell is lit; the corner of the same cell is not — that gap is the
  // whole point, because it is what makes 5px type legible or not.
  const size_t centre = image.index(5, 5);
  const size_t corner = image.index(0, 0);
  CHECK(image.pixels[centre] > 200);
  CHECK_EQ(static_cast<int>(image.pixels[corner]), 0);
}

TEST(p3_emitters_are_fatter_than_p4_ones) {
  PanelStyle p3 = plainStyle(10);
  p3.pitch = Pitch::P3;
  PanelStyle p4 = plainStyle(10);
  p4.pitch = Pitch::P4;
  CHECK(p3.fillFactor() > p4.fillFactor());

  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  canvas.drawPixel(0, 0, 0xFFFF);

  auto litInCell = [&canvas](const PanelStyle &style) {
    PanelPainter painter(style);
    Image image;
    painter.paint(canvas, image);
    int lit = 0;
    for (int y = 0; y < style.scale; ++y) {
      for (int x = 0; x < style.scale; ++x) {
        if (image.pixels[image.index(x, y)] > 0) {
          lit++;
        }
      }
    }
    return lit;
  };
  CHECK(litInCell(p3) > litInCell(p4));
}

namespace {

/// The dim body-text colour the backend sends, as it arrives at the canvas.
constexpr uint16_t kMidGrey =
    static_cast<uint16_t>(((0x80 >> 3) << 11) | ((0x80 >> 2) << 5) | (0x80 >> 3));

} // namespace

TEST(the_drivers_gamma_ramp_and_the_monitors_cancel_at_full_brightness) {
  // Panel light ∝ v^2.2 through the driver's table; a monitor shows light ∝ v^2.2 too.
  // So at the default ramp and full brightness the emulator is a pass-through — and
  // knowing that is the point, because every other configuration is not.
  PanelStyle style = plainStyle();
  style.gamma = 2.2F;
  PanelPainter painter(style);

  uint8_t r = 0;
  uint8_t g = 0;
  uint8_t b = 0;

  painter.emittedColour(0xFFFF, r, g, b);
  CHECK_EQ(static_cast<int>(r), 255);
  CHECK_EQ(static_cast<int>(g), 255);
  CHECK_EQ(static_cast<int>(b), 255);

  painter.emittedColour(kMidGrey, r, g, b);
  CHECK_NEAR(r, 0x84, 3); // the RGB565 round-trip, and nothing else
}

TEST(a_panel_without_a_gamma_table_washes_out_the_midtones) {
  // --gamma 1 models a driver doing linear PWM. The same 0x808080 body text is much
  // brighter in reality than a naive blit would suggest, which is exactly the failure
  // mode this simulation exists to surface.
  PanelStyle style = plainStyle();
  style.gamma = 1.0F;
  PanelPainter painter(style);
  uint8_t r = 0, g = 0, b = 0;
  painter.emittedColour(kMidGrey, r, g, b);
  CHECK(r > 180);
  CHECK(r < 200);
}

TEST(brightness_dims_and_zero_stays_black) {
  PanelStyle bright = plainStyle();
  PanelStyle dim = plainStyle();
  dim.brightness = 40;

  uint8_t br = 0, bg = 0, bb = 0, dr = 0, dg = 0, db = 0;
  PanelPainter(bright).emittedColour(0xFFFF, br, bg, bb);
  PanelPainter(dim).emittedColour(0xFFFF, dr, dg, db);
  CHECK(dr < br);
  CHECK(dr > 0);

  PanelPainter(dim).emittedColour(0x0000, dr, dg, db);
  CHECK_EQ(static_cast<int>(dr), 0);
}

TEST(rgb565_expansion_reaches_full_scale) {
  // 0x1F must expand to 0xFF, not 0xF8, or white looks slightly grey on the panel.
  PanelStyle style = plainStyle();
  style.gamma = 1.0F;
  PanelPainter painter(style);
  uint8_t r = 0, g = 0, b = 0;
  painter.emittedColour(0xF800, r, g, b);
  CHECK_EQ(static_cast<int>(r), 255);
  CHECK_EQ(static_cast<int>(g), 0);
  CHECK_EQ(static_cast<int>(b), 0);
}

TEST(bloom_only_ever_adds_light) {
  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  canvas.drawPixel(10, 10, 0xFFFF);

  PanelStyle plain = plainStyle(6);
  PanelStyle glowing = plainStyle(6);
  glowing.bloom = true;

  Image a;
  Image b;
  PanelPainter(plain).paint(canvas, a);
  PanelPainter(glowing).paint(canvas, b);

  long sumA = 0;
  long sumB = 0;
  for (size_t i = 0; i < a.pixels.size(); i += 4) {
    sumA += a.pixels[i];
    sumB += b.pixels[i];
  }
  CHECK(sumB > sumA);
}

TEST(painting_is_deterministic) {
  GFXcanvas16 canvas(64, 32);
  canvas.fillScreen(0);
  for (int x = 0; x < 64; x += 3) {
    canvas.drawPixel(x, x % 32, static_cast<uint16_t>(0x1234 + x));
  }
  Image a;
  Image b;
  PanelPainter(plainStyle()).paint(canvas, a);
  PanelPainter(plainStyle()).paint(canvas, b);
  CHECK(a.pixels == b.pixels);
}

TEST(repainting_into_the_same_image_clears_the_previous_frame) {
  GFXcanvas16 canvas(64, 32);
  PanelPainter painter(plainStyle());
  Image image;

  canvas.fillScreen(0xFFFF);
  painter.paint(canvas, image);
  canvas.fillScreen(0);
  painter.paint(canvas, image);

  for (size_t i = 0; i < image.pixels.size(); i += 4) {
    CHECK_EQ(static_cast<int>(image.pixels[i]), 0);
  }
}
