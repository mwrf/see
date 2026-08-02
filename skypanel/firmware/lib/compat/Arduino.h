// Minimal Arduino shim for the `native` build.
//
// Adafruit_GFX is written against the Arduino core. Everything it actually needs is a
// handful of integer types, a `Print` base class, the PROGMEM accessors (which are
// plain memory reads off-AVR) and two macros. Providing them here is what lets
// `lib/render/` compile unchanged for the desktop — the whole point of the emulator is
// that the renderer is never written twice.
//
// NOT compiled for the esp32s3 target: there the real Arduino core wins.

#pragma once

#ifndef SKYPANEL_NATIVE
#error "compat/Arduino.h is for the native build only; the ESP32 build uses the real core"
#endif

#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>

// ARDUINO itself is set on the command line (-DARDUINO=100), because Adafruit_GFX.h
// tests it *before* including this header.

using boolean = bool;
using byte = uint8_t;

// PROGMEM is an AVR storage qualifier; on every other architecture (the ESP32 included)
// it is a no-op and the "pgm_read" family is an ordinary dereference.
#define PROGMEM
#define PSTR(s) (s)
#define pgm_read_byte(addr) (*reinterpret_cast<const uint8_t *>(addr))
#define pgm_read_word(addr) (*reinterpret_cast<const uint16_t *>(addr))
#define pgm_read_dword(addr) (*reinterpret_cast<const uint32_t *>(addr))
// pgm_read_pointer is deliberately left to Adafruit_GFX.cpp, which defines its own.
#define pgm_read_byte_near(addr) pgm_read_byte(addr)

#ifndef _swap_int16_t
#define _swap_int16_t(a, b)                                                              \
  {                                                                                      \
    int16_t swap_tmp = (a);                                                              \
    (a) = (b);                                                                           \
    (b) = swap_tmp;                                                                      \
  }
#endif

// The Arduino core exposes the <math.h> names unqualified plus its own angle helpers.
using std::cos;
using std::sin;

inline float radians(float degrees) { return degrees * 0.017453292519943295F; }
inline float degrees(float radians_) { return radians_ * 57.29577951308232F; }

// The Arduino core spells these as macros. Here they have to be templates: this build
// also pulls in <algorithm>, and function-like `min`/`max` macros break every
// declaration of std::min and std::max the moment that header is included.
template <typename T, typename U>
constexpr auto min(T a, U b) -> decltype(a < b ? a : b) {
  return a < b ? a : b;
}
template <typename T, typename U>
constexpr auto max(T a, U b) -> decltype(a > b ? a : b) {
  return a > b ? a : b;
}

namespace skypanel_compat {
inline uint64_t micros_since_start() {
  using clock = std::chrono::steady_clock;
  static const clock::time_point start = clock::now();
  return static_cast<uint64_t>(
      std::chrono::duration_cast<std::chrono::microseconds>(clock::now() - start).count());
}
} // namespace skypanel_compat

inline uint32_t micros() {
  return static_cast<uint32_t>(skypanel_compat::micros_since_start());
}

inline uint32_t millis() {
  return static_cast<uint32_t>(skypanel_compat::micros_since_start() / 1000ULL);
}

inline void delay(uint32_t ms) {
  std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}

#include "Print.h"

// Two Arduino types that Adafruit_GFX only mentions in convenience overloads. The
// render path never uses either — no Arduino `String` in the render path is a project
// rule — but the declarations have to resolve for the library to compile.
class __FlashStringHelper;

class String {
public:
  String() = default;
  explicit String(const char *s) : value_(s == nullptr ? "" : s) {}

  size_t length() const { return value_.size(); }
  const char *c_str() const { return value_.c_str(); }

private:
  std::string value_;
};
