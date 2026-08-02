#include "Gif.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <vector>

namespace skypanel {
namespace {

constexpr int kCubeLevels = 6;                       // 6x6x6 = 216 colours
constexpr int kCubeSize = kCubeLevels * kCubeLevels * kCubeLevels;
constexpr int kGreyRamp = 32;                        // plus a fine grey ramp
constexpr int kPaletteSize = 256;                    // 216 + 32 + padding

uint8_t quantiseChannel(uint8_t value) {
  return static_cast<uint8_t>((value * (kCubeLevels - 1) + 127) / 255);
}

/// Index into the fixed palette. Near-greys go to the fine ramp, because a
/// dimmed white body line is the most common colour on the panel and the
/// colour cube would band it visibly.
uint8_t paletteIndex(uint8_t r, uint8_t g, uint8_t b) {
  const int spread = std::max({r, g, b}) - std::min({r, g, b});
  if (spread <= 8) {
    const int level = (std::max({r, g, b}) * (kGreyRamp - 1) + 127) / 255;
    return static_cast<uint8_t>(kCubeSize + level);
  }
  return static_cast<uint8_t>(quantiseChannel(r) * kCubeLevels * kCubeLevels +
                              quantiseChannel(g) * kCubeLevels +
                              quantiseChannel(b));
}

void buildPalette(std::vector<uint8_t> &palette) {
  palette.assign(kPaletteSize * 3, 0);
  for (int r = 0; r < kCubeLevels; ++r) {
    for (int g = 0; g < kCubeLevels; ++g) {
      for (int b = 0; b < kCubeLevels; ++b) {
        const int index = (r * kCubeLevels * kCubeLevels + g * kCubeLevels + b) * 3;
        palette[index] = static_cast<uint8_t>(r * 255 / (kCubeLevels - 1));
        palette[index + 1] = static_cast<uint8_t>(g * 255 / (kCubeLevels - 1));
        palette[index + 2] = static_cast<uint8_t>(b * 255 / (kCubeLevels - 1));
      }
    }
  }
  for (int i = 0; i < kGreyRamp; ++i) {
    const int index = (kCubeSize + i) * 3;
    const uint8_t level = static_cast<uint8_t>(i * 255 / (kGreyRamp - 1));
    palette[index] = level;
    palette[index + 1] = level;
    palette[index + 2] = level;
  }
}

/// GIF packs LZW codes least-significant-bit first into sub-blocks of at most
/// 255 bytes.
class BitPacker {
 public:
  void write(uint32_t code, int bits) {
    accumulator_ |= code << used_;
    used_ += bits;
    while (used_ >= 8) {
      block_.push_back(static_cast<uint8_t>(accumulator_ & 0xFF));
      accumulator_ >>= 8;
      used_ -= 8;
      if (block_.size() == 255) {
        flushBlock();
      }
    }
  }

  void finish(std::FILE *file) {
    if (used_ > 0) {
      block_.push_back(static_cast<uint8_t>(accumulator_ & 0xFF));
      accumulator_ = 0;
      used_ = 0;
    }
    flushBlock(file);
    std::fputc(0, file);  // block terminator
  }

  void setFile(std::FILE *file) { file_ = file; }

 private:
  void flushBlock() { flushBlock(file_); }

  void flushBlock(std::FILE *file) {
    if (block_.empty() || file == nullptr) {
      return;
    }
    std::fputc(static_cast<int>(block_.size()), file);
    std::fwrite(block_.data(), 1, block_.size(), file);
    block_.clear();
  }

