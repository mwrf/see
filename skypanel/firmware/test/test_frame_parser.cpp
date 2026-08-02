#include "FrameParser.h"
#include "testing.h"

using namespace skypanel;

namespace {

// The exact document from the spec's "display frame contract" section.
const char *kSpecFrame = R"({
  "mode": "nearest",
  "source": "local",
  "generated_at": "2026-08-02T09:14:03Z",
  "lines": [
    {"text": "RYANAIR", "colour": "#073590", "style": "title", "scroll": "auto"},
    {"text": "FR1812  DUB→STN  B738", "colour": "#c8c8c8", "style": "body"},
    {"text": "24,000FT  410KT  6.1MI", "colour": "#808080", "style": "body"}
  ],
  "progress": null,
  "status": "live"
})";

} // namespace

TEST(parses_the_frame_from_the_spec) {
  DisplayFrame frame;
  const ParseResult result = parseFrame(kSpecFrame, frame);
  CHECK(result.ok);

  CHECK(frame.mode == FrameMode::Nearest);
  CHECK(frame.status == FrameStatus::Live);
  CHECK_STREQ(frame.source, "local");
  CHECK_EQ(static_cast<int>(frame.lineCount), 3);
  CHECK(!frame.hasProgress);

  CHECK_STREQ(frame.lines[0].text.c_str(), "RYANAIR");
  CHECK_EQ(frame.lines[0].colour, 0x073590u);
  CHECK(frame.lines[0].style == LineStyle::Title);
  CHECK(frame.lines[0].scroll == ScrollMode::Auto);

  // The arrow survives as the font's repurposed slot.
  CHECK_STREQ(frame.lines[1].text.c_str(), "FR1812  DUB~STN  B738");
  CHECK(frame.lines[1].style == LineStyle::Body);
  CHECK(frame.lines[1].scroll == ScrollMode::None); // absent means none

  CHECK_STREQ(frame.lines[2].text.c_str(), "24,000FT  410KT  6.1MI");
  CHECK_EQ(frame.lines[2].colour, 0x808080u);
}

TEST(parses_tracking_progress_and_eta) {
  DisplayFrame frame;
  CHECK(parseFrame(R"({"mode":"tracking","status":"live","source":"local",
        "lines":[{"text":"BA","colour":"#ffffff","style":"title"}],
        "progress":{"fraction":0.62,"eta":"13:14"}})",
                   frame)
            .ok);
  CHECK(frame.mode == FrameMode::Tracking);
  CHECK(frame.hasProgress);
  CHECK_NEAR(frame.progressFraction, 0.62, 1e-6);
  CHECK_STREQ(frame.eta, "13:14");
}

TEST(clamps_an_out_of_range_progress_fraction) {
  DisplayFrame frame;
  CHECK(parseFrame(R"({"lines":[{"text":"X"}],"progress":{"fraction":1.9}})", frame).ok);
  CHECK_NEAR(frame.progressFraction, 1.0, 1e-6);
  CHECK(parseFrame(R"({"lines":[{"text":"X"}],"progress":{"fraction":-3}})", frame).ok);
  CHECK_NEAR(frame.progressFraction, 0.0, 1e-6);
}

TEST(carries_the_device_hints) {
  DisplayFrame frame;
  CHECK(parseFrame(R"({"lines":[{"text":"X"}],"brightness":12,"poll_interval_s":8})",
                   frame)
            .ok);
  CHECK_EQ(static_cast<int>(frame.brightness), 12);
  CHECK_NEAR(frame.pollIntervalS, 8.0, 1e-6);
}

TEST(unknown_enum_values_degrade_rather_than_reject) {
  DisplayFrame frame;
  CHECK(parseFrame(R"({"mode":"hyperspace","status":"probably",
        "lines":[{"text":"X","style":"gigantic","scroll":"maybe"}]})",
                   frame)
            .ok);
  CHECK(frame.mode == FrameMode::Empty);
  CHECK(frame.status == FrameStatus::Offline);
  CHECK(frame.lines[0].style == LineStyle::Body);
  CHECK(frame.lines[0].scroll == ScrollMode::None);
}

TEST(structural_nonsense_is_rejected_and_leaves_the_old_frame_alone) {
  DisplayFrame frame;
  CHECK(parseFrame(R"({"lines":[{"text":"KEEP ME"}]})", frame).ok);

  CHECK(!parseFrame("not json", frame).ok);
  CHECK(!parseFrame(R"({"no":"lines"})", frame).ok);
  CHECK(!parseFrame(R"([1,2,3])", frame).ok);
  CHECK_STREQ(frame.lines[0].text.c_str(), "KEEP ME");
}

TEST(empty_lines_are_skipped_not_rendered_blank) {
  DisplayFrame frame;
  CHECK(parseFrame(R"({"lines":[{"text":""},{"text":"REAL"},{"text":""}]})", frame).ok);
  CHECK_EQ(static_cast<int>(frame.lineCount), 1);
  CHECK_STREQ(frame.lines[0].text.c_str(), "REAL");
}

TEST(more_lines_than_the_panel_holds_are_dropped_not_overflowed) {
  DisplayFrame frame;
  CHECK(parseFrame(R"({"lines":[{"text":"1"},{"text":"2"},{"text":"3"},
        {"text":"4"},{"text":"5"},{"text":"6"}]})",
                   frame)
            .ok);
  CHECK_EQ(static_cast<int>(frame.lineCount), static_cast<int>(kMaxLines));
}

TEST(colour_parsing_accepts_the_documented_form_and_rejects_junk) {
  CHECK_EQ(parseHexColour("#073590"), 0x073590u);
  CHECK_EQ(parseHexColour("073590"), 0x073590u);
  CHECK_EQ(parseHexColour("#FFFFFF"), 0xFFFFFFu);
  CHECK_EQ(parseHexColour("#07359"), 0xFFFFFFu);   // too short
  CHECK_EQ(parseHexColour("#0735900"), 0xFFFFFFu); // too long
  CHECK_EQ(parseHexColour("#zzzzzz"), 0xFFFFFFu);
  CHECK_EQ(parseHexColour(nullptr), 0xFFFFFFu);
  CHECK_EQ(parseHexColour("#000000", 0x123456u), 0x000000u);
}

TEST(rgb565_conversion_matches_the_hub75_driver) {
  CHECK_EQ(rgb565(0xFFFFFF), 0xFFFFu);
  CHECK_EQ(rgb565(0x000000), 0x0000u);
  CHECK_EQ(rgb565(0xFF0000), 0xF800u);
  CHECK_EQ(rgb565(0x00FF00), 0x07E0u);
  CHECK_EQ(rgb565(0x0000FF), 0x001Fu);
}

TEST(a_missing_colour_defaults_to_white) {
  DisplayFrame frame;
  CHECK(parseFrame(R"({"lines":[{"text":"X"}]})", frame).ok);
  CHECK_EQ(frame.lines[0].colour, 0xFFFFFFu);
}
