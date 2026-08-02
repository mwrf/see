#include "Png.h"

#include <zlib.h>

#include <cstdio>
#include <cstring>
#include <vector>

namespace skypanel {
namespace {

void appendBigEndian32(std::vector<uint8_t> &out, uint32_t value) {
  out.push_back(static_cast<uint8_t>((value >> 24) & 0xFF));
  out.push_back(static_cast<uint8_t>((value >> 16) & 0xFF));
  out.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
  out.push_back(static_cast<uint8_t>(value & 0xFF));
}

void appendChunk(std::vector<uint8_t> &out, const char type[4],
                 const std::vector<uint8_t> &data) {
  appendBigEndian32(out, static_cast<uint32_t>(data.size()));
  const size_t crcStart = out.size();
  out.insert(out.end(), type, type + 4);
  out.insert(out.end(), data.begin(), data.end());
  const uLong crc = crc32(crc32(0L, Z_NULL, 0), out.data() + crcStart,
                          static_cast<uInt>(out.size() - crcStart));
  appendBigEndian32(out, static_cast<uint32_t>(crc));
}

} // namespace

bool writePng(const Image &image, const std::string &path, std::string &error) {
  if (image.width <= 0 || image.height <= 0) {
    error = "empty image";
    return false;
  }

  // Scanlines, each prefixed with filter type 0 (None).
  std::vector<uint8_t> raw;
  raw.reserve(static_cast<size_t>(image.height) * (1 + static_cast<size_t>(image.width) * 4));
  for (int y = 0; y < image.height; ++y) {
    raw.push_back(0);
    const size_t rowStart = image.index(0, y);
    raw.insert(raw.end(), image.pixels.begin() + static_cast<long>(rowStart),
               image.pixels.begin() + static_cast<long>(rowStart) +
                   static_cast<long>(image.width) * 4);
  }

  uLongf compressedSize = compressBound(static_cast<uLong>(raw.size()));
  std::vector<uint8_t> compressed(compressedSize);
  if (compress2(compressed.data(), &compressedSize, raw.data(),
                static_cast<uLong>(raw.size()), Z_BEST_COMPRESSION) != Z_OK) {
    error = "zlib compression failed";
    return false;
  }
  compressed.resize(compressedSize);

  std::vector<uint8_t> png = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};

  std::vector<uint8_t> ihdr;
  appendBigEndian32(ihdr, static_cast<uint32_t>(image.width));
  appendBigEndian32(ihdr, static_cast<uint32_t>(image.height));
  ihdr.push_back(8); // bit depth
  ihdr.push_back(6); // colour type: RGBA
  ihdr.push_back(0); // deflate
  ihdr.push_back(0); // adaptive filtering
  ihdr.push_back(0); // no interlace
  appendChunk(png, "IHDR", ihdr);
  appendChunk(png, "IDAT", compressed);
  appendChunk(png, "IEND", {});

  std::FILE *file = std::fopen(path.c_str(), "wb");
  if (file == nullptr) {
    error = "cannot open " + path;
    return false;
  }
  const size_t written = std::fwrite(png.data(), 1, png.size(), file);
  std::fclose(file);
  if (written != png.size()) {
    error = "short write to " + path;
    return false;
  }
  return true;
}

} // namespace skypanel
