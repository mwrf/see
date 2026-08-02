#include "FrameParser.h"
#include "Renderer.h"
#include "testing.h"

using namespace skypanel;

namespace {

DisplayFrame parse(const char *json) {
  DisplayFrame frame;
  const ParseResult result = parseFrame(json, frame);
  CHECK(result.ok);
  return frame;
}

const char *kNearest = R"({"mode":"nearest","source":"local","status":"live","lines":[
  {"text":"RYANAIR","colour":"#073590","style":"title","scroll":"auto"},
  {"text":"FR1812  DUB→STN  B738","colour":"#c8c8c8","style":"body"},
  {"text":"24,000FT  410KT  6.1MI","colour":"#808080","style":"body"}]})";

int litPixels(const GFXcanvas16 &canvas) {
  int lit = 0;
  for (int y = 0; y < canvas.height(); ++y) {
    for (int x = 0; x < canvas.width(); ++x) {
      if (canvas.getPixel(x, y) != 0) {
        lit++;
      }
    }
  }
  return lit;
}

bool rowHasInk(const GFXcanvas16 &canvas, int y) {
  for (int x = 0; x < canvas.width(); ++x) {
    if (canvas.getPixel(x, y) != 0) {
      return true;
    }
  }
  return false;
}

} // namespace

TEST(renderer_canvas_is_the_panel_size) {
  Renderer renderer;
  CHECK_EQ(renderer.canvas().width(), 64);
  CHECK_EQ(renderer.canvas().height(), 32);
}

TEST(three_lines_are_laid_out_top_to_bottom_without_overlapping) {
  const DisplayFrame frame = parse(kNearest);
  const Layout layout = Renderer::computeLayout(frame, 64, 32);

  CHECK_EQ(static_cast<int>(layout.lineCount), 3);
  CHECK(layout.lineY[0] >= 0);
  CHECK(layout.lineY[1] >= layout.lineY[0] + Renderer::fontFor(LineStyle::Title).height);
  CHECK(layout.lineY[2] >= layout.lineY[1] + Renderer::fontFor(LineStyle::Body).height);
  CHECK(layout.lineY[2] + Renderer::fontFor(LineStyle::Body).height <= 32);
}

TEST(the_first_line_yields_the_corner_the_status_dot_occupies) {
  const DisplayFrame frame = parse(kNearest);
  const Layout layout = Renderer::computeLayout(frame, 64, 32);
  CHECK(layout.lineViewport[0] < 64);
  CHECK_EQ(layout.lineViewport[1], 64);
}

TEST(tracking_reserves_room_for_the_bar_at_the_bottom) {
  const DisplayFrame frame = parse(R"({"mode":"tracking","lines":[
    {"text":"BRITISH AIRWAYS","colour":"#075aaa","style":"title"},
    {"text":"BA832  DUB→LHR","colour":"#c8c8c8","style":"body"}],
    "progress":{"fraction":0.5,"eta":"09:42"}})");
  const Layout layout = Renderer::computeLayout(frame, 64, 32);

  CHECK(layout.hasBar);
  CHECK(layout.hasEta);
  CHECK_EQ(layout.barY, 30);
  // Text must not run into the bar or the ETA row.
  CHECK(layout.lineY[1] + Renderer::fontFor(LineStyle::Body).height <= layout.etaY);
}

TEST(a_progress_bar_without_an_eta_reclaims_the_space) {
  const DisplayFrame withEta = parse(R"({"lines":[{"text":"A","style":"title"}],
    "progress":{"fraction":0.5,"eta":"09:42"}})");
  const DisplayFrame withoutEta = parse(R"({"lines":[{"text":"A","style":"title"}],
    "progress":{"fraction":0.5}})");
  CHECK(Renderer::computeLayout(withoutEta, 64, 32).lineY[0] >=
        Renderer::computeLayout(withEta, 64, 32).lineY[0]);
}

TEST(rendering_puts_ink_on_the_canvas_at_the_laid_out_rows) {
  Renderer renderer;
  renderer.setFrame(parse(kNearest), 0);
  renderer.render(0);

  const Layout &layout = renderer.layout();
  CHECK(rowHasInk(renderer.canvas(), layout.lineY[0] + 1));
  CHECK(rowHasInk(renderer.canvas(), layout.lineY[1] + 1));
  CHECK(rowHasInk(renderer.canvas(), layout.lineY[2] + 1));
  CHECK(litPixels(renderer.canvas()) > 100);
}

TEST(the_status_dot_is_in_the_top_right_corner_and_colour_coded) {
  Renderer renderer;

  renderer.setFrame(parse(R"({"status":"live","lines":[{"text":"X"}]})"), 0);
  renderer.render(0);
  const uint16_t live = renderer.canvas().getPixel(63, 0);

  renderer.setFrame(parse(R"({"status":"offline","lines":[{"text":"X"}]})"), 0);
  renderer.render(0);
  const uint16_t offline = renderer.canvas().getPixel(63, 0);

  CHECK(live != 0);
  CHECK(offline != 0);
  CHECK(live != offline);
}

