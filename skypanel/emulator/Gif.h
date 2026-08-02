// Animated GIF writer, for --record.
//
// A recording is the fastest way to show someone what scrolling actually looks
// like without them owning a panel, and it is how the README's animation is
// produced. GIF is chosen over a video container purely because it needs no
// dependencies: LZW is 150 lines and zlib is already linked for PNG.
//
// Colour handling: LED-panel frames use a very small palette in practice (a
// brand colour, two greys, a status dot), so a fixed 6x6x6 colour cube plus a
// grey ramp quantises them with no visible banding and no palette pass.
#pragma once

#include <string>

#include "PanelSim.h"

namespace skypanel {

class GifWriter {
 public:
  ~GifWriter();

  /// Open ``path`` for writing at the given size.
  /// ``delayCs`` is the inter-frame delay in centiseconds (GIF's unit).
  bool begin(const std::string &path, int width, int height, int delayCs,
             std::string &error);

  /// Append a frame. Its dimensions must match those passed to begin().
  bool addFrame(const Image &image, std::string &error);

  /// Finish the file. Called automatically by the destructor.
  bool finish(std::string &error);

  int frameCount() const { return frames_; }

 private:
  std::FILE *file_ = nullptr;
  int width_ = 0;
  int height_ = 0;
  int delayCs_ = 5;
  int frames_ = 0;
};

}  // namespace skypanel