  std::FILE *file_ = nullptr;
  std::vector<uint8_t> block_;
  uint32_t accumulator_ = 0;
  int used_ = 0;
};

/// Textbook GIF LZW. The dictionary is a flat (prefix, suffix) hash rather
/// than a tree because frames are at most a few hundred thousand pixels and
/// this is simpler to read.
void compressLzw(std::FILE *file, const std::vector<uint8_t> &indices) {
  constexpr int kMinCodeSize = 8;
  constexpr int kClearCode = 1 << kMinCodeSize;
  constexpr int kEndCode = kClearCode + 1;
  constexpr int kMaxCode = 4096;

  std::fputc(kMinCodeSize, file);

  BitPacker packer;
  packer.setFile(file);

  std::vector<int> dictionary(kMaxCode * 256, -1);
  int nextCode = kEndCode + 1;
  int codeSize = kMinCodeSize + 1;

  packer.write(kClearCode, codeSize);
  if (indices.empty()) {
    packer.write(kEndCode, codeSize);
    packer.finish(file);
    return;
  }

  int current = indices[0];
  for (std::size_t i = 1; i < indices.size(); ++i) {
    const int next = indices[i];
    int &entry = dictionary[static_cast<std::size_t>(current) * 256 + next];
    if (entry >= 0) {
      current = entry;
      continue;
    }
    packer.write(static_cast<uint32_t>(current), codeSize);
    if (nextCode < kMaxCode) {
      entry = nextCode++;
      if (nextCode > (1 << codeSize) && codeSize < 12) {
        ++codeSize;
      }
    } else {
      packer.write(kClearCode, codeSize);
      std::fill(dictionary.begin(), dictionary.end(), -1);
      nextCode = kEndCode + 1;
      codeSize = kMinCodeSize + 1;
    }
    current = next;
  }

  packer.write(static_cast<uint32_t>(current), codeSize);
  packer.write(kEndCode, codeSize);
  packer.finish(file);
}

void writeLe16(std::FILE *file, int value) {
  std::fputc(value & 0xFF, file);
  std::fputc((value >> 8) & 0xFF, file);
}

}  // namespace

GifWriter::~GifWriter() {
  std::string ignored;
  finish(ignored);
}

bool GifWriter::begin(const std::string &path, int width, int height, int delayCs,
                      std::string &error) {
  if (width <= 0 || height <= 0) {
    error = "GIF needs a positive size";
    return false;
  }
  file_ = std::fopen(path.c_str(), "wb");
  if (file_ == nullptr) {
    error = "cannot write " + path;
    return false;
  }
  width_ = width;
  height_ = height;
  delayCs_ = delayCs < 1 ? 1 : delayCs;
  frames_ = 0;

  std::fwrite("GIF89a", 1, 6, file_);
  writeLe16(file_, width_);
  writeLe16(file_, height_);
  std::fputc(0xF7, file_);  // global colour table, 256 entries, 8-bit
  std::fputc(0, file_);     // background colour index
  std::fputc(0, file_);     // pixel aspect ratio

  std::vector<uint8_t> palette;
  buildPalette(palette);
  std::fwrite(palette.data(), 1, palette.size(), file_);

  // NETSCAPE2.0 application extension: loop forever.
  std::fputc(0x21, file_);
  std::fputc(0xFF, file_);
  std::fputc(11, file_);
  std::fwrite("NETSCAPE2.0", 1, 11, file_);
  std::fputc(3, file_);
  std::fputc(1, file_);
  writeLe16(file_, 0);
  std::fputc(0, file_);
  return true;
}

bool GifWriter::addFrame(const Image &image, std::string &error) {
  if (file_ == nullptr) {
    error = "GIF writer is not open";
    return false;
  }
  if (image.width != width_ || image.height != height_) {
    error = "GIF frame size does not match the file";
    return false;
  }

  // Graphic control extension: per-frame delay.
  std::fputc(0x21, file_);
  std::fputc(0xF9, file_);
  std::fputc(4, file_);
  std::fputc(0x04, file_);  // disposal: restore to background
  writeLe16(file_, delayCs_);
  std::fputc(0, file_);  // no transparent index
  std::fputc(0, file_);

  // Image descriptor.
  std::fputc(0x2C, file_);
  writeLe16(file_, 0);
  writeLe16(file_, 0);
  writeLe16(file_, width_);
  writeLe16(file_, height_);
  std::fputc(0, file_);  // no local colour table, not interlaced

  std::vector<uint8_t> indices;
  indices.reserve(static_cast<std::size_t>(width_) * height_);
  for (int y = 0; y < height_; ++y) {
    for (int x = 0; x < width_; ++x) {
      const std::size_t offset = image.index(x, y);
      indices.push_back(paletteIndex(image.rgb[offset], image.rgb[offset + 1],
                                     image.rgb[offset + 2]));
    }
  }
  compressLzw(file_, indices);
  ++frames_;
  return true;
}

bool GifWriter::finish(std::string &error) {
  if (file_ == nullptr) {
    return true;
  }
  std::fputc(0x3B, file_);  // trailer
  const bool ok = std::fclose(file_) == 0;
  file_ = nullptr;
  if (!ok) {
    error = "failed to close the GIF";
  }
  return ok;
}

}  // namespace skypanel