TEST(the_progress_bar_length_tracks_the_fraction) {
  auto barWidth = [](const char *json) {
    Renderer renderer;
    renderer.setFrame(parse(json), 0);
    renderer.render(0);
    const int y = renderer.layout().barY;
    int filled = 0;
    // The filled portion is a distinct colour from the track behind it.
    const uint16_t fill = renderer.canvas().getPixel(0, y);
    for (int x = 0; x < 64; ++x) {
      if (renderer.canvas().getPixel(x, y) == fill) {
        filled++;
      } else {
        break;
      }
    }
    return filled;
  };

  CHECK_EQ(barWidth(R"({"lines":[{"text":"X"}],"progress":{"fraction":0.5}})"), 32);
  CHECK_EQ(barWidth(R"({"lines":[{"text":"X"}],"progress":{"fraction":1.0}})"), 64);
}

TEST(a_just_departed_flight_still_shows_one_pixel_of_bar) {
  Renderer renderer;
  renderer.setFrame(parse(R"({"lines":[{"text":"X"}],"progress":{"fraction":0.004}})"), 0);
  renderer.render(0);
  const int y = renderer.layout().barY;
  CHECK(renderer.canvas().getPixel(0, y) != renderer.canvas().getPixel(63, y));
}

TEST(a_short_title_does_not_scroll) {
  Renderer renderer;
  renderer.setFrame(
      parse(R"({"lines":[{"text":"RYANAIR","style":"title","scroll":"auto"}]})"), 0);
  CHECK(!renderer.isAnimating());
}

TEST(a_long_title_scrolls_and_the_pixels_change_over_time) {
  Renderer renderer;
  renderer.setFrame(
      parse(R"({"lines":[{"text":"AEROLINEAS ARGENTINAS","style":"title","scroll":"auto"}]})"),
      0);
  CHECK(renderer.isAnimating());

  renderer.render(0);
  int litAtStart = litPixels(renderer.canvas());
  uint16_t firstPixelAtStart = renderer.canvas().getPixel(0, renderer.layout().lineY[0] + 1);

  renderer.render(4000);
  const uint16_t firstPixelLater =
      renderer.canvas().getPixel(0, renderer.layout().lineY[0] + 1);

  CHECK(litAtStart > 0);
  CHECK(firstPixelAtStart != firstPixelLater);
}

TEST(scrolling_never_bleeds_into_the_status_dot_column) {
  Renderer renderer;
  renderer.setFrame(
      parse(R"({"status":"live","lines":[
        {"text":"AEROLINEAS ARGENTINAS","colour":"#00b0e6","style":"title","scroll":"auto"}]})"),
      0);
  for (uint32_t t = 0; t < 8000; t += 250) {
    renderer.render(t);
    // Row 3 is below the 2px status dot, so any ink in the last two columns there would
    // be text that escaped its viewport.
    CHECK_EQ(static_cast<int>(renderer.canvas().getPixel(62, renderer.layout().lineY[0] + 3)),
             0);
    CHECK_EQ(static_cast<int>(renderer.canvas().getPixel(63, renderer.layout().lineY[0] + 3)),
             0);
  }
}

TEST(setting_a_frame_restarts_the_scroll_so_a_new_aircraft_starts_at_its_name) {
  Renderer renderer;
  const DisplayFrame frame =
      parse(R"({"lines":[{"text":"AEROLINEAS ARGENTINAS","style":"title","scroll":"auto"}]})");

  renderer.setFrame(frame, 0);
  renderer.render(0);
  const uint16_t atStart = renderer.canvas().getPixel(1, renderer.layout().lineY[0] + 1);

  // Same frame content arriving much later must look the same at its own epoch.
  renderer.setFrame(frame, 50000);
  renderer.render(50000);
  CHECK_EQ(static_cast<int>(renderer.canvas().getPixel(1, renderer.layout().lineY[0] + 1)),
           static_cast<int>(atStart));
}

TEST(an_empty_frame_still_lights_the_status_dot) {
  Renderer renderer;
  renderer.setFrame(parse(R"({"mode":"empty","status":"live","lines":[
    {"text":"NO AIRCRAFT","style":"title"},{"text":"WITHIN 30MI"}]})"),
                    0);
  renderer.render(0);
  CHECK(renderer.canvas().getPixel(63, 0) != 0);
  CHECK(litPixels(renderer.canvas()) > 20);
}

TEST(rendering_is_deterministic_for_a_given_time) {
  Renderer a;
  Renderer b;
  const DisplayFrame frame = parse(kNearest);
  a.setFrame(frame, 0);
  b.setFrame(frame, 0);
  a.render(3210);
  b.render(3210);
  for (int y = 0; y < 32; ++y) {
    for (int x = 0; x < 64; ++x) {
      CHECK_EQ(static_cast<int>(a.canvas().getPixel(x, y)),
               static_cast<int>(b.canvas().getPixel(x, y)));
    }
  }
}

TEST(the_title_uses_the_taller_face_and_the_body_the_shorter_one) {
  CHECK_EQ(Renderer::fontFor(LineStyle::Title).height, 7);
  CHECK_EQ(Renderer::fontFor(LineStyle::Body).height, 5);
  CHECK_EQ(Renderer::fontFor(LineStyle::Small).height, 5);
}

TEST(four_lines_still_fit_the_panel) {
  const DisplayFrame frame = parse(R"({"lines":[
    {"text":"RYANAIR","style":"title"},
    {"text":"FR1812  DUB→STN","style":"body"},
    {"text":"24,000FT  410KT","style":"body"},
    {"text":"NE 045  ↓960","style":"small"}]})");
  const Layout layout = Renderer::computeLayout(frame, 64, 32);
  CHECK_EQ(static_cast<int>(layout.lineCount), 4);
  CHECK(layout.lineY[3] + 5 <= 32);
}
