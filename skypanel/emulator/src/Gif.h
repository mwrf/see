// Animated GIF recording, for putting the panel in a README.
//
// Uses a fixed 6×7×6 RGB palette rather than an adaptive one. The panel's own palette is
// tiny — a handful of text colours on black — but the anti-aliased LED dots produce a
// long ramp towards each of them, and a uniform palette handles ramps well while staying
// deterministic and simple. Bloom is off by default in recordings for the same reason.

#pragma once

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "PanelPainter.h"

namespace skypanel {

class GifWriter {
public:
  /// Open `path` for writing. `delayCs` is the inter-frame delay in centiseconds
  /// (GIF's unit); 3 ≈ 33 fps, 5 = 20 fps.
  bool open(const std::string &path, int width, int height, uint16_t delayCs,
            std::string &error);

  bool addFrame(const Image &image, std::string &error);
  bool close(std::string &error);

  int frameCount() const { return frames_; }

private:
  std::FILE *file_ = nullptr;
  int width_ = 0;
  int height_ = 0;
  uint16_t delayCs_ = 5;
  int frames_ = 0;

  bool writeHeader(std::string &error);
};

} // namespace skypanel
