// The slice of Arduino's `Print` that Adafruit_GFX inherits from.
//
// GFX only ever calls `write(uint8_t)` through this. The render path deliberately uses
// none of it — no Arduino `String`, no `print()` — so this exists purely to satisfy the
// base class on the native build.

#pragma once

#include <cstdint>
#include <cstdio>
#include <cstring>

class Print {
public:
  virtual ~Print() = default;

  virtual size_t write(uint8_t) = 0;

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

  size_t write(const char *str) {
    if (str == nullptr) {
      return 0;
    }
    return write(reinterpret_cast<const uint8_t *>(str), std::strlen(str));
  }

  size_t print(const char *str) { return write(str); }
  size_t print(char c) { return write(static_cast<uint8_t>(c)); }

  size_t print(int value) {
    char buf[16];
    const int n = std::snprintf(buf, sizeof(buf), "%d", value);
    return n > 0 ? write(buf) : 0;
  }
};
