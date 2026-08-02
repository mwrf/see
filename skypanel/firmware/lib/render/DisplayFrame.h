// The firmware-side mirror of the backend's DisplayFrame contract.
//
// Everything here is fixed-size and copyable: no heap, no Arduino String, no
// ownership questions. A frame is ~700 bytes, which is nothing on an ESP32-S3
// and means the render path can hold a current and a pending frame without
// thinking about fragmentation.
//
// This struct carries no policy. Units are already formatted, colours are
// already resolved, fields are already selected -- all of that happened
// server-side. The renderer's only job is turning these strings into pixels.
#pragma once

#include <cstddef>
#include <cstdint>

namespace skypanel {

constexpr std::size_t kMaxLines = 4;
constexpr std::size_t kMaxTextBytes = 96;  // UTF-8 bytes, not characters
constexpr std::size_t kMaxSourceBytes = 16;
constexpr std::size_t kMaxEtaBytes = 8;

enum class FrameMode : uint8_t { Nearest, Tracking, Empty, Error };
enum class FrameStatus : uint8_t { Live, Stale, Offline };
enum class LineStyle : uint8_t { Title, Body };
enum class ScrollMode : uint8_t { None, Auto };

struct Colour {
  uint8_t r = 0xFF;
  uint8_t g = 0xFF;
  uint8_t b = 0xFF;

  constexpr bool operator==(const Colour &other) const {
    return r == other.r && g == other.g && b == other.b;
  }
};

/// Pack 24-bit colour into the RGB565 word an Adafruit_GFX canvas stores.
constexpr uint16_t toRgb565(const Colour &c) {
  return static_cast<uint16_t>(((c.r & 0xF8) << 8) | ((c.g & 0xFC) << 3) |
                               (c.b >> 3));
}

struct FrameLine {
  char text[kMaxTextBytes] = {};
  Colour colour;
  LineStyle style = LineStyle::Body;
  ScrollMode scroll = ScrollMode::None;
};

struct Progress {
  float fraction = 0.0F;
  char eta[kMaxEtaBytes] = {};
  bool hasEta = false;
};

struct DisplayFrame {
  FrameMode mode = FrameMode::Empty;
  FrameStatus status = FrameStatus::Offline;
  char source[kMaxSourceBytes] = {};
  FrameLine lines[kMaxLines];
  uint8_t lineCount = 0;
  bool hasProgress = false;
  Progress progress;
};

/// Build the frame shown when the device cannot reach the backend at all.
///
/// The device draws this itself rather than showing the last good frame,
/// because a stale aircraft on the panel is worse than an honest error.
DisplayFrame makeErrorFrame(const char *message);

}  // namespace skypanel
