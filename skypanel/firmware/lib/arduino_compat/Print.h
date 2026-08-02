// The slice of Arduino's Print that Adafruit_GFX inherits from.
//
// Adafruit_GFX derives from Print so that `display.print("...")` works; the
// only virtual it requires a subclass to implement is write(uint8_t). SkyPanel's
// renderer never calls print() -- it measures and draws strings itself so that
// scrolling and centring are exact -- but the base class still has to exist.
#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

class Print {
public:
  virtual ~Print() = default;

  virtual size_t write(uint8_t value) = 0;

  virtual size_t write(const uint8_t *buffer, size_t size) {
    size_t written = 0;
    while (size--) {
      if (write(*buffer++) == 0) {
        break;
      }
      written++;
    }
    return written;
  }

  size_t write(const char *text) {
    return text == nullptr ? 0
                           : write(reinterpret_cast<const uint8_t *>(text),
                                   std::strlen(text));
  }

  size_t print(const char *text) { return write(text); }
};
