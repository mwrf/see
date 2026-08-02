#include "Png.h"

#include <zlib.h>

#include <cstdio>
#include <cstring>
#include <vector>

namespace skypanel {
namespace {

const uint8_t kSignature[8] = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};

void appendBigEndian(std::vector<uint8_t> &out, uint32_t value) {
  out.push_back(static_cast<uint8_t>(value >> 24));
  out.push_back(static_cast<uint8_t>(value >> 16));
  out.push_back(static_cast<uint8_t>(value >> 8));
  out.push_back(static_cast<uint8_t>(value));
}

uint32_t readBigEndian(const uint8_t *p) {
  return (static_cast<uint32_t>(p[0]) << 24) | (static_cast<uint32_t>(p[1]) << 16) |
         (static_cast<uint32_t>(p[2]) << 8) | static_cast<uint32_t>(p[3]);
}

void appendChunk(std::vector<uint8_t> &out, const char type[4],
                 const std::vector<uint8_t> &data) {
  appendBigEndian(out, static_cast<uint32_t>(data.size()));
  const std::size_t crcStart = out.size();
  out.insert(out.end(), type, type + 4);
  out.insert(out.end(), data.begin(), data.end());
  const uLong crc = crc32(0, out.data() + crcStart,
                          static_cast<uInt>(out.size() - crcStart));
  appendBigEndian(out, static_cast<uint32_t>(crc));
}

bool readFile(const std::string &path, std::vector<uint8_t> &out, std::string &error) {
  FILE *file = std::fopen(path.c_str(), "rb");
  if (file == nullptr) {
    error = "cannot open " + path;
    return false;
  }
  std::fseek(file, 0, SEEK_END);
  const long size = std::ftell(file);
  std::fseek(file, 0, SEEK_SET);
  if (size < 0) {
    std::fclose(file);
    error = "cannot size " + path;
    return false;
  }
  out.resize(static_cast<std::size_t>(size));
  const std::size_t read = std::fread(out.data(), 1, out.size(), file);
  std::fclose(file);
  if (read != out.size()) {
    error = "short read on " + path;
    return false;
  }
  return true;
}

/// Undo one PNG scanline filter in place. ``previous`` may be null on row 0.
void unfilter(uint8_t type, uint8_t *row, const uint8_t *previous, std::size_t length,
              std::size_t bpp) {
  switch (type) {
    case 0:
      break;
    case 1:
      for (std::size_t i = bpp; i < length; ++i) {
        row[i] = static_cast<uint8_t>(row[i] + row[i - bpp]);
      }
      break;
    case 2:
      if (previous != nullptr) {
        for (std::size_t i = 0; i < length; ++i) {
          row[i] = static_cast<uint8_t>(row[i] + previous[i]);
        }
      }
      break;
    case 3:
      for (std::size_t i = 0; i < length; ++i) {
        const int left = i >= bpp ? row[i - bpp] : 0;
        const int up = previous != nullptr ? previous[i] : 0;
        row[i] = static_cast<uint8_t>(row[i] + ((left + up) / 2));
      }
      break;
    case 4:
      for (std::size_t i = 0; i < length; ++i) {
        const int a = i >= bpp ? row[i - bpp] : 0;
        const int b = previous != nullptr ? previous[i] : 0;
        const int c = (i >= bpp && previous != nullptr) ? previous[i - bpp] : 0;
        const int p = a + b - c;
        const int pa = p > a ? p - a : a - p;
        const int pb = p > b ? p - b : b - p;
        const int pc = p > c ? p - c : c - p;
        const int predictor = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        row[i] = static_cast<uint8_t>(row[i] + predictor);
      }
      break;
    default:
      break;
  }
}

}  // namespace

