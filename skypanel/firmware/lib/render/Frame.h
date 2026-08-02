// The C++ mirror of the backend's `DisplayFrame`.
//
// Fixed capacity throughout: no allocation on the render path, and the same struct is
// used by the emulator and the firmware. If the backend ever sends more lines than
// `kMaxLines`, the extras are dropped rather than growing a buffer at 30 fps.

#pragma once

#include <cstdint>

#include "Text.h"

namespace skypanel {

constexpr uint8_t kMaxLines = 4;
constexpr int16_t kPanelWidth = 64;
constexpr int16_t kPanelHeight = 32;

enum class FrameMode : uint8_t { Nearest, Tracking, Empty, Error };
enum class FrameStatus : uint8_t { Live, Stale, Offline };
enum class LineStyle : uint8_t { Title, Body, Small };
enum class ScrollMode : uint8_t { None, Auto };

struct FrameLine {
  TextBuffer text;
  uint32_t colour = 0xFFFFFF; ///< 0xRRGGBB, as sent by the backend
  LineStyle style = LineStyle::Body;
  ScrollMode scroll = ScrollMode::None;
};

struct DisplayFrame {
  FrameMode mode = FrameMode::Empty;
  FrameStatus status = FrameStatus::Offline;
  char source[16] = "none";

  FrameLine lines[kMaxLines];
  uint8_t lineCount = 0;

  bool hasProgress = false;
  float progressFraction = 0.0F;
  char eta[8] = "";

  uint8_t brightness = 60;
  float pollIntervalS = 5.0F;

  void clear() {
    *this = DisplayFrame{};
  }
};

} // namespace skypanel
