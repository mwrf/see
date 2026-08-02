#include "Gif.h"

#include <cstring>
#include <map>

namespace skypanel {
namespace {

// 6 red × 7 green × 6 blue = 252 entries, padded to 256. Green gets the extra level
// because the eye resolves it best and the "live" status dot is green.
constexpr int kRedLevels = 6;
constexpr int kGreenLevels = 7;
constexpr int kBlueLevels = 6;
constexpr int kPaletteSize = 256;

uint8_t quantise(uint8_t value, int levels) {
  return static_cast<uint8_t>((static_cast<int>(value) * (levels - 1) + 127) / 255);
}

uint8_t paletteIndex(uint8_t r, uint8_t g, uint8_t b) {
  const int ri = quantise(r, kRedLevels);
  const int gi = quantise(g, kGreenLevels);
  const int bi = quantise(b, kBlueLevels);
  return static_cast<uint8_t>((ri * kGreenLevels + gi) * kBlueLevels + bi);
}

void writePalette(std::FILE *file) {
  for (int r = 0; r < kRedLevels; ++r) {
    for (int g = 0; g < kGreenLevels; ++g) {
      for (int b = 0; b < kBlueLevels; ++b) {
        const uint8_t entry[3] = {
            static_cast<uint8_t>(r * 255 / (kRedLevels - 1)),
            static_cast<uint8_t>(g * 255 / (kGreenLevels - 1)),
            static_cast<uint8_t>(b * 255 / (kBlueLevels - 1)),
        };
        std::fwrite(entry, 1, 3, file);
      }
    }
  }
  const uint8_t black[3] = {0, 0, 0};
  for (int i = kRedLevels * kGreenLevels * kBlueLevels; i < kPaletteSize; ++i) {
    std::fwrite(black, 1, 3, file);
  }
}

/// GIF's variable-width LZW, packed LSB-first into 255-byte sub-blocks.
class LzwEncoder {
public:
  LzwEncoder(std::FILE *file, int minimumCodeSize)
      : file_(file), minimumCodeSize_(minimumCodeSize) {
    clearCode_ = 1 << minimumCodeSize_;
    endCode_ = clearCode_ + 1;
    reset();
  }

  void encode(const std::vector<uint8_t> &indices) {
    std::fputc(minimumCodeSize_, file_);
    emit(clearCode_);

    int current = -1;
    for (const uint8_t value : indices) {
      if (current < 0) {
        current = value;
        continue;
      }
      const uint32_t key = (static_cast<uint32_t>(current) << 8) | value;
      const auto found = table_.find(key);
      if (found != table_.end()) {
        current = found->second;
        continue;
      }
      emit(current);
      if (next_ < 4096) {
        table_[key] = next_++;
        if (next_ > (1 << codeWidth_) && codeWidth_ < 12) {
          ++codeWidth_;
        }
      } else {
        emit(clearCode_);
        reset();
      }
      current = value;
    }
    if (current >= 0) {
      emit(current);
    }
    emit(endCode_);
    flush();
    std::fputc(0, file_); // block terminator
  }

private:
  std::FILE *file_;
  int minimumCodeSize_;
  int clearCode_ = 0;
  int endCode_ = 0;
  int next_ = 0;
  int codeWidth_ = 0;
  std::map<uint32_t, int> table_;

  uint32_t bitBuffer_ = 0;
  int bitCount_ = 0;
  uint8_t block_[255];
  int blockLength_ = 0;

  void reset() {
    table_.clear();
    next_ = endCode_ + 1;
    codeWidth_ = minimumCodeSize_ + 1;
  }

  void emit(int code) {
    bitBuffer_ |= static_cast<uint32_t>(code) << bitCount_;
    bitCount_ += codeWidth_;
    while (bitCount_ >= 8) {
      pushByte(static_cast<uint8_t>(bitBuffer_ & 0xFF));
      bitBuffer_ >>= 8;
      bitCount_ -= 8;
    }
  }