bool writePng(const std::string &path, const Image &image, std::string &error) {
  if (image.empty()) {
    error = "refusing to write an empty image";
    return false;
  }

  //  Filter type 0 on every row. Real encoders pick per-row filters for size;
  //  LED-panel images are tiny and mostly flat, and a fixed filter keeps the
  //  output byte-identical across runs, which is what snapshot approval wants.
  std::vector<uint8_t> raw;
  raw.reserve(static_cast<std::size_t>(image.height) * (image.width * 3 + 1));
  for (int y = 0; y < image.height; ++y) {
    raw.push_back(0);
    const std::size_t start = image.index(0, y);
    raw.insert(raw.end(), image.rgb.begin() + static_cast<long>(start),
               image.rgb.begin() + static_cast<long>(start + image.width * 3));
  }

  uLongf compressedSize = compressBound(static_cast<uLong>(raw.size()));
  std::vector<uint8_t> compressed(compressedSize);
  if (compress2(compressed.data(), &compressedSize, raw.data(),
                static_cast<uLong>(raw.size()), Z_BEST_COMPRESSION) != Z_OK) {
    error = "zlib compression failed";
    return false;
  }
  compressed.resize(compressedSize);

  std::vector<uint8_t> out(kSignature, kSignature + sizeof(kSignature));

  std::vector<uint8_t> ihdr;
  appendBigEndian(ihdr, static_cast<uint32_t>(image.width));
  appendBigEndian(ihdr, static_cast<uint32_t>(image.height));
  ihdr.push_back(8);  // bit depth
  ihdr.push_back(2);  // colour type: truecolour
  ihdr.push_back(0);  // deflate
  ihdr.push_back(0);  // adaptive filtering
  ihdr.push_back(0);  // no interlace
  appendChunk(out, "IHDR", ihdr);
  appendChunk(out, "IDAT", compressed);
  appendChunk(out, "IEND", {});

  FILE *file = std::fopen(path.c_str(), "wb");
  if (file == nullptr) {
    error = "cannot write " + path;
    return false;
  }
  const std::size_t written = std::fwrite(out.data(), 1, out.size(), file);
  std::fclose(file);
  if (written != out.size()) {
    error = "short write on " + path;
    return false;
  }
  return true;
}

bool readPng(const std::string &path, Image &image, std::string &error) {
  std::vector<uint8_t> bytes;
  if (!readFile(path, bytes, error)) {
    return false;
  }
  if (bytes.size() < 8 || std::memcmp(bytes.data(), kSignature, 8) != 0) {
    error = path + " is not a PNG";
    return false;
  }

  std::size_t offset = 8;
  int width = 0;
  int height = 0;
  int channels = 0;
  std::vector<uint8_t> idat;

  while (offset + 8 <= bytes.size()) {
    const uint32_t length = readBigEndian(&bytes[offset]);
    const char *type = reinterpret_cast<const char *>(&bytes[offset + 4]);
    const std::size_t dataStart = offset + 8;
    if (dataStart + length + 4 > bytes.size()) {
      error = path + " has a truncated chunk";
      return false;
    }

    if (std::memcmp(type, "IHDR", 4) == 0) {
      width = static_cast<int>(readBigEndian(&bytes[dataStart]));
      height = static_cast<int>(readBigEndian(&bytes[dataStart + 4]));
      const uint8_t depth = bytes[dataStart + 8];
      const uint8_t colourType = bytes[dataStart + 9];
      const uint8_t interlace = bytes[dataStart + 12];
      if (depth != 8 || interlace != 0 || (colourType != 2 && colourType != 6)) {
        error = path + ": only 8-bit non-interlaced RGB(A) PNGs are supported";
        return false;
      }
      channels = colourType == 2 ? 3 : 4;
    } else if (std::memcmp(type, "IDAT", 4) == 0) {
      idat.insert(idat.end(), bytes.begin() + static_cast<long>(dataStart),
                  bytes.begin() + static_cast<long>(dataStart + length));
    } else if (std::memcmp(type, "IEND", 4) == 0) {
      break;
    }
    offset = dataStart + length + 4;
  }

  if (width <= 0 || height <= 0 || channels == 0) {
    error = path + " has no usable IHDR";
    return false;
  }

  const std::size_t stride = static_cast<std::size_t>(width) * channels;
  std::vector<uint8_t> raw(static_cast<std::size_t>(height) * (stride + 1));
  uLongf rawSize = static_cast<uLongf>(raw.size());
  if (uncompress(raw.data(), &rawSize, idat.data(),
                 static_cast<uLong>(idat.size())) != Z_OK) {
    error = path + ": zlib decompression failed";
    return false;
  }

  image = Image(width, height);
  std::vector<uint8_t> previous(stride, 0);
  std::vector<uint8_t> current(stride, 0);

  for (int y = 0; y < height; ++y) {
    const std::size_t rowStart = static_cast<std::size_t>(y) * (stride + 1);
    const uint8_t filter = raw[rowStart];
    std::memcpy(current.data(), &raw[rowStart + 1], stride);
    unfilter(filter, current.data(), y == 0 ? nullptr : previous.data(), stride,
             static_cast<std::size_t>(channels));
    for (int x = 0; x < width; ++x) {
      const std::size_t src = static_cast<std::size_t>(x) * channels;
      const std::size_t dst = image.index(x, y);
      image.rgb[dst] = current[src];
      image.rgb[dst + 1] = current[src + 1];
      image.rgb[dst + 2] = current[src + 2];
    }
    previous = current;
  }
  return true;
}

}  // namespace skypanel
