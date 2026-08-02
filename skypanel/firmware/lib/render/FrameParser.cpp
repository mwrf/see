#include "FrameParser.h"

#include <cstring>

#include "Json.h"

namespace skypanel {
namespace {

int hexDigit(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  return -1;
}

FrameMode modeFrom(const char *text) {
  if (std::strcmp(text, "nearest") == 0) {
    return FrameMode::Nearest;
  }
  if (std::strcmp(text, "tracking") == 0) {
    return FrameMode::Tracking;
  }
  if (std::strcmp(text, "error") == 0) {
    return FrameMode::Error;
  }
  return FrameMode::Empty;
}

FrameStatus statusFrom(const char *text) {
  if (std::strcmp(text, "live") == 0) {
    return FrameStatus::Live;
  }
  if (std::strcmp(text, "stale") == 0) {
    return FrameStatus::Stale;
  }
  return FrameStatus::Offline;
}

LineStyle styleFrom(const char *text) {
  if (std::strcmp(text, "title") == 0) {
    return LineStyle::Title;
  }
  if (std::strcmp(text, "small") == 0) {
    return LineStyle::Small;
  }
  return LineStyle::Body;
}

} // namespace

uint32_t parseHexColour(const char *text, uint32_t fallback) {
  if (text == nullptr) {
    return fallback;
  }
  if (*text == '#') {
    ++text;
  }
  uint32_t value = 0;
  for (int i = 0; i < 6; ++i) {
    const int digit = hexDigit(text[i]);
    if (digit < 0) {
      return fallback;
    }
    value = (value << 4) | static_cast<uint32_t>(digit);
  }
  return text[6] == '\0' ? value : fallback;
}

ParseResult parseFrame(const char *jsonText, DisplayFrame &frame) {
  json::Document doc;
  if (!doc.parse(jsonText)) {
    return {false, doc.error()};
  }
  const uint16_t root = doc.root();
  if (doc.node(root).type != json::Type::Object) {
    return {false, "frame is not an object"};
  }
  const uint16_t lines = doc.member(root, "lines");
  if (lines == json::kInvalid || doc.node(lines).type != json::Type::Array) {
    return {false, "frame has no lines array"};
  }

  DisplayFrame parsed;
  char scratch[kMaxTextLen];

  doc.string(doc.member(root, "mode"), scratch, sizeof(scratch));
  parsed.mode = modeFrom(scratch);

  doc.string(doc.member(root, "status"), scratch, sizeof(scratch));
  parsed.status = statusFrom(scratch);

  doc.string(doc.member(root, "source"), parsed.source, sizeof(parsed.source));

  parsed.brightness =
      static_cast<uint8_t>(doc.number(doc.member(root, "brightness"), 60.0));
  parsed.pollIntervalS =
      static_cast<float>(doc.number(doc.member(root, "poll_interval_s"), 5.0));

  const uint16_t total = doc.count(lines);
  for (uint16_t i = 0; i < total && parsed.lineCount < kMaxLines; ++i) {
    const uint16_t element = doc.element(lines, i);
    if (doc.node(element).type != json::Type::Object) {
      continue;
    }
    FrameLine &line = parsed.lines[parsed.lineCount];

    doc.string(doc.member(element, "text"), scratch, sizeof(scratch));
    // Fold to the font's code space here, once, rather than on every frame drawn.
    text::decode(scratch, line.text);
    if (line.text.empty()) {
      continue;
    }

    doc.string(doc.member(element, "colour"), scratch, sizeof(scratch));
    line.colour = parseHexColour(scratch);

    doc.string(doc.member(element, "style"), scratch, sizeof(scratch));
    line.style = styleFrom(scratch);

    doc.string(doc.member(element, "scroll"), scratch, sizeof(scratch));
    line.scroll = std::strcmp(scratch, "auto") == 0 ? ScrollMode::Auto : ScrollMode::None;

    parsed.lineCount++;
  }

  const uint16_t progress = doc.member(root, "progress");
  if (progress != json::kInvalid && doc.node(progress).type == json::Type::Object) {
    parsed.hasProgress = true;
    double fraction = doc.number(doc.member(progress, "fraction"), 0.0);
    if (fraction < 0.0) {
      fraction = 0.0;
    }
    if (fraction > 1.0) {
      fraction = 1.0;
    }
    parsed.progressFraction = static_cast<float>(fraction);
    doc.string(doc.member(progress, "eta"), parsed.eta, sizeof(parsed.eta));
  }

  frame = parsed;
  return {true, ""};
}

} // namespace skypanel
