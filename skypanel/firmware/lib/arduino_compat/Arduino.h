// Minimal Arduino compatibility shim for the native (desktop) build.
//
// Adafruit_GFX is written against the Arduino core, but the parts SkyPanel
// uses -- GFXcanvas16 and the font renderer -- need almost nothing from it:
// fixed-width integer types, the PROGMEM no-ops, and Print. Providing those
// here is what lets the emulator compile the *same* renderer as the firmware
// rather than a lookalike.
//
// This header is only on the include path for the native environment; the
// esp32s3 build gets the real Arduino core.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>

using std::cos;
using std::sin;

#include "Print.h"
#include "WString.h"
#include "pgmspace.h"

#ifndef ARDUINO
#define ARDUINO 10819
#endif

using boolean = bool;
using byte = uint8_t;

#ifndef _swap_int16_t
#define _swap_int16_t(a, b)                                                    \
  {                                                                            \
    int16_t t = a;                                                             \
    a = b;                                                                     \
    b = t;                                                                     \
  }
#endif

// Adafruit_GFX calls yield() inside long loops so the ESP watchdog stays
// happy. On a desktop there is nothing to yield to.
inline void yield() {}

// Arduino cores define min()/max() as macros. We deliberately do NOT: the
// render and simulation code uses std::min/std::max, and a macro named `min`
// breaks every one of those call sites. Adafruit_GFX.cpp defines its own
// min() macro where it needs one, so nothing here is missing.

inline long map(long x, long in_min, long in_max, long out_min, long out_max) {
  if (in_max == in_min) {
    return out_min;
  }
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

inline long constrain(long value, long low, long high) {
  return value < low ? low : (value > high ? high : value);
}

inline double radians(double degrees) { return degrees * (M_PI / 180.0); }
inline double degrees(double radians) { return radians * (180.0 / M_PI); }
