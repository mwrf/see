// `GET /api/frame` JSON → `DisplayFrame`.
//
// Tolerant on purpose: an unknown `mode` or `style` falls back to a sane default rather
// than rejecting the frame, because a panel that shows slightly wrong text beats a panel
// that shows nothing. Structural nonsense — not an object, no `lines` array — is
// rejected, and the caller keeps displaying the previous frame.

#pragma once

#include "Frame.h"

namespace skypanel {

struct ParseResult {
  bool ok = false;
  const char *error = "";
};

/// Parse `json` into `frame`. On failure `frame` is left untouched.
ParseResult parseFrame(const char *json, DisplayFrame &frame);

/// "#RRGGBB" (or "RRGGBB") → 0xRRGGBB. Returns `fallback` for anything else.
uint32_t parseHexColour(const char *text, uint32_t fallback = 0xFFFFFF);

/// 0xRRGGBB → RGB565, the format the canvas and the HUB75 driver both speak.
constexpr uint16_t rgb565(uint32_t rgb) {
  const uint16_t r = static_cast<uint16_t>((rgb >> 19) & 0x1F);
  const uint16_t g = static_cast<uint16_t>((rgb >> 10) & 0x3F);
  const uint16_t b = static_cast<uint16_t>((rgb >> 3) & 0x1F);
  return static_cast<uint16_t>((r << 11) | (g << 5) | b);
}

} // namespace skypanel
