#include "FrameParser.h"

#include <cstring>

#include "Json.h"

namespace skypanel {
namespace {

void copyBounded(char *dest, std::size_t capacity, const char *source) {
  if (capacity == 0) {
    return;
  }
  std::size_t i = 0;
  for (; source[i] != '\0' && i + 1 < capacity; ++i) {
    dest[i] = source[i];
  }
  dest[i] = '\0';
}

int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool parseMode(const char *text, FrameMode &out) {
  if (std::strcmp(text, "nearest") == 0) {
    out = FrameMode::Nearest;
  } else if (std::strcmp(text, "tracking") == 0) {
    out = FrameMode::Tracking;
  } else if (std::strcmp(text, "empty") == 0) {
    out = FrameMode::Empty;
  } else if (std::strcmp(text, "error") == 0) {
    out = FrameMode::Error;
  } else {
    return false;
  }
  return true;
}

FrameStatus parseStatus(const char *text) {
  if (std::strcmp(text, "live") == 0) return FrameStatus::Live;
  if (std::strcmp(text, "stale") == 0) return FrameStatus::Stale;
  return FrameStatus::Offline;
}

LineStyle parseStyle(const char *text) {
  return std::strcmp(text, "title") == 0 ? LineStyle::Title : LineStyle::Body;
}

ScrollMode parseScroll(const char *text) {
  return std::strcmp(text, "auto") == 0 ? ScrollMode::Auto : ScrollMode::None;
}

}  // namespace

Colour parseColour(const char *text) {
  const Colour white{0xFF, 0xFF, 0xFF};
  if (text == nullptr) {
    return white;
  }
  if (*text == '#') {
    ++text;
  }
  const std::size_t length = std::strlen(text);

  if (length == 3) {
    const int r = hexDigit(text[0]);
    const int g = hexDigit(text[1]);
    const int b = hexDigit(text[2]);
    if (r < 0 || g < 0 || b < 0) {
      return white;
    }
    return Colour{static_cast<uint8_t>(r * 17), static_cast<uint8_t>(g * 17),
                  static_cast<uint8_t>(b * 17)};
  }
  if (length != 6) {
    return white;
  }

  int channels[3] = {0, 0, 0};
  for (int i = 0; i < 3; ++i) {
    const int high = hexDigit(text[i * 2]);
    const int low = hexDigit(text[i * 2 + 1]);
    if (high < 0 || low < 0) {
      return white;
    }
    channels[i] = (high << 4) | low;
  }
  return Colour{static_cast<uint8_t>(channels[0]),
                static_cast<uint8_t>(channels[1]),
                static_cast<uint8_t>(channels[2])};
}

ParseResult parseFrame(const char *jsonText, DisplayFrame &out) {
  json::Document doc;
  if (!doc.parse(jsonText)) {
    return {false, doc.error()};
  }

  const int16_t root = doc.root();
  const json::Node *rootNode = doc.node(root);
  if (rootNode == nullptr || rootNode->type != json::Type::Object) {
    return {false, "frame must be a JSON object"};
  }

  DisplayFrame frame;
  if (!parseMode(doc.memberString(root, "mode", ""), frame.mode)) {
    return {false, "missing or unknown 'mode'"};
  }
  frame.status = parseStatus(doc.memberString(root, "status", "offline"));
  copyBounded(frame.source, kMaxSourceBytes, doc.memberString(root, "source", "?"));

  const int16_t lines = doc.member(root, "lines");
  const json::Node *linesNode = doc.node(lines);
  if (linesNode == nullptr || linesNode->type != json::Type::Array) {
    return {false, "missing 'lines' array"};
  }

  for (int16_t item = doc.firstChild(lines);
       item >= 0 && frame.lineCount < kMaxLines; item = doc.nextSibling(item)) {
    const json::Node *lineNode = doc.node(item);
    if (lineNode == nullptr || lineNode->type != json::Type::Object) {
      continue;
    }
    FrameLine &line = frame.lines[frame.lineCount];
    copyBounded(line.text, kMaxTextBytes, doc.memberString(item, "text", ""));
    line.colour = parseColour(doc.memberString(item, "colour", "#FFFFFF"));
    line.style = parseStyle(doc.memberString(item, "style", "body"));
    line.scroll = parseScroll(doc.memberString(item, "scroll", "none"));
    frame.lineCount++;
  }

  const int16_t brightness = doc.member(root, "brightness");
  if (brightness >= 0 && !doc.isNull(brightness)) {
    const double value = doc.numberAt(brightness, -1.0);
    if (value >= 0.0) {
      frame.brightness = static_cast<int16_t>(value > 255.0 ? 255.0 : value);
    }
  }

  const int16_t progress = doc.member(root, "progress");
  if (progress >= 0 && !doc.isNull(progress)) {
    frame.hasProgress = true;
    float fraction = static_cast<float>(doc.memberNumber(progress, "fraction", 0.0));
    if (fraction < 0.0F) fraction = 0.0F;
    if (fraction > 1.0F) fraction = 1.0F;
    frame.progress.fraction = fraction;

    const int16_t eta = doc.member(progress, "eta");
    if (eta >= 0 && !doc.isNull(eta)) {
      copyBounded(frame.progress.eta, kMaxEtaBytes, doc.stringAt(eta, ""));
      frame.progress.hasEta = frame.progress.eta[0] != '\0';
    }
  }

  out = frame;
  return {true, ""};
}

DisplayFrame makeErrorFrame(const char *message) {
  DisplayFrame frame;
  frame.mode = FrameMode::Error;
  frame.status = FrameStatus::Offline;
  copyBounded(frame.source, kMaxSourceBytes, "device");
  copyBounded(frame.lines[0].text, kMaxTextBytes,
              message != nullptr ? message : "NO BACKEND");
  frame.lines[0].colour = Colour{0xFF, 0x40, 0x40};
  frame.lines[0].style = LineStyle::Title;
  frame.lines[0].scroll = ScrollMode::Auto;
  frame.lineCount = 1;
  return frame;
}

}  // namespace skypanel