  void pushByte(uint8_t byte) {
    block_[blockLength_++] = byte;
    if (blockLength_ == 255) {
      writeBlock();
    }
  }

  void writeBlock() {
    if (blockLength_ == 0) {
      return;
    }
    std::fputc(blockLength_, file_);
    std::fwrite(block_, 1, static_cast<size_t>(blockLength_), file_);
    blockLength_ = 0;
  }

  void flush() {
    if (bitCount_ > 0) {
      pushByte(static_cast<uint8_t>(bitBuffer_ & 0xFF));
      bitBuffer_ = 0;
      bitCount_ = 0;
    }
    writeBlock();
  }
};

void writeLe16(std::FILE *file, uint16_t value) {
  std::fputc(value & 0xFF, file);
  std::fputc((value >> 8) & 0xFF, file);
}

} // namespace

bool GifWriter::writeHeader(std::string &error) {
  std::fwrite("GIF89a", 1, 6, file_);
  writeLe16(file_, static_cast<uint16_t>(width_));
  writeLe16(file_, static_cast<uint16_t>(height_));
  std::fputc(0xF7, file_); // global colour table, 256 entries, 8 bits per channel
  std::fputc(0, file_);    // background colour index
  std::fputc(0, file_);    // pixel aspect ratio
  writePalette(file_);

  // NETSCAPE2.0 application extension: loop forever.
  const uint8_t loop[] = {0x21, 0xFF, 0x0B, 'N', 'E', 'T', 'S', 'C', 'A', 'P',
                          'E',  '2',  '.',  '0', 0x03, 0x01, 0x00, 0x00, 0x00};
  std::fwrite(loop, 1, sizeof(loop), file_);

  if (std::ferror(file_) != 0) {
    error = "failed writing GIF header";
    return false;
  }
  return true;
}

bool GifWriter::open(const std::string &path, int width, int height, uint16_t delayCs,
                     std::string &error) {
  file_ = std::fopen(path.c_str(), "wb");
  if (file_ == nullptr) {
    error = "cannot open " + path;
    return false;
  }
  width_ = width;
  height_ = height;
  delayCs_ = delayCs == 0 ? 1 : delayCs;
  frames_ = 0;
  return writeHeader(error);
}

bool GifWriter::addFrame(const Image &image, std::string &error) {
  if (file_ == nullptr) {
    error = "GIF not open";
    return false;
  }
  if (image.width != width_ || image.height != height_) {
    error = "frame size changed mid-recording";
    return false;
  }

  // Graphic control extension: per-frame delay.
  std::fputc(0x21, file_);
  std::fputc(0xF9, file_);
  std::fputc(0x04, file_);
  std::fputc(0x00, file_);
  writeLe16(file_, delayCs_);
  std::fputc(0x00, file_); // transparent colour index (unused)
  std::fputc(0x00, file_);

  std::fputc(0x2C, file_); // image descriptor
  writeLe16(file_, 0);
  writeLe16(file_, 0);
  writeLe16(file_, static_cast<uint16_t>(width_));
  writeLe16(file_, static_cast<uint16_t>(height_));
  std::fputc(0x00, file_); // no local colour table

  std::vector<uint8_t> indices;
  indices.reserve(static_cast<size_t>(width_) * static_cast<size_t>(height_));
  for (int y = 0; y < height_; ++y) {
    for (int x = 0; x < width_; ++x) {
      const size_t i = image.index(x, y);
      indices.push_back(
          paletteIndex(image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]));
    }
  }

  LzwEncoder encoder(file_, 8);
  encoder.encode(indices);
  ++frames_;

  if (std::ferror(file_) != 0) {
    error = "failed writing GIF frame";
    return false;
  }
  return true;
}

bool GifWriter::close(std::string &error) {
  if (file_ == nullptr) {
    return true;
  }
  std::fputc(0x3B, file_); // trailer
  const bool bad = std::ferror(file_) != 0;
  std::fclose(file_);
  file_ = nullptr;
  if (bad) {
    error = "failed closing GIF";
    return false;
  }
  return true;
}

} // namespace skypanel
