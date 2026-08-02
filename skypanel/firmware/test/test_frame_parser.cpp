#include <cstring>

#include "FrameParser.h"
#include "TestFramework.h"

using skypanel::Colour;
using skypanel::DisplayFrame;
using skypanel::FrameMode;
using skypanel::FrameStatus;
using skypanel::LineStyle;
using skypanel::ScrollMode;
using skypanel::parseColour;
using skypanel::parseFrame;

namespace {

/// The exact document from section 5 of the spec.
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

}  // namespace

TEST(frame_parses_the_documented_contract) {
  DisplayFrame frame;
  CHECK(parseFrame(kSpecFrame, frame).ok);
  CHECK(frame.mode == FrameMode::Nearest);
  CHECK(frame.status == FrameStatus::Live);
  CHECK_STR(frame.source, "local");
  CHECK_EQ(static_cast<int>(frame.lineCount), 3);
  CHECK(!frame.hasProgress);
}

TEST(frame_line_fields_are_parsed) {
  DisplayFrame frame;
  CHECK(parseFrame(kSpecFrame, frame).ok);
  CHECK_STR(frame.lines[0].text, "RYANAIR");
  CHECK(frame.lines[0].style == LineStyle::Title);
  CHECK(frame.lines[0].scroll == ScrollMode::Auto);
  CHECK(frame.lines[0].colour == (Colour{0x07, 0x35, 0x90}));
  CHECK(frame.lines[1].style == LineStyle::Body);
  CHECK(frame.lines[1].scroll == ScrollMode::None);  // defaulted
}

TEST(frame_keeps_the_route_arrow_as_utf8) {
  DisplayFrame frame;
  CHECK(parseFrame(kSpecFrame, frame).ok);
  CHECK(std::strstr(frame.lines[1].text, "\xE2\x86\x92") != nullptr);
}

TEST(frame_parses_tracking_progress) {
  DisplayFrame frame;
  const char *json = R"({"mode":"tracking","source":"local","status":"live",
    "lines":[{"text":"BA","colour":"#fff","style":"title"}],
    "progress":{"fraction":0.62,"eta":"13:14"}})";
  CHECK(parseFrame(json, frame).ok);
  CHECK(frame.mode == FrameMode::Tracking);
  CHECK(frame.hasProgress);
  CHECK_NEAR(frame.progress.fraction, 0.62, 1e-6);
  CHECK(frame.progress.hasEta);
  CHECK_STR(frame.progress.eta, "13:14");
}

TEST(frame_progress_without_an_eta_is_fine) {
  DisplayFrame frame;
  const char *json = R"({"mode":"tracking","source":"m","status":"live",
    "lines":[],"progress":{"fraction":0.1,"eta":null}})";
  CHECK(parseFrame(json, frame).ok);
  CHECK(frame.hasProgress);
  CHECK(!frame.progress.hasEta);
}

TEST(frame_clamps_an_out_of_range_progress_fraction) {
  DisplayFrame frame;
  CHECK(parseFrame(R"({"mode":"tracking","source":"m","status":"live","lines":[],
    "progress":{"fraction":1.8}})", frame).ok);
  CHECK_NEAR(frame.progress.fraction, 1.0, 1e-6);
}

TEST(frame_parses_every_mode_and_status) {
  const char *modes[] = {"nearest", "tracking", "empty", "error"};
  for (const char *mode : modes) {
    char json[256];
    std::snprintf(json, sizeof(json),
                  R"({"mode":"%s","source":"m","status":"stale","lines":[]})", mode);
    DisplayFrame frame;
    CHECK(parseFrame(json, frame).ok);
    CHECK(frame.status == FrameStatus::Stale);
  }
}

TEST(frame_rejects_an_unknown_mode) {
  DisplayFrame frame;
  const auto result =
      parseFrame(R"({"mode":"interpretive-dance","source":"m","lines":[]})", frame);
  CHECK(!result.ok);
  CHECK(std::strstr(result.error, "mode") != nullptr);
}

TEST(frame_rejects_a_document_with_no_lines_array) {
  DisplayFrame frame;
  CHECK(!parseFrame(R"({"mode":"nearest","source":"m","status":"live"})", frame).ok);
}

TEST(frame_rejects_malformed_json) {
  DisplayFrame frame;
  CHECK(!parseFrame("{not json", frame).ok);
}

TEST(frame_leaves_the_output_untouched_on_failure) {
  DisplayFrame frame;
  CHECK(parseFrame(kSpecFrame, frame).ok);
  CHECK(!parseFrame("{broken", frame).ok);
  CHECK_STR(frame.lines[0].text, "RYANAIR");
}

TEST(frame_ignores_extra_lines_beyond_the_limit) {
  std::string json =
      R"({"mode":"nearest","source":"m","status":"live","lines":[)";
  for (int i = 0; i < 10; ++i) {
    json += R"({"text":"x","colour":"#fff","style":"body"},)";
  }
  json.pop_back();
  json += "]}";

  DisplayFrame frame;
  CHECK(parseFrame(json.c_str(), frame).ok);
  CHECK_EQ(static_cast<int>(frame.lineCount), static_cast<int>(skypanel::kMaxLines));
}

TEST(frame_truncates_over_long_text_rather_than_overflowing) {
  std::string text(200, 'A');
  const std::string json =
      R"({"mode":"nearest","source":"m","status":"live","lines":[{"text":")" + text +
      R"(","colour":"#fff","style":"body"}]})";
  DisplayFrame frame;
  CHECK(parseFrame(json.c_str(), frame).ok);
  CHECK_EQ(std::strlen(frame.lines[0].text), skypanel::kMaxTextBytes - 1);
}

TEST(frame_tolerates_unknown_fields) {
  DisplayFrame frame;
  const char *json = R"({"mode":"nearest","source":"m","status":"live",
    "future_field": {"nested": [1,2]},
    "lines":[{"text":"A","colour":"#fff","style":"body","new_thing":1}]})";
  CHECK(parseFrame(json, frame).ok);
  CHECK_STR(frame.lines[0].text, "A");
}

TEST(colour_parsing_accepts_the_forms_the_backend_emits) {
  CHECK(parseColour("#073590") == (Colour{0x07, 0x35, 0x90}));
  CHECK(parseColour("073590") == (Colour{0x07, 0x35, 0x90}));
  CHECK(parseColour("#c8c8c8") == (Colour{0xC8, 0xC8, 0xC8}));
  CHECK(parseColour("#f00") == (Colour{0xFF, 0x00, 0x00}));
}

TEST(colour_parsing_falls_back_to_white) {
  const Colour white{0xFF, 0xFF, 0xFF};
  CHECK(parseColour("") == white);
  CHECK(parseColour("#12345") == white);
  CHECK(parseColour("#gggggg") == white);
  CHECK(parseColour(nullptr) == white);
}

TEST(error_frames_are_constructible_on_device) {
  const DisplayFrame frame = skypanel::makeErrorFrame("NO BACKEND");
  CHECK(frame.mode == FrameMode::Error);
  CHECK(frame.status == FrameStatus::Offline);
  CHECK_STR(frame.lines[0].text, "NO BACKEND");
  CHECK_EQ(static_cast<int>(frame.lineCount), 1);
}
